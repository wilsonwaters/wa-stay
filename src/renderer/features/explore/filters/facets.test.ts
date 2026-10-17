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

describe('stay types', () => {
  const park = place({ key: 'parkstay:2', kind: 'holiday-park', name: 'Woodman Point' });
  const hut = place({ key: 'parkstay:3', kind: 'hut', name: 'Yeagarup Hut' });
  const homestead = place({ key: 'parkstay:4', kind: 'farm-stay', name: 'Mount Hart' });
  const villas = place({
    key: 'rott:1',
    providerId: 'rott',
    kind: 'other',
    unitKinds: ['cabin', 'room'],
  });

  it('passes a place with any chosen kind: its own unit kinds, or those its kind gives', () => {
    const cabins = filters({ stayTypes: ['cabin'] });
    expect(matchesFilters(park, cabins)).toBe(true);
    expect(matchesFilters(villas, cabins)).toBe(true);
    expect(matchesFilters(place({}), cabins)).toBe(false);
    expect(matchesFilters(hut, filters({ stayTypes: ['cabin', 'dorm'] }))).toBe(true);
    expect(matchesFilters(homestead, filters({ stayTypes: ['campsite', 'cabin'] }))).toBe(false);
    expect(matchesFilters(place({}), filters({ stayTypes: [] }))).toBe(true);
    // Its own list wins over its kind: an "other" place with rooms is not "other".
    expect(matchesFilters(villas, filters({ stayTypes: ['room'] }))).toBe(true);
  });

  it('counts a place once for each of its kinds, with the other chips applied', () => {
    const items = [place({}), park, hut, homestead, villas];
    const counts = facetCounts(items, NO_FILTERS, 'stayTypes');
    expect(Object.fromEntries(counts)).toEqual({
      campsite: 2,
      cabin: 2,
      dorm: 1,
      room: 1,
      other: 1,
    });
    // Its own choice is left out of its counts (OR within a chip)…
    expect(facetCounts(items, filters({ stayTypes: ['dorm'] }), 'stayTypes')).toEqual(counts);
    // …but another chip applies.
    expect(
      Object.fromEntries(facetCounts(items, filters({ providerIds: ['rott'] }), 'stayTypes'))
    ).toEqual({ cabin: 1, room: 1 });
  });

  it('lists only the groups the catalogue has, in group order, never "other"', () => {
    const facets = buildFacets([villas, hut, homestead], [villas, hut], NO_FILTERS, PROVIDERS);
    expect(facets.stayTypes).toEqual([
      { value: 'cabin', label: 'Cabins & villas', count: 1 },
      { value: 'room', label: 'Rooms', count: 1 },
      { value: 'dorm', label: 'Dorms', count: 1 },
    ]);
  });

  it('keeps a chosen stay type no place has, with no places', () => {
    const facets = buildFacets(
      [place({}), park],
      [place({}), park],
      filters({ stayTypes: ['glamping'] }),
      PROVIDERS
    );
    expect(facets.stayTypes).toEqual([
      { value: 'campsite', label: 'Camping', count: 2 },
      { value: 'cabin', label: 'Cabins & villas', count: 1 },
      { value: 'glamping', label: 'Glamping', count: 0 },
    ]);
  });

  it('has no options while the catalogue is empty (still loading), even with one chosen', () => {
    expect(buildFacets([], [], filters({ stayTypes: ['cabin'] }), PROVIDERS).stayTypes).toEqual([]);
  });

  it('counts the stay types over the ParkStay catalogue, as many places as each gives', () => {
    const counts = facetCounts(PARKSTAY_LOCATIONS, NO_FILTERS, 'stayTypes');
    for (const kind of ['campsite', 'cabin', 'dorm', 'glamping'] as const) {
      const matching = PARKSTAY_LOCATIONS.filter((p) =>
        matchesFilters(p, filters({ stayTypes: [kind] }))
      );
      expect(counts.get(kind)).toBe(matching.length);
    }
    expect(counts.get('room')).toBeUndefined();
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

  it('builds every chip: providers always, stay types in group order, regions and amenities sorted, online count', () => {
    const facets = buildFacets(PARKSTAY_LOCATIONS, PARKSTAY_LOCATIONS, NO_FILTERS, PROVIDERS);
    expect(facets.providers).toEqual([{ value: 'parkstay', label: 'ParkStay WA', count: 169 }]);
    // Group order, not A to Z; no Rooms (no place has one) and never "other".
    expect(facets.stayTypes.map((t) => `${t.label} ${t.count}`)).toEqual([
      'Camping 145',
      'Cabins & villas 7',
      'Dorms 1',
      'Glamping 2',
    ]);
    expect(facets.stayTypes.map((t) => t.value)).toEqual(['campsite', 'cabin', 'dorm', 'glamping']);
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
