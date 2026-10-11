/**
 * `LocationCatalogService` with FakeProvider and fake2 on a real (in-memory) database:
 * freshness and TTLs (a future timestamp is stale), empty-result protection, single-flight,
 * automatic sync timing, the release guard and the empty-cache retries, stop, detail
 * fallbacks and sanitising, summary derivation, the key and bbox filtering of bulk
 * availability, and the 60 s cache of queue and timeout errors.
 */

import type Database from 'better-sqlite3';
import {
  CATALOG_SYNC_STATE_KEY,
  LocationCatalogService,
  type CatalogTimings,
} from '@main/core/catalog/location-catalog.service';
import { closeDatabase, openDatabase } from '@main/database/connection';
import { LocationRepository, ProviderStateRepository } from '@main/database/repositories';
import { ProviderRegistry } from '@main/providers/registry';
import { AccessGateError, ProviderError, ProviderHttpError } from '@main/providers/sdk/errors';
import type { EventName } from '@shared/contracts/channels';
import type { BulkAvailabilityEntry, LocationDetail } from '@shared/types';
import { AppError } from '@main/utils/app-error';
import {
  createFakeProvider,
  createMemoryLogger,
  createTestProviderContext,
  FIXED_NOW,
  type FakeProvider,
} from '@tests/utils/fake-provider';

const HOUR = 3_600_000;
const STAY = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };

interface Setup {
  db: Database.Database;
  registry: ProviderRegistry;
  fake: FakeProvider;
  fake2: FakeProvider;
  locations: LocationRepository;
  providerState: ProviderStateRepository;
  catalog: LocationCatalogService;
  events: Array<[EventName, unknown]>;
  clock: { now: Date };
  releasing: Set<string>;
}

let current: Setup | undefined;

function setup(
  timings: Partial<CatalogTimings> = {},
  fakeOptions: Parameters<typeof createFakeProvider>[0] = {}
): Setup {
  const db = openDatabase(':memory:');
  const registry = new ProviderRegistry();
  const fake = createFakeProvider(fakeOptions);
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
  const providerState = new ProviderStateRepository(db);
  const events: Setup['events'] = [];
  const clock = { now: FIXED_NOW };
  const releasing = new Set<string>();
  const catalog = new LocationCatalogService({
    registry,
    locations,
    providerState,
    events: { emit: (name, payload) => void events.push([name, payload]) },
    logger: createMemoryLogger(),
    clock: () => clock.now,
    isReleaseInProgress: (id) => releasing.has(id),
    timings,
  });
  current = {
    db,
    registry,
    fake,
    fake2,
    locations,
    providerState,
    catalog,
    events,
    clock,
    releasing,
  };
  return current;
}

afterEach(async () => {
  jest.useRealTimers();
  if (!current) return;
  current.catalog.stop();
  await current.registry.disposeAll();
  closeDatabase(current.db);
  current = undefined;
});

const callsTo = (provider: FakeProvider, method: string): number =>
  provider.calls.filter((c) => c.method === method).length;

const advance = (s: Setup, ms: number): void => {
  s.clock.now = new Date(s.clock.now.getTime() + ms);
};

