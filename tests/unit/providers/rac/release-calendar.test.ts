/**
 * RAC's school-holiday release calendar (`src/main/providers/rac/release-calendar.ts`): the
 * periods from summer 2026–27 to summer 2028–29, from RAC's school-holiday page (the announced
 * ones) and the WA Department of Education's term dates (the rest, an unannounced one from the
 * last school day); each night in at most one period, both ends included; and how far the
 * calendar covers.
 */

import {
  CALENDAR_COVERS_UNTIL,
  isAnnounced,
  isCovered,
  periodOf,
  SCHOOL_HOLIDAY_PERIODS,
} from '@main/providers/rac/release-calendar';
import { addDays, compareDates, isCalendarDate } from '@shared/utils/calendar-date';

describe('RAC release calendar', () => {
  it('lists every WA school-holiday period from summer 2026–27 to summer 2028–29, with its state', () => {
    expect(
      SCHOOL_HOLIDAY_PERIODS.map(({ name, first, last, release }) => [name, first, last, release])
    ).toEqual([
      ['Summer 2026–27', '2026-12-18', '2027-01-31', 'on-sale'],
      ['Autumn 2027', '2027-04-10', '2027-04-25', 'on-sale'],
      ['Winter 2027', '2027-07-03', '2027-07-18', 'on-sale'],
      [
        'Spring 2027',
        '2027-09-24',
        '2027-10-09',
        { memberPreSale: '2026-10-14', publicRelease: '2026-10-16' },
      ],
      [
        'Summer 2027–28',
        '2027-12-17',
        '2028-01-31',
        { memberPreSale: '2027-02-03', publicRelease: '2027-02-05' },
      ],
      [
        'Autumn 2028',
        '2028-04-07',
        '2028-04-24',
        { memberPreSale: '2027-04-28', publicRelease: '2027-04-30' },
      ],
      // From the last school day (Fri 30 Jun, Fri 22 Sep, Thu 14 Dec) to the last break day
      ['Winter 2028', '2028-06-30', '2028-07-16', 'unannounced'],
      ['Spring 2028', '2028-09-22', '2028-10-08', 'unannounced'],
      ['Summer 2028–29', '2028-12-14', '2029-01-30', 'unannounced'],
    ]);
  });

  it('has real dates, in order, with no overlap, and covers until the last night of its last period', () => {
    let previous: string | undefined;
    for (const period of SCHOOL_HOLIDAY_PERIODS) {
      expect([period.first, period.last].every(isCalendarDate)).toBe(true);
      expect(compareDates(period.first, period.last)).toBeLessThan(0);
      if (previous) expect(compareDates(previous, period.first)).toBeLessThan(0);
      previous = period.last;
    }
    expect(CALENDAR_COVERS_UNTIL).toBe(SCHOOL_HOLIDAY_PERIODS.at(-1)!.last);
  });

  it('opens each announced period to members exactly two days before everyone, after the period is set and before it starts', () => {
    const announced = SCHOOL_HOLIDAY_PERIODS.filter((period) => isAnnounced(period.release));
    expect(announced).toHaveLength(3);
    for (const { first, release } of announced) {
      if (!isAnnounced(release)) throw new Error('not announced');
      expect(addDays(release.memberPreSale, 2)).toBe(release.publicRelease);
      expect(compareDates(release.publicRelease, first)).toBeLessThan(0);
    }
  });

  it.each([
    ['2027-12-16', undefined],
    ['2027-12-17', 'Summer 2027–28'],
    ['2028-01-01', 'Summer 2027–28'],
    ['2028-01-31', 'Summer 2027–28'],
    ['2028-02-01', undefined],
    ['2027-09-23', undefined],
    ['2027-09-24', 'Spring 2027'],
    ['2027-10-09', 'Spring 2027'],
    ['2027-10-10', undefined],
    ['2028-04-07', 'Autumn 2028'],
    ['2028-04-24', 'Autumn 2028'],
    ['2028-06-29', undefined],
    ['2028-06-30', 'Winter 2028'],
    ['2028-09-21', undefined],
    ['2028-09-22', 'Spring 2028'],
    ['2028-12-13', undefined],
    ['2028-12-14', 'Summer 2028–29'],
    ['2029-01-30', 'Summer 2028–29'],
    ['2029-01-31', undefined],
  ])('puts the night of %s in %s (both ends included)', (night, name) => {
    expect(periodOf(night)?.name).toBe(name);
  });

  it('covers nights up to CALENDAR_COVERS_UNTIL, and not the night after', () => {
    expect(CALENDAR_COVERS_UNTIL).toBe('2029-01-30');
    expect(isCovered('2026-10-17')).toBe(true);
    expect(isCovered(CALENDAR_COVERS_UNTIL)).toBe(true);
    expect(isCovered(addDays(CALENDAR_COVERS_UNTIL, 1))).toBe(false);
  });
});
