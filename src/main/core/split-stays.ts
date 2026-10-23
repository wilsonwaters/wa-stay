/**
 * Split stays: a stay free every night, but only by moving between units. Never free: a split
 * stay is not in `fullyAvailable`, `freeCount`, Explore's counts or a watch's full match. The
 * place page lists them (`catalog.checkLocation`'s `splitStays`), and a watch that allows them
 * (`allowSplitStay`) alerts on one when nothing is free on one unit (`SPLIT_FOUND`).
 *
 * `splitStaysOf` is pure (debug lines aside) and costs no request: everything comes from the
 * check's units, or a watch's wanted units. Per kind (`unitKindOfUnit`, in `UNIT_KINDS` order;
 * a split stay never crosses stay types):
 * - **Reported.** A unit that stands for several (RAC's category, ParkStay's site class) may
 *   carry the provider's `splitStay`. A valid report gives one split stay on that unit, listed
 *   whether or not another unit of the kind is free (a Powered Site is not an Unpowered Site).
 *   An invalid one is ignored, with a debug line naming the provider and the unit.
 * - **Derived.** When no unit of the kind is a full match, the fewest parts (`fewestParts`)
 *   across its units with no `freeCount`, which are one place each: each part a run of free
 *   nights on one unit that passes the price rule and the unit's stay rules, so a move never
 *   falls on a morning the old unit takes no departures or a day the new one takes no arrivals.
 *   A unit with a `freeCount` counts free places per night, not one place, so a run on it is
 *   not a stay on one place: its provider reports its own split stays.
 *
 * Best first: the fewest bookings (parts, else the count of units, else last), then reported
 * before derived, then the provider's unit order.
 *
 * `withSplitStayLinks` adds how to book them, and is the only code that asks the provider's
 * links for this: a `contact` split stay's contact page, a `separate` one's booking page per
 * part. Every link must be https on the provider's own site (`firstBookingLink`); others are
 * dropped and logged by origin only.
 */

import {
  SPLIT_STAY_BOOKINGS,
  UNIT_KINDS,
  type NightStatus,
  type SplitStay,
  type SplitStayPart,
  type StayQuery,
  type UnitAvailability,
  type UnitKind,
} from '@shared/types/provider.types';
import { addDays, compareDates, eachNight, isCalendarDate } from '@shared/utils/calendar-date';
import { fewestParts } from '@shared/utils/split-parts';
import { isUnitKind, unitKindOfUnit } from '@shared/utils/unit-kinds';
import { logger } from '../utils/logger';
import {
  firstBookingLink,
  type BookingLinkOptions,
  type BookingLinkProvider,
} from './booking-link';
import {
  fullMatches,
  isFreeNight,
  meetsStayRules,
  nightAfter,
  priceCheck,
} from './watches/matching';

const log = logger.child({ module: 'split-stays' });

export interface SplitStayOptions {
  /** The watch's price rule, per night and only when every night has a price (`priceCheck`). */
  maxPrice?: number;
  /** The provider, for the debug line about a report that is ignored. */
  providerId?: string;
  /** Logs nothing: the watch reads, which derive them again on every refresh. */
  quiet?: boolean;
}

/** A split stay, with what ranks it beyond its bookings. */
interface Ranked {
  split: SplitStay;
  reported: boolean;
  /** The position in the check of its unit (reported) or its first part's unit (derived). */
  order: number;
}

/** How many bookings it takes: its parts, else its count of units (at least that), else unknown. */
function bookingsOf(split: SplitStay): number {
  return split.parts?.length ?? split.units ?? Number.POSITIVE_INFINITY;
}

function byRank(a: Ranked, b: Ranked): number {
  const bookings = bookingsOf(a.split) - bookingsOf(b.split);
  if (bookings !== 0 && !Number.isNaN(bookings)) return bookings;
  if (a.reported !== b.reported) return a.reported ? -1 : 1;
  return a.order - b.order;
}

/** The unit's night for each date of the stay, in order (undefined where it reported none). */
function stayNights(
  unit: UnitAvailability,
  dates: readonly string[]
): Array<NightStatus | undefined> {
  const byDate = new Map<string, NightStatus>();
  for (const night of Array.isArray(unit.nights) ? unit.nights : []) {
    if (night && typeof night.date === 'string') byDate.set(night.date, night);
  }
  return dates.map((date) => byDate.get(date));
}

/** A whole number of at least 2. */
function isUnitCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 2;
}

/** At least 2 parts, in order, each at least a night, from `arrival` to `departure` with no gap or overlap. */
function partsCoverStay(parts: unknown, arrival: string, departure: string): boolean {
  if (!Array.isArray(parts) || parts.length < 2) return false;
  let at = arrival;
  for (const part of parts as Array<{ arrival?: unknown; departure?: unknown } | null>) {
    const from = part?.arrival;
    const to = part?.departure;
    if (typeof from !== 'string' || typeof to !== 'string') return false;
    if (!isCalendarDate(from) || !isCalendarDate(to)) return false;
    if (from !== at || compareDates(to, from) <= 0) return false;
    at = to;
  }
  return at === departure;
}

