/**
 * The order of Explore's list when the search has no text (a text search keeps the catalogue's
 * relevance order). Deterministic: ties fall back to the name, then the key. The reasons are in
 * docs/design/components.md ("Explore's default order").
 */

import type { LocationSummary } from '../../../../shared/types/catalog.types';
import { hasMapLocation } from '../../../components/locationFormat';

const collator = new Intl.Collator('en-AU', { sensitivity: 'base', numeric: true });
const startsWithDigit = (name: string) => /^\d/.test(name.trim());

/**
 * Names A to Z, with names that start with a number ("14 Mile", "3 Mile Camp") after the
 * rest, in numeric order among themselves. Case and accents are ignored.
 */
export function compareNames(a: string, b: string): number {
  const digitA = startsWithDigit(a);
  if (digitA !== startsWithDigit(b)) return digitA ? 1 : -1;
  return collator.compare(a, b);
}

function compareByName(a: LocationSummary, b: LocationSummary): number {
  return compareNames(a.name, b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * Squared distance from `[lng, lat]` on a flat projection scaled by the latitude: right for
 * ordering places across WA, cheap for thousands. Places with no position are furthest.
 */
function distanceFrom([lng, lat]: [number, number]) {
  const scale = Math.cos((lat * Math.PI) / 180);
  return (item: LocationSummary): number => {
    if (!hasMapLocation(item)) return Number.POSITIVE_INFINITY;
    let dLng = Math.abs(item.lng - lng) % 360;
    if (dLng > 180) dLng = 360 - dLng;
    const x = dLng * scale;
    const y = item.lat - lat;
    return x * x + y * y;
  };
}

/**
 * With a `centre` (the map's): nearest first. Without one (the list on its own): by name, with
 * leading-number names last. Returns a new array.
 */
export function orderPlaces(
  items: readonly LocationSummary[],
  centre: [number, number] | null
): LocationSummary[] {
  if (!centre) return [...items].sort(compareByName);
  const distance = distanceFrom(centre);
  return items
    .map((item) => ({ item, d: distance(item) }))
    .sort((a, b) => (a.d === b.d ? compareByName(a.item, b.item) : a.d < b.d ? -1 : 1))
    .map(({ item }) => item);
}
