/**
 * The map's own source and layers, built from the design tokens. Pure: no mapbox-gl at run
 * time (only its types), so tests can check every id, filter and colour.
 *
 * - `clusters` + `cluster-count`: ink circles with a white ring and a bold white count, larger
 *   as they hold more places.
 * - `location-halo`: a soft ink halo behind a hovered or selected pin.
 * - `location-dot`: one filled ink pin with a white ring per place; larger, with a thicker
 *   ring, while hovered or selected. Pins never collide, so every place stays visible.
 * - `location-pill`: the name on a white pill from zoom 8; ink with white text while hovered
 *   or selected; hidden while the place's preview is open (the preview has the name). Pills
 *   that would overlap are hidden (the pin stays).
 *
 * Without dates, ink and white are the only colours, so pins and clusters are the strongest
 * marks on the recoloured base map. Every pair is ink on white or white on ink (17.79:1, `fg`
 * on `surface` and `fg-inverse` on `surface-inverse` in CONTRAST_PAIRS).
 *
 * With dates (`withAvailability`, E3) every pill shows its place's availability ("8
 * available", "None free", "Check dates", "–") at every unclustered zoom, so the text, not the
 * colour, carries the state:
 * - available: eucalypt fill, white text (`fg-inverse` on `available`, 5.68:1);
 * - none free or not open: sand-100 fill, muted text (`fg-muted` on `surface-subtle`, 5.19:1);
 * - not bookable online ("Info only"): quiet, only from zoom 8 (as names): white fill, muted
 *   text (`fg-muted` on `surface`, 5.99:1), a sand-500 outline (`border-strong`, 3.67:1 on
 *   the land);
 * - anything else: white fill, ink text, as without dates;
 * - hovered or selected: ink, as without dates.
 * Pins are filled eucalypt, or muted (`fg-muted` on the sand land, 5.60:1) for none free and
 * not open, with a white ring; not bookable online is hollow with a muted ring, the rest
 * hollow with an ink ring. Clusters holding an available place turn eucalypt and say how
 * many are available ("12 available", the cards' word); available pills win collisions. Only checking pills ("···")
 * pulse.
 */

import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  SymbolLayerSpecification,
} from 'mapbox-gl';
import type { MapTokens } from './types';

export const SOURCE_ID = 'locations';
export const PILL_IMAGE_ID = 'ws-pill';

export const LAYER_IDS = {
  clusters: 'clusters',
  clusterCount: 'cluster-count',
  halo: 'location-halo',
  dot: 'location-dot',
  pill: 'location-pill',
} as const;

/** Places within 48 px are clustered, up to zoom 10. */
export const CLUSTER_RADIUS = 48;
export const CLUSTER_MAX_ZOOM = 10;
/** Name pills show from this zoom. */
export const PILL_MIN_ZOOM = 8;
/** The furthest a search result fit zooms in. */
export const FIT_MAX_ZOOM = 11;

/** `text-font` for every label the app adds: fonts the outdoors style already loads. */
export const MAP_FONT = ['DIN Pro Medium', 'Arial Unicode MS Regular'];
/** Cluster counts (the style loads it for state names). */
export const MAP_FONT_BOLD = ['DIN Pro Bold', 'Arial Unicode MS Bold'];

/** The feature property with a place's availability state, with dates (geo.ts). */
const AVAIL: ExpressionSpecification = ['get', 'avail'];
/** States whose pills and pins are muted. */
const MUTED_STATES = ['full', 'none-open'];
/** A cluster holds at least one available place (with dates). */
const HAS_FREE: ExpressionSpecification = ['>', ['get', 'availableCount'], 0];

export const SOURCE_SPEC: GeoJSONSourceSpecification = {
  type: 'geojson',
  data: { type: 'FeatureCollection', features: [] },
  promoteId: 'key',
  cluster: true,
  clusterRadius: CLUSTER_RADIUS,
  clusterMaxZoom: CLUSTER_MAX_ZOOM,
  // How many places in a cluster are available (0 without dates).
  clusterProperties: {
    availableCount: ['+', ['case', ['==', AVAIL, 'available'], 1, 0]],
  },
};

/**
 * While availability loads, the checking pills' fill pulses between these opacities, never so
 * low that the base map's labels show through the pill's text…
 */
export const PULSE_OPACITY = { low: 0.8, high: 1 };
/** …every 700 ms, fading over the same time. */
export const PULSE_INTERVAL_MS = 700;

