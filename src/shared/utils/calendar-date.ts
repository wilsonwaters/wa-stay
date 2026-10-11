/**
 * Calendar dates: a day on the calendar, written `YYYY-MM-DD`, with no time and no zone
 * (architecture-notes §2 "Stay", §5). Arrival and departure dates are calendar dates.
 *
 * Everything here is pure and independent of the host time zone: dates are parsed from
 * their digits and counted in whole UTC days, never through `new Date(string)` or local
 * `getDate()`. "Today" is always asked for in a named zone (`todayIn`), because it depends
 * on where the provider is, not where the computer is.
 *
 * No node or electron imports: the renderer compiles this file too.
 */

/** A calendar date written `YYYY-MM-DD`. */
export type CalendarDate = string;

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Milliseconds of UTC midnight on the date, or NaN when it is not a real calendar date. */
function utcMidnight(value: string): number {
  const match = PATTERN.exec(value);
  if (!match) return NaN;
  const [year, month, day] = match.slice(1).map(Number);
  // setUTCFullYear, unlike Date.UTC, does not map years 0-99 to 1900-1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? date.getTime() : NaN;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function fromUtcMidnight(ms: number): CalendarDate {
  const date = new Date(ms);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** Days since 1970-01-01. Throws a `RangeError` for anything that is not a calendar date. */
function dayNumber(value: string): number {
  const ms = utcMidnight(value);
  if (Number.isNaN(ms)) throw new RangeError(`Not a calendar date (YYYY-MM-DD): "${value}"`);
  return Math.round(ms / DAY_MS);
}

/** True for a real calendar date written `YYYY-MM-DD` (`2026-02-30` is not one). */
export function isCalendarDate(value: string): boolean {
  return typeof value === 'string' && !Number.isNaN(utcMidnight(value));
}

/** The date `days` days after `date` (before it when negative). */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  if (!Number.isInteger(days)) throw new RangeError(`Not a whole number of days: ${days}`);
  return fromUtcMidnight((dayNumber(date) + days) * DAY_MS);
}

/** Nights from `arrival` to `departure`: 2 for 12 → 14 Dec. Negative when departure is earlier. */
export function nightsBetween(arrival: CalendarDate, departure: CalendarDate): number {
  return dayNumber(departure) - dayNumber(arrival);
}

/**
 * Each night of a stay, by the date it starts: `arrival` up to but not including
 * `departure`. Empty when departure is not after arrival.
 */
export function eachNight(arrival: CalendarDate, departure: CalendarDate): CalendarDate[] {
  const first = dayNumber(arrival);
  const count = dayNumber(departure) - first;
  return Array.from({ length: Math.max(0, count) }, (_, i) =>
    fromUtcMidnight((first + i) * DAY_MS)
  );
}

/** Sort comparator: negative when `a` is earlier, 0 when equal, positive when later. */
export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return Math.sign(dayNumber(a) - dayNumber(b));
}

/** The calendar date it is in `timeZone` (an IANA zone such as `Australia/Perth`) at `now`. */
export function todayIn(timeZone: string, now: Date = new Date()): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  return `${pad(part('year'), 4)}-${pad(part('month'), 2)}-${pad(part('day'), 2)}`;
}

/** The time-zone offset (ms ahead of UTC) of `timeZone` at `at`. */
function zoneOffsetMs(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  const wallClock = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second')
  );
  return wallClock - Math.floor(at / 1000) * 1000;
}

/** The instant it is `time` on calendar date `date` in `timeZone`. */
export function zonedInstant(
  date: CalendarDate,
  time: { hour: number; minute: number },
  timeZone: string
): Date {
  const [year, month, day] = date.split('-').map(Number);
  const wallClock = Date.UTC(year, month - 1, day, time.hour, time.minute);
  // Twice, so a guess on the far side of a daylight-saving change settles.
  let instant = wallClock - zoneOffsetMs(timeZone, wallClock);
  instant = wallClock - zoneOffsetMs(timeZone, instant);
  return new Date(instant);
}
