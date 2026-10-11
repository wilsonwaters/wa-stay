/**
 * The ParkStay catalogue: every campground from `GET /api/campground_map/` (one 1.2 MB
 * GeoJSON call) as `LocationSummary`s, and a campground's detail: its sites and release
 * sentence from `campsite_availablity_view`, and its sections and notices from its campground
 * page (`campground-page.ts`), fetched side by side. When the page cannot be read, the
 * sections the core stored last are kept; with none, the view's legacy `long_description` is
 * the description. With sections, it is left out: it is out of date.
 *
 * The map's `description` is empty for every campground, so summaries have no `summary`;
 * the description comes with the detail. Booking modes follow `campground_type`
 * (0 online, 1 offline, 2 another operator, 4 by application).
 *
 * `CampgroundFacts` is what the module has learnt about each campground, in memory: its
 * type and booking window from the map, and its release and site-class facts from the
 * latest availability view. Availability, the release policy and holds read it.
 *
 * The view's `map` is the campground's map, a one-page PDF on ParkStay's own site: it becomes
 * the detail's one document (`campgroundMapDocument`), whose address stays in main.
 *
 * The map is the one large download (1.2 MB). The detail of a campground the caller already
 * has a summary of (the core's stored catalogue) is built from that summary, so the first
 * detail after a launch does not download the map again.
 */

import type { LocationSummary, UnitSummary } from '@shared/types/catalog.types';
import type { BookingMode, LocationKind, StayQuery } from '@shared/types/provider.types';
import { addDays, todayIn } from '@shared/utils/calendar-date';
import { makeLocationKey } from '@shared/utils/location-key';
import type { ProviderContext, ProviderLogger } from '../sdk/context';
import { ProviderError, ProviderParseError, throwIfAborted } from '../sdk/errors';
import type {
  CatalogModule,
  GetLocationOptions,
  ProviderLocationDetail,
  ProviderLocationDocument,
} from '../sdk/provider';
import { describeUrl } from '../sdk/url-patterns';
import type { CampsiteViews } from './availability';
import { fetchCampgroundPage } from './campground-page';
import type { ParkStayClient } from './client';
import { PARKSTAY_BASE_URL, PARKSTAY_PROVIDER_ID } from './constants';
import { campgroundDescriptionHtml } from './description';
import { parkstayLinks } from './links';
import type { ParkStayReleasePolicy } from './release-policy';
import { isClassListing, toClassUnitSummary, unitFacts } from './site-classes';
import type {
  RawCampgroundFeature,
  RawCampgroundMap,
  RawCampsite,
  RawCampsiteAvailabilityView,
} from './types';

/** `campground_type` → booking mode (0 online, 1 offline, 2 other operator, 4 application). */
const BOOKING_MODES: Record<number, BookingMode> = {
  0: 'online',
  1: 'offline',
  2: 'external',
  4: 'application',
};

const CAMPGROUND_TYPES: Partial<Record<BookingMode, number>> = Object.fromEntries(
  Object.entries(BOOKING_MODES).map(([type, mode]) => [mode, Number(type)])
);

// ---------------------------------------------------------------------------------------
// Campground facts
// ---------------------------------------------------------------------------------------

export interface ViewFacts {
  /** 0 lists each site; 1 and 2 list campsite classes (book by class). */
  siteType: number;
  releaseDate?: string;
  bookingTimeOpen: boolean;
  /** For class listings: the site id the view gave for each class → its campsite class id. */
  classOfUnit: ReadonlyMap<string, string>;
  /** For class listings: the campsite class ids, in the view's order. */
  classIds: readonly string[];
  /** When the view was read (epoch ms). */
  at: number;
}

export class CampgroundFacts {
  private readonly fromMap = new Map<string, { type: number; maxAdvance?: number }>();
  private readonly fromView = new Map<string, ViewFacts>();

