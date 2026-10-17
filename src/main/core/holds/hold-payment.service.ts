/**
 * `HoldPaymentService`: paying for a hold in the app (architecture-notes §12.31, §12.32).
 *
 * `openForSnipe(id)` and `openForWatch(id)` open the provider's payment page in a payment
 * window on the provider's session partition, the one its HTTP client placed the hold with
 * (ParkStay keeps the hold in that session as `ps_booking`, so `/booking/` shows it). They
 * resolve once the payment page has started showing (or after `firstPageWaitMs` while it
 * hangs), not when payment ends; a first page that is blocked or cannot be loaded closes the
 * window and is their error (`PROVIDER_ERROR`).
 * - **Queue first:** for a provider with an access gate, the gate is passed first (at most
 *   `accessGateWaitMs`), so the queue's cookie is in the session before the payment page
 *   loads. If it does not get through, the window opens anyway: it shows the waiting room,
 *   and comes back to the payment page after it (`waitingRoomOrigins`).
 *
 * - **Preconditions:** the row exists (`NOT_FOUND`); its provider has holds (`CAPABILITY`);
 *   it holds a site that has not expired (`HOLD_EXPIRED`). The payment URL must be on the
 *   provider's own origins (`PROVIDER_ERROR`).
 * - **The window** may show the provider's payment origins and its sign-in origins (the
 *   person may sign in while paying). One payment window per provider: a provider session
 *   holds one booking at a time. Asking again for the same hold focuses it; asking for another
 *   one focuses it and answers `VALIDATION`.
 * - **Paid:** a page the window loaded that the provider's `holds.bookedReference` takes as
 *   this hold's confirmation (ParkStay: `/success/` with the hold's own `checkouthash`, showing
 *   its booking number) indicates payment. It marks the snipe BOOKED (from HELD, or EXPIRED:
 *   the hold timer may fire while the person pays) or the watch booked, and records the
 *   confirmed booking, in one transaction. The booking names the held unit as the person's
 *   confirmation does (the watch's last check, else the place's cached units), never by the
 *   provider's id; with no name found it keeps no unit. Then `snipe:updated` or `watch:updated`,
 *   `booking:updated`, and a notification. A repeat (the page reloaded) changes nothing; a
 *   write that failed is tried again on the next confirmation page.
 * - **Closed** before paying: payment can open again until the hold expires. Once a payment
 *   window closes, `onWindowClosed` lets the account service check the account once (the person
 *   may have signed in on the payment page). A closed window never means "unpaid": only for a
 *   provider with `holds.releaseOnPaymentClose` does closing it ask the provider to let the
 *   hold go (below), and the provider decides. Otherwise nothing changes (ParkStay).
 *
 * **Letting a hold go** (R18; a provider with `holds.release`, flagged `holdRelease`):
 * - **When:** the person declines it (`releaseSnipeHold`, `releaseWatchHold`: "Let it go"),
 *   deletes its watch or snipe (`releaseBeforeDelete`, before the row goes), or closes its
 *   payment window with `releaseOnPaymentClose`. A close calls `release` only when the window
 *   closed normally (not on quit, not a first page that failed), after any confirmation being
 *   read (a recorded payment wins, and then nothing is let go), and while the row still holds
 *   that hold, unexpired. A decline closes the hold's payment window first; its close then
 *   starts no release of its own.
 * - **How:** `holds.release({ reference, unitId, expiresAt })` at interactive priority, within
 *   `releaseTimeoutMs` (grown for a paced provider, `pacedDeadlineMs`), at most one at a time
 *   per hold: a second request joins the first.
 * - **Recorded**, in one statement: the hold ends now (so the night guard frees its nights). A
 *   snipe goes EXPIRED (result EXPIRED); a watch keeps `last_result 'held'`, its hold expired.
 *   The message (`last_error`): "You let it go." (or "Let go when the payment window closed."),
 *   or for `gone`, "{shortName} no longer holds it. If you paid, look for {shortName}'s
 *   confirmation email." Never "booked". Then `snipe:updated` or `watch:updated`; no
 *   notification. A row that changed meanwhile (booked, another hold, deleted) is left alone.
 * - **A rejection** changes nothing: the hold stays payable until it runs out. It is logged by
 *   its code (never the reference), and a decline answers `PROVIDER_ERROR`. A delete goes ahead.
 * - **Errors of a decline:** `NOT_FOUND`; `CAPABILITY` (no holds, or no `release`);
 *   `HOLD_EXPIRED` (nothing unexpired to let go); `PROVIDER_ERROR`.
 * - **Quit:** nothing is let go; a release in flight is aborted and records nothing.
 *   `releasing(providerId)` tells the container's `isBusy` that a release is running.
 */

