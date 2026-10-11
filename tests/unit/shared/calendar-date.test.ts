/**
 * Calendar dates `YYYY-MM-DD` (tech-review #14): pure, and independent of the host time
 * zone. Each case runs under several host zones, from UTC-11 to UTC+14, because Node applies
 * a change to `process.env.TZ` at once.
 */

import {
  addDays,
  compareDates,
  eachNight,
  isCalendarDate,
  nightsBetween,
  todayIn,
} from '@shared/utils/calendar-date';

const HOST_ZONES = ['UTC', 'Australia/Perth', 'Pacific/Pago_Pago', 'Pacific/Kiritimati'];

describe.each(HOST_ZONES)('calendar dates on a host in %s', (zone) => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = zone;
  });

  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it('isCalendarDate accepts real YYYY-MM-DD dates only', () => {
    expect(isCalendarDate('2026-12-13')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true); // leap year
    expect(isCalendarDate('0099-01-01')).toBe(true); // not mapped to 1999
    expect(isCalendarDate('2026-02-29')).toBe(false); // not a leap year
    expect(isCalendarDate('2100-02-29')).toBe(false); // century, not a leap year
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-12-13T00:00:00.000Z')).toBe(false);
    expect(isCalendarDate('2026-1-3')).toBe(false);
    expect(isCalendarDate('')).toBe(false);
    expect(isCalendarDate('garbage')).toBe(false);
  });

  it('addDays crosses month ends, year ends and leap days', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2026-07-19', 180)).toBe('2027-01-15');
    expect(addDays('2026-07-19', -180)).toBe('2026-01-20');
    expect(addDays('2026-07-19', 0)).toBe('2026-07-19');
  });

  it('addDays crosses daylight-saving changes of other zones by whole days', () => {
    // Sydney and London change their clocks on these dates; calendar days never shift.
    expect(addDays('2026-04-04', 1)).toBe('2026-04-05');
    expect(addDays('2026-10-03', 2)).toBe('2026-10-05');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
  });

  it('nightsBetween counts nights, negative when the departure is earlier', () => {
    expect(nightsBetween('2026-12-12', '2026-12-14')).toBe(2);
    expect(nightsBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(nightsBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(nightsBetween('2026-12-14', '2026-12-12')).toBe(-2);
    expect(nightsBetween('2026-12-14', '2026-12-14')).toBe(0);
  });

  it('eachNight lists the nights of a stay, by the date each starts', () => {
    expect(eachNight('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
    expect(eachNight('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29']);
    expect(eachNight('2026-12-13', '2026-12-13')).toEqual([]);
    expect(eachNight('2026-12-14', '2026-12-13')).toEqual([]);
  });

  it('compareDates sorts calendar dates', () => {
    expect(['2027-01-01', '2026-12-31', '2026-02-01'].sort(compareDates)).toEqual([
      '2026-02-01',
      '2026-12-31',
      '2027-01-01',
    ]);
    expect(compareDates('2026-12-13', '2026-12-13')).toBe(0);
    expect(compareDates('2026-12-12', '2026-12-13')).toBe(-1);
    expect(compareDates('2026-12-14', '2026-12-13')).toBe(1);
  });

  it('todayIn gives the date in the named zone, at both AWST day boundaries', () => {
    // 00:00 AWST on 13 Dec is 16:00 UTC on 12 Dec.
    expect(todayIn('Australia/Perth', new Date('2026-12-12T15:59:59.999Z'))).toBe('2026-12-12');
    expect(todayIn('Australia/Perth', new Date('2026-12-12T16:00:00.000Z'))).toBe('2026-12-13');
    expect(todayIn('Australia/Perth', new Date('2026-12-13T15:59:59.999Z'))).toBe('2026-12-13');
    expect(todayIn('Australia/Perth', new Date('2026-12-13T16:00:00.000Z'))).toBe('2026-12-14');
    expect(todayIn('UTC', new Date('2026-12-12T16:00:00.000Z'))).toBe('2026-12-12');
    expect(todayIn('Australia/Perth', new Date('2026-12-31T16:00:00.000Z'))).toBe('2027-01-01');
  });

  it('rejects anything that is not a calendar date instead of guessing', () => {
    expect(() => addDays('2026-12-13T00:00:00.000Z', 1)).toThrow(RangeError);
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addDays('2026-12-13', 1.5)).toThrow(RangeError);
    expect(() => nightsBetween('garbage', '2026-12-13')).toThrow(RangeError);
    expect(() => eachNight('2026-12-13', '')).toThrow(RangeError);
    expect(() => compareDates('2026-12-13', '13/12/2026')).toThrow(RangeError);
  });
});
