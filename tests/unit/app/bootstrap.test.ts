/**
 * @jest-environment node
 *
 * `bootstrapShell`: before `ready`, userData is pinned to the WA Stay data folder, then the
 * AppUserModelId is set (Windows: the appId when packaged, the Electron binary from
 * source), then the single-instance lock is taken in that folder.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { APP_USER_MODEL_ID, bootstrapShell } from '@main/app/bootstrap';

const ROOT = path.resolve(__dirname, '../../..');
const EXEC_PATH = 'C:\\Users\\Ann\\AppData\\Local\\Programs\\WA Stay\\WA Stay.exe';

function fakeApp(options: {
  isPackaged: boolean;
  appPath?: string;
  hasLock?: boolean;
  windows?: boolean;
}) {
  const calls: string[] = [];
  const app = {
    isPackaged: options.isPackaged,
    getAppPath: jest.fn(
      () =>
        options.appPath ??
        (options.isPackaged ? 'C:\\Program Files\\WA Stay\\resources\\app.asar' : ROOT)
    ),
    getPath: jest.fn(() => '/home/ann/.config'),
    setPath: jest.fn((name: string, value: string) => calls.push(`setPath ${name} ${value}`)),
    requestSingleInstanceLock: jest.fn(() => {
      calls.push('requestSingleInstanceLock');
      return options.hasLock ?? true;
    }),
    on: jest.fn(),
    quit: jest.fn(() => calls.push('quit')),
    // Electron defines it only on Windows
    ...(options.windows === false
      ? {}
      : { setAppUserModelId: jest.fn((id: string) => calls.push(`setAppUserModelId ${id}`)) }),
  };
  return { app, calls };
}

const log = { info: jest.fn() };
const USER_DATA = path.join('/home/ann/.config', 'WA Stay');

describe('bootstrapShell', () => {
  it('packaged (Windows): setPath, then setAppUserModelId(appId), then the single-instance lock', () => {
    const { app, calls } = fakeApp({ isPackaged: true });

    const shell = bootstrapShell(app, { platform: 'win32', execPath: EXEC_PATH, env: {}, log });

    expect(calls).toEqual([
      `setPath userData ${USER_DATA}`,
      'setAppUserModelId com.parkstay.bookings',
      'requestSingleInstanceLock',
    ]);
    expect(shell.paths.dbPath).toBe(path.join(USER_DATA, 'wa-stay.db'));
    expect(shell.instance.isPrimary).toBe(true);
  });

  it('from source (Windows): the Electron binary (process.execPath) is the AppUserModelId', () => {
    const { app, calls } = fakeApp({ isPackaged: false });

    bootstrapShell(app, { platform: 'win32', execPath: EXEC_PATH, env: {}, log });

    expect(calls).toEqual([
      `setPath userData ${USER_DATA}`,
      `setAppUserModelId ${EXEC_PATH}`,
      'requestSingleInstanceLock',
    ]);
  });

  it('from source with WA_STAY_USER_DATA_DIR: the test override is applied after the WA Stay folder, before the lock', () => {
    const { app, calls } = fakeApp({ isPackaged: false });
    const override = path.resolve(os.tmpdir(), 'wa-stay-e2e', 'user-data');

    const shell = bootstrapShell(app, {
      platform: 'win32',
      execPath: EXEC_PATH,
      env: { WA_STAY_USER_DATA_DIR: override },
      log,
    });

    expect(calls).toEqual([
      `setPath userData ${USER_DATA}`,
      `setPath userData ${override}`,
      `setAppUserModelId ${EXEC_PATH}`,
      'requestSingleInstanceLock',
    ]);
    expect(shell.paths.dbPath).toBe(path.join(override, 'wa-stay.db'));
    expect(shell.paths.legacyDbPath).toBeNull();
    expect(shell.testHooks).toEqual({ userDataDir: override, legacyDataDir: null });
  });

  it('a packaged executable renamed to electron.exe (isPackaged false, app.asar) ignores WA_STAY_USER_DATA_DIR', () => {
    const { app, calls } = fakeApp({
      isPackaged: false,
      appPath: 'C:\\Program Files\\WA Stay\\resources\\app.asar',
    });

    const shell = bootstrapShell(app, {
      platform: 'linux',
      execPath: '/opt/WA Stay/electron',
      env: { WA_STAY_USER_DATA_DIR: path.resolve(os.tmpdir(), 'wa-stay-e2e', 'user-data') },
      log,
    });

    expect(calls).toEqual([`setPath userData ${USER_DATA}`, 'requestSingleInstanceLock']);
    expect(shell.testHooks).toEqual({});
  });

  it('elsewhere: no AppUserModelId (the method exists only on Windows)', () => {
    const { app, calls } = fakeApp({ isPackaged: true, windows: false });

    bootstrapShell(app, { platform: 'linux', execPath: '/opt/WA Stay/wa-stay', env: {}, log });

    expect(calls).toEqual([`setPath userData ${USER_DATA}`, 'requestSingleInstanceLock']);
  });

  it('a second instance still sets the path first (the lock it lost lives there), then quits', () => {
    const { app, calls } = fakeApp({ isPackaged: true, hasLock: false });

    const shell = bootstrapShell(app, { platform: 'win32', execPath: EXEC_PATH, env: {}, log });

    expect(calls).toEqual([
      `setPath userData ${USER_DATA}`,
      'setAppUserModelId com.parkstay.bookings',
      'requestSingleInstanceLock',
      'quit',
    ]);
    expect(shell.instance.isPrimary).toBe(false);
  });

  it("the AppUserModelId is electron-builder's appId, which the installer's shortcuts carry", () => {
    const builder = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf8'));
    expect(APP_USER_MODEL_ID).toBe(builder.appId);
  });
});
