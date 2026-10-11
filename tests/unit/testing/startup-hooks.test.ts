/**
 * How `src/main/index.ts` applies the test-only hooks: the userData override after the app's
 * own data folder (`<appData>/WA Stay`) and before the single-instance lock (which lives in
 * userData), fixture mode after `ready` and before the container, which then serves
 * providers from fixtures. With the override and no `WA_STAY_LEGACY_DATA_DIR`, the legacy
 * install migration has no legacy source, so a test never reads a real profile. A packaged
 * app does none of it, even with every variable set, and neither does one whose executable
 * was renamed to `electron` (Electron then reports it unpackaged, but its code is in app.asar):
 * it also loads its own page, whatever `ELECTRON_RENDERER_URL` says. `WA_STAY_PROVIDERS` picks
 * the providers the container registers; an id that is not built in fails start-up before the
 * database opens. A packaged app registers every built-in provider whatever it says.
 */

import { EventEmitter } from 'events';
import path from 'path';
import { BUILT_IN_PROVIDERS } from '@main/providers';

const mockOrder: string[] = [];
const SOURCE_APP_PATH = '/repo';
const PACKAGED_APP_PATH = '/opt/WA Stay/resources/app.asar';

const mockState = {
  userData: '/user-data',
  appPath: SOURCE_APP_PATH,
  containerOptions: null as null | Record<string, unknown>,
};

jest.mock('electron', () => {
  const { EventEmitter: Emitter } = jest.requireActual('events');
  const app = Object.assign(new Emitter(), {
    isPackaged: false,
    requestSingleInstanceLock: jest.fn(() => {
      mockOrder.push('requestSingleInstanceLock');
      return true;
    }),
    whenReady: jest.fn(() => Promise.resolve()),
    getPath: jest.fn(() => mockState.userData),
    getAppPath: jest.fn(() => mockState.appPath),
    setPath: jest.fn((name: string, value: string) => {
      mockOrder.push(`setPath ${name} ${value}`);
      mockState.userData = value;
    }),
    isReady: jest.fn(() => true),
    getVersion: jest.fn(() => '2.0.0'),
    getLoginItemSettings: jest.fn(() => ({ wasOpenedAsHidden: false })),
    quit: jest.fn(),
    exit: jest.fn(),
  });
  const defaultSession = {
    webRequest: {
      onBeforeRequest: jest.fn(() => mockOrder.push('defaultSession.onBeforeRequest')),
    },
  };
  return {
    app,
    dialog: { showErrorBox: jest.fn() },
    safeStorage: {},
    session: { defaultSession },
  };
});

jest.mock('@main/app/crash-policy', () => ({
  installCrashPolicy: jest.fn(() => ({ markReady: jest.fn(), failStartup: jest.fn() })),
}));

jest.mock('@main/utils/logger', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    logger: { ...log, child: () => log },
    initFileLogging: jest.fn((dir: string) => dir),
  };
});

jest.mock('@main/database/connection', () => ({
  openDatabase: jest.fn((file: string) => {
    mockOrder.push(`openDatabase ${file}`);
    return {};
  }),
}));

jest.mock('@main/app/container', () => ({
  createContainer: jest.fn((options: Record<string, unknown>) => {
    mockOrder.push('createContainer');
    mockState.containerOptions = options;
    return {
      profile: { ensureLocalProfile: jest.fn(), requireUserId: () => 1 },
      repositories: { notifications: {}, settings: { getValue: () => null } },
      trustedWebContents: { isTrusted: () => true },
      scheduler: { start: jest.fn() },
      providerWindows: { attachMainWindow: jest.fn() },
      documentWindows: { attachMainWindow: jest.fn() },
      catalogService: { start: jest.fn() },
      accounts: { startRefresh: jest.fn() },
      autoUpdater: { scheduleUpdateCheck: jest.fn() },
      notificationService: { notifyError: jest.fn() },
      dispose: jest.fn(),
    };
  }),
}));

jest.mock('@main/migration/legacy-install', () => ({
  createLegacyInstallDeps: jest.fn(() => ({})),
  migrateLegacyInstall: jest.fn(async (paths: { dbPath: string; legacyDbPath: string | null }) => {
    mockOrder.push(`migrateLegacyInstall ${paths.dbPath} (legacy source ${paths.legacyDbPath})`);
    return { outcome: 'fresh-install' };
  }),
  finishLegacyInstall: jest.fn(),
}));

jest.mock('@main/app/login-item', () => ({
  currentLaunchTarget: jest.fn(),
  replaceLegacyLoginItems: jest.fn(),
}));

jest.mock('@main/ipc', () => ({ registerIpcHandlers: jest.fn() }));

jest.mock('@main/app/main-window', () => {
  const { EventEmitter: Emitter } = jest.requireActual('events');
  return {
    createMainWindow: jest.fn(() =>
      Object.assign(new Emitter(), { isDestroyed: () => false, isMinimized: () => false })
    ),
    denyWebviews: jest.fn(),
    refuseClientCertificates: jest.fn(),
  };
});

const mainWindow = jest.requireMock('@main/app/main-window') as {
  createMainWindow: jest.Mock;
};

const crashPolicy = jest.requireMock('@main/app/crash-policy') as {
  installCrashPolicy: jest.Mock;
};
/** The ids of the providers the last launch gave the container (each launch loads its own modules). */
const containerProviders = (): string[] | undefined =>
  (mockState.containerOptions?.providerFactories as Array<{ id: string }> | undefined)?.map(
    (factory) => factory.id
  );
const BUILT_IN_IDS = BUILT_IN_PROVIDERS.map((factory) => factory.id);

/** The crash policy's `failStartup` of the last launch. */
const failStartup = (): jest.Mock =>
  crashPolicy.installCrashPolicy.mock.results.at(-1)?.value.failStartup;

