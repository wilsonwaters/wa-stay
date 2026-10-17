/**
 * RAC bulk availability: Explore's free counts for a stay at every park. RAC has no all-parks
 * query, so `search` sends one availability POST per park (`availability.ts`), in the seed's
 * order (`parks.ts`), one after another (`ai-state/research/rac-booking-flow.md` §3, "Bulk").
 *
 * - **Pace.** Explore's dates are the person's own, so the core asks at interactive priority
 *   (`withRequestPriority` around `catalog.availability`) and the paced client sends each POST
 *   1 s after the one before ended (brief R8): eight parks in about 40–60 s. Nothing here sets
 *   a priority, and nothing else calls `search`. The POSTs go one at a time, so a place page's
 *   detail or check opened meanwhile waits for one POST at most, never for the whole search.
 * - **Counts** (RS12: free units, no total), from the same mapping as `check`, category by
 *   category (`unitsOf`):
 *   - `availableUnits`: the sum of `stay_through_sites_available` over the categories free for
 *     the whole stay (`fullyAvailable`); the others add nothing;
 *   - `bookableUnits`: left out while any category can be booked online for these dates at
 *     all, free or not (`isBookable`: a night `check` gives it that is neither closed nor not
 *     released), because RAC gives no total of physical sites; 0 when none can: every category
 *     closed or not released (beyond the 364-day window, a special date, a stop-sell), so
 *     Explore and the place page agree;
 *   - `byKind`: both, per unit kind (each category's `unitKind`, as `check` gives it), by the
 *     same rules, for every kind the park has (its seed's kinds and any its answer adds), with
 *     `availableUnits: 0` when none is free.
 * - **One park fails** (a 5xx such as RAC's 520, a timeout, no response, an answer that is no
 *   answer): it gets no entry, so Explore reads it as unknown; one warning names the park and
 *   the status, never the answer; the next park is asked. When every park fails, `search`
 *   rejects with the last error.
 * - **A block** (a 403, a 429 or Cloudflare's challenge, or RAC's cool-down after one, from
 *   `client.ts`) stops the search at once: nothing more is sent, and it rejects with the
 *   client's typed error. Nothing retries (terms rule 5).
 * - **An abort** (`signal`) stops it too: no further POST starts, and it rejects with an
 *   AbortError.
 * - **A newer search** (the person changed the dates or the party) stops the one before it,
 *   which sends nothing more and resolves with the parks it has. Its POST still waiting for
 *   its turn is called off; one already sent is left to finish (RAC is already working on it),
 *   so the newer search's first POST goes after it: never two at once on RAC's side (terms
 *   rule 4). The core's own abort (a deadline, quitting) still calls off a POST in flight.
 * - **A stay RAC's form cannot carry** (`stayRefusal`) rejects with a `ProviderError`, and
 *   nothing is sent.
 */

import {
  UNIT_KINDS,
  type BulkAvailabilityEntry,
  type StayQuery,
  type UnitAvailability,
  type UnitKind,
} from '@shared/types/provider.types';
import { makeLocationKey } from '@shared/utils/location-key';
import type { ProviderContext } from '../sdk/context';
import {
  createAbortError,
  isAbortError,
  ProviderError,
  ProviderHttpError,
  ProviderParseError,
  ProviderTimeoutError,
  throwIfAborted,
} from '../sdk/errors';
import { stayRefusal, type RacAvailability } from './availability';
import type { RawCategory } from './mapping';
import { RAC_PARKS, type RacPark } from './parks';

export interface RacBulkDeps {
  ctx: Pick<ProviderContext, 'id' | 'manifest' | 'logger'>;
  availability: Pick<RacAvailability, 'categories' | 'unitsOf'>;
}

