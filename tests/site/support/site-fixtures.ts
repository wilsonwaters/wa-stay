/**
 * The provider fixtures for the website screenshots (`npm run site:screenshots`), written at run
 * time into a temp folder for fixture mode (`WA_STAY_E2E_FIXTURES_DIR`).
 *
 * The Electron smoke tests' ParkStay folder (`tests/e2e/fixtures/http/parkstay/`) lists 11
 * campgrounds, which looks sparse on a map. This one serves all 169, with their real names,
 * parks, regions and positions, and keeps every other recorded response as it is:
 *
 * - `campground_map.json` is rebuilt from `tests/fixtures/catalog/parkstay-locations.json`
 *   (ParkStay's public `GET /api/campground_map/`, probed on 2026-10-02 and mapped by the
 *   provider's own `toLocationSummary`) back into the raw GeoJSON that function reads
 *   (`src/main/providers/parkstay/types.ts`). It carries no image paths at all: provider photos
 *   are never redistributed (brief O8), so no card even asks for one and every card shows the
 *   app's photo placeholder. A campground's campsites are only counted by the app, so they are
 *   listed by count, with Bungarra's five (ids 1 to 5) as its campsite view names them.
 * - `campground_availabilty_view.json` is illustrative bulk availability for the screenshots'
 *   stay, deterministic from each campground's id: in every region about a third of the
 *   campgrounds bookable online have a few sites free and the rest are full; the ones not
 *   bookable online have no totals, as ParkStay answers. Bungarra (20) has 3 of its 5 sites
 *   free, as its recorded campsite view says for the stay (sites 3, 4 and 5).
 * - Bungarra's campsite view, campground page and campground map, the signed-out profile and
 *   the queue answer are the e2e fixtures, copied unchanged, as is the manifest that routes them.
 *
 * Test data only, never committed in this form and never packaged.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  RawBulkAvailability,
  RawCampgroundFeature,
} from '../../../src/main/providers/parkstay/types';
import type { LocationSummary } from '../../../src/shared/types/catalog.types';
import { HTTP_FIXTURES_DIR, REPO_ROOT } from '../../e2e/support/paths';

/** ParkStay's 169 campgrounds as `LocationSummary`s (see `parkstay-locations.ts` beside it). */
export const CATALOGUE_FILE = path.join(
  REPO_ROOT,
  'tests/fixtures/catalog/parkstay-locations.json'
);
const E2E_PARKSTAY_DIR = path.join(REPO_ROOT, HTTP_FIXTURES_DIR, 'parkstay');

/** Bungarra, whose recorded campsite view, campground page and map the screenshots show. */
export const BUNGARRA_ID = '20';
/** Its sites free for the whole stay in its recorded campsite view (10–12 Nov 2026). */
const BUNGARRA_FREE_SITES = [3, 4, 5];
/** In each region, the share of campgrounds bookable online with sites free for the stay. */
const FREE_SHARE = 0.3;

/** `bookingMode` back to ParkStay's `campground_type` (`BOOKING_MODES` in `catalog.ts`). */
const CAMPGROUND_TYPES: Record<string, number> = {
  online: 0,
  offline: 1,
  external: 2,
  application: 4,
};

/** ParkStay's feature ids for the amenities it lists (the app reads only the names). */
const FEATURE_IDS: Record<string, number> = {
  Toilet: 8,
  'Road access for 2WD/SUV': 17,
  'Dogs permitted': 12,
};

export function readCatalogue(): LocationSummary[] {
  return JSON.parse(fs.readFileSync(CATALOGUE_FILE, 'utf8')) as LocationSummary[];
}

/** FNV-1a: the same campgrounds are picked on every run. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** A stable id for each distinct name (a park or a region), from 1, in sorted order. */
function idsOf(names: Iterable<string>): Map<string, number> {
  return new Map([...new Set(names)].sort().map((name, index) => [name, index + 1]));
}

/** The campsite ids of a campground, in order: Bungarra's own, else `<id>001`, `<id>002`… */
function campsiteIds(location: LocationSummary): number[] {
  const count = location.unitCount ?? 0;
  const base = Number(location.externalId) * 1000;
  return Array.from({ length: count }, (_, i) =>
    location.externalId === BUNGARRA_ID ? i + 1 : base + i + 1
  );
}