import type { EventSink } from '@shared/contracts/events';
import type { BookingInput, SiteSnipe, Watch } from '@shared/types';
import { SnipeStatus, WatchResult } from '@shared/types/common.types';
import { providerLimits, type ProviderId } from '@shared/types/provider.types';
import type {
  LocationRepository,
  SiteSniperRepository,
  WatchRepository,
} from '../../database/repositories';
import type { ProviderRegistry, ProviderWith } from '../../providers/registry';
import type { ProviderLogger } from '../../providers/sdk/context';
import {
  isProviderBlock,
  ProviderCapabilityError,
  ProviderError,
  ProviderParseError,
  toApiError,
} from '../../providers/sdk/errors';
import { withRequestPriority } from '../../providers/sdk/pacing';
import type {
  HoldReleaseOutcome,
  HoldReleaseResult,
  HoldSuccess,
  HoldToRelease,
} from '../../providers/sdk/provider';
import { matchesOrigin } from '../../providers/sdk/url-patterns';
import { AppError } from '../../utils/app-error';
import { pacedDeadlineMs, withDeadline } from '../catalog/catalog-helpers';
import type {
  ProviderWindowHandle,
  ProviderWindowNavigation,
  ProviderWindowOpener,
} from '../accounts/ports';
import type { BookingService } from '../bookings/booking.service';
import type { NotificationService } from '../notifications/notification.service';

/** What is being paid for: a snipe's or a watch's hold, by its provider reference. */
export interface PaymentSubject {
  kind: 'snipe' | 'watch';
  id: number;
  providerId: ProviderId;
  /** The provider's reference for the hold. */
  reference: string;
}

export interface HoldPaymentDeps {
  providers: Pick<ProviderRegistry, 'require' | 'tryGet'>;
  snipes: Pick<SiteSniperRepository, 'findById' | 'setBooked' | 'endHold'>;
  watches: Pick<WatchRepository, 'findById' | 'setBooked' | 'endHold'>;
  bookings: Pick<BookingService, 'recordConfirmed' | 'announce'>;
  notifications: Pick<NotificationService, 'notifySnipeBooked' | 'notifyBookingConfirmed'>;
  windows: ProviderWindowOpener;
  events: EventSink;
  /** Runs `fn` in one database transaction. */
  transaction<T>(fn: () => T): T;
  /** A payment window of the provider closed (not on quit). */
  onWindowClosed?(providerId: ProviderId): void;
  /**
   * The catalogue's cached place details, to name a held unit the row's own last check does
   * not (a snipe keeps none): the booking stores the unit's name, never a provider's id.
   */
  locations?: Pick<LocationRepository, 'getDetail'>;
  logger: ProviderLogger;
  clock?: () => Date;
  timings?: Partial<HoldPaymentTimings>;
}

export interface HoldPaymentTimings {
  /** The most the provider's queue may take before the window opens anyway. */
  accessGateWaitMs: number;
  /** How long opening waits for the first page before it resolves anyway. */
  firstPageWaitMs: number;
  /**
   * The most `holds.release` may take before it is aborted and the hold stays (the SDK's
   * request timeout); a paced provider's grows with its gaps (`pacedDeadlineMs`).
   */
  releaseTimeoutMs: number;
}

export const DEFAULT_HOLD_PAYMENT_TIMINGS: Readonly<HoldPaymentTimings> = Object.freeze({
  accessGateWaitMs: 60_000,
  firstPageWaitMs: 30_000,
  releaseTimeoutMs: 30_000,
});

/** The requests a release is allowed for on a paced provider (look at the hold, let it go). */
const RELEASE_REQUESTS = 2;

interface OpenPayment {
  readonly subject: PaymentSubject;
  readonly window: ProviderWindowHandle;
  /** The booking was recorded (or there was none to record): later pages change nothing. */
  done: boolean;
  /** Page checks, one after another. */
  checks: Promise<void>;
  /** Closed for a decline or a delete, which lets the hold go itself: the close does not. */
  declined?: boolean;
}