const electron = jest.requireMock('electron') as {
  app: EventEmitter & { isPackaged: boolean; setPath: jest.Mock };
  session: { defaultSession: { webRequest: { onBeforeRequest: jest.Mock } } };
};

const HOOK_VARS = {
  WA_STAY_USER_DATA_DIR: path.resolve('/tmp/wa-stay-e2e-user-data'),
  WA_STAY_E2E_FIXTURES_DIR: path.resolve('/tmp/wa-stay-e2e-fixtures'),
  WA_STAY_E2E_ALLOW_HOSTS: '',
};
const savedEnv = { ...process.env };

async function launch(): Promise<void> {
  jest.isolateModules(() => {
    require('@main/index');
  });
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  mockOrder.length = 0;
  mockState.userData = '/user-data';
  mockState.appPath = SOURCE_APP_PATH;
  mockState.containerOptions = null;
  electron.app.isPackaged = false;
  electron.app.removeAllListeners();
  jest.clearAllMocks();
  Object.assign(process.env, HOOK_VARS);
  delete process.env.WA_STAY_PROVIDERS;
});

afterEach(() => {
  delete (process as { resourcesPath?: string }).resourcesPath;
  for (const name of [...Object.keys(HOOK_VARS), 'ELECTRON_RENDERER_URL', 'WA_STAY_PROVIDERS']) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

describe('test-only hooks at startup', () => {
  it('unpackaged: userData is overridden before the lock, and fixture mode is on before the container', async () => {
    await launch();

    const userData = HOOK_VARS.WA_STAY_USER_DATA_DIR;
    expect(mockOrder).toEqual([
      // The app's own userData folder, then the test override
      `setPath userData ${path.join('/user-data', 'WA Stay')}`,
      `setPath userData ${userData}`,
      'requestSingleInstanceLock',
      'defaultSession.onBeforeRequest',
      // No WA_STAY_LEGACY_DATA_DIR: the migration has no legacy source
      `migrateLegacyInstall ${path.join(userData, 'wa-stay.db')} (legacy source null)`,
      `openDatabase ${path.join(userData, 'wa-stay.db')}`,
      'createContainer',
    ]);
    expect(electron.app.listenerCount('session-created')).toBe(1);
    expect(mockState.containerOptions).toMatchObject({
      userDataDir: userData,
      fixtureMode: {
        fixturesDir: HOOK_VARS.WA_STAY_E2E_FIXTURES_DIR,
        logFile: path.join(userData, 'e2e-unexpected-requests.log'),
      },
    });
    // No WA_STAY_PROVIDERS: every built-in provider
    expect(containerProviders()).toEqual(BUILT_IN_IDS);
    expect(failStartup()).not.toHaveBeenCalled();
  });

  it('unpackaged: the container registers only the providers WA_STAY_PROVIDERS lists', async () => {
    process.env.WA_STAY_PROVIDERS = 'parkstay';

    await launch();

    expect(containerProviders()).toEqual(['parkstay']);
    expect(failStartup()).not.toHaveBeenCalled();
  });

  it('unpackaged: a provider that is not built in fails start-up before the database opens', async () => {
    process.env.WA_STAY_PROVIDERS = 'parkstay,not-a-provider';

    await launch();

    expect(failStartup()).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringMatching(
          /^WA_STAY_PROVIDERS names "not-a-provider", not a built-in provider\. The built-in providers are: .*parkstay/
        ),
      })
    );
    expect(mockOrder).not.toContainEqual(
      expect.stringMatching(/^(migrateLegacyInstall|openDatabase)/)
    );
    expect(mockOrder).not.toContain('createContainer');
  });

  it.each([
    ['packaged', true],
    ['a packaged executable renamed to electron (isPackaged false, app.asar)', false],
  ])(
    '%s: no userData override, no network guard, no fixture mode and its own page, even with the variables set',
    async (_, isPackaged) => {
      electron.app.isPackaged = isPackaged;
      mockState.appPath = PACKAGED_APP_PATH;
      // Electron sets it; a packaged window's icon is read from it
      (process as { resourcesPath?: string }).resourcesPath = path.dirname(PACKAGED_APP_PATH);
      process.env.ELECTRON_RENDERER_URL = 'https://evil.example/';
      // Would fail start-up if it were read
      process.env.WA_STAY_PROVIDERS = 'not-a-provider';

      await launch();

      // Only the app's own userData folder: the test override is ignored when packaged
      expect(electron.app.setPath).toHaveBeenCalledTimes(1);
      expect(electron.app.setPath).not.toHaveBeenCalledWith(
        'userData',
        HOOK_VARS.WA_STAY_USER_DATA_DIR
      );
      expect(electron.session.defaultSession.webRequest.onBeforeRequest).not.toHaveBeenCalled();
      expect(electron.app.listenerCount('session-created')).toBe(0);
      expect(mockOrder).toEqual([
        `setPath userData ${path.join('/user-data', 'WA Stay')}`,
        'requestSingleInstanceLock',
        `migrateLegacyInstall ${path.join('/user-data', 'WA Stay', 'wa-stay.db')} (legacy source ${path.join('/user-data', 'parkstay-bookings', 'parkstay.db')})`,
        `openDatabase ${path.join('/user-data', 'WA Stay', 'wa-stay.db')}`,
        'createContainer',
      ]);
      expect(mockState.containerOptions?.fixtureMode).toBeUndefined();
      expect(containerProviders()).toEqual(BUILT_IN_IDS);
      expect(failStartup()).not.toHaveBeenCalled();
      expect(mainWindow.createMainWindow).toHaveBeenCalledWith(
        expect.objectContaining({ entry: expect.objectContaining({ kind: 'file' }) })
      );
    }
  );
});
