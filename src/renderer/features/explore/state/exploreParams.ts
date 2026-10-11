/**
 * Explore's state in the URL, so a search can be reloaded, shared and restored by Back.
 * Pure: `parseExploreParams` reads a query string, `serialiseExploreParams` writes one.
 *
 * | Key | Value |
 * | --- | --- |
 * | `q` | search text |
 * | `providers`, `kinds`, `regions`, `amenities` | comma lists |
 * | `online` | `1`: bookable online only |
 * | `arrival`, `departure` | `YYYY-MM-DD` |
 * | `adults`, `children`, `infants` | whole numbers |
 * | `avail` | `1`: places available for the dates only (dropped with no arrival) |
 * | `map` | `lng,lat,zoom`, the map camera |
 * | `follow` | `0`: "Search as I move the map" is off |
 * | `view` | `map` or `list`, the pane shown below 1024 px |
 * | `sel` | the selected location key |
 *
 * Values that are not valid are dropped. Keys this module does not know are left alone.
 */

import { LOCATION_KINDS, type LocationKind } from '../../../../shared/types/provider.types';
import { compareDates, isCalendarDate } from '../../../../shared/utils/calendar-date';
import { isLocationKey } from '../../../../shared/utils/location-key';
import { DEFAULT_GUEST_LIMITS } from '../../../components/ui/GuestsField';

export interface MapCamera {
  lng: number;
  lat: number;
  zoom: number;
}

/** The pane shown below 1024 px wide. */
export type ExploreView = 'map' | 'list';

export interface ExploreParams {
  q: string;
  providers: string[];
  kinds: LocationKind[];
  regions: string[];
  amenities: string[];
  /** Bookable online only (`bookingModes: ['online']`). */
  online: boolean;
  arrival: string | null;
  departure: string | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  /** "Available only": places with a unit free for the dates. Used only once a stay is set. */
  avail: boolean;
  map: MapCamera | null;
  /** "Search as I move the map". On unless the URL says `follow=0`. */
  follow: boolean;
  view: ExploreView;
  /** The selected location key. */
  sel: string | null;
}

export const DEFAULT_EXPLORE_PARAMS: Readonly<ExploreParams> = Object.freeze({
  q: '',
  providers: [],
  kinds: [],
  regions: [],
  amenities: [],
  online: false,
  arrival: null,
  departure: null,
  adults: null,
  children: null,
  infants: null,
  avail: false,
  map: null,
  follow: true,
  view: 'list',
  sel: null,
});

/**
 * Values that exist right now. A list given here drops URL values that are not in it (an
 * unknown region or provider); a list left out is not checked, because it has not loaded yet.
 */
export interface KnownValues {
  providers?: readonly string[];
  regions?: readonly string[];
  amenities?: readonly string[];
  /** Location keys, for `sel`. */
  keys?: ReadonlySet<string>;
}

/** The keys Explore owns, in the order they are written. */
export const EXPLORE_KEYS = [
  'q',
  'providers',
  'kinds',
  'regions',
  'amenities',
  'online',
  'arrival',
  'departure',
  'adults',
  'children',
  'infants',
  'avail',
  'map',
  'follow',
  'view',
  'sel',
] as const;

type ExploreKey = (typeof EXPLORE_KEYS)[number];
const OWN_KEYS = new Set<string>(EXPLORE_KEYS);
const LIST_KEYS = new Set<string>(['providers', 'kinds', 'regions', 'amenities']);
const MAX_TEXT = 200;

/** One `key=value` pair as written in the query, still encoded. */
interface RawPair {
  key: string;
  raw: string;
}

function decode(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return '';
  }
}

/** Splits a query string into raw pairs (values still encoded, so list commas are visible). */
function rawPairs(search: string): RawPair[] {
  const query = search.startsWith('?') ? search.slice(1) : search;
  if (!query) return [];
  return query
    .split('&')
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf('=');
      return at < 0
        ? { key: decode(part), raw: '' }
        : { key: decode(part.slice(0, at)), raw: part.slice(at + 1) };
    });
}

/** A comma list: each item decoded on its own, so an item may hold an encoded comma. */
function list(raw: string): string[] {
  const items = raw
    .split(',')
    .map((item) => decode(item).trim())
    .filter(Boolean);
  return [...new Set(items)];
}

function onlyKnown(values: string[], known: readonly string[] | undefined): string[] {
  if (!known) return values;
  const allowed = new Set(known);
  return values.filter((value) => allowed.has(value));
}

function count(raw: string, kind: 'adults' | 'children' | 'infants'): number | null {
  if (!/^\d{1,3}$/.test(raw)) return null;
  const value = Number(raw);
  const { min, max } = DEFAULT_GUEST_LIMITS[kind];
  return value >= min && value <= max ? value : null;
}

function camera(raw: string): MapCamera | null {
  const parts = decode(raw).split(',');
  if (parts.length !== 3 || parts.some((p) => p.trim() === '')) return null;
  const [lng, lat, zoom] = parts.map(Number);
  if (![lng, lat, zoom].every(Number.isFinite)) return null;
  if (lng < -180 || lng > 180 || lat < -85 || lat > 85 || zoom < 0 || zoom > 22) return null;
  return { lng, lat, zoom };
}

export interface ParsedExploreParams {
  params: ExploreParams;
  /** The query string with Explore's keys in canonical form and unknown keys kept. */
  canonical: string;
}

