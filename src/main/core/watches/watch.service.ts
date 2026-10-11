/**
 * Watches: recurring availability checks for a stay at one location of one provider.
 *
 * Every provider comes from the registry (`watches` capability), so a new provider needs no
 * change here. One check is one `availability.check`; full and partial matches come from
 * that one answer (`matching.ts`). Each check persists when the watch is next due
 * (`next-check.ts`); the scheduler's due-loop only reads it.
 *
 * Auto-hold (PQ4, architecture-notes §12.4): on a full match, a watch with `autoHold` places
 * one hold on the first matching unit through `provider.holds`, behind the same
 * one-booking-per-night guard as snipes, and stops. Payment stays a human step.
 *
 * `execute` never throws for a failed check (only `NOT_FOUND`); after its `signal` aborts it
 * writes nothing, except a hold the provider already placed.
 */

import {
  type AccountStatus,
  type ApiErrorCode,
  type Watch,
  type WatchExecutionResult,
  type WatchHold,
  type WatchInput,
  type WatchListFilter,
  type WatchMatch,
  type WatchUpdate,
} from '@shared/types';
import type { EventSink } from '@shared/contracts/events';
import { WatchResult } from '@shared/types/common.types';
import type { StayFieldUse } from '@shared/types/provider.types';
import { toStayQuery, type StayInput } from '@shared/types/stay.types';
import { compareDates, isCalendarDate, todayIn } from '@shared/utils/calendar-date';
import type { WatchRepository } from '../../database/repositories';
import type { ProviderRegistry, ProviderWith } from '../../providers/registry';
import { isAbortError, ProviderCapabilityError, toApiError } from '../../providers/sdk/errors';
import type { HoldSuccess } from '../../providers/sdk/provider';
import { AppError } from '../../utils/app-error';
import { logger } from '../../utils/logger';
import type { NightGuard } from '../holds/night-guard';
import type { NotificationService } from '../notifications/notification.service';
import { resolveStayParams } from '../stay-params';
import { fullMatches, partialMatches, wantedUnits } from './matching';
import { effectiveIntervalMinutes, nextCheckAt } from './next-check';

const log = logger.child({ module: 'watches' });

/** The provider a watch runs on: one with availability. */
export type WatchProvider = ProviderWith<'watches'>;

export type WatchNotifications = Pick<
  NotificationService,
  'notifyWatchFound' | 'notifyWatchPartialFound' | 'notifyWatchHeld'
>;

export interface WatchServiceDeps {
  watches: WatchRepository;
  providers: ProviderRegistry;
  notifications: WatchNotifications;
  nightGuard: NightGuard;
  /** `watch:updated` after every change. */
  events?: EventSink;
  /** The provider account's sign-in state (`provider_accounts.status` until V6). */
  accountState?: (providerId: string) => AccountStatus['state'];
  clock?: () => Date;
  /** For the jitter; returns [0, 1). */
  random?: () => number;
}

export interface WatchRunOptions {
  signal?: AbortSignal;
  /** A person asked for this run ("Check now"): it runs even when the watch is inactive. */
  manual?: boolean;
}

/** The stay fields that apply to a watch, and to its holds when it auto-holds. */
function stayFieldUses(autoHold: boolean): StayFieldUse[] {
  return autoHold ? ['watch', 'hold'] : ['watch'];
}

function needsAccountForHolds(requirement: string): boolean {
  return requirement === 'required' || requirement === 'required-for-holds';
}

export class WatchService {
  private readonly repo: WatchRepository;
  private readonly providers: ProviderRegistry;
  private readonly notifications: WatchNotifications;
  private readonly nightGuard: NightGuard;
  private readonly events?: EventSink;
  private readonly accountState: (providerId: string) => AccountStatus['state'];
  private readonly clock: () => Date;
  private readonly random: () => number;

  constructor(deps: WatchServiceDeps) {
    this.repo = deps.watches;
    this.providers = deps.providers;
    this.notifications = deps.notifications;
    this.nightGuard = deps.nightGuard;
    this.events = deps.events;
    this.accountState = deps.accountState ?? (() => 'unknown');
    this.clock = deps.clock ?? (() => new Date());
    this.random = deps.random ?? Math.random;
  }

