/**
 * ParkStay availability: Bungarra's live sample through `availability.check` (ParkStay dates,
 * the Referer, per-night prices and states, the release horizon) and the bulk endpoint
 * through `availability.search`.
 */

import { gearTypeOf, parsePrice, toNightStatus } from '@main/providers/parkstay/availability';
import type { RawNightTuple } from '@main/providers/parkstay/types';
import { ProviderHttpError, ProviderParseError } from '@main/providers/sdk';
import {
  parkStayFixture,
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '@tests/utils/parkstay-fixture-server';
import {
  BUNGARRA_STAY,
  createTestParkStay,
  type TestParkStay,
} from '@tests/utils/parkstay-provider';

const tuple = (bookable: boolean, label: string, price: unknown, date = '2026-11-10') =>
  [bookable, label, price, null, null, date] as RawNightTuple;

describe('toNightStatus', () => {
  it.each([
    [tuple(true, '$30.00', '30.00'), true, { state: 'available', price: 30, label: '$30.00' }],
    [tuple(false, 'Booked', '30.00'), true, { state: 'booked', price: 30, label: 'Booked' }],
    [tuple(false, 'Closed', '30.00'), true, { state: 'closed', label: 'Closed' }],
    [tuple(false, 'Closed & Booked', 30), true, { state: 'closed', label: 'Closed & Booked' }],
    [
      tuple(false, 'Closures/Bookings', null),
      true,
      { state: 'closed', label: 'Closures/Bookings' },
    ],
    [tuple(false, 'Unavailable', '30.00'), true, { state: 'booked', label: 'Unavailable' }],
    [tuple(false, 'Unavailable', '30.00'), false, { state: 'not-released', label: 'Unavailable' }],
    [tuple(false, 'Some Booked', '30.00'), true, { state: 'unknown', label: 'Some Booked' }],
  ])('%j (released %s) → %j', (night, released, expected) => {
    expect(toNightStatus(night, released)).toMatchObject({ date: '2026-11-10', ...expected });
  });

  it('keeps the date from the tuple’s last field', () => {
    expect(toNightStatus(tuple(true, '$12.50', '12.50', '2027-01-31'), true)).toEqual({
      date: '2027-01-31',
      state: 'available',
      price: 12.5,
      label: '$12.50',
    });
  });
});

describe('gearTypeOf', () => {
  const stay = { arrival: '2026-11-10', departure: '2026-11-12', adults: 1 };

  it.each([
    [{ params: { gearType: 'tent' } }, 'tent'],
    [{ params: { gearType: 'Caravan' } }, 'caravan'],
    [{ equipment: 'campervan' }, 'campervan'],
    [{}, 'all'],
    // Values the legacy watch form stored, which ParkStay would answer with HTTP 500.
    [{ params: { gearType: 'tent,caravan' } }, 'all'],
    [{ params: { gearType: 'cabin' } }, 'all'],
    [{ params: { gearType: 'hut,tent' } }, 'tent'],
    [{ params: { gearType: 'Unpowered' } }, 'all'],
  ])('%j → %s', (extra, expected) => {
    expect(gearTypeOf({ ...stay, ...extra })).toBe(expected);
  });
});

describe('parsePrice', () => {
  it.each([
    ['30.00', 30],
    [30, 30],
    ['12.5', 12.5],
    [null, undefined],
    ['', undefined],
    ['n/a', undefined],
    [false, undefined],
  ])('%j → %j', (value, expected) => {
    expect(parsePrice(value)).toBe(expected);
  });
});

describe('ParkStay availability', () => {
  let server: ParkStayFixtureServer;
  let parkstay: TestParkStay;

  beforeAll(async () => {
    server = await startParkStayFixtureServer();
  });

  beforeEach(() => {
    server.views.clear();
    parkstay = createTestParkStay(server);
  });

  afterAll(async () => {
    await server.close();
  });

  describe("check('20', 10–12 Nov 2026, one adult)", () => {
    it('sends ParkStay dates (YYYY/MM/DD), the party, the gear type and the ParkStay Referer', async () => {
      await parkstay.provider.availability.check('20', BUNGARRA_STAY);
      const [request] = server.requestsTo('/api/campsite_availablity_view/20/').slice(-1);
      expect(request.query.toString()).toBe(
        'arrival=2026%2F11%2F10&departure=2026%2F11%2F12&num_adult=1&num_concession=0&num_child=0&num_infant=0&gear_type=all'
      );
      expect(request.query.get('arrival')).toBe('2026/11/10');
      expect(request.query.get('departure')).toBe('2026/11/12');
      expect(request.headers.referer).toBe('https://parkstay.dbca.wa.gov.au/');
    });

    it('returns 5 units, each with 2 nights priced $30', async () => {
      const result = await parkstay.provider.availability.check('20', BUNGARRA_STAY);
      expect(result.key).toBe('parkstay:20');
      expect(result.checkedAt).toBe('2026-10-02T02:00:00.000Z');
      expect(result.units.map((u) => [u.unitId, u.unitName])).toEqual([
        ['1', 'CAMPSITE 01'],
        ['2', 'CAMPSITE 02'],
        ['3', 'CAMPSITE 03'],
        ['4', 'CAMPSITE 04'],
        ['5', 'CAMPSITE 05'],
      ]);
      for (const unit of result.units) {
        expect(unit.nights.map((n) => [n.date, n.price])).toEqual([
          ['2026-11-10', 30],
          ['2026-11-11', 30],
        ]);
      }
    });

    it('maps the 6 "$30.00" nights to available and the 4 "Unavailable" nights to booked', async () => {
      const result = await parkstay.provider.availability.check('20', BUNGARRA_STAY);
      const nights = result.units.flatMap((u) => u.nights);
      expect(nights.filter((n) => n.label === '$30.00').map((n) => n.state)).toEqual(
        Array(6).fill('available')
      );
      expect(nights.filter((n) => n.label === 'Unavailable').map((n) => n.state)).toEqual(
        Array(4).fill('booked')
      );
    });

    it('marks only units 3, 4 and 5 fully available, at $60 for the stay', async () => {
      const result = await parkstay.provider.availability.check('20', BUNGARRA_STAY);
      expect(result.units.map((u) => [u.unitId, u.fullyAvailable, u.total])).toEqual([
        ['1', false, undefined],
        ['2', false, undefined],
        ['3', true, 60],
        ['4', true, 60],
        ['5', true, 60],
      ]);
      expect(result.units[0]).not.toHaveProperty('total');
    });

    it('says the stay is released, and links to ParkStay for these dates', async () => {
      const result = await parkstay.provider.availability.check('20', BUNGARRA_STAY);
      expect(result.release).toEqual({ open: true });
      expect(result.bookingUrl).toBe(
        'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20&arrival=2026/11/10&departure=2026/11/12'
      );
    });

    it('filters to the units asked for', async () => {
      const result = await parkstay.provider.availability.check('20', BUNGARRA_STAY, {
        unitIds: ['4', '1'],
      });
      expect(result.units.map((u) => u.unitId)).toEqual(['1', '4']);
    });

    it('sends the stay’s gear type, then its equipment, then all', async () => {
      const check = (stay: object) =>
        parkstay.provider.availability.check('20', { ...BUNGARRA_STAY, ...stay });
      await check({ params: { gearType: 'tent' }, equipment: 'caravan' });
      await check({ equipment: 'caravan' });
      const requests = server.requestsTo('/api/campsite_availablity_view/20/').slice(-2);
      expect(requests.map((r) => r.query.get('gear_type'))).toEqual(['tent', 'caravan']);
    });

    it('records Bungarra’s release time (02:00 AM) in the provider state', async () => {
      await parkstay.provider.availability.check('20', BUNGARRA_STAY);
      expect(await parkstay.state.get('release.time.20')).toBe('02:00');
    });
  });

  describe('the release horizon', () => {
    it('maps "Unavailable" nights on or after a release period’s release_date to not-released', async () => {
      const view = parkStayFixture('campsite_availablity_view_20.json');
      server.views.set('20', { ...view, release_date: '2026-11-11' });
      const result = await parkstay.provider.availability.check('20', BUNGARRA_STAY);
      const unit1 = result.units.find((u) => u.unitId === '1')!;
      expect(unit1.nights.map((n) => [n.date, n.state])).toEqual([
        ['2026-11-10', 'booked'],
        ['2026-11-11', 'not-released'],
      ]);
      // A bookable night stays available whatever the horizon says.
      expect(result.units.find((u) => u.unitId === '3')!.nights[1].state).toBe('available');
      // Released in blocks: no single opening time.
      expect(result.release).toEqual({ open: false });
    });

    it('maps every "Unavailable" night to not-released when release_date is before the stay', async () => {
      const view = parkStayFixture('campsite_availablity_view_20.json');
      server.views.set('20', { ...view, release_date: '2026-11-01' });
      const result = await parkstay.provider.availability.check('20', BUNGARRA_STAY);
      const states = result.units.flatMap((u) => u.nights.map((n) => n.state));
      expect(states.filter((s) => s === 'not-released')).toHaveLength(4);
      expect(states.filter((s) => s === 'booked')).toHaveLength(0);
    });

    it('beyond today + max_advance_booking (180 days), nights are not released and the stay opens at the release time', async () => {
      const view = parkStayFixture('campsite_availablity_view_20.json');
      const far = { arrival: '2027-04-01', departure: '2027-04-03', adults: 1 };
      const unavailable = (date: string) => [false, 'Unavailable', '30.00', null, null, date];
      server.views.set('20', {
        ...view,
        release_date: null,
        sites: view.sites.map((site: any) => ({
          ...site,
          availability: [unavailable('2027-04-01'), unavailable('2027-04-02')],
        })),
      });
      const result = await parkstay.provider.availability.check('20', far);
      expect(result.units[0].nights.map((n) => n.state)).toEqual(['not-released', 'not-released']);
      // 2027-04-01 − 180 days = 2026-10-03, at Bungarra's 02:00 AM (AWST, UTC+8).
      expect(result.release).toEqual({ open: false, opensAt: '2026-10-02T18:00:00.000Z' });
    });

    it('reads a view without a release time once per check, not again for the opening time', async () => {
      const view = parkStayFixture('campsite_availablity_view_20.json');
      const far = { arrival: '2027-04-01', departure: '2027-04-03', adults: 1 };
      server.views.set('20', { ...view, release_date: null, release_time_friendly: null });
      const before = server.requestsTo('/api/campsite_availablity_view/20/').length;
      for (let i = 0; i < 3; i++) {
        const result = await parkstay.provider.availability.check('20', far);
        // Unknown release time: midnight AWST on 2026-10-03.
        expect(result.release).toEqual({ open: false, opensAt: '2026-10-02T16:00:00.000Z' });
      }
      expect(server.requestsTo('/api/campsite_availablity_view/20/').length - before).toBe(3);
    });

    it('on the furthest date, opens only once booking_time_open says the release time has come', async () => {
      // Today (2 Oct 2026, Perth) + 180 days = 2027-03-31.
      const view = parkStayFixture('campsite_availablity_view_20.json');
      const stay = { arrival: '2027-03-31', departure: '2027-04-01', adults: 1 };
      const night = [false, 'Unavailable', '30.00', null, null, '2027-03-31'];
      const sites = view.sites.map((site: any) => ({ ...site, availability: [night] }));

      server.views.set('20', { ...view, release_date: null, booking_time_open: false, sites });
      const before = await parkstay.provider.availability.check('20', stay);
      expect(before.units[0].nights[0].state).toBe('not-released');
      expect(before.release?.open).toBe(false);

      server.views.set('20', { ...view, release_date: null, booking_time_open: true, sites });
      const after = await parkstay.provider.availability.check('20', stay);
      expect(after.units[0].nights[0].state).toBe('booked');
      expect(after.release).toEqual({ open: true });
    });
  });

  describe('failures', () => {
    it('rejects a body that is not the availability view with ProviderParseError, never an empty result', async () => {
      server.views.set('20', { result: true, sites: [{ id: 1, availability: [{ date: 'x' }] }] });
      await expect(
        parkstay.provider.availability.check('20', BUNGARRA_STAY)
      ).rejects.toBeInstanceOf(ProviderParseError);
      server.views.set('20', { detail: 'nope' });
      await expect(
        parkstay.provider.availability.check('20', BUNGARRA_STAY)
      ).rejects.toBeInstanceOf(ProviderParseError);
    });

    it('rejects HTTP 500 (an unknown campground) with ProviderHttpError status 500', async () => {
      await expect(
        parkstay.provider.availability.check('999', BUNGARRA_STAY)
      ).rejects.toMatchObject({ name: 'ProviderHttpError', status: 500 });
    });

    it('rejects a campground ParkStay does not book online with its HTTP 400', async () => {
      await expect(parkstay.provider.availability.check('5', BUNGARRA_STAY)).rejects.toBeInstanceOf(
        ProviderHttpError
      );
    });
  });

  describe('search (bulk)', () => {
    it('sends ParkStay dates and returns entries only for campgrounds with totals', async () => {
      const entries = await parkstay.provider.availability.search(BUNGARRA_STAY);
      // (Object keys that look like numbers come back in numeric order.)
      expect(entries).toEqual([
        { key: 'parkstay:18', availableUnits: 6, bookableUnits: 26 },
        { key: 'parkstay:20', availableUnits: 3, bookableUnits: 5 },
      ]);
      // 85, 5, 16, 182 and the unknown 1 have no totals (not bookable online).
      expect(entries.map((e) => e.key)).not.toContain('parkstay:85');
      const [request] = server.requestsTo('/api/campground_availabilty_view/').slice(-1);
      expect(Object.fromEntries(request.query)).toEqual({
        format: 'json',
        arrival: '2026/11/10',
        departure: '2026/11/12',
        gear_type: 'all',
        features: '[]',
        featurescs: '[]',
      });
    });

    it('counts free sites from total_bookable (the sites free every night), out of total_available', async () => {
      const body = parkStayFixture('campground_availabilty_view.json');
      // Bungarra: 5 sites, 2 free for the whole stay; Kurrajong past the 180-day horizon,
      // where ParkStay zeroes both totals.
      body.campground_available['20'] = { sites: [3, 4], total_available: 5, total_bookable: 2 };
      body.campground_available['18'] = { sites: [], total_available: 0, total_bookable: 0 };
      server.overrides.set('/api/campground_availabilty_view/', { status: 200, body });
      const entries = await parkstay.provider.availability.search(BUNGARRA_STAY);
      server.overrides.clear();
      expect(entries).toEqual([
        { key: 'parkstay:18', availableUnits: 0, bookableUnits: 0 },
        { key: 'parkstay:20', availableUnits: 2, bookableUnits: 5 },
      ]);
      for (const entry of entries)
        expect(entry.availableUnits).toBeLessThanOrEqual(entry.bookableUnits);
    });

    it('returns a campground the map does not know, when it has totals (the catalogue filters it)', async () => {
      const body = parkStayFixture('campground_availabilty_view.json');
      body.campground_available['999'] = { sites: [1], total_available: 1, total_bookable: 1 };
      server.overrides.set('/api/campground_availabilty_view/', { status: 200, body });
      const entries = await parkstay.provider.availability.search(BUNGARRA_STAY);
      expect(entries.map((e) => e.key)).toContain('parkstay:999');
      server.overrides.clear();
    });

    it('returns an empty campground_available as no availability, with a warning that holds no request values', async () => {
      server.overrides.set('/api/campground_availabilty_view/', {
        status: 200,
        body: { campground_available: {} },
      });
      await expect(parkstay.provider.availability.search(BUNGARRA_STAY)).resolves.toEqual([]);
      server.overrides.clear();
      const warnings = parkstay.logger.lines.filter((l) => l.level === 'warn');
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toMatch(/bulk availability listed 0 campgrounds/);
      expect(JSON.stringify(warnings)).not.toMatch(/2026|\d{4}\/\d{2}\/\d{2}|gear/);

      // A non-empty answer warns of nothing.
      await parkstay.provider.availability.search(BUNGARRA_STAY);
      expect(parkstay.logger.lines.filter((l) => l.level === 'warn')).toHaveLength(1);
    });

    it('rejects an unexpected shape with ProviderParseError', async () => {
      server.overrides.set('/api/campground_availabilty_view/', { status: 200, body: [] });
      await expect(parkstay.provider.availability.search(BUNGARRA_STAY)).rejects.toBeInstanceOf(
        ProviderParseError
      );
      server.overrides.clear();
    });
  });
});
