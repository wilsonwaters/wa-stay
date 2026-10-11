/**
 * The ParkStay catalogue: `/api/campground_map/` features as `LocationSummary`s, the type-2
 * kind heuristic, and a campground's detail from `campsite_availablity_view`.
 */

import {
  campgroundMapDocument,
  kindFromName,
  toLocationSummary,
  toUnitSummary,
} from '@main/providers/parkstay/catalog';
import { toClassUnitSummary } from '@main/providers/parkstay/site-classes';
import type {
  RawCampgroundFeature,
  RawCampsite,
  RawCampsiteAvailabilityView,
} from '@main/providers/parkstay/types';
import { ProviderError } from '@main/providers/sdk';
import type { LocationSummary } from '@shared/types/catalog.types';
import { createMemoryLogger } from '@tests/utils/fake-provider';
import {
  parkStayFixture,
  readParkStayFixture,
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '@tests/utils/parkstay-fixture-server';
import { createTestParkStay, type TestParkStay } from '@tests/utils/parkstay-provider';

const features = (): RawCampgroundFeature[] => parkStayFixture('campground_map.json').features;

describe('ParkStay catalogue', () => {
  let server: ParkStayFixtureServer;
  let parkstay: TestParkStay;
  let byId: Map<string, LocationSummary>;

  beforeAll(async () => {
    server = await startParkStayFixtureServer();
    parkstay = createTestParkStay(server);
    const locations = await parkstay.provider.catalog.listLocations!();
    byId = new Map(locations.map((l) => [l.externalId, l]));
  });

  afterAll(async () => {
    await server.close();
  });

  it('maps the six fixture campgrounds, in the map’s order, under parkstay keys', async () => {
    expect([...byId.keys()]).toEqual(['20', '18', '85', '5', '16', '182']);
    for (const [id, location] of byId) {
      expect(location.key).toBe(`parkstay:${id}`);
      expect(location.providerId).toBe('parkstay');
    }
    expect(server.requestsTo('/api/campground_map/')).toHaveLength(1);
    expect(server.requestsTo('/api/search_suggest')).toHaveLength(0);
  });

  it('maps Bungarra (20): online, with a booking link, images, amenities and its region', () => {
    expect(byId.get('20')).toEqual({
      key: 'parkstay:20',
      providerId: 'parkstay',
      externalId: '20',
      name: 'Bungarra',
      kind: 'campground',
      bookingMode: 'online',
      lat: -22.247,
      lng: 113.84,
      area: { name: 'Cape Range National Park', region: 'Pilbara' },
      imageUrls: [
        'https://parkstay.dbca.wa.gov.au/media/parkstay/campground_images/25f050a7-6c3.jpg',
      ],
      amenities: ['Toilet', 'Road access for 2WD/SUV'],
      unitCount: 3,
      infoUrl: 'https://exploreparks.dbca.wa.gov.au/site/bungarra',
      bookingUrl:
        'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20',
    });
    expect(byId.get('20')!.imageUrls[0]).toMatch(/^https:\/\/parkstay\.dbca\.wa\.gov\.au\/media\//);
    // The map's description is empty for every campground: no summary.
    expect(byId.get('20')).not.toHaveProperty('summary');
  });

  it('maps the booking modes from campground_type', () => {
    expect(byId.get('18')!.bookingMode).toBe('online');
    expect(byId.get('85')!.bookingMode).toBe('offline');
    expect(byId.get('5')!.bookingMode).toBe('external');
    expect(byId.get('16')!.bookingMode).toBe('application');
    expect(byId.get('182')!.bookingMode).toBe('external');
  });

  it('gives a booking link only to campgrounds bookable online', () => {
    expect(byId.get('18')!.bookingUrl).toBeDefined();
    for (const id of ['85', '5', '16', '182']) expect(byId.get(id)!.bookingUrl).toBeUndefined();
  });

  it('links every campground to the search page, never site_id on the campground page', () => {
    const links = [...byId.values()].flatMap((l) => (l.bookingUrl ? [l.bookingUrl] : []));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toMatch(
        /^https:\/\/parkstay\.dbca\.wa\.gov\.au\/search-availability\/information\/\?campground_id=\d+$/
      );
    }
  });

  it('maps Woodman Point (5): an external holiday park with no booking link and no sites', () => {
    expect(byId.get('5')).toMatchObject({ kind: 'holiday-park', bookingMode: 'external' });
    expect(byId.get('5')!.bookingUrl).toBeUndefined();
    expect(byId.get('5')!.unitCount).toBeUndefined();
    expect(byId.get('5')!.imageUrls).toHaveLength(2);
  });

  it('maps Yeagarup Hut (182) as a hut with no info link', () => {
    expect(byId.get('182')).toMatchObject({ kind: 'hut', name: 'Yeagarup Hut' });
    expect(byId.get('182')!.infoUrl).toBeUndefined();
    expect(byId.get('182')).not.toHaveProperty('infoUrl');
  });

  it('keeps campgrounds of types 0, 1 and 4 as campgrounds', () => {
    expect(byId.get('16')).toMatchObject({ kind: 'campground', bookingMode: 'application' });
    expect(byId.get('85')).toMatchObject({ kind: 'campground', bookingMode: 'offline' });
  });

  it('rounds coordinates to 6 decimal places from [lng, lat]', () => {
    expect(byId.get('18')).toMatchObject({ lat: -22.177481, lng: 113.859409 });
    expect(byId.get('182')).toMatchObject({ lat: -34.571734, lng: 115.848597 });
  });

  describe('detail', () => {
    it('returns Bungarra with its page’s sections and notices, sites and release sentence', async () => {
      const detail = await parkstay.provider.catalog.getLocation('20');
      expect(detail).toMatchObject({ ...byId.get('20'), fetchedAt: '2026-10-02T02:00:00.000Z' });
      expect(detail.sections?.map((s) => s.title)).toEqual([
        'Overview',
        'Booking',
        'Campsites',
        'Facilities',
        'Campground Rules',
        'Fees',
        'Your safety and health',
        'Location',
      ]);
      expect(detail.sections?.[0].html).toContain('shore-based fishing is permitted');
      expect(detail.notices).toHaveLength(11);
      expect(detail.notices?.[0]).toEqual({
        level: 'warning',
        text: 'Drinking water not supplied: bring your own',
      });
      // With sections, the legacy, out-of-date long_description is left out.
      expect(detail.descriptionHtml).toBeUndefined();
      expect(detail.units).toHaveLength(5);
      expect(detail.units[0]).toEqual({
        unitId: '1',
        unitName: 'CAMPSITE 01',
        minPeople: 1,
        maxPeople: 6,
        maxVehicles: 3,
        equipment: ['tent', 'campervan', 'caravan', 'vehicle', 'motorcycle', 'trailer'],
        description: '12m x 7m reverse-in compacted gravel site.',
      });
      // `classes: { "null": null }` means no classes: no unit type.
      expect(detail.units.every((u) => u.unitType === undefined)).toBe(true);
      // Bungarra's release period runs to 2027-04-01.
      expect(detail.releaseInfo).toBe(
        'Bookable up to 31 March 2027; later dates are released in blocks — use a scheduled snipe'
      );
    });

    it('gives the view’s map as the campground map document, at its https address on ParkStay', async () => {
      const detail = await parkstay.provider.catalog.getLocation('20');
      expect(detail.documents).toEqual([
        {
          id: 'campground-map',
          kind: 'map',
          title: 'Campground map',
          mediaType: 'application/pdf',
          url: 'https://parkstay.dbca.wa.gov.au/media/parkstay/campground_maps/20/Bungarra_Campground_mud_map.pdf',
        },
      ]);
      // The map is not fetched with the detail
      expect(server.requestsTo('/media/')).toHaveLength(0);
    });

    it('reads the campground page once per detail, with the ParkStay Referer', async () => {
      const before = server.requestsTo('/search-availability/campground/').length;
      await parkstay.provider.catalog.getLocation('20');
      const pages = server.requestsTo('/search-availability/campground/').slice(before);
      expect(pages).toHaveLength(1);
      expect(Object.fromEntries(pages[0].query)).toEqual({ site_id: '20' });
      expect(pages[0].headers.referer).toBe('https://parkstay.dbca.wa.gov.au/');
    });

    describe('when the campground page cannot be read', () => {
      const oops = { body: readParkStayFixture('campground_page_oops.html') };
      afterEach(() => {
        server.pages.clear();
        server.queueGate = 'off';
      });

      it('falls back to the long_description, its missing items in words, with no sections stored', async () => {
        server.pages.set('20', oops);
        const fresh = createTestParkStay(server);
        const detail = await fresh.provider.catalog.getLocation('20');
        expect(detail.sections).toBeUndefined();
        expect(detail.notices).toBeUndefined();
        expect(detail.descriptionHtml).toContain('This campground is in the Gascoyne Region');
        expect(detail.descriptionHtml).not.toMatch(/<style|style=|class=/);
        // What Bungarra lacks reads as such, not as if it had it.
        expect(detail.descriptionHtml).toContain('Campfires permitted (not available)');
        expect(detail.descriptionHtml).toContain('Pets permitted (not available)');
        expect(detail.units).toHaveLength(5);
        expect(fresh.logger.lines.map((l) => l.message)).toContain(
          'ParkStay campground 20: no details from /search-availability/campground/: ' +
            'ParkStay showed its "Oops!" page (a booking is in progress)'
        );
      });

      it('keeps the sections and notices the core stored last, and leaves the long_description out', async () => {
        const previous = await parkstay.provider.catalog.getLocation('20');
        server.pages.set('20', oops);
        const fresh = createTestParkStay(server);
        const detail = await fresh.provider.catalog.getLocation('20', undefined, { previous });
        expect(detail.sections).toEqual(previous.sections);
        expect(detail.notices).toEqual(previous.notices);
        expect(detail.descriptionHtml).toBeUndefined();
      });

      it('never takes another campground’s sections', async () => {
        const previous = await parkstay.provider.catalog.getLocation('20');
        server.pages.set('18', oops);
        const fresh = createTestParkStay(server);
        const detail = await fresh.provider.catalog.getLocation('18', undefined, { previous });
        expect(detail.sections).toBeUndefined();
        expect(detail.descriptionHtml).toContain('This campground is in the Gascoyne Region');
      });

      it('never fails the detail for it, even when the queue answers the page', async () => {
        server.pages.set('20', { redirect: '/site-queue/waiting-room/parkstayv2/' });
        const detail = await createTestParkStay(server).provider.catalog.getLocation('20');
        expect(detail.units).toHaveLength(5);
        expect(detail.descriptionHtml).toContain('This campground is in the Gascoyne Region');
      });
    });

    it('probes a one-night stay from tomorrow (Perth) for one adult, with ParkStay dates', async () => {
      const before = server.requestsTo('/api/campsite_availablity_view/20/').length;
      await parkstay.provider.catalog.getLocation('20');
      const probe = server.requestsTo('/api/campsite_availablity_view/20/')[before];
      expect(Object.fromEntries(probe.query)).toMatchObject({
        arrival: '2026/10/03',
        departure: '2026/10/04',
        num_adult: '1',
        gear_type: 'all',
      });
    });

    it('describes a release window in days and the campground’s release time when there is no release period', async () => {
      const view = parkStayFixture('campsite_availablity_view_20.json');
      server.views.set('18', { ...view, id: 18, release_date: null });
      const fresh = createTestParkStay(server);
      const detail = await fresh.provider.catalog.getLocation('18');
      expect(detail.releaseInfo).toBe('Bookings open 180 days ahead at 2:00 am AWST');
      server.views.delete('18');
    });

    it('does not ask for the availability of a campground ParkStay does not book online', async () => {
      const before = server.requests.length;
      const detail = await parkstay.provider.catalog.getLocation('5');
      expect(detail.units).toEqual([]);
      expect(detail.descriptionHtml).toBeUndefined();
      expect(detail.releaseInfo).toBeUndefined();
      expect(server.requests.slice(before).map((r) => r.path)).toEqual([]);
    });

    it('reads an offline campground’s description, with no sites and no release', async () => {
      const detail = await parkstay.provider.catalog.getLocation('85');
      expect(detail).toMatchObject({ bookingMode: 'offline', units: [] });
      expect(detail.sections?.length).toBeGreaterThan(0);
      expect(detail.releaseInfo).toBeUndefined();

      server.pages.set('85', { status: 404, body: 'Not found' });
      const fallback = await createTestParkStay(server).provider.catalog.getLocation('85');
      server.pages.delete('85');
      expect(fallback.descriptionHtml).toBe('<p>Book with the park office.</p>');
    });

    it('rejects a campground that is not in the map with a ProviderError', async () => {
      await expect(parkstay.provider.catalog.getLocation('999')).rejects.toBeInstanceOf(
        ProviderError
      );
    });
  });

  describe('detail from a stored summary (no map download after a launch)', () => {
    const mapRequests = () => server.requestsTo('/api/campground_map/').length;

    it('builds Bungarra’s detail on the summary given, with no campground_map request', async () => {
      const fresh = createTestParkStay(server);
      const before = mapRequests();
      const views = server.requestsTo('/api/campsite_availablity_view/20/').length;
      const detail = await fresh.provider.catalog.getLocation('20', undefined, {
        summary: byId.get('20'),
      });
      expect(mapRequests() - before).toBe(0);
      expect(server.requestsTo('/api/campsite_availablity_view/20/').length - views).toBe(1);
      expect(detail).toMatchObject({ ...byId.get('20'), fetchedAt: '2026-10-02T02:00:00.000Z' });
      expect(detail.units).toHaveLength(5);
      expect(detail.sections?.[0].title).toBe('Overview');
      expect(detail.releaseInfo).toMatch(/^Bookable up to 31 March 2027/);

      // Again in the same run: still no map.
      await fresh.provider.catalog.getLocation('20', undefined, { summary: byId.get('20') });
      expect(mapRequests() - before).toBe(0);
    });

    it('replaces a link a stored summary kept from before with today’s', async () => {
      const fresh = createTestParkStay(server);
      const stored = {
        ...byId.get('20')!,
        bookingUrl: 'https://parkstay.dbca.wa.gov.au/search-availability/campground/?site_id=20',
      };
      const detail = await fresh.provider.catalog.getLocation('20', undefined, { summary: stored });
      expect(detail.bookingUrl).toBe(
        'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20'
      );
    });

    it('asks nothing at all for a campground another operator books, given its summary', async () => {
      const fresh = createTestParkStay(server);
      const before = server.requests.length;
      const detail = await fresh.provider.catalog.getLocation('5', undefined, {
        summary: byId.get('5'),
      });
      expect(detail).toMatchObject({ bookingMode: 'external', units: [] });
      expect(detail.releaseInfo).toBeUndefined();
      expect(server.requests.slice(before).map((r) => r.path)).toEqual([]);
    });

    it('reads the map when the summary given is another campground’s or another provider’s', async () => {
      const fresh = createTestParkStay(server);
      const before = mapRequests();
      await fresh.provider.catalog.getLocation('18', undefined, { summary: byId.get('20') });
      expect(mapRequests() - before).toBe(1);

      const other = createTestParkStay(server);
      const foreign = { ...byId.get('18')!, providerId: 'fake', key: 'fake:18' };
      await other.provider.catalog.getLocation('18', undefined, { summary: foreign });
      expect(mapRequests() - before).toBe(2);
    });

    it('prefers the map read in this run while it is fresh', async () => {
      const fresh = createTestParkStay(server);
      await fresh.provider.catalog.listLocations!();
      const before = mapRequests();
      const renamed = { ...byId.get('20')!, name: 'An older name' };
      const detail = await fresh.provider.catalog.getLocation('20', undefined, {
        summary: renamed,
      });
      expect(detail.name).toBe('Bungarra');
      expect(mapRequests() - before).toBe(0);
    });
  });
});

describe('toLocationSummary', () => {
  const bungarra = (): RawCampgroundFeature => features()[0];

  it('drops a campground without coordinates, with a warning', () => {
    const logger = createMemoryLogger();
    const feature = { ...bungarra(), geometry: { type: 'Point' as const, coordinates: null } };
    expect(toLocationSummary(feature, logger)).toBeUndefined();
    expect(logger.lines).toEqual([
      expect.objectContaining({ level: 'warn', message: expect.stringContaining('coordinates') }),
    ]);
    expect(toLocationSummary({ ...bungarra(), geometry: null }, logger)).toBeUndefined();
  });

  it('maps an unknown campground_type to offline, with a warning', () => {
    const logger = createMemoryLogger();
    const feature = bungarra();
    feature.properties.campground_type = 9;
    expect(toLocationSummary(feature, logger)).toMatchObject({
      bookingMode: 'offline',
      kind: 'campground',
    });
    expect(toLocationSummary(feature, logger)!.bookingUrl).toBeUndefined();
    expect(logger.lines[0]).toMatchObject({ level: 'warn' });
  });

  it('de-duplicates images, keeps absolute https ones, and gives [] without images', () => {
    const feature = bungarra();
    feature.properties.images = [
      { image: '/media/a.jpg' },
      { image: '/media/a.jpg' },
      { image: 'https://cdn.example/b.jpg' },
      { image: 'http://insecure.example/c.jpg' },
    ];
    expect(toLocationSummary(feature)!.imageUrls).toEqual([
      'https://parkstay.dbca.wa.gov.au/media/a.jpg',
      'https://cdn.example/b.jpg',
    ]);
    feature.properties.images = [];
    expect(toLocationSummary(feature)!.imageUrls).toEqual([]);
  });

  it('gives a summary only when the map has a description', () => {
    const feature = bungarra();
    feature.properties.description = '  A quiet bay.  ';
    expect(toLocationSummary(feature)!.summary).toBe('A quiet bay.');
  });
});

describe('campgroundMapDocument', () => {
  const MAP = '/media/parkstay/campground_maps/20/Bungarra_Campground_mud_map.pdf';

  it('resolves the site-relative path against ParkStay, taking the name as given', () => {
    expect(campgroundMapDocument(MAP)?.url).toBe(`https://parkstay.dbca.wa.gov.au${MAP}`);
    expect(campgroundMapDocument(`https://parkstay.dbca.wa.gov.au${MAP}`)?.url).toBe(
      `https://parkstay.dbca.wa.gov.au${MAP}`
    );
    expect(campgroundMapDocument('/media/parkstay/campground_maps/43/Lucky Bay.pdf')?.url).toBe(
      'https://parkstay.dbca.wa.gov.au/media/parkstay/campground_maps/43/Lucky%20Bay.pdf'
    );
  });

  it('gives nothing for a campground without a map', () => {
    expect(campgroundMapDocument(null)).toBeUndefined();
    expect(campgroundMapDocument('')).toBeUndefined();
    expect(campgroundMapDocument('   ')).toBeUndefined();
    expect(campgroundMapDocument(42)).toBeUndefined();
  });

  it('refuses an address off ParkStay’s origin or not https, logged by origin only', () => {
    const logger = createMemoryLogger();
    for (const map of [
      'https://evil.example/map.pdf?token=SECRET',
      '//evil.example/map.pdf',
      'http://parkstay.dbca.wa.gov.au/map.pdf',
      'https://parkstay.dbca.wa.gov.au:8443/map.pdf',
      'https://user:pw@parkstay.dbca.wa.gov.au/map.pdf',
      'https://parkstay.dbca.wa.gov.au.evil.example/map.pdf',
      'javascript:alert(1)',
      'file:///etc/passwd',
    ]) {
      expect(campgroundMapDocument(map, logger)).toBeUndefined();
    }
    expect(logger.lines.filter((line) => line.level === 'warn')).toHaveLength(8);
    expect(JSON.stringify(logger.lines)).not.toContain('SECRET');
  });
});

describe('kindFromName (other operators)', () => {
  it.each([
    ['Woodman Point Holiday Park', 'holiday-park'],
    ['Lake Brockman Tourist Park & Logue Brook', 'holiday-park'],
    ['RAC Margaret River Caravan Park', 'caravan-park'],
    ['Dwellingup Chalets and Caravan Park', 'caravan-park'],
    ['Wellington Forest Cottages and Conference Centre', 'cabin'],
    ['Myalup Pines Cottages', 'cabin'],
    ['Yeagarup Hut', 'hut'],
    ['Gnaraloo Homestead', 'farm-stay'],
    ['Quobba Station', 'farm-stay'],
    ['Karijini Eco Retreat', 'glamping'],
    ['Sal Salis Ningaloo Reef', 'glamping'],
    ['Yanchep Inn', 'other'],
    ['Hutt Lagoon', 'other'],
  ])('%s → %s', (name, kind) => {
    expect(kindFromName(name)).toBe(kind);
  });
});

describe('unit details (what ParkStay’s site cards show)', () => {
  const bungarra = parkStayFixture<RawCampsiteAvailabilityView>(
    'campsite_availablity_view_20.json'
  );
  const luckyBay = parkStayFixture<RawCampsiteAvailabilityView>(
    'campsite_availablity_view_43_classes.json'
  );
  const site = (overrides: Partial<RawCampsite>): RawCampsite => ({
    ...bungarra.sites[0],
    ...overrides,
  });

  it('maps a site’s paragraph, people and vehicles, never the "x" description', () => {
    expect(bungarra.sites[0].description).toBe('x');
    expect(toUnitSummary(bungarra.sites[0], bungarra.classes)).toMatchObject({
      description: '12m x 7m reverse-in compacted gravel site.',
      minPeople: 1,
      maxPeople: 6,
      maxVehicles: 3,
    });
  });

  it('maps a class listing’s values, which are the class’s', () => {
    expect(toClassUnitSummary(luckyBay.sites[0])).toMatchObject({
      unitId: 'class:117',
      description: '11m x 6m compacted crushed rock reverse-in site.',
      minPeople: 1,
      maxPeople: 8,
      maxVehicles: 2,
    });
  });

  it('leaves the description out when the paragraph is empty, blank or null', () => {
    for (const short_description of [null, '', '   ', undefined]) {
      const unit = toUnitSummary(site({ short_description }), bungarra.classes);
      expect(unit).not.toHaveProperty('description');
      expect(toClassUnitSummary(site({ short_description }))).not.toHaveProperty('description');
    }
    expect(toUnitSummary(site({ short_description: '  A shady site.  ' }), {}).description).toBe(
      'A shady site.'
    );
  });

  it('keeps only whole counts: people from 1, vehicles from 0, and a minimum no more than the maximum', () => {
    const odd = toUnitSummary(site({ min_people: 0, max_people: 2.5, max_vehicles: -1 }), {});
    expect([odd.minPeople, odd.maxPeople, odd.maxVehicles]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    const walkIn = toUnitSummary(site({ min_people: 8, max_people: 4, max_vehicles: 0 }), {});
    expect([walkIn.minPeople, walkIn.maxPeople, walkIn.maxVehicles]).toEqual([undefined, 4, 0]);
    const unknown = toClassUnitSummary(
      site({ min_people: undefined, max_people: 'six' as unknown as number })
    );
    expect([unknown.minPeople, unknown.maxPeople]).toEqual([undefined, undefined]);
  });
});