/**
 * Reads Explore's state from a query string (`?q=bay&regions=Pilbara`). Invalid values are
 * dropped: a bad date, a guest count out of range, an unknown kind, a region or provider not
 * in `known`. An arrival on or after the departure drops both dates.
 */
export function parseExploreParams(search: string, known: KnownValues = {}): ParsedExploreParams {
  const pairs = rawPairs(search);
  const first = new Map<string, string>();
  const others: RawPair[] = [];
  for (const pair of pairs) {
    if (!OWN_KEYS.has(pair.key)) others.push(pair);
    else if (!first.has(pair.key)) first.set(pair.key, pair.raw);
  }
  const get = (key: ExploreKey) => first.get(key);
  const getList = (key: ExploreKey) => {
    const raw = get(key);
    return raw === undefined ? [] : list(raw);
  };

  const params: ExploreParams = { ...DEFAULT_EXPLORE_PARAMS };

  const q = get('q');
  if (q !== undefined) params.q = decode(q).trim().slice(0, MAX_TEXT);

  params.providers = onlyKnown(getList('providers'), known.providers);
  params.kinds = getList('kinds').filter((kind): kind is LocationKind =>
    (LOCATION_KINDS as readonly string[]).includes(kind)
  );
  params.regions = onlyKnown(getList('regions'), known.regions);
  params.amenities = onlyKnown(getList('amenities'), known.amenities);
  params.online = get('online') === '1';

  const arrival = decode(get('arrival') ?? '');
  const departure = decode(get('departure') ?? '');
  if (isCalendarDate(arrival)) params.arrival = arrival;
  if (isCalendarDate(departure)) params.departure = departure;
  if (params.arrival && params.departure && compareDates(params.arrival, params.departure) >= 0) {
    params.arrival = null;
    params.departure = null;
  }

  for (const kind of ['adults', 'children', 'infants'] as const) {
    const raw = get(kind);
    if (raw !== undefined) params[kind] = count(raw, kind);
  }
  // Kept while dates are being chosen again (an arrival with no departure yet), but not
  // without any dates at all.
  params.avail = get('avail') === '1' && params.arrival !== null;

  const map = get('map');
  if (map !== undefined) params.map = camera(map);
  params.follow = get('follow') !== '0';
  params.view = get('view') === 'map' ? 'map' : 'list';

  const sel = decode(get('sel') ?? '');
  if (sel && isLocationKey(sel) && (!known.keys || known.keys.has(sel))) params.sel = sel;

  return { params, canonical: withForeign(serialiseExploreParams(params), others) };
}

function withForeign(own: string, others: RawPair[]): string {
  const rest = others.map(({ key, raw }) => (raw ? `${encodeURIComponent(key)}=${raw}` : key));
  const query = [own.replace(/^\?/, ''), ...rest].filter(Boolean).join('&');
  return query ? `?${query}` : '';
}

/**
 * The query string for `params`, keeping any keys in `search` that Explore does not own
 * (another feature's, or the DEV `devFixture`) after Explore's own.
 */
export function replaceExploreParams(search: string, params: ExploreParams): string {
  const others = rawPairs(search).filter((pair) => !OWN_KEYS.has(pair.key));
  return withForeign(serialiseExploreParams(params), others);
}

/** Encodes a value, keeping characters that are safe and readable in a query. */
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

function round(value: number, places: number): string {
  return String(Number(value.toFixed(places)));
}

/**
 * Writes Explore's state as a query string, in `EXPLORE_KEYS` order, leaving out every value
 * that is the default. Comma lists keep their commas readable; a comma inside an item is
 * encoded.
 */
export function serialiseExploreParams(params: ExploreParams): string {
  const out: string[] = [];
  const add = (key: ExploreKey, value: string) => out.push(`${key}=${value}`);

  for (const key of EXPLORE_KEYS) {
    if (LIST_KEYS.has(key)) {
      const values = params[key as 'providers' | 'kinds' | 'regions' | 'amenities'];
      if (values.length) add(key, values.map(encodeValue).join(','));
      continue;
    }
    switch (key) {
      case 'q':
        if (params.q.trim()) add(key, encodeValue(params.q.trim()));
        break;
      case 'online':
        if (params.online) add(key, '1');
        break;
      case 'avail':
        if (params.avail) add(key, '1');
        break;
      case 'arrival':
      case 'departure':
        if (params[key]) add(key, params[key] as string);
        break;
      case 'adults':
      case 'children':
      case 'infants':
        if (params[key] !== null) add(key, String(params[key]));
        break;
      case 'map':
        if (params.map) {
          const { lng, lat, zoom } = params.map;
          add(key, [round(lng, 5), round(lat, 5), round(zoom, 2)].join(','));
        }
        break;
      case 'follow':
        if (!params.follow) add(key, '0');
        break;
      case 'view':
        if (params.view === 'map') add(key, 'map');
        break;
      case 'sel':
        if (params.sel) add(key, encodeValue(params.sel));
        break;
    }
  }
  return out.length ? `?${out.join('&')}` : '';
}

/** True when a filter (not the search text, the map or the stay) narrows the results. */
export function hasActiveFilters(params: ExploreParams): boolean {
  return (
    params.providers.length > 0 ||
    params.kinds.length > 0 ||
    params.regions.length > 0 ||
    params.amenities.length > 0 ||
    params.online
  );
}