/** One campground as `GET /api/campground_map/` lists it. */
export function toRawFeature(
  location: LocationSummary,
  parks: ReadonlyMap<string, number>,
  regions: ReadonlyMap<string, number>
): RawCampgroundFeature {
  const parkName = location.area?.name ?? '';
  const regionName = location.area?.region ?? '';
  const region = { id: regions.get(regionName) ?? 0, name: regionName };
  return {
    type: 'Feature',
    id: Number(location.externalId),
    geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
    properties: {
      name: location.name,
      campground_type: CAMPGROUND_TYPES[location.bookingMode],
      max_advance_booking: 180,
      description: '',
      features: location.amenities.map((name) => ({ id: FEATURE_IDS[name] ?? 0, name })),
      images: [],
      info_url: location.infoUrl ?? '',
      park: {
        id: parks.get(parkName) ?? 0,
        name: parkName,
        district: { id: region.id, name: regionName, region },
      },
      price_hint: null,
      campsites: campsiteIds(location).map((id, i) => ({
        id,
        name: `CAMPSITE ${String(i + 1).padStart(2, '0')}`,
        tent: true,
        campervan: true,
        caravan: true,
        max_people: 6,
        max_vehicles: 3,
        description: 'x',
      })),
    },
  };
}

/** The raw campground map: every campground, in the catalogue's order. */
export function campgroundMap(locations: readonly LocationSummary[]) {
  const parks = idsOf(locations.map((l) => l.area?.name ?? ''));
  const regions = idsOf(locations.map((l) => l.area?.region ?? ''));
  return {
    type: 'FeatureCollection' as const,
    features: locations.map((location) => toRawFeature(location, parks, regions)),
  };
}

/** How many sites are free at a campground picked to have some: a few, never all of them. */
function freeCount(location: LocationSummary): number {
  const sites = location.unitCount ?? 0;
  const most = sites >= 20 ? 6 : Math.max(1, Math.min(3, sites - 1));
  return 1 + (hash(`count:${location.externalId}`) % most);
}

/**
 * Bulk availability for the screenshots' stay, as `GET /api/campground_availabilty_view/`
 * answers it: `total_available` is a campground's site count, `total_bookable` (and `sites`)
 * the sites free on every night.
 */
export function bulkAvailability(locations: readonly LocationSummary[]): RawBulkAvailability {
  const online = locations.filter((l) => l.bookingMode === 'online' && (l.unitCount ?? 0) > 0);
  const free = new Set<string>();
  const byRegion = new Map<string, LocationSummary[]>();
  for (const location of online) {
    const region = location.area?.region ?? '';
    byRegion.set(region, [...(byRegion.get(region) ?? []), location]);
  }
  for (const places of byRegion.values()) {
    const picked = [...places]
      .sort((a, b) => hash(`free:${a.externalId}`) - hash(`free:${b.externalId}`))
      .slice(0, Math.round(places.length * FREE_SHARE));
    for (const place of picked) free.add(place.externalId);
  }

  const bookable = new Set(online.map((l) => l.externalId));
  const available: RawBulkAvailability['campground_available'] = {};
  for (const location of locations) {
    const id = location.externalId;
    if (!bookable.has(id)) {
      available[id] = { sites: [] };
      continue;
    }
    const sites = campsiteIds(location);
    const freeSites =
      id === BUNGARRA_ID
        ? BUNGARRA_FREE_SITES
        : free.has(id)
          ? sites.slice(0, freeCount(location))
          : [];
    available[id] = {
      sites: freeSites,
      total_available: sites.length,
      total_bookable: freeSites.length,
    };
  }
  return {
    campground: {},
    campground_available: available,
    // The campgrounds ParkStay's own map marks: sites free, or booked elsewhere.
    available_cg: locations
      .filter((l) => l.bookingMode !== 'online' || available[l.externalId].sites.length > 0)
      .map((l) => ({ id: Number(l.externalId) })),
  };
}

/**
 * Writes the fixture folder (`<dir>/parkstay/`) and returns `dir`, for
 * `WA_STAY_E2E_FIXTURES_DIR`. Without `dir`, a new temp folder.
 */
export function writeSiteFixtures(dir?: string): string {
  const root = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-site-fixtures-'));
  const target = path.join(root, 'parkstay');
  fs.mkdirSync(target, { recursive: true });
  for (const file of fs.readdirSync(E2E_PARKSTAY_DIR)) {
    fs.copyFileSync(path.join(E2E_PARKSTAY_DIR, file), path.join(target, file));
  }
  const locations = readCatalogue();
  fs.writeFileSync(
    path.join(target, 'campground_map.json'),
    JSON.stringify(campgroundMap(locations))
  );
  fs.writeFileSync(
    path.join(target, 'campground_availabilty_view.json'),
    JSON.stringify(bulkAvailability(locations))
  );
  return root;
}
