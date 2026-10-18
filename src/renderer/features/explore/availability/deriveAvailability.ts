/**
 * What Explore says about a place's availability for the stay in the search pill (E3): one
 * state per place, from its provider's capabilities and its provider's bulk availability
 * (`catalog.availability`, one query per provider). Pure.
 *
 * The counts are the provider's own: `availableUnits` are units free on every night of the
 * stay, `bookableUnits` the units that can be booked online at all. A unit that is free on
 * some nights only is not available, and nothing here reads a night the provider did not
 * report as booked: with no entry for a place, its state is `unknown`. A provider with no unit
 * total (RAC) leaves `bookableUnits` out: the place reads "27 spots free", or "None free", and
 * only a total of 0 reads "Not open".
 *
 * With stay types chosen, a place that has other kinds too counts only the chosen kinds'
 * units (`byKind`), or says "check dates" when its provider does not count them apart: a
 * figure about cabins is never one that may include sites.
 */

import type { LocationSummary } from '../../../../shared/types/catalog.types';
import type {
  BulkAvailabilityEntry,
  ProviderCapabilities,
  UnitKind,
} from '../../../../shared/types/provider.types';
import { unitKindsOf } from '../../../../shared/utils/unit-kinds';
import { nounForKinds } from '../../../../shared/utils/unit-noun';

/** The states, in the order they take precedence (see `deriveAvailability`). */
export type AvailabilityState =
  | 'no-dates'
  | 'offline-booking'
  | 'check-dates'
  | 'notice'
  | 'not-supported'
  | 'error'
  | 'loading'
  | 'available'
  | 'full'
  | 'none-open'
  | 'unknown';

/**
 * What one provider's bulk availability is doing for the current stay:
 * - `idle`: not asked (offline) and nothing cached;
 * - `loading`: being asked, or about to be (the stay is still settling);
 * - `success`: answered (possibly from the cache);
 * - `error`: the provider could not be checked;
 * - `unsupported`: main says the provider has no bulk availability (`CAPABILITY`).
 */
export type ProviderAvailabilityStatus = 'idle' | 'loading' | 'success' | 'error' | 'unsupported';

/**
 * `bookableUnits` is the provider's total, left out when it gives none (RAC): an `available`
 * place then reads "{n} free", never "N of M".
 */
export type PlaceAvailability =
  | { state: 'available'; availableUnits: number; bookableUnits?: number }
  | { state: 'full'; bookableUnits?: number }
  /** `queue`: the provider's waiting queue is up (its access gate), not a fault. */
  | { state: 'error'; queue: boolean }
  | { state: Exclude<AvailabilityState, 'available' | 'full' | 'error'> };

export interface AvailabilityInput {
  /** Both dates are chosen and valid (`exploreStay`). */
  staySet: boolean;
  /** The place's provider's capabilities; undefined while providers load or for an unknown one. */
  capabilities?: Pick<ProviderCapabilities, 'availability' | 'bulkAvailability' | 'accessGate'>;
  /** The provider's bulk availability for the stay. */
  status?: ProviderAvailabilityStatus;
  /** The error code of a failed query (`ACCESS_GATE`, `TIMEOUT`, …). */
  errorCode?: string;
  /** The provider's entry for this place, when it gave one. */
  entry?: BulkAvailabilityEntry;
  /** The stay types chosen on Explore; none means every kind. */
  stayTypes?: readonly UnitKind[];
}

/** A provider count as a whole number of units: anything else counts as none. */
function units(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * A provider's total as whole units, or undefined when it left the total out (`undefined` or
 * `null`): "no total", never 0, which means none can be booked.
 */
function totalOf(value: unknown): number | undefined {
  return value === undefined || value === null ? undefined : units(value);
}

interface UnitCounts {
  available: number;
  /** Undefined: the provider gave no total. */
  bookable?: number;
}

/**
 * The unit kinds a place's counts are about: the stay types chosen that it has, else all of its
 * own (`unitKindsOf`). What its availability calls its units ("27 spots", "3 cabins").
 */
export function countedKinds(
  location: Pick<LocationSummary, 'kind' | 'unitKinds'>,
  stayTypes: readonly UnitKind[] = []
): UnitKind[] {
  const kinds = unitKindsOf(location);
  const chosen = kinds.filter((kind) => stayTypes.includes(kind));
  return chosen.length > 0 ? chosen : kinds;
}

