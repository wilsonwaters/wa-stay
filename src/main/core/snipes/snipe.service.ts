/**
 * Site Sniper: automated attempts to hold a high-demand unit the moment it is released.
 *
 * Every provider comes from the registry (`snipes` capability: availability, holds and a
 * release policy), and the release and queue rules come from the provider:
 * - `release.supports(mode)` and `release.computeReleaseAt(...)` decide when a stay opens;
 * - `release.pollFloorMs` is the fastest the core may poll;
 * - the access gate (`provider.access`) is used only when the snipe asks for it, the provider
 *   has one (`capabilities.accessGate`) and the release mode uses it.
 *
 * One attempt (`execute`) is check → one-booking-per-night guard → `holds.create`. On a hold
 * the snipe is HELD with the provider's reference, expiry, unit and payment URL, and stops.
 * Payment stays a human step. The scheduler (`scheduler/snipe-runner.ts`) owns the timing;
 * this service owns the state and every write.
 *
 * Accounts (§12.32): for a provider whose holds need an account (`required-for-holds` or
 * `required`), a snipe is created paused while signed out, `activate` is `AUTH_REQUIRED`
 * until the account is signed in, and an attempt fails as "Sign in to …" when the stored
 * state is not signed in. ParkStay's account is optional, so none of this applies to it.
 */

import {
  SiteSnipe,
  SiteSnipeInput,
  SiteSnipeUpdate,
  SnipeExecutionResult,
  type LocationAvailability,
  type SnipeListFilter,
  type StayInput,
  type StayParams,
  type UnitAvailability,
} from '@shared/types';
import type { EventSink } from '@shared/contracts/events';
import { SnipeResult, SnipeReleaseMode, SnipeStatus } from '@shared/types/common.types';
import { toStayQuery } from '@shared/types/stay.types';
import { compareDates, isCalendarDate, todayIn } from '@shared/utils/calendar-date';
import { DEFAULT_SNIPE_POLL_INTERVAL_MS } from '@shared/constants';
import type { SiteSniperRepository } from '../../database/repositories';
import type { ProviderRegistry, ProviderWith } from '../../providers/registry';
import {
  AccessGateError,
  isAbortError,
  ProviderError,
  toApiError,
} from '../../providers/sdk/errors';
import type { AccessGate } from '../../providers/sdk/provider';
import { AppError } from '../../utils/app-error';
import { logger } from '../../utils/logger';
import type { AccountGate } from '../accounts/ports';
import type { NightGuard } from '../holds/night-guard';
import type { NotificationService } from '../notifications/notification.service';
import { resolveStayParams } from '../stay-params';

const log = logger.child({ module: 'sitesniper' });

/** The provider a snipe runs on: availability, holds and a release policy (and maybe a queue). */
export type SnipeProvider = ProviderWith<'snipes'>;

/** Statuses a snipe never leaves on its own: nothing is armed for them. */
export const TERMINAL_SNIPE_STATUSES: ReadonlySet<SnipeStatus> = new Set([
  SnipeStatus.HELD,
  SnipeStatus.BOOKED,
  SnipeStatus.FAILED,
  SnipeStatus.EXPIRED,
  SnipeStatus.DISABLED,
]);

/** What the scheduler does after an attempt. */
export type SnipeNext = 'continue' | 'done' | 'access-gate';

export interface SnipeOutcome {
  result: SnipeExecutionResult;
  next: SnipeNext;
}

/** How the scheduler runs a snipe, worked out from the snipe and its provider. */
export interface SnipePlan {
  provider: SnipeProvider;
  /** Undefined for continuous (cancellation) polling. */
  releaseAt?: Date;
  /** `releaseAt − leadTime`: when the warm-up (queue) starts. */
  warmupAt?: Date;
  /** `releaseAt + windowDuration`: when an unheld snipe expires. */
  windowEnd?: Date;
  /** The access gate, when this snipe uses it. */
  gate?: AccessGate;
  /** The poll cadence, never below the provider's floor. */
  pollIntervalMs: number;
  /** The provider's time zone, for "today". */
  timeZone: string;
}

export type SnipeNotifications = Pick<NotificationService, 'notifySnipeHeld'>;

export interface SnipeServiceDeps {
  snipes: SiteSniperRepository;
  providers: ProviderRegistry;
  notifications: SnipeNotifications;
  nightGuard: NightGuard;
  /** `snipe:updated` after every change. */
  events?: EventSink;
  /** Sign-in checks for providers whose holds need an account (none: never checked). */
  accounts?: AccountGate;
  clock?: () => Date;
}

