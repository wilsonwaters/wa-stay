/**
 * `LocationCatalogService` with a search-mode catalogue (`catalogMode: 'search'`, DX2) beside
 * the full-mode FakeProvider, on a real (in-memory) database: a search with a map area or a
 * text asks the provider in the background and answers from the stored catalogue at once;
 * what it finds is stored and announced; areas are snapped, single-flight, cached for the
 * provider's TTL, capped at 5 pages and within its concurrency; failures are recorded and
 * backed off; stop() aborts; found places are never removed; status reports searches.
 */

import type Database from 'better-sqlite3';
import {
  AREA_SEARCH_MAX_PAGES,
  CATALOG_SEARCH_STATE_KEY,
  LocationCatalogService,
  SEARCH_MEMORY_SIZE,
  TEXT_SEARCH_MAX_ITEMS,
  type CatalogTimings,
} from '@main/core/catalog/location-catalog.service';
import { closeDatabase, openDatabase } from '@main/database/connection';
import { LocationRepository, ProviderStateRepository } from '@main/database/repositories';
import { ProviderRegistry } from '@main/providers/registry';
import { ProviderHttpError } from '@main/providers/sdk/errors';
import type { EventName } from '@shared/contracts/channels';
import type { CatalogAreaQuery } from '@main/providers/sdk';
import type { BoundingBox, LocationSummary } from '@shared/types';
import { catalogSearchArea } from '@shared/utils/catalog-area';
import {
  createFakeProvider,
  createMemoryLogger,
  createTestProviderContext,
  FIXED_NOW,
  type FakeLocationSeed,
  type FakeProvider,
  type MemoryLogger,
} from '@tests/utils/fake-provider';
import {
  createFakeSearchProvider,
  manyAround,
  type FakeSearchProviderOptions,
} from '@tests/utils/fake-search-provider';

const HOUR = 3_600_000;
/** Perth and Fremantle: Quenda Cottage and Bilby Bungalow. */
const PERTH: BoundingBox = [115.6, -32.2, 116.1, -31.8];
/** The South West, Perth to Albany: six places. */
const SOUTH_WEST: BoundingBox = [114.5, -35.5, 118.5, -31.5];
/** The Kimberley: Pindan Palms and Boab Camp. */
const KIMBERLEY: BoundingBox = [121, -19, 130, -14];

interface Setup {
  db: Database.Database;
  registry: ProviderRegistry;
  fake: FakeProvider;
  search: FakeProvider;
  locations: LocationRepository;
  providerState: ProviderStateRepository;
  catalog: LocationCatalogService;
  events: Array<[EventName, unknown]>;
  clock: { now: Date };
  logger: MemoryLogger;
}

let current: Setup | undefined;

function setup(
  searchOptions: FakeSearchProviderOptions = {},
  timings: Partial<CatalogTimings> = {}
): Setup {
  const db = openDatabase(':memory:');
  const registry = new ProviderRegistry();
  const fake = createFakeProvider();
  const search = createFakeSearchProvider(searchOptions);
  registry.register(fake.factory, createTestProviderContext);
  registry.register(search.factory, createTestProviderContext);
  const locations = new LocationRepository(db);
  const providerState = new ProviderStateRepository(db);
  const events: Setup['events'] = [];
  const clock = { now: FIXED_NOW };
  const logger = createMemoryLogger();
  const catalog = new LocationCatalogService({
    registry,
    locations,
    providerState,
    events: { emit: (name, payload) => void events.push([name, payload]) },
    logger,
    clock: () => clock.now,
    timings,
  });
  current = {
    db,
    registry,
    fake,
    search,
    locations,
    providerState,
    catalog,
    events,
    clock,
    logger,
  };
  return current;
}

afterEach(async () => {
  if (!current) return;
  current.catalog.stop();
  await current.registry.disposeAll();
  closeDatabase(current.db);
  current = undefined;
});

