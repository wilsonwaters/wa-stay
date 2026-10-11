import {
  boundsOf,
  centreOf,
  hasMapLocation,
  nudgeIntoView,
  pillLabel,
  toFeatureCollection,
  withinBbox,
} from './geo';

const at = (lng: number, lat: number) => ({ lng, lat });

describe('map geometry', () => {
  it('keeps places with no real position off the map: NaN, out of range, or 0,0', () => {
    expect(hasMapLocation(at(115.86, -31.95))).toBe(true);
    expect(hasMapLocation(at(Number.NaN, -31.95))).toBe(false);
    expect(hasMapLocation(at(115.86, Number.POSITIVE_INFINITY))).toBe(false);
    expect(hasMapLocation(at(0, 0))).toBe(false);
    expect(hasMapLocation(at(190, -31))).toBe(false);
    expect(hasMapLocation(at(0, -31))).toBe(true);
  });

  it('tests a place against a box, edges included', () => {
    const wa = [112.5, -35.6, 129.2, -13.5] as const;
    expect(withinBbox(at(115.86, -31.95), [...wa])).toBe(true);
    expect(withinBbox(at(112.5, -35.6), [...wa])).toBe(true);
    expect(withinBbox(at(130, -20), [...wa])).toBe(false);
    expect(withinBbox(at(120, -36), [...wa])).toBe(false);
    expect(withinBbox(at(0, 0), [-1, -1, 1, 1])).toBe(false);
  });

  it('handles a box across the antimeridian', () => {
    expect(withinBbox(at(179.5, 0.5), [179, -1, -179, 1])).toBe(true);
    expect(withinBbox(at(-179.5, 0.5), [179, -1, -179, 1])).toBe(true);
    expect(withinBbox(at(0, 0.5), [179, -1, -179, 1])).toBe(false);
  });

  it('bounds only the places that have a position', () => {
    expect(boundsOf([at(115, -32), at(122, -18), at(0, 0), at(Number.NaN, 1)])).toEqual([
      115, -32, 122, -18,
    ]);
    expect(boundsOf([at(0, 0)])).toBeNull();
    expect(boundsOf([])).toBeNull();
  });

  it('builds GeoJSON points keyed by location key, dropping places with no position', () => {
    const collection = toFeatureCollection([
      { key: 'parkstay:20', name: 'Bungarra', lng: 113.84, lat: -22.247 },
      { key: 'parkstay:21', name: 'Nowhere', lng: 0, lat: 0 },
      { key: 'parkstay:22', name: 'Broken', lng: Number.NaN, lat: -22 },
    ]);
    expect(collection).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [113.84, -22.247] },
          properties: { key: 'parkstay:20', name: 'Bungarra', label: 'Bungarra' },
        },
      ],
    });
  });

  it('adds each place availability with dates, and "unknown" for a place not in it', () => {
    const places = [
      { key: 'parkstay:20', name: 'Bungarra', lng: 113.84, lat: -22.247 },
      { key: 'parkstay:43', name: 'Lucky Bay', lng: 122.23, lat: -33.99 },
    ];
    const availability = new Map([['parkstay:20', { state: 'available', pill: '3 available' }]]);
    expect(toFeatureCollection(places, availability).features.map((f) => f.properties)).toEqual([
      {
        key: 'parkstay:20',
        name: 'Bungarra',
        label: 'Bungarra',
        avail: 'available',
        availLabel: '3 available',
      },
      {
        key: 'parkstay:43',
        name: 'Lucky Bay',
        label: 'Lucky Bay',
        avail: 'unknown',
        availLabel: '–',
      },
    ]);
    // Without dates there is nothing to add.
    expect(toFeatureCollection(places, null).features[0].properties).not.toHaveProperty('avail');
  });

  it('cuts long names to 22 characters for the map pill, keeping the full name', () => {
    // 51 characters, ParkStay's longest name.
    const name = 'Chapman Pool (formerly Warner Glen at Chapman Pool)';
    expect(name).toHaveLength(51);
    expect(pillLabel(name)).toBe('Chapman Pool (formerly…');
    expect(Array.from(pillLabel(name)).length).toBeLessThanOrEqual(23);
    expect(pillLabel('Lucky Bay')).toBe('Lucky Bay');
    const [feature] = toFeatureCollection([{ key: 'k:1', name, lng: 115, lat: -34 }]).features;
    expect(feature.properties.name).toBe(name);
  });

  it('finds the middle of a box', () => {
    expect(centreOf([112.5, -35.6, 129.2, -13.5])).toEqual([120.85, -24.55]);
  });

  describe('nudging a popup into the map', () => {
    const map = { top: 200, right: 1400, bottom: 900, left: 760 };
    const insets = { top: 64, right: 12, bottom: 12, left: 12 };
    const box = (top: number, left: number, height = 300, width = 288) => ({
      top,
      left,
      bottom: top + height,
      right: left + width,
    });

    it('leaves a popup that fits alone', () => {
      expect(nudgeIntoView(box(300, 900), map, insets)).toEqual([0, 0]);
    });

    it('pans down past the bottom edge, and up under the controls at the top', () => {
      // 11 px past the bottom, plus the 12 px margin.
      expect(nudgeIntoView(box(611, 900), map, insets)).toEqual([0, 23]);
      // Under the "Search as I move the map" pill.
      expect(nudgeIntoView(box(220, 900), map, insets)).toEqual([0, -44]);
    });

    it('pans sideways past the left and right edges', () => {
      expect(nudgeIntoView(box(300, 700), map, insets)).toEqual([-72, 0]);
      expect(nudgeIntoView(box(300, 1200), map, insets)).toEqual([100, 0]);
    });

    it('keeps the top in view when the popup is taller than the map', () => {
      expect(nudgeIntoView(box(400, 900, 800), map, insets)).toEqual([0, 136]);
    });
  });
});