/**
 * Why a unit's reported split stay is not valid for this stay, or undefined when it is: it is
 * not fully available, counts no free unit, has every night of the stay free or `split` with
 * at least one `split`, a known way to book, a count of at least 2 and parts that cover the
 * stay exactly, when it gives them.
 */
function reportProblem(
  unit: UnitAvailability,
  nights: ReadonlyArray<NightStatus | undefined>,
  arrival: string,
  departure: string
): string | undefined {
  const report = unit.splitStay;
  if (!report || !(SPLIT_STAY_BOOKINGS as readonly unknown[]).includes(report.booking)) {
    return 'it says neither contact nor separate';
  }
  if (unit.fullyAvailable) return 'the unit is free for the whole stay';
  if (unit.freeCount !== undefined && unit.freeCount !== 0) return 'the unit counts free units';
  if (nights.some((night) => night === undefined)) return 'a night of the stay is missing';
  const present = nights as NightStatus[];
  if (present.some((night) => !isFreeNight(night) && night.reason !== 'split')) {
    return 'a night is neither free nor split';
  }
  if (!present.some((night) => night.reason === 'split')) return 'no night is split';
  if (report.units !== undefined && !isUnitCount(report.units)) {
    return 'its count is not a whole number of at least 2';
  }
  if (report.parts !== undefined && !partsCoverStay(report.parts, arrival, departure)) {
    return 'its parts do not cover the stay';
  }
  return undefined;
}

/** The sum of the nights' prices, when every one has a price. */
function totalOf(nights: readonly NightStatus[]): number | undefined {
  return priceCheck(nights).total;
}

/** A part on `unit` for nights `[from, to)` of the stay. */
function partOn(
  unit: UnitAvailability,
  nights: readonly NightStatus[],
  dates: readonly string[],
  from: number,
  to: number
): SplitStayPart {
  const total = totalOf(nights.slice(from, to));
  return {
    unitId: unit.unitId,
    unitName: unit.unitName,
    arrival: dates[from],
    departure: addDays(dates[to - 1], 1),
    ...(total !== undefined ? { total } : {}),
  };
}

/** The split stay a valid report gives, on its unit, with its parts' dates when it gave them. */
function reportedSplit(
  unit: UnitAvailability,
  nights: readonly NightStatus[],
  dates: readonly string[]
): SplitStay {
  const report = unit.splitStay!;
  const parts = report.parts?.map(({ arrival, departure }) => {
    const from = dates.indexOf(arrival);
    return partOn(unit, nights, dates, from, from + eachNight(arrival, departure).length);
  });
  // The parts' totals add up to the nights' (every night is in one part)
  const total = totalOf(nights);
  return {
    ...(isUnitKind(unit.unitKind) ? { unitKind: unit.unitKind } : {}),
    booking: report.booking,
    unitId: unit.unitId,
    unitName: unit.unitName,
    ...(report.units !== undefined ? { units: report.units } : {}),
    ...(parts ? { parts } : {}),
    ...(total !== undefined ? { total } : {}),
  };
}

/**
 * The fewest parts across `group`'s units with no `freeCount`, each a run of free nights that
 * passes the price rule and the unit's stay rules; undefined unless it takes at least 2 parts.
 */
function derivedSplit(
  group: readonly UnitAvailability[],
  kind: UnitKind,
  dates: readonly string[],
  maxPrice: number | undefined
): { split: SplitStay; first: UnitAvailability } | undefined {
  const rows = group.filter((unit) => unit.freeCount === undefined);
  if (rows.length === 0) return undefined;
  const nightsOf = rows.map((unit) => stayNights(unit, dates));
  // From each night, how many free nights follow in a row: most candidates stop here
  const runFrom = nightsOf.map((nights) => {
    const run = new Array<number>(dates.length + 1).fill(0);
    for (let k = dates.length - 1; k >= 0; k -= 1) {
      const night = nights[k];
      run[k] = night && isFreeNight(night) ? run[k + 1] + 1 : 0;
    }
    return run;
  });
  const fits = (row: number, from: number, to: number): boolean => {
    if (runFrom[row][from] < to - from) return false;
    const run = nightsOf[row].slice(from, to) as NightStatus[];
    if (!priceCheck(run, maxPrice).passes) return false;
    const unit = rows[row];
    return meetsStayRules(unit, run, nightAfter(unit, run[run.length - 1]));
  };
  const cover = fewestParts(rows.length, dates.length, fits);
  if (!cover || cover.length < 2) return undefined;

  const parts = cover.map(({ row, from, to }) =>
    partOn(rows[row], nightsOf[row] as NightStatus[], dates, from, to)
  );
  const used = cover.map(({ row }) => rows[row]);
  const totals = parts.map((part) => part.total);
  const total = totals.every((value) => value !== undefined)
    ? totals.reduce((sum, value) => sum + value, 0)
    : undefined;
  return {
    split: {
      ...(used.some((unit) => isUnitKind(unit.unitKind)) ? { unitKind: kind } : {}),
      booking: 'separate',
      units: new Set(used.map((unit) => unit.unitId)).size,
      parts,
      ...(total !== undefined ? { total } : {}),
    },
    first: used[0],
  };
}

