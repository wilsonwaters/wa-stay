import {
  ACTIVE,
  buildLayers,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  LAYER_IDS,
  MAP_FONT_BOLD,
  PILL_IMAGE_ID,
  PREVIEWED,
  PULSE_INTERVAL_MS,
  PULSE_OPACITY,
  pillImage,
  SOURCE_ID,
  SOURCE_SPEC,
} from './layers';
import type { MapTokens } from './types';

const TOKENS: MapTokens = {
  ink: 'token-ink',
  ink700: 'token-ink-700',
  white: 'token-white',
  sand50: 'token-sand-50',
  sand100: 'token-sand-100',
  sand200: 'token-sand-200',
  sand500: 'token-sand-500',
  sand600: 'token-sand-600',
  ocean100: 'token-ocean-100',
  ocean200: 'token-ocean-200',
  eucalypt50: 'token-eucalypt-50',
  eucalypt600: 'token-eucalypt-600',
};

describe('map source and layers', () => {
  it('clusters within 48 px up to zoom 10, keyed by location key', () => {
    expect(SOURCE_SPEC).toMatchObject({
      type: 'geojson',
      promoteId: 'key',
      cluster: true,
      clusterRadius: 48,
      clusterMaxZoom: 10,
    });
    expect([CLUSTER_RADIUS, CLUSTER_MAX_ZOOM]).toEqual([48, 10]);
  });

  it('adds clusters, counts, halos, pins and pills, bottom to top, all on the one source', () => {
    const layers = buildLayers(TOKENS);
    expect(layers.map((l) => l.id)).toEqual([
      'clusters',
      'cluster-count',
      'location-halo',
      'location-dot',
      'location-pill',
    ]);
    expect(layers.every((l) => l.source === SOURCE_ID)).toBe(true);
  });

  it('splits clustered from single places with the point_count filter', () => {
    const [clusters, count, halo, dot, pill] = buildLayers(TOKENS);
    expect(clusters.filter).toEqual(['has', 'point_count']);
    expect(count.filter).toEqual(['has', 'point_count']);
    expect(halo.filter).toEqual(['!', ['has', 'point_count']]);
    expect(dot.filter).toEqual(['!', ['has', 'point_count']]);
    expect(pill.filter).toEqual(['!', ['has', 'point_count']]);
  });

  it('fills clusters ink with a white ring and a bold white count, larger as they grow', () => {
    const [clusters, count] = buildLayers(TOKENS);
    expect(clusters.paint).toMatchObject({
      'circle-color': TOKENS.ink,
      'circle-stroke-color': TOKENS.white,
      'circle-stroke-width': 2,
      'circle-radius': ['step', ['get', 'point_count'], 15, 10, 19, 50, 23],
    });
    expect(count.layout).toMatchObject({
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': MAP_FONT_BOLD,
    });
    // White either way; state dependent so Mapbox GL can restyle the source's other symbol
    // layer while places have feature state (see layers.ts).
    expect(count.paint).toEqual({ 'text-color': ['case', ACTIVE, TOKENS.white, TOKENS.white] });
  });

  it('fills every pin ink with a white ring, larger with a soft halo while hovered or selected', () => {
    const [, , halo, dot] = buildLayers(TOKENS);
    expect(ACTIVE).toEqual([
      'any',
      ['boolean', ['feature-state', 'hover'], false],
      ['boolean', ['feature-state', 'selected'], false],
    ]);
    expect(dot.paint).toEqual({
      'circle-color': TOKENS.ink,
      'circle-stroke-color': TOKENS.white,
      'circle-stroke-width': ['case', ACTIVE, 3, 2],
      'circle-radius': ['case', ACTIVE, 9, 6],
    });
    expect(halo.paint).toEqual({
      'circle-color': TOKENS.ink,
      'circle-opacity': 0.16,
      'circle-radius': ['case', ACTIVE, 16, 0],
    });
  });

  /** Every colour token the layers' paint uses, however deep in an expression. */
  const coloursOf = (layers: ReturnType<typeof buildLayers>) => {
    const tokens = new Set<string>(Object.values(TOKENS));
    const found = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'string' && tokens.has(value)) found.add(value);
    };
    for (const layer of layers) {
      for (const [name, value] of Object.entries(layer.paint ?? {})) {
        if (name.endsWith('color')) walk(value);
      }
    }
    return [...found].sort();
  };

  it('uses only ink and white, so pins outrank everything on the base map', () => {
    expect(coloursOf(buildLayers(TOKENS))).toEqual([TOKENS.ink, TOKENS.white].sort());
  });

  describe('with dates (availability)', () => {
    const layers = buildLayers(TOKENS, { withAvailability: true });
    const [clusters, count, , dot, pill] = layers;
    const AVAIL = ['get', 'avail'];

    it('counts the available places in each cluster', () => {
      expect(SOURCE_SPEC.clusterProperties).toEqual({
        availableCount: ['+', ['case', ['==', AVAIL, 'available'], 1, 0]],
      });
    });

    const HAS_FREE = ['>', ['get', 'availableCount'], 0];

    it('turns a cluster with an available place eucalypt, saying how many are available', () => {
      expect(clusters.paint?.['circle-color']).toEqual([
        'case',
        HAS_FREE,
        TOKENS.eucalypt600,
        TOKENS.ink,
      ]);
      // "12" over "available" (the cards' word), in a cluster at least 52 px across; the others
      // keep their count.
      expect(count.layout?.['text-field']).toEqual([
        'case',
        HAS_FREE,
        [
          'format',
          ['to-string', ['get', 'availableCount']],
          {},
          '\n',
          {},
          'available',
          { 'font-scale': 0.75 },
        ],
        ['format', ['get', 'point_count_abbreviated'], {}],
      ]);
      expect(clusters.paint?.['circle-radius']).toEqual([
        'case',
        HAS_FREE,
        ['step', ['get', 'point_count'], 26, 50, 28],
        ['step', ['get', 'point_count'], 15, 10, 19, 50, 23],
      ]);
      expect(count.paint).toEqual({ 'text-color': ['case', ACTIVE, TOKENS.white, TOKENS.white] });
    });

    it('shows the state on every pill at every zoom (Info only from zoom 8), available placed first', () => {
      expect(pill.minzoom).toBeUndefined();
      expect(pill.filter).toEqual([
        'all',
        ['!', ['has', 'point_count']],
        ['any', ['!=', AVAIL, 'offline-booking'], ['>=', ['zoom'], 8]],
      ]);
      expect(pill.layout).toMatchObject({
        'text-field': ['get', 'availLabel'],
        'icon-image': PILL_IMAGE_ID,
        'symbol-sort-key': ['match', AVAIL, 'available', 0, 1],
      });
    });

    it('fills available pills eucalypt, none free and not open sand, keeps Info only quiet; ink while active', () => {
      expect(pill.paint).toMatchObject({
        'icon-color': [
          'case',
          ACTIVE,
          TOKENS.ink,
          [
            'match',
            AVAIL,
            'available',
            TOKENS.eucalypt600,
            ['full', 'none-open'],
            TOKENS.sand100,
            TOKENS.white,
          ],
        ],
        'text-color': [
          'case',
          ACTIVE,
          TOKENS.white,
          [
            'match',
            AVAIL,
            'available',
            TOKENS.white,
            ['full', 'none-open', 'offline-booking'],
            TOKENS.sand600,
            TOKENS.ink,
          ],
        ],
        'icon-halo-color': [
          'case',
          ACTIVE,
          TOKENS.ink,
          ['match', AVAIL, 'offline-booking', TOKENS.sand500, TOKENS.ink],
        ],
      });
    });

    it('fills available and muted pins with a white ring; Info only hollow and muted, the rest hollow', () => {
      expect(dot.paint).toMatchObject({
        'circle-color': [
          'match',
          AVAIL,
          'available',
          TOKENS.eucalypt600,
          ['full', 'none-open'],
          TOKENS.sand600,
          TOKENS.white,
        ],
        'circle-stroke-color': [
          'match',
          AVAIL,
          ['available', 'full', 'none-open'],
          TOKENS.white,
          'offline-booking',
          TOKENS.sand600,
          TOKENS.ink,
        ],
        'circle-radius': ['case', ACTIVE, 9, 6],
      });
    });

    it('pulses only checking pills, between 0.8 and 1, fading over 700 ms', () => {
      const dimmed = buildLayers(TOKENS, {
        withAvailability: true,
        pillOpacity: PULSE_OPACITY.low,
      });
      expect(PULSE_OPACITY).toEqual({ low: 0.8, high: 1 });
      expect(dimmed[4].paint).toMatchObject({
        'icon-opacity': ['case', PREVIEWED, 0, ['==', AVAIL, 'loading'], 0.8, 1],
        'icon-opacity-transition': { duration: PULSE_INTERVAL_MS, delay: 0 },
        // The text stays solid.
        'text-opacity': ['case', PREVIEWED, 0, 1],
      });
      expect(PULSE_INTERVAL_MS).toBe(700);
    });

    it('adds only the available and muted colours (and a quiet outline) to ink and white', () => {
      expect(coloursOf(layers)).toEqual(
        [
          TOKENS.ink,
          TOKENS.white,
          TOKENS.eucalypt600,
          TOKENS.sand100,
          TOKENS.sand500,
          TOKENS.sand600,
        ].sort()
      );
    });
  });

  it('shows name pills from zoom 8 on a stretchable SDF pill, swapping to ink when active', () => {
    const pill = buildLayers(TOKENS)[4];
    expect(pill.minzoom).toBe(8);
    expect(pill.layout).toMatchObject({
      'text-field': ['get', 'label'],
      'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
      'text-size': 12,
      'icon-image': PILL_IMAGE_ID,
      'icon-text-fit': 'both',
    });
    // Pills collide (the default): overlapping ones hide, their dots stay.
    expect(pill.layout).not.toHaveProperty('text-allow-overlap');
    expect(pill.paint).toMatchObject({
      'icon-color': ['case', ACTIVE, TOKENS.ink, TOKENS.white],
      'text-color': ['case', ACTIVE, TOKENS.white, TOKENS.ink],
      'icon-halo-color': TOKENS.ink,
    });
    expect(LAYER_IDS.pill).toBe('location-pill');
  });

  it('hides the pill of a place while its preview is open', () => {
    const pill = buildLayers(TOKENS)[4];
    expect(PREVIEWED).toEqual(['boolean', ['feature-state', 'previewed'], false]);
    expect(pill.paint).toMatchObject({
      'icon-opacity': ['case', PREVIEWED, 0, 1],
      'text-opacity': ['case', PREVIEWED, 0, 1],
    });
  });

  it('draws the pill as a distance field: solid inside, 0.75 on the edge, fading outside', () => {
    const image = pillImage(2);
    const alpha = (x: number, y: number) => image.data[(y * image.width + x) * 4 + 3] / 255;
    const middleY = Math.floor(image.height / 2);
    expect(alpha(Math.floor(image.width / 2), middleY)).toBe(1);
    expect(alpha(0, 0)).toBe(0);
    // The top edge of the pill is `buffer` (8 px at ratio 2) from the top.
    expect(alpha(Math.floor(image.width / 2), 8)).toBeCloseTo(0.75, 1);
    expect(image.options).toMatchObject({ sdf: true, pixelRatio: 2 });
    const [[stretchStart, stretchEnd]] = image.options.stretchX;
    expect(stretchEnd).toBeGreaterThan(stretchStart);
  });
});
