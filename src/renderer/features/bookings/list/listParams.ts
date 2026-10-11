/**
 * The Bookings list's state, kept in the URL (`?tab=&provider=&q=`) so it survives Back,
 * reloads and links. Pure.
 */
import type { Booking } from '../../../../shared/types/booking.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { TripTab } from './tripBuckets';

export interface BookingListParams {
  tab: TripTab;
  /** A provider id, or undefined for every provider. */
  provider?: string;
  /** The search text as typed ('' for none). */
  q: string;
}

export interface FilterOption {
  value: string;
  label: string;
}

export const ALL = 'all';
const TABS: readonly TripTab[] = ['upcoming', 'past', 'cancelled'];
/** Longer search text is cut, so a pasted essay never lands in the URL. */
const MAX_QUERY_LENGTH = 100;

/** The list state in a query string. Values that mean nothing fall back to the defaults. */
export function parseListParams(search: URLSearchParams): BookingListParams {
  const tab = search.get('tab');
  const provider = search.get('provider')?.trim();
  return {
    tab: TABS.includes(tab as TripTab) ? (tab as TripTab) : 'upcoming',
    provider: provider && provider !== ALL ? provider : undefined,
    q: (search.get('q') ?? '').slice(0, MAX_QUERY_LENGTH),
  };
}

/** `search` with the list state written in; defaults are left out. */
export function withListParams(
  search: URLSearchParams,
  params: BookingListParams
): URLSearchParams {
  const next = new URLSearchParams(search);
  const set = (key: string, value: string | undefined) =>
    value ? next.set(key, value) : next.delete(key);
  set('tab', params.tab === 'upcoming' ? undefined : params.tab);
  set('provider', params.provider);
  set('q', params.q.trim() ? params.q.slice(0, MAX_QUERY_LENGTH) : undefined);
  return next;
}

/** Whether a booking matches the search: its location, area or reference, ignoring case. */
export function matchesSearch(booking: Booking, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase('en-AU');
  if (!needle) return true;
  return [booking.location.name, booking.location.areaName, booking.bookingReference].some(
    (field) => field?.toLocaleLowerCase('en-AU').includes(needle)
  );
}

/**
 * "All", then every registered provider (adding a booking by hand needs no capability), then
 * any other provider a booking belongs to (one no longer installed: "Other provider (id)"). U1's visibility rule:
 * shown once the providers are known, even when there is only one (§12.9).
 */
export function providerFilterOptions(
  manifests: readonly ProviderManifest[],
  bookings: readonly Booking[]
): FilterOption[] {
  const options: FilterOption[] = [{ value: ALL, label: 'All' }];
  const seen = new Set<string>();
  for (const manifest of manifests) {
    options.push({ value: manifest.id, label: manifest.shortName });
    seen.add(manifest.id);
  }
  for (const booking of bookings) {
    if (seen.has(booking.providerId)) continue;
    seen.add(booking.providerId);
    options.push({ value: booking.providerId, label: `Other provider (${booking.providerId})` });
  }
  return options;
}
