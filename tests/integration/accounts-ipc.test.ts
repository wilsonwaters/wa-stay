/**
 * The `accounts` namespace through P3's harness: a real container (ParkStay alone, however many
 * providers are built in, with its real sign-in definition), every handler registered through
 * handle(),
 * provider windows on the mocked `electron` (`FakeBrowserWindow`), and ParkStay's
 * `/api/profile` answer stubbed at `auth.isSignedIn` (no network in tests).
 *
 * - `accounts.list` on the v8-migrated v5 fixture: ParkStay, `optional`, `unknown`, with the
 *   fixture email as a hint; a provider with no accounts is left out;
 * - `accounts.status`: a definite answer is stored and announced once (`account:updated`);
 * - sign-in: `/login-success/` confirmed by a check resolves `accounts.signIn` and closes the
 *   window; closing it first, or closing the main window, resolves with the stored status;
 * - pasted sign-in links: only on ParkStay's sign-in origins (`VALIDATION` otherwise);
 * - sign-out: `ACCOUNT_BUSY` while a snipe needs the session; otherwise the partition is
 *   cleared once, and the profile row and its watches stay.
 */

import { EventEmitter } from 'events';
import type Database from 'better-sqlite3';
import type { BrowserWindow } from 'electron';
import { openDatabase } from '@main/database/connection';
import { createContainer, AppContainer } from '@main/app/container';
import { registerIpcHandlers } from '@main/ipc';
import { parkstayFactory } from '@main/providers/parkstay';
import { SnipeStatus } from '@shared/types/common.types';
import type { AccountStatus, ProviderAccount } from '@shared/types/provider.types';
import type { APIResponse } from '@shared/types';
import { FIXTURE_MACHINE_ID } from '@tests/fixtures/db/constants';
import { createMockSiteSnipeInput } from '@tests/fixtures/site-sniper';
import { createMockWatchInput } from '@tests/fixtures/watches';
import { disposeFixture, loadFixture } from '@tests/utils/database-helper';
import type { FakeBrowserWindow } from '@tests/utils/electron-mocks';
import { containerSecrets, FakeSafeStorage } from '@tests/utils/fake-safe-storage';
import { createFakeProvider, createTestProviderContext } from '@tests/utils/fake-provider';
import {
  FakeIpcMain,
  fakeEvent,
  fakeWebContents,
  type FakeWebContents,
  TEST_LOGS_DIR,
  TRUSTED_SENDER_ID,
} from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => FIXTURE_MACHINE_ID }));

const electron = jest.requireMock('electron') as {
  BrowserWindow: typeof FakeBrowserWindow;
  session: {
    fromPartition(partition: string): {
      clearStorageData: jest.Mock;
      clearAuthCache: jest.Mock;
      cookies: { flushStore: jest.Mock };
    };
  };
};
const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };

const SITE = 'https://parkstay.dbca.wa.gov.au';
const SIGNED_IN: AccountStatus = {
  state: 'signed-in',
  email: 'a@b.au',
  displayName: 'Ann Lee',
};

const partition = () => electron.session.fromPartition('persist:provider-parkstay');
const lastWindow = (): FakeBrowserWindow =>
  electron.BrowserWindow.instances[electron.BrowserWindow.instances.length - 1];
