/**
 * What Explore says about a place's availability for the stay in the search pill (E3): one
 * state per place, from its provider's capabilities and its provider's bulk availability
 * (`catalog.availability`, one query per provider). Pure.
 *
 * The counts are the provider's own: `availableUnits` are units free on every night of the
 * stay, `bookableUnits` the units that can be booked online at all. A unit that is free on
 * some nights only is not available, and nothing here reads a night the provider did not
 * report as booked: with no entry for a place, its state is `unknown`.
 */

import type { LocationSummary } from '../../../../shared/types/catalog.types';
import type {
  BulkAvailabilityEntry,
  ProviderCapabilities,
} from '../../../../shared/types/provider.types';
import { unitNoun } from '../../../components/locationFormat';

/** The states, in the order they take precedence (see `deriveAvailability`). */
export type AvailabilityState =
  | 'no-dates'
  | 'offline-booking'
  | 'check-dates'
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

export type PlaceAvailability =
  | { state: 'available'; availableUnits: number; bookableUnits: number }
  | { state: 'full'; bookableUnits: number }
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
}

/** A provider count as a whole number of units: anything else counts as none. */
function units(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * The place's availability state. Precedence, first match wins: `no-dates` (no stay),
 * `offline-booking` (not bookable online), `check-dates` (the provider checks one place at a
 * time but not in bulk), `not-supported` (no availability at all), `error`, `loading`, then
 * from the provider's entry `available` (a unit free every night), `full` (no unit free every
 * night, some bookable) or `none-open` (none bookable: not released, closed or too far ahead), and
 * `unknown` when the provider answered without this place.
 */
export function deriveAvailability(
  location: Pick<LocationSummary, 'bookingMode'>,
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
  const available = units(entry.availableUnits);
  const bookable = units(entry.bookableUnits);
  if (available > 0)
    return { state: 'available', availableUnits: available, bookableUnits: bookable };
  if (bookable > 0) return { state: 'full', bookableUnits: bookable };
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
 * How a state reads on a map pill and a card, with the unit noun of the place's kind
 * ("8 of 24 sites available", "2 of 6 cabins available"). Null with no dates: nothing shows.
 */
export function availabilityLabel(
  availability: PlaceAvailability,
  kind: string,
  shortName: string
): AvailabilityLabel | null {
  const noun = unitNoun(kind);
  switch (availability.state) {
    case 'no-dates':
      return null;
    case 'available': {
      const { availableUnits: free, bookableUnits: total } = availability;
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
    case 'offline-booking':
      // The card already says "Info only".
      return { pill: 'Info only', card: null, tone: 'neutral' };
    case 'not-supported':
      return {
        pill: NO_STATE_PILL,
        card: `Availability not shared by ${shortName}`,
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
