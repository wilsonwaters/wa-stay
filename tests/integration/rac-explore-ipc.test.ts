/**
 * Explore's free counts for ParkStay and RAC together, through the IPC layer: a container with
 * both providers in fixture mode (`tests/e2e/fixtures/http/`, unpaced, nothing sent anywhere),
 * every handler registered on a fake ipcMain, and `catalog:availability` invoked as the
 * renderer does. Both providers' entries come back, RAC's free units with no total; a second
 * call for the same stay within 5 minutes is answered from the core's cache and sends RAC
 * nothing (terms rule 2).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { createContainer, type AppContainer } from '@main/app/container';
import { createAppUrlMatcher } from '@main/app/renderer-entry';
import { openDatabase } from '@main/database/connection';
import { registerIpcHandlers } from '@main/ipc';
import { createSenderGuard } from '@main/ipc/sender-guard';
import { parkstayFactory } from '@main/providers/parkstay';
import { racFactory } from '@main/providers/rac';
import { FixtureHttpClient, readUnexpectedRequests } from '@main/testing';
import type { APIResponse } from '@shared/types';
import type { CatalogAvailabilityResult } from '@shared/types/catalog.types';
import { containerSecrets } from '@tests/utils/fake-safe-storage';
import {
  APP_INDEX_PATH,
  FakeIpcMain,
  fakeEvent,
  fakeWebContents,
  TEST_LOGS_DIR,
  TRUSTED_SENDER_ID,
} from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };

const FIXTURES_DIR = path.join(__dirname, '../e2e/fixtures/http');
/** The day the recorded answers cover: 6–8 Nov 2026, two adults. */
const STAY = { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 };

describe('catalog:availability with ParkStay and RAC', () => {
  let dir: string;
  let container: AppContainer;
  let ipc: FakeIpcMain;
  /** Every request a provider's fixture client was asked, by provider. */
  let asked: Array<{ providerId: string; method: string; url: string }>;

  const call = <T>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
  const racPosts = () => asked.filter((r) => r.providerId === 'rac' && r.method === 'POST');

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-rac-explore-'));
    asked = [];
    const request = FixtureHttpClient.prototype.request;
    jest.spyOn(FixtureHttpClient.prototype, 'request').mockImplementation(function (
      this: FixtureHttpClient,
      method,
      url,
      options
    ) {
      asked.push({ providerId: this.providerId, method, url });
      return request.call(this, method, url, options);
    });
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
      fixtureMode: { fixturesDir: FIXTURES_DIR, logFile: path.join(dir, 'unexpected.log') },
      providerFactories: [parkstayFactory, racFactory],
    });
    container.trustedWebContents.register(fakeWebContents(TRUSTED_SENDER_ID));
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, {
      isTrustedSender: createSenderGuard({
        isTrustedWebContents: (id) => container.trustedWebContents.isTrusted(id),
        isAppUrl: createAppUrlMatcher({ kind: 'file', path: APP_INDEX_PATH }),
      }),
      ipc,
    });
    // The catalogues, as the app syncs them at start-up (RAC's is its seed: nothing sent)
    expect(await call('catalog:refresh', {})).toMatchObject({ success: true });
    expect(racPosts()).toHaveLength(0);
  });

  afterEach(async () => {
    await container.dispose();
    autoUpdater.removeAllListeners();
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns both providers' entries: ParkStay's N of M, RAC's free units with no total", async () => {
    const answer = await call<CatalogAvailabilityResult>('catalog:availability', { stay: STAY });

    expect(answer.success).toBe(true);
    const { entries, errors } = answer.data!;
    expect(errors).toEqual([]);
    const parkstay = entries.filter((entry) => entry.key.startsWith('parkstay:'));
    const rac = entries.filter((entry) => entry.key.startsWith('rac:'));
    expect(parkstay.length).toBeGreaterThan(0);
    for (const entry of parkstay) expect(entry.bookableUnits).toEqual(expect.any(Number));
    expect(rac.map((entry) => entry.key)).toEqual([
      'rac:busselton',
      'rac:cable-beach',
      'rac:cervantes',
      'rac:esperance',
      'rac:margaret-river',
      'rac:exmouth',
      'rac:karri-valley',
      'rac:monkey-mia',
    ]);
    expect(rac[0]).toEqual({
      key: 'rac:busselton',
      availableUnits: 51,
      byKind: { campsite: { availableUnits: 51 }, cabin: { availableUnits: 0, bookableUnits: 0 } },
    });
    expect(rac[0]).not.toHaveProperty('bookableUnits');
    // One POST per park, and nothing fixture mode had no route for
    expect(racPosts()).toHaveLength(8);
    expect(readUnexpectedRequests(path.join(dir, 'unexpected.log'))).toEqual([]);
  });

  it('a second call for the same stay within 5 minutes sends RAC nothing', async () => {
    const first = await call<CatalogAvailabilityResult>('catalog:availability', { stay: STAY });
    expect(racPosts()).toHaveLength(8);

    const second = await call<CatalogAvailabilityResult>('catalog:availability', {
      stay: STAY,
      providerIds: ['rac'],
    });
    expect(second.data?.entries).toEqual(
      first.data?.entries.filter((entry) => entry.key.startsWith('rac:'))
    );
    expect(racPosts()).toHaveLength(8);

    // Another party is another answer: RAC's depends on it
    await call('catalog:availability', { stay: { ...STAY, adults: 3 }, providerIds: ['rac'] });
    expect(racPosts()).toHaveLength(16);
  });
});