  /**
   * Creates a watch. Throws `ProviderCapabilityError` (`CAPABILITY`) when the provider has no
   * watches, or no holds for `autoHold`; `UnknownProviderError` for an unknown provider. The
   * new watch is due at once.
   */
  async create(userId: number, input: WatchInput): Promise<Watch> {
    const provider = this.providers.require(input.providerId, 'watches');
    this.assertAutoHold(provider, input.autoHold);
    this.assertStay(provider, input.stay);
    const prepared: WatchInput = {
      ...input,
      stayParams: resolveStayParams(
        provider.manifest,
        stayFieldUses(input.autoHold === true),
        input.stayParams
      ),
    };
    const watch = this.repo.create(userId, prepared);
    this.repo.setNextCheckAt(watch.id, this.clock());
    return this.changed(watch.id);
  }

  async get(id: number): Promise<Watch | null> {
    return this.repo.findById(id);
  }

  async list(userId: number, filter: WatchListFilter = {}): Promise<Watch[]> {
    return this.repo.findByUserId(userId, filter);
  }

  /**
   * Updates a watch. A change to what is checked (location, stay, units, stay fields) or to
   * the interval makes it due at once.
   */
  async update(id: number, updates: WatchUpdate): Promise<Watch> {
    const watch = this.require(id);
    const provider = this.providers.require(watch.providerId, 'watches');
    const autoHold = updates.autoHold ?? watch.autoHold;
    if (updates.autoHold !== undefined) this.assertAutoHold(provider, updates.autoHold);
    if (updates.stay) this.assertStay(provider, updates.stay);
    const prepared: WatchUpdate = { ...updates };
    if (updates.stayParams !== undefined || updates.autoHold !== undefined) {
      prepared.stayParams = resolveStayParams(
        provider.manifest,
        stayFieldUses(autoHold),
        updates.stayParams ?? watch.stayParams
      );
    }
    this.repo.update(id, prepared);
    const reschedule =
      updates.location !== undefined ||
      updates.stay !== undefined ||
      updates.unitIds !== undefined ||
      updates.stayParams !== undefined ||
      updates.checkIntervalMinutes !== undefined;
    if (reschedule) this.repo.setNextCheckAt(id, this.clock());
    return this.changed(id);
  }

  /** Deletes a watch; `watch:updated` carries its last state once more. */
  async delete(id: number): Promise<boolean> {
    const last = this.repo.findById(id);
    const deleted = this.repo.deleteById(id);
    if (deleted && last) this.events?.emit('watch:updated', { ...last, isActive: false });
    return deleted;
  }

  /**
   * Activates a watch, due at once. A watch whose auto-hold placed a hold, or whose hold was
   * paid for, is refused: it would hold the same nights again.
   */
  async activate(id: number): Promise<void> {
    const watch = this.require(id);
    if (watch.lastResult === WatchResult.HELD || watch.lastResult === WatchResult.BOOKED) {
      throw new AppError(
        'VALIDATION',
        watch.lastResult === WatchResult.HELD
          ? 'This watch already placed a hold; create a new watch to look again'
          : 'This watch is already booked; create a new watch to look again'
      );
    }
    this.repo.activate(id, this.clock());
    this.changed(id);
  }

  async deactivate(id: number): Promise<void> {
    this.require(id);
    this.repo.deactivate(id);
    this.changed(id);
  }

  /** Active watches of these providers due at `now`, the longest overdue first. */
  findDue(now: Date, providerIds: readonly string[]): Watch[] {
    return this.repo.findDue(now, providerIds);
  }

  getActiveWatches(): Watch[] {
    return this.repo.findActive();
  }

  /** Moves when the watch is next due (the scheduler's startup stagger). */
  deferTo(id: number, at: Date): void {
    this.repo.setNextCheckAt(id, at);
  }

  /** Marks a watch whose provider is not registered as in error (`UNKNOWN_PROVIDER`). */
  markUnknownProvider(id: number): void {
    this.repo.setLastResult(id, WatchResult.ERROR);
    this.changed(id);
  }

