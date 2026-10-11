/**
 * @jest-environment node
 *
 * - `resolveAppPaths` / `configureAppPaths`: the WA Stay data folder and the legacy (v1.x)
 *   one, with the test-only hooks honoured only when running from source (§12.14): unpackaged,
 *   and not loaded from an asar archive.
 * - `getBrandIconPath`: the WA Stay icon for the window and OS notifications, and
 *   `getEmailLogoPath`: the small one the emails show. Packaged, each is the copy
 *   `extraResources` puts next to app.asar; from source, the committed file.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  configureAppPaths,
  getBrandIconPath,
  getEmailLogoPath,
  resolveAppPaths,
} from '@main/app/paths';

const mockApp = { isPackaged: false, getAppPath: jest.fn(() => '/repo') };
jest.mock('electron', () => ({
  get app() {
    return mockApp;
  },
}));

const ROOT = path.resolve(__dirname, '../../..');

const APP_DATA = 'C:\\Users\\Ann Lee\\AppData\\Roaming';
const E2E_USER_DATA = path.resolve(os.tmpdir(), 'wa-stay-e2e', 'user-data');
const E2E_LEGACY = path.resolve(os.tmpdir(), 'wa-stay-e2e', 'legacy');
const HOOKS = { WA_STAY_USER_DATA_DIR: E2E_USER_DATA, WA_STAY_LEGACY_DATA_DIR: E2E_LEGACY };
/** `app.getAppPath()` from a source checkout, and in an installed (packaged) app. */
const SOURCE_APP_PATH = ROOT;
const PACKAGED_APP_PATH = 'C:\\Program Files\\WA Stay\\resources\\app.asar';

describe('resolveAppPaths', () => {
  it('defaults (Windows): the WA Stay data folder, wa-stay.db, and the legacy folder beside it', () => {
    expect(
      resolveAppPaths({
        appData: APP_DATA,
        env: {},
        isPackaged: true,
        appPath: PACKAGED_APP_PATH,
        pathApi: path.win32,
      })
    ).toEqual({
      userData: 'C:\\Users\\Ann Lee\\AppData\\Roaming\\WA Stay',
      dbPath: 'C:\\Users\\Ann Lee\\AppData\\Roaming\\WA Stay\\wa-stay.db',
      legacyUserData: 'C:\\Users\\Ann Lee\\AppData\\Roaming\\parkstay-bookings',
      legacyDbPath: 'C:\\Users\\Ann Lee\\AppData\\Roaming\\parkstay-bookings\\parkstay.db',
      snapshotDir: 'C:\\Users\\Ann Lee\\AppData\\Roaming\\WA Stay\\legacy-snapshot',
      markerPath: 'C:\\Users\\Ann Lee\\AppData\\Roaming\\WA Stay\\migration.json',
    });
  });

  it('unpackaged: WA_STAY_USER_DATA_DIR replaces userData and WA_STAY_LEGACY_DATA_DIR the legacy folder', () => {
    expect(
      resolveAppPaths({
        appData: '/home/ann/.config',
        env: HOOKS,
        isPackaged: false,
        appPath: SOURCE_APP_PATH,
      })
    ).toEqual({
      userData: E2E_USER_DATA,
      dbPath: path.join(E2E_USER_DATA, 'wa-stay.db'),
      legacyUserData: E2E_LEGACY,
      legacyDbPath: path.join(E2E_LEGACY, 'parkstay.db'),
      snapshotDir: path.join(E2E_USER_DATA, 'legacy-snapshot'),
      markerPath: path.join(E2E_USER_DATA, 'migration.json'),
    });
  });

  it.each([
    ['packaged', true],
    ['a packaged executable renamed to electron (isPackaged false, app.asar)', false],
  ])('%s: the hooks are ignored', (_, isPackaged) => {
    expect(
      resolveAppPaths({
        appData: '/home/ann/.config',
        env: HOOKS,
        isPackaged,
        appPath: '/opt/WA Stay/resources/app.asar',
      })
    ).toMatchObject({
      userData: path.join('/home/ann/.config', 'WA Stay'),
      legacyUserData: path.join('/home/ann/.config', 'parkstay-bookings'),
    });
  });

  it('only the user-data hook: the legacy source is disabled, so a test never reads a real profile', () => {
    const paths = resolveAppPaths({
      appData: '/home/ann/.config',
      env: { WA_STAY_USER_DATA_DIR: 'relative/user-data' },
      isPackaged: false,
      appPath: SOURCE_APP_PATH,
      cwd: ROOT,
    });
    expect(paths).toMatchObject({
      userData: path.resolve(ROOT, 'relative/user-data'),
      legacyUserData: null,
      legacyDbPath: null,
    });
  });

  it('the portable build uses the same folders (only its executable runs from a temp folder)', () => {
    const env = { PORTABLE_EXECUTABLE_FILE: 'D:\\Apps\\WA Stay 2.0.0.exe' };
    expect(
      resolveAppPaths({
        appData: APP_DATA,
        env,
        isPackaged: true,
        appPath: PACKAGED_APP_PATH,
        pathApi: path.win32,
      })
    ).toEqual(
      resolveAppPaths({
        appData: APP_DATA,
        env: {},
        isPackaged: true,
        appPath: PACKAGED_APP_PATH,
        pathApi: path.win32,
      })
    );
  });

  it("agrees with the installer's snapshot (resources/installer.nsh)", () => {
    const nsh = fs.readFileSync(path.join(ROOT, 'resources/installer.nsh'), 'utf8');
    const paths = resolveAppPaths({
      appData: '$APPDATA',
      env: {},
      isPackaged: true,
      appPath: PACKAGED_APP_PATH,
      pathApi: path.win32,
    });
    expect(nsh).toContain(`CreateDirectory "${paths.snapshotDir}"`);
    expect(nsh).toContain(`\${FileExists} "${paths.markerPath}"`);
    expect(nsh).toContain(`\${FileExists} "${paths.legacyDbPath}"`);
  });
});

