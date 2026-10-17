/**
 * The stay a page is opened with, in its query string: `arrival`, `departure` (calendar dates
 * `YYYY-MM-DD`), `adults`, `children` and `infants`. Explore passes its stay to a place's
 * detail page this way (E2), and the create flows read the same keys from the prefill query
 * (architecture-notes §12.10). The stay types chosen on Explore travel the same way, as
 * `stay=cabin,room` (`parseStayTypes`). Pure.
 */

import {
  addDays,
  compareDates,
  isCalendarDate,
  nightsBetween,
} from '../../shared/utils/calendar-date';
import { STAY_TYPES, type StayTypeKind } from '../../shared/utils/unit-kinds';
import { DEFAULT_GUEST_LIMITS } from '../components/ui/GuestsField';

export interface StayParams {
  arrival: string | null;
  departure: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
}

export const EMPTY_STAY_PARAMS: Readonly<StayParams> = Object.freeze({
  arrival: null,
  departure: null,
  adults: null,
  children: null,
  infants: null,
});

/** The keys, in the order they are written. */
export const STAY_PARAM_KEYS = ['arrival', 'departure', 'adults', 'children', 'infants'] as const;

type GuestKey = 'adults' | 'children' | 'infants';

function count(raw: string | null, kind: GuestKey): number | null {
  if (raw === null || !/^\d{1,3}$/.test(raw)) return null;
  const value = Number(raw);
  const { min, max } = DEFAULT_GUEST_LIMITS[kind];
  return value >= min && value <= max ? value : null;
}

function date(raw: string | null): string | null {
  return raw !== null && isCalendarDate(raw) ? raw : null;
}

/**
 * Reads the stay from a query string. Values that are not valid are dropped: a date that is
 * not a calendar date, a guest count out of range, and a departure on or before the arrival.
 */
export function parseStayParams(search: string): StayParams {
  const query = new URLSearchParams(search);
  const stay: StayParams = {
    arrival: date(query.get('arrival')),
    departure: date(query.get('departure')),
    adults: count(query.get('adults'), 'adults'),
    children: count(query.get('children'), 'children'),
    infants: count(query.get('infants'), 'infants'),
  };
  if (stay.arrival && stay.departure && compareDates(stay.departure, stay.arrival) <= 0) {
    stay.departure = null;
  }
  return stay;
}

/** The provider's rules a stay from an address must keep to. */
export interface StayRules {
  /** The earliest arrival, `YYYY-MM-DD`: today in the provider's time zone. */
  minDate?: string;
  /** The longest stay. */
  maxNights?: number;
}

/**
 * A stay from an address, kept to the provider's rules: a stay that starts before `minDate`
 * (or a departure with no arrival) is dropped, and one longer than `maxNights` ends after
 * `maxNights` nights.
 */
export function clampStayParams(stay: StayParams, rules: StayRules): StayParams {
  const out = { ...stay };
  if (out.arrival && rules.minDate && compareDates(out.arrival, rules.minDate) < 0) {
    out.arrival = null;
    out.departure = null;
  }
  if (!out.arrival) out.departure = null;
  if (
    out.arrival &&
    out.departure &&
    rules.maxNights !== undefined &&
    nightsBetween(out.arrival, out.departure) > rules.maxNights
  ) {
    out.departure = addDays(out.arrival, rules.maxNights);
  }
  return out;
}

/** The stay as query values for `buildPath`, in `STAY_PARAM_KEYS` order, without the blanks. */
export function stayParamsQuery(
  stay: Partial<StayParams> | undefined
): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  for (const key of STAY_PARAM_KEYS) {
    const value = stay?.[key];
    if (value !== null && value !== undefined && value !== '') query[key] = value;
  }
  return query;
}

/** True when the stay has both dates, so availability can be checked for it. */
export function hasDates(
  stay: Pick<StayParams, 'arrival' | 'departure'>
): stay is { arrival: string; departure: string } {
  return Boolean(stay.arrival && stay.departure);
}

const STAY_TYPE_KINDS: ReadonlySet<string> = new Set(STAY_TYPES.map((type) => type.kind));

/** Whether `value` is the kind of one of the `STAY_TYPES` (any unit kind but `other`). */
export function isStayType(value: unknown): value is StayTypeKind {
  return typeof value === 'string' && STAY_TYPE_KINDS.has(value);
}

/**
 * The stay types in a `stay` query value (`cabin,room`), in its order: unknown values, `other`
 * and repeats are left out. `[]` for no value.
 */
export function parseStayTypes(raw: string | null | undefined): StayTypeKind[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((item) => item.trim()))].filter(isStayType);
}

/**
 * Whether a `stay` query value names something that is not a stay type (`castle`, `other`),
 * which `parseStayTypes` leaves out: a create flow says so. Repeats and empty items do not count.
 */
export function hasUnusableStayType(raw: string | null | undefined): boolean {
  return unusableStayTypes(raw).length > 0;
}

/** What a `stay` query value names that is not a stay type, without repeats. */
function unusableStayTypes(raw: string | null | undefined): string[] {
  const items = (raw ?? '').split(',').map((item) => item.trim());
  return [...new Set(items.filter((item) => item !== '' && !isStayType(item)))];
}

/**
 * A create flow's notice for a `stay` query value naming something that is not a stay type:
 * with none of its stay types usable, to choose one; with some kept, that only the others were
 * left out ("stay=cabin,castle" keeps Cabins & villas). None when all of it is usable.
 */
export function unusableStayTypeNotice(raw: string | null | undefined): string | undefined {
  const unusable = unusableStayTypes(raw).length;
  if (unusable === 0) return undefined;
  if (parseStayTypes(raw).length === 0)
    return "The link's stay type couldn't be used, so choose one.";
  return unusable === 1
    ? "One of the link's stay types couldn't be used, so it was left out."
    : "Some of the link's stay types couldn't be used, so they were left out.";
}