const searchCalls = (p: FakeProvider, method = 'searchArea') =>
  p.calls.filter((c) => c.method === method);
const areaQueries = (p: FakeProvider): CatalogAreaQuery[] =>
  searchCalls(p).map((c) => c.args[0] as CatalogAreaQuery);
const later = (s: Setup, ms: number): void => {
  s.clock.now = new Date(s.clock.now.getTime() + ms);
};
const names = (items: LocationSummary[]): string[] => items.map((l) => l.name).sort();
/** `n` places a hundredth of a degree apart from (`lat`, `lng`), with ids `<prefix>-<i>`. */
const cluster = (prefix: string, lat: number, lng: number, n: number): FakeLocationSeed[] =>
  Array.from({ length: n }, (_, i) => ({
    externalId: `${prefix}-${i + 1}`,
    name: `${prefix} stay ${i + 1}`,
    lat: lat + i * 0.01,
    lng,
  }));
/** Exmouth: a third area, apart from Perth and the Kimberley. */
const EXMOUTH: BoundingBox = [113, -23, 115, -21];
const inBox =
  ([west, south, east, north]: BoundingBox) =>
  (q: CatalogAreaQuery) =>
    q.bbox[0] <= west && q.bbox[1] <= south && q.bbox[2] >= east && q.bbox[3] >= north;

