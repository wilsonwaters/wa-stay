/**
 * `app.getInfo().secretStorage` over IPC, and the local fallback end to end: without OS
 * encryption (or with Linux `basic_text`), secrets saved through IPC are `local` envelopes
 * under a 0600 `secret-vault.key` in userData, and still read back.
 */

import fs from 'fs';
import path from 'path';
import { openDatabase } from '@main/database/connection';
import { createContainer, type AppContainer } from '@main/app/container';
import { registerIpcHandlers } from '@main/ipc';
import { NotifierChannel, SMTPPreset, type APIResponse } from '@shared/types';
import type { AppInfo } from '@shared/contracts';
import {
  containerSecrets,
  FakeSafeStorage,
  removeUserData,
  tempUserData,
} from '@tests/utils/fake-safe-storage';
import { FakeIpcMain, fakeEvent, TEST_LOGS_DIR } from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

describe('secret storage backend', () => {
  let container: AppContainer;
  let userDataDir: string;
  let ipc: FakeIpcMain;

  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;

  function start(safeStorage: FakeSafeStorage): void {
    userDataDir = tempUserData();
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(safeStorage, userDataDir),
    });
    container.profile.ensureLocalProfile();
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
  }

  afterEach(() => {
    container.dispose();
    removeUserData(userDataDir);
  });

  const unavailable = (): FakeSafeStorage =>
    Object.assign(new FakeSafeStorage(), { available: false });
  const basicText = (): FakeSafeStorage =>
    Object.assign(new FakeSafeStorage(), { backend: 'basic_text' });

  it('reports os when OS encryption is available', async () => {
    start(new FakeSafeStorage());
    const info = await call<AppInfo>('app:get-info');
    expect(info.data?.secretStorage).toEqual({ backend: 'os' });
  });

  const fallbacks: Array<[string, () => FakeSafeStorage]> = [
    ['isEncryptionAvailable() is false', unavailable],
    ...(process.platform === 'linux'
      ? ([['the Linux backend is basic_text', basicText]] as Array<[string, () => FakeSafeStorage]>)
      : []),
  ];

  it.each(fallbacks)(
    'falls back to the local key file when %s: getInfo says local, the key file is 0600, secrets round-trip',
    async (_case, makeSafeStorage) => {
      start(makeSafeStorage());
      const keyFile = path.join(userDataDir, 'secret-vault.key');

      const info = await call<AppInfo>('app:get-info');
      expect(info.data?.secretStorage).toEqual({ backend: 'local' });
      expect(fs.existsSync(keyFile)).toBe(false); // created only when a secret is saved

      await expect(
        call('notifiers:configure', {
          channel: NotifierChannel.EMAIL_SMTP,
          displayName: 'Email (SMTP)',
          enabled: true,
          config: {
            preset: SMTPPreset.CUSTOM,
            host: 'mail.example.com',
            port: 587,
            secure: false,
            auth: { user: 'me@example.com', pass: 'local-smtp-password' },
            toEmail: 'me@example.com',
          },
        })
      ).resolves.toMatchObject({ success: true });

      expect(fs.statSync(keyFile).size).toBe(32);
      if (process.platform !== 'win32') {
        expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
      }
      expect(container.db.prepare('SELECT config FROM notifiers').pluck().get() as string).toMatch(
        /^vault:v1:local:/
      );

      await expect(
        call('notifiers:get', { channel: NotifierChannel.EMAIL_SMTP })
      ).resolves.toMatchObject({
        success: true,
        data: { secretState: 'ok', hasPassword: true },
      });
    }
  );
});