type HoldsProvider = ProviderWith<'holds'>;

/** A provider whose holds can be let go. */
type ReleasingProvider = HoldsProvider & {
  holds: HoldsProvider['holds'] & Required<Pick<HoldsProvider['holds'], 'release'>>;
};

/** A hold the row holds now, unexpired, on a provider that can let it go. */
interface ReleasableHold {
  subject: PaymentSubject;
  provider: ReleasingProvider;
  hold: HoldToRelease;
}

/** What asked for the release: the person declining, the payment window closing, a delete. */
type ReleaseTrigger = 'decline' | 'close' | 'delete';

export const PAYMENT_WINDOW_BUSY_MESSAGE = 'Finish or close the open payment window first';

/** A released hold's message: the person let it go ("Let it go", or deleting its row). */
export const RELEASED_MESSAGE = 'You let it go.';

/** A released hold's message when its payment window closed with no confirmed payment. */
export const RELEASED_ON_CLOSE_MESSAGE = 'Let go when the payment window closed.';

/**
 * The message when the provider no longer held the hold (`gone`): the person may have paid, so
 * it points to the provider's confirmation and never says "booked".
 */
export function holdGoneMessage(shortName: string): string {
  return `${shortName} no longer holds it. If you paid, look for ${shortName}'s confirmation email.`;
}

/** What a decline answers when the provider could not be asked (the hold stays). */
export function releaseFailedMessage(shortName: string): string {
  return `${shortName} couldn't be asked to let the hold go, so it stays until it runs out. You can still pay for it.`;
}

const sameSubject = (a: PaymentSubject, b: PaymentSubject): boolean =>
  a.kind === b.kind && a.id === b.id;

const releaseKey = (subject: PaymentSubject): string => `${subject.kind}:${subject.id}`;

export class HoldPaymentService {
  private readonly deps: HoldPaymentDeps;
  private readonly log: ProviderLogger;
  private readonly clock: () => Date;
  private readonly timings: HoldPaymentTimings;
  private readonly payments = new Map<ProviderId, OpenPayment>();
  /** Payment windows on their way (through the provider's queue). */
  private readonly opening = new Map<
    ProviderId,
    { subject: PaymentSubject; promise: Promise<void> }
  >();
  private readonly controllers = new Set<AbortController>();
  /** Releases in flight, by `releaseKey`: a second request for the same hold joins the first. */
  private readonly releases = new Map<
    string,
    { providerId: ProviderId; promise: Promise<HoldReleaseOutcome> }
  >();
  private disposed = false;

  constructor(deps: HoldPaymentDeps) {
    this.deps = deps;
    this.log = deps.logger.child({ module: 'hold-payment' });
    this.clock = deps.clock ?? (() => new Date());
    this.timings = { ...DEFAULT_HOLD_PAYMENT_TIMINGS, ...deps.timings };
  }

  /** Opens the payment window for a HELD snipe's hold (see the class comment). */
  async openForSnipe(id: number): Promise<void> {
    const snipe = this.deps.snipes.findById(id);
    if (!snipe) throw new AppError('NOT_FOUND', 'Snipe not found');
    const provider = this.deps.providers.require(snipe.providerId, 'holds');
    const { holdReference, holdExpiresAt } = snipe;
    if (snipe.status !== SnipeStatus.HELD || !holdReference || !this.unexpired(holdExpiresAt)) {
      throw this.expired();
    }
    await this.open(
      provider,
      { kind: 'snipe', id, providerId: snipe.providerId, reference: holdReference },
      {
        ok: true,
        reference: holdReference,
        expiresAt: holdExpiresAt!,
        ...(snipe.holdUnitId ? { unitId: snipe.holdUnitId } : {}),
      }
    );
  }

  /** Opens the payment window for a watch's automatic hold (see the class comment). */
  async openForWatch(id: number): Promise<void> {
    const watch = this.deps.watches.findById(id);
    if (!watch) throw new AppError('NOT_FOUND', 'Watch not found');
    const provider = this.deps.providers.require(watch.providerId, 'holds');
    const { hold } = watch;
    if (watch.lastResult !== WatchResult.HELD || !hold || !this.unexpired(hold.expiresAt)) {
      throw this.expired();
    }
    await this.open(
      provider,
      { kind: 'watch', id, providerId: watch.providerId, reference: hold.reference },
      {
        ok: true,
        reference: hold.reference,
        expiresAt: hold.expiresAt,
        ...(hold.unitId ? { unitId: hold.unitId } : {}),
      }
    );
  }

