/**
 * Location catalogue types shared by main and renderer (architecture-notes §3, §12.15–§12.17).
 *
 * A location is identified across providers by its key, `${providerId}:${externalId}`
 * (`shared/utils/location-key.ts`). No node or electron imports.
 */

import { z } from 'zod';
import { assertTypeEquals, type Simplify } from '../utils/type-equality';
import {
  BookingModeSchema,
  LocationKindSchema,
  ProviderIdSchema,
  type BookingMode,
  type BulkAvailabilityEntry,
  type LocationKind,
  type ProviderId,
} from './provider.types';

export interface LocationSummary {
  /** `${providerId}:${externalId}` */
  key: string;
  providerId: ProviderId;
  externalId: string;
  name: string;
  kind: LocationKind;
  bookingMode: BookingMode;
  lat: number;
  lng: number;
  area?: { name: string; region?: string };
  summary?: string;
  /** Absolute https URLs. */
  imageUrls: string[];
  amenities: string[];
  unitCount?: number;
  infoUrl?: string;
  /** A date-less booking link. Prefer `LocationAvailability.bookingUrl` once dates are known. */
  bookingUrl?: string;
}

/** An individually bookable unit (site, cabin, room). Same naming as `UnitAvailability` (§12.16). */
export interface UnitSummary {
  unitId: string;
  unitName: string;
  unitType?: string;
  /** The fewest people the unit is booked for, when the provider says. */
  minPeople?: number;
  maxPeople?: number;
  maxVehicles?: number;
  equipment?: string[];
  amenities?: string[];
  /** Plain text, never HTML: shown as text. */
  description?: string;
}

/**
 * A titled part of a location's description, such as ParkStay's "Booking" or "Fees". The
 * place page shows each as a disclosure, the first open.
 */
export interface LocationSection {
  /** Plain text. A provider's untitled intro gets a title of its own ("Overview"). */
  title: string;
  /**
   * Sanitised in main before it crosses IPC, as `descriptionHtml` is. Its headings nest under
   * the section's title: the highest is `h4`.
   */
  html: string;
}

/** How serious a location notice is. The place page shows it with an icon and in words. */
export type LocationNoticeLevel = 'warning' | 'caution' | 'info';

/** A short notice the provider shows on the location, such as "No campfires at any time". */
export interface LocationNotice {
  level: LocationNoticeLevel;
  /** Plain text, never HTML: shown as text. */
  text: string;
}

/** What a location document is: its map (ParkStay's campground map), or another document. */
export type LocationDocumentKind = 'map' | 'document';

/**
 * A document the provider publishes about a location, such as ParkStay's campground map (a
 * PDF). Its address never crosses IPC: main keeps it with the cached detail and opens the
 * document itself (`catalog.openDocument`), by the location's key and this `id`.
 */
export interface LocationDocument {
  /** Stable within the location, e.g. `campground-map`. */
  id: string;
  kind: LocationDocumentKind;
  /** Plain text, e.g. "Campground map". */
  title: string;
  /** The media type the provider serves it as, e.g. `application/pdf`. */
  mediaType: string;
}

export interface LocationDetail extends LocationSummary {
  /** Sanitised in main before it crosses IPC. */
  descriptionHtml?: string;
  /**
   * The description in titled parts, in the provider's order. When present, the place page
   * shows these instead of `descriptionHtml`.
   */
  sections?: LocationSection[];
  /** The provider's notices about the location, in its order. */
  notices?: LocationNotice[];
  /** Documents about the location (its map), opened by main; absent when there are none. */
  documents?: LocationDocument[];
  units: UnitSummary[];
  /** A human sentence, e.g. "Bookings open 180 days ahead at midnight AWST". */
  releaseInfo?: string;
  /** ISO timestamp the detail was fetched from the provider. */
  fetchedAt?: string;
  /** True when this is a cached copy because the provider could not be reached. */
  stale?: boolean;
}

/** `[west, south, east, north]` in degrees. */
export type BoundingBox = [west: number, south: number, east: number, north: number];

export type CatalogSort = 'relevance' | 'name';

/** The largest page `catalog.search` returns, and its default: "everything" (§12.15). */
export const CATALOG_MAX_LIMIT = 5000;

export interface CatalogQuery {
  /** Free text (not `q`). */
  text?: string;
  providerIds?: ProviderId[];
  kinds?: LocationKind[];
  regions?: string[];
  amenities?: string[];
  bookingModes?: BookingMode[];
  bbox?: BoundingBox;
  /** 1–5000; defaults to 5000. */
  limit?: number;
  offset?: number;
  sort?: CatalogSort;
}