  rememberFeature(externalId: string, campgroundType: number, maxAdvanceBooking: number): void {
    this.fromMap.set(externalId, { type: campgroundType, maxAdvance: maxAdvanceBooking });
  }

  /**
   * The campground type from a stored summary's booking mode, when the map has not been read
   * in this run. The booking window stays unknown (the default, 180 days, applies).
   */
  rememberBookingMode(externalId: string, mode: BookingMode): void {
    const type = CAMPGROUND_TYPES[mode];
    if (type !== undefined && !this.fromMap.has(externalId)) this.fromMap.set(externalId, { type });
  }

  rememberView(externalId: string, view: RawCampsiteAvailabilityView, at: Date): void {
    const siteType = typeof view.site_type === 'number' ? view.site_type : 0;
    const classOfUnit = new Map<string, string>();
    if (siteType !== 0) {
      // A class listing's `type` is the campsite class; its `id` one site in it.
      for (const site of view.sites) classOfUnit.set(String(site.id), String(site.type));
    }
    this.fromView.set(externalId, {
      siteType,
      releaseDate: view.release_date ?? undefined,
      bookingTimeOpen: view.booking_time_open !== false,
      classOfUnit,
      classIds: [...new Set(classOfUnit.values())],
      at: at.getTime(),
    });
  }

  campgroundType(externalId: string): number | undefined {
    return this.fromMap.get(externalId)?.type;
  }

  /** `max_advance_booking` from the catalogue, when it has been read. */
  maxAdvanceBooking(externalId: string): number | undefined {
    return this.fromMap.get(externalId)?.maxAdvance;
  }

  view(externalId: string): ViewFacts | undefined {
    return this.fromView.get(externalId);
  }
}

// ---------------------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------------------

/** What an "other operator" (type 2) location is, from its name. */
export function kindFromName(name: string): LocationKind {
  const lower = name.toLowerCase();
  if (/holiday park|tourist park/.test(lower)) return 'holiday-park';
  if (/caravan park/.test(lower)) return 'caravan-park';
  if (/cottage|chalet|cabin/.test(lower)) return 'cabin';
  if (/\bhut\b/.test(lower)) return 'hut';
  if (/homestead|station/.test(lower)) return 'farm-stay';
  if (/eco retreat|sal salis/.test(lower)) return 'glamping';
  return 'other';
}

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

function imageUrls(images: RawCampgroundFeature['properties']['images']): string[] {
  const urls = new Set<string>();
  for (const { image } of images ?? []) {
    if (typeof image !== 'string' || !image) continue;
    try {
      const url = new URL(image, PARKSTAY_BASE_URL);
      if (url.protocol === 'https:') urls.add(url.href);
    } catch {
      // An unreadable image path is left out.
    }
  }
  return [...urls];
}

/** The campground map's id among a detail's documents. */
export const CAMPGROUND_MAP_DOCUMENT_ID = 'campground-map';

/**
 * The availability view's `map` (a site-relative path, or null) as the campground map
 * document: its address resolved against ParkStay's site, and refused (undefined, logged by
 * origin only) unless it is https on ParkStay's own origin. Its name is taken as given, never
 * built.
 */
export function campgroundMapDocument(
  map: unknown,
  logger?: Pick<ProviderLogger, 'warn'>
): ProviderLocationDocument | undefined {
  if (typeof map !== 'string' || !map.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(map.trim(), PARKSTAY_BASE_URL);
  } catch {
    logger?.warn('ParkStay campground map: an unreadable address was left out');
    return undefined;
  }
  if (
    url.protocol !== 'https:' ||
    url.origin !== PARKSTAY_BASE_URL ||
    url.username !== '' ||
    url.password !== ''
  ) {
    logger?.warn(`ParkStay campground map: an address on ${describeUrl(url.href)} was left out`);
    return undefined;
  }
  return {
    id: CAMPGROUND_MAP_DOCUMENT_ID,
    kind: 'map',
    title: 'Campground map',
    mediaType: 'application/pdf',
    url: url.href,
  };
}