  /**
   * "Let it go" for a HELD snipe's hold (see the class comment): closes its payment window, asks
   * the provider to let it go and records what it found. Resolves with the snipe as it is now.
   */
  async releaseSnipeHold(id: number): Promise<SiteSnipe> {
    await this.decline(this.releasable('snipe', id));
    const snipe = this.deps.snipes.findById(id);
    if (!snipe) throw new AppError('NOT_FOUND', 'Snipe not found');
    return snipe;
  }

  /** "Let it go" for a watch's automatic hold (see `releaseSnipeHold`). */
  async releaseWatchHold(id: number): Promise<Watch> {
    await this.decline(this.releasable('watch', id));
    const watch = this.deps.watches.findById(id);
    if (!watch) throw new AppError('NOT_FOUND', 'Watch not found');
    return watch;
  }

  /**
   * Before a watch or snipe is deleted: lets its unexpired hold go, on a provider with
   * `release`, closing its payment window first. Anything else (no hold, an expired one, a
   * provider without `release`, such as ParkStay) asks nothing. Never rejects: a failed release
   * is logged and the delete goes ahead.
   */
  async releaseBeforeDelete(kind: PaymentSubject['kind'], id: number): Promise<void> {
    const held = this.tryReleasable(kind, id);
    if (!held) return;
    this.closePaymentOf(held.subject);
    try {
      await this.release(held, 'delete');
    } catch {
      // Logged by `runRelease`: the hold stays until it runs out
    }
  }

  /** Whether a hold of the provider is being let go: the container's `isBusy` counts it. */
  releasing(providerId: ProviderId): boolean {
    return [...this.releases.values()].some((release) => release.providerId === providerId);
  }

  /** On quit, before the windows close: their events change nothing from here. */
  dispose(): void {
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    this.payments.clear();
  }

  // ---------------------------------------------------------------------------------------

  private unexpired(expiresAt: Date | undefined): boolean {
    return expiresAt !== undefined && expiresAt.getTime() > this.clock().getTime();
  }

  private expired(): AppError {
    return new AppError('HOLD_EXPIRED', 'This hold has expired, so it can no longer be paid for');
  }

  private open(provider: HoldsProvider, subject: PaymentSubject, hold: HoldSuccess): Promise<void> {
    const { providerId } = subject;
    const same = (other: PaymentSubject): boolean => sameSubject(other, subject);
    const existing = this.payments.get(providerId);
    if (existing && !existing.window.isClosed()) {
      existing.window.focus();
      if (same(existing.subject)) return Promise.resolve();
      throw new AppError('VALIDATION', PAYMENT_WINDOW_BUSY_MESSAGE);
    }
    const underway = this.opening.get(providerId);
    if (underway) {
      if (same(underway.subject)) return underway.promise;
      throw new AppError('VALIDATION', PAYMENT_WINDOW_BUSY_MESSAGE);
    }

    const { manifest, holds, auth } = provider;
    const url = holds.paymentUrl(hold);
    const allowedOrigins = paymentWindowOrigins(url, holds.paymentOrigins, auth);
    if (!matchesOrigin(url, allowedOrigins)) {
      throw new ProviderError({
        providerId,
        message: `${manifest.shortName}'s payment page is not on its payment origins`,
      });
    }

    const promise = (async () => {
      await this.passAccessGate(provider);
      if (this.disposed) return;
      // Let go (or being let go) while the queue was passed: nothing left to pay for
      if (holds.release && (this.releases.has(releaseKey(subject)) || !this.stillHeld(subject))) {
        throw this.expired();
      }
      const window = this.deps.windows.open({
        providerId,
        providerName: manifest.shortName,
        kind: 'payment',
        url,
        allowedOrigins,
        openBlockedExternally: false,
        ...(provider.access?.waitingRoomOrigins
          ? { waitingRoomOrigins: provider.access.waitingRoomOrigins }
          : {}),
      });
      const payment: OpenPayment = { subject, window, done: false, checks: Promise.resolve() };
      this.payments.set(providerId, payment);
      const stopListening = window.onLoaded((page) => this.onLoaded(payment, page));
      window.onClosed((failure) => {
        stopListening();
        if (this.payments.get(providerId) === payment) this.payments.delete(providerId);
        // On quit, or a first page that failed: nothing more (and nothing let go)
        if (this.disposed || failure) return;
        this.log.info(`Payment window for ${subject.kind} ${subject.id} closed`);
        this.deps.onWindowClosed?.(providerId);
        if (!payment.declined) void this.releaseOnClose(payment);
      });
      this.log.info(`Payment window opened for ${subject.kind} ${subject.id} (${providerId})`);
      await this.firstPage(window);
    })().finally(() => {
      if (this.opening.get(providerId)?.promise === promise) this.opening.delete(providerId);
    });
    this.opening.set(providerId, { subject, promise });
    return promise;
  }