export interface FacetCount {
  value: string;
  count: number;
}

export interface CatalogSearchResult {
  items: LocationSummary[];
  /** Every match, ignoring `limit` and `offset`. */
  total: number;
  /**
   * The `search` catalogues (`catalogMode: 'search'`) being asked about this query's area or
   * text in the background. Their new places arrive with `catalog:updated`; absent when none.
   */
  pending?: ProviderId[];
  facets?: {
    regions: FacetCount[];
    amenities: FacetCount[];
    kinds: FacetCount[];
    providers: FacetCount[];
  };
}

/** Why a provider's part of a cross-provider availability call failed. */
export type CatalogErrorCode = 'access-gate' | 'timeout' | 'http' | 'parse' | 'unknown';

export interface CatalogAvailabilityResult {
  entries: BulkAvailabilityEntry[];
  /** One entry per provider that failed; the others still answer. */
  errors: { providerId: ProviderId; code: CatalogErrorCode; message: string }[];
}

/** How a `search` catalogue is filled: by area and text searches, never by a sync. */
export interface CatalogSearchStatus {
  /**
   * The provider can be searched by name (`catalog.searchText`). Without it, a name finds
   * only its places already seen on the map.
   */
  textSearch: boolean;
  /** ISO timestamp of the last area or text search that answered. */
  searchedAt?: string;
}

export interface CatalogProviderStatus {
  providerId: ProviderId;
  /** Locations stored. */
  count: number;
  /** ISO timestamp of the last successful sync (`full` catalogues). */
  syncedAt?: string;
  /** A `full` catalogue is due a sync; always false for a `search` one. */
  stale: boolean;
  /** A sync, or for a `search` catalogue an area or text search, is in flight. */
  syncing: boolean;
  /** Why the latest sync (or search) failed; absent after a success. */
  lastError?: string;
  /** Present for a `search` catalogue (`catalogMode: 'search'`). */
  search?: CatalogSearchStatus;
}

export interface CatalogStatus {
  providers: CatalogProviderStatus[];
}

/**
 * Payload of the `catalog:updated` event: a provider's catalogue synced, or an area or text
 * search of a `search` catalogue stored places that were not stored before.
 */
export interface CatalogUpdatedEvent {
  providerId: ProviderId;
  /** Locations the sync (or the search) stored. */
  count: number;
  /** ISO timestamp of the sync or search. */
  syncedAt: string;
}

// ---------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------

// z.number() rejects Infinity and NaN.
const longitude = z.number().min(-180).max(180);
const latitude = z.number().min(-90).max(90);

/**
 * `[west, south, east, north]`. West must not be east of east: WA never spans the
 * antimeridian, so a box that wraps it is a mistake, not a request.
 */
export const BoundingBoxSchema = z
  .tuple([longitude, latitude, longitude, latitude])
  .refine(([, south, , north]) => south <= north, 'South must not be north of north')
  .refine(([west, , east]) => west <= east, 'West must not be east of east');
assertTypeEquals<z.input<typeof BoundingBoxSchema>, BoundingBox>(true);
assertTypeEquals<z.output<typeof BoundingBoxSchema>, BoundingBox>(true);

export const CatalogQuerySchema = z.object({
  text: z.string().max(200).optional(),
  providerIds: z.array(ProviderIdSchema).optional(),
  kinds: z.array(LocationKindSchema).optional(),
  regions: z.array(z.string()).optional(),
  amenities: z.array(z.string()).optional(),
  bookingModes: z.array(BookingModeSchema).optional(),
  bbox: BoundingBoxSchema.optional(),
  limit: z.number().int().min(1).max(CATALOG_MAX_LIMIT).default(CATALOG_MAX_LIMIT),
  offset: z.number().int().nonnegative().optional(),
  sort: z.enum(['relevance', 'name']).optional(),
});
/** A `CatalogQuery` after parsing: `limit` has its default. */
export type ParsedCatalogQuery = Simplify<Omit<CatalogQuery, 'limit'> & { limit: number }>;
assertTypeEquals<z.input<typeof CatalogQuerySchema>, CatalogQuery>(true);
assertTypeEquals<z.output<typeof CatalogQuerySchema>, ParsedCatalogQuery>(true);