/**
 * A map feature as a `LocationSummary`, or undefined (logged) for one without coordinates.
 */
export function toLocationSummary(
  feature: RawCampgroundFeature,
  logger?: ProviderLogger
): LocationSummary | undefined {
  const externalId = String(feature.id);
  const p = feature.properties;
  const coordinates = feature.geometry?.coordinates;
  if (
    !Array.isArray(coordinates) ||
    !Number.isFinite(coordinates[0]) ||
    !Number.isFinite(coordinates[1])
  ) {
    logger?.warn(`ParkStay campground ${externalId} has no coordinates; left out`);
    return undefined;
  }

  const type = p.campground_type;
  let bookingMode = BOOKING_MODES[type];
  if (!bookingMode) {
    logger?.warn(`ParkStay campground ${externalId} has an unknown campground_type ${type}`);
    bookingMode = 'offline';
  }
  const kind: LocationKind = type === 2 ? kindFromName(p.name ?? '') : 'campground';
  const region = p.park?.district?.region?.name;
  const summary = typeof p.description === 'string' ? p.description.trim() : '';
  const unitCount = Array.isArray(p.campsites) ? p.campsites.length : 0;
  const infoUrl = typeof p.info_url === 'string' ? p.info_url.trim() : '';

  return {
    key: makeLocationKey(PARKSTAY_PROVIDER_ID, externalId),
    providerId: PARKSTAY_PROVIDER_ID,
    externalId,
    name: p.name,
    kind,
    bookingMode,
    lat: round6(coordinates[1]),
    lng: round6(coordinates[0]),
    ...(p.park?.name ? { area: { name: p.park.name, ...(region ? { region } : {}) } } : {}),
    ...(summary ? { summary } : {}),
    imageUrls: imageUrls(p.images),
    amenities: (p.features ?? []).map((f) => f.name).filter((n) => typeof n === 'string'),
    ...(unitCount > 0 ? { unitCount } : {}),
    ...(infoUrl ? { infoUrl } : {}),
    ...(type === 0 ? { bookingUrl: parkstayLinks.location(externalId)! } : {}),
  };
}

/** A site in an availability view as a `UnitSummary`. */
export function toUnitSummary(
  site: RawCampsite,
  classes: RawCampsiteAvailabilityView['classes']
): UnitSummary {
  const className = classes?.[String(site.class ?? null)];
  return {
    unitId: String(site.id),
    unitName: site.name,
    ...(className ? { unitType: className } : {}),
    ...unitFacts(site),
  };
}

function isCampgroundMap(body: unknown): body is RawCampgroundMap {
  return (
    typeof body === 'object' && body !== null && Array.isArray((body as RawCampgroundMap).features)
  );
}

function isFeature(value: unknown): value is RawCampgroundFeature {
  const feature = value as RawCampgroundFeature;
  return (
    typeof value === 'object' &&
    value !== null &&
    (typeof feature.id === 'number' || typeof feature.id === 'string') &&
    typeof feature.properties === 'object' &&
    feature.properties !== null &&
    typeof feature.properties.name === 'string'
  );
}

// ---------------------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------------------

export interface CatalogDeps {
  ctx: Pick<ProviderContext, 'id' | 'timezone' | 'limits' | 'logger' | 'clock'>;
  client: ParkStayClient;
  facts: CampgroundFacts;
  views: CampsiteViews;
  release: ParkStayReleasePolicy;
}

