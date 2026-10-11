/**
 * A FakeProvider whose catalogue is searched by map area (`catalogMode: 'search'`), as a
 * marketplace's is: it cannot list every place, only the places inside a box, a page at a
 * time. Twelve made-up places spread across WA (`FAKE_SEARCH_PLACES`); availability and
 * watches work as FakeProvider's do. No bulk availability, holds, snipes or account.
 *
 *   const search = createFakeSearchProvider();                     // id 'search', 2 a page
 *   const named = createFakeSearchProvider({ textSearch: true });  // with catalog.searchText
 *   const dense = createFakeSearchProvider({ locations: manyAround(-31.95, 115.86, 30) });
 *
 * Every FakeProvider knob works: `calls`, `failNext('catalog', …)`, `delays`, `peakInFlight`.
 */

import {
  createFakeProvider,
  type FakeLocationSeed,
  type FakeProvider,
  type FakeProviderOptions,
} from './fake-provider';

/** Twelve made-up places, from the Kimberley to the south coast. */
export const FAKE_SEARCH_PLACES: readonly FakeLocationSeed[] = [
  { externalId: 'quenda', name: 'Quenda Cottage', lat: -31.95, lng: 115.86 },
  { externalId: 'bilby', name: 'Bilby Bungalow', lat: -32.05, lng: 115.75 },
  { externalId: 'marri', name: 'Marri Retreat', lat: -33.95, lng: 115.07 },
  { externalId: 'tuart', name: 'Tuart Tiny House', lat: -33.65, lng: 115.35 },
  { externalId: 'karri', name: 'Karri Loft', lat: -34.44, lng: 116.03 },
  { externalId: 'granite', name: 'Granite Shack', lat: -35.02, lng: 117.88 },
  { externalId: 'saltlake', name: 'Salt Lake Studio', lat: -33.86, lng: 121.89 },
  { externalId: 'gorge', name: 'Gorge View Rooms', lat: -27.71, lng: 114.16 },
  { externalId: 'reef', name: 'Reef Edge Units', lat: -21.93, lng: 114.13 },
  { externalId: 'pindan', name: 'Pindan Palms', lat: -17.96, lng: 122.24 },
  { externalId: 'boab', name: 'Boab Camp', lat: -15.77, lng: 128.74 },
  { externalId: 'goldfields', name: 'Goldfields Rest', lat: -30.75, lng: 121.47 },
];

/** `count` made-up places in a 0.1° square from (`lat`, `lng`), for paging tests. */
export function manyAround(lat: number, lng: number, count: number): FakeLocationSeed[] {
  return Array.from({ length: count }, (_, i) => ({
    externalId: `near-${i + 1}`,
    name: `Nearby Stay ${i + 1}`,
    lat: lat + (i % 10) * 0.01,
    lng: lng + Math.floor(i / 10) * 0.01,
  }));
}

export interface FakeSearchProviderOptions extends Omit<FakeProviderOptions, 'locations'> {
  locations?: readonly FakeLocationSeed[];
}

export function createFakeSearchProvider(options: FakeSearchProviderOptions = {}): FakeProvider {
  const id = options.id ?? 'search';
  return createFakeProvider({
    ...options,
    id,
    name: options.name ?? 'Fake Search Stays',
    shortName: options.shortName ?? 'SearchStays',
    locations: [...(options.locations ?? FAKE_SEARCH_PLACES)],
    capabilities: {
      catalog: true,
      catalogMode: 'search',
      availability: true,
      bulkAvailability: false,
      watches: true,
      snipes: false,
      holds: false,
      bookingImport: false,
      accessGate: false,
      account: 'none',
      ...options.capabilities,
    },
  });
}
