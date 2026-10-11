/**
 * Campgrounds ParkStay lists by site class (#21): Lucky Bay's recorded view (one class of 56
 * sites, one free each night but never the same one) through `availability.check`, the
 * catalogue detail and holds, against the fixture server. No live request.
 */

import {
  bookableClassNights,
  classesOfSiteId,
  classIdOfUnit,
  classUnitId,
  isClassListing,
} from '@main/providers/parkstay/site-classes';
import { createBookingForm } from '@main/providers/parkstay/holds';
import type { RawCampsite } from '@main/providers/parkstay/types';
import { PARKSTAY_LOCATIONS } from '@tests/fixtures/catalog/parkstay-locations';
import {
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '@tests/utils/parkstay-fixture-server';
import {
  createTestParkStay,
  BUNGARRA_STAY,
  LUCKY_BAY_CLASS,
  LUCKY_BAY_STAY,
  luckyBaySites,
  luckyBayView,
  type TestParkStay,
} from '@tests/utils/parkstay-provider';

const LUCKY_BAY = PARKSTAY_LOCATIONS.find((l) => l.key === 'parkstay:43')!;

describe('bookableClassNights', () => {
  const T = true;
  const F = false;

  /** Whether every run of chosen nights is free on one site (runs are apart by definition). */
  const valid = (free: boolean[][], chosen: boolean[]): boolean => {
    for (let start = 0; start < chosen.length;) {
      if (!chosen[start]) {
        start++;
        continue;
      }
      let end = start;
      while (end < chosen.length && chosen[end]) end++;
      if (!free.some((site) => site.slice(start, end).every(Boolean))) return false;
      start = end;
    }
    return true;
  };
  const count = (chosen: boolean[]): number => chosen.filter(Boolean).length;
  /** The sum of the squared run lengths: higher for longer runs. */
  const runScore = (chosen: boolean[]): number =>
    chosen
      .map((on) => (on ? 'x' : ' '))
      .join('')
      .split(' ')
      .reduce((sum, run) => sum + run.length ** 2, 0);

  it.each([
    ['one site free every night: every night', [[T, T, T]], [T, T, T]],
    ['no site free: no night', [[F, F, F]], [F, F, F]],
    [
      'a different site each night: every other night',
      [
        [T, F, F],
        [F, T, F],
        [F, F, T],
      ],
      [T, F, T],
    ],
    ['runs on one site with a gap: both', [[T, F, T, T]], [T, F, T, T]],
    [
      'the longest run on any site',
      [
        [T, T, F],
        [F, T, T],
        [T, T, T],
      ],
      [T, T, T],
    ],
  ])('%s', (_name, free, expected) => {
    expect(bookableClassNights(free, expected.length)).toEqual(expected);
  });

  it('on a tie, offers the longest stay: site A free 0–5 and site B 6–8 give A’s 6 nights', () => {
    const A = [T, T, T, T, T, T, F, F, F];
    const B = [F, F, F, F, F, F, T, T, T];
    // Nights 0–4 and 6–8 would be as many nights, but hide the 6-night stay.
    expect(bookableClassNights([A, B], 9)).toEqual([T, T, T, T, T, T, F, T, T]);
    expect(bookableClassNights([B, A], 9)).toEqual([T, T, T, T, T, T, F, T, T]);
  });

  it('two sites that hand over: all but one night, never both runs side by side', () => {
    const free = [
      [T, T, F, F],
      [F, F, T, T],
    ];
    const chosen = bookableClassNights(free, 4);
    expect(count(chosen)).toBe(3);
    expect(valid(free, chosen)).toBe(true);
  });

  it('chooses as many nights as any valid choice, then the longest runs (3 sites, 5 nights)', () => {
    const sites = 3;
    const nights = 5;
    const cells = sites * nights;
    for (let bits = 0; bits < 2 ** cells; bits += 11) {
      const free = Array.from({ length: sites }, (_, s) =>
        Array.from({ length: nights }, (_, n) => ((bits >> (s * nights + n)) & 1) === 1)
      );
      let most = 0;
      let longest = 0;
      for (let pick = 0; pick < 2 ** nights; pick++) {
        const option = Array.from({ length: nights }, (_, n) => ((pick >> n) & 1) === 1);
        if (!valid(free, option)) continue;
        if (count(option) > most) [most, longest] = [count(option), runScore(option)];
        else if (count(option) === most) longest = Math.max(longest, runScore(option));
      }
      const chosen = bookableClassNights(free, nights);
      expect(valid(free, chosen)).toBe(true);
      expect(count(chosen)).toBe(most);
      expect(runScore(chosen)).toBe(longest);
    }
  });
});

describe('class unit ids', () => {
  it('names a class by its id, never by the site the view gave', () => {
    expect(classUnitId({ type: 117 })).toBe('class:117');
    expect(classIdOfUnit('class:117')).toBe('117');
    expect(classIdOfUnit('309')).toBeUndefined();
    expect(classIdOfUnit(undefined)).toBeUndefined();
    expect(isClassListing({ site_type: 2 })).toBe(true);
    expect(isClassListing({ site_type: 1 })).toBe(true);
    expect(isClassListing({ site_type: 0 })).toBe(false);
    expect(isClassListing({})).toBe(false);
  });

  it('resolves a site id kept from before #21 to the class whose entry gave it, else every class', () => {
    const entry = (id: number, type: number) => ({ id, type }) as RawCampsite;
    const view = { sites: [entry(309, 117), entry(401, 118)] };
    expect(classesOfSiteId(view, '309').map((e) => e.type)).toEqual([117]);
    expect(classesOfSiteId(view, '401').map((e) => e.type)).toEqual([118]);
    // A site no entry gave: the view cannot tell its class.
    expect(classesOfSiteId(view, '350').map((e) => e.type)).toEqual([117, 118]);
    expect(classesOfSiteId({ sites: [entry(330, 117)] }, '350').map((e) => e.type)).toEqual([117]);
    // Only site ids (numbers) are resolved.
    expect(classesOfSiteId(view, 'class:999')).toEqual([]);
    expect(classesOfSiteId(view, 'CAMPSITE 01')).toEqual([]);
  });
});

describe('ParkStay campgrounds listed by class (Lucky Bay, 43)', () => {
  let server: ParkStayFixtureServer;
  let parkstay: TestParkStay;

  beforeAll(async () => {
    server = await startParkStayFixtureServer();
  });

  beforeEach(() => {
    server.views.clear();
    server.classHolds.length = 0;
    server.classSites.clear();
    server.views.set('43', luckyBayView());
    parkstay = createTestParkStay(server);
  });

  afterAll(async () => {
    await server.close();
  });

  const check = (options = {}) =>
    parkstay.provider.availability.check('43', LUCKY_BAY_STAY, options);
  const lastPost = () => new URLSearchParams(server.requestsTo('/api/create_booking').at(-1)!.body);

  describe('availability', () => {
    it('returns the class as one unit, class:117, with no unit type', async () => {
      const result = await check();
      expect(result.units).toHaveLength(1);
      expect(result.units[0]).toMatchObject({
        unitId: LUCKY_BAY_CLASS,
        unitName: 'One site - select on arrival',
      });
      expect(result.units[0]).not.toHaveProperty('unitType');
    });

    it('fills every night, priced: one site free on 6 and 8 Nov, 7 Nov free only on another site', async () => {
      // The recording: site 21 is free on the 6th, site 23 on the 7th, five sites on the 8th.
      const [unit] = (await check()).units;
      expect(unit.nights).toEqual([
        { date: '2026-11-06', state: 'available', price: 20, label: '$20.00' },
        // Free, but on a different site: not part of a stay the class can offer.
        { date: '2026-11-07', state: 'unknown', reason: 'split', price: 20, label: '$20.00' },
        { date: '2026-11-08', state: 'available', price: 20, label: '$20.00' },
      ]);
      // No site is free for all three nights, so the class is not either.
      expect(unit.fullyAvailable).toBe(false);
      expect(unit).not.toHaveProperty('total');
    });

    it('is fully available, at $60, while a site is free for the whole stay', async () => {
      server.views.set('43', luckyBayView(330));
      const [unit] = (await check()).units;
      expect(unit.nights.map((n) => [n.date, n.state, n.price])).toEqual([
        ['2026-11-06', 'available', 20],
        ['2026-11-07', 'available', 20],
        ['2026-11-08', 'available', 20],
      ]);
      expect(unit).toMatchObject({ unitId: LUCKY_BAY_CLASS, fullyAvailable: true, total: 60 });
    });

    it('keeps the unit id across polls while the site the view names changes', async () => {
      const ids: string[] = [];
      for (const view of [luckyBayView(), luckyBayView(330), luckyBayView(352), luckyBayView()]) {
        server.views.set('43', view);
        ids.push(...(await check()).units.map((u) => u.unitId));
      }
      expect(ids).toEqual(Array(4).fill(LUCKY_BAY_CLASS));
    });

    it('reads nights with no free site as booked, or not released past the horizon', async () => {
      const view = luckyBayView();
      const entry = view.sites[0];
      // 7 Nov: every site booked. 8 Nov: booked and closed sites (as on 24 Nov, live).
      entry.availability[1] = [false, 'Booked', '20.00', null, [56, 0, 0], '2026-11-07'];
      entry.availability[2] = [false, 'Unavailable', '20.00', null, [53, 3, 0], '2026-11-08'];
      for (const row of entry.breakdown) {
        row.availability[1] = [false, 'Unavailable', '20.00', null];
        row.availability[2] = [false, 'Unavailable', '20.00', null];
      }
      server.views.set('43', view);
      const [unit] = (await check()).units;
      expect(unit.nights.map((n) => [n.date, n.state, n.label])).toEqual([
        ['2026-11-06', 'available', '$20.00'],
        ['2026-11-07', 'booked', 'Booked'],
        ['2026-11-08', 'booked', 'Unavailable'],
      ]);

      // A release period from 8 Nov: that night is not released yet.
      server.views.set('43', { ...view, release_date: '2026-11-08' });
      const [later] = (await check()).units;
      expect(later.nights.map((n) => n.state)).toEqual(['available', 'booked', 'not-released']);
    });

    it('without a breakdown, reads the class’s own labels as a site’s', async () => {
      const view = luckyBayView();
      delete view.sites[0].breakdown;
      server.views.set('43', view);
      const [unit] = (await check()).units;
      // Bookable only when every site is free; a price label alone cannot say which.
      expect(unit.nights.map((n) => n.state)).toEqual(['unknown', 'unknown', 'unknown']);
      expect(unit.fullyAvailable).toBe(false);
    });

    it('filters by the class unit id', async () => {
      expect((await check({ unitIds: [LUCKY_BAY_CLASS] })).units).toHaveLength(1);
      expect((await check({ unitIds: ['class:999'] })).units).toEqual([]);
      expect((await check({ unitIds: ['CAMPSITE 01'] })).units).toEqual([]);
    });

    describe('site ids kept from before #21 (a fresh run: nothing in memory)', () => {
      beforeEach(() => {
        // While a site is free for the stay, the view names it (330), not the stored id.
        server.views.set('43', luckyBayView(330));
      });

      it.each([
        ['309, which an earlier view named', '309'],
        ['350, which no view named', '350'],
        ['330, which this view names', '330'],
      ])('asked for site %s, returns the class, aliased by that id', async (_name, id) => {
        const { units } = await check({ unitIds: [id] });
        expect(units).toHaveLength(1);
        expect(units[0]).toMatchObject({
          unitId: LUCKY_BAY_CLASS,
          aliases: [id],
          fullyAvailable: true,
        });
      });

      it('marks the ids a watch keeps (knownUnitIds) without filtering', async () => {
        const { units } = await check({ knownUnitIds: ['309', 'class:117', 'CAMPSITE 01'] });
        expect(units.map((u) => [u.unitId, u.aliases])).toEqual([[LUCKY_BAY_CLASS, ['309']]]);
        // Nothing asked: no aliases.
        expect((await check()).units[0]).not.toHaveProperty('aliases');
      });

      it('with two classes, a site id names the class whose entry gave it, else both', async () => {
        const view = luckyBayView(330);
        const second = { ...view.sites[0], id: 401, type: 118, name: 'Group site' };
        server.views.set('43', { ...view, sites: [view.sites[0], second] });
        const ids = async (unitIds: string[]) =>
          (await check({ unitIds })).units.map((u) => u.unitId);
        expect(await ids(['330'])).toEqual([LUCKY_BAY_CLASS]);
        expect(await ids(['401'])).toEqual(['class:118']);
        expect(await ids(['350'])).toEqual([LUCKY_BAY_CLASS, 'class:118']);
      });

      it('a site-listed campground is unchanged: a site id is that site only', async () => {
        const { units } = await parkstay.provider.availability.check('20', BUNGARRA_STAY, {
          unitIds: ['3', '350'],
        });
        expect(units.map((u) => u.unitId)).toEqual(['3']);
        expect(units[0]).not.toHaveProperty('aliases');
      });
    });
  });

  describe('detail', () => {
    it('lists the class as the unit, from the stored summary without the map', async () => {
      const detail = await parkstay.provider.catalog.getLocation('43', undefined, {
        summary: LUCKY_BAY,
      });
      expect(detail.units).toEqual([
        {
          unitId: LUCKY_BAY_CLASS,
          unitName: 'One site - select on arrival',
          minPeople: 1,
          maxPeople: 8,
          maxVehicles: 2,
          equipment: ['tent', 'campervan', 'caravan'],
          description: '11m x 6m compacted crushed rock reverse-in site.',
        },
      ]);
      expect(detail.releaseInfo).toBe('Bookings open 180 days ahead at 12:00 am AWST');
      expect(server.requestsTo('/api/campground_map/')).toHaveLength(0);
    });
  });

  describe('holds (fixture server only)', () => {
    const hold = (unitId?: string, stay = LUCKY_BAY_STAY) =>
      parkstay.provider.holds.create({ externalId: '43', ...(unitId ? { unitId } : {}), stay });
    let postsBefore = 0;
    /** The create_booking posts in this test. */
    const posts = () => server.requestsTo('/api/create_booking').slice(postsBefore);

    beforeEach(() => {
      postsBefore = server.requestsTo('/api/create_booking').length;
      // Sites 05 (id 313) and 30 (id 338) are free for the stay; the view names 30.
      server.views.set('43', luckyBayView(338));
      server.classSites.set('43', luckyBaySites(['05', '30']));
    });

    it('holds the class: posts campsite_class=117 and no site; ParkStay takes its first free site', async () => {
      expect(await hold(LUCKY_BAY_CLASS)).toMatchObject({
        ok: true,
        reference: '1234567',
        unitId: LUCKY_BAY_CLASS,
      });
      expect(lastPost().get('campsite_class')).toBe('117');
      expect(lastPost().get('campground')).toBe('43');
      expect(lastPost().has('campsite')).toBe(false);
      expect(server.classHolds).toEqual([{ campground: '43', campsiteClass: '117', site: 313 }]);
    });

    it('ParkStay picks by the posted dates: 8–9 Nov alone is free on five sites, the first is 14', async () => {
      server.classSites.set('43', luckyBaySites());
      const oneNight = { ...LUCKY_BAY_STAY, arrival: '2026-11-08' };
      expect(await hold(LUCKY_BAY_CLASS, oneNight)).toMatchObject({ ok: true });
      expect([lastPost().get('arrival'), lastPost().get('departure')]).toEqual([
        '2026/11/08',
        '2026/11/09',
      ]);
      expect(server.classHolds).toEqual([{ campground: '43', campsiteClass: '117', site: 322 }]);
    });

    it('without a unit, takes the class that is free for the whole stay', async () => {
      expect(await hold()).toMatchObject({ ok: true, unitId: LUCKY_BAY_CLASS });
      expect(lastPost().get('campsite_class')).toBe('117');
      expect(server.classHolds).toEqual([{ campground: '43', campsiteClass: '117', site: 313 }]);
    });

    it('without a unit, and no site free for the whole stay, is taken without posting', async () => {
      server.views.set('43', luckyBayView());
      expect(await hold()).toMatchObject({ ok: false, reason: 'taken' });
      expect(posts()).toHaveLength(0);
    });

    it('is taken, in ParkStay’s words, when no site of the class is free for the whole stay', async () => {
      server.classSites.set('43', luckyBaySites());
      const result = await hold(LUCKY_BAY_CLASS);
      expect(result).toMatchObject({ ok: false, reason: 'taken' });
      expect(result.ok ? '' : result.message).toContain(
        'Campsite class unavailable for specified time period.'
      );
      expect(server.classHolds).toEqual([]);
    });

    describe('with a site id kept from before #21 (a fresh run: nothing in memory)', () => {
      it.each([['309'], ['350'], ['338']])(
        'site %s: checks first, then posts campsite_class, never campsite',
        async (id) => {
          const views = server.requestsTo('/api/campsite_availablity_view/43/').length;
          expect(await hold(id)).toMatchObject({ ok: true, unitId: LUCKY_BAY_CLASS });
          expect(server.requestsTo('/api/campsite_availablity_view/43/')).toHaveLength(views + 1);
          expect(posts()).toHaveLength(1);
          expect(lastPost().get('campsite_class')).toBe('117');
          expect(lastPost().has('campsite')).toBe(false);
          expect(server.classHolds).toEqual([
            { campground: '43', campsiteClass: '117', site: 313 },
          ]);
        }
      );

      it('after a check in this run, still posts campsite_class', async () => {
        await check({ unitIds: ['350'] });
        expect(await hold('350')).toMatchObject({ ok: true, unitId: LUCKY_BAY_CLASS });
        expect(lastPost().get('campsite_class')).toBe('117');
        expect(lastPost().has('campsite')).toBe(false);
      });

      it('is taken without posting when no site of the class is free for the stay', async () => {
        server.views.set('43', luckyBayView());
        expect(await hold('350')).toMatchObject({ ok: false, reason: 'taken' });
        expect(posts()).toHaveLength(0);
      });

      it('at two classes, holds the free class the site id may be in', async () => {
        const view = luckyBayView();
        const free = luckyBayView(401).sites[0];
        server.views.set('43', { ...view, sites: [view.sites[0], { ...free, type: 118 }] });
        server.classSites.set('43', [
          ...luckyBaySites(),
          {
            id: 401,
            name: 'G1',
            campsiteClass: '118',
            freeNights: ['2026-11-06', '2026-11-07', '2026-11-08'],
          },
        ]);
        expect(await hold('350')).toMatchObject({ ok: true, unitId: 'class:118' });
        expect(lastPost().get('campsite_class')).toBe('118');
        expect(server.classHolds).toEqual([{ campground: '43', campsiteClass: '118', site: 401 }]);
      });
    });

    it('ParkStay refuses a site at a campground listed by class', async () => {
      // What the module never sends now: the fixture server answers it as ParkStay does.
      const form = createBookingForm({ externalId: '43', unitId: '313', stay: LUCKY_BAY_STAY });
      const answer = await fetch(`${server.url}/api/create_booking`, {
        method: 'POST',
        body: new URLSearchParams(form),
      });
      expect(answer.status).toBe(400);
      expect(await answer.json()).toEqual({
        status: 'error',
        msg: "Campground doesn't support per-site bookings.",
      });
    });
  });
});
