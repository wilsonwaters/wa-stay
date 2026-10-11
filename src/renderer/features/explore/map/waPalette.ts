/**
 * Recolours Mapbox's `outdoors-v12` style to WA Stay's palette at run time: sand land, soft
 * ocean water, eucalypt parks, quieter terrain, faint sand roads and subdued place names, with
 * the base map's own points of interest and road shields hidden, so the app's pins and clusters
 * are the strongest marks on the map. Outdoors is used for its park boundaries, hillshade and
 * unsealed tracks (most places are in national parks); the layer ids it has are listed in
 * docs/design/map.md.
 *
 * Every change is guarded by `getLayer`: a layer Mapbox renames or drops is skipped (and
 * logged once in development), never an error.
 */

import type { MapTokens } from './types';

// Vite replaces `process.env.NODE_ENV` in renderer code; Jest runs on Node (as in ui/dev.ts).
declare const process: { env: { NODE_ENV?: string } };

/** The few map calls the palette needs, so tests can pass a fake. */
export interface PaletteMap {
  getLayer(id: string): unknown;
  getPaintProperty(layer: string, name: string): unknown;
  setPaintProperty(layer: string, name: string, value: unknown): unknown;
  setLayoutProperty(layer: string, name: string, value: unknown): unknown;
}

/** A design token's RGB channels (`--ws-sand-50: 250 247 242`) as a CSS colour Mapbox reads. */
export function tokenColour(channels: string): string {
  const [r, g, b] = channels
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return `rgb(${r}, ${g}, ${b})`;
}

/** The map's colours, read from the design tokens on the page. */
export function readMapTokens(root: Element = document.documentElement): MapTokens {
  const style = getComputedStyle(root);
  const read = (name: string) => tokenColour(style.getPropertyValue(`--ws-${name}`));
  return {
    ink: read('ink-900'),
    ink700: read('ink-700'),
    white: read('sand-0'),
    sand50: read('sand-50'),
    sand100: read('sand-100'),
    sand200: read('sand-200'),
    sand500: read('sand-500'),
    sand600: read('sand-600'),
    ocean100: read('ocean-100'),
    ocean200: read('ocean-200'),
    eucalypt50: read('eucalypt-50'),
    eucalypt600: read('eucalypt-600'),
  };
}

/**
 * Replaces the output for `park` in every `["match", ["get", "class"], …]` inside an
 * expression, leaving every other class as Mapbox drew it. Zoom interpolations are walked into,
 * so the result stays a valid zoom expression.
 */
export function recolourClass(expression: unknown, className: string, colour: string): unknown {
  if (!Array.isArray(expression)) return expression;
  const [op, input] = expression;
  if (op === 'match' && Array.isArray(input) && input[0] === 'get' && input[1] === 'class') {
    const out = [...expression];
    // Label/output pairs sit between the input and the fallback.
    for (let i = 2; i < out.length - 1; i += 2) {
      const label = out[i];
      const matches = Array.isArray(label) ? label.includes(className) : label === className;
      if (matches) out[i + 1] = colour;
    }
    return out;
  }
  return expression.map((part) => recolourClass(part, className, colour));
}

type Rule = {
  layer: string;
  /** A paint property, or `visibility` (layout) to hide the layer. */
  property: string;
  value: (tokens: MapTokens, current: unknown) => unknown;
};

/** The base map's own points of interest, road shields and transport labels: hidden. */
export const HIDDEN_LAYERS = [
  'poi-label',
  'road-number-shield',
  'road-exit-shield',
  'airport-label',
  'transit-label',
];

/** Road lines Mapbox draws orange or yellow (motorways, trunks and their links). */
export const COLOURED_ROADS = [
  'road-motorway-trunk',
  'road-major-link',
  'bridge-motorway-trunk',
  'bridge-major-link',
  'bridge-motorway-trunk-2',
  'bridge-major-link-2',
  'tunnel-motorway-trunk',
  'tunnel-major-link',
];

/** Road casings (the outline either side of a road), grey or, for tracks, orange. */
export const ROAD_CASES = [
  'road-motorway-trunk-case',
  'road-major-link-case',
  'road-primary-case',
  'road-secondary-tertiary-case',
  'road-minor-link-case',
  'road-street-case',
  'road-minor-case',
  'bridge-motorway-trunk-case',
  'bridge-major-link-case',
  'bridge-motorway-trunk-2-case',
  'bridge-major-link-2-case',
  'bridge-primary-case',
  'bridge-secondary-tertiary-case',
  'bridge-minor-link-case',
  'bridge-street-case',
  'bridge-minor-case',
  'tunnel-motorway-trunk-case',
  'tunnel-major-link-case',
  'tunnel-primary-case',
  'tunnel-secondary-tertiary-case',
  'tunnel-minor-link-case',
  'tunnel-street-case',
  'tunnel-minor-case',
];

/** Place names: towns, suburbs and road names. */
export const PLACE_NAME_LABELS = [
  'settlement-major-label',
  'settlement-minor-label',
  'settlement-subdivision-label',
  'road-label',
];

/** True when a Mapbox expression mentions the `track` road class (unsealed tracks). */
const mentionsTrack = (expression: unknown): boolean =>
  JSON.stringify(expression ?? null).includes('"track"');

