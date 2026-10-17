/**
 * Site Sniper: automated attempts to catch a high-demand unit the moment it is released.
 *
 * Every provider comes from the registry (`snipes` capability: availability and a release
 * policy; holds are optional, §12.35), and the release and queue rules come from the provider:
 * - `release.supports(mode)` and `release.computeReleaseAt(...)` decide when a stay opens;
 * - `release.pollFloorMs` is the fastest the core may poll, and a mode's `maxWindowMinutes`
 *   the longest a snipe keeps trying after the release;
 * - the access gate (`provider.access`) is used only when the snipe asks for it, the provider
 *   has one (`capabilities.accessGate`) and the release mode uses it.
 *
 * Each snipe has an `action` (default: `hold` when the provider has holds, else `alert`). One
 * attempt (`execute`) checks availability. The unit is the first fully available one, in a stay
 * the provider's stay rules allow (`freeForStay`), of those the snipe names (`unitIds`, filtered
 * by the provider), or else of its stay types (`unitKinds`; none: any kind). Then:
 * - `alert`: the snipe is ALERTED with what was free, when, and the provider's booking page
 *   (`SiteSnipe.alert`), and the person gets a desktop alert and email with the link. Nothing is
 *   held and no night is reserved; no sign-in is ever needed.
 * - `hold`: one-booking-per-night guard → `holds.create`. On a hold the snipe is HELD with the
 *   provider's reference, expiry, unit and payment URL, and stops. Payment stays a human step.
 *   It alerts instead, with a note, when the provider has no holds (any more), or when it names
 *   no units and its candidates are of more than one kind (`kindsAmbiguous`): it never picks
 *   between a campsite and a cabin for the person.
 *
 * A provider that turns the check (or the hold) away with a 403 or 429 (`isProviderBlock`) ends
 * the snipe FAILED with the reason: nothing tries again by itself (§12.35). The scheduler
 * (`scheduler/snipe-runner.ts`) owns the timing; this service owns the state and every write.
 *
 * Accounts (§12.32): for a provider whose holds need an account (`required-for-holds` or
 * `required`), a `hold` snipe is created paused while signed out, `activate` is
 * `AUTH_REQUIRED` until the account is signed in, and an attempt fails as "Sign in to …" when
 * the stored state is not signed in. An `alert` snipe never waits for a sign-in. ParkStay's
 * account is optional, so none of this applies to it.
 */

import {
  SiteSnipe,
  SiteSnipeInput,
  SiteSnipeUpdate,
  SnipeExecutionResult,
  type LocationAvailability,
  type SnipeAction,
  type SnipeAlert,
  type SnipeListFilter,
  type StayInput,
  type StayParams,
  type StayQuery,
  type UnitAvailability,
} from '@shared/types';
import type { EventSink } from '@shared/contracts/events';
import { SnipeResult, SnipeReleaseMode, SnipeStatus } from '@shared/types/common.types';
import { toStayQuery } from '@shared/types/stay.types';
import { compareDates, isCalendarDate, todayIn } from '@shared/utils/calendar-date';
import { cleanUnitKinds, isUnitKind } from '@shared/utils/unit-kinds';
import { DEFAULT_SNIPE_POLL_INTERVAL_MS, DEFAULT_SNIPE_WINDOW_MS } from '@shared/constants';
import type { SiteSniperRepository } from '../../database/repositories';
import type { ProviderRegistry, ProviderWith } from '../../providers/registry';
import {
  AccessGateError,
  isAbortError,
  isProviderBlock,
  ProviderError,
  toApiError,
} from '../../providers/sdk/errors';
import type { AccessGate, HoldsModule } from '../../providers/sdk/provider';
import { AppError } from '../../utils/app-error';
import { logger } from '../../utils/logger';
import type { AccountGate } from '../accounts/ports';
import { firstBookingLink } from '../booking-link';
import type { NightGuard } from '../holds/night-guard';
import type { NotificationService } from '../notifications/notification.service';
import { resolveStayParams } from '../stay-params';
import { freeForStay, kindsAmbiguous, wantedUnits } from '../watches/matching';

const log = logger.child({ module: 'sitesniper' });

