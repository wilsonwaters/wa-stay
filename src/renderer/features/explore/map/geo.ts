/**
 * Pure geometry for Explore's map: where a location is, whether it is in the visible area,
 * and the GeoJSON the map draws. No mapbox-gl import, so the list-only mode and the tests
 * never load it.
 */

import type { BoundingBox, LocationSummary } from '../../../../shared/types/catalog.types';
import { hasMapLocation } from '../../../components/locationFormat';
import type { PinAvailability } from './types';

export { hasMapLocation };

/** Western Australia, `[[west, south], [east, north]]`: the map's first view. */
export const WA_BOUNDS: [[number, number], [number, number]] = [
  [112.5, -35.6],
  [129.2, -13.5],
];

/** The longest name a map pill shows before it is cut with "…". */
export const PILL_LABEL_MAX = 22;

/** The zoom the map flies to for a place chosen in Where (or closer, if it is already closer). */
export const PLACE_ZOOM = 12;

/** The middle of a box, `[lng, lat]` (the antimeridian is not crossed in WA). */
export function centreOf([west, south, east, north]: BoundingBox): [number, number] {
  return [(west + east) / 2, (south + north) / 2];
}

/** A screen rectangle, as `getBoundingClientRect()` gives it. */
export interface ScreenBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * How far to pan the map, `[dx, dy]` in pixels (positive pans right and down, as Mapbox's
 * `panBy` takes it), so `inner` (a popup) sits inside `outer` (the map) less `insets`. When
 * `inner` is larger than the room, its top (or left) edge is kept in view.
 */
export function nudgeIntoView(
  inner: ScreenBox,
  outer: ScreenBox,
  insets: ScreenBox
): [number, number] {
  const axis = (start: number, end: number, min: number, max: number) => {
    if (end - start > max - min || start < min) return start - min;
    if (end > max) return end - max;
    return 0;
  };
  return [
    Math.round(axis(inner.left, inner.right, outer.left + insets.left, outer.right - insets.right)),
    Math.round(axis(inner.top, inner.bottom, outer.top + insets.top, outer.bottom - insets.bottom)),
  ];
}

/**
 * True when the location lies inside `bbox` (`[west, south, east, north]`, edges included).
 * A box whose west edge is east of its east edge crosses the antimeridian. A location with no
 * map position is in no area.
 */
export function withinBbox(item: Pick<LocationSummary, 'lat' | 'lng'>, bbox: BoundingBox): boolean {
  if (!hasMapLocation(item)) return false;
  const [west, south, east, north] = bbox;
  if (item.lat < south || item.lat > north) return false;
  return west <= east ? item.lng >= west && item.lng <= east : item.lng >= west || item.lng <= east;
}

/** The box around every mappable location, or null when none has a position. */
export function boundsOf(
  items: readonly Pick<LocationSummary, 'lat' | 'lng'>[]
): BoundingBox | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const item of items) {
    if (!hasMapLocation(item)) continue;
    west = Math.min(west, item.lng);
    east = Math.max(east, item.lng);
    south = Math.min(south, item.lat);
    north = Math.max(north, item.lat);
  }
  return Number.isFinite(west) ? [west, south, east, north] : null;
}

/** The name as a map pill shows it: cut to 22 characters with "…". */
export function pillLabel(name: string): string {
  const trimmed = name.trim();
  const chars = Array.from(trimmed);
  return chars.length > PILL_LABEL_MAX
    ? `${chars.slice(0, PILL_LABEL_MAX).join('').trimEnd()}…`
    : trimmed;
}

export interface LocationFeatureProperties {
  /** The location key; the source promotes it to the feature id. */
  key: string;
  name: string;
  /** The pill text: the name, truncated. */
  label: string;
  /** With dates (E3): the place's availability state, which colours its pin and pill. */
  avail?: string;
  /** With dates (E3): the pill text instead of the name ("8 available", "Full"). */
  availLabel?: string;
}

/** A place a provider said nothing about: its pill reads "–". */
const UNKNOWN_PIN: PinAvailability = { state: 'unknown', pill: '–' };

export interface LocationFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: LocationFeatureProperties;
}

export interface LocationFeatureCollection {
  type: 'FeatureCollection';
  features: LocationFeature[];
}

/**
 * The map's GeoJSON: one point per mappable location, keyed by its location key. With
 * `availability` (dates are set) each point also carries `avail` and `availLabel`.
 */
export function toFeatureCollection(
  items: readonly Pick<LocationSummary, 'key' | 'name' | 'lat' | 'lng'>[],
  availability?: ReadonlyMap<string, PinAvailability> | null
): LocationFeatureCollection {
  const features: LocationFeature[] = [];
  for (const item of items) {
    if (!hasMapLocation(item)) continue;
    const properties: LocationFeatureProperties = {
      key: item.key,
      name: item.name,
      label: pillLabel(item.name),
    };
    if (availability) {
      const pin = availability.get(item.key) ?? UNKNOWN_PIN;
      properties.avail = pin.state;
      properties.availLabel = pin.pill;
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [item.lng, item.lat] },
      properties,
    });
  }
  return { type: 'FeatureCollection', features };
}
