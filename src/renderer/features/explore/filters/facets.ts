/**
 * Filters and per-option counts for Explore's filter chips. Pure.
 *
 * Options within a chip are OR-ed ("Pilbara or Kimberley"); chips are AND-ed together, and
 * Facilities is the exception: a place must have every chosen facility. A chip's counts are
 * the places that would match if that option were added, given every other chip (the usual
 * "disjunctive" faceting), so ticking an option never shows a count that disagrees with the
 * results it gives.
 */

import type { LocationSummary } from '../../../../shared/types/catalog.types';
import type { BookingMode, LocationKind } from '../../../../shared/types/provider.types';
import { kindLabel } from '../../../components/locationFormat';

export interface ExploreFilters {
  providerIds: string[];
  kinds: LocationKind[];
  regions: string[];
  amenities: string[];
  bookingModes: BookingMode[];
}

export const NO_FILTERS: Readonly<ExploreFilters> = Object.freeze({
  providerIds: [],
  kinds: [],
  regions: [],
  amenities: [],
  bookingModes: [],
});

export type FacetDimension = keyof ExploreFilters;

const includesAny = <T>(chosen: readonly T[], value: T | undefined) =>
  chosen.length === 0 || (value !== undefined && chosen.includes(value));

/** Whether a location passes every filter, optionally ignoring one dimension. */
export function matchesFilters(
  item: LocationSummary,
  filters: ExploreFilters,
  except?: FacetDimension
): boolean {
  if (except !== 'providerIds' && !includesAny(filters.providerIds, item.providerId)) return false;
  if (except !== 'kinds' && !includesAny(filters.kinds, item.kind)) return false;
  if (except !== 'regions' && !includesAny(filters.regions, item.area?.region)) return false;
  if (except !== 'bookingModes' && !includesAny(filters.bookingModes, item.bookingMode))
    return false;
  if (except !== 'amenities' && filters.amenities.some((a) => !item.amenities.includes(a)))
    return false;
  return true;
}

export interface FacetOption {
  value: string;
  label: string;
  /** Places the results would hold with this option added to the chip. */
  count: number;
}

/** How many of `items` each value of one dimension would give, with the other chips applied. */
export function facetCounts(
  items: readonly LocationSummary[],
  filters: ExploreFilters,
  dimension: FacetDimension
): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (value: string | undefined) => {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  };
  // Facilities combine with AND, so their counts keep the facilities already chosen; the
  // other filters combine with OR, so their own choices are left out of their counts.
  const except = dimension === 'amenities' ? undefined : dimension;
  for (const item of items) {
    if (!matchesFilters(item, filters, except)) continue;
    switch (dimension) {
      case 'providerIds':
        bump(item.providerId);
        break;
      case 'kinds':
        bump(item.kind);
        break;
      case 'regions':
        bump(item.area?.region);
        break;
      case 'bookingModes':
        bump(item.bookingMode);
        break;
      case 'amenities':
        for (const amenity of new Set(item.amenities)) bump(amenity);
        break;
    }
  }
  return counts;
}

const byLabel = (a: FacetOption, b: FacetOption) =>
  a.label.localeCompare(b.label, 'en-AU', { sensitivity: 'base' });

export interface ExploreFacets {
  /** Every catalogue provider, in the order given (even one alone, §12.9). */
  providers: FacetOption[];
  /** Hidden when the whole catalogue has only one kind. */
  kinds: FacetOption[];
  regions: FacetOption[];
  amenities: FacetOption[];
  /** Places bookable online, given the other chips. */
  online: number;
}

/**
 * The options and counts for every chip. `catalogue` is the whole catalogue, which fixes the
 * option lists; `base` is what the counts are taken over (the places matching the search text,
 * or the whole catalogue when there is none).
 */
export function buildFacets(
  catalogue: readonly LocationSummary[],
  base: readonly LocationSummary[],
  filters: ExploreFilters,
  providers: readonly { id: string; name: string }[]
): ExploreFacets {
  const values = <T extends string>(pick: (item: LocationSummary) => T | T[] | undefined) => {
    const all = new Set<T>();
    for (const item of catalogue) {
      const value = pick(item);
      for (const v of Array.isArray(value) ? value : [value]) if (v) all.add(v);
    }
    return [...all];
  };
  const options = (dimension: FacetDimension, all: string[], label: (v: string) => string) => {
    const counts = facetCounts(base, filters, dimension);
    return all.map((value) => ({ value, label: label(value), count: counts.get(value) ?? 0 }));
  };

  const providerCounts = facetCounts(base, filters, 'providerIds');
  return {
    providers: providers.map((p) => ({
      value: p.id,
      label: p.name,
      count: providerCounts.get(p.id) ?? 0,
    })),
    kinds: options(
      'kinds',
      values((i) => i.kind),
      kindLabel
    ).sort(byLabel),
    regions: options(
      'regions',
      values((i) => i.area?.region),
      (v) => v
    ).sort(byLabel),
    amenities: options(
      'amenities',
      values((i) => i.amenities),
      (v) => v
    ).sort(byLabel),
    online: facetCounts(base, filters, 'bookingModes').get('online') ?? 0,
  };
}