/** A provider whose holds need a signed-in account. */
function needsAccountForHolds(provider: { manifest: { capabilities: { account: string } } }) {
  const { account } = provider.manifest.capabilities;
  return account === 'required' || account === 'required-for-holds';
}

export interface SnipeRunOptions {
  signal?: AbortSignal;
  /** A person asked for this attempt ("Run now"): it runs before the release too. */
  manual?: boolean;
}

/** The fields create and update work out with the provider. */
type Prepared = Pick<
  SiteSnipeInput,
  'stayParams' | 'releaseAt' | 'accessGateEnabled' | 'pollIntervalMs'
>;

/** One poll's units for the log: `3 available/available`, at most 20 of them. */
function describeUnits(units: UnitAvailability[]): string {
  const shown = units
    .slice(0, 20)
    .map((u) => `${u.unitName || u.unitId} ${u.nights.map((n) => n.state).join('/') || '-'}`);
  return shown.join(', ') + (units.length > 20 ? `, … ${units.length - 20} more` : '');
}

export class SiteSniperService {
  private readonly repo: SiteSniperRepository;
  private readonly providers: ProviderRegistry;
  private readonly notifications: SnipeNotifications;
  private readonly nightGuard: NightGuard;
  private readonly events?: EventSink;
  private readonly accounts?: AccountGate;
  private readonly clock: () => Date;

  constructor(deps: SnipeServiceDeps) {
    this.repo = deps.snipes;
    this.providers = deps.providers;
    this.notifications = deps.notifications;
    this.nightGuard = deps.nightGuard;
    this.events = deps.events;
    this.accounts = deps.accounts;
    this.clock = deps.clock ?? (() => new Date());
  }

  /**
   * Creates a snipe. Throws `CAPABILITY` for a provider without snipes and `VALIDATION`
   * (with the field) for a release mode the provider does not support, bad dates, bad stay
   * fields, or a release time the provider cannot work out (a scheduled release needs one,
   * before check-in).
   */
  async create(userId: number, input: SiteSnipeInput): Promise<SiteSnipe> {
    const provider = this.providers.require(input.providerId, 'snipes');
    const prepared = await this.prepare(provider, input, input.releaseAt);
    const signIn = await this.signInNeeded(provider);
    if (signIn) {
      // Saved paused, in one transaction: arming it waits for the sign-in (activate checks)
      return this.changed(this.repo.createPaused(userId, { ...input, ...prepared }, signIn).id);
    }
    const snipe = this.repo.create(userId, { ...input, ...prepared });
    if (input.releaseMode === SnipeReleaseMode.CANCELLATION) {
      // No fixed release: due for a poll at once.
      const now = this.clock();
      this.repo.updateCheckTimestamps(snipe.id, now, now);
    }
    return this.changed(snipe.id);
  }

  async get(id: number): Promise<SiteSnipe | null> {
    return this.repo.findById(id);
  }

  /** The stored snipe, read synchronously (the scheduler re-reads it at every step). */
  find(id: number): SiteSnipe | null {
    return this.repo.findById(id);
  }

  async list(userId: number, filter: SnipeListFilter = {}): Promise<SiteSnipe[]> {
    return this.repo.findByUserId(userId, filter);
  }

  /**
   * Updates a snipe. A change to the release mode, location, stay, stay fields, release time,
   * queue choice or poll cadence is checked with the provider again (as at create).
   */
  async update(id: number, updates: SiteSnipeUpdate): Promise<SiteSnipe> {
    const snipe = this.requireSnipe(id);
    const affectsPlan =
      updates.releaseMode !== undefined ||
      updates.location !== undefined ||
      updates.stay !== undefined ||
      updates.stayParams !== undefined ||
      updates.releaseAt !== undefined ||
      updates.accessGateEnabled !== undefined ||
      updates.pollIntervalMs !== undefined;
    let prepared: Partial<Prepared> = {};
    if (affectsPlan) {
      const provider = this.providers.require(snipe.providerId, 'snipes');
      const merged: SiteSnipeInput = {
        providerId: snipe.providerId,
        name: updates.name ?? snipe.name,
        location: updates.location ?? snipe.location,
        stay: updates.stay ?? snipe.stay,
        stayParams: updates.stayParams ?? snipe.stayParams,
        releaseMode: updates.releaseMode ?? snipe.releaseMode,
        accessGateEnabled: updates.accessGateEnabled ?? snipe.accessGateEnabled,
        pollIntervalMs: updates.pollIntervalMs ?? snipe.pollIntervalMs,
      };
      // A scheduled release keeps its time unless a new one is given.
      const requestedAt = updates.releaseAt ?? snipe.releaseAt;
      prepared = await this.prepare(provider, merged, requestedAt);
    }
    this.repo.update(id, { ...updates, ...prepared });
    return this.changed(id);
  }

