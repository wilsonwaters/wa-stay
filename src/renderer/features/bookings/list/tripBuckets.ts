/**
 * Which tab a booking belongs to, and in what order, by calendar dates in the provider's time
 * zone (a booking whose departure is today stays upcoming until the provider's midnight). Pure.
 */
import type { Booking } from '../../../../shared/types/booking.types';
import { BookingStatus } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import { providerToday } from '../../../components/stay/providerToday';

export type TripTab = 'upcoming' | 'past' | 'cancelled';

export const TRIP_TABS: readonly { value: TripTab; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Cancelled whatever its dates; otherwise upcoming until the day after it departs. */
export function tripTabOf(booking: Booking, today: string): TripTab {
  if (booking.status === BookingStatus.CANCELLED) return 'cancelled';
  return booking.stay.departure >= today ? 'upcoming' : 'past';
}

/** An upcoming trip that has started: checked in, up to and including check-out day. */
export function isHappeningNow(booking: Booking, today: string): boolean {
  return tripTabOf(booking, today) === 'upcoming' && booking.stay.arrival <= today;
}

export interface TripRow {
  booking: Booking;
  manifest: ProviderManifest | undefined;
  /** Today in the booking's provider's time zone. */
  today: string;
  tab: TripTab;
}

/** Each booking with its provider, its provider's today and its tab. */
export function tripRows(
  bookings: readonly Booking[],
  manifests: readonly ProviderManifest[],
  now: Date
): TripRow[] {
  return bookings.map((booking) => {
    const manifest = manifests.find((m) => m.id === booking.providerId);
    const today = providerToday(manifest, now);
    return { booking, manifest, today, tab: tripTabOf(booking, today) };
  });
}

const byArrival = (a: TripRow, b: TripRow) =>
  a.booking.stay.arrival.localeCompare(b.booking.stay.arrival) ||
  a.booking.stay.departure.localeCompare(b.booking.stay.departure) ||
  a.booking.id - b.booking.id;

/**
 * One tab's rows in its order: upcoming soonest first (a trip under way leads), past and
 * cancelled most recent first.
 */
export function rowsForTab(rows: readonly TripRow[], tab: TripTab): TripRow[] {
  const inTab = rows.filter((row) => row.tab === tab);
  return tab === 'upcoming' ? inTab.sort(byArrival) : inTab.sort((a, b) => byArrival(b, a));
}

/** How many rows each tab holds. */
export function tabCounts(rows: readonly TripRow[]): Record<TripTab, number> {
  const counts: Record<TripTab, number> = { upcoming: 0, past: 0, cancelled: 0 };
  for (const row of rows) counts[row.tab] += 1;
  return counts;
}
