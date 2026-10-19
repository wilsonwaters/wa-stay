/**
 * Stay Rottnest's Open Days (`src/main/providers/rottnest/open-days.ts`): the rule (the first
 * Wednesday of month M opens month M+8, a New Year's Day Open Day moving a week), checked
 * against every dated Open Day the research found (`ai-state/research/rottnest-release-rules.md`,
 * from RIA's booking guides, Feb 2023 to Oct 2027), the published table, and the quiet hours.
 */

import {
  addMonths,
  bookingsOpenAt,
  CALENDAR_CONFIRMED_UNTIL,
  isOpenDay,
  openDayFor,
  openDayQuietUntil,
  PUBLISHED_OPEN_DAYS,
  ruleOpenDayIn,
} from '@main/providers/rottnest/open-days';

/** Every Open Day RIA's guides date, with the stay month it opened (research table). */
const DATED_OPEN_DAYS: ReadonlyArray<[openDay: string, stayMonth: string]> = [
  ['2023-02-01', '2023-10'],
  ['2023-03-01', '2023-11'],
  ['2023-04-05', '2023-12'],
  ['2023-05-03', '2024-01'],
  ['2023-06-07', '2024-02'],
  ['2023-07-05', '2024-03'],
  ['2023-08-02', '2024-04'],
  ['2023-09-06', '2024-05'],
  ['2023-10-04', '2024-06'],
  ['2023-11-01', '2024-07'],
  ['2023-12-06', '2024-08'],
  ['2024-01-03', '2024-09'],
  ['2024-02-07', '2024-10'],
  ['2024-03-06', '2024-11'],
  ['2024-04-03', '2024-12'],
  ['2024-05-01', '2025-01'],
  ['2024-06-05', '2025-02'],
  ['2024-07-03', '2025-03'],
  ['2024-08-07', '2025-04'],
  ['2024-09-04', '2025-05'],
  ['2024-10-02', '2025-06'],
  ['2024-11-06', '2025-07'],
  ['2024-12-04', '2025-08'],
  // New Year's Day was the first Wednesday: the Open Day moved a week
  ['2025-01-08', '2025-09'],
  ['2025-02-05', '2025-10'],
  ['2025-03-05', '2025-11'],
  ['2025-04-02', '2025-12'],
  ['2025-05-07', '2026-01'],
  ['2025-06-04', '2026-02'],
  ['2025-07-02', '2026-03'],
  ['2025-08-06', '2026-04'],
  ['2025-09-03', '2026-05'],
  ['2025-10-01', '2026-06'],
  ['2025-11-05', '2026-07'],
  ['2025-12-03', '2026-08'],
  ['2026-01-07', '2026-09'],
  ['2026-02-04', '2026-10'],
  ['2026-03-04', '2026-11'],
  ['2026-04-01', '2026-12'],
  ['2026-05-06', '2027-01'],
  ['2026-06-03', '2027-02'],
  ['2026-07-01', '2027-03'],
  ['2026-08-05', '2027-04'],
  ['2026-09-02', '2027-05'],
  ['2026-10-07', '2027-06'],
  ['2026-11-04', '2027-07'],
  ['2026-12-02', '2027-08'],
  ['2027-01-06', '2027-09'],
  ['2027-02-03', '2027-10'],
  ['2027-03-03', '2027-11'],
  ['2027-04-07', '2027-12'],
  ['2027-05-05', '2028-01'],
  ['2027-06-02', '2028-02'],
  ['2027-07-07', '2028-03'],
  ['2027-08-04', '2028-04'],
  ['2027-09-01', '2028-05'],
  ['2027-10-06', '2028-06'],
];

describe('Open Days: the rule', () => {
  it.each(DATED_OPEN_DAYS)('%s opened %s', (openDay, stayMonth) => {
    expect(ruleOpenDayIn(addMonths(stayMonth, -8))).toBe(openDay);
    expect(openDayFor(stayMonth).date).toBe(openDay);
    expect(isOpenDay(openDay)).toBe(true);
  });

  it('moves a New Year’s Day Open Day to the next Wednesday (2025, and next in 2031)', () => {
    expect(ruleOpenDayIn('2025-01')).toBe('2025-01-08');
    expect(ruleOpenDayIn('2031-01')).toBe('2031-01-08');
    expect(ruleOpenDayIn('2030-01')).toBe('2030-01-02');
  });

  it('adds months across years', () => {
    expect(addMonths('2026-11', 8)).toBe('2027-07');
    expect(addMonths('2027-06', -8)).toBe('2026-10');
    expect(addMonths('2028-01', -1)).toBe('2027-12');
  });
});

describe('Open Days: published and expected', () => {
  it('takes published dates first, marked not expected', () => {
    for (const day of PUBLISHED_OPEN_DAYS) {
      expect(openDayFor(day.stayMonth)).toEqual({ ...day, expected: false });
    }
    expect(PUBLISHED_OPEN_DAYS.at(-1)?.date).toBe(CALENDAR_CONFIRMED_UNTIL);
  });

  it('marks dates past the published table expected', () => {
    expect(openDayFor('2028-07')).toEqual({
      date: '2027-11-03',
      stayMonth: '2028-07',
      expected: true,
    });
  });

  it('knows an ordinary Wednesday is not an Open Day', () => {
    expect(isOpenDay('2026-11-11')).toBe(false);
    expect(isOpenDay('2027-11-10')).toBe(false);
  });

  it('opens bookings at 8:30 am Perth (00:30 UTC)', () => {
    expect(bookingsOpenAt('2027-07').toISOString()).toBe('2026-11-04T00:30:00.000Z');
  });
});

describe('Open Days: quiet hours', () => {
  it('runs from 5:30 am to noon Perth on an Open Day only', () => {
    const noon = new Date('2026-11-04T04:00:00.000Z');
    expect(openDayQuietUntil(new Date('2026-11-03T21:30:00.000Z'), '2026-11-04')).toEqual(noon);
    expect(openDayQuietUntil(new Date('2026-11-04T03:59:59.000Z'), '2026-11-04')).toEqual(noon);
    expect(openDayQuietUntil(new Date('2026-11-04T04:00:00.000Z'), '2026-11-04')).toBeUndefined();
    expect(openDayQuietUntil(new Date('2026-11-03T21:29:59.000Z'), '2026-11-04')).toBeUndefined();
    expect(openDayQuietUntil(new Date('2026-11-11T00:30:00.000Z'), '2026-11-11')).toBeUndefined();
  });
});
