/**
 * Any number of providers (DX1): a real container with ParkStay and a second provider, passed
 * through `providerFactories`, every handler registered, and ParkStay answering from the e2e
 * fixtures (fixture mode: `tests/e2e/fixtures/http/parkstay`, its 11 campgrounds). The second
 * provider is a FakeProvider whose name sorts before ParkStay's, with every capability and an
 * optional account, so it shows up in every list ParkStay is in.
 *
 * The key reads over IPC (`providers.list`, `catalog.search`, `accounts.list`) answer for both
 * providers, and filtered to ParkStay they equal what a container with ParkStay alone answers.
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
  ProviderAccount,
} from '@shared/types';
import type { ProviderManifest } from '@shared/types/provider.types';
import { createFakeProvider, type FakeProvider } from '@tests/utils/fake-provider';
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
      status: 'unknown',
    });
  });
});
