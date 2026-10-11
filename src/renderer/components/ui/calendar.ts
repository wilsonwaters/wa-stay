/**
 * Calendar-date helpers for the date range picker. Values are plain local calendar dates as
 * `YYYY-MM-DD` strings, never `Date` objects or timestamps, so time zones and daylight saving
 * never shift a day. Maths runs through date-fns on local dates.
 */
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

/** A calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

export interface DateRange {
  arrival?: IsoDate;
  departure?: IsoDate;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK = { weekStartsOn: 1 } as const;

/** Parses `YYYY-MM-DD` as a local date at midnight. Throws on anything else. */
export function parseIsoDate(value: IsoDate): Date {
  const match = ISO.exec(value);
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  if (!date || !isValid(date) || format(date, 'yyyy-MM-dd') !== value) {
    throw new Error(`"${value}" is not a calendar date (YYYY-MM-DD)`);
  }
  return date;
}

export function toIsoDate(date: Date): IsoDate {
  return format(date, 'yyyy-MM-dd');
}

export function todayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

export const addDaysIso = (date: IsoDate, days: number): IsoDate =>
  toIsoDate(addDays(parseIsoDate(date), days));

/** Moves by whole months, clamping to the month's last day (31 Jan + 1 month = 28 or 29 Feb). */
export const addMonthsIso = (date: IsoDate, months: number): IsoDate =>
  toIsoDate(addMonths(parseIsoDate(date), months));

export const startOfWeekIso = (date: IsoDate): IsoDate =>
  toIsoDate(startOfWeek(parseIsoDate(date), WEEK));

export const endOfWeekIso = (date: IsoDate): IsoDate =>
  toIsoDate(endOfWeek(parseIsoDate(date), WEEK));

/** The first day of the date's month. */
export const startOfMonthIso = (date: IsoDate): IsoDate =>
  toIsoDate(startOfMonth(parseIsoDate(date)));

/** Nights between two dates (departure − arrival). */
export const nightsBetween = (arrival: IsoDate, departure: IsoDate): number =>
  differenceInCalendarDays(parseIsoDate(departure), parseIsoDate(arrival));

/** ISO strings sort as dates. */
export const compareIso = (a: IsoDate, b: IsoDate): number => (a < b ? -1 : a > b ? 1 : 0);

export function clampIso(date: IsoDate, min?: IsoDate, max?: IsoDate): IsoDate {
  if (min && date < min) return min;
  if (max && date > max) return max;
  return date;
}

/**
 * The weeks of a month, Monday first. Days outside the month are `null`, so every row has
 * seven cells.
 */
export function monthGrid(month: IsoDate): (IsoDate | null)[][] {
  const first = startOfMonth(parseIsoDate(month));
  const last = endOfMonth(first);
  const weeks: (IsoDate | null)[][] = [];
  let day = startOfWeek(first, WEEK);
  while (day <= last) {
    const week: (IsoDate | null)[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day.getMonth() === first.getMonth() ? toIsoDate(day) : null);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export interface RangeRules {
  minDate?: IsoDate;
  maxDate?: IsoDate;
  maxNights?: number;
}

/** True while the next pick sets the departure. */
export const choosingDeparture = (range: DateRange): boolean =>
  Boolean(range.arrival && !range.departure);

/**
 * Whether a day can be picked: inside min/max, and, while choosing the departure, no more
 * than `maxNights` after the arrival. Days on or before the arrival stay pickable: they
 * restart the range.
 */
export function isDayDisabled(date: IsoDate, range: DateRange, rules: RangeRules): boolean {
  if (rules.minDate && date < rules.minDate) return true;
  if (rules.maxDate && date > rules.maxDate) return true;
  if (choosingDeparture(range) && rules.maxNights !== undefined && date > range.arrival!) {
    return nightsBetween(range.arrival!, date) > rules.maxNights;
  }
  return false;
}

/**
 * The range after picking `date`: the first pick sets the arrival, the second the departure.
 * A pick on or before the arrival, or after a complete range, starts again.
 */
export function pickDate(range: DateRange, date: IsoDate): DateRange {
  if (choosingDeparture(range) && date > range.arrival!) {
    return { arrival: range.arrival, departure: date };
  }
  return { arrival: date, departure: undefined };
}

export function isInRange(date: IsoDate, range: DateRange): boolean {
  return Boolean(
    range.arrival && range.departure && date > range.arrival && date < range.departure
  );
}

/** "Friday 3 October 2026", with ", check-in" or ", check-out" when it ends the range. */
export function dayLabel(date: IsoDate, range: DateRange): string {
  const base = format(parseIsoDate(date), 'EEEE d MMMM yyyy');
  if (date === range.arrival) return `${base}, check-in`;
  if (date === range.departure) return `${base}, check-out`;
  return base;
}

export const monthLabel = (month: IsoDate): string => format(parseIsoDate(month), 'MMMM yyyy');

/** "Fri 3 Oct". */
export const shortDay = (date: IsoDate): string => format(parseIsoDate(date), 'EEE d MMM');

/**
 * Two days with their weekdays, the month once when they share it: "Sun 11 – Tue 13 Oct",
 * "Fri 30 Oct – Mon 2 Nov". With `withYear`, the year ends it ("Fri 26 – Mon 29 Mar 2027"), and
 * a range across two years carries both ("Wed 30 Dec 2026 – Fri 1 Jan 2027"). The one format
 * for a stay's dates: the search pill, the date fields, and watch and snipe cards.
 */
export function shortRange(arrival: IsoDate, departure: IsoDate, withYear = false): string {
  const end = format(parseIsoDate(departure), withYear ? 'EEE d MMM yyyy' : 'EEE d MMM');
  if (arrival.slice(0, 7) === departure.slice(0, 7)) {
    return `${format(parseIsoDate(arrival), 'EEE d')} – ${end}`;
  }
  const bothYears = withYear && arrival.slice(0, 4) !== departure.slice(0, 4);
  return `${format(parseIsoDate(arrival), bothYears ? 'EEE d MMM yyyy' : 'EEE d MMM')} – ${end}`;
}

export const nightsLabel = (nights: number): string =>
  `${nights} ${nights === 1 ? 'night' : 'nights'}`;

/** "Fri 3 – Sun 5 Oct · 2 nights", or as much of it as is chosen. */
export function rangeSummary(range: DateRange): string | undefined {
  if (!range.arrival) return undefined;
  if (!range.departure) return `${shortDay(range.arrival)} – choose check-out`;
  return `${shortRange(range.arrival, range.departure)} · ${nightsLabel(
    nightsBetween(range.arrival, range.departure)
  )}`;
}
