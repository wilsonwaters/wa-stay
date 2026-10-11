/**
 * DX2: a search-mode catalogue (`catalogMode: 'search'`) end to end through P3's IPC harness
 * on a real container, beside the built-in ParkStay: Explore's `catalog.search` with a map
 * area asks the provider, stores what it finds and tells the window (`catalog:updated`); the
 * same area within the TTL asks nothing; paging is capped; disposing aborts a search in
 * flight; a found place works with `catalog.get`, `catalog.checkLocation` and
 * `watches.create`; and a text search asks a provider with `searchText` and not one without.
 */

import { createContainer, type AppContainer } from '@main/app/container';
import { AREA_SEARCH_MAX_PAGES } from '@main/core/catalog/location-catalog.service';
import { openDatabase } from '@main/database/connection';
import { registerIpcHandlers } from '@main/ipc';
import { parkstayFactory } from '@main/providers/parkstay';
import type {
  APIResponse,
  BoundingBox,
  CatalogSearchResult,
  CatalogStatus,
  LocationAvailability,
  LocationDetail,
  Watch,
} from '@shared/types';
import { createTestProviderContext, type FakeProvider } from '@tests/utils/fake-provider';
import {
  createFakeSearchProvider,
  manyAround,
  type FakeSearchProviderOptions,
} from '@tests/utils/fake-search-provider';
import { containerSecrets, removeUserData } from '@tests/utils/fake-safe-storage';
import {
  FakeIpcMain,
  fakeEvent,
  fakeWebContents,
  TEST_LOGS_DIR,
  TRUSTED_SENDER_ID,
  type FakeWebContents,
} from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

/** All of WA, as Explore asks without a map. */
const WA: BoundingBox = [112.9, -35.2, 129, -13.7];
/** Perth and Fremantle: Quenda Cottage and Bilby Bungalow. */
const PERTH: BoundingBox = [115.6, -32.2, 116.1, -31.8];
const STAY = { arrival: '2099-12-01', departure: '2099-12-03', adults: 2 };

