/**
 * Any number of providers (DX1): a real container with ParkStay and a second provider, passed
 * through `providerFactories`, every handler registered, and ParkStay answering from the e2e
 * fixtures (fixture mode: `tests/e2e/fixtures/http/parkstay`, its 11 campgrounds). The second
 * provider is a FakeProvider whose name sorts before ParkStay's, with every capability and an
 * optional account, so it shows up in every list ParkStay is in.
 *
 * The key reads over IPC (`providers.list`, `catalog.search`, `accounts.list`) answer for both
 * providers, and filtered to ParkStay they equal what a container with ParkStay alone answers.
 * Each provider's watch carries its own booking link (R7), and a provider's stay rules (R8)
 * and split stays touch only its own watches.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { createContainer, type AppContainer } from '@main/app/container';
import { openDatabase } from '@main/database/connection';
import { registerIpcHandlers } from '@main/ipc';
import { parkstayFactory } from '@main/providers/parkstay';
import type { ProviderFactory } from '@main/providers/sdk';
import type {
  APIResponse,
  CatalogQuery,
  CatalogSearchResult,
  CatalogStatus,
  Notification,
  ProviderAccount,
  Watch,
  WatchInput,
} from '@shared/types';
import type { ProviderManifest } from '@shared/types/provider.types';
import { fakeDateOnly } from '@tests/utils/core-harness';
import { createFakeProvider, FIXED_NOW, type FakeProvider } from '@tests/utils/fake-provider';
import { containerSecrets, removeUserData } from '@tests/utils/fake-safe-storage';
import { FakeIpcMain, fakeEvent, TEST_LOGS_DIR } from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };

/** ParkStay's recorded responses, as the Electron smoke tests use them. */
const HTTP_FIXTURES_DIR = path.resolve(__dirname, '..', 'e2e', 'fixtures', 'http');
/** The campgrounds in ParkStay's catalogue fixture (`campground_map.json`). */
const PARKSTAY_PLACES = 11;

interface World {
  container: AppContainer;
  /** Invokes a read as the renderer would; it must succeed. Its data. */
  read<T>(channel: string, payload?: unknown): Promise<T>;
}

