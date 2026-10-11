/**
 * One booking per night (DBCA terms; architecture-notes §12.4, §12.31): before a snipe or an
 * auto-hold watch asks a provider for a hold, it reserves the stay's nights here.
 *
 * A reservation conflicts with any of these that shares a night with the stay, for the same
 * provider and user (the owner itself excepted):
 * - a BOOKED snipe, or a HELD snipe whose hold has not expired;
 * - a booked watch, or a watch whose auto-hold placed a hold that has not expired
 *   (`last_result 'held'` and `hold_expires_at`, migration v9);
 * - a hold still in flight (reserved here, not answered yet).
 *
 * `tryReserve` is synchronous, so in the single-threaded main process the check and the
 * reservation are one step: two holds for the same nights cannot both pass. The caller
 * releases the reservation once the provider has answered; a placed hold is in the database
 * by then and keeps blocking from there. A conflict with a hold still in flight is reported
 * as transient: that hold may fail, so the other caller tries again later.
 */

import type { ProviderId } from '@shared/types/provider.types';
import type { SiteSniperRepository, WatchRepository } from '../../database/repositories';

/** Who wants the hold. */
export interface HoldOwner {
  kind: 'snipe' | 'watch';
  id: number;
}

export interface NightRequest {
  providerId: ProviderId;
  userId: number;
  /** Calendar dates `YYYY-MM-DD`. */
  arrival: string;
  departure: string;
  owner: HoldOwner;
}

export interface Reservation {
  /** Lets go of the nights. Safe to call more than once. */
  release(): void;
}

/**
 * The nights were reserved, or are taken: by a hold or booking (`transient: false`, final), or
 * only by a hold still being placed (`transient: true`), which may yet fail: try again later.
 */
export type ReserveResult =
  { ok: true; reservation: Reservation } | { ok: false; reason: string; transient: boolean };

export const NIGHT_CONFLICT_MESSAGE =
  'Another hold or booking covers these nights (one booking per night)';

export const NIGHT_PENDING_MESSAGE =
  'Another hold for these nights is being placed; trying again (one booking per night)';

function overlaps(a: { arrival: string; departure: string }, b: typeof a): boolean {
  return a.arrival < b.departure && b.arrival < a.departure;
}

export class NightGuard {
  private readonly pending = new Set<NightRequest>();

  constructor(
    private readonly snipes: Pick<SiteSniperRepository, 'findHeldOverlapping'>,
    private readonly watches: Pick<WatchRepository, 'findHeldOverlapping'>,
    private readonly clock: () => Date = () => new Date()
  ) {}

  /** Reserves the request's nights, or says why they are taken. */
  tryReserve(request: NightRequest): ReserveResult {
    const { providerId, userId, arrival, departure, owner } = request;
    const self = (kind: HoldOwner['kind']): number | undefined =>
      owner.kind === kind ? owner.id : undefined;

    const now = this.clock();
    const held =
      this.snipes.findHeldOverlapping(providerId, userId, arrival, departure, now, self('snipe'))
        .length > 0 ||
      this.watches.findHeldOverlapping(providerId, userId, arrival, departure, now, self('watch'))
        .length > 0;
    if (held) return { ok: false, reason: NIGHT_CONFLICT_MESSAGE, transient: false };

    const pending = [...this.pending].some(
      (other) =>
        other.providerId === providerId &&
        other.userId === userId &&
        !(other.owner.kind === owner.kind && other.owner.id === owner.id) &&
        overlaps(other, request)
    );
    if (pending) return { ok: false, reason: NIGHT_PENDING_MESSAGE, transient: true };

    const entry = { ...request };
    this.pending.add(entry);
    return { ok: true, reservation: { release: () => void this.pending.delete(entry) } };
  }
}