/** Lets every background search finish (each FakeProvider call waits on a timer). */
async function idle(s: Setup): Promise<void> {
  const until = Date.now() + 5_000;
  while (s.catalog.status().providers.some((p) => p.syncing)) {
    if (Date.now() > until) throw new Error('A catalogue search is still running');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe('area search', () => {
  it('answers from storage at once with the provider pending, then stores what it finds and announces it', async () => {
    const s = setup();

    const first = s.catalog.search({ bbox: PERTH });

    expect(first).toMatchObject({ items: [], total: 0, pending: ['search'] });
    expect(s.catalog.status().providers.find((p) => p.providerId === 'search')?.syncing).toBe(true);
    await idle(s);
    expect(areaQueries(s.search)).toEqual([{ bbox: catalogSearchArea(PERTH).bbox }]);
    expect(names(s.catalog.search({ bbox: PERTH }).items)).toEqual([
      'Bilby Bungalow',
      'Quenda Cottage',
    ]);
    expect(s.events).toEqual([
      ['catalog:updated', { providerId: 'search', count: 2, syncedAt: FIXED_NOW.toISOString() }],
    ]);
    // The full-mode catalogue is never asked by a search
    expect(s.fake.calls).toEqual([]);
  });

  it('stores found places for FTS search, filters, facets and the place page, like synced ones', async () => {
    const s = setup();
    s.catalog.search({ bbox: SOUTH_WEST });
    await idle(s);

    expect(s.catalog.search({ text: 'karri' }).items.map((l) => l.key)).toEqual(['search:karri']);
    const filtered = s.catalog.search({ providerIds: ['search'], amenities: ['Toilets'] });
    expect(filtered.total).toBe(6);
    expect(filtered.facets?.providers).toEqual([{ value: 'search', count: 6 }]);
    await expect(s.catalog.get('search:karri')).resolves.toMatchObject({
      key: 'search:karri',
      name: 'Karri Loft',
      units: [{ unitId: 'u1' }, { unitId: 'u2' }],
    });
  });

  it('reuses an area within the TTL (and a small pan), and asks again after it', async () => {
    const s = setup();
    s.catalog.search({ bbox: PERTH });
    await idle(s);

    // The same area, and a pan of 0.02°: the same snapped area
    expect(s.catalog.search({ bbox: PERTH }).pending).toBeUndefined();
    const panned: BoundingBox = [115.62, -32.2, 116.12, -31.8];
    expect(catalogSearchArea(panned).key).toBe(catalogSearchArea(PERTH).key);
    s.catalog.search({ bbox: panned });
    later(s, HOUR - 1);
    s.catalog.search({ bbox: PERTH });
    await idle(s);
    expect(searchCalls(s.search)).toHaveLength(1);

    // The fake's catalogTtlHours is 1 h
    later(s, 1);
    expect(s.catalog.search({ bbox: PERTH }).pending).toEqual(['search']);
    await idle(s);
    expect(searchCalls(s.search)).toHaveLength(2);
    // Nothing new: no second event
    expect(s.events).toHaveLength(1);
  });

  it('does not ask for an area inside one already searched in full', async () => {
    const s = setup({ searchPageSize: 10 });
    s.catalog.search({ bbox: SOUTH_WEST });
    await idle(s);

    s.catalog.search({ bbox: PERTH });
    await idle(s);

    expect(searchCalls(s.search)).toHaveLength(1);
  });

  it('asks for an area inside one whose search stopped at the page cap', async () => {
    const s = setup({ locations: manyAround(-31.95, 115.86, 30) });
    s.catalog.search({ bbox: SOUTH_WEST });
    await idle(s);
    expect(searchCalls(s.search)).toHaveLength(AREA_SEARCH_MAX_PAGES);

    s.catalog.search({ bbox: PERTH });
    await idle(s);

    expect(areaQueries(s.search)[AREA_SEARCH_MAX_PAGES]).toEqual({
      bbox: catalogSearchArea(PERTH).bbox,
    });
  });

  it(`follows nextCursor for at most ${AREA_SEARCH_MAX_PAGES} pages`, async () => {
    const s = setup({ locations: manyAround(-31.95, 115.86, 30) });

    s.catalog.search({ bbox: PERTH });
    await idle(s);

    expect(areaQueries(s.search).map((q) => q.cursor)).toEqual([undefined, '2', '4', '6', '8']);
    expect(s.locations.countByProvider().search).toBe(10);
    expect(s.events).toEqual([
      ['catalog:updated', expect.objectContaining({ providerId: 'search', count: 10 })],
    ]);
  });

  it('stops when a cursor comes back unchanged', async () => {
    const s = setup();
    jest
      .spyOn(s.search.catalog!, 'searchArea')
      .mockResolvedValue({ items: [], nextCursor: 'again' });

    s.catalog.search({ bbox: PERTH });
    await idle(s);

    expect(s.search.catalog!.searchArea).toHaveBeenCalledTimes(2);
  });

  it('makes one search for concurrent requests of one area (single flight)', async () => {
    const s = setup({ delayMs: 5 });

    const results = [
      s.catalog.search({ bbox: PERTH }),
      s.catalog.search({ bbox: PERTH }),
      s.catalog.search({ bbox: PERTH, text: 'q' }),
    ];
    await idle(s);

    expect(results.map((r) => r.pending)).toEqual([['search'], ['search'], ['search']]);
    expect(searchCalls(s.search)).toHaveLength(1);
  });

  it("keeps the provider's search calls within its maxConcurrentRequests (2)", async () => {
    const s = setup({ delayMs: 5 });
    const boxes: BoundingBox[] = [
      PERTH,
      KIMBERLEY,
      [113, -29, 115, -27],
      [113, -23, 115, -21],
      [121, -35, 123, -33],
    ];

    for (const bbox of boxes) s.catalog.search({ bbox });
    await idle(s);

    expect(searchCalls(s.search)).toHaveLength(5);
    expect(s.search.peakInFlight('catalog')).toBe(2);
  });

  it('asks only the search catalogues a query covers, and nothing without an area or text', async () => {
    const s = setup();

    expect(s.catalog.search({ bbox: PERTH, providerIds: ['fake'] }).pending).toBeUndefined();
    expect(s.catalog.search({}).pending).toBeUndefined();
    expect(s.catalog.search({ providerIds: ['search'], kinds: ['cabin'] }).pending).toBeUndefined();
    await idle(s);

    expect(s.search.calls).toEqual([]);
  });

  it('never removes a found place: a later search or a sync leaves it', async () => {
    const s = setup();
    s.catalog.search({ bbox: PERTH });
    await idle(s);
    jest.spyOn(s.search.catalog!, 'searchArea').mockResolvedValue({ items: [] });

    s.catalog.search({ bbox: KIMBERLEY });
    await s.catalog.refresh();
    s.catalog.search({ bbox: PERTH });
    await idle(s);

    expect(s.search.catalog!.searchArea).toHaveBeenCalledTimes(2);
    expect(s.locations.countByProvider()).toEqual({ fake: 3, search: 2 });
  });
});

describe('areas the map has left', () => {
  const places = [
    ...cluster('perth', -31.95, 115.86, 6),
    ...cluster('broome', -17.96, 122.24, 6),
    ...cluster('exmouth', -21.93, 114.13, 6),
  ];

  it('stops a search that is no longer one of the 2 newest before its next page, keeping what it found', async () => {
    const s = setup({ locations: places, delayMs: 5 });

    for (const bbox of [PERTH, KIMBERLEY, EXMOUTH]) s.catalog.search({ bbox });
    await idle(s);

    const queries = areaQueries(s.search);
    expect(queries.filter(inBox(PERTH))).toHaveLength(1);
    expect(queries.filter(inBox(KIMBERLEY))).toHaveLength(3);
    expect(queries.filter(inBox(EXMOUTH))).toHaveLength(3);
    expect(s.locations.countByProvider().search).toBe(2 + 6 + 6);
    expect(s.events).toContainEqual([
      'catalog:updated',
      expect.objectContaining({ providerId: 'search', count: 2 }),
    ]);
  });

  it('asks a left area again only after 60 s, and then reads it all', async () => {
    const s = setup({ locations: places, delayMs: 5 });
    for (const bbox of [PERTH, KIMBERLEY, EXMOUTH]) s.catalog.search({ bbox });
    await idle(s);

    expect(s.catalog.search({ bbox: PERTH }).pending).toBeUndefined();
    later(s, 60_000);
    expect(s.catalog.search({ bbox: PERTH }).pending).toEqual(['search']);
    await idle(s);

    expect(areaQueries(s.search).filter(inBox(PERTH))).toHaveLength(1 + 3);
    expect(s.locations.countByProvider().search).toBe(18);
  });

  it('does not ask for an area inside one still being searched', async () => {
    const s = setup({ delayMs: 5 });

    s.catalog.search({ bbox: SOUTH_WEST });
    const inside = s.catalog.search({ bbox: PERTH });
    await idle(s);

    expect(inside.pending).toEqual(['search']);
    expect(areaQueries(s.search).every(inBox(SOUTH_WEST))).toBe(true);
    expect(names(s.catalog.search({ bbox: PERTH }).items)).toEqual([
      'Bilby Bungalow',
      'Quenda Cottage',
    ]);
  });
});

describe('failures and stopping', () => {
  it('records a failure in status, backs off for 60 s, and the next success clears it', async () => {
    const s = setup();
    s.search.failNext(
      'catalog',
      new ProviderHttpError({ providerId: 'search', status: 503, url: 'https://search.example/' })
    );

    s.catalog.search({ bbox: PERTH });
    await idle(s);
    const failed = s.catalog.status().providers.find((p) => p.providerId === 'search');
    expect(failed).toEqual({
      providerId: 'search',
      count: 0,
      stale: false,
      syncing: false,
      lastError: 'search: HTTP 503 from https://search.example/',
      search: { textSearch: false },
    });
    expect(s.events).toEqual([]);

    later(s, 59_999);
    expect(s.catalog.search({ bbox: PERTH }).pending).toBeUndefined();
    later(s, 1);
    expect(s.catalog.search({ bbox: PERTH }).pending).toEqual(['search']);
    await idle(s);

    expect(searchCalls(s.search)).toHaveLength(2);
    expect(s.catalog.status().providers.find((p) => p.providerId === 'search')).toEqual({
      providerId: 'search',
      count: 2,
      stale: false,
      syncing: false,
      search: { textSearch: false, searchedAt: s.clock.now.toISOString() },
    });
    expect(s.providerState.get('search', CATALOG_SEARCH_STATE_KEY)).toEqual({
      searchedAt: s.clock.now.toISOString(),
    });
  });

  it('a page that misses its deadline is a timeout, and a failure part-way stores nothing', async () => {
    const s = setup({ delays: { catalog: 50 } }, { searchTimeoutMs: 10 });

    s.catalog.search({ bbox: PERTH });
    await idle(s);

    expect(s.catalog.status().providers.find((p) => p.providerId === 'search')).toMatchObject({
      lastError: 'search: no answer within 10 ms',
      syncing: false,
    });
    expect(s.locations.countByProvider().search).toBeUndefined();
  });

  it('a page that fails after the first keeps the pages before it, records the error and backs off', async () => {
    const s = setup({ locations: cluster('perth', -31.95, 115.86, 6) });
    const searchArea = s.search.catalog!.searchArea!.bind(s.search.catalog);
    let calls = 0;
    jest.spyOn(s.search.catalog!, 'searchArea').mockImplementation((query, signal) =>
      ++calls === 3
        ? Promise.reject(
            new ProviderHttpError({
              providerId: 'search',
              status: 502,
              url: 'https://search.example/',
            })
          )
        : searchArea(query, signal)
    );

    s.catalog.search({ bbox: PERTH });
    await idle(s);

    expect(calls).toBe(3);
    expect(s.locations.countByProvider().search).toBe(4);
    expect(s.events).toEqual([
      ['catalog:updated', expect.objectContaining({ providerId: 'search', count: 4 })],
    ]);
    expect(s.catalog.status().providers.find((p) => p.providerId === 'search')).toMatchObject({
      lastError: 'search: HTTP 502 from https://search.example/',
    });
    expect(s.catalog.search({ bbox: PERTH }).pending).toBeUndefined();
    later(s, 60_000);
    expect(s.catalog.search({ bbox: PERTH }).pending).toEqual(['search']);
  });

  it(`remembers at most ${SEARCH_MEMORY_SIZE} searches: the next one forgets the oldest`, async () => {
    const s = setup({ textSearch: true });
    jest.spyOn(s.search.catalog!, 'searchText').mockResolvedValue([]);

    for (let i = 0; i <= SEARCH_MEMORY_SIZE; i++) s.catalog.search({ text: `place ${i}` });
    await idle(s);
    expect(s.search.catalog!.searchText).toHaveBeenCalledTimes(SEARCH_MEMORY_SIZE + 1);

    // place 0 was forgotten when place 500 was remembered; place 1 was not
    expect(s.catalog.search({ text: 'place 1' }).pending).toBeUndefined();
    expect(s.catalog.search({ text: 'place 0' }).pending).toEqual(['search']);
  });

  it('warns once when a search for everything matches more than the 5000 it returns', () => {
    const s = setup();
    const rows: LocationSummary[] = Array.from({ length: 5001 }, (_, i) => ({
      key: `fake:${i}`,
      providerId: 'fake',
      externalId: String(i),
      name: `Camp ${i}`,
      kind: 'campground',
      bookingMode: 'online',
      lat: -32,
      lng: 116,
      imageUrls: [],
      amenities: [],
    }));
    s.locations.upsertMany('fake', rows, FIXED_NOW);
    const capWarnings = () =>
      s.logger.lines.filter((l) => l.level === 'warn' && /more than the 5000/.test(l.message));

    s.catalog.search({ text: 'camp', limit: 20 });
    expect(capWarnings()).toEqual([]);
    expect(s.catalog.search({}).items).toHaveLength(5000);
    s.catalog.search({ limit: 5000 });

    expect(capWarnings().map((l) => l.message)).toEqual([
      'A catalogue search matched 5001 locations, more than the 5000 a search returns: Explore leaves some places out',
    ]);
  });

  it('stop() aborts a search in flight and queued ones, which then write nothing', async () => {
    const s = setup({ delayMs: 1_000 });
    for (const bbox of [PERTH, KIMBERLEY, SOUTH_WEST]) s.catalog.search({ bbox });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const started = searchCalls(s.search);
    expect(started).toHaveLength(2);

    s.catalog.stop();
    await new Promise((resolve) => setTimeout(resolve, 5));

    expect(started.every((c) => c.signal?.aborted)).toBe(true);
    expect(searchCalls(s.search)).toHaveLength(2);
    expect(s.locations.countByProvider()).toEqual({});
    expect(s.providerState.get('search', CATALOG_SEARCH_STATE_KEY)).toBeUndefined();
    expect(s.events).toEqual([]);
    // And no new search starts
    expect(s.catalog.search({ bbox: [113, -23, 115, -21] }).pending).toBeUndefined();
  });

  it('refresh() forgets the areas searched, so the next search asks again', async () => {
    const s = setup();
    s.catalog.search({ bbox: PERTH });
    await idle(s);

    await s.catalog.refresh('search');
    s.catalog.search({ bbox: PERTH });
    await idle(s);

    expect(searchCalls(s.search)).toHaveLength(2);
    expect(s.fake.calls).toEqual([]);
  });
});

describe('text search', () => {
  it('asks a provider with searchText once per text (any case), stores the matches and announces them', async () => {
    const s = setup({ textSearch: true });

    const result = s.catalog.search({ text: 'Bungalow', providerIds: ['search'] });
    expect(result).toMatchObject({ items: [], pending: ['search'] });
    await idle(s);
    s.catalog.search({ text: '  bungalow ' });
    await idle(s);

    expect(searchCalls(s.search, 'searchText').map((c) => c.args)).toEqual([['Bungalow']]);
    expect(s.catalog.search({ text: 'bungalow' }).items.map((l) => l.key)).toEqual([
      'search:bilby',
    ]);
    expect(s.events).toEqual([
      ['catalog:updated', expect.objectContaining({ providerId: 'search', count: 1 })],
    ]);
    expect(s.catalog.status().providers.find((p) => p.providerId === 'search')?.search).toEqual({
      textSearch: true,
      searchedAt: FIXED_NOW.toISOString(),
    });
  });

  it('needs 3 characters, and stores at most 100 matches', async () => {
    const s = setup({ textSearch: true, locations: manyAround(-31.95, 115.86, 150) });

    expect(s.catalog.search({ text: 'ne' }).pending).toBeUndefined();
    s.catalog.search({ text: 'Nearby' });
    await idle(s);

    expect(searchCalls(s.search, 'searchText')).toHaveLength(1);
    expect(s.locations.countByProvider().search).toBe(TEXT_SEARCH_MAX_ITEMS);
  });

  it('without searchText, text finds only places already stored, and asks nothing', async () => {
    const s = setup();
    s.catalog.search({ bbox: PERTH });
    await idle(s);

    const result = s.catalog.search({ text: 'cottage', providerIds: ['search'] });

    expect(result.pending).toBeUndefined();
    expect(result.items.map((l) => l.key)).toEqual(['search:quenda']);
    expect(s.catalog.search({ text: 'karri', providerIds: ['search'] }).total).toBe(0);
    expect(s.search.calls.map((c) => c.method)).toEqual(['searchArea']);
    expect(s.catalog.status().providers.find((p) => p.providerId === 'search')?.search).toEqual({
      textSearch: false,
      searchedAt: FIXED_NOW.toISOString(),
    });
  });
});