/**
 * Why a hold snipe that names no units alerted instead of holding: the units it could hold
 * (those of its stay types, or every unit), booked or free, are of more than one stay type.
 */
const MIXED_KINDS_ERROR =
  'The units this snipe could hold are of more than one stay type: choose one stay type or units for it';

/** The provider a snipe runs on: availability and a release policy (maybe holds and a queue). */
export type SnipeProvider = ProviderWith<'snipes'>;

/** Statuses a snipe never leaves on its own: nothing is armed for them. */
export const TERMINAL_SNIPE_STATUSES: ReadonlySet<SnipeStatus> = new Set([
  SnipeStatus.HELD,
  SnipeStatus.BOOKED,
  SnipeStatus.ALERTED,
  SnipeStatus.FAILED,
  SnipeStatus.EXPIRED,
  SnipeStatus.DISABLED,
]);

/** Why a `hold` snipe alerted: its provider places no holds (or no longer does). */
export function holdsOffNote(shortName: string): string {
  return `Automatic holds are off for ${shortName}, so Site Sniper alerted you instead.`;
}

/** Why a snipe stopped when its provider turned it away (`isProviderBlock`). */
export function blockedMessage(shortName: string, status: number): string {
  return `${shortName} refused the check (HTTP ${status}). Site Sniper stopped and won't try again by itself.`;
}

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

export type SnipeNotifications = Pick<NotificationService, 'notifySnipeHeld' | 'notifySnipeAlert'>;

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

/**
 * The provider's holds, when it places them: `capabilities.holds` on and the module there.
 * Without them a snipe alerts (§12.35).
 */
function holdsOf(provider: SnipeProvider): HoldsModule | undefined {
  return provider.manifest.capabilities.holds === true ? provider.holds : undefined;
}

/**
 * The longest window the release mode allows (`maxWindowMinutes`), in ms, or undefined for no
 * limit.
 */
function maxWindowMs(provider: SnipeProvider, mode: string): number | undefined {
  const minutes = provider.manifest.releaseModes?.find((m) => m.id === mode)?.maxWindowMinutes;
  return minutes === undefined ? undefined : minutes * 60_000;
}

/** `windowMs` within the release mode's limit. */
function clampWindow(provider: SnipeProvider, mode: string, windowMs: number): number {
  const max = maxWindowMs(provider, mode);
  return max === undefined ? windowMs : Math.min(windowMs, max);
}

export interface SnipeRunOptions {
  signal?: AbortSignal;
  /** A person asked for this attempt ("Run now"): it runs before the release too. */
  manual?: boolean;
}

