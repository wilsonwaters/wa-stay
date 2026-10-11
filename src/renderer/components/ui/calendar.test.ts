import {
  addDaysIso,
  addMonthsIso,
  dayLabel,
  endOfWeekIso,
  isDayDisabled,
  monthGrid,
  nightsBetween,
  parseIsoDate,
  pickDate,
  rangeSummary,
  shortRange,
  startOfWeekIso,
} from './calendar';

describe('calendar helpers', () => {
  it('builds a Monday-first month grid padded with nulls', () => {
    const october = monthGrid('2026-10-01');
    expect(october[0]).toEqual([
      null,
      null,
      null,
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(october.every((week) => week.length === 7)).toBe(true);
    expect(october[october.length - 1]).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      null,
    ]);
  });

  it('handles the leap day 2028-02-29', () => {
    const february = monthGrid('2028-02-01').flat().filter(Boolean);
    expect(february).toHaveLength(29);
    expect(february[february.length - 1]).toBe('2028-02-29');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysIso('2028-02-29', 1)).toBe('2028-03-01');
    expect(addMonthsIso('2028-01-31', 1)).toBe('2028-02-29');
    expect(() => parseIsoDate('2027-02-29')).toThrow(/not a calendar date/);
  });

  it('crosses month boundaries (31 Oct → 1 Nov) and keeps plain dates over AU daylight saving', () => {
    expect(addDaysIso('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysIso('2026-11-01', -1)).toBe('2026-10-31');
    // Daylight saving starts in eastern Australia on 4 Oct 2026 and ends on 5 Apr 2026.
    expect(addDaysIso('2026-10-03', 1)).toBe('2026-10-04');
    expect(addDaysIso('2026-10-04', 1)).toBe('2026-10-05');
    expect(nightsBetween('2026-04-04', '2026-04-06')).toBe(2);
    expect(nightsBetween('2026-10-03', '2026-10-05')).toBe(2);
  });

  it('finds the Monday and Sunday of a week', () => {
    expect(startOfWeekIso('2026-10-03')).toBe('2026-09-28');
    expect(endOfWeekIso('2026-10-03')).toBe('2026-10-04');
  });

  it('first pick sets arrival, second sets departure, a pick on or before arrival restarts', () => {
    const arrival = pickDate({}, '2026-10-03');
    expect(arrival).toEqual({ arrival: '2026-10-03', departure: undefined });
    const range = pickDate(arrival, '2026-10-05');
    expect(range).toEqual({ arrival: '2026-10-03', departure: '2026-10-05' });
    expect(pickDate(arrival, '2026-10-03')).toEqual({
      arrival: '2026-10-03',
      departure: undefined,
    });
    expect(pickDate(arrival, '2026-10-01')).toEqual({
      arrival: '2026-10-01',
      departure: undefined,
    });
    expect(pickDate(range, '2026-10-10')).toEqual({ arrival: '2026-10-10', departure: undefined });
  });

  it('disables days before minDate and after maxDate', () => {
    const rules = { minDate: '2026-10-02', maxDate: '2027-03-31' };
    expect(isDayDisabled('2026-10-01', {}, rules)).toBe(true);
    expect(isDayDisabled('2026-10-02', {}, rules)).toBe(false);
    expect(isDayDisabled('2027-04-01', {}, rules)).toBe(true);
  });

  it('while choosing the departure, disables days beyond maxNights but not earlier days', () => {
    const range = { arrival: '2026-10-03' };
    const rules = { maxNights: 3 };
    expect(isDayDisabled('2026-10-06', range, rules)).toBe(false);
    expect(isDayDisabled('2026-10-07', range, rules)).toBe(true);
    expect(isDayDisabled('2026-10-01', range, rules)).toBe(false);
    // Once the range is complete, any day can start a new one.
    expect(isDayDisabled('2026-10-20', { ...range, departure: '2026-10-05' }, rules)).toBe(false);
  });

  it('names days in full, marking check-in and check-out', () => {
    const range = { arrival: '2026-10-03', departure: '2026-10-05' };
    expect(dayLabel('2026-10-03', range)).toBe('Saturday 3 October 2026, check-in');
    expect(dayLabel('2026-10-05', range)).toBe('Monday 5 October 2026, check-out');
    expect(dayLabel('2026-10-04', range)).toBe('Sunday 4 October 2026');
  });

  it('writes a range compactly: the month once when shared, the year only when asked', () => {
    expect(shortRange('2026-10-11', '2026-10-13')).toBe('Sun 11 – Tue 13 Oct');
    expect(shortRange('2026-10-30', '2026-11-02')).toBe('Fri 30 Oct – Mon 2 Nov');
    expect(shortRange('2026-12-30', '2027-01-01')).toBe('Wed 30 Dec – Fri 1 Jan');
    expect(shortRange('2027-03-26', '2027-03-29', true)).toBe('Fri 26 – Mon 29 Mar 2027');
    expect(shortRange('2027-02-26', '2027-03-01', true)).toBe('Fri 26 Feb – Mon 1 Mar 2027');
    expect(shortRange('2026-12-30', '2027-01-01', true)).toBe('Wed 30 Dec 2026 – Fri 1 Jan 2027');
  });

  it('summarises the range', () => {
    expect(rangeSummary({ arrival: '2026-10-02', departure: '2026-10-04' })).toBe(
      'Fri 2 – Sun 4 Oct · 2 nights'
    );
    expect(rangeSummary({ arrival: '2026-10-02', departure: '2026-10-03' })).toBe(
      'Fri 2 – Sat 3 Oct · 1 night'
    );
    expect(rangeSummary({ arrival: '2026-10-02' })).toBe('Fri 2 Oct – choose check-out');
    expect(rangeSummary({})).toBeUndefined();
  });
});