describe('a search-mode catalogue over IPC (real container, with ParkStay)', () => {
  let container: AppContainer;
  let ipc: FakeIpcMain;
  let mainWindow: FakeWebContents;
  let userDataDir: string;
  let search: FakeProvider;

  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
  const areaCalls = () => search.calls.filter((c) => c.method === 'searchArea');
  const updates = () => mainWindow.sent.filter(([channel]) => channel === 'catalog:updated');

  /** Waits until main reports no search in flight. */
  async function searchesDone(): Promise<void> {
    const until = Date.now() + 5_000;
    while (Date.now() <= until) {
      const status = await call<CatalogStatus>('catalog:status');
      if (!status.data?.providers.some((p) => p.syncing)) return;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    throw new Error('A catalogue search is still running');
  }

  function build(options: FakeSearchProviderOptions = {}): void {
    const secrets = containerSecrets();
    userDataDir = secrets.userDataDir;
    // ParkStay alone (with no network here) plus the fake, however many providers are built in
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...secrets,
      providerFactories: [parkstayFactory],
    });
    search = createFakeSearchProvider(options);
    container.providers.register(search.factory, createTestProviderContext);
    container.profile.ensureLocalProfile();
    mainWindow = fakeWebContents(TRUSTED_SENDER_ID);
    container.trustedWebContents.register(mainWindow);
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
  }

  afterEach(async () => {
    await container.dispose();
    removeUserData(userDataDir);
  });

  it("Explore's search with a map area asks the provider, stores its places and tells the window; ParkStay is not asked", async () => {
    build({ searchPageSize: 12 });

    const first = await call<CatalogSearchResult>('catalog:search', { bbox: WA });
    expect(first).toMatchObject({
      success: true,
      data: { items: [], total: 0, pending: ['search'] },
    });
    await searchesDone();

    expect(areaCalls()).toHaveLength(1);
    const again = await call<CatalogSearchResult>('catalog:search', {});
    expect(again.data!.total).toBe(12);
    expect(again.data!.pending).toBeUndefined();
    expect(updates()).toEqual([
      ['catalog:updated', { providerId: 'search', count: 12, syncedAt: expect.any(String) }],
    ]);
    const status = await call<CatalogStatus>('catalog:status');
    const byId = [...status.data!.providers].sort((a, b) =>
      a.providerId.localeCompare(b.providerId)
    );
    expect(byId).toEqual([
      { providerId: 'parkstay', count: 0, stale: true, syncing: false },
      {
        providerId: 'search',
        count: 12,
        stale: false,
        syncing: false,
        search: { textSearch: false, searchedAt: expect.any(String) },
      },
    ]);
    // Plain data over IPC
    expect(structuredClone(first)).toEqual(first);
  });

  it('a second search of the same area within the TTL does not ask the provider again', async () => {
    build();
    await call('catalog:search', { bbox: PERTH });
    await searchesDone();

    const second = await call<CatalogSearchResult>('catalog:search', { bbox: PERTH });
    await call('catalog:search', { bbox: [115.62, -32.18, 116.12, -31.78] });
    await searchesDone();

    expect(second.data).toMatchObject({ total: 2 });
    expect(second.data!.pending).toBeUndefined();
    expect(areaCalls()).toHaveLength(1);
    expect(updates()).toHaveLength(1);
  });

  it(`caps an area search at ${AREA_SEARCH_MAX_PAGES} pages`, async () => {
    build({ locations: manyAround(-31.95, 115.86, 40) });

    await call('catalog:search', { bbox: PERTH });
    await searchesDone();

    expect(areaCalls()).toHaveLength(AREA_SEARCH_MAX_PAGES);
    const stored = await call<CatalogSearchResult>('catalog:search', { providerIds: ['search'] });
    expect(stored.data!.total).toBe(AREA_SEARCH_MAX_PAGES * 2);
  });

  it('disposing the container aborts an area search in flight, which writes nothing', async () => {
    build({ delayMs: 60_000 });
    await call('catalog:search', { bbox: PERTH });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const [inFlight] = areaCalls();
    expect(inFlight.signal?.aborted).toBe(false);

    const started = Date.now();
    await container.dispose();

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(inFlight.signal?.aborted).toBe(true);
    expect(areaCalls()).toHaveLength(1);
    expect(updates()).toEqual([]);
  });

  it('a found place has a detail, checks a stay and can be watched', async () => {
    build();
    await call('catalog:search', { bbox: PERTH });
    await searchesDone();

    const detail = await call<LocationDetail>('catalog:get', { key: 'search:quenda' });
    expect(detail).toMatchObject({
      success: true,
      data: {
        key: 'search:quenda',
        name: 'Quenda Cottage',
        units: [{ unitId: 'u1' }, { unitId: 'u2' }],
      },
    });
    const check = await call<LocationAvailability>('catalog:check-location', {
      key: 'search:quenda',
      stay: STAY,
    });
    expect(check).toMatchObject({
      success: true,
      data: {
        key: 'search:quenda',
        units: [{ unitId: 'u1', fullyAvailable: true }, { unitId: 'u2' }],
      },
    });
    const watch = await call<Watch>('watches:create', {
      providerId: 'search',
      name: 'Quenda',
      location: { externalId: 'quenda', name: 'Quenda Cottage' },
      stay: STAY,
      checkIntervalMinutes: 30,
    });
    expect(watch).toMatchObject({
      success: true,
      data: { providerId: 'search', location: { externalId: 'quenda', name: 'Quenda Cottage' } },
    });
    // A place never found is not in the catalogue
    expect(await call('catalog:get', { key: 'search:karri' })).toMatchObject({
      success: false,
      code: 'NOT_FOUND',
    });
  });

  it("a text search asks a provider with searchText and stores its matches (the watch flow's location step)", async () => {
    build({ textSearch: true });
    const query = { text: 'loft', providerIds: ['search'], limit: 20, sort: 'relevance' };

    const first = await call<CatalogSearchResult>('catalog:search', query);
    await searchesDone();
    const second = await call<CatalogSearchResult>('catalog:search', query);

    expect(first.data).toMatchObject({ total: 0, pending: ['search'] });
    expect(search.calls.filter((c) => c.method === 'searchText').map((c) => c.args)).toEqual([
      ['loft'],
    ]);
    expect(second.data).toMatchObject({ total: 1, items: [{ key: 'search:karri' }] });
    expect(second.data!.pending).toBeUndefined();
    expect(updates()).toEqual([
      ['catalog:updated', { providerId: 'search', count: 1, syncedAt: expect.any(String) }],
    ]);
  });

  it('without searchText, a text search finds only the places seen so far and asks nothing', async () => {
    build();
    await call('catalog:search', { bbox: PERTH });
    await searchesDone();

    const seen = await call<CatalogSearchResult>('catalog:search', {
      text: 'bungalow',
      providerIds: ['search'],
    });
    const unseen = await call<CatalogSearchResult>('catalog:search', {
      text: 'loft',
      providerIds: ['search'],
    });

    expect(seen.data).toMatchObject({ total: 1, items: [{ key: 'search:bilby' }] });
    expect(unseen.data).toMatchObject({ total: 0, items: [] });
    expect(unseen.data!.pending).toBeUndefined();
    expect(search.calls.map((c) => c.method)).toEqual(['searchArea']);
    const status = await call<CatalogStatus>('catalog:status');
    expect(status.data!.providers.find((p) => p.providerId === 'search')!.search).toMatchObject({
      textSearch: false,
    });
  });
});