/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('accounts over IPC', () => {
  let container: AppContainer;
  let ipc: FakeIpcMain;
  let renderer: FakeWebContents;
  let profileAnswer: AccountStatus;
  let isSignedIn: jest.SpyInstance;

  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
  const accountEvents = () =>
    renderer.sent.filter(([name]) => name === 'account:updated').map(([, payload]) => payload);

  function start(db: Database.Database = openDatabase(':memory:')): void {
    electron.BrowserWindow.instances.length = 0;
    container = createContainer({
      db,
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
      providerFactories: [parkstayFactory],
    });
    container.profile.ensureLocalProfile();
    renderer = fakeWebContents(TRUSTED_SENDER_ID);
    container.trustedWebContents.register(renderer);
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
    // As at startup, so dispose stops what it started (a created watch is scheduled)
    container.scheduler.start();

    // ParkStay's real sign-in definition; only its /api/profile answer is stubbed
    profileAnswer = { state: 'signed-out' };
    isSignedIn = jest
      .spyOn(container.providers.get('parkstay').auth!, 'isSignedIn')
      .mockImplementation(async () => profileAnswer);
    partition().clearStorageData.mockClear();
    partition().clearAuthCache.mockClear();
    partition().cookies.flushStore.mockClear();
  }

  afterEach(async () => {
    await container.dispose();
    autoUpdater.removeAllListeners();
  });

  describe('on the v8-migrated v5 fixture', () => {
    let fixture: Database.Database;

    beforeEach(() => {
      fixture = loadFixture('v5-release-1.2.0');
      const file = fixture.name;
      fixture.close();
      // As the app opens it: WAL and every migration (v8 creates the ParkStay account)
      const db = openDatabase(file);
      container = createContainer({
        db,
        logsDir: TEST_LOGS_DIR,
        ...containerSecrets(new FakeSafeStorage()),
        providerFactories: [parkstayFactory],
      });
      container.profile.ensureLocalProfile();
      container.providers.register(
        createFakeProvider({ id: 'noaccount', capabilities: { account: 'none' } }).factory,
        createTestProviderContext
      );
      ipc = new FakeIpcMain();
      registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
    });

    // The container's own connection must close before the file goes (Windows locks it).
    afterEach(async () => {
      await container.dispose();
      disposeFixture(fixture);
    });

    it('lists ParkStay with the fixture email as a hint, and leaves out an account:none provider', async () => {
      await expect(call('accounts:list')).resolves.toEqual({
        success: true,
        data: [
          {
            providerId: 'parkstay',
            requirement: 'optional',
            status: 'unknown',
            email: 'fixture.user@example.com',
            displayName: 'Fixture User',
          },
        ],
      });
    });
  });

  describe('with the built-in ParkStay provider', () => {
    beforeEach(() => start());

    it('status stores a definite answer, announces it once, and two calls share one check', async () => {
      profileAnswer = SIGNED_IN;
      const [a, b] = await Promise.all([
        call<ProviderAccount>('accounts:status', { providerId: 'parkstay' }),
        call<ProviderAccount>('accounts:status', { providerId: 'parkstay' }),
      ]);

      expect(a).toEqual(b);
      expect(a).toMatchObject({
        success: true,
        data: {
          providerId: 'parkstay',
          requirement: 'optional',
          status: 'signed-in',
          email: 'a@b.au',
          displayName: 'Ann Lee',
          lastSignedInAt: expect.any(String),
        },
      });
      expect(isSignedIn).toHaveBeenCalledTimes(1);
      // Asked with the provider's own HTTP client (its session partition)
      expect(isSignedIn.mock.calls[0][0]).toBe(container.providers.httpOf('parkstay'));
      expect(container.repositories.providerAccounts.get('parkstay')).toMatchObject({
        status: 'signed-in',
        lastSignedInAt: expect.any(Date),
      });
      expect(accountEvents()).toEqual([a.data]);
    });

    it('/login-success/ resolves signIn as signed-in and closes the window', async () => {
      const pending = call<ProviderAccount>('accounts:sign-in', { providerId: 'parkstay' });
      const window = lastWindow();
      expect(window.options.webPreferences.partition).toBe('persist:provider-parkstay');
      expect(window.loadURL).toHaveBeenCalledWith(`${SITE}/ssologin`);

      // The person signs in on ParkStay's own pages
      window.webContents.navigate('https://dbcab2c.b2clogin.com/dbcab2c.onmicrosoft.com/x');
      profileAnswer = SIGNED_IN;
      window.webContents.navigate(`${SITE}/login-success/`);

      await expect(pending).resolves.toMatchObject({
        success: true,
        data: { status: 'signed-in', email: 'a@b.au' },
      });
      expect(window.isDestroyed()).toBe(true);
      expect(partition().cookies.flushStore).toHaveBeenCalled();
      expect(accountEvents()).toHaveLength(1);
    });

    it('closing the window first resolves with the unchanged status', async () => {
      container.repositories.providerAccounts.upsert({
        providerId: 'parkstay',
        status: 'signed-out',
        email: 'hint@example.com',
      });
      const pending = call<ProviderAccount>('accounts:sign-in', { providerId: 'parkstay' });
      lastWindow().close();

      await expect(pending).resolves.toMatchObject({
        success: true,
        data: { status: 'signed-out', email: 'hint@example.com' },
      });
      expect(accountEvents()).toEqual([]);
    });

    it('a second signIn focuses the open window and both resolve together', async () => {
      const first = call<ProviderAccount>('accounts:sign-in', { providerId: 'parkstay' });
      const second = call<ProviderAccount>('accounts:sign-in', { providerId: 'parkstay' });
      await settle();

      expect(electron.BrowserWindow.instances).toHaveLength(1);
      expect(lastWindow().focus).toHaveBeenCalled();
      lastWindow().close();
      expect(await first).toEqual(await second);
    });

    it('closing the main window closes the sign-in window and resolves signIn', async () => {
      const main = new electron.BrowserWindow({ title: 'WA Stay' });
      container.providerWindows.attachMainWindow(main as unknown as BrowserWindow);
      const pending = call<ProviderAccount>('accounts:sign-in', { providerId: 'parkstay' });
      const signInWindow = lastWindow();

      main.close();

      await expect(pending).resolves.toMatchObject({
        success: true,
        data: { status: 'signed-out' },
      });
      expect(signInWindow.isDestroyed()).toBe(true);
    });

    it('a pasted link off the sign-in origins is VALIDATION; a b2clogin.com link loads in the window', async () => {
      await expect(
        call('accounts:open-sign-in-link', {
          providerId: 'parkstay',
          url: 'https://evil.example/x',
        })
      ).resolves.toEqual({
        success: false,
        code: 'VALIDATION',
        error: 'That link is not a ParkStay sign-in link',
        issues: ['url'],
      });
      expect(electron.BrowserWindow.instances).toHaveLength(0);

      const link = 'https://dbcab2c.b2clogin.com/dbcab2c.onmicrosoft.com/link?token=abc';
      await expect(
        call('accounts:open-sign-in-link', { providerId: 'parkstay', url: link })
      ).resolves.toEqual({ success: true });
      expect(lastWindow().loadURL).toHaveBeenCalledWith(link);

      // With the window open, the next link loads in the same window
      const next = 'https://dbcab2c.b2clogin.com/dbcab2c.onmicrosoft.com/link?token=def';
      await call('accounts:open-sign-in-link', { providerId: 'parkstay', url: next });
      expect(electron.BrowserWindow.instances).toHaveLength(1);
      expect(lastWindow().loadURL).toHaveBeenLastCalledWith(next);
    });

    it('sign-out is ACCOUNT_BUSY while a ParkStay snipe is sniping, and clears nothing', async () => {
      const userId = container.profile.requireUserId();
      const snipes = container.repositories.snipes;
      const snipe = snipes.create(userId, createMockSiteSnipeInput({ providerId: 'parkstay' }));
      snipes.updateStatus(snipe.id, SnipeStatus.SNIPING);

      await expect(call('accounts:sign-out', { providerId: 'parkstay' })).resolves.toMatchObject({
        success: false,
        code: 'ACCOUNT_BUSY',
      });
      expect(partition().clearStorageData).not.toHaveBeenCalled();

      snipes.updateStatus(snipe.id, SnipeStatus.ARMED);
      await expect(call('accounts:sign-out', { providerId: 'parkstay' })).resolves.toMatchObject({
        success: true,
        data: { status: 'signed-out' },
      });
      expect(partition().clearStorageData).toHaveBeenCalledTimes(1);
      expect(partition().clearAuthCache).toHaveBeenCalledTimes(1);
    });

    it('sign-out keeps the profile row and its data', async () => {
      container.repositories.providerAccounts.upsert({
        providerId: 'parkstay',
        status: 'signed-in',
        email: 'a@b.au',
      });
      await call('watches:create', createMockWatchInput());

      await expect(call('accounts:sign-out', { providerId: 'parkstay' })).resolves.toMatchObject({
        success: true,
        data: { status: 'signed-out', email: 'a@b.au' },
      });

      expect(container.repositories.users.findAll().map((u) => u.id)).toEqual([1]);
      expect((await call<unknown[]>('watches:list')).data).toHaveLength(1);
    });

    it('answers UNKNOWN_PROVIDER for a provider that is not registered', async () => {
      await expect(call('accounts:status', { providerId: 'nope' })).resolves.toMatchObject({
        success: false,
        code: 'UNKNOWN_PROVIDER',
      });
    });
  });
});