/** The ParkStay catalogue module (`catalogMode: 'full'`). */
export function createCatalog({ ctx, client, facts, views, release }: CatalogDeps): CatalogModule {
  let cache: { at: number; byId: Map<string, LocationSummary> } | undefined;
  const ttlMs = ctx.limits.catalogTtlHours * 3_600_000;

  async function listLocations(signal?: AbortSignal): Promise<LocationSummary[]> {
    const body = await client.getApi<unknown>('/campground_map/', { signal });
    if (!isCampgroundMap(body)) {
      throw new ProviderParseError({
        providerId: ctx.id,
        message: `${ctx.id}: the campground map is not a GeoJSON FeatureCollection`,
      });
    }
    const locations: LocationSummary[] = [];
    for (const feature of body.features) {
      if (!isFeature(feature)) {
        ctx.logger.warn('ParkStay campground map: a feature without an id or name was left out');
        continue;
      }
      const location = toLocationSummary(feature, ctx.logger);
      if (!location) continue;
      facts.rememberFeature(
        location.externalId,
        feature.properties.campground_type,
        feature.properties.max_advance_booking
      );
      locations.push(location);
    }
    cache = { at: ctx.clock().getTime(), byId: new Map(locations.map((l) => [l.externalId, l])) };
    return locations;
  }

  const cacheFresh = (): boolean => !!cache && ctx.clock().getTime() - cache.at <= ttlMs;

  /**
   * The campground's summary: from the map read in this run while it is fresh, else the
   * caller's (the core's stored catalogue), else from the map, read again.
   */
  async function summaryOf(
    externalId: string,
    signal?: AbortSignal,
    given?: LocationSummary
  ): Promise<LocationSummary | undefined> {
    if (cacheFresh()) return cache!.byId.get(externalId);
    if (given && given.providerId === ctx.id && given.externalId === externalId) {
      facts.rememberBookingMode(externalId, given.bookingMode);
      return given;
    }
    await listLocations(signal);
    return cache?.byId.get(externalId);
  }

  /** A one-night stay from tomorrow (Perth), one adult: enough for the description and sites. */
  function probeStay(): StayQuery {
    const today = todayIn(ctx.timezone, ctx.clock());
    return { arrival: addDays(today, 1), departure: addDays(today, 2), adults: 1 };
  }

  async function getLocation(
    externalId: string,
    signal?: AbortSignal,
    options?: GetLocationOptions
  ): Promise<ProviderLocationDetail> {
    throwIfAborted(signal);
    const summary = await summaryOf(externalId, signal, options?.summary);
    if (!summary) {
      throw new ProviderError({
        providerId: ctx.id,
        message: `${ctx.id}: there is no campground ${externalId}`,
      });
    }
    const detail: ProviderLocationDetail = { ...summary, units: [] };
    // A stored summary may carry a link in an older form; the link is always today's.
    if (summary.bookingMode === 'online') detail.bookingUrl = parkstayLinks.location(externalId)!;
    // Only online and offline campgrounds have an availability view (types 2 and 4 are 400).
    if (summary.bookingMode === 'online' || summary.bookingMode === 'offline') {
      const [view, page] = await Promise.all([
        views.fetch(externalId, probeStay(), signal),
        fetchCampgroundPage(client, externalId, ctx.logger, signal),
      ]);
      const previous = options?.previous;
      const kept =
        previous?.providerId === ctx.id && previous.externalId === externalId
          ? { sections: previous.sections ?? [], notices: previous.notices ?? [] }
          : undefined;
      const details = page ?? kept;
      if (details && details.sections.length > 0) {
        detail.sections = details.sections;
        if (details.notices.length > 0) detail.notices = details.notices;
      } else if (view.long_description) {
        detail.descriptionHtml = campgroundDescriptionHtml(view.long_description);
      }
      detail.units = isClassListing(view)
        ? view.sites.map(toClassUnitSummary)
        : view.sites.map((site) => toUnitSummary(site, view.classes));
      const map = campgroundMapDocument(view.map, ctx.logger);
      if (map) detail.documents = [map];
    }
    const releaseInfo = await release.describe(externalId, signal);
    if (releaseInfo) detail.releaseInfo = releaseInfo;
    detail.fetchedAt = ctx.clock().toISOString();
    return detail;
  }

  return { listLocations, getLocation };
}
