/**
 * Stay Rottnest's Open Days: when each month's stays go on sale. Facts only, with no request
 * (`ai-state/research/rottnest-release-rules.md`, read 17 Oct 2026).
 *
 * - **The rule.** On the first Wednesday of month M, at 8:30 am Perth time, the whole of month
 *   M+8 opens ("nine months ahead"). When that Wednesday is New Year's Day, the Open Day is the
 *   next Wednesday (8 Jan 2025). It held for all 54 dated Open Days from 2023 to 2027.
 * - **The waiting room** (Queue-it, with an SMS passcode) opens at 6 am, and everyone in it
 *   before 8:30 gets a random place.
 * - **`PUBLISHED_OPEN_DAYS`**: the dates RIA's booking guides publish, each with the stay month
 *   it opens. A published date wins over the rule, so a postponed Open Day (1 June 2022 moved to
 *   8 June after an outage) is a row here. After `CALENDAR_CONFIRMED_UNTIL` the rule's dates
 *   are "expected".
 *
 * The module asks this for two things: the client sends nothing on an Open Day morning
 * (`isOpenDayQuiet`, `ai-state/research/rottnest-terms.md` §9.4), and the release policy and
 * the rules (RI5) time a stay.
 *
 * **Upkeep.** When RIA publishes its next booking guide index
 * (`stay_rottnest_booking_guide.pdf`, linked from Stay Rottnest's Open Days page), add each new
 * Open Day to `PUBLISHED_OPEN_DAYS` with its stay month, move `CALENDAR_CONFIRMED_UNTIL` to the
 * last one, and extend `tests/unit/providers/rottnest/open-days.test.ts`. Read it in a browser:
 * nothing in WA Stay fetches it.
 */

import {
  addDays,
  compareDates,
  zonedInstant,
  type CalendarDate,
} from '@shared/utils/calendar-date';

/** Stay Rottnest's time zone: Open Days, check-in times and the quiet hours are Perth's. */
export const ROTTNEST_TIME_ZONE = 'Australia/Perth';

/** When bookings open on an Open Day, Perth time. */
export const OPEN_DAY_BOOKINGS_OPEN = { hour: 8, minute: 30 } as const;

/** When the waiting room opens on an Open Day, Perth time. */
export const OPEN_DAY_WAITING_ROOM_OPENS = { hour: 6, minute: 0 } as const;

/**
 * The quiet hours of an Open Day, Perth time: nothing is sent to Stay Rottnest from half an hour
 * before the waiting room opens until noon, while its queue and passcode are in force.
 */
export const OPEN_DAY_QUIET = { from: { hour: 5, minute: 30 }, until: { hour: 12, minute: 0 } };

/** How many months ahead an Open Day opens: the first Wednesday of M opens month M+8. */
export const OPEN_DAY_MONTHS_AHEAD = 8;

export interface OpenDay {
  /** The Open Day, a calendar date in Perth. */
  date: CalendarDate;
  /** The month it opens, `YYYY-MM`. */
  stayMonth: string;
}

/**
 * The Open Days RIA has published (its booking guide index of 25 Sep 2026, and each month's
 * guide), in date order: they win over the rule.
 */
export const PUBLISHED_OPEN_DAYS: readonly OpenDay[] = [
  { date: '2026-10-07', stayMonth: '2027-06' },
  { date: '2026-11-04', stayMonth: '2027-07' },
  { date: '2026-12-02', stayMonth: '2027-08' },
  { date: '2027-01-06', stayMonth: '2027-09' },
  { date: '2027-02-03', stayMonth: '2027-10' },
  { date: '2027-03-03', stayMonth: '2027-11' },
  { date: '2027-04-07', stayMonth: '2027-12' },
  { date: '2027-05-05', stayMonth: '2028-01' },
  { date: '2027-06-02', stayMonth: '2028-02' },
  { date: '2027-07-07', stayMonth: '2028-03' },
  { date: '2027-08-04', stayMonth: '2028-04' },
  { date: '2027-09-01', stayMonth: '2028-05' },
  { date: '2027-10-06', stayMonth: '2028-06' },
];

/** The last Open Day RIA has published; later ones are the rule's, "expected". */
export const CALENDAR_CONFIRMED_UNTIL: CalendarDate = '2027-10-06';

const PUBLISHED_BY_STAY_MONTH = new Map(PUBLISHED_OPEN_DAYS.map((day) => [day.stayMonth, day]));
const PUBLISHED_DATES = new Set(PUBLISHED_OPEN_DAYS.map((day) => day.date));

const pad = (value: number): string => String(value).padStart(2, '0');

/** `YYYY-MM` plus `months`. */
export function addMonths(month: string, months: number): string {
  const [year, m] = month.split('-').map(Number);
  const index = year * 12 + (m - 1) + months;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** The first Wednesday of `month` (`YYYY-MM`), or the next one when that is 1 January. */
export function ruleOpenDayIn(month: string): CalendarDate {
  const first = `${month}-01`;
  // 0 Sunday … 3 Wednesday, by the calendar (no time zone: a date has no time)
  const weekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const day = addDays(first, (3 - weekday + 7) % 7);
  return day.endsWith('-01-01') ? addDays(day, 7) : day;
}

/** The Open Day that opens `stayMonth` (`YYYY-MM`): the published one, else the rule's. */
export function openDayFor(stayMonth: string): OpenDay & { expected: boolean } {
  const published = PUBLISHED_BY_STAY_MONTH.get(stayMonth);
  if (published) return { ...published, expected: false };
  const date = ruleOpenDayIn(addMonths(stayMonth, -OPEN_DAY_MONTHS_AHEAD));
  return { date, stayMonth, expected: compareDates(date, CALENDAR_CONFIRMED_UNTIL) > 0 };
}

/** Whether `date` is an Open Day: a published one, or the rule's in a month past the table. */
export function isOpenDay(date: CalendarDate): boolean {
  if (PUBLISHED_DATES.has(date)) return true;
  const month = date.slice(0, 7);
  const opens = addMonths(month, OPEN_DAY_MONTHS_AHEAD);
  // A month the table covers has its published date; elsewhere the rule decides
  if (PUBLISHED_BY_STAY_MONTH.has(opens)) return false;
  return ruleOpenDayIn(month) === date;
}

/** When bookings for `stayMonth` open: its Open Day at 8:30 am Perth. */
export function bookingsOpenAt(stayMonth: string): Date {
  return zonedInstant(openDayFor(stayMonth).date, OPEN_DAY_BOOKINGS_OPEN, ROTTNEST_TIME_ZONE);
}

/**
 * The end of the quiet hours `now` falls in (noon Perth on an Open Day), or undefined when
 * `now` is outside them.
 */
export function openDayQuietUntil(now: Date, today: CalendarDate): Date | undefined {
  if (!isOpenDay(today)) return undefined;
  const from = zonedInstant(today, OPEN_DAY_QUIET.from, ROTTNEST_TIME_ZONE);
  const until = zonedInstant(today, OPEN_DAY_QUIET.until, ROTTNEST_TIME_ZONE);
  return now >= from && now < until ? until : undefined;
}
