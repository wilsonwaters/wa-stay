/**
 * ParkStay's unit kinds (R1, `src/main/providers/parkstay/unit-kinds.ts`):
 * - a site or campsite class is a campsite when its gear takes a tent, campervan or caravan,
 *   else its name (or its class's) decides: hut or bunk → dorm, cabin, cottage or chalet →
 *   cabin, eco tent, safari tent or eco retreat → glamping, anything else → campsite; the
 *   catalogue's units and `availability.check`'s units carry it;
 * - every campground (types 0, 1 and 4) is `['campsite']`; another operator's place (type 2)
 *   gives none, and the catalogue derives them from its kind;
 * - each bulk availability entry counts its sites under `byKind.campsite` too.
 */

import { toLocationSummary, toUnitSummary } from '@main/providers/parkstay/catalog';
import { toClassUnitSummary } from '@main/providers/parkstay/site-classes';
import type {
  RawCampgroundFeature,
  RawCampsite,
  RawCampsiteAvailabilityView,
} from '@main/providers/parkstay/types';
import { placeUnitKinds, unitKindOf } from '@main/providers/parkstay/unit-kinds';
import { unitKindsOf } from '@shared/utils/unit-kinds';
import {
  parkStayFixture,
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '@tests/utils/parkstay-fixture-server';
import {
  BUNGARRA_STAY,
  createTestParkStay,
  LUCKY_BAY_CLASS,
  LUCKY_BAY_STAY,
  luckyBayView,
  type TestParkStay,
} from '@tests/utils/parkstay-provider';

const NO_GEAR = { tent: false, campervan: false, caravan: false, vehicle: true, trailer: true };

describe('unitKindOf (the unit rule)', () => {
  it.each(['tent', 'campervan', 'caravan'])(
    'a site whose gear takes a %s is a campsite',
    (gear) => {
      expect(unitKindOf({ ...NO_GEAR, [gear]: true }, 'Bunkhouse', 'Cabins')).toBe('campsite');
    }
  );

  it.each([
    ['Yeagarup Hut', 'dorm'],
    ['Hut 3', 'dorm'],
    ['Bunkhouse', 'dorm'],
    ['Bunk room 2', 'dorm'],
    ['Cabin 4', 'cabin'],
    ['Lakeside Cottage', 'cabin'],
    ['Chalets', 'cabin'],
    ['Eco tent 1', 'glamping'],
    ['Safari tents', 'glamping'],
    ['Sal Salis eco retreat', 'glamping'],
    ['CAMPSITE 01', 'campsite'],
    ['Shutters', 'campsite'],
    ['Bunker Bay', 'campsite'],
  ])('without camping gear, %s is a %s', (name, kind) => {
    expect(unitKindOf(NO_GEAR, name)).toBe(kind);
  });

  it('the gear wins: "Hut 3" that takes a tent is a campsite', () => {
    expect(unitKindOf({ tent: true }, 'Hut 3')).toBe('campsite');
  });

  it("asks the site's name, then its class's; with neither matching, or no gear at all, a campsite", () => {
    expect(unitKindOf(NO_GEAR, 'CAMPSITE 01', 'Chalets')).toBe('cabin');
    expect(unitKindOf(NO_GEAR, 'Hut 1', 'Chalets')).toBe('dorm');
    expect(unitKindOf(NO_GEAR, 'Site 1', null, undefined)).toBe('campsite');
    expect(unitKindOf(undefined, 'Site 1')).toBe('campsite');
    expect(unitKindOf(null)).toBe('campsite');
  });
});

describe("ParkStay's units carry their kind", () => {
  const bungarra = parkStayFixture<RawCampsiteAvailabilityView>(
    'campsite_availablity_view_20.json'
  );
  const site = (overrides: Partial<RawCampsite>): RawCampsite => ({
    ...bungarra.sites[0],
    ...overrides,
  });

  it('a site: by its gear, else its name or its class name', () => {
    expect(toUnitSummary(bungarra.sites[0], bungarra.classes).unitKind).toBe('campsite');
    expect(toUnitSummary(site({ name: 'Hut 1', gearType: NO_GEAR }), {}).unitKind).toBe('dorm');
    expect(
      toUnitSummary(site({ name: 'Site 7', class: 9, gearType: NO_GEAR }), { '9': 'Eco tents' })
        .unitKind
    ).toBe('glamping');
  });

  it("a class listing: the class's gear, else the class name, else a campsite", () => {
    const [lucky] = luckyBayView().sites;
    expect(toClassUnitSummary(lucky)).toMatchObject({
      unitId: LUCKY_BAY_CLASS,
      unitKind: 'campsite',
    });
    const cabins = { ...lucky, name: 'Cabins (sleep 4)', gearType: NO_GEAR };
    expect(toClassUnitSummary(cabins).unitKind).toBe('cabin');
    expect(toClassUnitSummary({ ...lucky, name: 'Group area', gearType: {} }).unitKind).toBe(
      'campsite'
    );
  });
});

describe('ParkStay places: every campground is camping', () => {
  const features = parkStayFixture<{ features: RawCampgroundFeature[] }>(
    'campground_map.json'
  ).features;
  const summary = (id: number) => toLocationSummary(features.find((f) => f.id === id)!)!;

  it.each([
    [20, 0],
    [18, 0],
    [85, 1],
    [16, 4],
  ])("campground %s (type %s) is ['campsite']", (id, type) => {
    expect(features.find((f) => f.id === id)!.properties.campground_type).toBe(type);
    expect(summary(id)).toMatchObject({ kind: 'campground', unitKinds: ['campsite'] });
  });

  it("another operator's place (type 2) gives none, so they derive from its kind", () => {
    const woodman = summary(5);
    const yeagarup = summary(182);
    expect(woodman).toMatchObject({ kind: 'holiday-park' });
    expect(yeagarup).toMatchObject({ kind: 'hut' });
    expect(woodman).not.toHaveProperty('unitKinds');
    expect(yeagarup).not.toHaveProperty('unitKinds');
    expect(unitKindsOf(woodman)).toEqual(['campsite', 'cabin']);
    expect(unitKindsOf(yeagarup)).toEqual(['dorm']);
  });

  it('placeUnitKinds: campsite for a campground, none for any other kind', () => {
    expect(placeUnitKinds('campground')).toEqual(['campsite']);
    for (const kind of ['holiday-park', 'cabin', 'hut', 'glamping', 'other'] as const) {
      expect([kind, placeUnitKinds(kind)]).toEqual([kind, undefined]);
    }
  });
});

describe('ParkStay availability carries unit kinds', () => {
  let server: ParkStayFixtureServer;
  let parkstay: TestParkStay;

  beforeAll(async () => {
    server = await startParkStayFixtureServer();
  });

  beforeEach(() => {
    server.views.clear();
    server.overrides.clear();
    parkstay = createTestParkStay(server);
  });

  afterAll(async () => {
    await server.close();
  });

  it("check: each site's kind, from its gear, its name or its class name", async () => {
    const view = parkStayFixture<RawCampsiteAvailabilityView>('campsite_availablity_view_20.json');
    view.sites[3] = { ...view.sites[3], name: 'Hut 4', gearType: NO_GEAR };
    view.sites[4] = { ...view.sites[4], class: 7, gearType: NO_GEAR };
    view.classes = { '7': 'Chalets', null: null } as RawCampsiteAvailabilityView['classes'];
    server.views.set('20', view);

    const { units } = await parkstay.provider.availability.check('20', BUNGARRA_STAY);

    expect(units.map((u) => [u.unitName, u.unitKind])).toEqual([
      ['CAMPSITE 01', 'campsite'],
      ['CAMPSITE 02', 'campsite'],
      ['CAMPSITE 03', 'campsite'],
      ['Hut 4', 'dorm'],
      ['CAMPSITE 05', 'cabin'],
    ]);
  });

  it("check at a class listing: the class's kind", async () => {
    server.views.set('43', luckyBayView());
    const { units } = await parkstay.provider.availability.check('43', LUCKY_BAY_STAY);
    expect(units.map((u) => [u.unitId, u.unitKind])).toEqual([[LUCKY_BAY_CLASS, 'campsite']]);
  });

  it('search: every bulk entry counts its sites under byKind.campsite too', async () => {
    const entries = await parkstay.provider.availability.search(BUNGARRA_STAY);
    expect(entries.length).toBeGreaterThan(0);
    for (const { availableUnits, bookableUnits, byKind } of entries) {
      expect(byKind).toEqual({ campsite: { availableUnits, bookableUnits } });
    }
    expect(entries.find((e) => e.key === 'parkstay:20')?.byKind).toEqual({
      campsite: { availableUnits: 3, bookableUnits: 5 },
    });
  });
});