  /**
   * One check: availability, matches, notifications and (auto-hold) a hold. Persists the
   * result and when the watch is next due, and returns what it found.
   */
  async execute(watchId: number, options: WatchRunOptions = {}): Promise<WatchExecutionResult> {
    const { signal, manual = false } = options;
    const checkedAt = this.clock();
    const result = (extra: Partial<WatchExecutionResult>): WatchExecutionResult => ({
      watchId,
      success: false,
      found: false,
      matches: [],
      checkedAt,
      ...extra,
    });
    // Stopped (quit) before it started, possibly queued behind the provider's limit: it
    // reads nothing, since the database may be about to close.
    if (signal?.aborted) return result({ error: 'The check was stopped' });

    const watch = this.require(watchId);
    if (!watch.isActive && !manual) return result({ error: 'The watch is not active' });

    const registered = this.providers.tryGet(watch.providerId);
    if (
      !registered ||
      registered.manifest.capabilities.watches !== true ||
      !registered.availability
    ) {
      const errorCode: ApiErrorCode = registered ? 'CAPABILITY' : 'UNKNOWN_PROVIDER';
      log.warn(`Watch ${watchId}: ${errorCode} (${watch.providerId})`);
      const error = `${watch.providerId} cannot run watches`;
      this.recordFailure(watch, checkedAt, { limits: registered?.manifest.limits }, error);
      return result({ error, errorCode });
    }
    const provider = registered as WatchProvider;
    const { manifest } = provider;
    const nextCheck = (): Date =>
      nextCheckAt(
        checkedAt,
        effectiveIntervalMinutes(watch.checkIntervalMinutes, manifest),
        this.random
      );

    try {
      // A row whose dates could not be read as calendar dates is marked in error, not run
      const { arrival, departure } = watch.stay;
      if (!isCalendarDate(arrival) || !isCalendarDate(departure)) {
        throw new Error('The watch dates are not calendar dates (YYYY-MM-DD)');
      }

      // The stay has begun where the provider is: nothing left to watch
      if (compareDates(arrival, todayIn(manifest.timezone, checkedAt)) < 0) {
        this.repo.deactivate(watchId);
        this.emitChanged(watchId);
        return result({ expired: true, error: 'The arrival date has passed' });
      }

      // One request: every unit, night by night. Wanted units are picked here, by id, name
      // or an earlier id the provider recognises (`knownUnitIds` → `aliases`).
      const availability = await provider.availability.check(
        watch.location.externalId,
        toStayQuery(watch.stay, watch.stayParams),
        { signal, ...(watch.unitIds.length > 0 ? { knownUnitIds: [...watch.unitIds] } : {}) }
      );
      if (signal?.aborted) return result({ error: 'The check was stopped' });

      const units = wantedUnits(watch, availability.units);
      const full = fullMatches(watch, units);
      const partial =
        full.length === 0 && watch.allowPartialMatch ? partialMatches(watch, units) : [];
      const matches = full.length > 0 ? full : partial;
      const resultType =
        full.length > 0
          ? WatchResult.FOUND
          : partial.length > 0
            ? WatchResult.PARTIAL_FOUND
            : WatchResult.NOT_FOUND;

      this.repo.recordRun(watchId, {
        result: resultType,
        found: matches.length > 0,
        checkedAt,
        nextCheckAt: nextCheck(),
        availability: units,
      });

      let hold: WatchHold | undefined;
      if (full.length > 0) {
        const outcome = watch.autoHold
          ? await this.autoHold(watch, provider, full[0], signal)
          : { note: undefined };
        hold = outcome.hold;
        // An automatic hold that was not placed says why (the run itself succeeded)
        if (!hold && outcome.note) this.repo.setLastError(watchId, outcome.note);
        if (hold) {
          await this.notifications.notifyWatchHeld(watch, hold, full[0].unitName);
        } else {
          if (signal?.aborted) return result({ error: 'The check was stopped' });
          await this.notifications.notifyWatchFound(watch, full, outcome.note);
          if (watch.notifyOnly) this.repo.deactivate(watchId);
        }
      } else if (partial.length > 0) {
        await this.notifications.notifyWatchPartialFound(watch, partial);
        if (watch.notifyOnly) this.repo.deactivate(watchId);
      }

      this.emitChanged(watchId);
      return {
        watchId,
        success: true,
        found: matches.length > 0,
        matches,
        ...(hold ? { hold } : {}),
        checkedAt,
      };
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        return result({ error: 'The check was stopped' });
      }
      const { code, message } = toApiError(error);
      // A provider behind its queue is an error for this run: watches never wait in a queue.
      log.warn(`Watch ${watchId} check failed: ${code} ${message}`);
      this.repo.recordRun(watchId, {
        result: WatchResult.ERROR,
        found: false,
        checkedAt,
        nextCheckAt: nextCheck(),
        error: message,
      });
      this.emitChanged(watchId);
      return result({ error: message, errorCode: code });
    }
  }

  // ---- internal helpers -------------------------------------------------------

  private require(id: number): Watch {
    const watch = this.repo.findById(id);
    if (!watch) throw new AppError('NOT_FOUND', 'Watch not found');
    return watch;
  }

  /**
   * Emits `watch:updated` with the stored watch, if it is still there: a check can finish
   * after its watch was deleted.
   */
  private emitChanged(id: number): void {
    const watch = this.repo.findById(id);
    if (watch) this.events?.emit('watch:updated', watch);
  }

  /** Emits `watch:updated` with the stored watch, and returns it. */
  private changed(id: number): Watch {
    const watch = this.repo.findById(id);
    if (!watch) throw new AppError('NOT_FOUND', 'Watch not found');
    this.events?.emit('watch:updated', watch);
    return watch;
  }

  private assertAutoHold(provider: WatchProvider, autoHold: boolean | undefined): void {
    if (autoHold && provider.manifest.capabilities.holds !== true) {
      throw new ProviderCapabilityError(provider.manifest.id, 'holds');
    }
  }

  /** Calendar dates, arrival today or later where the provider is, departure after arrival. */
  private assertStay(provider: WatchProvider, stay: StayInput): void {
    const { arrival, departure } = stay;
    if (!isCalendarDate(arrival) || !isCalendarDate(departure)) {
      throw new AppError('VALIDATION', 'Dates must be calendar dates (YYYY-MM-DD)', {
        issues: ['stay'],
      });
    }
    if (compareDates(arrival, todayIn(provider.manifest.timezone, this.clock())) < 0) {
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

  /** A run that could not check (no such provider): an error, due again after the interval. */
  private recordFailure(
    watch: Watch,
    checkedAt: Date,
    manifest: Parameters<typeof effectiveIntervalMinutes>[1],
    error: string
  ): void {
    this.repo.recordRun(watch.id, {
      result: WatchResult.ERROR,
      found: false,
      error,
      checkedAt,
      nextCheckAt: nextCheckAt(
        checkedAt,
        effectiveIntervalMinutes(watch.checkIntervalMinutes, manifest),
        this.random
      ),
    });
    this.emitChanged(watch.id);
  }

  /**
   * Places the auto-hold on `match`'s unit, or says (as a sentence for the found notification)
   * why it did not.
   */
  private async autoHold(
    watch: Watch,
    provider: WatchProvider,
    match: WatchMatch,
    signal: AbortSignal | undefined
  ): Promise<{ hold?: WatchHold; note?: string }> {
    const { manifest } = provider;
    const signInNote = `Sign in to ${manifest.shortName} to enable automatic holds`;
    if (!provider.holds || manifest.capabilities.holds !== true) {
      return { note: `${manifest.shortName} cannot hold sites automatically` };
    }
    if (
      needsAccountForHolds(manifest.capabilities.account) &&
      this.accountState(watch.providerId) !== 'signed-in'
    ) {
      return { note: signInNote };
    }

    const reserved = this.nightGuard.tryReserve({
      providerId: watch.providerId,
      userId: watch.userId,
      arrival: watch.stay.arrival,
      departure: watch.stay.departure,
      owner: { kind: 'watch', id: watch.id },
    });
    if (!reserved.ok) {
      log.info(`Watch ${watch.id}: no automatic hold, ${reserved.reason}`);
      return {
        note: reserved.transient
          ? 'Not held automatically: another hold for these nights is being placed'
          : `Not held automatically: ${reserved.reason}`,
      };
    }

    try {
      const hold = await provider.holds.create(
        {
          externalId: watch.location.externalId,
          unitId: match.unitId,
          stay: toStayQuery(watch.stay, watch.stayParams),
        },
        signal
      );
      if (!hold.ok) {
        log.info(`Watch ${watch.id}: automatic hold refused (${hold.reason})`);
        return {
          note:
            hold.reason === 'auth-required'
              ? signInNote
              : `Automatic hold failed: ${hold.message || hold.reason}`,
        };
      }
      // A placed hold is recorded even when the run was stopped meanwhile: it exists now.
      const placed: WatchHold = this.toWatchHold(provider, hold, match);
      try {
        this.repo.markHeld(watch.id, {
          reference: placed.reference,
          expiresAt: hold.expiresAt,
          unitId: placed.unitId,
          paymentUrl: placed.paymentUrl,
        });
      } catch (error) {
        log.error(`Watch ${watch.id}: hold ${placed.reference} placed but not recorded`, error);
      }
      return { hold: placed };
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
      const { message } = toApiError(error);
      return { note: `Automatic hold failed: ${message}` };
    } finally {
      reserved.reservation.release();
    }
  }

  private toWatchHold(provider: WatchProvider, hold: HoldSuccess, match: WatchMatch): WatchHold {
    return {
      reference: hold.reference,
      expiresAt: hold.expiresAt.toISOString(),
      unitId: hold.unitId ?? match.unitId,
      paymentUrl: provider.holds?.paymentUrl(hold) ?? provider.manifest.website,
    };
  }
}
