/**
 * How a location's facts read in the UI, shared by every list, map and detail view. Pure.
 */

import type { LocationSummary, UnitSummary } from '../../shared/types/catalog.types';
import type { LocationKind } from '../../shared/types/provider.types';

/** Location kinds as a person reads them. */
export const KIND_LABELS: Record<LocationKind, string> = {
  campground: 'Campground',
  'caravan-park': 'Caravan park',
  'holiday-park': 'Holiday park',
  cabin: 'Cabin',
  hut: 'Hut',
  glamping: 'Glamping',
  'farm-stay': 'Farm stay',
  home: 'Home',
  other: 'Place to stay',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as LocationKind] ?? KIND_LABELS.other;
}

/** What a location's bookable units are called, by kind. */
const UNIT_NOUNS: Record<LocationKind, [one: string, many: string]> = {
  campground: ['site', 'sites'],
  'caravan-park': ['site', 'sites'],
  'holiday-park': ['site', 'sites'],
  cabin: ['cabin', 'cabins'],
  hut: ['bunk', 'bunks'],
  glamping: ['tent', 'tents'],
  'farm-stay': ['room', 'rooms'],
  home: ['room', 'rooms'],
  other: ['unit', 'units'],
};

/** What a unit is called at a location of this kind: `{ one: 'site', many: 'sites' }`. */
export function unitNoun(kind: string | undefined): { one: string; many: string } {
  const [one, many] = UNIT_NOUNS[kind as LocationKind] ?? UNIT_NOUNS.other;
  return { one, many };
}

/** "24 sites", "1 cabin". */
export function unitCountLabel(kind: string, count: number): string {
  const { one, many } = unitNoun(kind);
  return `${count} ${count === 1 ? one : many}`;
}

/** "Cape Range National Park · Pilbara", or whichever of the two is known. */
export function areaLine(location: Pick<LocationSummary, 'area'>): string {
  return [location.area?.name, location.area?.region].filter(Boolean).join(' · ');
}

/**
 * True when the location has a usable map position: finite numbers in range, and not 0,0
 * (where a missing position lands when a provider fills the blanks with zeros).
 */
export function hasMapLocation(item: Pick<LocationSummary, 'lat' | 'lng'>): boolean {
  const { lat, lng } = item;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return !(lat === 0 && lng === 0);
}

/** "1 place", "169 places". */
export function placesLabel(count: number): string {
  return `${count} ${count === 1 ? 'place' : 'places'}`;
}

const isCount = (value: unknown, least: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= least;

/**
 * The people a unit takes, compactly: "1–6 people", "6 people" (exactly), "Up to 6 people" or
 * "At least 2 people". Undefined when the unit does not say.
 */
export function unitPeopleLabel(
  unit: Pick<UnitSummary, 'minPeople' | 'maxPeople'>
): string | undefined {
  const min = isCount(unit.minPeople, 1) ? unit.minPeople : undefined;
  const max = isCount(unit.maxPeople, 1) ? unit.maxPeople : undefined;
  const noun = (n: number) => (n === 1 ? 'person' : 'people');
  if (min !== undefined && max !== undefined && min <= max) {
    return min === max ? `${max} ${noun(max)}` : `${min}–${max} people`;
  }
  if (max !== undefined) return `Up to ${max} ${noun(max)}`;
  if (min !== undefined) return `At least ${min} ${noun(min)}`;
  return undefined;
}

/** The vehicles a unit takes: "3 vehicles", "1 vehicle" or "No vehicles". */
export function unitVehiclesLabel(unit: Pick<UnitSummary, 'maxVehicles'>): string | undefined {
  const max = unit.maxVehicles;
  if (!isCount(max, 0)) return undefined;
  if (max === 0) return 'No vehicles';
  return `${max} ${max === 1 ? 'vehicle' : 'vehicles'}`;
}
