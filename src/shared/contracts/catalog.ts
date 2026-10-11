/**
 * `catalog`: locations from every catalogue provider (search, detail, availability), served
 * by the location catalogue service (`main/core/catalog`). Syncs arrive as `catalog:updated`
 * events.
 */

import { z } from 'zod';
import {
  BoundingBoxSchema,
  CatalogQuerySchema,
  type BoundingBox,
  type CatalogAvailabilityResult,
  type CatalogQuery,
  type CatalogSearchResult,
  type CatalogStatus,
  type LocationDetail,
} from '../types/catalog.types';
import {
  ProviderIdSchema,
  StayQuerySchema,
  type LocationAvailability,
  type ProviderId,
  type StayQuery,
} from '../types/provider.types';
import { LocationKeySchema } from '../utils/location-key';
import { assertTypeEquals } from '../utils/type-equality';
import { CHANNELS } from './channels';
import type { Namespace } from './define';

/** Narrows `catalog.availability` to some providers or a map area. */
export interface CatalogAvailabilityOptions {
  providerIds?: ProviderId[];
  bbox?: BoundingBox;
}

/** The `catalog.get` payload. */
export interface CatalogGetRequest {
  /** Location key `${providerId}:${externalId}`. */
  key: string;
}

/** The `catalog.availability` payload: the stay plus the options, flattened. */
export interface CatalogAvailabilityRequest extends CatalogAvailabilityOptions {
  stay: StayQuery;
}

/** The `catalog.checkLocation` payload. */
export interface CatalogCheckLocationRequest {
  key: string;
  stay: StayQuery;
}

/** The `catalog.refresh` payload: one provider, or every catalogue provider. */
export interface CatalogRefreshRequest {
  providerId?: ProviderId;
}

/**
 * The `catalog.openDocument` payload: a location's document by the location's key and the
 * document's id (`LocationDocument.id`). Never its address: main resolves it.
 */
export interface CatalogOpenDocumentRequest {
  locationKey: string;
  documentId: string;
}

const getRequest = z.object({ key: LocationKeySchema });
const availabilityRequest = z.object({
  stay: StayQuerySchema,
  providerIds: z.array(ProviderIdSchema).optional(),
  bbox: BoundingBoxSchema.optional(),
});
const checkLocationRequest = z.object({ key: LocationKeySchema, stay: StayQuerySchema });
const refreshRequest = z.object({ providerId: ProviderIdSchema.optional() });
const openDocumentRequest = z.object({
  locationKey: LocationKeySchema,
  documentId: z.string().min(1).max(64),
});

assertTypeEquals<z.input<typeof getRequest>, CatalogGetRequest>(true);
assertTypeEquals<z.output<typeof getRequest>, CatalogGetRequest>(true);
assertTypeEquals<z.input<typeof availabilityRequest>, CatalogAvailabilityRequest>(true);
assertTypeEquals<z.output<typeof availabilityRequest>, CatalogAvailabilityRequest>(true);
assertTypeEquals<z.input<typeof checkLocationRequest>, CatalogCheckLocationRequest>(true);
assertTypeEquals<z.output<typeof checkLocationRequest>, CatalogCheckLocationRequest>(true);
assertTypeEquals<z.input<typeof refreshRequest>, CatalogRefreshRequest>(true);
assertTypeEquals<z.output<typeof refreshRequest>, CatalogRefreshRequest>(true);
assertTypeEquals<z.input<typeof openDocumentRequest>, CatalogOpenDocumentRequest>(true);
assertTypeEquals<z.output<typeof openDocumentRequest>, CatalogOpenDocumentRequest>(true);

const C = CHANNELS.catalog;

export const catalog = {
  search: {
    channel: C.search,
    request: CatalogQuerySchema,
    args: {} as [query: CatalogQuery],
    response: {} as CatalogSearchResult,
  },
  get: {
    channel: C.get,
    request: getRequest,
    args: {} as [key: string],
    response: {} as LocationDetail,
  },
  /** Bulk availability across providers; failing providers are listed in `errors`. */
  availability: {
    channel: C.availability,
    request: availabilityRequest,
    args: {} as [stay: StayQuery, options?: CatalogAvailabilityOptions],
    response: {} as CatalogAvailabilityResult,
  },
  checkLocation: {
    channel: C.checkLocation,
    request: checkLocationRequest,
    args: {} as [key: string, stay: StayQuery],
    response: {} as LocationAvailability,
  },
  /** Re-syncs one provider's catalogue (or all), then returns the status. */
  refresh: {
    channel: C.refresh,
    request: refreshRequest,
    args: {} as [providerId?: ProviderId],
    response: {} as CatalogStatus,
  },
  status: { channel: C.status, request: z.void(), args: {} as [], response: {} as CatalogStatus },
  /**
   * Opens a location's document (`LocationDetail.documents`, such as ParkStay's campground
   * map) in a document window, or focuses its window when it is open. Main takes the address
   * from the cached detail. Resolves once the document has arrived; `NOT_FOUND` for an unknown
   * location or document, `PROVIDER_ERROR` when the provider did not send it (the window
   * closes).
   */
  openDocument: {
    channel: C.openDocument,
    request: openDocumentRequest,
    args: {} as [locationKey: string, documentId: string],
    response: undefined as void,
  },
} satisfies Namespace;
