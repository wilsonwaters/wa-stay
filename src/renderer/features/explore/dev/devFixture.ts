/**
 * DEV only (`#/?devFixture=5000`): answers `catalog.search` from synthetic places, so Explore
 * can be checked at scale by hand. Loaded with a dynamic import that production builds drop.
 */

import type {
  CatalogQuery,
  CatalogSearchResult,
  LocationSummary,
} from '../../../../shared/types/catalog.types';
import { matchesFilters } from '../filters/facets';
import { normalise } from '../search/suggestions';
import { syntheticLocations } from './syntheticLocations';

let cache: { size: number; places: LocationSummary[] } | null = null;

export async function searchDevFixture(
  query: CatalogQuery,
  size: number
): Promise<CatalogSearchResult> {
  if (cache?.size !== size) cache = { size, places: syntheticLocations(size) };
  const text = normalise(query.text ?? '');
  const filters = {
    providerIds: query.providerIds ?? [],
    kinds: query.kinds ?? [],
    regions: query.regions ?? [],
    amenities: query.amenities ?? [],
    bookingModes: query.bookingModes ?? [],
  };
  const items = cache.places.filter(
    (place) =>
      matchesFilters(place, filters) &&
      (!text ||
        normalise([place.name, place.area?.name, place.area?.region].join(' ')).includes(text))
  );
  return { items, total: items.length };
}
