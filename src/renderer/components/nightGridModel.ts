/**
 * The facts NightGrid shows, worked out from a provider's per-night availability: which units
 * are free for the whole stay, the summary line, each cell's words, and how dates read. Pure.
 */

import { format } from 'date-fns';
import type { NightState, NightStatus, UnitAvailability } from '../../shared/types/provider.types';
import { eachNight } from '../../shared/utils/calendar-date';
import { parseIsoDate } from './ui/calendar';

/** What one unit is called, and several: `{ one: 'site', many: 'sites' }`. */
export interface UnitNoun {
  one: string;
  many: string;
}

export const DEFAULT_UNIT_NOUN: UnitNoun = { one: 'unit', many: 'units' };

/** Each night of the stay, by the date it starts: the arrival up to, not including, departure. */
export function stayNights(arrival: string, departure: string): string[] {
  return eachNight(arrival, departure);
}

/** A unit's state on one night; a night the provider did not report is `unknown`. */
export function nightOf(unit: UnitAvailability, date: string): NightStatus {
  return unit.nights.find((night) => night.date === date) ?? { date, state: 'unknown' };
}

/** Free on every night of the stay. */
export function isFullyAvailable(unit: UnitAvailability, nights: readonly string[]): boolean {
  return nights.length > 0 && nights.every((date) => nightOf(unit, date).state === 'available');
}

/**
 * A night free, but not on the same unit as the available nights next to it (the provider's
 * `reason: 'split'`): it settles the stay as not free on one unit, without being taken.
 */
export function isSplitNight(night: NightStatus): boolean {
  return night.reason === 'split';
}

/**
 * What a unit's nights say about the whole stay. Only known nights decide: a night the
 * provider did not report, or one not released yet, never counts as taken.
 * - `free`: every night is available;
 * - `taken`: at least one night is booked or closed;
 * - `split`: nothing taken, but some nights are free only on another unit than the nights
 *   next to them, so no one unit is free for the whole stay;
 * - `not-released`: nothing taken, but some nights are not released for booking yet;
 * - `unknown`: nothing taken or unreleased, but the provider did not say about some nights.
 */
export type UnitStanding = 'free' | 'taken' | 'split' | 'not-released' | 'unknown';

export function unitStanding(unit: UnitAvailability, nights: readonly string[]): UnitStanding {
  const states = nights.map((date) => nightOf(unit, date).state);
  if (states.length > 0 && states.every((state) => state === 'available')) return 'free';
  if (states.some((state) => state === 'booked' || state === 'closed')) return 'taken';
  if (nights.some((date) => isSplitNight(nightOf(unit, date)))) return 'split';
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
  /** Taken on some nights, free on others. */
  partly: number;
  /** Not settled yet: some nights are not released for booking. */
  notReleased: number;
  /** Not settled: the provider did not say about some nights. */
  unknown: number;
  /** Of `known`: free on some nights, but not on one unit for the whole stay. */
  split?: number;
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
  };
  for (const unit of units) {
    const standing = unitStanding(unit, nights);
    if (standing === 'free') {
      summary.known += 1;
      summary.fully += 1;
    } else if (standing === 'taken') {
      summary.known += 1;
      if (nights.some((date) => nightOf(unit, date).state === 'available')) summary.partly += 1;
    } else if (standing === 'split') {
      summary.known += 1;
      summary.partly += 1;
      summary.split = (summary.split ?? 0) + 1;
    } else if (standing === 'not-released') summary.notReleased += 1;
    else summary.unknown += 1;
  }
  return summary;
}

const plural = (count: number, noun: UnitNoun) => (count === 1 ? noun.one : noun.many);
const span = (nights: number) => (nights === 1 ? '1 night' : `all ${nights} nights`);

/**
 * The summary line, counting only units whose known nights settle the stay: "8 of 20 sites
 * free for all 2 nights". With none settled, it says why: the nights are not released yet,
 * or `source` (the provider's short name) did not say.
 */
export function summaryLine(summary: AvailabilitySummary, noun: UnitNoun, source: string): string {
  if (summary.known > 0) {
    return `${summary.fully} of ${summary.known} ${plural(summary.known, noun)} free for ${span(
      summary.nights
    )}`;
  }
  if (summary.notReleased > 0) return "These nights aren't released for booking yet";
  return `${source} didn't say which nights are free; check on ${source}`;
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
  } else if (summary.notReleased + summary.unknown > 0) {
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

/**
 * What a cell says. `label` is the whole state in words ("Available, $30"), for screen
 * readers; `short` is the little text shown beside the icon (the price), if any.
 */
export function nightCellText(
  night: NightStatus,
  currency?: string,
  noun: UnitNoun = DEFAULT_UNIT_NOUN
): { label: string; short?: string } {
  if (isSplitNight(night)) return { label: splitNightLabel(noun) };
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
