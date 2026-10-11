/**
 * The map areas a `search` catalogue (`catalogMode: 'search'`) is searched by. Main keys its
 * single-flight and its cache of area searches by them, and Explore keys its area request by
 * them, so a small pan or zoom asks nothing new. Pure; no node or electron imports.
 */

import type { BoundingBox } from '../types/catalog.types';

/** The finest grid an area is snapped to: 1/64° (about 1.7 km). */
export const CATALOG_AREA_MIN_STEP = 1 / 64;

export interface CatalogSearchArea {
  /** The same for every box that snaps to the same area: `step/west,south,east,north`. */
  key: string;
  /** The area searched: the box snapped outwards to the grid. It contains the box. */
  bbox: BoundingBox;
}

const clamp = (value: number, limit: number): number => Math.min(Math.max(value, -limit), limit);

/**
 * The area searched for `bbox`: the box snapped outwards to a grid whose step is a quarter of
 * the power of two at or above the box's larger side (never under `CATALOG_AREA_MIN_STEP`).
 * A pan by less than about a quarter of the view, or a zoom within the same power of two,
 * gives the same area; one zoom level in or out gives a new one. Steps are powers of two, so
 * the arithmetic is exact and keys match on every platform.
 */
export function catalogSearchArea([west, south, east, north]: BoundingBox): CatalogSearchArea {
  const span = Math.max(east - west, north - south, CATALOG_AREA_MIN_STEP);
  const step = Math.max(2 ** Math.ceil(Math.log2(span)) / 4, CATALOG_AREA_MIN_STEP);
  const bbox: BoundingBox = [
    clamp(Math.floor(west / step) * step, 180),
    clamp(Math.floor(south / step) * step, 90),
    clamp(Math.ceil(east / step) * step, 180),
    clamp(Math.ceil(north / step) * step, 90),
  ];
  return { key: `${step}/${bbox.join(',')}`, bbox };
}

/**
 * `bbox` within the globe: longitudes in [-180, 180], latitudes in [-90, 90], and west never
 * east of east. A map zoomed far out can report edges past 180° (`BoundingBoxSchema` refuses
 * them).
 */
export function clampBbox([west, south, east, north]: BoundingBox): BoundingBox {
  const w = clamp(west, 180);
  const s = clamp(south, 90);
  return [w, s, Math.max(clamp(east, 180), w), Math.max(clamp(north, 90), s)];
}

/** True when `outer` contains `inner` (edges included). */
export function bboxContains(outer: BoundingBox, inner: BoundingBox): boolean {
  return (
    outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3]
  );
}