/** True while the place is hovered or selected (feature state). */
export const ACTIVE: ExpressionSpecification = [
  'any',
  ['boolean', ['feature-state', 'hover'], false],
  ['boolean', ['feature-state', 'selected'], false],
];

/** True while the place's preview is open (feature state). */
export const PREVIEWED: ExpressionSpecification = [
  'boolean',
  ['feature-state', 'previewed'],
  false,
];

const CLUSTERED: ExpressionSpecification = ['has', 'point_count'];
const UNCLUSTERED: ExpressionSpecification = ['!', ['has', 'point_count']];

export type MapLayer = CircleLayerSpecification | SymbolLayerSpecification;

export interface LayerOptions {
  /** Dates are set: pills show availability, and pins and clusters are coloured by it. */
  withAvailability?: boolean;
  /** The pills' fill opacity (the loading pulse); 1 by default. */
  pillOpacity?: number;
}

/** The layers, in the order they are added (bottom to top). */
export function buildLayers(tokens: MapTokens, options: LayerOptions = {}): MapLayer[] {
  const { withAvailability = false, pillOpacity = PULSE_OPACITY.high } = options;
  /** A colour by availability state: available, full or not open, anything else. */
  const byState = (available: string, muted: string, other: string): ExpressionSpecification => [
    'match',
    AVAIL,
    'available',
    available,
    MUTED_STATES,
    muted,
    other,
  ];

  const clusters: CircleLayerSpecification = {
    id: LAYER_IDS.clusters,
    type: 'circle',
    source: SOURCE_ID,
    filter: CLUSTERED,
    paint: {
      'circle-color': withAvailability
        ? ['case', ['>', ['get', 'availableCount'], 0], tokens.eucalypt600, tokens.ink]
        : tokens.ink,
      'circle-stroke-color': tokens.white,
      'circle-stroke-width': 2,
      // With dates a cluster with available places is at least 52 px across, for "12 /
      // available".
      'circle-radius': withAvailability
        ? [
            'case',
            HAS_FREE,
            ['step', ['get', 'point_count'], 26, 50, 28],
            ['step', ['get', 'point_count'], 15, 10, 19, 50, 23],
          ]
        : ['step', ['get', 'point_count'], 15, 10, 19, 50, 23],
    },
  };

  const clusterCount: SymbolLayerSpecification = {
    id: LAYER_IDS.clusterCount,
    type: 'symbol',
    source: SOURCE_ID,
    filter: CLUSTERED,
    layout: {
      // With dates a cluster with available places says how many ("12" over "available", the
      // cards' word), so green clusters still tell them apart when most places are available.
      'text-field': withAvailability
        ? [
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
          ]
        : ['get', 'point_count_abbreviated'],
      'text-font': MAP_FONT_BOLD,
      'text-size': 12,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      // Always white. Written as a feature-state expression so Mapbox GL counts the layer as
      // state dependent: GL 3 redraws every symbol layer of a tile when another one's paint
      // changes (the loading pulse, dates set or cleared), and while places have feature state
      // (hover, selection) it fails on a symbol layer that is not state dependent.
      'text-color': ['case', ACTIVE, tokens.white, tokens.white],
    },
  };

  const halo: CircleLayerSpecification = {
    id: LAYER_IDS.halo,
    type: 'circle',
    source: SOURCE_ID,
    filter: UNCLUSTERED,
    paint: {
      'circle-color': tokens.ink,
      'circle-opacity': 0.16,
      'circle-radius': ['case', ACTIVE, 16, 0],
    },
  };

  const dot: CircleLayerSpecification = {
    id: LAYER_IDS.dot,
    type: 'circle',
    source: SOURCE_ID,
    filter: UNCLUSTERED,
    paint: {
      // With dates: filled eucalypt or muted with a white ring, or hollow (white, ink ring)
      // when not checked, as the map key shows them.
      'circle-color': withAvailability
        ? byState(tokens.eucalypt600, tokens.sand600, tokens.white)
        : tokens.ink,
      'circle-stroke-color': withAvailability
        ? [
            'match',
            AVAIL,
            ['available', ...MUTED_STATES],
            tokens.white,
            'offline-booking',
            tokens.sand600,
            tokens.ink,
          ]
        : tokens.white,
      'circle-stroke-width': ['case', ACTIVE, 3, 2],
      'circle-radius': ['case', ACTIVE, 9, 6],
    },
  };

  const pill: SymbolLayerSpecification = {
    id: LAYER_IDS.pill,
    type: 'symbol',
    source: SOURCE_ID,
    // With dates the state shows at every zoom a place is on its own, except "Info only",
    // which waits for zoom 8 like the names, so availability stands out at state zoom.
    filter: withAvailability
      ? [
          'all',
          UNCLUSTERED,
          ['any', ['!=', AVAIL, 'offline-booking'], ['>=', ['zoom'], PILL_MIN_ZOOM]],
        ]
      : UNCLUSTERED,
    ...(withAvailability ? {} : { minzoom: PILL_MIN_ZOOM }),
    layout: {
      'text-field': withAvailability ? ['get', 'availLabel'] : ['get', 'label'],
      'text-font': MAP_FONT,
      'text-size': 12,
      'text-anchor': 'bottom',
      'text-offset': [0, -1.3],
      'text-max-width': 30,
      'icon-image': PILL_IMAGE_ID,
      'icon-text-fit': 'both',
      'icon-text-fit-padding': [4, 10, 4, 10],
      'icon-anchor': 'bottom',
      // Available places win when pills collide (lower keys are placed first).
      ...(withAvailability
        ? { 'symbol-sort-key': ['match', AVAIL, 'available', 0, 1] as ExpressionSpecification }
        : {}),
    },
    paint: {
      'icon-color': [
        'case',
        ACTIVE,
        tokens.ink,
        withAvailability ? byState(tokens.eucalypt600, tokens.sand100, tokens.white) : tokens.white,
      ],
      'icon-halo-color': withAvailability
        ? [
            'case',
            ACTIVE,
            tokens.ink,
            ['match', AVAIL, 'offline-booking', tokens.sand500, tokens.ink],
          ]
        : tokens.ink,
      'icon-halo-width': 1,
      'text-color': [
        'case',
        ACTIVE,
        tokens.white,
        withAvailability
          ? [
              'match',
              AVAIL,
              'available',
              tokens.white,
              [...MUTED_STATES, 'offline-booking'],
              tokens.sand600,
              tokens.ink,
            ]
          : tokens.ink,
      ],
      // Only a pill still checking pulses; one with its answer stays solid.
      'icon-opacity': withAvailability
        ? ['case', PREVIEWED, 0, ['==', AVAIL, 'loading'], pillOpacity, 1]
        : ['case', PREVIEWED, 0, pillOpacity],
      'text-opacity': ['case', PREVIEWED, 0, 1],
      ...(withAvailability
        ? { 'icon-opacity-transition': { duration: PULSE_INTERVAL_MS, delay: 0 } }
        : {}),
    },
  };

  return [clusters, clusterCount, halo, dot, pill];
}

