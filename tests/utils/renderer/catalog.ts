/**
 * `window.api.catalog` stubs for renderer tests, answering like the catalogue service over a
 * fixture (the 169 ParkStay campgrounds by default):
 *
 *   renderWithApp({ api: catalogApi() });
 *   renderWithApp({ api: catalogApi({ status: syncingStatus() }) });
 */

import type {
  CatalogQuery,
  CatalogStatus,
  LocationDetail,
  LocationSummary,
} from '../../../src/shared/types/catalog.types';
import type { CatalogAvailabilityOptions } from '../../../src/shared/contracts/catalog';
import type { BulkAvailabilityEntry, StayQuery } from '../../../src/shared/types/provider.types';
import { bulkAvailabilityFor } from '../../fixtures/catalog/bulk-availability';
import { PARKSTAY_LOCATIONS, searchLocations } from '../../fixtures/catalog/parkstay-locations';
import { availabilityFor, placeDetail } from '../../fixtures/catalog/place-detail';
import { fail, ok, type ApiStubs } from './createMockApi';

export interface CatalogApiOptions {
  items?: readonly LocationSummary[];
  status?: CatalogStatus;
  /** Replace or add catalog methods. */
  catalog?: Record<string, jest.Mock>;
  /** Other namespaces, merged in. */
  stubs?: ApiStubs;
}

export function syncedStatus(count = PARKSTAY_LOCATIONS.length): CatalogStatus {
  return {
    providers: [
      {
        providerId: 'parkstay',
        count,
        syncedAt: '2026-10-04T00:00:00Z',
        stale: false,
        syncing: false,
      },
    ],
  };
}

export function syncingStatus(): CatalogStatus {
  return { providers: [{ providerId: 'parkstay', count: 0, stale: true, syncing: true }] };
}

/** Before the first sync (it starts 5 s after launch): not syncing yet, no error. */
export function pendingStatus(): CatalogStatus {
  return { providers: [{ providerId: 'parkstay', count: 0, stale: true, syncing: false }] };
}

export function failedStatus(): CatalogStatus {
  return {
    providers: [
      {
        providerId: 'parkstay',
        count: 0,
        stale: true,
        syncing: false,
        lastError: "ParkStay didn't respond",
      },
    ],
  };
}

/** A `catalog.search` that filters `items` as main would. */
export function searchStub(items: readonly LocationSummary[] = PARKSTAY_LOCATIONS): jest.Mock {
  return jest.fn(async (query: CatalogQuery) => ok(searchLocations(query, items)));
}

/**
 * A `catalog.availability` that answers as main does: the entries of the providers asked for
 * (all when none are named), with no errors. Entries default to the fixture's
 * (tests/fixtures/catalog/bulk-availability.ts).
 */
export function availabilityStub(
  entries: readonly BulkAvailabilityEntry[] = bulkAvailabilityFor()
): jest.Mock {
  return jest.fn(async (_stay: StayQuery, options: CatalogAvailabilityOptions = {}) => {
    const wanted = options.providerIds?.length ? new Set(options.providerIds) : null;
    return ok({
      entries: entries.filter((e) => !wanted || wanted.has(e.key.slice(0, e.key.indexOf(':')))),
      errors: [],
    });
  });
}

export function catalogApi(options: CatalogApiOptions = {}): ApiStubs {
  const items = options.items ?? PARKSTAY_LOCATIONS;
  return {
    ...options.stubs,
    catalog: {
      search: searchStub(items),
      availability: availabilityStub(bulkAvailabilityFor(items)),
      status: jest.fn().mockResolvedValue(ok(options.status ?? syncedStatus(items.length))),
      refresh: jest.fn().mockResolvedValue(ok(options.status ?? syncedStatus(items.length))),
      ...options.catalog,
    },
  };
}

/** The fixture place with this name. */
export function placeNamed(name: string): LocationSummary {
  const place = PARKSTAY_LOCATIONS.find((p) => p.name === name);
  if (!place) throw new Error(`No fixture place named ${name}`);
  return place;
}

export interface PlaceApiOptions extends CatalogApiOptions {
  /** What `catalog.get` returns for its key; any other key is NOT_FOUND. */
  detail?: LocationDetail;
}

/**
 * The catalogue stubs plus a place's detail (`catalog.get`, Bungarra by default) and
 * `catalog.checkLocation` answering 8 of 24 sites free (tests/fixtures/catalog/place-detail.ts).
 */
export function placeApi(options: PlaceApiOptions = {}): ApiStubs {
  const detail = options.detail ?? placeDetail();
  return catalogApi({
    ...options,
    catalog: {
      get: jest.fn(async (key: string) =>
        key === detail.key ? ok(detail) : fail(`There is no location ${key}`, 'NOT_FOUND')
      ),
      checkLocation: jest.fn(async (_key: string, stay: StayQuery) =>
        ok(availabilityFor(stay, {}, detail.units))
      ),
      ...options.catalog,
    },
  });
}