describe('freshness and TTLs', () => {
  it('a provider that never synced is stale with count 0, and syncing while its first sync runs', async () => {
    const s = setup();
    expect(s.catalog.status().providers).toEqual([
      { providerId: 'fake', count: 0, stale: true, syncing: false },
      { providerId: 'fake2', count: 0, stale: true, syncing: false },
    ]);

    s.fake.delayMs = 30;
    const syncing = s.catalog.sync('fake');
    expect(s.catalog.status().providers[0]).toMatchObject({ providerId: 'fake', syncing: true });
    await syncing;
    expect(s.catalog.status().providers[0]).toEqual({
      providerId: 'fake',
      count: 3,
      syncedAt: FIXED_NOW.toISOString(),
      stale: false,
      syncing: false,
    });
  });

  it("re-syncs only after the provider's catalogTtlHours (the fake's is 1 h; ParkStay's 24 h)", async () => {
    const s = setup();
    await s.catalog.sync();
    advance(s, HOUR - 1);
    await s.catalog.sync();
    expect(callsTo(s.fake, 'listLocations')).toBe(1);
    expect(s.catalog.status().providers.every((p) => !p.stale)).toBe(true);

    advance(s, 1);
    expect(s.catalog.status().providers.every((p) => p.stale)).toBe(true);
    await s.catalog.sync();
    expect(callsTo(s.fake, 'listLocations')).toBe(2);
    expect(callsTo(s.fake2, 'listLocations')).toBe(2);
  });

  it('serves a cached detail for 6 h, then asks the provider again', async () => {
    const s = setup();
    await s.catalog.sync();
    await s.catalog.get('fake:1');
    advance(s, 6 * HOUR - 1);
    const cached = await s.catalog.get('fake:1');
    expect(callsTo(s.fake, 'getLocation')).toBe(1);
    expect(cached).toMatchObject({ key: 'fake:1', fetchedAt: FIXED_NOW.toISOString() });
    expect(cached.stale).toBeUndefined();

    advance(s, 1);
    const fresh = await s.catalog.get('fake:1');
    expect(callsTo(s.fake, 'getLocation')).toBe(2);
    expect(fresh.fetchedAt).toBe(s.clock.now.toISOString());
  });

  it('reuses bulk availability for 5 minutes and a location check for 60 s, per stay', async () => {
    const s = setup();
    await s.catalog.sync();

    await s.catalog.availability(STAY);
    advance(s, 5 * 60_000 - 1);
    await s.catalog.availability(STAY);
    expect(callsTo(s.fake, 'search')).toBe(1);
    advance(s, 1);
    await s.catalog.availability(STAY);
    expect(callsTo(s.fake, 'search')).toBe(2);
    // Another stay is another question
    await s.catalog.availability({ ...STAY, adults: 3 });
    expect(callsTo(s.fake, 'search')).toBe(3);

    await s.catalog.checkLocation('fake:1', STAY);
    advance(s, 60_000 - 1);
    await s.catalog.checkLocation('fake:1', STAY);
    expect(callsTo(s.fake, 'check')).toBe(1);
    advance(s, 1);
    await s.catalog.checkLocation('fake:1', STAY);
    await s.catalog.checkLocation('fake:2', STAY);
    expect(callsTo(s.fake, 'check')).toBe(3);
  });

  it('a syncedAt or a detail fetchedAt in the future (the clock was set back) is stale', async () => {
    const s = setup();
    await s.catalog.sync('fake');
    await s.catalog.get('fake:1');
    expect(s.catalog.status().providers[0]).toMatchObject({ providerId: 'fake', stale: false });

    advance(s, -60_000);

    expect(s.catalog.status().providers[0]).toMatchObject({ providerId: 'fake', stale: true });
    await s.catalog.sync('fake');
    expect(callsTo(s.fake, 'listLocations')).toBe(2);
    expect(s.catalog.status().providers[0]).toMatchObject({
      stale: false,
      syncedAt: s.clock.now.toISOString(),
    });
    const detail = await s.catalog.get('fake:1');
    expect(callsTo(s.fake, 'getLocation')).toBe(2);
    expect(detail.fetchedAt).toBe(s.clock.now.toISOString());
  });
});

describe('empty-result protection', () => {
  it('an empty list over a cache of 3 keeps the 3 rows and records lastError', async () => {
    const s = setup();
    await s.catalog.sync('fake');
    s.events.length = 0;
    jest.spyOn(s.fake.catalog!, 'listLocations').mockResolvedValueOnce([]);

    const status = await s.catalog.refresh('fake');

    expect(s.locations.countByProvider().fake).toBe(3);
    expect(status.providers.find((p) => p.providerId === 'fake')).toMatchObject({
      count: 3,
      syncedAt: FIXED_NOW.toISOString(),
      lastError: 'fake listed no locations; the 3 cached ones are kept',
    });
    expect(s.events).toEqual([]);
  });

  it('an empty list with nothing cached is a successful sync of 0', async () => {
    const s = setup();
    jest.spyOn(s.fake.catalog!, 'listLocations').mockResolvedValueOnce([]);

    await s.catalog.sync('fake');

    expect(s.catalog.status().providers[0]).toEqual({
      providerId: 'fake',
      count: 0,
      syncedAt: FIXED_NOW.toISOString(),
      stale: false,
      syncing: false,
    });
    expect(s.events).toEqual([
      ['catalog:updated', { providerId: 'fake', count: 0, syncedAt: FIXED_NOW.toISOString() }],
    ]);
  });
});

describe('single-flight', () => {
  it('two concurrent refreshes of one provider make one provider call', async () => {
    const s = setup();
    s.fake.delayMs = 20;
    const [a, b] = await Promise.all([s.catalog.refresh('fake'), s.catalog.refresh('fake')]);
    expect(callsTo(s.fake, 'listLocations')).toBe(1);
    expect(a).toEqual(b);
    expect(s.events).toHaveLength(1);
  });

  it('concurrent gets of one location make one getLocation call', async () => {
    const s = setup();
    await s.catalog.sync();
    s.fake.delayMs = 20;
    const [a, b] = await Promise.all([s.catalog.get('fake:1'), s.catalog.get('fake:1')]);
    expect(callsTo(s.fake, 'getLocation')).toBe(1);
    expect(a).toEqual(b);
  });

  it('concurrent identical availability and check calls share one provider call each', async () => {
    const s = setup();
    await s.catalog.sync();
    s.fake.delayMs = 20;
    await Promise.all([
      s.catalog.availability(STAY),
      s.catalog.availability({ ...STAY, children: 0 }),
      s.catalog.checkLocation('fake:1', STAY),
      s.catalog.checkLocation('fake:1', STAY),
    ]);
    expect(callsTo(s.fake, 'search')).toBe(1);
    expect(callsTo(s.fake, 'check')).toBe(1);
  });
});

