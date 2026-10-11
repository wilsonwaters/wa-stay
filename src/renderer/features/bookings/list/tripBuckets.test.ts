import { BookingStatus } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { makeBooking } from '@tests/fixtures/renderer/bookings';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import { isHappeningNow, rowsForTab, tabCounts, tripRows, tripTabOf } from './tripBuckets';

const stay = (arrival: string, departure: string) => ({
  ...makeBooking().stay,
  arrival,
  departure,
});

// The fixture clock: mid-morning on 13 December 2026 in Perth.
const NOW = new Date('2026-12-13T02:00:00Z');
const TODAY = '2026-12-13';

const UNDER_WAY = makeBooking({ id: 1, stay: stay('2026-12-12', '2026-12-14') });
const DEPARTED = makeBooking({ id: 2, stay: stay('2026-12-08', '2026-12-10') });
const CANCELLED = makeBooking({
  id: 3,
  stay: stay('2027-01-04', '2027-01-06'),
  status: BookingStatus.CANCELLED,
});
const PENDING = makeBooking({
  id: 4,
  stay: stay('2027-02-01', '2027-02-03'),
  status: BookingStatus.PENDING,
});
const SOON = makeBooking({ id: 5, stay: stay('2026-12-20', '2026-12-22') });
const LAST_YEAR = makeBooking({ id: 6, stay: stay('2025-04-01', '2025-04-03') });

describe('trip buckets', () => {
  it('puts a trip under way in Upcoming, badged as happening now', () => {
    expect(tripTabOf(UNDER_WAY, TODAY)).toBe('upcoming');
    expect(isHappeningNow(UNDER_WAY, TODAY)).toBe(true);
    expect(isHappeningNow(SOON, TODAY)).toBe(false);
  });

  it('puts a trip that departed on 10 December in Past', () => {
    expect(tripTabOf(DEPARTED, TODAY)).toBe('past');
    expect(isHappeningNow(DEPARTED, TODAY)).toBe(false);
  });

  it('puts a cancelled future trip only in Cancelled, and keeps pending trips upcoming', () => {
    expect(tripTabOf(CANCELLED, TODAY)).toBe('cancelled');
    expect(isHappeningNow(CANCELLED, '2027-01-05')).toBe(false);
    expect(tripTabOf(PENDING, TODAY)).toBe('upcoming');
  });

  it('keeps a trip that departs today upcoming until the day after', () => {
    const checkingOut = makeBooking({ stay: stay('2026-12-11', '2026-12-13') });
    expect(tripTabOf(checkingOut, '2026-12-13')).toBe('upcoming');
    expect(isHappeningNow(checkingOut, '2026-12-13')).toBe(true);
    expect(tripTabOf(checkingOut, '2026-12-14')).toBe('past');
  });

  it("decides today in the provider's time zone, not the computer's", () => {
    const sydney: ProviderManifest = { ...FAKE_MANIFEST, timezone: 'Australia/Sydney' };
    const departing = makeBooking({
      providerId: 'fakestay',
      stay: stay('2026-12-11', '2026-12-13'),
    });
    // 23:30 on 13 Dec in Perth is already 02:30 on the 14th in Sydney.
    const lateEvening = new Date('2026-12-13T15:30:00Z');
    const [perth] = tripRows(
      [departing],
      [{ ...sydney, timezone: 'Australia/Perth' }],
      lateEvening
    );
    const [nsw] = tripRows([departing], [sydney], lateEvening);
    expect(perth).toMatchObject({ today: '2026-12-13', tab: 'upcoming' });
    expect(nsw).toMatchObject({ today: '2026-12-14', tab: 'past' });
  });

  it('sorts upcoming soonest first and past most recent first, and counts each tab', () => {
    const rows = tripRows(
      [SOON, LAST_YEAR, CANCELLED, UNDER_WAY, PENDING, DEPARTED],
      [PARKSTAY_MANIFEST],
      NOW
    );
    expect(rowsForTab(rows, 'upcoming').map((r) => r.booking.id)).toEqual([1, 5, 4]);
    expect(rowsForTab(rows, 'past').map((r) => r.booking.id)).toEqual([2, 6]);
    expect(rowsForTab(rows, 'cancelled').map((r) => r.booking.id)).toEqual([3]);
    expect(tabCounts(rows)).toEqual({ upcoming: 3, past: 2, cancelled: 1 });
  });

  it("uses the computer's zone for a provider that is not installed", () => {
    const orphan = makeBooking({ providerId: 'gone', stay: stay('2026-12-12', '2026-12-14') });
    const [row] = tripRows([orphan], [PARKSTAY_MANIFEST], NOW);
    expect(row.manifest).toBeUndefined();
    expect(row.tab).toBe('upcoming');
  });
});
