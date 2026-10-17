/**
 * The facts NightGrid shows, worked out from a provider's per-night availability: which units
 * are free for the whole stay, the summary line, each cell's words, and how dates read. Pure.
 */

import { format } from 'date-fns';
import type { NightState, NightStatus, UnitAvailability } from '../../shared/types/provider.types';
import { eachNight } from '../../shared/utils/calendar-date';
import { countsFreeUnits, freeUnitsOf } from '../../shared/utils/free-units';
import { MIXED_UNIT_NOUN, type UnitNoun } from '../../shared/utils/unit-noun';
import { parseIsoDate } from './ui/calendar';

export type { UnitNoun };

/** With no kinds to go on, units are "spots" (`nounForKinds`). */
export const DEFAULT_UNIT_NOUN: UnitNoun = MIXED_UNIT_NOUN;

/** Each night of the stay, by the date it starts: the arrival up to, not including, departure. */
export function stayNights(arrival: string, departure: string): string[] {
  return eachNight(arrival, departure);
}

/** A unit's state on one night; a night the provider did not report is `unknown`. */
export function nightOf(unit: UnitAvailability, date: string): NightStatus {
  return unit.nights.find((night) => night.date === date) ?? { date, state: 'unknown' };
}

/**
 * A night the provider has room on but refuses for this stay under its stay rules (the
 * provider's `reason: 'min-stay'`: too short, too long, or arriving or leaving on a refused
 * day). The reason wins over its state, so it is never read as free.
 */
export function isMinStayNight(night: NightStatus): boolean {
  return night.reason === 'min-stay';
}

/**
 * Free on every night of the stay: each `available`, with no reason it is not (`split`, or
 * `min-stay`: refused under the stay rules), as matching counts it.
 */
export function isFullyAvailable(unit: UnitAvailability, nights: readonly string[]): boolean {
  return (
    nights.length > 0 &&
    nights.every((date) => {
      const night = nightOf(unit, date);
      return night.state === 'available' && night.reason === undefined;
    })
  );
}

/**
 * A night free, but not on the same unit as the available nights next to it (the provider's
 * `reason: 'split'`): it settles the stay as not free on one unit, without being taken.
 */
export function isSplitNight(night: NightStatus): boolean {
  return night.reason === 'split';
}

/** A whole number of nights of 1 or more; anything else (0, negative, a fraction) is none. */
const wholeNights = (value: number | undefined): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;

/**
 * The fewest nights the provider takes for a stay arriving on `arrival` at `unit`: that night's
 * `minNights`, else the unit's; undefined when that is no rule (none, or 1).
 */
export function stayMinimum(unit: UnitAvailability, arrival: string): number | undefined {
  const minimum = wholeNights(nightOf(unit, arrival).minNights) ?? wholeNights(unit.minNights);
  return minimum !== undefined && minimum > 1 ? minimum : undefined;
}

/**
 * What a unit's nights say about the whole stay. Only known nights decide: a night the
 * provider did not report, or one not released yet, never counts as taken.
 * - `free`: every night is available;
 * - `taken`: at least one night is booked or closed;
 * - `split`: nothing taken, but some nights are free only on another unit than the nights
 *   next to them, so no one unit is free for the whole stay;
 * - `min-stay`: nothing taken, but some nights are refused for this stay by the provider's
 *   stay rules (its minimum nights, or the days it takes arrivals and departures);
 * - `not-released`: nothing taken, but some nights are not released for booking yet;
 * - `unknown`: nothing taken or unreleased, but the provider did not say about some nights.
 */
export type UnitStanding = 'free' | 'taken' | 'split' | 'min-stay' | 'not-released' | 'unknown';

export function unitStanding(unit: UnitAvailability, nights: readonly string[]): UnitStanding {
  const states = nights.map((date) => nightOf(unit, date).state);
  if (isFullyAvailable(unit, nights)) return 'free';
  if (states.some((state) => state === 'booked' || state === 'closed')) return 'taken';
  if (nights.some((date) => isSplitNight(nightOf(unit, date)))) return 'split';
  if (nights.some((date) => isMinStayNight(nightOf(unit, date)))) return 'min-stay';
  if (states.some((state) => state === 'not-released')) return 'not-released';
  return 'unknown';
}

export interface AvailabilitySummary {
  /** Units checked. */
  total: number;
  /** Units whose known nights settle the whole stay: free, or taken on some night. */
  known: number;
  /** Free for the whole stay. */
  fully: number;
  /**
   * Set when the provider counts its units (`freeCount`, `countsFreeUnits`): the units the
   * `fully` ones stand for, as Explore counts them (`freeUnitsOf`: RAC's sites of each category
   * free for the whole stay). Such a provider gives no total of its units, so the summary line
   * then says what is free, never "of M".
   */
  freeUnits?: number;
  /** Taken on some nights, free on others. */
  partly: number;
  /** Not settled yet: some nights are not released for booking. */
  notReleased: number;
  /** Not settled: the provider did not say about some nights. */
  unknown: number;
  /** Of `known`: free on some nights, but not on one unit for the whole stay. */
  split?: number;
  /** Of `known`: nothing taken, but refused for this stay by the provider's stay rules. */
  minStay?: number;
  /**
   * The `min-stay` units by the fewest nights they take for a stay arriving on its first night,
   * when that is more than the stay has: `{ 3: 2 }` is 2 units that need 3 nights.
   */
  minimums?: Record<number, number>;
  /** The stay's first night, when some `min-stay` units take no arrivals on it, and how many. */
  noArrival?: { date: string; units: number };
  nights: number;
}