/** The layers a pointer can hover or click. */
export const INTERACTIVE_LAYERS = [LAYER_IDS.clusters, LAYER_IDS.dot, LAYER_IDS.pill];

/**
 * The pill under every name: a rounded rectangle as a signed distance field, so the layer can
 * recolour it (`icon-color`) and outline it (`icon-halo-*`) per feature, and stretch it to fit
 * the text. The middle stretches; the rounded ends do not.
 *
 * Mapbox reads an SDF icon's alpha as distance: 0.75 on the edge, falling 1/8 per pixel
 * outwards (at the icon's own pixel ratio).
 */
export function pillImage(pixelRatio = 2): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  options: {
    pixelRatio: number;
    sdf: true;
    stretchX: [number, number][];
    stretchY: [number, number][];
    content: [number, number, number, number];
  };
} {
  const radius = 12 * pixelRatio;
  const buffer = 4 * pixelRatio;
  const width = radius * 2 + 2 + buffer * 2;
  const height = radius * 2 + buffer * 2;
  const data = new Uint8ClampedArray(width * height * 4);
  const left = buffer + radius;
  const right = width - buffer - radius;
  const middleY = height / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Distance to the pill's centre line segment, minus the radius: < 0 inside.
      const cx = Math.min(Math.max(px, left), right);
      const distance = Math.hypot(px - cx, py - middleY) - radius;
      const alpha = 0.75 - distance / (8 * pixelRatio);
      const i = (y * width + x) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
    }
  }
  return {
    width,
    height,
    data,
    options: {
      pixelRatio,
      sdf: true,
      stretchX: [[left, right]],
      stretchY: [[buffer + radius - 1, buffer + radius + 1]],
      content: [buffer + radius / 2, buffer, width - buffer - radius / 2, height - buffer],
    },
  };
}
