import { PARKSTAY_LOCATIONS } from '../../../../../tests/fixtures/catalog/parkstay-locations';
import type { LocationSummary } from '../../../../shared/types/catalog.types';
import {
  buildFacets,
  facetCounts,
  matchesFilters,
  NO_FILTERS,
  type ExploreFilters,
} from './facets';

const filters = (patch: Partial<ExploreFilters>): ExploreFilters => ({ ...NO_FILTERS, ...patch });
const PROVIDERS = [{ id: 'parkstay', name: 'ParkStay WA' }];

const place = (patch: Partial<LocationSummary>): LocationSummary => ({
  key: 'parkstay:1',
  providerId: 'parkstay',
  externalId: '1',
  name: 'Lucky Bay',
  kind: 'campground',
  bookingMode: 'online',
  lat: -33.99,
  lng: 122.23,
  area: { name: 'Cape Le Grand National Park', region: 'South Coast' },
  imageUrls: [],
  amenities: ['Toilet', 'Dogs permitted'],
  ...patch,
});

describe('matchesFilters', () => {
  it('ORs options within a filter and ANDs filters together', () => {
    const lucky = place({});
    expect(matchesFilters(lucky, filters({ regions: ['Pilbara', 'South Coast'] }))).toBe(true);
    expect(matchesFilters(lucky, filters({ regions: ['Pilbara'] }))).toBe(false);
    expect(
      matchesFilters(lucky, filters({ regions: ['South Coast'], bookingModes: ['offline'] }))
    ).toBe(false);
  });

  it('needs every chosen amenity', () => {
    const lucky = place({});
    expect(matchesFilters(lucky, filters({ amenities: ['Toilet', 'Dogs permitted'] }))).toBe(true);
    expect(matchesFilters(lucky, filters({ amenities: ['Toilet', 'Showers'] }))).toBe(false);
  });

  it('can ignore one filter, for that filter’s own counts', () => {
    expect(matchesFilters(place({}), filters({ regions: ['Pilbara'] }), 'regions')).toBe(true);
  });
});

describe('facet counts over the ParkStay catalogue', () => {
  it('counts each region with the other filters applied (39 in the Pilbara)', () => {
    const regions = facetCounts(PARKSTAY_LOCATIONS, NO_FILTERS, 'regions');
    expect(regions.get('Pilbara')).toBe(39);
    expect(regions.get('Kimberley')).toBe(7);
    // Ticking Pilbara does not change the other regions' counts (OR within a chip)…
    expect(facetCounts(PARKSTAY_LOCATIONS, filters({ regions: ['Pilbara'] }), 'regions')).toEqual(
      regions
    );
    // …but another chip does.
    const online = facetCounts(
      PARKSTAY_LOCATIONS,
      filters({ bookingModes: ['online'] }),
      'regions'
    );
    expect(online.get('Pilbara')).toBeLessThan(39);
  });

  it('counts amenities as "what you would get by adding it"', () => {
    const withDogs = facetCounts(
      PARKSTAY_LOCATIONS,
      filters({ amenities: ['Dogs permitted'] }),
      'amenities'
    );
    expect(withDogs.get('Dogs permitted')).toBe(40);
    expect(withDogs.get('Toilet')).toBe(23);
  });

  it('builds every chip: providers always, kinds, regions and amenities sorted, online count', () => {
    const facets = buildFacets(PARKSTAY_LOCATIONS, PARKSTAY_LOCATIONS, NO_FILTERS, PROVIDERS);
    expect(facets.providers).toEqual([{ value: 'parkstay', label: 'ParkStay WA', count: 169 }]);
    expect(facets.kinds.map((k) => `${k.label} ${k.count}`)).toEqual([
      'Cabin 2',
      'Campground 139',
      'Caravan park 1',
      'Farm stay 4',
      'Glamping 2',
      'Holiday park 5',
      'Hut 1',
      'Place to stay 15',
    ]);
    expect(facets.regions.map((r) => r.label)).toEqual([
      'Goldfields',
      'Kimberley',
      'Midwest',
      'PICA',
      'Pilbara',
      'South Coast',
      'South West',
      'Swan',
      'Warren',
      'Wheatbelt',
    ]);
    expect(facets.amenities.map((a) => `${a.label} ${a.count}`)).toEqual([
      'Dogs permitted 40',
      'Road access for 2WD/SUV 103',
      'Toilet 128',
    ]);
    expect(facets.online).toBe(106);
  });

  it('takes counts over the text matches while keeping every option listed', () => {
    const cape = PARKSTAY_LOCATIONS.filter((p) => /cape/i.test(`${p.name} ${p.area?.name}`));
    const facets = buildFacets(PARKSTAY_LOCATIONS, cape, NO_FILTERS, PROVIDERS);
    expect(facets.regions).toHaveLength(10);
    expect(facets.regions.find((r) => r.value === 'Kimberley')?.count).toBe(0);
    expect(facets.providers[0].count).toBe(cape.length);
  });
});