export function summariseAvailability(
  units: readonly UnitAvailability[],
  nights: readonly string[]
): AvailabilitySummary {
  const summary: AvailabilitySummary = {
    total: units.length,
    known: 0,
    fully: 0,
    partly: 0,
    notReleased: 0,
    unknown: 0,
    nights: nights.length,
    ...(countsFreeUnits(units) ? { freeUnits: 0 } : {}),
  };
  for (const unit of units) {
    const standing = unitStanding(unit, nights);
    if (standing === 'free') {
      summary.known += 1;
      summary.fully += 1;
      if (summary.freeUnits !== undefined) summary.freeUnits += freeUnitsOf(unit);
    } else if (standing === 'taken') {
      summary.known += 1;
      if (nights.some((date) => nightOf(unit, date).state === 'available')) summary.partly += 1;
    } else if (standing === 'split') {
      summary.known += 1;
      summary.partly += 1;
      summary.split = (summary.split ?? 0) + 1;
    } else if (standing === 'min-stay') {
      summary.known += 1;
      summary.minStay = (summary.minStay ?? 0) + 1;
      const minimum = stayMinimum(unit, nights[0]);
      if (minimum !== undefined && minimum > nights.length) {
        summary.minimums = {
          ...summary.minimums,
          [minimum]: (summary.minimums?.[minimum] ?? 0) + 1,
        };
      }
      if (nightOf(unit, nights[0]).noArrival === true) {
        summary.noArrival = { date: nights[0], units: (summary.noArrival?.units ?? 0) + 1 };
      }
    } else if (standing === 'not-released') summary.notReleased += 1;
    else summary.unknown += 1;
  }
  return summary;
}

const plural = (count: number, noun: UnitNoun) => (count === 1 ? noun.one : noun.many);
const span = (nights: number) => (nights === 1 ? '1 night' : `all ${nights} nights`);

/**
 * The summary line, counting only units whose known nights settle the stay: "8 of 20 sites
 * free for all 2 nights". A provider that counts its units (`freeUnits`) gives no total, so
 * its line counts what is free as Explore does: "51 spots free for all 2 nights", or "No spots
 * free for all 2 nights", never "of M". With none settled, it says why: the nights are not
 * released yet, or `source` (the provider's short name) did not say.
 */
export function summaryLine(summary: AvailabilitySummary, noun: UnitNoun, source: string): string {
  const { freeUnits } = summary;
  if (summary.known > 0 && freeUnits !== undefined) {
    const free = freeUnits > 0 ? `${freeUnits} ${plural(freeUnits, noun)}` : `No ${noun.many}`;
    return `${free} free for ${span(summary.nights)}`;
  }
  if (summary.known > 0) {
    return `${summary.fully} of ${summary.known} ${plural(summary.known, noun)} free for ${span(
      summary.nights
    )}`;
  }
  if (summary.notReleased > 0) return "These nights aren't released for booking yet";
  return `${source} didn't say which nights are free; check on ${source}`;
}

/** "Sat 25 Sep" (design-language.md, "Voice and tone"). */
function dayLabel(date: string): string {
  return format(parseIsoDate(date), 'EEE d MMM');
}

/** The units the summary line leaves out, and why. */
export function summaryNotes(
  summary: AvailabilitySummary,
  noun: UnitNoun,
  source: string
): string[] {
  const notes: string[] = [];
  const { notReleased, unknown } = summary;
  if ((summary.split ?? 0) > 0) {
    notes.push(`Free on some nights, but not on one ${noun.one} for the whole stay.`);
  }
  const minimums = Object.entries(summary.minimums ?? {})
    .map(([minimum, count]) => [Number(minimum), count] as const)
    .sort(([a], [b]) => a - b);
  for (const [minimum, count] of minimums) {
    notes.push(
      `${count} ${plural(count, noun)} ${count === 1 ? 'needs' : 'need'} a stay of at least ${minimum} nights.`
    );
  }
  if (summary.noArrival) {
    const { date, units } = summary.noArrival;
    notes.push(
      units === summary.total
        ? `No arrivals on ${dayLabel(date)}.`
        : `${units} ${plural(units, noun)} ${units === 1 ? 'takes' : 'take'} no arrivals on ${dayLabel(date)}.`
    );
  }
  if (notReleased > 0 && summary.known > 0) {
    notes.push(
      `${notReleased} more ${plural(notReleased, noun)} ${
        notReleased === 1 ? 'has' : 'have'
      } nights that aren't released yet.`
    );
  }
  if (unknown > 0 && (summary.known > 0 || notReleased > 0)) {
    notes.push(
      `${source} didn't say which nights are free for ${unknown} more ${plural(unknown, noun)}.`
    );
  }
  return notes;
}