/** A count from RAC as whole units: anything else is none. */
function wholeUnits(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Whether a category, as `check` gives it, can be booked online for the stay's dates at all,
 * free or not: one of its nights is neither closed nor not released.
 */
export function isBookable(unit: UnitAvailability): boolean {
  return unit.nights.some((night) => night.state !== 'closed' && night.state !== 'not-released');
}

interface Tally {
  free: number;
  bookable: boolean;
}

/** A tally as an entry's counts: no total while anything is bookable, else 0. */
function countsOf({ free, bookable }: Tally): { availableUnits: number; bookableUnits?: number } {
  return bookable ? { availableUnits: free } : { availableUnits: free, bookableUnits: 0 };
}

/**
 * The park's entry for the stay, from its categories and their units as `check` gives them
 * (`unitsOf`, the same order).
 */
export function parkEntry(
  providerId: string,
  park: RacPark,
  categories: readonly RawCategory[],
  units: readonly UnitAvailability[]
): BulkAvailabilityEntry {
  const kinds = new Map<UnitKind, Tally>(
    park.unitKinds.map((kind) => [kind, { free: 0, bookable: false }])
  );
  const all: Tally = { free: 0, bookable: false };
  categories.forEach((category, i) => {
    const unit = units[i];
    const free = unit.fullyAvailable ? wholeUnits(category.stay_through_sites_available) : 0;
    const bookable = isBookable(unit);
    const kind = unit.unitKind ?? 'other';
    const tally = kinds.get(kind) ?? { free: 0, bookable: false };
    kinds.set(kind, { free: tally.free + free, bookable: tally.bookable || bookable });
    all.free += free;
    all.bookable ||= bookable;
  });
  const byKind: NonNullable<BulkAvailabilityEntry['byKind']> = {};
  for (const kind of UNIT_KINDS) {
    const tally = kinds.get(kind);
    if (tally) byKind[kind] = countsOf(tally);
  }
  return { key: makeLocationKey(providerId, park.slug), ...countsOf(all), byKind };
}

/** A block from RAC's client: a 403 or 429, Cloudflare's challenge, or its cool-down. */
function isBlock(error: unknown): boolean {
  return error instanceof ProviderHttpError && (error.status === 403 || error.status === 429);
}

/** What went wrong at a park, for the log: a status or a kind, never the answer. */
function failureOf(error: ProviderError): string {
  if (error instanceof ProviderHttpError) {
    if (error.status > 0) return `HTTP ${error.status}`;
    return error.reason === 'network' ? 'no response' : `request ${error.reason}`;
  }
  if (error instanceof ProviderTimeoutError) return 'no answer in time';
  if (error instanceof ProviderParseError) return 'an answer it could not read';
  return error.code;
}

/** A search in progress: whether a newer one stopped it, and how to call off its unsent POST. */
interface Run {
  superseded: boolean;
  /** Calls off the POST in hand if it has not been sent yet; one already sent is left alone. */
  cancelUnsent?: () => void;
}

/** RAC's `availability.search`. */
export function createRacBulkSearch({
  ctx,
  availability,
}: RacBulkDeps): (stay: StayQuery, signal?: AbortSignal) => Promise<BulkAvailabilityEntry[]> {
  let current: Run | undefined;

  return async function search(stay, signal) {
    throwIfAborted(signal);
    const refusal = stayRefusal(stay);
    if (refusal) {
      throw new ProviderError({ providerId: ctx.id, message: `${ctx.manifest.name}: ${refusal}` });
    }
    // A newer search stops the one before it: one RAC search sends at a time (terms rule 4)
    if (current) {
      current.superseded = true;
      current.cancelUnsent?.();
    }
    const run: Run = { superseded: false };
    current = run;

    const entries: BulkAvailabilityEntry[] = [];
    let failures = 0;
    let lastError: ProviderError | undefined;
    try {
      for (const park of RAC_PARKS) {
        if (run.superseded) break;
        throwIfAborted(signal);
        // The POST's own abort: the caller's always, a newer search's only until it is sent
        const post = new AbortController();
        const onAbort = (): void => post.abort(signal?.reason);
        signal?.addEventListener('abort', onAbort, { once: true });
        let sent = false;
        run.cancelUnsent = () => {
          if (!sent) post.abort();
        };
        let categories: RawCategory[];
        try {
          categories = await availability.categories(park, stay, post.signal, () => {
            sent = true;
          });
        } catch (error) {
          if (run.superseded && !signal?.aborted) break;
          if (signal?.aborted) throw createAbortError(signal);
          if (isAbortError(error) || isBlock(error) || !(error instanceof ProviderError)) {
            throw error;
          }
          failures++;
          lastError = error;
          ctx.logger.warn(
            `Bulk availability: no answer for ${park.slug} (${failureOf(error)}); it reads as unknown`
          );
          continue;
        } finally {
          signal?.removeEventListener('abort', onAbort);
          run.cancelUnsent = undefined;
        }
        entries.push(
          parkEntry(ctx.id, park, categories, availability.unitsOf(park, stay, categories))
        );
      }
    } finally {
      if (current === run) current = undefined;
    }
    if (lastError && failures === RAC_PARKS.length) throw lastError;
    return entries;
  };
}
