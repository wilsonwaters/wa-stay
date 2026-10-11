/**
 * `catalogSearchArea` (DX2): the map area a search-mode catalogue is searched by, snapped
 * outwards to a power-of-two grid so small pans and zooms reuse a search. And `bboxContains`.
 */

import type { BoundingBox } from '@shared/types/catalog.types';
import {
  bboxContains,
  CATALOG_AREA_MIN_STEP,
  catalogSearchArea,
  clampBbox,
} from '@shared/utils/catalog-area';
import { BoundingBoxSchema } from '@shared/types/catalog.types';

describe('catalogSearchArea', () => {
  it('snaps a box outwards to a quarter of the power of two at or above its larger side', () => {
    // WA's first view: 16.1° by 21.5°, so a grid of 32 / 4 = 8°
    expect(catalogSearchArea([112.9, -35.2, 129, -13.7])).toEqual({
      key: '8/112,-40,136,-8',
      bbox: [112, -40, 136, -8],
    });
    // A city: 0.5° by 0.4°, a grid of 0.125°
    expect(catalogSearchArea([115.8, -32.0, 116.3, -31.6])).toEqual({
      key: '0.125/115.75,-32,116.375,-31.5',
      bbox: [115.75, -32, 116.375, -31.5],
    });
  });

  it('always contains the box it was made from', () => {
    const boxes: BoundingBox[] = [
      [112.9, -35.2, 129, -13.7],
      [115.81, -31.99, 115.83, -31.97],
      [-0.3, -0.2, 0.4, 0.1],
      [116, -32, 116, -32],
      [-180, -90, 180, 90],
    ];
    for (const box of boxes)
      expect([box, bboxContains(catalogSearchArea(box).bbox, box)]).toEqual([box, true]);
  });

  it('gives the same area for a small pan, and a new one for a large pan or a zoom level', () => {
    const view: BoundingBox = [115.8, -32.0, 116.3, -31.6];
    const { key } = catalogSearchArea(view);
    expect(catalogSearchArea([115.83, -32.0, 116.33, -31.6]).key).toBe(key);
    expect(catalogSearchArea([115.8, -31.95, 116.3, -31.55]).key).toBe(key);
    expect(catalogSearchArea([116.0, -32.0, 116.5, -31.6]).key).not.toBe(key);
    // Zoomed in one level (half the size), and out one level (twice the size)
    expect(catalogSearchArea([115.9, -31.9, 116.15, -31.7]).key).not.toBe(key);
    expect(catalogSearchArea([115.55, -32.2, 116.55, -31.4]).key).not.toBe(key);
  });

  it('never snaps finer than 1/64°, clamps to the globe, and never writes -0', () => {
    expect(catalogSearchArea([116.001, -32.001, 116.002, -32]).key).toBe(
      `${CATALOG_AREA_MIN_STEP}/116,-32.015625,116.015625,-32`
    );
    expect(catalogSearchArea([116, -32, 116, -32]).bbox).toEqual([116, -32, 116, -32]);
    expect(catalogSearchArea([-180, -90, 180, 90])).toEqual({
      key: '128/-180,-90,180,90',
      bbox: [-180, -90, 180, 90],
    });
    expect(catalogSearchArea([-0.001, -0.001, 0, 0]).key).toBe(
      `${CATALOG_AREA_MIN_STEP}/-0.015625,-0.015625,0,0`
    );
  });
});

describe('bboxContains', () => {
  it('includes the edges and rejects any overhang', () => {
    const outer: BoundingBox = [114, -36, 119, -31];
    expect(bboxContains(outer, outer)).toBe(true);
    expect(bboxContains(outer, [115, -35, 118, -32])).toBe(true);
    expect(bboxContains(outer, [113.99, -35, 118, -32])).toBe(false);
    expect(bboxContains(outer, [115, -35, 118, -30.99])).toBe(false);
  });
});

describe('clampBbox', () => {
  it('keeps a box on the globe as it is', () => {
    expect(clampBbox([112.9, -35.2, 129, -13.7])).toEqual([112.9, -35.2, 129, -13.7]);
  });

  it('brings edges a far-out map reports past 180° back onto the globe, valid for main', () => {
    const clamped = clampBbox([10, -95, 232.5, 85.05]);
    expect(clamped).toEqual([10, -90, 180, 85.05]);
    expect(BoundingBoxSchema.safeParse(clamped).success).toBe(true);
    expect(clampBbox([190, 10, 200, 20])).toEqual([180, 10, 180, 20]);
    expect(clampBbox([-200, -10, -190, 0])).toEqual([-180, -10, -180, 0]);
  });
});
