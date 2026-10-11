/**
 * Bulk availability for the catalogue fixture, as `catalog.availability` answers it: one entry
 * per place bookable online, with the provider's counts (`availableUnits` free on every night,
 * of `bookableUnits`). Deterministic, so tests can work out what each card and pin shows:
 *
 * - Bungarra (`parkstay:20`): 3 of its 5 sites free, as ParkStay's own fixture
 *   (`tests/fixtures/parkstay/campground_availabilty_view.json`) says;
 * - Lucky Bay (`parkstay:43`): full, none of its 56 sites free;
 * - any other place by its id: id % 5 = 0 full, 1 not open (nothing bookable, as past
 *   ParkStay's 180-day horizon), otherwise 1 to 9 units free.
 *
 * Test data only.
 */

import type { LocationSummary } from '../../../src/shared/types/catalog.types';
import type { BulkAvailabilityEntry } from '../../../src/shared/types/provider.types';
import { PARKSTAY_LOCATIONS } from './parkstay-locations';

const OVERRIDES: Record<string, Pick<BulkAvailabilityEntry, 'availableUnits' | 'bookableUnits'>> = {
  'parkstay:20': { availableUnits: 3, bookableUnits: 5 },
  'parkstay:43': { availableUnits: 0, bookableUnits: 56 },
};

/** The entry for one place, or undefined for a place not bookable online (no totals). */
export function bulkEntryFor(item: LocationSummary): BulkAvailabilityEntry | undefined {
  if (item.bookingMode !== 'online') return undefined;
  const override = OVERRIDES[item.key];
  if (override) return { key: item.key, ...override };
  const id = Number.parseInt(item.externalId, 10) || 0;
  const total = item.unitCount ?? 10;
  if (id % 5 === 0) return { key: item.key, availableUnits: 0, bookableUnits: total };
  if (id % 5 === 1) return { key: item.key, availableUnits: 0, bookableUnits: 0 };
  return {
    key: item.key,
    availableUnits: Math.min(total, 1 + (id % 9)),
    bookableUnits: total,
  };
}

/** Every entry for `items`. */
export function bulkAvailabilityFor(
  items: readonly LocationSummary[] = PARKSTAY_LOCATIONS
): BulkAvailabilityEntry[] {
  return items.flatMap((item) => {
    const entry = bulkEntryFor(item);
    return entry ? [entry] : [];
  });
}