describe('a container with ParkStay and a second provider', () => {
  const worlds: World[] = [];
  const dirs: string[] = [];
  let second: FakeProvider;

  /** A container with `factories`, its handlers registered and every catalogue synced. */
  async function world(factories: readonly ProviderFactory[]): Promise<World> {
    const secrets = containerSecrets();
    dirs.push(secrets.userDataDir);
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-two-providers-'));
    dirs.push(logDir);
    const container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...secrets,
      fixtureMode: {
        fixturesDir: HTTP_FIXTURES_DIR,
        logFile: path.join(logDir, 'e2e-unexpected-requests.log'),
      },
      providerFactories: factories,
    });
    container.profile.ensureLocalProfile();
    const ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
    const read = async <T>(channel: string, payload?: unknown): Promise<T> => {
      const response = (await ipc.invoke(channel, fakeEvent(), payload)) as APIResponse<T>;
      expect({ channel, success: response.success }).toEqual({ channel, success: true });
      return response.data as T;
    };
    const created: World = { container, read };
    worlds.push(created);
    // Every catalogue provider, as the 24 h sync would
    const status = await read<CatalogStatus>('catalog:refresh', {});
    expect(status.providers.filter((p) => p.lastError)).toEqual([]);
    return created;
  }

  beforeEach(() => {
    second = createFakeProvider({
      id: 'bush-camps',
      name: 'Bush Camps WA',
      shortName: 'Bush Camps',
      account: 'signed-out',
    });
  });

  afterEach(async () => {
    await Promise.all(worlds.splice(0).map((w) => w.container.dispose()));
    dirs.splice(0).forEach(removeUserData);
    autoUpdater.removeAllListeners();
    jest.useRealTimers();
  });

  it('providers.list() lists both, and ParkStay as it is alone', async () => {
    const both = await world([parkstayFactory, second.factory]);
    const alone = await world([parkstayFactory]);

    const manifests = await both.read<ProviderManifest[]>('providers:list');
    // Sorted by name
    expect(manifests.map((m) => m.id)).toEqual(['bush-camps', 'parkstay']);
    expect(manifests.filter((m) => m.id === 'parkstay')).toEqual(
      await alone.read<ProviderManifest[]>('providers:list')
    );
    expect(manifests.find((m) => m.id === 'parkstay')).toMatchObject({
      name: 'ParkStay WA',
      currency: 'AUD',
      capabilities: { catalogMode: 'full', account: 'optional' },
    });
  });

  it("catalog.search() finds both providers' places, and ParkStay's as it does alone", async () => {
    const both = await world([parkstayFactory, second.factory]);
    const alone = await world([parkstayFactory]);
    const search = (w: World, query: CatalogQuery = {}) =>
      w.read<CatalogSearchResult>('catalog:search', query);
    // The provider facet counts every provider whatever the provider filter (the Provider chip
    // offers the others), so it is compared on its own
    const exceptProviderFacet = ({ facets, ...rest }: CatalogSearchResult) => {
      const { providers: _providers, ...others } = facets ?? { providers: [] };
      return { ...rest, facets: others };
    };
    const parkstay: CatalogQuery = { providerIds: ['parkstay'] };

    const all = await search(both);
    expect(all.total).toBe(PARKSTAY_PLACES + 3);
    expect(all.facets?.providers).toEqual(
      expect.arrayContaining([
        { value: 'parkstay', count: PARKSTAY_PLACES },
        { value: 'bush-camps', count: 3 },
      ])
    );
    expect(new Set(all.items.map((item) => item.providerId))).toEqual(
      new Set(['parkstay', 'bush-camps'])
    );

    // Filtered to ParkStay: its 11 campgrounds, facets and order, exactly as when it is alone
    const filtered = await search(both, parkstay);
    expect(filtered.total).toBe(PARKSTAY_PLACES);
    expect(exceptProviderFacet(filtered)).toEqual(exceptProviderFacet(await search(alone)));
    expect(filtered.facets?.providers).toEqual(all.facets?.providers);
    for (const query of [
      { text: 'bung' },
      { regions: ['Pilbara'] },
      { bookingModes: ['online' as const] },
    ]) {
      expect(exceptProviderFacet(await search(both, { ...parkstay, ...query }))).toEqual(
        exceptProviderFacet(await search(alone, { ...parkstay, ...query }))
      );
    }
    const bungarra = await search(both, { text: 'bungarra' });
    expect(bungarra.items.map((item) => item.key)).toEqual(['parkstay:20']);
    const pilbara = await search(both, { ...parkstay, regions: ['Pilbara'] });
    expect(pilbara.total).toBe(3);
  });

  it("accounts.list() has both providers' accounts, and ParkStay's as it is alone", async () => {
    const both = await world([parkstayFactory, second.factory]);
    const alone = await world([parkstayFactory]);

    const accounts = await both.read<ProviderAccount[]>('accounts:list');
    expect(accounts.map((account) => account.providerId)).toEqual(['bush-camps', 'parkstay']);
    expect(accounts.filter((account) => account.providerId === 'parkstay')).toEqual(
      await alone.read<ProviderAccount[]>('accounts:list')
    );
    expect(accounts.find((account) => account.providerId === 'parkstay')).toEqual({
      providerId: 'parkstay',
      requirement: 'optional',
      authKind: 'browser-session',
      status: 'unknown',
    });
  });

  it("each provider's watch carries its own booking link: the second's unit link, ParkStay's search page", async () => {
    // 2 Oct 2026: the recorded Bungarra stay, 10–12 Nov, is ahead
    fakeDateOnly(FIXED_NOW);
    second = createFakeProvider({
      id: 'bush-camps',
      name: 'Bush Camps WA',
      shortName: 'Bush Camps',
      account: 'signed-out',
      unitBookingUrls: true,
    });
    const both = await world([parkstayFactory, second.factory]);
    const stay = { arrival: '2026-11-10', departure: '2026-11-12', adults: 1 };
    const watchFor = async (input: WatchInput): Promise<Watch> => {
      const watch = await both.read<Watch>('watches:create', input);
      await both.read('watches:run-now', { id: watch.id });
      return both.read<Watch>('watches:get', { id: watch.id });
    };

    const bush = await watchFor({
      providerId: 'bush-camps',
      name: 'Banksia',
      location: { externalId: '1', name: 'Banksia Camp' },
      stay,
    });
    const bungarra = await watchFor({
      providerId: 'parkstay',
      name: 'Bungarra',
      location: { externalId: '20', name: 'Bungarra' },
      stay,
      stayParams: { gearType: 'all' },
    });

    expect(bush.bookingLink).toEqual({
      url: 'https://book.bush-camps.example/1/u1?arrival=2026-11-10&departure=2026-11-12',
      arrival: '2026-11-10',
      departure: '2026-11-12',
    });
    expect(bungarra.bookingLink).toEqual({
      url: 'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20&arrival=2026/11/10&departure=2026/11/12',
      arrival: '2026-11-10',
      departure: '2026-11-12',
    });
    const listed = await both.read<Watch[]>('watches:list', {});
    expect(listed.map((w) => [w.providerId, w.bookingLink?.url])).toEqual([
      ['bush-camps', bush.bookingLink?.url],
      ['parkstay', bungarra.bookingLink?.url],
    ]);
  });

  it("each provider's alerts name its units (R9): mixed units are spots, ParkStay's sites", async () => {
    fakeDateOnly(FIXED_NOW);
    // u1 says no kind, u2 is a cabin: both free
    second = createFakeProvider({
      id: 'bush-camps',
      name: 'Bush Camps WA',
      shortName: 'Bush Camps',
      account: 'signed-out',
      availability: { '1': { u1: 'available', u2: 'available' } },
      unitKinds: { u2: 'cabin' },
    });
    const both = await world([parkstayFactory, second.factory]);
    const stay = { arrival: '2026-11-10', departure: '2026-11-12', adults: 1 };
    const run = async (input: WatchInput): Promise<void> => {
      const watch = await both.read<Watch>('watches:create', input);
      await both.read('watches:run-now', { id: watch.id });
    };
    const banksia = { externalId: '1', name: 'Banksia Camp' };

    await run({ providerId: 'bush-camps', name: 'Any', location: banksia, stay });
    // The unit found says no kind: the provider's default (its first location kind, campground)
    await run({ providerId: 'bush-camps', name: 'u1', location: banksia, stay, unitIds: ['u1'] });
    await run({
      providerId: 'parkstay',
      name: 'Bungarra',
      location: { externalId: '20', name: 'Bungarra' },
      stay,
      stayParams: { gearType: 'all' },
    });

    const listed = await both.read<Notification[]>('notifications:list', {});
    expect(
      listed
        .sort((a, b) => a.id - b.id)
        .map((n) => [n.providerId, n.title, n.message.replace(/ for .*/, '')])
    ).toEqual([
      ['bush-camps', 'Spots available at Banksia Camp', 'Found 2 spots available at Banksia Camp'],
      ['bush-camps', 'Sites available at Banksia Camp', 'Found 1 site available at Banksia Camp'],
      ['parkstay', 'Sites available at Bungarra', 'Found 3 sites available at Bungarra'],
    ]);
  });

  it("a watch over stay-rule refusals stays NOT_FOUND, and ParkStay's watch is unaffected", async () => {
    fakeDateOnly(FIXED_NOW);
    // Room every night, but a 2-night stay refused under a 3-night minimum
    const refused = { state: 'unknown', reason: 'min-stay', minNights: 3 } as const;
    second = createFakeProvider({
      id: 'bush-camps',
      name: 'Bush Camps WA',
      shortName: 'Bush Camps',
      account: 'signed-out',
      availability: { '1': { u1: [refused, refused], u2: [refused, refused] } },
    });
    const stay = { arrival: '2026-11-10', departure: '2026-11-12', adults: 1 };
    const bungarra: WatchInput = {
      providerId: 'parkstay',
      name: 'Bungarra',
      location: { externalId: '20', name: 'Bungarra' },
      stay,
      stayParams: { gearType: 'all' },
      allowPartialMatch: true,
    };
    const watchIn = async (w: World, input: WatchInput): Promise<Watch> => {
      const watch = await w.read<Watch>('watches:create', input);
      await w.read('watches:run-now', { id: watch.id });
      return w.read<Watch>('watches:get', { id: watch.id });
    };

    const both = await world([parkstayFactory, second.factory]);
    const bush = await watchIn(both, {
      providerId: 'bush-camps',
      name: 'Banksia',
      location: { externalId: '1', name: 'Banksia Camp' },
      stay,
      allowPartialMatch: true,
    });
    expect(bush).toMatchObject({ lastResult: 'not_found', foundCount: 0 });
    expect(bush.bookingLink).toBeUndefined();
    expect(bush.lastAvailability?.flatMap((u) => u.nights.map((n) => n.reason))).toEqual([
      'min-stay',
      'min-stay',
      'min-stay',
      'min-stay',
    ]);

    const withBoth = await watchIn(both, bungarra);
    const alone = await watchIn(await world([parkstayFactory]), bungarra);
    const outcome = (w: Watch) => [w.lastResult, w.foundCount, w.bookingLink, w.lastAvailability];
    expect(outcome(withBoth)).toEqual(outcome(alone));
    expect(withBoth.lastResult).not.toBe('not_found');
  });

  it("a provider's split stay gives its watch SPLIT_FOUND with the place's contact page, and ParkStay's watch is unaffected", async () => {
    fakeDateOnly(FIXED_NOW);
    // A category free both nights, but on no one site for both: its provider says to contact
    const split = { state: 'unknown', reason: 'split', price: 45 } as const;
    second = createFakeProvider({
      id: 'bush-camps',
      name: 'Bush Camps WA',
      shortName: 'Bush Camps',
      account: 'signed-out',
      contactLinks: true,
      availability: { '1': { cat: [split, split] } },
      unitKinds: { cat: 'campsite' },
      splitStays: { cat: { booking: 'contact' } },
    });
    const stay = { arrival: '2026-11-10', departure: '2026-11-12', adults: 1 };
    const bungarra: WatchInput = {
      providerId: 'parkstay',
      name: 'Bungarra',
      location: { externalId: '20', name: 'Bungarra' },
      stay,
      stayParams: { gearType: 'all' },
      allowSplitStay: true,
    };
    const watchIn = async (w: World, input: WatchInput): Promise<Watch> => {
      const watch = await w.read<Watch>('watches:create', input);
      await w.read('watches:run-now', { id: watch.id });
      return w.read<Watch>('watches:get', { id: watch.id });
    };

    const both = await world([parkstayFactory, second.factory]);
    const bush = await watchIn(both, {
      providerId: 'bush-camps',
      name: 'Banksia',
      location: { externalId: '1', name: 'Banksia Camp' },
      stay,
      allowSplitStay: true,
    });
    expect(bush).toMatchObject({ lastResult: 'split_found', foundCount: 1, isActive: false });
    expect(bush.bookingLink).toBeUndefined();
    expect(bush.splitStays).toEqual([
      {
        unitKind: 'campsite',
        booking: 'contact',
        unitId: 'cat',
        unitName: 'Site cat',
        total: 90,
        contactUrl: 'https://bush-camps.example/locations/1/contact',
      },
    ]);
    const [alert] = await both.read<Notification[]>('notifications:list', {});
    expect(alert).toMatchObject({
      providerId: 'bush-camps',
      title: 'Free if you move sites at Banksia Camp',
      message: expect.stringMatching(/^Every night from .* is free at Banksia Camp \(Site cat\)/),
    });
    // The contact page goes to the email only, never into the stored alert
    expect(JSON.stringify(alert)).not.toContain('/contact');

    const withBoth = await watchIn(both, bungarra);
    const alone = await watchIn(await world([parkstayFactory]), bungarra);
    const outcome = (w: Watch) => [
      w.lastResult,
      w.foundCount,
      w.bookingLink,
      w.splitStays,
      w.lastAvailability,
    ];
    expect(outcome(withBoth)).toEqual(outcome(alone));
    expect(withBoth.lastResult).toBe('found');
    expect(withBoth.splitStays).toBeUndefined();
  });
});
