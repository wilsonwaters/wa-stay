import type { LocationSummary } from '../../../../shared/types/catalog.types';
import { compareNames, orderPlaces } from './order';

const place = (name: string, lng = 0, lat = 0, key = `t:${name}`): LocationSummary => ({
  key,
  providerId: 'parkstay',
  externalId: key,
  name,
  kind: 'campground',
  bookingMode: 'online',
  lng,
  lat,
  imageUrls: [],
  amenities: [],
});

const names = (items: LocationSummary[]) => items.map((item) => item.name);

describe("Explore's default order", () => {
  it('sorts names A to Z, ignoring case, with leading-number names last in numeric order', () => {
    const items = ['14 Mile', 'lucky Bay', '3 Mile Camp', 'Bungarra', 'Ásgarð', 'Cape Arid'].map(
      (n) => place(n, 115, -33)
    );
    expect(names(orderPlaces(items, null))).toEqual([
      'Ásgarð',
      'Bungarra',
      'Cape Arid',
      'lucky Bay',
      '3 Mile Camp',
      '14 Mile',
    ]);
    expect(compareNames('Mile 14', 'Mile 3')).toBeGreaterThan(0);
  });

  it('puts the places nearest the map centre first, ties by name, unplaced last', () => {
    const perth: [number, number] = [115.86, -31.95];
    const items = [
      place('Broome', 122.24, -17.96),
      place('Nowhere', 0, 0),
      place('Fremantle', 115.75, -32.05),
      place('Albany', 117.88, -35.02),
      place('Zed', 115.75, -32.05, 't:z'),
    ];
    expect(names(orderPlaces(items, perth))).toEqual([
      'Fremantle',
      'Zed',
      'Albany',
      'Broome',
      'Nowhere',
    ]);
  });

  it('weighs longitude by latitude: a degree east is shorter than a degree north in WA', () => {
    const centre: [number, number] = [120, -34];
    const items = [place('North', 120, -33.2), place('East', 120.9, -34)];
    expect(names(orderPlaces(items, centre))).toEqual(['East', 'North']);
  });

  it('does not change the list it is given', () => {
    const items = [place('B'), place('A')];
    orderPlaces(items, null);
    expect(names(items)).toEqual(['B', 'A']);
  });
});
