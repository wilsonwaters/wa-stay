/**
 * {{NAME}}'s website: where it keeps what the module reads, and how that maps to the SDK's
 * normalised types.
 *
 * The `read…` functions run inside the browser: they may use only their argument and browser
 * globals, never a Node variable or import, and they return plain data. They read data
 * attributes, test ids and labels, never CSS class names. Everything else here is plain Node
 * code, easy to test.
 *
 * TODO: the real site's paths, labels, attributes and words.
 */

// @if search
import type { BoundingBox, LocationSummary, UnitSummary } from '@shared/types/catalog.types';
// @else
import type { LocationSummary, UnitSummary } from '@shared/types/catalog.types';
// @endif
import type {
  LocationKind,
  NightState,
  NightStatus,
  StayQuery,
  UnitAvailability,
} from '@shared/types/provider.types';
import { eachNight } from '@shared/utils/calendar-date';
import { makeLocationKey } from '@shared/utils/location-key';
import type { ProviderLinks } from '../sdk';

/** Every path, selector and label the module uses: a change on the site is a change here. */
export const SITE = {
// @if search
  /** The search page: `?west=&south=&east=&north=&page=`, a page of places at a time, or `?text=`. */
  searchPath: '/search',
  /** The link to the next page of results, when there is one. */
  nextPage: 'a[rel="next"]',
// @else
  /** The page that lists every place. */
  listPath: '/places',
// @endif
  placePath: (externalId: string): string => `/places/${encodeURIComponent(externalId)}`,
  /** A place: an item of the list, and the `main` element of its own page. */
  place: '[data-place]',
  /** A unit, on its place's page. */
  unit: 'li[data-unit]',
  /** The labels of the place page's search form, and its button. */
  arrival: 'Arrival',
  departure: 'Departure',
  guests: 'Guests',
  check: 'Check availability',
  /** What the site's script draws once the form is sent: one row per unit, a cell per night. */
  results: '[data-results]',
  resultRow: 'tr[data-unit]',
} as const;

/** A place, as its markup holds it. */
export interface RawPlace {
  externalId: string;
  kind: string;
  lat: number;
  lng: number;
  name: string;
  town: string;
}

/** A row of the availability table. */
export interface RawUnitRow {
  unitId: string;
  unitName: string;
  nights: { date: string; status: string; label: string }[];
}

/** The part of a DOM element the page functions use (the main process has no DOM types). */
interface PageElement {
  getAttribute(name: string): string | null;
  querySelector(selector: string): PageElement | null;
  querySelectorAll(selector: string): ArrayLike<PageElement>;
  readonly textContent: string | null;
}

/** Runs inside the browser: see the top of this file. */
export function readPlaces(elements: PageElement[]): RawPlace[] {
  const text = (root: PageElement, testId: string): string =>
    root.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
  return elements.map((element) => ({
    externalId: element.getAttribute('data-place') ?? '',
    kind: element.getAttribute('data-kind') ?? '',
    lat: Number(element.getAttribute('data-lat')),
    lng: Number(element.getAttribute('data-lng')),
    name: text(element, 'name'),
    town: text(element, 'town'),
  }));
}

/** Runs inside the browser: see the top of this file. */
export function readUnits(elements: PageElement[]): UnitSummary[] {
  return elements.map((element) => ({
    unitId: element.getAttribute('data-unit') ?? '',
    unitName: element.textContent?.trim() ?? '',
  }));
}

/** Runs inside the browser: see the top of this file. */
export function readRows(rows: PageElement[]): RawUnitRow[] {
  return rows.map((row) => ({
    unitId: row.getAttribute('data-unit') ?? '',
    unitName: row.getAttribute('data-unit-name') ?? '',
    nights: Array.from(row.querySelectorAll('[data-night]')).map((cell) => ({
      date: cell.getAttribute('data-night') ?? '',
      status: cell.getAttribute('data-status') ?? '',
      label: cell.textContent?.trim() ?? '',
    })),
  }));
}

/** The site's words for a kind of place. A word that is not here is `other`. */
const KINDS: Record<string, LocationKind> = { holiday: 'holiday-park', cabin: 'cabin' };

/** The site's words for a night. A word that is not here is `unknown`, never `available`. */
const NIGHT_STATES: Record<string, NightState> = {
  vacant: 'available',
  booked: 'booked',
  closed: 'closed',
};

/** `$145.00` → 145; text without a price → undefined. */
export function parsePrice(label: string): number | undefined {
  const match = /\$\s*([\d,]+(?:\.\d+)?)/.exec(label);
  return match ? Number(match[1].replace(/,/g, '')) : undefined;
}

export function toLocationSummary(
  providerId: string,
  raw: RawPlace,
  links: ProviderLinks
): LocationSummary {
  return {
    key: makeLocationKey(providerId, raw.externalId),
    providerId,
    externalId: raw.externalId,
    name: raw.name,
    kind: KINDS[raw.kind] ?? 'other',
    bookingMode: 'online',
    lat: raw.lat,
    lng: raw.lng,
    ...(raw.town ? { area: { name: raw.town } } : {}),
    imageUrls: [],
    amenities: [],
    infoUrl: links.location(raw.externalId) ?? undefined,
  };
}

/** A unit's nights for the stay: only the stay's, whatever else the page shows. */
export function toUnitAvailability(stay: StayQuery, row: RawUnitRow): UnitAvailability {
  const byDate = new Map(row.nights.map((night) => [night.date, night]));
  const nights = eachNight(stay.arrival, stay.departure).map((date): NightStatus => {
    const night = byDate.get(date);
    const state = (night && NIGHT_STATES[night.status]) ?? 'unknown';
    const price = state === 'available' && night ? parsePrice(night.label) : undefined;
    return price !== undefined ? { date, state, price } : { date, state };
  });
  const fullyAvailable = nights.every((night) => night.state === 'available');
  return { unitId: row.unitId, unitName: row.unitName, nights, fullyAvailable };
}
// @if search

/** Whether a place is inside a map area, `[west, south, east, north]` in degrees. */
export function isInside([west, south, east, north]: BoundingBox, raw: RawPlace): boolean {
  return raw.lng >= west && raw.lng <= east && raw.lat >= south && raw.lat <= north;
}
// @endif
