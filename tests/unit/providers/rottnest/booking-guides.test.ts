/**
 * Stay Rottnest's booking guides and WA's public holidays, as facts
 * (`src/main/providers/rottnest/booking-guides.ts`, `public-holidays.ts`): every guide is for
 * the month its Open Day opens, in order; every block group's blocks are real stays of at most
 * 14 nights, back to back, filling its period; every precinct and room type named is in the
 * seed; ranges are in order; and the holidays are dated, unique and in order.
 */

import { BOOKING_GUIDES } from '@main/providers/rottnest/booking-guides';
import { openDayFor } from '@main/providers/rottnest/open-days';
import { rottnestPrecinct, roomTypeOf } from '@main/providers/rottnest/precincts';
import { WA_PUBLIC_HOLIDAYS } from '@main/providers/rottnest/public-holidays';
import { ROTTNEST_MAX_NIGHTS } from '@main/providers/rottnest/rules';
import { compareDates, isCalendarDate, nightsBetween } from '@shared/utils/calendar-date';

const scopes = BOOKING_GUIDES.flatMap((guide) => [
  ...guide.fixedBlocks,
  ...guide.minimumStays,
  ...guide.closures,
]);

describe('the booking guides', () => {
  it('cover October 2026 to June 2027, one a month in order, each opened on its Open Day', () => {
    expect(BOOKING_GUIDES.map((guide) => guide.month)).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
    ]);
    for (const guide of BOOKING_GUIDES) {
      expect([guide.month, guide.openDay]).toEqual([guide.month, openDayFor(guide.month).date]);
    }
  });

  it('suspend the 5/3 carry-over where the guides say so', () => {
    expect(
      Object.fromEntries(BOOKING_GUIDES.map((guide) => [guide.month, guide.carryOver]))
    ).toEqual({
      '2026-10': 'allowed',
      '2026-11': 'suspended',
      '2026-12': 'suspended',
      '2027-01': 'suspended',
      '2027-02': 'allowed',
      '2027-03': 'allowed',
      '2027-04': 'suspended',
      '2027-05': 'allowed',
      '2027-06': 'suspended',
    });
  });

  it("give each group's blocks back to back, from the period's start to its end, 14 nights at most", () => {
    for (const group of BOOKING_GUIDES.flatMap((guide) => guide.fixedBlocks)) {
      const [start, end] = group.period;
      expect([group.group, group.blocks[0][0]]).toEqual([group.group, start]);
      expect([group.group, group.blocks[group.blocks.length - 1][1]]).toEqual([group.group, end]);
      group.blocks.forEach(([arrival, departure], i) => {
        expect(isCalendarDate(arrival) && isCalendarDate(departure)).toBe(true);
        const nights = nightsBetween(arrival, departure);
        expect(nights).toBeGreaterThan(0);
        expect(nights).toBeLessThanOrEqual(ROTTNEST_MAX_NIGHTS);
        if (i > 0) expect([group.group, group.blocks[i - 1][1]]).toEqual([group.group, arrival]);
      });
    }
  });

  it('name only precincts and room types in the seed, and room types at those precincts', () => {
    for (const scope of scopes) {
      for (const slug of scope.precincts ?? [])
        expect([slug, rottnestPrecinct(slug)?.slug]).toEqual([slug, slug]);
      for (const code of scope.roomTypes ?? []) {
        const found = roomTypeOf(code);
        expect([code, Boolean(found)]).toEqual([code, true]);
        expect(scope.precincts).toContain(found?.precinct.slug);
      }
    }
  });

  it('give minimum stays and closures in order, and event Saturdays on Saturdays', () => {
    for (const guide of BOOKING_GUIDES) {
      for (const range of [...guide.minimumStays, ...guide.closures]) {
        expect(compareDates(range.from, range.to)).toBeLessThanOrEqual(0);
      }
      for (const { date } of guide.eventSaturdays) {
        expect(new Date(`${date}T00:00:00Z`).getUTCDay()).toBe(6);
      }
    }
  });
});

describe("WA's public holidays", () => {
  it('are dated, unique and in order, 2026 to 2028, with 2028 still expected', () => {
    const dates = WA_PUBLIC_HOLIDAYS.map((holiday) => holiday.date);
    expect(dates.every(isCalendarDate)).toBe(true);
    expect(new Set(dates).size).toBe(dates.length);
    expect([...dates].sort()).toEqual(dates);
    expect(dates[0]).toBe('2026-01-01');
    expect(
      WA_PUBLIC_HOLIDAYS.filter((holiday) => holiday.expected).every((holiday) =>
        holiday.date.startsWith('2028')
      )
    ).toBe(true);
    expect(WA_PUBLIC_HOLIDAYS.find((holiday) => holiday.date === '2027-09-27')?.name).toBe(
      "King's Birthday"
    );
  });
});