describe('configureAppPaths', () => {
  function fakeApp(
    isPackaged: boolean,
    appPath = isPackaged ? PACKAGED_APP_PATH : SOURCE_APP_PATH
  ) {
    return {
      isPackaged,
      getAppPath: jest.fn(() => appPath),
      getPath: jest.fn(() => '/home/ann/.config'),
      setPath: jest.fn(),
    };
  }

  it.each([
    ['packaged', true],
    ['a packaged executable renamed to electron (isPackaged false, app.asar)', false],
  ])(
    '%s: pins userData to the WA Stay data folder once, whatever the environment says',
    (_, isPackaged) => {
      const app = fakeApp(isPackaged, PACKAGED_APP_PATH);

      const { paths, testHooks } = configureAppPaths(app, HOOKS);

      expect(app.getPath).toHaveBeenCalledWith('appData');
      expect(app.setPath.mock.calls).toEqual([
        ['userData', path.join('/home/ann/.config', 'WA Stay')],
      ]);
      expect(paths.dbPath).toBe(path.join('/home/ann/.config', 'WA Stay', 'wa-stay.db'));
      expect(paths.legacyUserData).toBe(path.join('/home/ann/.config', 'parkstay-bookings'));
      expect(testHooks).toEqual({});
    }
  );

  it('from source: the WA Stay folder, then the test override applied after it; the paths follow the hooks', () => {
    const app = fakeApp(false);

    const { paths, testHooks } = configureAppPaths(app, HOOKS);

    expect(app.setPath.mock.calls).toEqual([
      ['userData', path.join('/home/ann/.config', 'WA Stay')],
      ['userData', E2E_USER_DATA],
    ]);
    expect(paths).toMatchObject({
      userData: E2E_USER_DATA,
      dbPath: path.join(E2E_USER_DATA, 'wa-stay.db'),
      legacyDbPath: path.join(E2E_LEGACY, 'parkstay.db'),
    });
    expect(testHooks).toMatchObject({ userDataDir: E2E_USER_DATA, legacyDataDir: E2E_LEGACY });
  });
});

describe('getBrandIconPath', () => {
  it('packaged: the icon extraResources copies to <resources>/icons, outside app.asar', () => {
    const icon = getBrandIconPath({
      isPackaged: true,
      appPath: path.join('C:', 'WA Stay', 'resources', 'app.asar'),
      resourcesPath: path.join('C:', 'WA Stay', 'resources'),
    });
    expect(icon).toBe(path.join('C:', 'WA Stay', 'resources', 'icons', 'icon.png'));
    expect(icon).not.toContain('app.asar');

    const builder = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf8'));
    expect(builder.extraResources).toContainEqual(
      expect.objectContaining({ from: 'resources/icons', to: 'icons' })
    );
    expect(builder.extraResources[0].filter).toContain(path.basename(icon));
  });

  it('from source: resources/icons/icon.png under the app path, which exists', () => {
    const icon = getBrandIconPath({ isPackaged: false, appPath: ROOT, resourcesPath: '/unused' });
    expect(icon).toBe(path.join(ROOT, 'resources', 'icons', 'icon.png'));
    expect(fs.existsSync(icon)).toBe(true);
  });

  it('reads the running app by default', () => {
    mockApp.isPackaged = false;
    expect(getBrandIconPath()).toBe(path.join('/repo', 'resources', 'icons', 'icon.png'));

    mockApp.isPackaged = true;
    const resourcesPath = process.resourcesPath;
    Object.defineProperty(process, 'resourcesPath', {
      value: '/opt/wa-stay/resources',
      configurable: true,
    });
    try {
      expect(getBrandIconPath()).toBe(path.join('/opt/wa-stay/resources', 'icons', 'icon.png'));
    } finally {
      Object.defineProperty(process, 'resourcesPath', { value: resourcesPath, configurable: true });
      mockApp.isPackaged = false;
    }
  });
});

describe('getEmailLogoPath', () => {
  it('packaged: email-logo.png, which extraResources ships next to the icon', () => {
    const logo = getEmailLogoPath({
      isPackaged: true,
      appPath: path.join('C:', 'WA Stay', 'resources', 'app.asar'),
      resourcesPath: path.join('C:', 'WA Stay', 'resources'),
    });
    expect(logo).toBe(path.join('C:', 'WA Stay', 'resources', 'icons', 'email-logo.png'));

    const builder = JSON.parse(fs.readFileSync(path.join(ROOT, 'electron-builder.json'), 'utf8'));
    expect(builder.extraResources[0].filter).toContain(path.basename(logo));
  });

  it('from source: resources/icons/email-logo.png, which exists', () => {
    const logo = getEmailLogoPath({ isPackaged: false, appPath: ROOT, resourcesPath: '/unused' });
    expect(logo).toBe(path.join(ROOT, 'resources', 'icons', 'email-logo.png'));
    expect(fs.existsSync(logo)).toBe(true);
  });

  it('reads the running app by default', () => {
    mockApp.isPackaged = false;
    expect(getEmailLogoPath()).toBe(path.join('/repo', 'resources', 'icons', 'email-logo.png'));
  });
});