  /**
   * The provider's queue, when it has one, so its cookie is in the session before the payment
   * page loads. Not getting through is not an error: the window shows the waiting room.
   */
  private async passAccessGate(provider: HoldsProvider): Promise<void> {
    const gate = provider.manifest.capabilities.accessGate === true ? provider.access : undefined;
    if (!gate) return;
    const controller = new AbortController();
    this.controllers.add(controller);
    const limit = setTimeout(() => controller.abort(), this.timings.accessGateWaitMs + 1_000);
    limit.unref?.();
    try {
      await gate.ensure({ signal: controller.signal, maxWaitMs: this.timings.accessGateWaitMs });
    } catch (error) {
      if (this.disposed) return;
      this.log.warn(
        `${provider.manifest.shortName}'s queue did not let the payment through first (${toApiError(error).code}); opening the payment page anyway`
      );
    } finally {
      clearTimeout(limit);
      this.controllers.delete(controller);
    }
  }

  /**
   * Resolves once the window's first page commits, the person closes it, or `firstPageWaitMs`
   * passed (the window shows anyway); rejects when the first page was blocked or failed.
   */
  private firstPage(window: ProviderWindowHandle): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, this.timings.firstPageWaitMs);
      timer.unref?.();
      const settle = (error?: Error): void => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      window.loaded.then(() => settle(), settle);
      window.onClosed((failure) => settle(failure));
    });
  }

  private onLoaded(payment: OpenPayment, page: ProviderWindowNavigation): void {
    if (this.disposed || payment.done) return;
    if (page.httpStatus < 200 || page.httpStatus >= 300) return;
    payment.checks = payment.checks.then(() => this.check(payment, page.url));
  }

  /** Whether the page indicates this hold was paid for; if so, records the booking. */
  private async check(payment: OpenPayment, url: string): Promise<void> {
    if (this.disposed || payment.done) return;
    const { subject, window } = payment;
    const holds = this.deps.providers.tryGet(subject.providerId)?.holds;
    if (!holds?.bookedReference) return;
    let reference: string | null;
    try {
      reference = await holds.bookedReference(
        { reference: subject.reference },
        { url, hasText: (text) => window.hasText(text) }
      );
    } catch (error) {
      this.log.warn(`Payment window: could not read the page (${String(error)})`);
      return;
    }
    if (!reference || this.disposed || payment.done) return;
    try {
      if (subject.kind === 'snipe') this.bookSnipe(subject, reference);
      else this.bookWatch(subject, reference);
      // Only once written: a confirmation page loaded again tries a failed write again
      payment.done = true;
    } catch (error) {
      // The person paid: say so loudly; the provider's own bookings page still has it
      this.log.error(
        `Payment for ${subject.kind} ${subject.id} completed (${reference}) but was not recorded`,
        error
      );
    }
  }

  /** A paid snipe hold: BOOKED with the provider's booking reference, and the booking. */
  private bookSnipe(subject: PaymentSubject, reference: string): void {
    const recorded = this.deps.transaction(() => {
      const snipe = this.deps.snipes.findById(subject.id);
      const state = !snipe
        ? 'deleted'
        : snipe.status === SnipeStatus.BOOKED
          ? 'booked'
          : snipe.holdReference !== subject.reference
            ? 'another hold'
            : snipe.status === SnipeStatus.HELD || snipe.status === SnipeStatus.EXPIRED
              ? 'held'
              : snipe.status;
      if (!snipe || state !== 'held') return this.notRecorded(subject, state);
      this.deps.snipes.setBooked(snipe.id, reference);
      const booking = this.deps.bookings.recordConfirmed(
        snipe.userId,
        bookingInput(snipe, reference, this.unitName(snipe, snipe.holdUnitId))
      );
      return { snipe: this.deps.snipes.findById(snipe.id)!, booking };
    });
    if (!recorded) return;
    this.log.info(`Snipe ${subject.id} booked (${subject.providerId})`);
    this.deps.events.emit('snipe:updated', recorded.snipe);
    this.deps.bookings.announce(recorded.booking);
    this.deps.notifications.notifySnipeBooked(recorded.snipe).catch((error: unknown) => {
      this.log.error(`Snipe ${subject.id}: booked but not notified`, error);
    });
  }

  /** A paid watch hold: the watch is booked, and the booking recorded. */
  private bookWatch(subject: PaymentSubject, reference: string): void {
    const recorded = this.deps.transaction(() => {
      const watch = this.deps.watches.findById(subject.id);
      const state = !watch
        ? 'deleted'
        : watch.lastResult === WatchResult.BOOKED
          ? 'booked'
          : watch.hold?.reference !== subject.reference
            ? 'another hold'
            : watch.lastResult === WatchResult.HELD
              ? 'held'
              : (watch.lastResult ?? 'unchecked');
      if (!watch || state !== 'held') return this.notRecorded(subject, state);
      this.deps.watches.setBooked(watch.id);
      const booking = this.deps.bookings.recordConfirmed(
        watch.userId,
        bookingInput(watch, reference, this.unitName(watch, watch.hold?.unitId))
      );
      return { watch: this.deps.watches.findById(watch.id)!, booking };
    });
    if (!recorded) return;
    const { watch, booking } = recorded;
    this.log.info(`Watch ${subject.id} booked (${subject.providerId})`);
    this.deps.events.emit('watch:updated', watch);
    this.deps.bookings.announce(booking);
    this.deps.notifications.notifyBookingConfirmed(booking).catch((error: unknown) => {
      this.log.error(`Watch ${subject.id}: booked but not notified`, error);
    });
  }

  /**
   * What the confirmation calls the held unit ("CAMPSITE 07", a class's "One site - select on
   * arrival"): its name in the watch's last check, else in the place's cached units. A
   * provider's unit id (ParkStay: a global campsite id, or `class:<id>`) means nothing to the
   * person, so with no name found the booking keeps no unit.
   */
  private unitName(row: SiteSnipe | Watch, unitId: string | undefined): string | undefined {
    if (!unitId) return undefined;
    const checked = 'lastAvailability' in row ? row.lastAvailability : undefined;
    const fromCheck = checked?.find(
      (unit) => unit.unitId === unitId || unit.aliases?.includes(unitId)
    )?.unitName;
    if (fromCheck) return fromCheck;
    try {
      const cached = this.deps.locations?.getDetail(row.providerId, row.location.externalId);
      return cached?.detail.units?.find((unit) => unit.unitId === unitId)?.unitName;
    } catch (error) {
      // The name is a nicety; the payment is recorded without it.
      this.log.warn(`The held unit's name could not be read (${String(error)})`);
      return undefined;
    }
  }

  // ---- letting a hold go ---------------------------------------------------------------

  /**
   * The row's hold, for a decline: `NOT_FOUND`, `CAPABILITY` (no holds, or no `release`), or
   * `HOLD_EXPIRED` when it holds nothing unexpired.
   */
  private releasable(kind: PaymentSubject['kind'], id: number): ReleasableHold {
    const row = kind === 'snipe' ? this.deps.snipes.findById(id) : this.deps.watches.findById(id);
    if (!row)
      throw new AppError('NOT_FOUND', kind === 'snipe' ? 'Snipe not found' : 'Watch not found');
    const provider = this.deps.providers.require(row.providerId, 'holds');
    if (typeof provider.holds.release !== 'function') {
      throw new ProviderCapabilityError(row.providerId, 'holdRelease');
    }
    const hold = this.currentHold(row);
    if (!hold) {
      throw new AppError(
        'HOLD_EXPIRED',
        'This hold has already ended, so there is nothing to let go'
      );
    }
    return {
      subject: { kind, id, providerId: row.providerId, reference: hold.reference },
      provider: provider as ReleasingProvider,
      hold,
    };
  }

  /** `releasable`, or undefined instead of its errors. */
  private tryReleasable(kind: PaymentSubject['kind'], id: number): ReleasableHold | undefined {
    try {
      return this.releasable(kind, id);
    } catch {
      return undefined;
    }
  }

  /** The hold the row holds now and has not expired: a HELD snipe's, a held watch's. */
  private currentHold(row: SiteSnipe | Watch): HoldToRelease | undefined {
    if ('status' in row) {
      const { holdReference, holdExpiresAt, holdUnitId } = row;
      if (row.status !== SnipeStatus.HELD || !holdReference || !this.unexpired(holdExpiresAt)) {
        return undefined;
      }
      return {
        reference: holdReference,
        expiresAt: holdExpiresAt!,
        ...(holdUnitId ? { unitId: holdUnitId } : {}),
      };
    }
    const { hold } = row;
    if (row.lastResult !== WatchResult.HELD || !hold || !this.unexpired(hold.expiresAt)) {
      return undefined;
    }
    return {
      reference: hold.reference,
      expiresAt: hold.expiresAt,
      ...(hold.unitId ? { unitId: hold.unitId } : {}),
    };
  }

  /** Whether the row still holds `subject`'s hold, unexpired. */
  private stillHeld(subject: PaymentSubject): boolean {
    const row =
      subject.kind === 'snipe'
        ? this.deps.snipes.findById(subject.id)
        : this.deps.watches.findById(subject.id);
    return !!row && this.currentHold(row)?.reference === subject.reference;
  }

  /** Closes `subject`'s open payment window, for a decline or a delete that lets the hold go. */
  private closePaymentOf(subject: PaymentSubject): void {
    const payment = this.payments.get(subject.providerId);
    if (!payment || !sameSubject(payment.subject, subject) || payment.window.isClosed()) return;
    payment.declined = true;
    payment.window.close();
  }

  /** The person declines the hold: its payment window closes, then one release runs. */
  private async decline(held: ReleasableHold): Promise<void> {
    this.closePaymentOf(held.subject);
    await this.release(held, 'decline');
  }

  /**
   * A payment window closed normally: for a provider with `releaseOnPaymentClose`, once any
   * confirmation being read is settled (a recorded payment wins), the hold is let go while the
   * row still holds it, unexpired. Never rejects.
   */
  private async releaseOnClose(payment: OpenPayment): Promise<void> {
    await payment.checks.catch(() => undefined);
    if (this.disposed || payment.done) return;
    const { subject } = payment;
    if (this.deps.providers.tryGet(subject.providerId)?.holds?.releaseOnPaymentClose !== true) {
      return;
    }
    const held = this.tryReleasable(subject.kind, subject.id);
    if (!held || held.subject.reference !== subject.reference) return;
    try {
      await this.release(held, 'close');
    } catch {
      // Logged by `runRelease`: the hold stays until it runs out
    }
  }

  /** One release per hold at a time: a second request joins the one in flight. */
  private release(held: ReleasableHold, trigger: ReleaseTrigger): Promise<HoldReleaseOutcome> {
    const key = releaseKey(held.subject);
    const running = this.releases.get(key);
    if (running) return running.promise;
    const promise: Promise<HoldReleaseOutcome> = this.runRelease(held, trigger).finally(() => {
      if (this.releases.get(key)?.promise === promise) this.releases.delete(key);
    });
    this.releases.set(key, { providerId: held.subject.providerId, promise });
    return promise;
  }

  /**
   * Asks the provider, at interactive priority and within its deadline, then records what it
   * found. A rejection (or an answer that is neither outcome) changes nothing and rejects with
   * `releaseFailedMessage`; after `dispose` nothing is recorded.
   */
  private async runRelease(
    held: ReleasableHold,
    trigger: ReleaseTrigger
  ): Promise<HoldReleaseOutcome> {
    const { subject, provider, hold } = held;
    const { manifest } = provider;
    const controller = new AbortController();
    this.controllers.add(controller);
    const deadline = pacedDeadlineMs(this.timings.releaseTimeoutMs, providerLimits(manifest), {
      requests: RELEASE_REQUESTS,
      priority: 'interactive',
    });
    let outcome: HoldReleaseOutcome;
    try {
      const answer = await withRequestPriority('interactive', () =>
        withDeadline(subject.providerId, deadline, controller.signal, (signal) =>
          provider.holds.release(hold, signal)
        )
      );
      outcome = releaseOutcomeOf(subject.providerId, answer);
    } catch (error) {
      if (!this.disposed) {
        // By its code only: never the reference, a URL or the provider's own words
        const status = isProviderBlock(error) ? ` HTTP ${error.status}` : '';
        this.log.warn(
          `${subject.kind} ${subject.id}: ${manifest.shortName} could not let its hold go (${toApiError(error).code}${status}, ${trigger}); it stays until it runs out`
        );
      }
      throw new ProviderError({
        providerId: subject.providerId,
        message: releaseFailedMessage(manifest.shortName),
        cause: error,
      });
    } finally {
      this.controllers.delete(controller);
    }
    if (this.disposed) return outcome;
    try {
      this.recordEnded(held, outcome, trigger);
    } catch (error) {
      this.log.error(
        `${subject.kind} ${subject.id}: its hold was let go (${outcome}) but not recorded`,
        error
      );
      throw error;
    }
    return outcome;
  }

  /**
   * The provider let the hold go (or no longer held it): the hold ends now, with its message,
   * in one statement, then `snipe:updated` or `watch:updated`. A row that changed meanwhile is
   * left alone. No notification: the person did it.
   */
  private recordEnded(
    held: ReleasableHold,
    outcome: HoldReleaseOutcome,
    trigger: ReleaseTrigger
  ): void {
    const { subject, provider } = held;
    const { kind, id, reference } = subject;
    const message =
      outcome === 'gone'
        ? holdGoneMessage(provider.manifest.shortName)
        : trigger === 'close'
          ? RELEASED_ON_CLOSE_MESSAGE
          : RELEASED_MESSAGE;
    const at = this.clock();
    this.log.info(
      `${kind} ${id}: hold ${outcome === 'released' ? 'let go' : 'gone'} (${trigger}, ${subject.providerId})`
    );
    if (kind === 'snipe') {
      const snipe = this.deps.transaction(() =>
        this.deps.snipes.endHold(id, reference, at, message) ? this.deps.snipes.findById(id) : null
      );
      if (snipe) this.deps.events.emit('snipe:updated', snipe);
    } else {
      const watch = this.deps.transaction(() =>
        this.deps.watches.endHold(id, reference, at, message)
          ? this.deps.watches.findById(id)
          : null
      );
      if (watch) this.deps.events.emit('watch:updated', watch);
    }
  }

  /**
   * A confirmation that changes nothing: a reloaded page (already booked), or a row that was
   * deleted, holds another hold now, or is in a state a payment cannot follow.
   */
  private notRecorded(subject: PaymentSubject, state: string): null {
    if (state !== 'booked') {
      this.log.warn(`${subject.kind} ${subject.id} (${state}): its payment was not recorded`);
    }
    return null;
  }
}