  /** Deletes a snipe; `snipe:updated` carries its last state once more. */
  async delete(id: number): Promise<boolean> {
    const last = this.repo.findById(id);
    const deleted = this.repo.deleteById(id);
    if (deleted && last) this.events?.emit('snipe:updated', { ...last, isActive: false });
    return deleted;
  }

  /**
   * Arms a snipe again. A HELD or BOOKED snipe is refused: it would hold the same nights a
   * second time.
   */
  async activate(id: number): Promise<void> {
    const snipe = this.requireSnipe(id);
    if (snipe.status === SnipeStatus.HELD || snipe.status === SnipeStatus.BOOKED) {
      throw new AppError(
        'VALIDATION',
        snipe.status === SnipeStatus.HELD
          ? 'This snipe already holds a site'
          : 'This snipe is already booked'
      );
    }
    // A provider whose holds need an account: AUTH_REQUIRED, and nothing is armed
    const provider = this.providers.tryGet(snipe.providerId);
    if (provider && needsAccountForHolds(provider) && this.accounts) {
      await this.accounts.ensureForHolds(snipe.providerId);
      // Signed in now: the sign-in hint no longer applies
      if (snipe.lastError?.startsWith(`Sign in to ${provider.manifest.shortName}`)) {
        this.repo.setResult(id, snipe.lastResult ?? SnipeResult.PENDING);
      }
    }
    this.repo.activate(id);
    this.changed(id);
  }

  async deactivate(id: number): Promise<void> {
    this.requireSnipe(id);
    this.repo.deactivate(id);
    this.changed(id);
  }

  /** Active snipes. */
  getActive(): SiteSnipe[] {
    return this.repo.findActive();
  }

  /** HELD snipes with a hold expiry, for the scheduler's hold-expiry timers. */
  getHeld(): SiteSnipe[] {
    return this.repo.findHeld();
  }

  /** A lifecycle status from the scheduler (QUEUEING, WAITING_RELEASE, SNIPING, ARMED). */
  setStatus(id: number, status: SnipeStatus): void {
    this.repo.updateStatus(id, status);
    this.changed(id);
  }

  /** Ends an unheld snipe: its window closed, or its arrival date has passed. */
  expire(id: number, reason: string): void {
    this.repo.finish(id, SnipeStatus.EXPIRED, SnipeResult.EXPIRED, reason);
    this.changed(id);
  }

  /** A HELD snipe whose hold lapsed unpaid becomes EXPIRED (nothing else changes it). */
  expireHold(id: number): void {
    const snipe = this.repo.findById(id);
    if (snipe?.status !== SnipeStatus.HELD) return;
    this.repo.finish(id, SnipeStatus.EXPIRED, SnipeResult.EXPIRED, 'The hold expired unpaid');
    this.changed(id);
  }

  /** Marks a snipe whose provider is not registered as in error (`UNKNOWN_PROVIDER`). */
  markUnknownProvider(id: number, providerId: string): void {
    this.repo.setResult(
      id,
      SnipeResult.ERROR,
      `UNKNOWN_PROVIDER: Unknown provider "${providerId}"`
    );
    this.changed(id);
  }

  /** A warm-up that could not get through the provider's queue (it carries on without). */
  recordGateFailure(id: number, message: string): void {
    this.repo.setResult(id, SnipeResult.QUEUE_FULL, message);
    this.changed(id);
  }