describe('stay changes', () => {
  it('an answer for the old stay never fills the cache of the stay asked for since', async () => {
    const s = setup();
    await s.catalog.sync('fake');
    const search = jest.spyOn(s.fake.availability!, 'search');
    let answerOld: (entries: BulkAvailabilityEntry[]) => void = () => undefined;
    search.mockImplementationOnce(() => new Promise((resolve) => (answerOld = resolve)));
    const newStay = { ...STAY, departure: '2026-11-14' };

    const old = s.catalog.availability(STAY, { providerIds: ['fake'] });
    const fresh = await s.catalog.availability(newStay, { providerIds: ['fake'] });
    answerOld([{ key: 'fake:1', availableUnits: 0, bookableUnits: 9 }]);
    await old;

    const again = await s.catalog.availability(newStay, { providerIds: ['fake'] });
    expect(again).toEqual(fresh);
    expect(again.entries).toContainEqual({ key: 'fake:1', availableUnits: 1, bookableUnits: 2 });
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe('bulk cache key', () => {
  it('reuses an answer when only stay fields the provider ignores change (the guests)', async () => {
    const s = setup(
      {},
      { bulkAvailabilityStayFields: ['arrival', 'departure', 'params.gearType'] }
    );
    await s.catalog.sync('fake');
    const search = jest.spyOn(s.fake.availability!, 'search');
    const first = await s.catalog.availability(STAY, { providerIds: ['fake'] });
    const moreGuests = await s.catalog.availability(
      { ...STAY, adults: 4, children: 2, infants: 1 },
      { providerIds: ['fake'] }
    );
    expect(moreGuests).toEqual(first);
    expect(search).toHaveBeenCalledTimes(1);
    // A field it reads asks again.
    await s.catalog.availability(
      { ...STAY, params: { gearType: 'caravan' } },
      { providerIds: ['fake'] }
    );
    await s.catalog.availability({ ...STAY, departure: '2026-11-14' }, { providerIds: ['fake'] });
    expect(search).toHaveBeenCalledTimes(3);
  });

  it('keys by every stay field when the provider declares none', async () => {
    const s = setup();
    await s.catalog.sync('fake');
    const search = jest.spyOn(s.fake.availability!, 'search');
    await s.catalog.availability(STAY, { providerIds: ['fake'] });
    await s.catalog.availability({ ...STAY, adults: 4 }, { providerIds: ['fake'] });
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe('automatic sync (start)', () => {
  const flush = (): Promise<void> => jest.advanceTimersByTimeAsync(50);

  it('waits 5 s after start, syncs stale providers only, then re-checks hourly', async () => {
    const s = setup();
    await s.catalog.sync('fake2');
    jest.useFakeTimers();

    s.catalog.start();
    s.catalog.start();
    await jest.advanceTimersByTimeAsync(4_999);
    expect(callsTo(s.fake, 'listLocations')).toBe(0);
    await jest.advanceTimersByTimeAsync(1);
    await flush();
    expect(callsTo(s.fake, 'listLocations')).toBe(1);
    // fake2 was fresh
    expect(callsTo(s.fake2, 'listLocations')).toBe(1);

    // An hour on, both catalogues are past the fake's 1 h TTL
    advance(s, HOUR);
    await jest.advanceTimersByTimeAsync(HOUR);
    await flush();
    expect(callsTo(s.fake, 'listLocations')).toBe(2);
    expect(callsTo(s.fake2, 'listLocations')).toBe(2);
  });

  it('skips a provider while one of its snipes is queueing or sniping; a manual refresh still runs', async () => {
    jest.useFakeTimers();
    const s = setup();
    s.releasing.add('fake');

    s.catalog.start();
    await jest.advanceTimersByTimeAsync(5_000);
    await flush();
    expect(callsTo(s.fake, 'listLocations')).toBe(0);
    expect(callsTo(s.fake2, 'listLocations')).toBe(1);

    const refreshing = s.catalog.refresh('fake');
    await flush();
    await refreshing;
    expect(callsTo(s.fake, 'listLocations')).toBe(1);

    // Next hour, the release is over and the fake is stale again
    s.releasing.clear();
    advance(s, HOUR);
    await jest.advanceTimersByTimeAsync(HOUR);
    await flush();
    expect(callsTo(s.fake, 'listLocations')).toBe(2);
  });

  it('stop() cancels the pending start and aborts a sync in flight, which then writes nothing', async () => {
    const s = setup();
    s.fake.delayMs = 10_000;
    const syncing = s.catalog.sync('fake');
    await new Promise((resolve) => setTimeout(resolve, 5));

    s.catalog.stop();
    await syncing;

    expect(s.locations.countByProvider()).toEqual({});
    expect(s.providerState.get('fake', CATALOG_SYNC_STATE_KEY)).toBeUndefined();
    expect(s.events).toEqual([]);
    // Stopped for good
    await s.catalog.sync('fake');
    expect(callsTo(s.fake, 'listLocations')).toBe(1);
  });

  it('stop() before the 5 s delay means no automatic sync at all', async () => {
    jest.useFakeTimers();
    const s = setup();
    s.catalog.start();
    s.catalog.stop();
    await jest.advanceTimersByTimeAsync(2 * HOUR);
    expect(callsTo(s.fake, 'listLocations') + callsTo(s.fake2, 'listLocations')).toBe(0);
  });
});

describe('automatic sync while a catalogue is empty (first launch offline)', () => {
  const offline = (): ProviderHttpError =>
    new ProviderHttpError({ providerId: 'fake', status: 503, url: 'https://fake.example/x' });

  /** Advances the fake timers to `ms` after the test's start. */
  function timeline(): (ms: number) => Promise<void> {
    let elapsed = 0;
    return async (ms) => {
      await jest.advanceTimersByTimeAsync(ms - elapsed);
      elapsed = ms;
    };
  }

  it('retries a failed sync after 1, 2 and 5 min, then only on the hourly re-check: no loop', async () => {
    jest.useFakeTimers();
    const s = setup();
    const list = jest.spyOn(s.fake.catalog!, 'listLocations').mockRejectedValue(offline());
    const until = timeline();

    s.catalog.start();
    await until(5_050);
    expect(list).toHaveBeenCalledTimes(1);
    // fake2 synced and has rows: no retries for it
    expect(callsTo(s.fake2, 'listLocations')).toBe(1);

    // 1 min after the first attempt, then 2 min after that, then 5 min after that
    const expected: Array<[number, number]> = [
      [64_999, 1],
      [65_050, 2],
      [184_999, 2],
      [185_050, 3],
      [484_999, 3],
      [485_050, 4],
      // Nothing more until the hourly re-check (5 s + 1 h)
      [HOUR + 4_999, 4],
      [HOUR + 5_050, 5],
      // ... and the backoff does not start over after it
      [HOUR + 15 * 60_000, 5],
      [2 * HOUR + 4_999, 5],
      [2 * HOUR + 5_050, 6],
    ];
    for (const [ms, calls] of expected) {
      await until(ms);
      expect([ms, list.mock.calls.length]).toEqual([ms, calls]);
    }
    expect(callsTo(s.fake2, 'listLocations')).toBe(1);
    expect(s.catalog.status().providers[0]).toMatchObject({
      count: 0,
      lastError: expect.any(String),
    });
  });

  it('stops retrying once rows exist, and behaves as before from then on', async () => {
    jest.useFakeTimers();
    const s = setup();
    s.fake.failNext('catalog', offline());
    const until = timeline();

    s.catalog.start();
    await until(5_050);
    expect(callsTo(s.fake, 'listLocations')).toBe(1);
    expect(s.locations.countByProvider().fake).toBeUndefined();

    // The 1 min retry succeeds
    await until(65_050);
    expect(callsTo(s.fake, 'listLocations')).toBe(2);
    expect(s.locations.countByProvider().fake).toBe(3);

    // Stale again from here on, yet no 2 or 5 min retry: only the hourly re-check syncs it
    advance(s, HOUR);
    await until(HOUR + 4_999);
    expect(callsTo(s.fake, 'listLocations')).toBe(2);
    await until(HOUR + 5_050);
    expect(callsTo(s.fake, 'listLocations')).toBe(3);
  });

  it('a provider waiting for a release still gets its retries, and stop() cancels a pending one', async () => {
    jest.useFakeTimers();
    const s = setup();
    s.releasing.add('fake');
    const until = timeline();

    s.catalog.start();
    await until(5_050);
    expect(callsTo(s.fake, 'listLocations')).toBe(0);

    // The release is over by the 1 min retry
    s.releasing.clear();
    await until(65_050);
    expect(callsTo(s.fake, 'listLocations')).toBe(1);
    expect(s.locations.countByProvider().fake).toBe(3);

    // Empty and failing again on another catalogue: stop() drops its pending retry
    s.catalog.stop();
    await until(2 * HOUR);
    expect(callsTo(s.fake, 'listLocations')).toBe(1);
  });
});

describe('sync outcomes', () => {
  it('a failure after a success keeps syncedAt and count, and the next success clears lastError', async () => {
    const s = setup();
    await s.catalog.sync('fake');
    s.fake.failNext(
      'catalog',
      new ProviderHttpError({ providerId: 'fake', status: 503, url: 'https://fake.example/x' })
    );
    await s.catalog.refresh('fake');
    expect(s.providerState.get('fake', CATALOG_SYNC_STATE_KEY)).toEqual({
      syncedAt: FIXED_NOW.toISOString(),
      count: 3,
      lastError: 'fake: HTTP 503 from https://fake.example/x',
    });

    advance(s, 60_000);
    await s.catalog.refresh('fake');
    expect(s.providerState.get('fake', CATALOG_SYNC_STATE_KEY)).toEqual({
      syncedAt: s.clock.now.toISOString(),
      count: 3,
    });
  });

  it('a sync that misses its deadline is a timeout error', async () => {
    const s = setup({ syncTimeoutMs: 20 });
    s.fake.delayMs = 1_000;
    const status = await s.catalog.refresh('fake');
    expect(status.providers[0].lastError).toBe('fake: no answer within 20 ms');
    expect(status.providers[0].syncing).toBe(false);
  });

  it('a location the provider dropped disappears on the next sync, with its cached detail', async () => {
    const s = setup();
    await s.catalog.sync('fake');
    await s.catalog.get('fake:2');
    expect(s.locations.getDetail('fake', '2')).not.toBeNull();

    const listed = await s.fake.catalog!.listLocations!();
    jest
      .spyOn(s.fake.catalog!, 'listLocations')
      .mockResolvedValueOnce(listed.filter((l) => l.externalId !== '2'));
    await s.catalog.refresh('fake');

    expect(s.catalog.search({ providerIds: ['fake'] }).items.map((l) => l.key)).toEqual([
      'fake:1',
      'fake:area:3',
    ]);
    expect(s.locations.getDetail('fake', '2')).toBeNull();
    await expect(s.catalog.get('fake:2')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("an unregistered provider's rows are left out of search and status", async () => {
    const s = setup();
    await s.catalog.sync();
    s.locations.upsertMany(
      'gone',
      [
        {
          key: 'gone:1',
          providerId: 'gone',
          externalId: '1',
          name: 'Banksia Gone',
          kind: 'campground',
          bookingMode: 'online',
          lat: -34,
          lng: 116,
          imageUrls: [],
          amenities: [],
        },
      ],
      FIXED_NOW
    );
    expect(s.catalog.search({ text: 'banksia' }).items.map((l) => l.key)).toEqual(['fake:1']);
    expect(s.catalog.search({}).total).toBe(5);
    expect(s.catalog.status().providers.map((p) => p.providerId)).toEqual(['fake', 'fake2']);
    await expect(s.catalog.get('gone:1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refreshing a provider without a catalogue, or an unknown one, throws its provider error', async () => {
    const s = setup();
    const noCatalog = createFakeProvider({ id: 'nocat', capabilities: { catalog: false } });
    s.registry.register(noCatalog.factory, createTestProviderContext);
    await expect(s.catalog.refresh('nocat')).rejects.toMatchObject({ code: 'capability' });
    await expect(s.catalog.refresh('nope')).rejects.toMatchObject({ code: 'unknown-provider' });
  });

  it("a 'search' catalogue (searched by map area) is listed but never synced (search-mode.test.ts)", async () => {
    const s = setup();
    const area = createFakeProvider({ id: 'area', capabilities: { catalogMode: 'search' } });
    s.registry.register(area.factory, createTestProviderContext);

    const status = await s.catalog.refresh();

    expect(area.calls.filter((c) => c.module === 'catalog')).toEqual([]);
    expect(status.providers.find((p) => p.providerId === 'area')).toEqual({
      providerId: 'area',
      count: 0,
      stale: false,
      syncing: false,
      search: { textSearch: false },
    });
  });
});

describe('detail', () => {
  it('an unknown key is NOT_FOUND', async () => {
    const s = setup();
    await s.catalog.sync();
    for (const key of ['fake:999', 'nope:1']) {
      const error = await s.catalog.get(key).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: 'NOT_FOUND', message: `There is no location ${key}` });
    }
    expect(callsTo(s.fake, 'getLocation')).toBe(0);
  });

  it('sanitises the description again in main, whatever the provider sent', async () => {
    const s = setup();
    await s.catalog.sync();
    const original = s.fake.catalog!.getLocation.bind(s.fake.catalog);
    jest.spyOn(s.fake.catalog!, 'getLocation').mockImplementation(async (id, signal) => ({
      ...(await original(id, signal)),
      descriptionHtml:
        '<style>p{}</style><p onclick="x()" style="color:red">Calm <a href="javascript:x()">water</a></p><script>alert(1)</script><img src="/img/a.jpg">',
    }));

    const detail = await s.catalog.get('fake:1');

    expect(detail.descriptionHtml).toBe(
      '<p>Calm <a rel="noopener noreferrer">water</a></p><img src="https://fake.example/img/a.jpg" alt="" />'
    );
    expect(s.locations.getDetail('fake', '1')?.detail.descriptionHtml).toBe(detail.descriptionHtml);
  });

  it("leaves the place's own photos out of its description: the page shows them already", async () => {
    const s = setup();
    await s.catalog.sync();
    const original = s.fake.catalog!.getLocation.bind(s.fake.catalog);
    jest.spyOn(s.fake.catalog!, 'getLocation').mockImplementation(async (id, signal) => ({
      ...(await original(id, signal)),
      imageUrls: ['https://fake.example/img/hero.jpg'],
      descriptionHtml: '<p>Calm</p><img src="/img/hero.jpg"><img src="/img/map.jpg" alt="Map">',
    }));

    const detail = await s.catalog.get('fake:1');

    expect(detail.descriptionHtml).toBe(
      '<p>Calm</p><img src="https://fake.example/img/map.jpg" alt="Map" />'
    );
  });

  it('sanitises sections again in main, headings under their titles, and keeps only valid notices', async () => {
    const s = setup();
    await s.catalog.sync();
    const original = s.fake.catalog!.getLocation.bind(s.fake.catalog);
    jest.spyOn(s.fake.catalog!, 'getLocation').mockImplementation(async (id, signal) => ({
      ...(await original(id, signal)),
      imageUrls: ['https://fake.example/img/hero.jpg'],
      sections: [
        {
          title: ' Fees ',
          html: '<h2>Prices</h2><p style="x" onclick="y()">$10</p><script>z()</script>',
        },
        { title: 'Photos', html: '<img src="/img/hero.jpg">' },
        { title: '', html: '<p>No title</p>' },
        { title: 'Empty', html: '<p> </p><style>p{}</style>' },
      ],
      notices: [
        { level: 'warning', text: ' No fires ' },
        { level: 'urgent', text: 'Not a level' } as never,
        { level: 'info', text: '  ' },
        { level: 'caution', text: 3 } as never,
      ],
    }));

    const detail = await s.catalog.get('fake:1');

    expect(detail.sections).toEqual([{ title: 'Fees', html: '<h4>Prices</h4><p>$10</p>' }]);
    expect(detail.notices).toEqual([{ level: 'warning', text: 'No fires' }]);
    expect(s.locations.getDetail('fake', '1')?.detail.sections).toEqual(detail.sections);
  });

  it('gives the provider the detail it stored last, however old, so it can keep parts of it', async () => {
    const s = setup();
    await s.catalog.sync();
    const spy = jest.spyOn(s.fake.catalog!, 'getLocation');
    const first = await s.catalog.get('fake:1');
    expect(spy.mock.calls[0][2]).not.toHaveProperty('previous');

    advance(s, 7 * HOUR);
    await s.catalog.get('fake:1');

    expect(spy.mock.calls[1][2]).toMatchObject({
      summary: expect.objectContaining({ key: 'fake:1' }),
      previous: first,
    });
  });

  it("fills an empty summary from the first section's text when there is no description", async () => {
    const s = setup();
    await s.catalog.sync();
    jest.spyOn(s.fake.catalog!, 'getLocation').mockResolvedValueOnce({
      ...(s.locations.get('fake', '1') as LocationDetail),
      units: [],
      sections: [
        { title: 'Overview', html: '<p>Turquoise water and white sand</p>' },
        { title: 'Fees', html: '<p>Ten dollars</p>' },
      ],
    });

    await s.catalog.get('fake:1');

    expect(s.locations.get('fake', '1')?.summary).toBe('Turquoise water and white sand');
  });

  it("fills an empty summary from the description's text, so search finds it", async () => {
    const s = setup();
    await s.catalog.sync();
    expect(s.catalog.search({ text: 'turquoise' }).total).toBe(0);
    jest.spyOn(s.fake.catalog!, 'getLocation').mockResolvedValueOnce({
      ...(s.locations.get('fake', '1') as LocationDetail),
      units: [],
      descriptionHtml: '<h4>Turquoise water</h4><p>and white sand</p>',
    });

    await s.catalog.get('fake:1');

    expect(s.locations.get('fake', '1')?.summary).toBe('Turquoise water and white sand');
    expect(s.catalog.search({ text: 'turquoise' }).items.map((l) => l.key)).toEqual(['fake:1']);
  });

  it('with no cache and a failing provider, returns the summary as a stale detail with no units', async () => {
    const s = setup();
    await s.catalog.sync();
    s.fake.failNext('catalog', new AccessGateError('fake', 'waiting'));

    const detail = await s.catalog.get('fake:2');

    expect(detail).toEqual({ ...s.locations.get('fake', '2'), units: [], stale: true });
    expect(s.locations.getDetail('fake', '2')).toBeNull();
  });

  it('after the TTL with a failing provider, returns the cached detail marked stale', async () => {
    const s = setup();
    await s.catalog.sync();
    const first = await s.catalog.get('fake:1');
    advance(s, 7 * HOUR);
    s.fake.failNext('catalog', new ProviderError({ providerId: 'fake', message: 'down' }));

    const stale = await s.catalog.get('fake:1');

    expect(stale).toEqual({ ...first, stale: true });
    // The next success replaces it
    const fresh = await s.catalog.get('fake:1');
    expect(fresh.stale).toBeUndefined();
    expect(fresh.fetchedAt).toBe(s.clock.now.toISOString());
  });
});

describe('documents (the campground map): addresses stay in main', () => {
  const MAP_URL = 'https://fake.example/media/maps/1/map.pdf';
  const MAP = {
    id: 'campground-map',
    kind: 'map' as const,
    title: 'Campground map',
    mediaType: 'application/pdf',
    url: MAP_URL,
  };
  const listed = { id: MAP.id, kind: MAP.kind, title: MAP.title, mediaType: MAP.mediaType };

  /** The fake's detail, with these documents. */
  function withDocuments(s: Setup, documents: unknown[]): void {
    const original = s.fake.catalog!.getLocation.bind(s.fake.catalog);
    jest.spyOn(s.fake.catalog!, 'getLocation').mockImplementation(async (id, signal) => ({
      ...(await original(id, signal)),
      documents: documents as never,
    }));
  }

  it('returns the documents without their address, fresh, cached and stale, and caches the address', async () => {
    const s = setup();
    await s.catalog.sync();
    withDocuments(s, [MAP]);

    const fresh = await s.catalog.get('fake:1');
    expect(fresh.documents).toEqual([listed]);
    expect(JSON.stringify(fresh)).not.toContain(MAP_URL);
    // The cache holds the address, main-side
    expect(s.locations.getDetail('fake', '1')?.detail.documents).toEqual([MAP]);

    const cached = await s.catalog.get('fake:1');
    expect(cached.documents).toEqual([listed]);
    expect(JSON.stringify(cached)).not.toContain(MAP_URL);

    advance(s, 7 * HOUR);
    s.fake.failNext('catalog', new ProviderError({ providerId: 'fake', message: 'down' }));
    const stale = await s.catalog.get('fake:1');
    expect(stale).toMatchObject({ stale: true, documents: [listed] });
    expect(JSON.stringify(stale)).not.toContain(MAP_URL);
  });

  it('keeps only documents with an id, a known kind, a title, a media type and an https address', async () => {
    const s = setup();
    await s.catalog.sync();
    withDocuments(s, [
      { ...MAP, id: ' campground-map ', title: ' Campground map ' },
      { ...MAP, title: 'A second with the same id' },
      { ...MAP, id: 'plain', url: 'http://fake.example/map.pdf' },
      { ...MAP, id: 'credentials', url: 'https://user:pw@fake.example/map.pdf' },
      { ...MAP, id: 'script', url: 'javascript:alert(1)' },
      { ...MAP, id: 'relative', url: '/media/map.pdf' },
      { ...MAP, id: 'kind', kind: 'video' },
      { ...MAP, id: '' },
      { ...MAP, id: 'untitled', title: ' ' },
      { ...MAP, id: 'untyped', mediaType: undefined },
      null,
    ]);

    const detail = await s.catalog.get('fake:1');

    expect(detail.documents).toEqual([listed]);
    expect(s.locations.getDetail('fake', '1')?.detail.documents).toEqual([MAP]);
  });

  it('leaves documents out of a detail that has none, or only invalid ones', async () => {
    const s = setup();
    await s.catalog.sync();
    withDocuments(s, [{ ...MAP, url: 'ftp://fake.example/map.pdf' }]);
    const detail = await s.catalog.get('fake:1');
    expect(detail).not.toHaveProperty('documents');
    expect(s.locations.getDetail('fake', '1')?.detail).not.toHaveProperty('documents');
    expect(await s.catalog.get('fake:2')).not.toHaveProperty('documents');
  });

  it('resolves a document’s address from the cached detail, with the window’s names', async () => {
    const s = setup();
    await s.catalog.sync();
    withDocuments(s, [MAP]);
    await s.catalog.get('fake:1');
    const calls = callsTo(s.fake, 'getLocation');

    await expect(s.catalog.resolveDocument('fake:1', 'campground-map')).resolves.toEqual({
      ...MAP,
      key: 'fake:1#campground-map',
      providerId: 'fake',
      providerName: 'Fake',
      locationName: 'Banksia Camp',
    });
    // From the cache: the provider is not asked again
    expect(callsTo(s.fake, 'getLocation')).toBe(calls);
  });

  it('fetches the detail first when none is cached', async () => {
    const s = setup();
    await s.catalog.sync();
    withDocuments(s, [MAP]);
    expect(s.locations.getDetail('fake', '1')).toBeNull();

    const document = await s.catalog.resolveDocument('fake:1', 'campground-map');

    expect(document.url).toBe(MAP_URL);
    expect(callsTo(s.fake, 'getLocation')).toBe(1);
  });

  it('NOT_FOUND for an unknown document, location or provider, or a cached address that is not https', async () => {
    const s = setup();
    await s.catalog.sync();
    withDocuments(s, [MAP]);
    await s.catalog.get('fake:1');
    const notFound = { name: 'AppError', code: 'NOT_FOUND' };

    await expect(s.catalog.resolveDocument('fake:1', 'other')).rejects.toMatchObject(notFound);
    await expect(s.catalog.resolveDocument('fake:999', 'campground-map')).rejects.toMatchObject(
      notFound
    );
    await expect(s.catalog.resolveDocument('nope:1', 'campground-map')).rejects.toMatchObject(
      notFound
    );
    // A row changed behind the service's back still never yields a non-https address
    const cached = s.locations.getDetail('fake', '1')!;
    s.locations.setDetail(
      'fake',
      '1',
      { ...cached.detail, documents: [{ ...MAP, url: 'file:///etc/passwd' }] },
      cached.fetchedAt
    );
    await expect(s.catalog.resolveDocument('fake:1', 'campground-map')).rejects.toBeInstanceOf(
      AppError
    );
  });
});

describe('bulk availability filtering and errors', () => {
  const keysOf = (entries: BulkAvailabilityEntry[]): string[] => entries.map((e) => e.key).sort();

  it('keeps only entries for locations in the catalogue, of the provider that sent them', async () => {
    const s = setup();
    await s.catalog.sync();
    jest.spyOn(s.fake.availability!, 'search').mockResolvedValueOnce([
      { key: 'fake:1', availableUnits: 1, bookableUnits: 2 },
      { key: 'fake:999', availableUnits: 1, bookableUnits: 1 },
      { key: 'fake2:a', availableUnits: 1, bookableUnits: 1 },
      { key: 'not a key', availableUnits: 1, bookableUnits: 1 },
    ]);

    const result = await s.catalog.availability(STAY, { providerIds: ['fake'] });

    expect(result).toEqual({
      entries: [{ key: 'fake:1', availableUnits: 1, bookableUnits: 2 }],
      errors: [],
    });
  });

  it('keeps only entries inside the bbox when one is given', async () => {
    const s = setup();
    await s.catalog.sync();
    // Each fake's n-th location sits at (-34 + n/10, 116 + n/10): the first ones are outside
    const result = await s.catalog.availability(STAY, { bbox: [116.05, -33.95, 116.3, -33.7] });
    expect(keysOf(result.entries)).toEqual(['fake2:b', 'fake:2', 'fake:area:3']);
  });

  it('asks only the providers named (unknown ids ignored) and reports each failure by code', async () => {
    const s = setup({ availabilityTimeoutMs: 20 });
    await s.catalog.sync();

    const only = await s.catalog.availability(STAY, { providerIds: ['fake2', 'nope'] });
    expect(keysOf(only.entries)).toEqual(['fake2:a', 'fake2:b']);
    expect(callsTo(s.fake, 'search')).toBe(0);

    s.fake.failNext('availability', new AccessGateError('fake', 'waiting'));
    s.fake2.delayMs = 1_000;
    const failed = await s.catalog.availability({ ...STAY, adults: 1 });
    expect(failed.entries).toEqual([]);
    expect(failed.errors).toEqual([
      { providerId: 'fake', code: 'access-gate', message: 'fake: the queue is waiting' },
      { providerId: 'fake2', code: 'timeout', message: 'fake2: no answer within 20 ms' },
    ]);

    // Queue and timeout errors are reused for 60 s; then both providers are asked again
    s.fake2.delayMs = 0;
    advance(s, 60_000);
    const retried = await s.catalog.availability({ ...STAY, adults: 1 });
    expect(retried.errors).toEqual([]);
    expect(retried.entries).toHaveLength(5);
  });
});

describe('the 60 s cache of queue and timeout errors', () => {
  it('reuses an access-gate or timeout error for 60 s per provider and stay, asking nothing', async () => {
    const s = setup();
    await s.catalog.sync();
    jest.useFakeTimers();
    /** Moves the service's clock and the timers together. */
    const tick = async (ms: number): Promise<void> => {
      advance(s, ms);
      await jest.advanceTimersByTimeAsync(ms);
    };
    /** A call that may reach a provider: the fake answers after a 0 ms timer. */
    const ask = async (...args: Parameters<LocationCatalogService['availability']>) => {
      const pending = s.catalog.availability(...args);
      await jest.advanceTimersByTimeAsync(0);
      return pending;
    };
    s.fake.failNext('availability', new AccessGateError('fake', 'waiting'));
    s.fake2.delayMs = 60_000;

    const first = s.catalog.availability(STAY);
    await tick(20_000);
    const failed = await first;
    expect(failed).toEqual({
      entries: [],
      errors: [
        { providerId: 'fake', code: 'access-gate', message: 'fake: the queue is waiting' },
        { providerId: 'fake2', code: 'timeout', message: 'fake2: no answer within 20 s' },
      ],
    });
    expect([callsTo(s.fake, 'search'), callsTo(s.fake2, 'search')]).toEqual([1, 1]);

    // Map pans for the next minute get the cached error entries, without a request
    s.fake2.delayMs = 0;
    for (const ms of [1, 30_000, 29_998]) {
      await tick(ms);
      expect(await ask(STAY)).toEqual(failed);
    }
    expect(await ask(STAY, { bbox: [116, -34, 117, -33] })).toEqual(failed);
    expect([callsTo(s.fake, 'search'), callsTo(s.fake2, 'search')]).toEqual([1, 1]);

    // Another stay is another question
    const other = await ask({ ...STAY, adults: 3 });
    expect(other.errors).toEqual([]);
    expect([callsTo(s.fake, 'search'), callsTo(s.fake2, 'search')]).toEqual([2, 2]);

    // 60 s on, both are asked again, and the answers replace the errors
    await tick(1);
    const fresh = await ask(STAY);
    expect(fresh.errors).toEqual([]);
    expect(fresh.entries).toHaveLength(5);
    expect([callsTo(s.fake, 'search'), callsTo(s.fake2, 'search')]).toEqual([3, 3]);
  });

  it('other errors are not cached: the next call asks again', async () => {
    const s = setup();
    await s.catalog.sync();
    s.fake.failNext(
      'availability',
      new ProviderHttpError({ providerId: 'fake', status: 503, url: 'https://fake.example/x' })
    );

    const failed = await s.catalog.availability(STAY, { providerIds: ['fake'] });
    expect(failed.errors).toEqual([
      { providerId: 'fake', code: 'http', message: 'fake: HTTP 503 from https://fake.example/x' },
    ]);
    const retried = await s.catalog.availability(STAY, { providerIds: ['fake'] });
    expect(retried.errors).toEqual([]);
    expect(retried.entries).toHaveLength(3);
    expect(callsTo(s.fake, 'search')).toBe(2);
  });
});