/**
 * The split stays in `units` (a check's units, or a watch's wanted units) for the stay from
 * `arrival` to `departure`, best first: every valid reported one, and per kind the derived one
 * when no unit of that kind is a full match. None for a stay of one night. No links yet
 * (`withSplitStayLinks`).
 */
export function splitStaysOf(
  units: readonly UnitAvailability[],
  arrival: string,
  departure: string,
  options: SplitStayOptions = {}
): SplitStay[] {
  if (!isCalendarDate(arrival) || !isCalendarDate(departure)) return [];
  const dates = eachNight(arrival, departure);
  if (dates.length < 2) return [];
  const { maxPrice } = options;
  const found: Ranked[] = [];

  for (const kind of UNIT_KINDS) {
    const group = units.filter((unit) => unitKindOfUnit(unit) === kind);
    if (group.length === 0) continue;

    for (const unit of group) {
      if (!unit.splitStay) continue;
      const nights = stayNights(unit, dates);
      const problem = reportProblem(unit, nights, arrival, departure);
      if (problem) {
        if (!options.quiet) {
          log.debug(
            `${options.providerId ?? 'A provider'}: ignored the split stay reported on unit ${unit.unitId}: ${problem}`
          );
        }
        continue;
      }
      const stay = nights as NightStatus[];
      if (!priceCheck(stay, maxPrice).passes) continue;
      found.push({
        split: reportedSplit(unit, stay, dates),
        reported: true,
        order: units.indexOf(unit),
      });
    }

    // A unit of the kind free for the whole stay: nothing to move for
    if (fullMatches({ maxPrice }, group).length > 0) continue;
    const derived = derivedSplit(group, kind, dates, maxPrice);
    if (derived) {
      found.push({ split: derived.split, reported: false, order: units.indexOf(derived.first) });
    }
  }
  return found.sort(byRank).map((ranked) => ranked.split);
}

/**
 * `splitStays` with how to book them, for `externalId` and `stay` (the stay fields it was
 * checked with): a `contact` split stay's `contactUrl` (the first of `links.contact` and
 * `links.location` that is https on the provider's own site), and a `separate` one's
 * `bookingUrl` per part (`links.booking` for the part's dates and unit, kept by the same rule).
 * A link off the site is dropped and logged by origin only, and a `links` that throws by its
 * error's name, unless `quiet`. New objects; the input is left as it is.
 */
export function withSplitStayLinks(
  provider: BookingLinkProvider,
  externalId: string,
  stay: StayQuery,
  splitStays: readonly SplitStay[],
  options: BookingLinkOptions = {}
): SplitStay[] {
  const { manifest, links } = provider;
  const ask = (what: string, link: () => string | null | undefined): string | null | undefined => {
    try {
      return link();
    } catch (error) {
      if (!options.quiet) {
        log.warn(
          `${manifest.id}: links.${what} failed: ${error instanceof Error ? error.name : 'error'}`
        );
      }
      return undefined;
    }
  };
  // Asked once per call, and only when a split stay is booked through the place
  let contact: { url?: string } | undefined;
  const contactUrl = (): string | undefined => {
    contact ??= {
      url: firstBookingLink(
        manifest,
        [
          ask('contact', () => links.contact?.(externalId)),
          ask('location', () => links.location(externalId)),
        ],
        options
      ),
    };
    return contact.url;
  };

  return splitStays.map((split) => {
    const linked: SplitStay = { ...split };
    delete linked.contactUrl;
    if (split.booking === 'contact') {
      const url = contactUrl();
      if (url) linked.contactUrl = url;
      return linked;
    }
    if (!split.parts) return linked;
    linked.parts = split.parts.map((part) => {
      const partLinked: SplitStayPart = { ...part };
      delete partLinked.bookingUrl;
      const url = firstBookingLink(
        manifest,
        [
          ask('booking', () =>
            links.booking(
              externalId,
              { ...stay, arrival: part.arrival, departure: part.departure },
              part.unitId
            )
          ),
        ],
        options
      );
      if (url) partLinked.bookingUrl = url;
      return partLinked;
    });
    return linked;
  });
}
