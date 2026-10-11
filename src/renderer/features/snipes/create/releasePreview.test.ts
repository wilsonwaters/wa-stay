import { RELEASE_UNKNOWN, daysAway, releasePreview, whenInZone } from './releasePreview';
import { inZoneAndLocal, zonedInstant, zoneName } from './zonedTime';

const SITES = { one: 'site', many: 'sites' };
const PERTH = 'Australia/Perth';
const now = new Date('2026-10-02T02:00:00Z'); // Fri 2 Oct, 10:00 am AWST

describe('releasePreview', () => {
  const base = { arrival: '2027-04-10', timeZone: PERTH, now, noun: SITES };

  it('says when the stay’s first night opens, in the provider’s zone, and how far away', () => {
    expect(
      releasePreview({ ...base, release: { open: false, opensAt: '2026-10-12T16:00:00.000Z' } })
    ).toBe('Sites for Sat 10 Apr 2027 open Tue 13 Oct, 12:00 am AWST (in 11 days).');
  });

  it('says the release time is unknown without opensAt, or without an answer', () => {
    expect(releasePreview({ ...base, release: { open: false } })).toBe(RELEASE_UNKNOWN);
    expect(releasePreview({ ...base, release: undefined })).toBe(RELEASE_UNKNOWN);
    expect(RELEASE_UNKNOWN).toBe('Release time unknown. Site Sniper will keep checking.');
  });

  it('says the nights are open already', () => {
    expect(releasePreview({ ...base, arrival: '2026-11-07', release: { open: true } })).toBe(
      'Sites for Sat 7 Nov are already open for booking.'
    );
  });

  it('counts calendar days where the provider is', () => {
    expect(daysAway(new Date('2026-10-02T15:59:00Z'), PERTH, now)).toBe('today');
    expect(daysAway(new Date('2026-10-02T16:00:00Z'), PERTH, now)).toBe('tomorrow');
    expect(whenInZone(new Date('2027-01-05T02:00:00Z'), PERTH, now)).toBe(
      'Tue 5 Jan 2027, 10:00 am AWST'
    );
  });
});

describe('zoned times', () => {
  it('reads a wall-clock date and time in the provider’s zone as an instant', () => {
    expect(zonedInstant('2026-11-03', '10:00', PERTH)).toEqual(new Date('2026-11-03T02:00:00Z'));
    expect(zonedInstant('2026-11-03', '10:00', 'Australia/Sydney')).toEqual(
      new Date('2026-11-02T23:00:00Z')
    );
    expect(zonedInstant('2026-02-30', '10:00', PERTH)).toBeUndefined();
    expect(zonedInstant('2026-11-03', '25:00', PERTH)).toBeUndefined();
    expect(zonedInstant('', '', PERTH)).toBeUndefined();
    expect(zoneName(PERTH, now)).toBe('AWST');
  });

  it('shows both clocks when this computer is in another zone', () => {
    const at = new Date('2026-11-03T02:00:00Z');
    expect(inZoneAndLocal(at, PERTH, at, PERTH)).toBe('10:00 am AWST');
    expect(inZoneAndLocal(at, PERTH, at, 'Australia/Sydney')).toBe(
      '10:00 am AWST · 1:00 pm your time'
    );
  });
});