/** Why "Fully available only" shows no rows, and what to do about it. */
export function noFullRowsMessage(summary: AvailabilitySummary, noun: UnitNoun): string {
  const parts: string[] = [];
  if (summary.known > 0) parts.push(`No ${noun.many} are free for ${span(summary.nights)}.`);
  if (summary.partly > 0) {
    parts.push(`Turn off "Fully available only" to see ${noun.many} free for some of them.`);
  } else if (summary.notReleased + summary.unknown + (summary.minStay ?? 0) > 0) {
    parts.push(`Turn off "Fully available only" to see each ${noun.one}'s nights.`);
  }
  return parts.join(' ');
}

/** "$30", or "$30.50" when there are cents. */
export function formatPrice(amount: number, currency = 'AUD'): string {
  const cents = Math.round(amount * 100) % 100 !== 0;
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(amount);
}

export const NIGHT_STATE_LABELS: Record<NightState, string> = {
  available: 'Available',
  booked: 'Booked',
  closed: 'Closed',
  'not-released': 'Not released yet',
  unknown: 'Unknown',
};

/** A split night in words: "Free on another site". */
export function splitNightLabel(noun: UnitNoun = DEFAULT_UNIT_NOUN): string {
  return `Free on another ${noun.one}`;
}

/** The key's words for a night refused under the provider's stay rules. */
export const MIN_STAY_LEGEND = 'Free, stay rules apply';

/**
 * Which stay rules a `min-stay` night has, in words: "3-night minimum", "no arrivals this day",
 * "no departures this day", or "stay rules apply" when the provider names none. The minimum is
 * named only when it is more than `stayNights`, so a stay refused as too long gets no number.
 */
export function minStayRules(night: NightStatus, stayNights?: number): string {
  const rules: string[] = [];
  const minimum = wholeNights(night.minNights);
  if (minimum !== undefined && minimum > Math.max(1, stayNights ?? 1)) {
    rules.push(`${minimum}-night minimum`);
  }
  if (night.noArrival === true && night.noDeparture === true) {
    rules.push('no arrivals or departures this day');
  } else if (night.noArrival === true) rules.push('no arrivals this day');
  else if (night.noDeparture === true) rules.push('no departures this day');
  return rules.length > 0 ? rules.join(', ') : 'stay rules apply';
}

/**
 * What a cell says. `label` is the whole state in words ("Available, $30"), for screen
 * readers; `short` is the little text shown beside the icon (the price), if any. A night
 * refused under the stay rules says which ("Available, 3-night minimum"), with no price;
 * `stayNights` is the stay's length, for that.
 */
export function nightCellText(
  night: NightStatus,
  currency?: string,
  noun: UnitNoun = DEFAULT_UNIT_NOUN,
  stayNights?: number
): { label: string; short?: string } {
  if (isSplitNight(night)) return { label: splitNightLabel(noun) };
  if (isMinStayNight(night)) {
    return { label: `${NIGHT_STATE_LABELS.available}, ${minStayRules(night, stayNights)}` };
  }
  const label = NIGHT_STATE_LABELS[night.state];
  if (night.state === 'available' && night.price !== undefined && Number.isFinite(night.price)) {
    const price = formatPrice(night.price, currency);
    return { label: `${label}, ${price}`, short: price };
  }
  return { label };
}

/**
 * A night's column heading: "Fri 3", with the month on the first night and on the first of a
 * new month ("Sat 31 Oct", "Sun 1 Nov").
 */
export function nightHeading(date: string, previous?: string): string {
  const day = parseIsoDate(date);
  const newMonth = !previous || previous.slice(0, 7) !== date.slice(0, 7);
  return format(day, newMonth ? 'EEE d MMM' : 'EEE d');
}

/**
 * A stay's dates in short: "6–8 Nov", "30 Oct – 2 Nov", or "30 Dec 2026 – 2 Jan 2027" across
 * years (design-language.md, "Voice and tone").
 */
export function stayRangeLabel(arrival: string, departure: string): string {
  const from = parseIsoDate(arrival);
  const to = parseIsoDate(departure);
  if (arrival.slice(0, 4) !== departure.slice(0, 4)) {
    return `${format(from, 'd MMM yyyy')} – ${format(to, 'd MMM yyyy')}`;
  }
  if (arrival.slice(0, 7) !== departure.slice(0, 7)) {
    return `${format(from, 'd MMM')} – ${format(to, 'd MMM')}`;
  }
  return `${format(from, 'd')}–${format(to, 'd MMM')}`;
}