/** What changes, layer by layer. */
export const PALETTE_RULES: Rule[] = [
  { layer: 'land', property: 'background-color', value: (t) => t.sand50 },
  { layer: 'water', property: 'fill-color', value: (t) => t.ocean100 },
  // Bathymetry shades the sea a deeper blue at the zooms WA is seen at, hiding ocean-100.
  { layer: 'water-depth', property: 'fill-opacity', value: () => 0 },
  { layer: 'water-shadow', property: 'fill-color', value: (t) => t.ocean200 },
  { layer: 'waterway', property: 'line-color', value: (t) => t.ocean200 },
  { layer: 'waterway-shadow', property: 'line-color', value: (t) => t.ocean200 },
  // Vegetation (wood, scrub, grass, crop) keeps its shapes but at a third of its strength, so
  // Mapbox's bright greens never outshout the pins.
  {
    layer: 'landcover',
    property: 'fill-opacity',
    value: () => ['interpolate', ['linear'], ['zoom'], 4, 0.3, 8, 0.25, 12, 0],
  },
  // National parks: a solid eucalypt wash (Mapbox fades it to 20%, which would vanish on sand),
  // edged by a soft eucalypt band so the boundary reads at every zoom.
  { layer: 'national-park', property: 'fill-color', value: (t) => t.eucalypt50 },
  {
    layer: 'national-park',
    property: 'fill-opacity',
    value: () => ['interpolate', ['linear'], ['zoom'], 5, 0, 6, 1],
  },
  { layer: 'national-park_tint-band', property: 'line-color', value: (t) => t.eucalypt600 },
  { layer: 'national-park_tint-band', property: 'line-opacity', value: () => 0.3 },
  {
    layer: 'landuse',
    property: 'fill-color',
    value: (t, current) => recolourClass(current, 'park', t.eucalypt50),
  },
  // Outdoors draws hillshade as a fill layer (not a raster with an exaggeration), so it is
  // quietened with opacity: half strength, the equivalent of exaggeration 0.25.
  { layer: 'hillshade', property: 'fill-opacity', value: () => 0.5 },
  { layer: 'contour-line', property: 'line-opacity', value: () => 0.3 },
  { layer: 'contour-label', property: 'text-opacity', value: () => 0.3 },

  // Hidden: park and tourism markers, highway shields, airports and stations. Places to stay
  // are the only points on this map.
  ...HIDDEN_LAYERS.map((layer) => ({ layer, property: 'visibility', value: () => 'none' })),

  // Roads in sand: highways a faint sand line (sand-500 at 40%) at the zooms WA is seen at,
  // where white would vanish on sand land; white with sand casings from street zooms, like
  // every other road. Unsealed tracks keep a darker sand casing, so 2WD and 4WD routes read.
  ...COLOURED_ROADS.flatMap((layer) => [
    {
      layer,
      property: 'line-color',
      value: (t: MapTokens) => ['step', ['zoom'], t.sand500, 10, t.white],
    },
    {
      layer,
      property: 'line-opacity',
      value: () => ['interpolate', ['linear'], ['zoom'], 3, 0, 3.5, 0.4, 9.5, 0.4, 10, 1],
    },
  ]),
  ...ROAD_CASES.map((layer) => ({
    layer,
    property: 'line-color',
    value: (t: MapTokens, current: unknown) =>
      mentionsTrack(current)
        ? ['match', ['get', 'class'], 'track', t.sand500, t.sand200]
        : t.sand200,
  })),

  // Place names subdued to ink-700 on a white halo: legible, never as strong as a pin. The
  // town dots are dimmed, so they cannot be mistaken for places to stay.
  ...PLACE_NAME_LABELS.flatMap((layer) => [
    { layer, property: 'text-color', value: (t: MapTokens) => t.ink700 },
    { layer, property: 'text-halo-color', value: (t: MapTokens) => t.white },
  ]),
  { layer: 'settlement-major-label', property: 'icon-opacity', value: () => 0.5 },
  { layer: 'settlement-minor-label', property: 'icon-opacity', value: () => 0.5 },
  { layer: 'state-label', property: 'text-color', value: (t) => t.ink700 },
  // The state border, pink in Mapbox, in sand.
  { layer: 'admin-1-boundary', property: 'line-color', value: (t) => t.sand500 },
  { layer: 'admin-1-boundary-bg', property: 'line-color', value: (t) => t.sand200 },
];

const reported = new Set<string>();

/**
 * Applies the palette. Run it on every `style.load`. Returns the layers it could not find.
 */
export function applyWaPalette(map: PaletteMap, tokens: MapTokens): string[] {
  const missing = new Set<string>();
  for (const rule of PALETTE_RULES) {
    if (!map.getLayer(rule.layer)) {
      missing.add(rule.layer);
      continue;
    }
    try {
      if (rule.property === 'visibility') {
        map.setLayoutProperty(rule.layer, rule.property, rule.value(tokens, undefined));
      } else {
        const current = map.getPaintProperty(rule.layer, rule.property);
        map.setPaintProperty(rule.layer, rule.property, rule.value(tokens, current));
      }
    } catch {
      missing.add(rule.layer);
    }
  }
  if (process.env.NODE_ENV !== 'production') {
    const fresh = [...missing].filter((id) => !reported.has(id));
    fresh.forEach((id) => reported.add(id));
    if (fresh.length) {
      console.warn(`[map] The base style has no ${fresh.join(', ')} layer; left as it is.`);
    }
  }
  return [...missing];
}