  /**
   * How to run the snipe: its provider, release instants, gate and poll cadence. Undefined
   * when its provider is not registered or cannot snipe.
   */
  plan(snipe: SiteSnipe): SnipePlan | undefined {
    const provider = this.providers.tryGet(snipe.providerId);
    if (!provider || provider.manifest.capabilities.snipes !== true) return undefined;
    const snipes = provider as SnipeProvider;
    const continuous = snipe.releaseMode === SnipeReleaseMode.CANCELLATION;
    const floor = continuous
      ? snipes.release.pollFloorMs.continuous
      : snipes.release.pollFloorMs.window;
    const releaseAt = continuous ? undefined : snipe.releaseAt;
    return {
      provider: snipes,
      releaseAt,
      warmupAt: releaseAt && new Date(releaseAt.getTime() - snipe.leadTimeSeconds * 1000),
      windowEnd: releaseAt && new Date(releaseAt.getTime() + snipe.windowDurationMs),
      gate: this.usesGate(snipes, snipe.releaseMode, snipe.accessGateEnabled)
        ? snipes.access
        : undefined,
      pollIntervalMs: Math.max(snipe.pollIntervalMs, floor),
      timeZone: provider.manifest.timezone,
    };
  }

  /** Whether the stay has begun where the provider is (nothing left to snipe). */
  arrivalPassed(snipe: SiteSnipe, timeZone: string, now: Date = this.clock()): boolean {
    return (
      isCalendarDate(snipe.stay.arrival) &&
      compareDates(snipe.stay.arrival, todayIn(timeZone, now)) < 0
    );
  }