/**
 * The counts that answer for the stay types chosen: the entry's totals when none is chosen or
 * the place has no kind that is not chosen; else the chosen kinds' counts from `byKind`
 * summed (a chosen kind it leaves out counts none), or null when it counts none of them. The
 * sum has no total when any kind summed has none.
 */
function chosenCounts(
  location: Pick<LocationSummary, 'kind' | 'unitKinds'>,
  entry: BulkAvailabilityEntry,
  stayTypes: readonly UnitKind[]
): UnitCounts | null {
  const totals = { available: units(entry.availableUnits), bookable: totalOf(entry.bookableUnits) };
  if (stayTypes.length === 0) return totals;
  const kinds = unitKindsOf(location);
  const chosen = kinds.filter((kind) => stayTypes.includes(kind));
  if (chosen.length === kinds.length) return totals;
  // Passed through as the provider gives it: anything but an object counts as no entry.
  const { byKind } = entry;
  const countsOf = (kind: UnitKind) => {
    const counts = byKind && typeof byKind === 'object' ? byKind[kind] : undefined;
    return counts && typeof counts === 'object' ? counts : undefined;
  };
  if (!chosen.some((kind) => countsOf(kind))) return null;
  return chosen.reduce<UnitCounts>(
    (sum, kind) => {
      const counts = countsOf(kind);
      // A kind left out counts none; a kind whose total is left out leaves the sum without one
      const bookable = counts ? totalOf(counts.bookableUnits) : 0;
      return {
        available: sum.available + units(counts?.availableUnits),
        bookable:
          sum.bookable === undefined || bookable === undefined
            ? undefined
            : sum.bookable + bookable,
      };
    },
    { available: 0, bookable: 0 }
  );
}

/**
 * The place's availability state. Precedence, first match wins: `no-dates` (no stay),
 * `offline-booking` (not bookable online), `check-dates` (the provider checks one place at a
 * time but not in bulk), `not-supported` (no availability at all), `notice` (its notice is not
 * accepted, so it was not asked: `NOTICE_REQUIRED`), `error`, `loading`, then
 * from the provider's entry `available` (a unit free every night), `full` (no unit free every
 * night, some bookable or no total given) or `none-open` (a total of 0: not released, closed or
 * too far ahead), and `unknown` when the provider answered without this place.
 *
 * With `stayTypes` chosen and the place having a kind not chosen, the entry's counts for the
 * chosen kinds it has (`byKind`) decide instead of its totals, and without any it is
 * `check-dates`.
 */
export function deriveAvailability(
  location: Pick<LocationSummary, 'bookingMode' | 'kind' | 'unitKinds'>,
  input: AvailabilityInput
): PlaceAvailability {
  if (!input.staySet) return { state: 'no-dates' };
  if (location.bookingMode !== 'online') return { state: 'offline-booking' };
  const { capabilities } = input;
  if (!capabilities) return { state: 'unknown' };
  if (!capabilities.bulkAvailability) {
    return { state: capabilities.availability ? 'check-dates' : 'not-supported' };
  }
  switch (input.status) {
    case 'unsupported':
      return { state: 'not-supported' };
    case 'error':
      // Not asked: the person has not accepted the provider's notice (§12.36)
      if (input.errorCode === 'NOTICE_REQUIRED') return { state: 'notice' };
      return {
        state: 'error',
        queue: input.errorCode === 'ACCESS_GATE' && capabilities.accessGate === true,
      };
    case 'loading':
      return { state: 'loading' };
    case 'success':
      break;
    default:
      return { state: 'unknown' };
  }
  const { entry } = input;
  if (!entry) return { state: 'unknown' };
  const counts = chosenCounts(location, entry, input.stayTypes ?? []);
  if (!counts) return { state: 'check-dates' };
  const { available, bookable } = counts;
  const withTotal = bookable === undefined ? {} : { bookableUnits: bookable };
  if (available > 0) return { state: 'available', availableUnits: available, ...withTotal };
  if (bookable === undefined || bookable > 0) return { state: 'full', ...withTotal };
  return { state: 'none-open' };
}

export type AvailabilityTone = 'available' | 'neutral' | 'danger';

