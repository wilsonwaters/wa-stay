import { dayInZone, relativeTime, timeInZone } from './timeFormat';

describe('timeFormat', () => {
  const now = new Date('2026-10-09T07:15:00Z'); // 3:15 pm in Perth

  it('relativeTime counts back in minutes, hours, then days', () => {
    expect(relativeTime(new Date(now.getTime() - 20_000), now)).toBe('just now');
    expect(relativeTime(new Date(now.getTime() - 12 * 60_000), now)).toBe('12 min ago');
    expect(relativeTime(new Date(now.getTime() - 3 * 3_600_000), now)).toBe('3 h ago');
    expect(relativeTime(new Date(now.getTime() - 30 * 3_600_000), now)).toBe('yesterday');
    expect(relativeTime(new Date('2026-10-03T03:00:00Z'), now)).toMatch(/^(Fri|Sat) 3 Oct$/);
    expect(relativeTime(new Date(now.getTime() + 60_000), now)).toBe('just now');
  });

  it('timeInZone shows the time in the provider’s zone, with the day when it is not today there', () => {
    expect(timeInZone(new Date('2026-10-09T07:15:00Z'), 'Australia/Perth', now)).toBe(
      '3:15 pm AWST'
    );
    expect(timeInZone(new Date('2026-10-10T01:05:00Z'), 'Australia/Perth', now)).toBe(
      'Sat 10 Oct, 9:05 am AWST'
    );
  });

  it('dayInZone writes "Fri 9 Oct" without a comma', () => {
    expect(dayInZone(now, 'Australia/Perth')).toBe('Fri 9 Oct');
  });
});
