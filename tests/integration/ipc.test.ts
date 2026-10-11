/**
 * The IPC layer end to end: a container on a migrated in-memory database, every handler
 * registered through handle() on a fake ipcMain, and invokes from a trusted (or untrusted)
 * fake renderer.
 */

import { EventEmitter } from 'events';
import { openDatabase } from '@main/database/connection';
import { createContainer, AppContainer } from '@main/app/container';
import { createAppUrlMatcher } from '@main/app/renderer-entry';
import { registerIpcHandlers } from '@main/ipc';
import { createSenderGuard } from '@main/ipc/sender-guard';
import { NotifierChannel, SMTPPreset, Watch } from '@shared/types';
import { NotificationType } from '@shared/types/common.types';
import type { APIResponse } from '@shared/types';
import { createMockWatchInput } from '@tests/fixtures/watches';
import {
  APP_INDEX_PATH,
  FakeIpcMain,
  fakeEvent,
  fakeWebContents,
  FakeWebContents,
  TEST_LOGS_DIR,
  TRUSTED_SENDER_ID,
} from '@tests/utils/ipc-harness';
import { containerSecrets } from '@tests/utils/fake-safe-storage';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const { autoUpdater } = jest.requireMock('electron-updater') as { autoUpdater: EventEmitter };

describe('IPC through the container', () => {
  let container: AppContainer;
  let ipc: FakeIpcMain;
  let mainWindow: FakeWebContents;

  /** Invokes a channel from the trusted main window. */
  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;

  beforeEach(() => {
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(),
    });
    mainWindow = fakeWebContents(TRUSTED_SENDER_ID);
    container.trustedWebContents.register(mainWindow);
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, {
      isTrustedSender: createSenderGuard({
        isTrustedWebContents: (id) => container.trustedWebContents.isTrusted(id),
        isAppUrl: createAppUrlMatcher({ kind: 'file', path: APP_INDEX_PATH }),
      }),
      ipc,
    });
    // As at startup, so dispose stops every job the handlers schedule
    container.scheduler.start();
  });

  afterEach(async () => {
    await container.dispose();
    autoUpdater.removeAllListeners();
  });

  describe('with the local profile', () => {
    beforeEach(() => {
      container.profile.ensureLocalProfile();
    });

    it('watches.create then watches.list round-trips, owned by the local profile', async () => {
      const input = createMockWatchInput({ name: 'Round trip' });

      // A userId smuggled into the payload is not part of the contract and is dropped
      const created = await call<Watch>('watches:create', { ...input, userId: 999 });
      expect(created).toMatchObject({ success: true, data: { name: 'Round trip', userId: 1 } });

      const listed = await call<Watch[]>('watches:list');
      expect(listed.success).toBe(true);
      expect(listed.data).toHaveLength(1);
      expect(listed.data?.[0]).toMatchObject({
        id: created.data?.id,
        name: 'Round trip',
        userId: 1,
        providerId: 'parkstay',
        locationKey: `parkstay:${input.location.externalId}`,
        stay: { ...input.stay, children: 0, infants: 0, concessions: 0 },
      });
    });

    it('watches.create rejects an ISO timestamp as a stay date with VALIDATION', async () => {
      const input = createMockWatchInput();
      await expect(
        call('watches:create', {
          ...input,
          stay: { ...input.stay, arrival: '2099-02-14T00:00:00.000Z' },
        })
      ).resolves.toMatchObject({ success: false, code: 'VALIDATION', issues: ['stay.arrival'] });
      expect(container.repositories.watches.findAll()).toEqual([]);
    });

    it('notifiers.configure then notifiers.get round-trips the SMTP config, password write-only', async () => {
      const config = {
        preset: SMTPPreset.GMAIL,
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: 'me@example.com', pass: 'app-password' },
        toEmail: 'me@example.com',
      };

      const configured = await call('notifiers:configure', {
        channel: NotifierChannel.EMAIL_SMTP,
        displayName: 'Email (SMTP)',
        enabled: true,
        config,
      });
      expect(configured).toMatchObject({ success: true });

      await expect(call('notifiers:get', { channel: NotifierChannel.EMAIL_SMTP })).resolves.toEqual(
        {
          success: true,
          data: expect.objectContaining({
            channel: 'email_smtp',
            enabled: true,
            config: { ...config, auth: { user: 'me@example.com' } },
            hasPassword: true,
            secretState: 'ok',
          }),
        }
      );
      const stored = container.db.prepare('SELECT channel, config FROM notifiers').get() as {
        channel: string;
        config: string;
      };
      expect(stored.channel).toBe('email_smtp');
      expect(stored.config).not.toContain('app-password');
      expect(stored.config).toMatch(/^vault:v1:os:/);
    });

    it('a ParkStay sign-out keeps the profile and its watches', async () => {
      await call('watches:create', createMockWatchInput());

      await expect(call('accounts:sign-out', { providerId: 'parkstay' })).resolves.toMatchObject({
        success: true,
        data: { providerId: 'parkstay', status: 'signed-out' },
      });

      const listed = await call<Watch[]>('watches:list');
      expect(listed.data).toHaveLength(1);
      expect(container.repositories.users.findAll()).toHaveLength(1);
    });

    it('notifications.unreadCount counts every unread one, past the list page; markAllRead clears it', async () => {
      const notifications = container.repositories.notifications;
      for (let n = 1; n <= 25; n += 1) {
        const created = notifications.create({
          userId: 1,
          providerId: 'parkstay',
          type: NotificationType.WATCH_FOUND,
          title: `Sites available at Camp ${n}`,
          message: 'x',
        });
        if (n <= 2) notifications.markAsRead(created.id);
      }

      const firstPage = await call<unknown[]>('notifications:list', { limit: 20 });
      expect(firstPage.success).toBe(true);
      expect(firstPage.data).toHaveLength(20);
      await expect(call('notifications:unread-count')).resolves.toEqual({
        success: true,
        data: 23,
      });
      await expect(call('notifications:mark-all-read')).resolves.toMatchObject({ success: true });
      await expect(call('notifications:unread-count')).resolves.toEqual({
        success: true,
        data: 0,
      });
      // The payloads are void: anything else is refused before the handler runs
      await expect(call('notifications:unread-count', { userId: 9 })).resolves.toMatchObject({
        success: false,
        code: 'VALIDATION',
      });
    });

    it('a missing record is NOT_FOUND', async () => {
      await expect(call('watches:delete', { id: 404 })).resolves.toMatchObject({
        success: false,
        code: 'NOT_FOUND',
      });
      await expect(
        call('watches:update', { id: 404, updates: { name: 'Gone' } })
      ).resolves.toMatchObject({ success: false, code: 'NOT_FOUND', error: 'Watch not found' });
      await expect(call('bookings:delete', { id: 404 })).resolves.toMatchObject({
        success: false,
        code: 'NOT_FOUND',
      });
    });
  });

  it('with no users row, watches.create returns NO_PROFILE', async () => {
    // Migration v8 seeds the profile row; take it away to reach the error path.
    container.db.exec('DELETE FROM users');
    expect(container.repositories.users.findAll()).toEqual([]);

    await expect(call('watches:create', createMockWatchInput())).resolves.toEqual({
      success: false,
      code: 'NO_PROFILE',
      error: 'No local profile exists',
    });
    expect(container.repositories.watches.findAll()).toEqual([]);
  });

  describe('settings (typed keys)', () => {
    const row = (key: string) =>
      container.db
        .prepare('SELECT value, value_type, category FROM settings WHERE key = ?')
        .get(key);

    it("settings.set('unknown.key', 1) is VALIDATION", async () => {
      await expect(call('settings:set', { key: 'unknown.key', value: 1 })).resolves.toMatchObject({
        success: false,
        code: 'VALIDATION',
        issues: ['key'],
      });
      expect(row('unknown.key')).toBeUndefined();
    });

    it("settings.set('notifications.desktop', 'yes') is VALIDATION", async () => {
      await expect(
        call('settings:set', { key: 'notifications.desktop', value: 'yes' })
      ).resolves.toMatchObject({ success: false, code: 'VALIDATION', issues: ['value'] });
      expect(row('notifications.desktop')).toBeUndefined();
    });

    it("a valid set stores the registry's valueType and category, ignoring any sent", async () => {
      await expect(
        call('settings:set', {
          key: 'notifications.desktop',
          value: false,
          valueType: 'json',
          category: 'advanced',
        })
      ).resolves.toEqual({ success: true, data: true });

      expect(row('notifications.desktop')).toEqual({
        value: 'false',
        value_type: 'boolean',
        category: 'notifications',
      });
      await expect(call('settings:get', { key: 'notifications.desktop' })).resolves.toEqual({
        success: true,
        data: false,
      });
    });

    it.each(['launchOnStartup', 'app.startMinimised'])(
      'settings.set refuses the main-only key %s (app.setAutoLaunch writes it)',
      async (key) => {
        await expect(call('settings:set', { key, value: true })).resolves.toMatchObject({
          success: false,
          code: 'VALIDATION',
          issues: ['key'],
        });
        expect(row(key)).toBeUndefined();
      }
    );

    it.each([
      ['notifications.desktop', true],
      ['notifications.sound', true],
      ['app.startMinimised', false],
      ['launchOnStartup', false],
    ])('settings.get answers the default for %s while nothing is stored', async (key, value) => {
      await expect(call('settings:get', { key })).resolves.toEqual({ success: true, data: value });
    });
  });

  describe('app.setAutoLaunch / getAutoLaunch', () => {
    const electronApp = (jest.requireMock('electron') as { app: Record<string, unknown> }).app as {
      isPackaged: boolean;
      setLoginItemSettings: jest.Mock;
    };

    const realPlatform = process.platform;
    const runOn = (platform: NodeJS.Platform) =>
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });

    beforeEach(() => {
      electronApp.setLoginItemSettings.mockClear();
      // The installed app registers on Windows (and macOS); Linux has no login items
      runOn('win32');
    });

    afterEach(() => {
      electronApp.isPackaged = false;
      runOn(realPlatform);
    });

    it('Linux: unavailable, so turning it on is refused and nothing is stored or registered', async () => {
      runOn('linux');
      electronApp.isPackaged = true;

      await expect(call('app:get-auto-launch')).resolves.toEqual({
        success: true,
        data: { enabled: false, startMinimised: false, supported: false },
      });
      await expect(call('app:set-auto-launch', { enabled: true })).resolves.toMatchObject({
        success: false,
        code: 'VALIDATION',
        error: 'Starting at sign-in is available on Windows and macOS only.',
      });
      expect(electronApp.setLoginItemSettings).not.toHaveBeenCalled();
      expect(container.repositories.settings.getValue('launchOnStartup')).toBeNull();
    });

    it('is refused when running from source, and nothing is stored or registered', async () => {
      await expect(call('app:set-auto-launch', { enabled: true })).resolves.toMatchObject({
        success: false,
        error: expect.stringContaining('only available in the installed app'),
      });
      expect(electronApp.setLoginItemSettings).not.toHaveBeenCalled();
      await expect(call('app:get-auto-launch')).resolves.toEqual({
        success: true,
        data: { enabled: false, startMinimised: false, supported: true },
      });
    });

    it('registers with --hidden only when start minimised is on, and stores both keys', async () => {
      electronApp.isPackaged = true;

      await expect(call('app:set-auto-launch', { enabled: true })).resolves.toEqual({
        success: true,
        data: { enabled: true, startMinimised: false, supported: true },
      });
      expect(electronApp.setLoginItemSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ openAtLogin: true, args: [] })
      );

      await expect(
        call('app:set-auto-launch', { enabled: true, startMinimised: true })
      ).resolves.toEqual({
        success: true,
        data: { enabled: true, startMinimised: true, supported: true },
      });
      expect(electronApp.setLoginItemSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ openAtLogin: true, args: ['--hidden'] })
      );
      await expect(call('app:get-auto-launch')).resolves.toEqual({
        success: true,
        data: { enabled: true, startMinimised: true, supported: true },
      });
    });

    it('keeps the stored start minimised choice when the request leaves it out', async () => {
      electronApp.isPackaged = true;
      await call('app:set-auto-launch', { enabled: true, startMinimised: true });

      await expect(call('app:set-auto-launch', { enabled: false })).resolves.toEqual({
        success: true,
        data: { enabled: false, startMinimised: true, supported: true },
      });
      expect(electronApp.setLoginItemSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ openAtLogin: false, args: [] })
      );
      await expect(call('app:set-auto-launch', { enabled: true })).resolves.toEqual({
        success: true,
        data: { enabled: true, startMinimised: true, supported: true },
      });
    });

    it('turning it off is allowed when running from source', async () => {
      await expect(call('app:set-auto-launch', { enabled: false })).resolves.toEqual({
        success: true,
        data: { enabled: false, startMinimised: false, supported: true },
      });
    });
  });

  it('refuses an untrusted renderer before any handler runs', async () => {
    container.profile.ensureLocalProfile();
    const stranger = fakeEvent({ senderId: 42 });

    await expect(
      ipc.invoke('watches:create', stranger, createMockWatchInput())
    ).resolves.toMatchObject({ code: 'FORBIDDEN' });
    expect(container.repositories.watches.findAll()).toEqual([]);
  });

  it('once dispose starts (the quit hold), the renderer is cut off before the database closes', async () => {
    container.profile.ensureLocalProfile();
    const listWatches = jest.spyOn(container.watchService, 'list');

    const disposing = container.dispose();
    // Cut off at once; the database closes once the scheduler's jobs have settled
    await expect(call('watches:list')).resolves.toMatchObject({ code: 'FORBIDDEN' });
    await disposing;
    expect(container.db.open).toBe(false);

    // Refused before any handler runs, so nothing reaches the closed database
    await expect(call('watches:list')).resolves.toMatchObject({ code: 'FORBIDDEN' });
    expect(listWatches).not.toHaveBeenCalled();
    // No event reaches the hidden window either, and a reload cannot register it again
    autoUpdater.emit('update-not-available', {});
    container.trustedWebContents.register(mainWindow);
    expect(container.trustedWebContents.isTrusted(TRUSTED_SENDER_ID)).toBe(false);
    expect(mainWindow.sent).toEqual([]);
  });

  it('queue gate and updater events reach only trusted webContents', async () => {
    const untrusted = fakeWebContents(7); // exists, but was never registered

    // ParkStay's queue gate reports a failed check (net.request is not stubbed here).
    const waiting = new AbortController();
    const ensure = container.providers
      .get('parkstay')
      .access!.ensure({ signal: waiting.signal })
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    waiting.abort();
    await ensure;
    autoUpdater.emit('update-available', { version: '2.0.0', releaseNotes: 'Notes' });
    autoUpdater.emit('download-progress', {
      percent: 40,
      bytesPerSecond: 10,
      transferred: 4,
      total: 10,
    });

    expect(mainWindow.sent).toEqual([
      [
        'provider:access-status',
        expect.objectContaining({ providerId: 'parkstay', state: 'error' }),
      ],
      ['updater:available', { version: '2.0.0', releaseNotes: 'Notes' }],
      ['updater:progress', { percent: 40, bytesPerSecond: 10, transferred: 4, total: 10 }],
    ]);
    // The queue session key never travels with a status.
    expect(JSON.stringify(mainWindow.sent)).not.toMatch(/session_?key|sitequeuesession/i);
    expect(untrusted.sent).toEqual([]);

    // After the window closes, events are dropped without error
    mainWindow.destroy();
    expect(() =>
      autoUpdater.emit('update-available', { version: '2.0.1', releaseNotes: '' })
    ).not.toThrow();
    expect(mainWindow.sent).toHaveLength(3);
  });
});