/**
 * The payment window's top-level origins: the provider's payment origins (or the payment
 * page's own origin) and its sign-in origins, so signing in while paying works.
 */
function paymentWindowOrigins(
  url: string,
  paymentOrigins: readonly string[] | undefined,
  auth: HoldsProvider['auth']
): string[] {
  let own: string[] = [];
  try {
    own = [new URL(url).origin];
  } catch {
    // Not a URL: matchesOrigin refuses it below
  }
  const signIn = auth?.kind === 'browser-session' ? auth.allowedOrigins : [];
  return [...new Set([...(paymentOrigins ?? own), ...signIn])];
}

/** The confirmed booking for a paid hold, with the held unit by its name (or none). */
function bookingInput(
  row: SiteSnipe | Watch,
  reference: string,
  unitName: string | undefined
): BookingInput {
  const { location } = row;
  return {
    providerId: row.providerId,
    bookingReference: reference,
    location: {
      externalId: location.externalId,
      name: location.name || location.externalId,
      ...(location.areaName ? { areaName: location.areaName } : {}),
    },
    stay: row.stay,
    unitIds: unitName ? [unitName] : [],
    stayParams: row.stayParams,
  };
}

/** The outcome of `holds.release`'s answer; anything else is a parse error (nothing recorded). */
function releaseOutcomeOf(providerId: ProviderId, answer: HoldReleaseResult): HoldReleaseOutcome {
  const outcome = (answer as Partial<HoldReleaseResult> | null | undefined)?.outcome;
  if (outcome === 'released' || outcome === 'gone') return outcome;
  throw new ProviderParseError({
    providerId,
    message: `${providerId}: holds.release answered neither released nor gone`,
  });
}