  /**
   * A daily-rollover snipe's release instant, asked of the provider again and stored when it
   * changed (a v8-migrated row may still carry the old midnight instant). Keeps the stored
   * one when the provider cannot answer.
   */
  async refreshReleaseAt(snipe: SiteSnipe, signal?: AbortSignal): Promise<Date | undefined> {
    if (snipe.releaseMode !== SnipeReleaseMode.DAILY_ROLLOVER) return snipe.releaseAt;
    const provider = this.providers.tryGet(snipe.providerId) as SnipeProvider | undefined;
    if (!provider?.release) return snipe.releaseAt;
    try {
      const fresh = await provider.release.computeReleaseAt({
        mode: snipe.releaseMode,
        externalId: snipe.location.externalId,
        stay: toStayQuery(snipe.stay, snipe.stayParams),
        params: snipe.stayParams,
        now: this.clock(),
        signal,
      });
      if (signal?.aborted || !fresh) return snipe.releaseAt;
      if (fresh.getTime() !== snipe.releaseAt?.getTime()) {
        log.info(`Snipe ${snipe.id}: release moved to ${fresh.toISOString()}`);
        this.repo.setReleaseAt(snipe.id, fresh);
        this.changed(snipe.id);
      }
      return fresh;
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) return snipe.releaseAt;
      log.warn(
        `Snipe ${snipe.id}: release time not refreshed (${toApiError(error).message}); keeping the stored one`
      );
      return snipe.releaseAt;
    }
  }

  /**
   * One attempt: check, guard, hold. Never throws. After `signal` aborts it writes nothing,
   * except a hold the provider already placed.
   */
  async execute(snipeId: number, options: SnipeRunOptions = {}): Promise<SnipeOutcome> {
    const { signal, manual = false } = options;
    const checkedAt = this.clock();
    const outcome = (
      next: SnipeNext,
      result: SnipeResult,
      extra: Partial<SnipeExecutionResult> = {}
    ): SnipeOutcome => ({
      next,
      result: {
        snipeId,
        success: extra.success ?? false,
        result,
        held: false,
        checkedAt,
        ...extra,
      },
    });
    const stopped = (): SnipeOutcome =>
      outcome('done', SnipeResult.ERROR, { error: 'The attempt was stopped' });

    const snipe = this.repo.findById(snipeId);
    if (!snipe) return outcome('done', SnipeResult.ERROR, { error: 'Site snipe not found' });
    if (!snipe.isActive || TERMINAL_SNIPE_STATUSES.has(snipe.status)) {
      return outcome('done', SnipeResult.EXPIRED, { error: 'Snipe is not active' });
    }
    if (!manual && snipe.status !== SnipeStatus.SNIPING) {
      return outcome('done', SnipeResult.PENDING, { error: 'Snipe is not sniping' });
    }
    if (signal?.aborted) return stopped();

    const plan = this.plan(snipe);
    if (!plan) {
      this.markUnknownProvider(snipeId, snipe.providerId);
      return outcome('done', SnipeResult.ERROR, {
        error: `${snipe.providerId} cannot run snipes`,
      });
    }
    const { provider } = plan;
    const nextCheck = new Date(checkedAt.getTime() + plan.pollIntervalMs);

    try {
      if (this.repo.hasReachedMaxAttempts(snipeId)) {
        this.repo.finish(
          snipeId,
          SnipeStatus.EXPIRED,
          SnipeResult.EXPIRED,
          'Maximum attempts reached'
        );
        this.changed(snipeId);
        return outcome('done', SnipeResult.EXPIRED, { error: 'Maximum attempts reached' });
      }

      if (!isCalendarDate(snipe.stay.arrival) || !isCalendarDate(snipe.stay.departure)) {
        throw new Error('The snipe dates are not calendar dates (YYYY-MM-DD)');
      }
      const externalId = snipe.location.externalId;
      const stay = toStayQuery(snipe.stay, snipe.stayParams);

      // Poll availability: the preferred units, or every unit.
      const availability = await provider.availability.check(externalId, stay, {
        unitIds: snipe.unitIds.length > 0 ? snipe.unitIds : undefined,
        signal,
      });
      if (signal?.aborted) return stopped();
      const matched = availability.units.find((unit) => unit.fullyAvailable);
      log.info(
        `Snipe ${snipeId} poll: ${availability.units.length} unit(s), ` +
          `${matched ? `unit ${matched.unitId} free` : 'none free'} — ${describeUnits(availability.units)}`
      );

      if (!matched) {
        const result = this.beforeRelease(snipe, availability, checkedAt)
          ? SnipeResult.TOO_EARLY
          : SnipeResult.UNAVAILABLE;
        this.recordAttempt(snipeId, result, undefined, checkedAt, nextCheck, true);
        return outcome('continue', result, { success: true });
      }

      // An account the holds need, stored as not signed in: no hold (no network here)
      if (
        this.accounts &&
        needsAccountForHolds(provider) &&
        this.accounts.storedState(snipe.providerId) !== 'signed-in'
      ) {
        return this.failSignIn(snipeId, provider.manifest.shortName, matched.unitId, checkedAt);
      }

      // One booking per night: no hold while another covers a night of this stay.
      const reserved = this.nightGuard.tryReserve({
        providerId: snipe.providerId,
        userId: snipe.userId,
        arrival: snipe.stay.arrival,
        departure: snipe.stay.departure,
        owner: { kind: 'snipe', id: snipeId },
      });
      if (!reserved.ok && reserved.transient) {
        // Another hold for these nights is still being placed and may fail: next tick,
        // not counted.
        this.recordAttempt(
          snipeId,
          SnipeResult.UNAVAILABLE,
          reserved.reason,
          checkedAt,
          nextCheck,
          false
        );
        return outcome('continue', SnipeResult.UNAVAILABLE, {
          success: true,
          matchedSiteId: matched.unitId,
          error: reserved.reason,
        });
      }
      if (!reserved.ok) {
        // A HELD or BOOKED snipe, or a held watch, covers a night: this snipe cannot hold.
        this.repo.incrementAttempts(snipeId);
        this.repo.finish(snipeId, SnipeStatus.FAILED, SnipeResult.ERROR, reserved.reason);
        this.changed(snipeId);
        return outcome('done', SnipeResult.ERROR, {
          matchedSiteId: matched.unitId,
          error: reserved.reason,
        });
      }

      let hold;
      try {
        hold = await provider.holds.create({ externalId, unitId: matched.unitId, stay }, signal);
      } finally {
        reserved.reservation.release();
      }

      if (hold.ok) {
        // Recorded even when the attempt was stopped meanwhile: the hold exists now.
        const paymentUrl = provider.holds.paymentUrl(hold);
        const unitId = hold.unitId ?? matched.unitId;
        try {
          this.repo.incrementAttempts(snipeId);
          this.repo.markHeld(snipeId, hold.reference, hold.expiresAt, paymentUrl, unitId);
        } catch (error) {
          log.error(`Snipe ${snipeId}: hold ${hold.reference} placed but not recorded`, error);
        }
        // The person hears about the hold even if the snipe was deleted meanwhile: it is real.
        const stored = this.repo.findById(snipeId);
        if (stored) {
          this.events?.emit('snipe:updated', stored);
        } else {
          log.warn(
            `Snipe ${snipeId} was deleted while hold ${hold.reference} was placed; notifying anyway`
          );
        }
        try {
          await this.notifications.notifySnipeHeld(
            stored ?? {
              ...snipe,
              status: SnipeStatus.HELD,
              isActive: false,
              lastResult: SnipeResult.HELD,
              holdReference: hold.reference,
              holdExpiresAt: hold.expiresAt,
              holdUnitId: unitId,
              paymentUrl,
            }
          );
        } catch (error) {
          log.error(`Snipe ${snipeId}: hold ${hold.reference} placed but not notified`, error);
        }
        return outcome('done', SnipeResult.HELD, {
          success: true,
          held: true,
          holdReference: hold.reference,
          paymentUrl,
          matchedSiteId: unitId,
        });
      }
      if (signal?.aborted) return stopped();

      const message = hold.message || hold.reason;
      switch (hold.reason) {
        case 'taken':
          // Race lost: the unit went between the check and the hold. Next tick.
          this.recordAttempt(snipeId, SnipeResult.UNAVAILABLE, message, checkedAt, nextCheck, true);
          return outcome('continue', SnipeResult.UNAVAILABLE, {
            success: true,
            matchedSiteId: matched.unitId,
            error: message,
          });
        case 'in-progress':
          // Transient (a booking already in the session): retried, not counted.
          this.recordAttempt(
            snipeId,
            SnipeResult.ERROR,
            message || 'A booking is already in progress',
            checkedAt,
            nextCheck,
            false
          );
          return outcome('continue', SnipeResult.ERROR, {
            matchedSiteId: matched.unitId,
            error: message,
          });
        case 'auth-required':
          return this.failSignIn(snipeId, provider.manifest.shortName, matched.unitId, checkedAt);
        default:
          // Closed for bookings, refused, or failed: counted, tried again next tick.
          this.recordAttempt(snipeId, SnipeResult.ERROR, message, checkedAt, nextCheck, true);
          return outcome('continue', SnipeResult.ERROR, {
            matchedSiteId: matched.unitId,
            error: message,
          });
      }
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) return stopped();
      const { message } = toApiError(error);
      if (error instanceof AccessGateError) {
        // The provider's queue is in the way: not counted; the scheduler queues if it may.
        this.recordAttempt(snipeId, SnipeResult.QUEUE_FULL, message, checkedAt, nextCheck, false);
        return outcome('access-gate', SnipeResult.QUEUE_FULL, { error: message });
      }
      log.error(`Site snipe ${snipeId} execution failed: ${message}`);
      this.recordAttempt(snipeId, SnipeResult.ERROR, message, checkedAt, nextCheck, true);
      return outcome('continue', SnipeResult.ERROR, { error: message });
    }
  }

  // ---- internal helpers -------------------------------------------------------

  /**
   * Why a new snipe must wait for a sign-in (its provider's holds need an account that is not
   * signed in), or undefined.
   */
  private async signInNeeded(provider: SnipeProvider): Promise<string | undefined> {
    if (!this.accounts || !needsAccountForHolds(provider)) return undefined;
    try {
      await this.accounts.ensureForHolds(provider.manifest.id);
      return undefined;
    } catch (error) {
      if (!(error instanceof ProviderError) || error.code !== 'auth-required') throw error;
      return `Sign in to ${provider.manifest.shortName} to arm this snipe`;
    }
  }

  /** The hold needs a sign-in: the snipe FAILS (counted) with "Sign in to …". */
  private failSignIn(
    snipeId: number,
    shortName: string,
    unitId: string,
    checkedAt: Date
  ): SnipeOutcome {
    const signIn = `Sign in to ${shortName}`;
    this.repo.incrementAttempts(snipeId);
    this.repo.finish(snipeId, SnipeStatus.FAILED, SnipeResult.ERROR, signIn);
    this.changed(snipeId);
    return {
      next: 'done',
      result: {
        snipeId,
        success: false,
        result: SnipeResult.ERROR,
        held: false,
        checkedAt,
        matchedSiteId: unitId,
        error: signIn,
      },
    };
  }

  private requireSnipe(id: number): SiteSnipe {
    const snipe = this.repo.findById(id);
    if (!snipe) throw new AppError('NOT_FOUND', 'Site snipe not found');
    return snipe;
  }

  /** Emits `snipe:updated` with the stored snipe, and returns it. */
  private changed(id: number): SiteSnipe {
    const snipe = this.repo.findById(id);
    if (!snipe) throw new AppError('NOT_FOUND', 'Site snipe not found');
    this.events?.emit('snipe:updated', snipe);
    return snipe;
  }

  private recordAttempt(
    id: number,
    result: SnipeResult,
    message: string | undefined,
    checkedAt: Date,
    nextCheck: Date,
    counted: boolean
  ): void {
    if (counted) this.repo.incrementAttempts(id);
    this.repo.setResult(id, result, message);
    this.repo.updateCheckTimestamps(id, checkedAt, nextCheck);
    this.changed(id);
  }

  private usesGate(provider: SnipeProvider, mode: string, requested: boolean | undefined): boolean {
    if (!requested || provider.manifest.capabilities.accessGate !== true || !provider.access) {
      return false;
    }
    const descriptor = provider.manifest.releaseModes?.find((m) => m.id === mode);
    return descriptor?.usesAccessGate !== false;
  }

  /**
   * What create and update work out with the provider: the release mode is supported, the
   * dates are good where the provider is, the stay fields (with defaults), the release
   * instant (a scheduled one before check-in), whether the queue is used, and the poll cadence
   * (never below the floor).
   */
  private async prepare(
    provider: SnipeProvider,
    input: Pick<
      SiteSnipeInput,
      'releaseMode' | 'location' | 'stay' | 'stayParams' | 'accessGateEnabled' | 'pollIntervalMs'
    >,
    requestedAt: Date | undefined
  ): Promise<Prepared> {
    const { manifest, release } = provider;
    if (!release.supports(input.releaseMode)) {
      throw new AppError(
        'VALIDATION',
        `${manifest.shortName} does not support the release mode "${input.releaseMode}"`,
        { issues: ['releaseMode'] }
      );
    }
    this.assertStay(manifest.timezone, input.stay);
    const stayParams: StayParams = resolveStayParams(manifest, ['snipe', 'hold'], input.stayParams);

    let releaseAt: Date | undefined;
    try {
      const at = await release.computeReleaseAt({
        mode: input.releaseMode,
        externalId: input.location.externalId,
        stay: toStayQuery(
          {
            ...input.stay,
            children: input.stay.children ?? 0,
            infants: input.stay.infants ?? 0,
            concessions: input.stay.concessions ?? 0,
          },
          stayParams
        ),
        params: stayParams,
        requestedAt,
        now: this.clock(),
      });
      releaseAt = at ?? undefined;
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'provider') {
        throw new AppError('VALIDATION', error.message, { issues: ['releaseAt'] });
      }
      throw error;
    }
    // A scheduled release is the person's own time: it must come before check-in day starts
    // where the provider is (the form's rule, checked here too)
    if (
      input.releaseMode === SnipeReleaseMode.SCHEDULED &&
      releaseAt &&
      compareDates(todayIn(manifest.timezone, releaseAt), input.stay.arrival) >= 0
    ) {
      throw new AppError('VALIDATION', 'The release must be before check-in', {
        issues: ['releaseAt'],
      });
    }

    const continuous = input.releaseMode === SnipeReleaseMode.CANCELLATION;
    const floor = continuous ? release.pollFloorMs.continuous : release.pollFloorMs.window;
    return {
      stayParams,
      releaseAt,
      accessGateEnabled: this.usesGate(provider, input.releaseMode, input.accessGateEnabled),
      pollIntervalMs: Math.max(input.pollIntervalMs ?? DEFAULT_SNIPE_POLL_INTERVAL_MS, floor),
    };
  }

  /** Calendar dates, arrival today or later where the provider is, departure after arrival. */
  private assertStay(timeZone: string, stay: StayInput): void {
    const { arrival, departure } = stay;
    if (!isCalendarDate(arrival) || !isCalendarDate(departure)) {
      throw new AppError('VALIDATION', 'Dates must be calendar dates (YYYY-MM-DD)', {
        issues: ['stay'],
      });
    }
    if (compareDates(arrival, todayIn(timeZone, this.clock())) < 0) {
      throw new AppError('VALIDATION', 'Arrival date must be today or in the future', {
        issues: ['stay.arrival'],
      });
    }
    if (compareDates(departure, arrival) <= 0) {
      throw new AppError('VALIDATION', 'Departure date must be after arrival date', {
        issues: ['stay.departure'],
      });
    }
  }

  /** Before the release: the snipe's own release time, or the provider says the dates are not open. */
  private beforeRelease(snipe: SiteSnipe, availability: LocationAvailability, now: Date): boolean {
    if (snipe.releaseAt && now < snipe.releaseAt) return true;
    return availability.release?.open === false;
  }
}
