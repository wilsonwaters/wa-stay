/**
 * Whether a Stay Rottnest stay is on sale yet, and when it opens: pure, with no request
 * (`ai-state/research/rottnest-release-rules.md`).
 *
 * - **A month opens on its Open Day** at 8:30 am Perth (`open-days.ts`). A stay is on sale
 *   once every month it has a night in is open.
 * - **The 5/3 rule** (T&Cs §8(d)): with at least 5 nights in a month that is open, a stay may
 *   take up to 3 nights of the next month before that month's own Open Day. It opens with its
 *   arrival month then. A booking guide can suspend it for the month after ("There will be no
 *   bookings into January 2027 on this Open Day": `carryOverInto`), and then the stay waits
 *   for the later month's Open Day. A month with no guide yet is taken to allow it, as RIA's
 *   terms say, and its date is marked expected.
 */

import { eachNight, todayIn, type CalendarDate } from '@shared/utils/calendar-date';
import { addMonths, bookingsOpenAt, openDayFor, ROTTNEST_TIME_ZONE } from './open-days';

/** The 5/3 rule: this many nights in the open month… */
export const CARRY_OVER_MIN_NIGHTS = 5;
/** …let a stay take at most this many nights of the next month. */
export const CARRY_OVER_MAX_NIGHTS = 3;

/** Whether a month's booking guide lets stays carry 5/3 into the next month. */
export type CarryOver = 'allowed' | 'suspended' | 'unknown';

export interface ReleaseStatus {
  open: boolean;
  /** When the stay goes on sale (while not `open`), or went on sale. */
  opensAt: Date;
  /** The month whose Open Day decides it, `YYYY-MM`. */
  month: string;
  /** The date is the rule's, past RIA's published calendar or a guide not out yet. */
  expected: boolean;
  /** The stay takes up to 3 nights of a month before that month opens (the 5/3 rule). */
  carriesOver?: { into: string };
}

const monthOf = (date: CalendarDate): string => date.slice(0, 7);

/**
 * The stay's release: open or not at `now`, and when. `carryOverInto(month)` says whether the
 * guide for stays in `month` lets them carry 5/3 into the month after.
 */
export function releaseStatus(
  stay: { arrival: CalendarDate; departure: CalendarDate },
  now: Date,
  carryOverInto: (month: string) => CarryOver
): ReleaseStatus {
  const nights = eachNight(stay.arrival, stay.departure);
  const months = [...new Set(nights.map(monthOf))];
  const first = months[0] ?? monthOf(stay.arrival);
  const last = months[months.length - 1] ?? first;

  let month = last;
  let carriesOver: ReleaseStatus['carriesOver'];
  let expected = openDayFor(last).expected;
  // Only a stay whose last month is not open yet can use the 5/3 rule to open sooner
  if (months.length === 2 && months[1] === addMonths(first, 1) && bookingsOpenAt(last) > now) {
    const inFirst = nights.filter((night) => monthOf(night) === first).length;
    const inNext = nights.length - inFirst;
    const carryOver = carryOverInto(first);
    if (
      inFirst >= CARRY_OVER_MIN_NIGHTS &&
      inNext <= CARRY_OVER_MAX_NIGHTS &&
      carryOver !== 'suspended' &&
      bookingsOpenAt(first) < bookingsOpenAt(last)
    ) {
      month = first;
      carriesOver = { into: last };
      expected = openDayFor(first).expected || carryOver === 'unknown';
    }
  }
  const opensAt = bookingsOpenAt(month);
  const status: ReleaseStatus = { open: opensAt <= now, opensAt, month, expected };
  if (carriesOver) status.carriesOver = carriesOver;
  return status;
}

/**
 * How Stay Rottnest's stays go on sale, for a place's booking rules: the next Open Day and the
 * month it opens, as of `now`.
 */
export function describeOpenDays(now: Date): string {
  // The first month not yet open, and its Open Day
  let month = monthOfDate(now);
  while (bookingsOpenAt(month) <= now) month = addMonths(month, 1);
  const next = openDayFor(month);
  const when = `${perthDay(bookingsOpenAt(month))}, 8:30 am${next.expected ? ' (expected)' : ''}`;
  return (
    "Stays go on sale a month at a time on Stay Rottnest's Open Days: the first Wednesday of " +
    `each month, at 8:30 am Perth time, opens the month eight months on. The next is ${when}, ` +
    `for ${monthName(month)}. Its waiting room opens at 6 am, and everyone in it before 8:30 ` +
    'gets a random place in the queue.'
  );
}

/** The month (`YYYY-MM`) an instant falls in, in Perth. */
function monthOfDate(at: Date): string {
  return todayIn(ROTTNEST_TIME_ZONE, at).slice(0, 7);
}

/** "Wed 4 Nov 2026", in Perth. */
export function perthDay(at: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-AU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: ROTTNEST_TIME_ZONE,
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value])
  );
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.year}`;
}

/** "July 2027". */
export function monthName(month: string): string {
  return new Intl.DateTimeFormat('en-AU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/** The release in a sentence: "On sale." or "Opens Wed 4 Nov 2026, 8:30 am, …". */
export function releaseText(status: ReleaseStatus): string {
  const carry = status.carriesOver
    ? ` With 5 nights in ${monthName(status.month)}, it can take up to 3 nights in ${monthName(status.carriesOver.into)}.`
    : '';
  if (status.open) return `On sale.${carry}`;
  const when = `${perthDay(status.opensAt)}, 8:30 am`;
  return (
    `${status.expected ? 'Expected to open' : 'Opens'} ${when}, Stay Rottnest's Open Day for ` +
    `${monthName(status.month)}. Its waiting room opens at 6 am.${carry}`
  );
}