/** The fields create and update work out with the provider. */
type Prepared = Pick<
  SiteSnipeInput,
  'stayParams' | 'releaseAt' | 'accessGateEnabled' | 'pollIntervalMs' | 'windowDurationMs'
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
   * fields, a release time the provider cannot work out (a scheduled release needs one,
   * before check-in), or `hold` on a provider without holds. The action defaults to `hold`
   * when the provider has holds, else `alert`; the window is clamped to the mode's limit.
   */
  async create(userId: number, input: SiteSnipeInput): Promise<SiteSnipe> {
    const provider = this.providers.require(input.providerId, 'snipes');
    const action = input.action ?? (holdsOf(provider) ? 'hold' : 'alert');
    this.assertAction(provider, action);
    const unitKinds = cleanUnitKinds(input.unitKinds);
    const prepared = {
      action,
      unitKinds,
      ...(await this.prepare(provider, { ...input, unitKinds }, input.releaseAt)),
    };
    const signIn = action === 'hold' ? await this.signInNeeded(provider) : undefined;
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
   * Updates a snipe. A change to the release mode, location, stay, stay fields, units or stay
   * types, release time, queue choice, poll cadence or window is checked with the provider
   * again (as at create). The action cannot change once the snipe is HELD or BOOKED, and
   * `hold` needs a provider with holds (`VALIDATION` on `action`). A snipe switched to `hold`
   * while its provider's holds need a sign-in that is missing is saved paused, as `create` saves
   * a new one.
   */
  async update(id: number, updates: SiteSnipeUpdate): Promise<SiteSnipe> {
    const snipe = this.requireSnipe(id);
    let signIn: string | undefined;
    if (updates.action !== undefined && updates.action !== snipe.action) {
      if (snipe.status === SnipeStatus.HELD || snipe.status === SnipeStatus.BOOKED) {
        throw new AppError(
          'VALIDATION',
          snipe.status === SnipeStatus.HELD
            ? "This snipe already has a hold, so what it does can't change"
            : "This snipe is already booked, so what it does can't change",
          { issues: ['action'] }
        );
      }
      if (updates.action === 'hold') {
        const provider = this.providers.require(snipe.providerId, 'snipes');
        this.assertAction(provider, 'hold');
        signIn = await this.signInNeeded(provider);
      }
    }
    const affectsPlan =
      updates.releaseMode !== undefined ||
      updates.location !== undefined ||
      updates.stay !== undefined ||
      updates.stayParams !== undefined ||
      updates.unitIds !== undefined ||
      updates.unitKinds !== undefined ||
      updates.releaseAt !== undefined ||
      updates.accessGateEnabled !== undefined ||
      updates.pollIntervalMs !== undefined ||
      updates.windowDurationMs !== undefined;
    let prepared: Partial<Prepared> = {};
    if (affectsPlan) {
      const provider = this.providers.require(snipe.providerId, 'snipes');
      const merged: SiteSnipeInput = {
        providerId: snipe.providerId,
        name: updates.name ?? snipe.name,
        location: updates.location ?? snipe.location,
        stay: updates.stay ?? snipe.stay,
        stayParams: updates.stayParams ?? snipe.stayParams,
        unitIds: updates.unitIds ?? snipe.unitIds,
        unitKinds:
          updates.unitKinds !== undefined ? cleanUnitKinds(updates.unitKinds) : snipe.unitKinds,
        releaseMode: updates.releaseMode ?? snipe.releaseMode,
        accessGateEnabled: updates.accessGateEnabled ?? snipe.accessGateEnabled,
        pollIntervalMs: updates.pollIntervalMs ?? snipe.pollIntervalMs,
        windowDurationMs: updates.windowDurationMs ?? snipe.windowDurationMs,
      };
      // A scheduled release keeps its time unless a new one is given.
      const requestedAt = updates.releaseAt ?? snipe.releaseAt;
      prepared = await this.prepare(provider, merged, requestedAt);
    }
    const changes: SiteSnipeUpdate = {
      ...updates,
      ...(updates.unitKinds !== undefined ? { unitKinds: cleanUnitKinds(updates.unitKinds) } : {}),
      ...prepared,
    };
    // Saved paused, in one transaction: arming it waits for the sign-in (activate checks)
    if (signIn) this.repo.updatePaused(id, changes, signIn);
    else this.repo.update(id, changes);
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
   * second time. An ALERTED one may be, as it holds nothing: its alert is cleared.
   */
  async activate(id: number): Promise<void> {
    const snipe = this.requireSnipe(id);
    if (snipe.status === SnipeStatus.HELD || snipe.status === SnipeStatus.BOOKED) {
      throw new AppError(
        'VALIDATION',
        snipe.status === SnipeStatus.HELD
          ? 'This snipe already has a hold'
          : 'This snipe is already booked'
      );
    }
    // A hold snipe on a provider whose holds need an account: AUTH_REQUIRED, and nothing is
    // armed. An alert never waits for a sign-in.
    const provider = this.providers.tryGet(snipe.providerId);
    if (snipe.action === 'hold' && provider && needsAccountForHolds(provider) && this.accounts) {
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
   * when its provider is not registered or cannot snipe. The window is clamped to the release
   * mode's limit here too, for rows stored before it (or before the provider set it).
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
    const windowMs = clampWindow(snipes, snipe.releaseMode, snipe.windowDurationMs);
    return {
      provider: snipes,
      releaseAt,
      warmupAt: releaseAt && new Date(releaseAt.getTime() - snipe.leadTimeSeconds * 1000),
      windowEnd: releaseAt && new Date(releaseAt.getTime() + windowMs),
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
        unitIds: [...snipe.unitIds],
        unitKinds: [...snipe.unitKinds],
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
    if (!snipe) return outcome('done', SnipeResult.ERROR, { error: 'Snipe not found' });
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

      // Poll availability: the preferred units (the provider filters by id), or every unit,
      // of which the snipe's stay types are the candidates.
      const named = snipe.unitIds.length > 0;
      const availability = await provider.availability.check(externalId, stay, {
        unitIds: named ? snipe.unitIds : undefined,
        signal,
      });
      if (signal?.aborted) return stopped();
      const candidates = named
        ? availability.units
        : wantedUnits({ unitIds: [], unitKinds: snipe.unitKinds }, availability.units);
      // Free for the whole stay, and a stay the provider's stay rules allow
      const matched = candidates.find(freeForStay);
      const ofKinds =
        candidates.length < availability.units.length
          ? ` (${candidates.length} of its stay types)`
          : '';
      log.info(
        `Snipe ${snipeId} poll: ${availability.units.length} unit(s)${ofKinds}, ` +
          `${matched ? `unit ${matched.unitId} free` : 'none free'} — ${describeUnits(availability.units)}`
      );

      if (!matched) {
        const result = this.beforeRelease(snipe, availability, checkedAt)
          ? SnipeResult.TOO_EARLY
          : SnipeResult.UNAVAILABLE;
        this.recordAttempt(snipeId, result, undefined, checkedAt, nextCheck, true);
        return outcome('continue', result, { success: true });
      }

      // An alert snipe alerts; so does a hold snipe whose provider places no holds (or no
      // longer does), and one for "any unit" across stay types, which never picks one for the
      // person. None reserves a night.
      const holds = holdsOf(provider);
      if (snipe.action === 'alert') {
        return await this.alert(snipe, provider, availability, matched, undefined, checkedAt);
      }
      if (!holds) {
        const note = holdsOffNote(provider.manifest.shortName);
        return await this.alert(snipe, provider, availability, matched, note, checkedAt);
      }
      if (kindsAmbiguous(snipe, candidates)) {
        log.info(`Snipe ${snipeId}: no hold, its units are of more than one stay type`);
        const note = `${MIXED_KINDS_ERROR}.`;
        return await this.alert(snipe, provider, availability, matched, note, checkedAt);
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
        hold = await holds.create({ externalId, unitId: matched.unitId, stay }, signal);
      } finally {
        reserved.reservation.release();
      }

      if (hold.ok) {
        // Recorded even when the attempt was stopped meanwhile: the hold exists now.
        const paymentUrl = holds.paymentUrl(hold);
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
          // What the alert calls the held unit: its kind in the check, when it was in it
          const heldKind = availability.units.find((unit) => unit.unitId === unitId)?.unitKind;
          // The public booking page too, for booking away from this computer (brief R7)
          const bookingUrl = this.bookingLinkFor(provider, snipe, availability, unitId);
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
            },
            isUnitKind(heldKind) ? heldKind : undefined,
            bookingUrl
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
      if (isProviderBlock(error)) {
        // The provider turned WA Stay away (403, 429, a challenge): stop, say why, and never
        // try again by itself (§12.35).
        const blocked = blockedMessage(provider.manifest.shortName, error.status);
        log.warn(
          `Snipe ${snipeId}: ${provider.manifest.id} answered HTTP ${error.status}; stopped`
        );
        this.repo.incrementAttempts(snipeId);
        this.repo.finish(snipeId, SnipeStatus.FAILED, SnipeResult.ERROR, blocked);
        this.emitIfStored(snipeId);
        return outcome('done', SnipeResult.ERROR, { error: blocked });
      }
      log.error(`Snipe ${snipeId} execution failed: ${message}`);
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

  /**
   * The dates are free: the snipe is ALERTED with what was free, when, and the provider's
   * booking page (`note`: why it alerted instead of holding), and the person gets a desktop
   * alert and email. Nothing is held and no night is reserved. It is written before anything
   * is awaited, so an attempt stopped after the check writes nothing; a snipe deleted during
   * the attempt sends no alert.
   */
  private async alert(
    snipe: SiteSnipe,
    provider: SnipeProvider,
    availability: LocationAvailability,
    matched: UnitAvailability,
    note: string | undefined,
    checkedAt: Date
  ): Promise<SnipeOutcome> {
    const bookingUrl = this.bookingLinkFor(provider, snipe, availability, matched.unitId);
    const alert: SnipeAlert = {
      at: checkedAt,
      unitId: matched.unitId,
      ...(matched.unitName ? { unitName: matched.unitName } : {}),
      ...(bookingUrl ? { bookingUrl } : {}),
      ...(note ? { note } : {}),
    };
    this.repo.markAlerted(snipe.id, alert);
    const outcome: SnipeOutcome = {
      next: 'done',
      result: {
        snipeId: snipe.id,
        success: true,
        result: SnipeResult.ALERTED,
        held: false,
        checkedAt,
        matchedSiteId: matched.unitId,
      },
    };
    const stored = this.repo.findById(snipe.id);
    if (!stored) {
      log.info(`Snipe ${snipe.id} was deleted during its attempt; no alert sent`);
      return outcome;
    }
    log.info(
      `Snipe ${snipe.id}: unit ${matched.unitId} free; alerted${note ? ' instead of a hold' : ''}`
    );
    this.events?.emit('snipe:updated', stored);
    try {
      const kind = isUnitKind(matched.unitKind) ? matched.unitKind : undefined;
      await this.notifications.notifySnipeAlert(stored, kind);
    } catch (error) {
      log.error(`Snipe ${snipe.id}: alerted but not notified`, error);
    }
    return outcome;
  }

  /**
   * The provider's public booking page for the snipe's stay on `unitId`: the first of the
   * unit's own link, the check's link and `links.booking` that is a booking link of the
   * provider (https on its own site, `firstBookingLink`); none otherwise. Refusing a cart URL
   * is the provider's job.
   */
  private bookingLinkFor(
    provider: SnipeProvider,
    snipe: SiteSnipe,
    availability: LocationAvailability,
    unitId: string
  ): string | undefined {
    const stay: StayQuery = toStayQuery(snipe.stay, snipe.stayParams);
    let linked: string | null = null;
    try {
      linked = provider.links.booking(snipe.location.externalId, stay, unitId);
    } catch (error) {
      log.warn(
        `${provider.manifest.id}: links.booking failed: ${error instanceof Error ? error.name : 'error'}`
      );
    }
    return firstBookingLink(provider.manifest, [
      availability.units.find((unit) => unit.unitId === unitId)?.bookingUrl,
      availability.bookingUrl,
      linked,
    ]);
  }

  /** `snipe:updated` with the stored snipe, unless it was deleted meanwhile. */
  private emitIfStored(id: number): void {
    const snipe = this.repo.findById(id);
    if (snipe) this.events?.emit('snipe:updated', snipe);
  }

  /** `VALIDATION` on `action` for `hold` on a provider that places no holds. */
  private assertAction(provider: SnipeProvider, action: SnipeAction): void {
    if (action === 'hold' && !holdsOf(provider)) {
      throw new AppError(
        'VALIDATION',
        `${provider.manifest.shortName} can't hold automatically, so choose an alert`,
        { issues: ['action'] }
      );
    }
  }

  private requireSnipe(id: number): SiteSnipe {
    const snipe = this.repo.findById(id);
    if (!snipe) throw new AppError('NOT_FOUND', 'Snipe not found');
    return snipe;
  }

  /** Emits `snipe:updated` with the stored snipe, and returns it. */
  private changed(id: number): SiteSnipe {
    const snipe = this.repo.findById(id);
    if (!snipe) throw new AppError('NOT_FOUND', 'Snipe not found');
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
   * instant (a scheduled one before check-in; the provider is told the snipe's units or stay
   * types), whether the queue is used, the poll cadence (never below the floor) and the window
   * (never above the mode's `maxWindowMinutes`).
   */
  private async prepare(
    provider: SnipeProvider,
    input: Pick<
      SiteSnipeInput,
      | 'releaseMode'
      | 'location'
      | 'stay'
      | 'stayParams'
      | 'unitIds'
      | 'unitKinds'
      | 'accessGateEnabled'
      | 'pollIntervalMs'
      | 'windowDurationMs'
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
        unitIds: [...(input.unitIds ?? [])],
        unitKinds: [...(input.unitKinds ?? [])],
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
      windowDurationMs: clampWindow(
        provider,
        input.releaseMode,
        input.windowDurationMs ?? DEFAULT_SNIPE_WINDOW_MS
      ),
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