export interface AvailabilityLabel {
  /** The map pill's text. */
  pill: string;
  /**
   * The card's badge text; empty while loading (the card shows a skeleton line), and null when
   * the card already says it ("Info only").
   */
  card: string | null;
  /** The badge tone; null while loading. */
  tone: AvailabilityTone | null;
  /** The badge gives the unit total ("8 of 24 sites available"), so the card need not repeat it. */
  statesTotal?: boolean;
}

/** Shown on a pill whose place says nothing more useful. */
export const NO_STATE_PILL = '–';
/** A pill while its provider is being asked. */
export const LOADING_PILL = '···';

/**
 * How a state reads on a map pill and a card, with the noun of the unit kinds it counts
 * (`countedKinds`: "8 of 24 sites available", "2 of 6 cabins available", "27 of 40 spots
 * available" at a place of several kinds). Without a provider total: "27 free" on the pill and
 * "27 spots free" or "1 cabin free" on the card. Null with no dates: nothing shows.
 */
export function availabilityLabel(
  availability: PlaceAvailability,
  kinds: readonly UnitKind[],
  shortName: string
): AvailabilityLabel | null {
  const noun = nounForKinds(kinds);
  switch (availability.state) {
    case 'no-dates':
      return null;
    case 'available': {
      const { availableUnits: free, bookableUnits: total } = availability;
      // No provider total (RAC): what is free, and no "of M"
      if (total === undefined) {
        return {
          pill: `${free} free`,
          card: `${free} ${free === 1 ? noun.one : noun.many} free`,
          tone: 'available',
        };
      }
      // A provider total below the free count would read "8 of 3": say only what is free.
      if (total >= free) {
        return {
          pill: `${free} available`,
          card: `${free} of ${total} ${total === 1 ? noun.one : noun.many} available`,
          tone: 'available',
          statesTotal: true,
        };
      }
      return {
        pill: `${free} available`,
        card: `${free} ${free === 1 ? noun.one : noun.many} available`,
        tone: 'available',
      };
    }
    case 'full':
      // Not "Fully booked": a provider's "none free for the stay" also covers nights free on
      // different units, closed nights and nights not released yet.
      return { pill: 'None free', card: `No ${noun.one} free every night`, tone: 'neutral' };
    case 'none-open':
      return { pill: 'Not open', card: `No ${noun.many} open for these dates`, tone: 'neutral' };
    case 'check-dates':
      return { pill: 'Check dates', card: 'Check dates on the place page', tone: 'neutral' };
    case 'notice':
      // The notice is offered once, above the list
      return {
        pill: NO_STATE_PILL,
        card: `Read ${shortName}'s notice to check dates`,
        tone: 'neutral',
      };
    case 'offline-booking':
      // The card already says "Info only".
      return { pill: 'Info only', card: null, tone: 'neutral' };
    case 'not-supported':
      return {
        pill: NO_STATE_PILL,
        card: `Check dates on ${shortName}`,
        tone: 'neutral',
      };
    case 'unknown':
      return { pill: NO_STATE_PILL, card: 'Availability unknown', tone: 'neutral' };
    case 'error':
      // A waiting queue is explained once, above the list; the cards stay calm.
      return {
        pill: NO_STATE_PILL,
        card: `Couldn't check ${shortName}`,
        tone: availability.queue ? 'neutral' : 'danger',
      };
    case 'loading':
      return { pill: LOADING_PILL, card: '', tone: null };
  }
}

/** The list's groups with dates set, first to last. */
const RANK: Record<AvailabilityState, number> = {
  available: 0,
  full: 1,
  'none-open': 2,
  'check-dates': 3,
  notice: 3,
  'offline-booking': 4,
  'not-supported': 5,
  unknown: 6,
  loading: 6,
  error: 7,
  'no-dates': 8,
};

/**
 * The list with dates set: available places first, most free units first, then full, not
 * open, "check dates", info only, not shared, unknown and failed. Within a group the given
 * order is kept (Explore's own order). Returns a new array.
 */
export function sortByAvailability<T>(
  items: readonly T[],
  availabilityOf: (item: T) => PlaceAvailability
): T[] {
  return items
    .map((item, index) => ({ item, index, availability: availabilityOf(item) }))
    .sort((a, b) => {
      const rank = RANK[a.availability.state] - RANK[b.availability.state];
      if (rank !== 0) return rank;
      if (a.availability.state === 'available' && b.availability.state === 'available') {
        const more = b.availability.availableUnits - a.availability.availableUnits;
        if (more !== 0) return more;
      }
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
