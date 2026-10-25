/**
 * Stay Rottnest availability: a stay's room types at one precinct (`check`), and Explore's free
 * counts at every precinct (`search`), from **one** search for the island (`results-page.ts`,
 * `ai-state/research/rottnest-booking-flow.md` §11).
 *
 * - **One search, shared.** Every caller (a place page's check, Explore's bulk search, every
 *   watch) asks `searchOnce`: one search per stay and party, in flight once, and kept for
 *   `ROTTNEST_SEARCH_TTL_MS` after it answers, so ten watches of one stay cost one request
 *   (`ai-state/research/rottnest-terms.md` §9.3). A failed search is not kept.
 * - **A room type is a unit** (`unitId` its code), standing for every unit of that type: the
 *   page says whether at least one is free for the whole stay, never how many, so `freeCount`
 *   is 1 when free and 0 when not, and a count of free types is a lower bound.
 * - **Free** means the card is not marked unavailable, shows a price, and sleeps the party
 *   (adults, children and infants: Stay Rottnest counts everyone up to its `data-sleeps`). Its
 *   nights are all `available`; the price is the stay's `total`, never per night.
 * - **Not free** means its nights are `unknown`, labelled "Unavailable for these dates" (the
 *   page's whole-stay "no" can't say which night), or "Sleeps N at most" for too big a party.
 *   So a partial match never fires.
 * - **A type the search lacks** (the seed has it, the page doesn't) is `unknown` too, labelled
 *   "Not in Stay Rottnest's answer"; a card the seed lacks is logged once and left out.
 * - **Rates:** `RIA25` is "25% deposit when booked"; `CAMPING` and `HOSTS` are "Paid in full when
 *   booked" (T&Cs 7(b), 7(c)).
 * - **Links:** each unit's `bookingUrl`, and the answer's, is Stay Rottnest's search for the stay
 *   showing the precinct (`links.ts`), never the booking step.
 * - **No answer:** a page with no card is a `ProviderParseError`; a block or the Open Day pause
 *   is the client's error (`client.ts`). Nothing is retried.
 * - **Nothing asked for a stay that can't be booked** (`rules.ts`): one its booking rules
 *   refuse has every night `unknown`, labelled with the reason; one not on sale yet has every
 *   night `not-released` and `release: { open: false, opensAt }`. Explore's entry for such a
 *   place says so (`refused`, `opensAt`, `bookableUnits` 0), and when every place is one of
 *   them, the search is not sent at all.
 */

import type {
  BulkAvailabilityEntry,
  LocationAvailability,
  NightStatus,
  StayQuery,
  UnitAvailability,
  UnitKind,
} from '@shared/types/provider.types';
import { eachNight } from '@shared/utils/calendar-date';
import { makeLocationKey } from '@shared/utils/location-key';
import type { ProviderContext } from '../sdk/context';
import { createAbortError, ProviderError, ProviderParseError, throwIfAborted } from '../sdk/errors';
import type {
  AvailabilityCheckOptions,
  AvailabilityModule,
  StayRulesModule,
} from '../sdk/provider';
import type { RottnestClient } from './client';
import { searchUrl } from './links';
import {
  ROTTNEST_PRECINCTS,
  rottnestPrecinct,
  roomTypeOf,
  unitKindsOf,
  type RottnestPrecinct,
  type RottnestRoomType,
} from './precincts';
import { readResultsPage, type ResultsCard } from './results-page';
import { createRottnestRules, partyOf } from './rules';

/** How long one search's answer serves every caller: two minutes. */
export const ROTTNEST_SEARCH_TTL_MS = 2 * 60_000;

/** A rate's note, by Stay Rottnest's rate code. */
const RATE_NOTES: Readonly<Record<string, string>> = {
  RIA25: '25% deposit when booked',
  CAMPING: 'Paid in full when booked',
  HOSTS: 'Paid in full when booked',
};

/** One search's answer: the room types by code, and when it was read. */
export interface RottnestSearchResult {
  cards: Map<string, ResultsCard>;
  checkedAt: string;
}

/** The memo's key: what the search sends. */
function searchKey(stay: StayQuery): string {
  return [
    stay.arrival,
    stay.departure,
    stay.adults,
    (stay.children ?? 0) + (stay.infants ?? 0),
  ].join('|');
}

/**
 * Settles with `pending`, or rejects with an AbortError as soon as `signal` aborts (`pending`
 * still settles, for whoever else waits on it).
 */
function raceAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(createAbortError(signal));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

export interface RottnestAvailabilityDeps {
  ctx: ProviderContext;
  client: RottnestClient;
  /** Stay Rottnest's booking rules (default: `createRottnestRules()`). */
  rules?: StayRulesModule;
}

export interface RottnestAvailability extends Required<AvailabilityModule> {
  /** The shared search for `stay` (in flight once, kept for two minutes). */
  searchOnce(stay: StayQuery, signal?: AbortSignal): Promise<RottnestSearchResult>;
  /** Ends a search in flight (the provider is disposed). */
  dispose(): void;
}

export function createRottnestAvailability({
  ctx,
  client,
  rules = createRottnestRules(),
}: RottnestAvailabilityDeps): RottnestAvailability {
  const memo = new Map<string, { pending: Promise<RottnestSearchResult>; at?: number }>();
  const unknownCodes = new Set<string>();
  // Ends a shared request when the provider is disposed; a caller's own abort only stops its wait
  const lifetime = new AbortController();

  function searchOnce(stay: StayQuery, signal?: AbortSignal): Promise<RottnestSearchResult> {
    throwIfAborted(signal);
    const key = searchKey(stay);
    const now = ctx.clock().getTime();
    const kept = memo.get(key);
    if (kept && (kept.at === undefined || now - kept.at < ROTTNEST_SEARCH_TTL_MS)) {
      return raceAbort(kept.pending, signal);
    }
    const entry: { pending: Promise<RottnestSearchResult>; at?: number } = {
      pending: client.search(stay, { signal: lifetime.signal }).then((page) => {
        const cards = readResultsPage(page.body);
        if (!cards) {
          throw new ProviderParseError({
            providerId: ctx.id,
            url: page.url,
            message: `${ctx.manifest.name}'s search answered with no room types`,
          });
        }
        for (const code of cards.keys()) {
          if (!roomTypeOf(code) && !unknownCodes.has(code)) {
            unknownCodes.add(code);
            ctx.logger.warn(`Room type ${code} is not in the seed; left out (precincts.ts)`);
          }
        }
        return { cards, checkedAt: ctx.clock().toISOString() };
      }),
    };
    memo.set(key, entry);
    entry.pending.then(
      () => {
        entry.at = ctx.clock().getTime();
      },
      () => {
        if (memo.get(key) === entry) memo.delete(key);
      }
    );
    // Old answers go once they are stale, so the memo stays small
    for (const [other, value] of memo) {
      if (value.at !== undefined && now - value.at >= ROTTNEST_SEARCH_TTL_MS) memo.delete(other);
    }
    return raceAbort(entry.pending, signal);
  }

  function unitOf(
    precinct: RottnestPrecinct,
    type: RottnestRoomType,
    card: ResultsCard | undefined,
    stay: StayQuery
  ): UnitAvailability {
    const sleeps = card?.sleeps ?? type.sleeps;
    const fits = partyOf(stay) <= sleeps;
    const free = card !== undefined && !card.unavailable && card.price !== undefined && fits;
    const label = !card
      ? "Not in Stay Rottnest's answer"
      : !fits
        ? `Sleeps ${sleeps} at most`
        : 'Unavailable for these dates';
    const nights: NightStatus[] = eachNight(stay.arrival, stay.departure).map((date) =>
      free ? { date, state: 'available' } : { date, state: 'unknown', label }
    );
    const unit: UnitAvailability = {
      unitId: type.code,
      // The seed's name, so the place page and a check name a type alike
      unitName: type.name,
      unitKind: type.kind,
      nights,
      fullyAvailable: free,
      freeCount: free ? 1 : 0,
      bookingUrl: searchUrl(stay, precinct.group),
    };
    if (free && card?.price !== undefined) unit.total = card.price;
    const note = card?.rates.map((rate) => RATE_NOTES[rate]).find((text) => text !== undefined);
    if (free && note) unit.priceNote = note;
    return unit;
  }

  function unitsAt(precinct: RottnestPrecinct, result: RottnestSearchResult, stay: StayQuery) {
    return precinct.roomTypes.map((type) =>
      unitOf(precinct, type, result.cards.get(type.code), stay)
    );
  }

  /**
   * Why the stay can't be booked at the precinct, known without asking: its rules refuse it,
   * or it is not on sale yet. Undefined when it may be.
   */
  function heldBack(
    precinct: RottnestPrecinct,
    stay: StayQuery,
    unitIds?: string[]
  ): { refused: string } | { opensAt?: string } | undefined {
    const verdict = rules.check({
      externalId: precinct.slug,
      stay,
      ...(unitIds?.length ? { unitIds } : {}),
      now: ctx.clock(),
    });
    if (!verdict.ok) return { refused: verdict.reason };
    if (verdict.release && !verdict.release.open) {
      return verdict.release.opensAt ? { opensAt: verdict.release.opensAt } : {};
    }
    return undefined;
  }

  /** Each room type of a stay held back: no night free, and why. */
  function heldBackUnits(
    precinct: RottnestPrecinct,
    stay: StayQuery,
    why: { refused: string } | { opensAt?: string }
  ): UnitAvailability[] {
    return precinct.roomTypes.map((type) => ({
      unitId: type.code,
      unitName: type.name,
      unitKind: type.kind,
      nights: eachNight(stay.arrival, stay.departure).map((date): NightStatus =>
        'refused' in why
          ? { date, state: 'unknown', label: why.refused }
          : { date, state: 'not-released' }
      ),
      fullyAvailable: false,
      freeCount: 0,
      bookingUrl: searchUrl(stay, precinct.group),
    }));
  }

  return {
    searchOnce,

    async check(
      externalId: string,
      stay: StayQuery,
      options: AvailabilityCheckOptions = {}
    ): Promise<LocationAvailability> {
      const precinct = rottnestPrecinct(externalId);
      if (!precinct) {
        throw new ProviderError({
          providerId: ctx.id,
          message: `${ctx.manifest.name} has no precinct "${externalId}"`,
        });
      }
      const wanted = options.unitIds?.length ? new Set(options.unitIds) : undefined;
      const keep = (unit: UnitAvailability) => !wanted || wanted.has(unit.unitId);
      const key = makeLocationKey(ctx.id, precinct.slug);
      const bookingUrl = searchUrl(stay, precinct.group);
      const why = heldBack(precinct, stay, options.unitIds);
      if (why) {
        // Answered without asking; still settle after the caller could abort
        await Promise.resolve();
        throwIfAborted(options.signal);
        return {
          key,
          checkedAt: ctx.clock().toISOString(),
          units: heldBackUnits(precinct, stay, why).filter(keep),
          bookingUrl,
          ...('refused' in why
            ? {}
            : { release: { open: false, ...(why.opensAt ? { opensAt: why.opensAt } : {}) } }),
        };
      }
      const result = await searchOnce(stay, options.signal);
      return {
        key,
        checkedAt: result.checkedAt,
        units: unitsAt(precinct, result, stay).filter(keep),
        bookingUrl,
      };
    },

    async search(stay: StayQuery, signal?: AbortSignal): Promise<BulkAvailabilityEntry[]> {
      const held = new Map(ROTTNEST_PRECINCTS.map((p) => [p.slug, heldBack(p, stay)]));
      // Every place held back: nothing to ask
      const result = [...held.values()].every(Boolean) ? undefined : await searchOnce(stay, signal);
      await Promise.resolve();
      throwIfAborted(signal);
      return ROTTNEST_PRECINCTS.map((precinct): BulkAvailabilityEntry => {
        const why = held.get(precinct.slug);
        if (why || !result) {
          return {
            key: makeLocationKey(ctx.id, precinct.slug),
            availableUnits: 0,
            bookableUnits: 0,
            ...(why && 'refused' in why ? { refused: why.refused } : {}),
            ...(why && 'opensAt' in why && why.opensAt ? { opensAt: why.opensAt } : {}),
          };
        }
        const units = unitsAt(precinct, result, stay);
        const free = units.filter((unit) => unit.fullyAvailable).length;
        const entry: BulkAvailabilityEntry = {
          key: makeLocationKey(ctx.id, precinct.slug),
          availableUnits: free,
        };
        const kinds = unitKindsOf(precinct);
        if (kinds.length > 1) {
          entry.byKind = Object.fromEntries(
            kinds.map((kind: UnitKind) => [
              kind,
              {
                availableUnits: units.filter((u) => u.unitKind === kind && u.fullyAvailable).length,
              },
            ])
          );
        }
        return entry;
      });
    },

    dispose() {
      lifetime.abort();
      memo.clear();
    },
  };
}
