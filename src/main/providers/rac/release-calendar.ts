/**
 * RAC's school-holiday release calendar: the WA school-holiday periods, and for each one when
 * RAC opens it for booking. Facts only, with no copy of RAC's. `release-policy.ts` reads it.
 *
 * Outside these periods a night opens when it comes into RAC's rolling window, 364 days ahead
 * (`ai-state/research/rac-booking-flow.md` §4). Inside one, RAC holds the nights back and
 * releases the whole period on a set day, at each park's own hour (`RacPark.schoolHolidays` in
 * `parks.ts`), after a 48-hour member pre-sale (§5).
 *
 * **Sources**, read 17 Oct 2026:
 * - RAC's school-holiday page (parksandresorts.rac.com.au/school-holiday-bookings/), as the
 *   research recorded it on 16 Oct 2026: each announced period's nights, and its member pre-sale
 *   and public release days.
 * - The WA Department of Education's "Future term dates" page
 *   (education.wa.edu.au/future-term-dates, the dates published in the Government Gazette for
 *   public schools; one read): the breaks between terms, for the periods RAC had already
 *   released, or has not announced yet.
 *
 * **Periods.** A period's nights run from `first` to `last`, both included (a stay touches it
 * when any of its nights is in it). An announced period uses RAC's own nights, which differ
 * from the Department's break (its first to last day with no school):
 * - Spring 2027: RAC's 24 Sep–9 Oct, the break 25 Sep–10 Oct (both ends a day earlier);
 * - Summer 2027–28: RAC's 17 Dec–31 Jan, the break 17 Dec–1 Feb (ends a day earlier);
 * - Autumn 2028: RAC's 7–24 Apr, the break 8–23 Apr (a day wider at both ends).
 *
 * So RAC's edges cannot be told from the Department's. An `'on-sale'` period uses the break as
 * published (it times nothing). An `'unannounced'` one starts a night earlier, on the last
 * school day (a Friday, or the Thursday that ends term 4), so a stay on its uncertain first
 * night is refused rather than timed by the rolling window alone.
 *
 * Each period has one release state:
 * - `{ memberPreSale, publicRelease }`: the calendar days RAC announced, Perth time;
 * - `'on-sale'`: released before this calendar was written, so only the rolling window applies;
 * - `'unannounced'`: RAC has not said when it opens; the release policy refuses a stay in it.
 *
 * **Upkeep.** Update this file by hand when RAC announces a release, and ship it in an app
 * update (an armed snipe asks for its release again at its next arm):
 * 1. Read RAC's school-holiday page. For each period it lists, set `first` and `last` to its
 *    nights, and `release` to its member pre-sale and public release days (`YYYY-MM-DD`). A
 *    period whose public release has passed may become `'on-sale'`.
 * 2. Read the Department's "Future term dates" page. Add the next breaks as `'unannounced'`
 *    periods, in date order, each from the last day of term, and move `CALENDAR_COVERS_UNTIL`
 *    to the last night they cover.
 * 3. A park whose release hour, or part in the pre-sale, changes is updated in `parks.ts`.
 * 4. Extend `tests/unit/providers/rac/release-calendar.test.ts` (each period's nights and
 *    state) and `release-policy.test.ts` (an instant for the new release, member and public).
 */

import { compareDates, type CalendarDate } from '@shared/utils/calendar-date';

/** The days RAC announced for a period: when its member pre-sale and public release open. */
export interface AnnouncedRelease {
  /** The day the 48-hour member pre-sale opens, at the park's hour. */
  memberPreSale: CalendarDate;
  /** The day the period opens to everyone, at the park's hour. */
  publicRelease: CalendarDate;
}

export type PeriodRelease = AnnouncedRelease | 'on-sale' | 'unannounced';

export interface SchoolHolidayPeriod {
  /** The holidays, for logs and tests ("Summer 2027–28"). */
  name: string;
  /** The period's first night. */
  first: CalendarDate;
  /** The period's last night, included. */
  last: CalendarDate;
  release: PeriodRelease;
}

/** The WA school-holiday periods from summer 2026–27 to summer 2028–29, in date order. */
export const SCHOOL_HOLIDAY_PERIODS: readonly SchoolHolidayPeriod[] = [
  // The Department's breaks; RAC released them before this calendar was written.
  { name: 'Summer 2026–27', first: '2026-12-18', last: '2027-01-31', release: 'on-sale' },
  { name: 'Autumn 2027', first: '2027-04-10', last: '2027-04-25', release: 'on-sale' },
  { name: 'Winter 2027', first: '2027-07-03', last: '2027-07-18', release: 'on-sale' },
  // RAC's announced periods, with their nights and release days.
  {
    name: 'Spring 2027',
    first: '2027-09-24',
    last: '2027-10-09',
    release: { memberPreSale: '2026-10-14', publicRelease: '2026-10-16' },
  },
  {
    name: 'Summer 2027–28',
    first: '2027-12-17',
    last: '2028-01-31',
    release: { memberPreSale: '2027-02-03', publicRelease: '2027-02-05' },
  },
  {
    name: 'Autumn 2028',
    first: '2028-04-07',
    last: '2028-04-24',
    release: { memberPreSale: '2027-04-28', publicRelease: '2027-04-30' },
  },
  // RAC has not announced them: from the last school day to the Department's last break day.
  { name: 'Winter 2028', first: '2028-06-30', last: '2028-07-16', release: 'unannounced' },
  { name: 'Spring 2028', first: '2028-09-22', last: '2028-10-08', release: 'unannounced' },
  { name: 'Summer 2028–29', first: '2028-12-14', last: '2029-01-30', release: 'unannounced' },
];

/**
 * The last night the period list covers: the end of the summer 2028–29 break (the Department's
 * 2029 term 1 starts on 31 Jan 2029). A later night may be in holidays it does not know.
 */
export const CALENDAR_COVERS_UNTIL: CalendarDate = '2029-01-30';

/** Whether a period's release is one RAC announced (with its days). */
export function isAnnounced(release: PeriodRelease): release is AnnouncedRelease {
  return typeof release === 'object';
}

/** The school-holiday period the night `date` is in, if any. */
export function periodOf(date: CalendarDate): SchoolHolidayPeriod | undefined {
  return SCHOOL_HOLIDAY_PERIODS.find(
    (period) => compareDates(period.first, date) <= 0 && compareDates(date, period.last) <= 0
  );
}

/** Whether the calendar knows the holidays for the night `date`. */
export function isCovered(date: CalendarDate): boolean {
  return compareDates(date, CALENDAR_COVERS_UNTIL) <= 0;
}
