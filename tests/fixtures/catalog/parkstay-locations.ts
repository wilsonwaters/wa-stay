/**
 * ParkStay's 169 campgrounds as `LocationSummary`s: the public `GET /api/campground_map/`
 * response probed on 2026-10-02 (ai-state/research/parkstay-api-review.md), mapped by the
 * ParkStay provider's own `toLocationSummary` (src/main/providers/parkstay/catalog.ts), with at
 * most 2 image URLs each to keep the file small.
 *
 * Test data only: never packaged, and the app always reads ParkStay live (brief O8).
 *
 * Facts the Explore tests rely on: 169 places, 106 bookable online, 39 in the Pilbara, 7 in the
 * Kimberley, 23 with both "Dogs permitted" and "Toilet", 139 campgrounds and 30 other kinds
 * (third-party operators, kinds from their names).
 */

import type {
  CatalogQuery,
  CatalogSearchResult,
  LocationSummary,
} from '../../../src/shared/types/catalog.types';
import raw from './parkstay-locations.json';

export const PARKSTAY_LOCATIONS = raw as LocationSummary[];

const lower = (text: string | undefined) => (text ?? '').toLowerCase();

/**
 * `catalog.search` as the catalogue service answers it, over `items`: the text matches the
 * name, area or region; options within a filter are OR-ed, filters AND-ed, and every chosen
 * amenity must be present.
 */
export function searchLocations(
  query: CatalogQuery,
  items: readonly LocationSummary[] = PARKSTAY_LOCATIONS
): CatalogSearchResult {
  const text = lower(query.text).trim();
  const matches = items.filter((item) => {
    if (
      text &&
      ![item.name, item.area?.name, item.area?.region].some((f) => lower(f).includes(text))
    )
      return false;
    if (query.providerIds?.length && !query.providerIds.includes(item.providerId)) return false;
    if (query.kinds?.length && !query.kinds.includes(item.kind)) return false;
    if (query.regions?.length && !query.regions.includes(item.area?.region ?? '')) return false;
    if (query.bookingModes?.length && !query.bookingModes.includes(item.bookingMode)) return false;
    if (query.amenities?.some((a) => !item.amenities.includes(a))) return false;
    return true;
  });
  const offset = query.offset ?? 0;
  return { items: matches.slice(offset, offset + (query.limit ?? 5000)), total: matches.length };
}
