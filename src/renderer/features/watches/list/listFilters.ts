/**
 * The Watches list's filters, kept in the URL (`?provider=&status=`) so they survive Back and
 * reloads. Pure.
 */
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { Watch } from '../../../../shared/types/watch.types';
import type { WatchState } from '../shared/watchState';

export type StatusFilter = 'all' | 'active' | 'paused';

export interface WatchFilters {
  /** A provider id, or undefined for every provider. */
  provider?: string;
  status: StatusFilter;
}

export interface FilterOption {
  value: string;
  label: string;
}

export const ALL = 'all';
const STATUSES: readonly StatusFilter[] = ['all', 'active', 'paused'];

export const STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
];

/** The filters in a query string. Values that mean nothing are ignored. */
export function parseWatchFilters(search: URLSearchParams): WatchFilters {
  const status = search.get('status');
  const provider = search.get('provider')?.trim();
  return {
    provider: provider && provider !== ALL ? provider : undefined,
    status: STATUSES.includes(status as StatusFilter) ? (status as StatusFilter) : 'all',
  };
}

/** `search` with the filters written in; defaults are left out. */
export function withWatchFilters(search: URLSearchParams, filters: WatchFilters): URLSearchParams {
  const next = new URLSearchParams(search);
  if (filters.provider) next.set('provider', filters.provider);
  else next.delete('provider');
  if (filters.status !== 'all') next.set('status', filters.status);
  else next.delete('status');
  return next;
}

/**
 * Whether a watch passes the filters. Active and Paused are a running watch's two states; a
 * watch that has ended, holds a unit, let its hold expire or was booked is neither (it is
 * stopped, not paused), so it shows only under "All".
 */
export function passesFilters(watch: Watch, state: WatchState, filters: WatchFilters): boolean {
  if (filters.provider && watch.providerId !== filters.provider) return false;
  if (filters.status === 'all') return true;
  return filters.status === 'active' ? state === 'active' : state === 'paused';
}

/**
 * "All", then every provider that offers watches, then any other provider a watch belongs to
 * (one that stopped offering watches, or is no longer installed).
 */
export function providerFilterOptions(
  manifests: readonly ProviderManifest[],
  watches: readonly Watch[]
): FilterOption[] {
  const options: FilterOption[] = [{ value: ALL, label: 'All' }];
  const seen = new Set<string>();
  for (const manifest of manifests) {
    if (!manifest.capabilities.watches) continue;
    options.push({ value: manifest.id, label: manifest.shortName });
    seen.add(manifest.id);
  }
  for (const watch of watches) {
    if (seen.has(watch.providerId)) continue;
    seen.add(watch.providerId);
    const manifest = manifests.find((m) => m.id === watch.providerId);
    options.push({
      value: watch.providerId,
      label: manifest?.shortName ?? `Unknown provider (${watch.providerId})`,
    });
  }
  return options;
}

const RANK: Record<WatchState, number> = {
  held: 0,
  active: 1,
  paused: 1,
  'hold-expired': 1,
  booked: 2,
  ended: 3,
};

/** Held first (it needs paying), then by arrival, soonest first; ended last. */
export function sortWatches<T extends { watch: Watch; state: WatchState }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      RANK[a.state] - RANK[b.state] ||
      a.watch.stay.arrival.localeCompare(b.watch.stay.arrival) ||
      a.watch.id - b.watch.id
  );
}
