/**
 * V5, the location catalogue, end to end on a real database:
 *
 * - the service with FakeProvider (3 locations), fake2 (2 locations) and the real ParkStay
 *   module on `NodeHttpClient` against V3's fixture server: sync isolation, search filters
 *   and facets over the ParkStay fixture catalogue, the detail cache and its stale fallback,
 *   and the availability fan-out;
 * - the `catalog.*` handlers through P3's IPC harness on a real container;
 * - the retired transitional `parkstay` namespace.
 */

import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { createContainer, type AppContainer } from '@main/app/container';
import { LocationCatalogService } from '@main/core/catalog/location-catalog.service';
import { openDatabase } from '@main/database/connection';
import { LocationRepository, ProviderStateRepository } from '@main/database/repositories';
import { registerIpcHandlers } from '@main/ipc';
import { parkstayFactory } from '@main/providers/parkstay';
import { ProviderRegistry } from '@main/providers/registry';
import { AccessGateError, ProviderHttpError } from '@main/providers/sdk/errors';
import type { EventName } from '@shared/contracts/channels';
import type {
  APIResponse,
  CatalogAvailabilityResult,
  CatalogSearchResult,
  CatalogStatus,
  LocationAvailability,
  LocationDetail,
} from '@shared/types';
import { TestDatabaseHelper } from '@tests/utils/database-helper';
import {
  createFakeProvider,
  createMemoryLogger,
  createTestProviderContext,
  FIXED_NOW,
  type FakeProvider,
} from '@tests/utils/fake-provider';
import { containerSecrets, removeUserData } from '@tests/utils/fake-safe-storage';
import {
  FakeIpcMain,
  fakeEvent,
  fakeWebContents,
  TEST_LOGS_DIR,
  TRUSTED_SENDER_ID,
  type FakeWebContents,
} from '@tests/utils/ipc-harness';
import {
  parkStayFixture,
  readParkStayFixture,
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '@tests/utils/parkstay-fixture-server';
import type { FakeBrowserWindow } from '@tests/utils/electron-mocks';
import { BUNGARRA_STAY, createTestParkStay } from '@tests/utils/parkstay-provider';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const HOUR = 3_600_000;

interface World {
  db: Database.Database;
  registry: ProviderRegistry;
  fake: FakeProvider;
  fake2: FakeProvider;
  locations: LocationRepository;
  catalog: LocationCatalogService;
  events: Array<[EventName, unknown]>;
  clock: { now: Date };
}

describe('the location catalogue on a real database', () => {
  let server: ParkStayFixtureServer;
  let helper: TestDatabaseHelper;
  let world: World;

  beforeAll(async () => {
    server = await startParkStayFixtureServer();
  });

  afterAll(async () => {
    await server.close();
  });

  /** FakeProvider and fake2, plus the ParkStay module on the fixture server when asked. */
  async function build({ parkstay }: { parkstay: boolean }): Promise<World> {
    helper = new TestDatabaseHelper('catalog');
    const db = await helper.setup();
    const registry = parkstay ? createTestParkStay(server).registry : new ProviderRegistry();
    const fake = createFakeProvider();
    const fake2 = createFakeProvider({
      id: 'fake2',
      locations: [
        { externalId: 'a', name: 'Lucky Bay' },
        { externalId: 'b', name: 'Osprey Bay' },
      ],
    });
    registry.register(fake.factory, createTestProviderContext);
    registry.register(fake2.factory, createTestProviderContext);
    const locations = new LocationRepository(db);
    const events: World['events'] = [];
    const clock = { now: FIXED_NOW };
    const catalog = new LocationCatalogService({
      registry,
      locations,
      providerState: new ProviderStateRepository(db),
      events: { emit: (name, payload) => void events.push([name, payload]) },
      logger: createMemoryLogger(),
      clock: () => clock.now,
    });
    world = { db, registry, fake, fake2, locations, catalog, events, clock };
    return world;
  }

  beforeEach(() => {
    server.requests.length = 0;
    server.overrides.clear();
    server.queueGate = 'off';
  });

  afterEach(async () => {
    world.catalog.stop();
    await world.registry.disposeAll();
    await helper.teardown();
  });

  const listCalls = (p: FakeProvider): number =>
    p.calls.filter((c) => c.method === 'listLocations').length;
  const mapRequests = (): number => server.requestsTo('/api/campground_map/').length;
  const later = (ms: number): void => {
    world.clock.now = new Date(world.clock.now.getTime() + ms);
  };

  describe('sync', () => {
    it('stores 5 rows from fake and fake2, status reports both, and catalog:updated fires twice', async () => {
      const { catalog, locations, events } = await build({ parkstay: false });

      await catalog.sync();

      expect(locations.countByProvider()).toEqual({ fake: 3, fake2: 2 });
      expect(catalog.search({}).total).toBe(5);
      const syncedAt = FIXED_NOW.toISOString();
      expect(catalog.status()).toEqual({
        providers: [
          { providerId: 'fake', count: 3, syncedAt, stale: false, syncing: false },
          { providerId: 'fake2', count: 2, syncedAt, stale: false, syncing: false },
        ],
      });
      expect(events).toEqual([
        ['catalog:updated', { providerId: 'fake', count: 3, syncedAt }],
        ['catalog:updated', { providerId: 'fake2', count: 2, syncedAt }],
      ]);
    });

    it("isolates failures: fake2 rejecting does not stop fake, and fake2's cached rows stay searchable", async () => {
      const { catalog, fake, fake2 } = await build({ parkstay: false });
      await catalog.sync();
      fake2.failNext(
        'catalog',
        new ProviderHttpError({ providerId: 'fake2', status: 502, url: 'https://fake2.example/' })
      );
      later(60_000);

      const status = await catalog.refresh();

      expect(listCalls(fake)).toBe(2);
      expect(status.providers).toEqual([
        {
          providerId: 'fake',
          count: 3,
          syncedAt: world.clock.now.toISOString(),
          stale: false,
          syncing: false,
        },
        {
          providerId: 'fake2',
          count: 2,
          syncedAt: FIXED_NOW.toISOString(),
          stale: false,
          syncing: false,
          lastError: 'fake2: HTTP 502 from https://fake2.example/',
        },
      ]);
      expect(catalog.search({ providerIds: ['fake2'] }).items.map((l) => l.name)).toEqual([
        'Lucky Bay',
        'Osprey Bay',
      ]);
    });

    it('a sync that returns [] over a cache of 3 keeps the 3 rows and records lastError', async () => {
      const { catalog, fake, locations } = await build({ parkstay: false });
      await catalog.sync('fake');
      jest.spyOn(fake.catalog!, 'listLocations').mockResolvedValueOnce([]);

      await catalog.refresh('fake');

      expect(locations.countByProvider().fake).toBe(3);
      expect(catalog.search({ providerIds: ['fake'] }).total).toBe(3);
      expect(catalog.status().providers[0].lastError).toBe(
        'fake listed no locations; the 3 cached ones are kept'
      );
    });

    it('call log: no provider call for a second sync within 24 h, 1 for refresh, 1 for two concurrent refreshes', async () => {
      const { catalog, fake } = await build({ parkstay: true });
      await catalog.sync();
      expect(mapRequests()).toBe(1);
      expect(listCalls(fake)).toBe(1);

      // The fake's own limit is 1 h; ParkStay's is 24 h
      later(30 * 60_000);
      await catalog.sync();
      later(23 * HOUR);
      await catalog.sync('parkstay');
      expect(listCalls(fake)).toBe(1);
      expect(mapRequests()).toBe(1);

      await catalog.refresh('fake');
      expect(listCalls(fake)).toBe(2);

      fake.delayMs = 20;
      await Promise.all([catalog.refresh('fake'), catalog.refresh('fake')]);
      expect(listCalls(fake)).toBe(3);

      later(HOUR);
      await catalog.sync('parkstay');
      expect(mapRequests()).toBe(2);
    });

    it('syncs the 6 ParkStay fixture campgrounds into locations', async () => {
      const { catalog } = await build({ parkstay: true });
      await catalog.sync('parkstay');
      expect(catalog.status().providers.find((p) => p.providerId === 'parkstay')).toMatchObject({
        count: 6,
        stale: false,
      });
    });
  });

  describe('search over the ParkStay fixture catalogue', () => {
    let catalog: LocationCatalogService;
    const ids = (result: CatalogSearchResult): string[] => result.items.map((l) => l.externalId);
    const parkstay = { providerIds: ['parkstay'] };

    beforeEach(async () => {
      ({ catalog } = await build({ parkstay: true }));
      await catalog.sync('parkstay');
    });

    it("text 'bung' finds Bungarra first", () => {
      const result = catalog.search({ ...parkstay, text: 'bung' });
      expect(result.items[0]).toMatchObject({ key: 'parkstay:20', name: 'Bungarra' });
    });

    it("text 'kurrajong cape' finds ids 18 and 16", () => {
      expect(ids(catalog.search({ ...parkstay, text: 'kurrajong cape' }))).toEqual(['18', '16']);
    });

    it("text '\"; DROP TABLE' finds nothing and throws nothing", () => {
      expect(catalog.search({ text: '"; DROP TABLE' })).toMatchObject({ items: [], total: 0 });
      expect(catalog.search(parkstay).total).toBe(6);
    });

    it('amenities [Toilet, Road access for 2WD/SUV] leave out Yeagarup Hut (182)', () => {
      const result = catalog.search({
        ...parkstay,
        amenities: ['Toilet', 'Road access for 2WD/SUV'],
      });
      expect(ids(result).sort()).toEqual(['16', '18', '20', '5', '85']);
      expect(ids(result)).not.toContain('182');
    });

    it('bookingModes [online] returns only campground_type 0', () => {
      const types = new Map<string, number>(
        parkStayFixture('campground_map.json').features.map(
          (f: { id: number; properties: { campground_type: number } }) => [
            String(f.id),
            f.properties.campground_type,
          ]
        )
      );
      const result = catalog.search({ ...parkstay, bookingModes: ['online'] });
      expect(ids(result).sort()).toEqual(['18', '20']);
      expect(ids(result).every((id) => types.get(id) === 0)).toBe(true);
    });

    it('bbox [113, -23, 114, -22] returns only the Cape Range campgrounds', () => {
      const result = catalog.search({ ...parkstay, bbox: [113, -23, 114, -22] });
      expect(ids(result).sort()).toEqual(['16', '18', '20']);
      expect(result.items.every((l) => l.area?.name === 'Cape Range National Park')).toBe(true);
    });

    it('limit 5000 returns every row, with total matching the row count', () => {
      const rows = (world.db.prepare('SELECT COUNT(*) AS n FROM locations').get() as { n: number })
        .n;
      const result = catalog.search({ limit: 5000 });
      expect(result.items).toHaveLength(rows);
      expect(result.total).toBe(rows);
      expect(rows).toBe(6);
    });

    it('regions [Pilbara] still lists every region in facets.regions, and counts amenities within Pilbara', () => {
      const { facets, total } = catalog.search({ ...parkstay, regions: ['Pilbara'] });
      expect(total).toBe(3);
      expect(facets!.regions).toEqual([
        { value: 'Pilbara', count: 3 },
        { value: 'Goldfields', count: 1 },
        { value: 'Swan', count: 1 },
        { value: 'Warren', count: 1 },
      ]);
      expect(facets!.amenities).toEqual([
        { value: 'Road access for 2WD/SUV', count: 3 },
        { value: 'Toilet', count: 3 },
      ]);
      // Only ParkStay has synced in this block
      expect(facets!.providers).toEqual([{ value: 'parkstay', count: 3 }]);
      expect(facets!.kinds).toEqual([{ value: 'campground', count: 3 }]);
    });
  });

  describe('detail', () => {
    it("get('parkstay:20') asks ParkStay once, then serves the cache for 6 h, sanitised", async () => {
      const { catalog, registry } = await build({ parkstay: true });
      await catalog.sync('parkstay');
      const getLocation = jest.spyOn(registry.get('parkstay').catalog!, 'getLocation');

      const pages = () => server.requestsTo('/search-availability/campground/').length;
      const pagesBefore = pages();

      const first = await catalog.get('parkstay:20');
      later(6 * HOUR - 60_000);
      const second = await catalog.get('parkstay:20');

      expect(getLocation).toHaveBeenCalledTimes(1);
      // The campground page shares the detail cache: one request in 6 h.
      expect(pages() - pagesBefore).toBe(1);
      expect(second).toEqual(first);
      expect(first).toMatchObject({
        key: 'parkstay:20',
        name: 'Bungarra',
        fetchedAt: FIXED_NOW.toISOString(),
        units: expect.arrayContaining([expect.objectContaining({ unitId: '3' })]),
      });
      // The campground page's sections replace the legacy description.
      expect(first.descriptionHtml).toBeUndefined();
      expect(first.sections?.map((section) => section.title)).toContain('Campground Rules');
      expect(first.notices).toContainEqual({ level: 'warning', text: 'No generators' });
      for (const section of first.sections ?? []) {
        expect(section.html).not.toMatch(/<style|<script|style=|class=/);
      }
      // The empty map summary was filled from the intro, so search finds the text
      expect(catalog.search({ text: 'shore-based' }).items.map((l) => l.key)).toEqual([
        'parkstay:20',
      ]);
    });

    it("lists Bungarra's campground map without its address, which stays in the cache", async () => {
      const { catalog, locations } = await build({ parkstay: true });
      await catalog.sync('parkstay');
      const mapUrl =
        'https://parkstay.dbca.wa.gov.au/media/parkstay/campground_maps/20/Bungarra_Campground_mud_map.pdf';

      const detail = await catalog.get('parkstay:20');

      expect(detail.documents).toEqual([
        {
          id: 'campground-map',
          kind: 'map',
          title: 'Campground map',
          mediaType: 'application/pdf',
        },
      ]);
      expect(JSON.stringify(detail)).not.toContain('campground_maps');
      expect(locations.getDetail('parkstay', '20')?.detail.documents?.[0].url).toBe(mapUrl);
      await expect(catalog.resolveDocument('parkstay:20', 'campground-map')).resolves.toMatchObject(
        {
          url: mapUrl,
          providerName: 'ParkStay',
          locationName: 'Bungarra',
        }
      );
    });

    it('after the TTL, keeps the stored sections when the campground page shows "Oops!"', async () => {
      const { catalog } = await build({ parkstay: true });
      await catalog.sync('parkstay');
      const first = await catalog.get('parkstay:20');
      later(6 * HOUR + 1);
      server.pages.set('20', { body: readParkStayFixture('campground_page_oops.html') });

      try {
        const again = await catalog.get('parkstay:20');
        expect(again.stale).toBeUndefined();
        expect(again.fetchedAt).not.toBe(first.fetchedAt);
        expect(again.sections).toEqual(first.sections);
        expect(again.notices).toEqual(first.notices);
        expect(again.descriptionHtml).toBeUndefined();
      } finally {
        server.pages.delete('20');
      }
    });

    it('after the TTL, with ParkStay failing (the queue is on), returns the cached detail marked stale', async () => {
      const { catalog } = await build({ parkstay: true });
      await catalog.sync('parkstay');
      const first = await catalog.get('parkstay:20');
      later(6 * HOUR + 1);
      server.queueGate = 'html';

      const stale = await catalog.get('parkstay:20');

      expect(stale).toEqual({ ...first, stale: true });
    });

    it("after a launch, get('parkstay:20') builds on the stored summary: no campground_map download", async () => {
      const { catalog, locations, db } = await build({ parkstay: true });
      await catalog.sync('parkstay');
      expect(mapRequests()).toBe(1);

      // The next launch: a new ParkStay module (nothing in memory) over the same database,
      // whose catalogue is still fresh, so no sync runs.
      const relaunched = createTestParkStay(server).registry;
      const again = new LocationCatalogService({
        registry: relaunched,
        locations,
        providerState: new ProviderStateRepository(db),
        events: { emit: () => undefined },
        logger: createMemoryLogger(),
        clock: () => world.clock.now,
      });
      try {
        const detail = await again.get('parkstay:20');
        expect(mapRequests()).toBe(1);
        expect(detail).toMatchObject({
          key: 'parkstay:20',
          name: 'Bungarra',
          bookingMode: 'online',
        });
        expect(detail.units).toHaveLength(5);
        expect(detail.releaseInfo).toMatch(/^Bookable up to 31 March 2027/);
      } finally {
        again.stop();
        await relaunched.disposeAll();
      }
    });

    it("get('parkstay:999') is NOT_FOUND", async () => {
      const { catalog } = await build({ parkstay: true });
      await catalog.sync('parkstay');
      await expect(catalog.get('parkstay:999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('availability', () => {
    const entriesOf = (result: CatalogAvailabilityResult, providerId: string) =>
      result.entries.filter((e) => e.key.startsWith(`${providerId}:`));

    it('returns parkstay:20 (3 of its 5 sites free) and leaves out the unknown id 1', async () => {
      const { catalog } = await build({ parkstay: true });
      await catalog.sync('parkstay');
      const body = parkStayFixture('campground_availabilty_view.json');
      // ParkStay reports totals for a campground the catalogue does not have
      body.campground_available['1'] = { sites: [7], total_available: 1, total_bookable: 1 };
      server.overrides.set('/api/campground_availabilty_view/', { status: 200, body });

      const result = await catalog.availability(BUNGARRA_STAY, { providerIds: ['parkstay'] });

      expect(result.errors).toEqual([]);
      expect(result.entries).toContainEqual({
        key: 'parkstay:20',
        availableUnits: 3,
        bookableUnits: 5,
      });
      expect(result.entries.map((e) => e.key).sort()).toEqual(['parkstay:18', 'parkstay:20']);
    });

    it('lists a FakeProvider AccessGateError in errors while ParkStay entries still come back, then caches for 5 min', async () => {
      const { catalog, fake } = await build({ parkstay: true });
      await catalog.sync();
      fake.failNext('availability', new AccessGateError('fake', 'waiting'));

      const result = await catalog.availability(BUNGARRA_STAY);

      expect(result.errors).toEqual([
        { providerId: 'fake', code: 'access-gate', message: 'fake: the queue is waiting' },
      ]);
      expect(entriesOf(result, 'parkstay')).toContainEqual({
        key: 'parkstay:20',
        availableUnits: 3,
        bookableUnits: 5,
      });
      expect(entriesOf(result, 'fake2')).toHaveLength(2);

      // A second identical call within 5 minutes asks nobody that answered
      const searches = (): number =>
        server.requestsTo('/api/campground_availabilty_view/').length +
        world.fake2.calls.filter((c) => c.method === 'search').length;
      const before = searches();
      later(4 * 60_000);
      const again = await catalog.availability(BUNGARRA_STAY);
      expect(searches()).toBe(before);
      expect(entriesOf(again, 'parkstay')).toEqual(entriesOf(result, 'parkstay'));
    });

    it('never waits in the DBCA queue: with the queue on, ParkStay is an access-gate error at once', async () => {
      const { catalog } = await build({ parkstay: true });
      await catalog.sync();
      server.queueGate = 'html';

      const started = Date.now();
      const result = await catalog.availability(BUNGARRA_STAY);

      expect(Date.now() - started).toBeLessThan(2_000);
      expect(result.errors).toEqual([
        { providerId: 'parkstay', code: 'access-gate', message: expect.any(String) },
      ]);
      expect(server.requestsTo('/api/check-create-session/')).toEqual([]);
      expect(entriesOf(result, 'fake')).toHaveLength(3);
    });

    it("checkLocation('parkstay:20', stay) returns each unit's nights with prices, cached for 60 s", async () => {
      const { catalog } = await build({ parkstay: true });
      await catalog.sync('parkstay');

      const availability = await catalog.checkLocation('parkstay:20', BUNGARRA_STAY);
      later(59_000);
      await catalog.checkLocation('parkstay:20', BUNGARRA_STAY);

      expect(server.requestsTo('/api/campsite_availablity_view/20/')).toHaveLength(1);
      expect(availability.key).toBe('parkstay:20');
      expect(availability.units).toHaveLength(5);
      const site3 = availability.units.find((u) => u.unitId === '3')!;
      expect(site3).toMatchObject({ unitName: 'CAMPSITE 03', fullyAvailable: true, total: 60 });
      expect(site3.nights).toEqual([
        { date: '2026-11-10', state: 'available', price: 30, label: '$30.00' },
        { date: '2026-11-11', state: 'available', price: 30, label: '$30.00' },
      ]);
      expect(availability.bookingUrl).toMatch(/^https:\/\/parkstay\.dbca\.wa\.gov\.au\//);
    });
  });
});

describe('catalog.* over IPC (P3 harness, real container)', () => {
  let container: AppContainer;
  let ipc: FakeIpcMain;
  let mainWindow: FakeWebContents;
  let userDataDir: string;
  let fake: FakeProvider;

  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
  const stay = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };

  beforeEach(() => {
    const secrets = containerSecrets();
    userDataDir = secrets.userDataDir;
    // ParkStay alone (with no network here) plus the fake, however many providers are built in
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...secrets,
      providerFactories: [parkstayFactory],
    });
    fake = createFakeProvider();
    container.providers.register(fake.factory, createTestProviderContext);
    mainWindow = fakeWebContents(TRUSTED_SENDER_ID);
    container.trustedWebContents.register(mainWindow);
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
  });

  afterEach(async () => {
    await container.dispose();
    removeUserData(userDataDir);
  });

  it('registers the seven catalog handlers and no parkstay ones', () => {
    expect(ipc.registrations.filter((c) => c.startsWith('catalog:')).sort()).toEqual([
      'catalog:availability',
      'catalog:check-location',
      'catalog:get',
      'catalog:open-document',
      'catalog:refresh',
      'catalog:search',
      'catalog:status',
    ]);
    expect(ipc.registrations.filter((c) => c.startsWith('parkstay:'))).toEqual([]);
  });

  it('answers every method with its contract shape, and forwards catalog:updated to the window', async () => {
    const refreshed = await call<CatalogStatus>('catalog:refresh', { providerId: 'fake' });
    expect(refreshed).toMatchObject({
      success: true,
      data: {
        providers: expect.arrayContaining([
          expect.objectContaining({ providerId: 'fake', count: 3 }),
        ]),
      },
    });
    expect(mainWindow.sent).toEqual([
      ['catalog:updated', { providerId: 'fake', count: 3, syncedAt: expect.any(String) }],
    ]);

    const status = await call<CatalogStatus>('catalog:status');
    expect(status.success).toBe(true);
    // ParkStay is registered too; it has not synced here
    expect(status.data!.providers.map((p) => [p.providerId, p.count, p.stale])).toEqual([
      ['fake', 3, false],
      ['parkstay', 0, true],
    ]);

    const search = await call<CatalogSearchResult>('catalog:search', { text: 'karri' });
    expect(search).toMatchObject({
      success: true,
      data: { total: 1, items: [{ key: 'fake:2', name: 'Karri Grove' }] },
    });
    expect(Object.keys(search.data!.facets!).sort()).toEqual([
      'amenities',
      'kinds',
      'providers',
      'regions',
    ]);

    const detail = await call<LocationDetail>('catalog:get', { key: 'fake:area:3' });
    expect(detail).toMatchObject({
      success: true,
      data: { key: 'fake:area:3', name: 'Tingle Hut', units: expect.any(Array) },
    });

    const bulk = await call<CatalogAvailabilityResult>('catalog:availability', {
      stay,
      providerIds: ['fake'],
    });
    expect(bulk).toEqual({
      success: true,
      data: {
        entries: [
          { key: 'fake:1', availableUnits: 1, bookableUnits: 2 },
          { key: 'fake:2', availableUnits: 1, bookableUnits: 2 },
          { key: 'fake:area:3', availableUnits: 1, bookableUnits: 2 },
        ],
        errors: [],
      },
    });

    const check = await call<LocationAvailability>('catalog:check-location', {
      key: 'fake:1',
      stay,
    });
    expect(check).toMatchObject({
      success: true,
      data: { key: 'fake:1', units: [{ unitId: 'u1', fullyAvailable: true }, { unitId: 'u2' }] },
    });
    // Everything crosses IPC as plain data
    for (const response of [refreshed, status, search, detail, bulk, check]) {
      expect(structuredClone(response)).toEqual(response);
    }
  });

  it("a provider's failure is an error entry over IPC, not a failed call", async () => {
    await call('catalog:refresh', { providerId: 'fake' });
    // The container's ParkStay has no network in this test
    const bulk = await call<CatalogAvailabilityResult>('catalog:availability', { stay });
    expect(bulk.success).toBe(true);
    expect(bulk.data!.entries).toHaveLength(3);
    expect(bulk.data!.errors).toEqual([
      expect.objectContaining({ providerId: 'parkstay', code: expect.any(String) }),
    ]);

    const refreshed = await call<CatalogStatus>('catalog:refresh', {});
    expect(refreshed.success).toBe(true);
    expect(refreshed.data!.providers.find((p) => p.providerId === 'parkstay')).toMatchObject({
      count: 0,
      lastError: expect.any(String),
    });
  });

  it('maps errors: unknown key NOT_FOUND, unknown provider UNKNOWN_PROVIDER, missing capability CAPABILITY', async () => {
    await call('catalog:refresh', { providerId: 'fake' });
    expect(await call('catalog:get', { key: 'fake:999' })).toEqual({
      success: false,
      code: 'NOT_FOUND',
      error: 'There is no location fake:999',
    });
    expect(await call('catalog:check-location', { key: 'nope:1', stay })).toMatchObject({
      success: false,
      code: 'UNKNOWN_PROVIDER',
    });
    expect(await call('catalog:refresh', { providerId: 'nope' })).toMatchObject({
      success: false,
      code: 'UNKNOWN_PROVIDER',
    });
    const watchOnly = createFakeProvider({ id: 'nocat', capabilities: { catalog: false } });
    container.providers.register(watchOnly.factory, createTestProviderContext);
    expect(await call('catalog:refresh', { providerId: 'nocat' })).toMatchObject({
      success: false,
      code: 'CAPABILITY',
    });
  });

  it('all seven handlers reject invalid payloads with VALIDATION', async () => {
    const cases: Array<[string, unknown, string[]]> = [
      ['catalog:search', { limit: 0 }, ['limit']],
      ['catalog:search', { limit: 5001 }, ['limit']],
      ['catalog:search', { bbox: [116, -34, 115, -33] }, ['bbox']],
      ['catalog:search', { kinds: ['castle'] }, ['kinds.0']],
      ['catalog:get', { key: 'nokey' }, ['key']],
      ['catalog:availability', { stay: { ...stay, arrival: '2026-02-30' } }, ['stay.arrival']],
      ['catalog:availability', { stay, bbox: [200, -34, 201, -33] }, ['bbox.0', 'bbox.2']],
      [
        'catalog:check-location',
        { key: 'fake:1', stay: { ...stay, departure: stay.arrival } },
        ['stay.departure'],
      ],
      ['catalog:refresh', { providerId: 'Bad Id' }, ['providerId']],
      ['catalog:status', { anything: true }, ['(root)']],
      ['catalog:open-document', { locationKey: 'nokey', documentId: 'x' }, ['locationKey']],
      ['catalog:open-document', { locationKey: 'fake:1', documentId: '' }, ['documentId']],
    ];
    for (const [channel, payload, issues] of cases) {
      expect([channel, await call(channel, payload)]).toEqual([
        channel,
        expect.objectContaining({ success: false, code: 'VALIDATION', issues }),
      ]);
    }
    expect(fake.calls).toEqual([]);
  });
});

describe('catalog.openDocument over IPC (real container, mocked windows)', () => {
  const MAP_URL = 'https://fake.example/media/maps/1/map.pdf';
  let container: AppContainer;
  let ipc: FakeIpcMain;
  let userDataDir: string;
  let fake: FakeProvider;
  const windowsMock = jest.requireMock('electron') as {
    BrowserWindow: typeof FakeBrowserWindow;
    session: { fromPartition: jest.Mock };
  };
  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
  const newestWindow = (): FakeBrowserWindow =>
    windowsMock.BrowserWindow.instances[windowsMock.BrowserWindow.instances.length - 1];
  /** Waits (up to 5 s) for the handler to open its window. */
  const opened = async (count: number): Promise<FakeBrowserWindow> => {
    const until = Date.now() + 5_000;
    while (windowsMock.BrowserWindow.instances.length < count && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(windowsMock.BrowserWindow.instances).toHaveLength(count);
    return newestWindow();
  };

  beforeEach(async () => {
    windowsMock.BrowserWindow.instances.length = 0;
    const secrets = containerSecrets();
    userDataDir = secrets.userDataDir;
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...secrets,
      providerFactories: [parkstayFactory],
    });
    fake = createFakeProvider();
    container.providers.register(fake.factory, createTestProviderContext);
    const catalog = container.providers.get('fake').catalog!;
    const original = catalog.getLocation.bind(catalog);
    jest.spyOn(catalog, 'getLocation').mockImplementation(async (id, signal) => ({
      ...(await original(id, signal)),
      documents: [
        {
          id: 'campground-map',
          kind: 'map',
          title: 'Campground map',
          mediaType: 'application/pdf',
          url: MAP_URL,
        },
      ],
    }));
    container.trustedWebContents.register(fakeWebContents(TRUSTED_SENDER_ID));
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
    await call('catalog:refresh', { providerId: 'fake' });
  });

  afterEach(async () => {
    await container.dispose();
    removeUserData(userDataDir);
  });

  it('lists the map without its address, then opens it at the address main cached', async () => {
    const detail = await call<LocationDetail>('catalog:get', { key: 'fake:1' });
    expect(detail.data!.documents).toEqual([
      { id: 'campground-map', kind: 'map', title: 'Campground map', mediaType: 'application/pdf' },
    ]);
    expect(JSON.stringify(detail)).not.toContain('fake.example/media');

    // A URL in the payload is no part of the contract: it is never used
    const opening = call('catalog:open-document', {
      locationKey: 'fake:1',
      documentId: 'campground-map',
      url: 'https://evil.example/x.pdf',
    });
    const window = await opened(1);
    expect(window.loadURL).toHaveBeenCalledWith(MAP_URL);
    expect(window.options).toMatchObject({ title: 'Banksia Camp · Campground map' });
    expect(window.options.webPreferences).toMatchObject({
      partition: 'documents-fake',
      plugins: true,
    });
    window.webContents.navigate(MAP_URL);
    await expect(opening).resolves.toEqual({ success: true, data: undefined });

    // A second open focuses the same window
    await expect(
      call('catalog:open-document', { locationKey: 'fake:1', documentId: 'campground-map' })
    ).resolves.toEqual({ success: true, data: undefined });
    expect(windowsMock.BrowserWindow.instances).toHaveLength(1);
    expect(window.focus).toHaveBeenCalled();

    // The quit path closes it
    await container.dispose();
    expect(window.destroy).toHaveBeenCalled();
  });

  it('PROVIDER_ERROR, and the window closes, when the answer is not a PDF', async () => {
    const opening = call('catalog:open-document', {
      locationKey: 'fake:1',
      documentId: 'campground-map',
    });
    const window = await opened(1);
    const ses = windowsMock.session.fromPartition('documents-fake') as {
      webRequest: { onHeadersReceived: jest.Mock };
    };
    // The partition outlives each test's container: this container's check is the latest
    const check = ses.webRequest.onHeadersReceived.mock.lastCall![0] as (
      details: Record<string, unknown>,
      callback: (response: { cancel?: boolean }) => void
    ) => void;
    const callback = jest.fn();
    check(
      {
        url: MAP_URL,
        resourceType: 'mainFrame',
        webContentsId: window.webContents.id,
        statusCode: 200,
        responseHeaders: { 'Content-Type': ['text/plain'] },
      },
      callback
    );
    expect(callback).toHaveBeenCalledWith({ cancel: true });
    await expect(opening).resolves.toEqual({
      success: false,
      code: 'PROVIDER_ERROR',
      error: "Fake didn't send the campground map. Try again later.",
    });
    expect(window.destroy).toHaveBeenCalled();
  });

  it('NOT_FOUND for a document or location that does not exist, with no window', async () => {
    expect(
      await call('catalog:open-document', { locationKey: 'fake:1', documentId: 'brochure' })
    ).toMatchObject({ success: false, code: 'NOT_FOUND' });
    expect(
      await call('catalog:open-document', { locationKey: 'fake:999', documentId: 'campground-map' })
    ).toMatchObject({ success: false, code: 'NOT_FOUND' });
    expect(windowsMock.BrowserWindow.instances).toHaveLength(0);
  });
});

describe('the transitional parkstay namespace is retired', () => {
  it('no source file mentions api.parkstay, parkstay:search or CampgroundSearchResult', () => {
    const SRC = path.resolve(__dirname, '../../src');
    const pattern = /api\.parkstay|parkstay:search|CampgroundSearchResult/;
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (pattern.test(fs.readFileSync(full, 'utf8'))) offenders.push(full);
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});
