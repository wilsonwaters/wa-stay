/**
 * Startup order in `src/main/index.ts`: the crash policy first, then userData (the WA Stay
 * data folder), the AppUserModelId (Windows) and the single-instance lock, and only in the
 * instance that holds it, after `ready`: the log files, the legacy install migration, the
 * database (`wa-stay.db`), the container, the migration's follow-ups (welcome notice, launch
 * at login), IPC, the scheduler and the window. A losing instance quits without touching the
 * database; a migration the user quits starts nothing; a failed start goes to the crash
 * policy. A quit hides the window and disposes the container once; after that, errors no
 * longer notify (the database is closed).
 */

import { EventEmitter } from 'events';
import path from 'path';

const mockOrder: string[] = [];
const mockState = {
  hasLock: true,
  migrationOutcome: 'migrated' as string,
  launchOnStartup: true as boolean | null,
  /** The stored `app.startMinimised` (null: none stored). */
  startMinimised: null as boolean | null,
  /** The store index.ts hands `replaceLegacyLoginItems`. */
  startMinimisedStore: null as null | { get(): boolean | null; set(value: boolean): void },
  finishOptions: null as null | Record<string, unknown>,
  openDatabaseError: null as Error | null,
  containerOptions: null as null | Record<string, unknown>,
  windowIcon: undefined as string | undefined,
};
const mockCrashPolicy = { markReady: jest.fn(), failStartup: jest.fn() };
const mockWindowOptions: Array<{ preloadPath: string }> = [];
const mockWindows: Array<{ hide: jest.Mock }> = [];
const mockContainer = {
  dispose: jest.fn(() => {
    mockOrder.push('dispose');
    return Promise.resolve();
  }),
  notifyError: jest.fn(),
};

jest.mock('electron', () => {
  const { EventEmitter: Emitter } = jest.requireActual('events');
  const app = Object.assign(new Emitter(), {
    isPackaged: false,
    requestSingleInstanceLock: jest.fn(() => {
      mockOrder.push('requestSingleInstanceLock');
      return mockState.hasLock;
    }),
    whenReady: jest.fn(() => Promise.resolve()),
    getPath: jest.fn((name: string) => (name === 'appData' ? '/app-data' : '/user-data')),
    setPath: jest.fn((name: string, value: string) => mockOrder.push(`setPath ${name} ${value}`)),
    getAppPath: jest.fn(() => '/repo'),
    isReady: jest.fn(() => true),
    getLoginItemSettings: jest.fn(() => ({ wasOpenedAsHidden: false })),
    getVersion: jest.fn(() => '2.0.0'),
    setAppUserModelId: jest.fn((id: string) => mockOrder.push(`setAppUserModelId ${id}`)),
    quit: jest.fn(),
    exit: jest.fn(),
  });
  return {
    app,
    dialog: { showErrorBox: jest.fn() },
    safeStorage: { name: 'electron-safeStorage' },
    BrowserWindow: { getAllWindows: () => mockWindows },
  };
});

jest.mock('@main/app/crash-policy', () => ({
  installCrashPolicy: jest.fn(() => {
    mockOrder.push('installCrashPolicy');
    return mockCrashPolicy;
  }),
}));

jest.mock('@main/utils/logger', () => {
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    logger: { ...log, child: () => log },
    initFileLogging: jest.fn((dir: string) => {
      mockOrder.push(`initFileLogging ${dir}`);
      return dir;
    }),
  };
});

jest.mock('@main/database/connection', () => ({
  openDatabase: jest.fn((file: string) => {
    mockOrder.push(`openDatabase ${file}`);
    if (mockState.openDatabaseError) throw mockState.openDatabaseError;
    return { fake: 'db' };
  }),
}));

jest.mock('@main/app/container', () => ({
  createContainer: jest.fn((options: Record<string, unknown>) => {
    mockOrder.push('createContainer');
    mockState.containerOptions = options;
    return {
      profile: {
        ensureLocalProfile: () => mockOrder.push('ensureLocalProfile'),
        requireUserId: () => 1,
      },
      trustedWebContents: { isTrusted: () => true },
      scheduler: { start: () => mockOrder.push('scheduler.start') },
      catalogService: { start: () => mockOrder.push('catalogService.start') },
      accounts: { startRefresh: () => mockOrder.push('accounts.startRefresh') },
      providerWindows: {
        attachMainWindow: () => mockOrder.push('providerWindows.attachMainWindow'),
      },
      documentWindows: {
        attachMainWindow: () => mockOrder.push('documentWindows.attachMainWindow'),
      },
      autoUpdater: { scheduleUpdateCheck: jest.fn() },
      notificationService: { notifyError: mockContainer.notifyError },
      repositories: {
        notifications: { name: 'notifications-repository' },
        settings: {
          getValue: (key: string) =>
            key === 'launchOnStartup'
              ? mockState.launchOnStartup
              : key === 'app.startMinimised'
                ? mockState.startMinimised
                : null,
          set: (key: string, value: boolean) => {
            mockOrder.push(`settings.set ${key} ${value}`);
            if (key === 'app.startMinimised') mockState.startMinimised = value;
          },
        },
      },
      dispose: mockContainer.dispose,
    };
  }),
}));

jest.mock('@main/migration/legacy-install', () => ({
  createLegacyInstallDeps: jest.fn(() => ({ name: 'legacy-install-deps' })),
  migrateLegacyInstall: jest.fn(async (paths: { dbPath: string }) => {
    mockOrder.push(`migrateLegacyInstall ${paths.dbPath}`);
    return { outcome: mockState.migrationOutcome, sourceDir: '/app-data/parkstay-bookings' };
  }),
  finishLegacyInstall: jest.fn((result: { outcome: string }, options: Record<string, unknown>) => {
    mockOrder.push(`finishLegacyInstall ${result.outcome}`);
    mockState.finishOptions = options;
  }),
}));

jest.mock('@main/app/login-item', () => {
  const actual = jest.requireActual('@main/app/login-item');
  return {
    currentLaunchTarget: jest.fn(() => ({ platform: 'win32' })),
    startMinimisedSetting: actual.startMinimisedSetting,
    replaceLegacyLoginItems: jest.fn(
      (choice: {
        launchOnStartup: boolean;
        startMinimised: { get(): boolean | null; set(value: boolean): void };
      }) => {
        mockOrder.push(`replaceLegacyLoginItems ${choice.launchOnStartup}`);
        mockState.startMinimisedStore = choice.startMinimised;
        return { removed: [], registered: choice.launchOnStartup };
      }
    ),
  };
});

jest.mock('@main/ipc', () => ({
  registerIpcHandlers: jest.fn(() => mockOrder.push('registerIpcHandlers')),
}));

jest.mock('@main/app/main-window', () => {
  const { EventEmitter: Emitter } = jest.requireActual('events');
  return {
    createMainWindow: jest.fn((options: { preloadPath: string; icon?: string }) => {
      mockOrder.push('createMainWindow');
      mockWindowOptions.push(options);
      mockState.windowIcon = options.icon;
      const window = Object.assign(new Emitter(), {
        isDestroyed: () => false,
        isMinimized: jest.fn(() => false),
        restore: jest.fn(),
        show: jest.fn(),
        focus: jest.fn(),
        hide: jest.fn(() => mockOrder.push('hide')),
      });
      mockWindows.push(window);
      return window;
    }),
    denyWebviews: jest.fn(),
    refuseClientCertificates: jest.fn(),
  };
});

/** The WA Stay data folder under appData. */
const USER_DATA = path.join('/app-data', 'WA Stay');
/** Electron defines setAppUserModelId only on Windows, and the shell calls it only there. */
const AUMID_STEP = process.platform === 'win32' ? [`setAppUserModelId ${process.execPath}`] : [];

const { app } = jest.requireMock('electron') as { app: EventEmitter & { quit: jest.Mock } };

/** Loads `src/main/index.ts` afresh and lets its `whenReady().then(start)` chain run. */
async function launch(): Promise<void> {
  jest.isolateModules(() => {
    require('@main/index');
  });
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  mockOrder.length = 0;
  mockWindowOptions.length = 0;
  mockWindows.length = 0;
  mockContainer.dispose.mockClear();
  mockContainer.notifyError.mockClear();
  mockState.hasLock = true;
  mockState.migrationOutcome = 'migrated';
  mockState.launchOnStartup = true;
  mockState.startMinimised = null;
  mockState.startMinimisedStore = null;
  mockState.finishOptions = null;
  mockState.openDatabaseError = null;
  mockState.containerOptions = null;
  mockCrashPolicy.markReady.mockClear();
  mockCrashPolicy.failStartup.mockClear();
  app.removeAllListeners();
  app.quit.mockClear();
});

describe('main process startup', () => {
  it('takes the single-instance lock before opening the database, then starts in order', async () => {
    await launch();

    expect(mockOrder).toEqual([
      'installCrashPolicy',
      `setPath userData ${USER_DATA}`,
      ...AUMID_STEP,
      'requestSingleInstanceLock',
      `initFileLogging ${path.join(USER_DATA, 'logs')}`,
      `migrateLegacyInstall ${path.join(USER_DATA, 'wa-stay.db')}`,
      `openDatabase ${path.join(USER_DATA, 'wa-stay.db')}`,
      'createContainer',
      'ensureLocalProfile',
      'finishLegacyInstall migrated',
      'registerIpcHandlers',
      'scheduler.start',
      'createMainWindow',
      // Provider sign-in and payment windows, and document windows, sit above the main window
      'providerWindows.attachMainWindow',
      'documentWindows.attachMainWindow',
      // The catalogue's automatic sync starts once the window exists (it then waits 5 s)
      'catalogService.start',
      // So does the quiet check of accounts not checked for 6 h
      'accounts.startRefresh',
    ]);
    expect(mockCrashPolicy.markReady).toHaveBeenCalledTimes(1);
    expect(mockCrashPolicy.failStartup).not.toHaveBeenCalled();
    expect(app.listenerCount('second-instance')).toBe(1);
    // Running from source: the window gets the WA Stay icon
    expect(mockState.windowIcon).toBe(path.join('/repo', 'resources', 'icons', 'icon.png'));
  });

  it('points the window at the bundled preload, relative to the main bundle (never the cwd)', async () => {
    await launch();

    // From dist/main/main/ this is dist/preload/index.js, inside app.asar when packaged
    const mainDir = path.dirname(require.resolve('@main/index'));
    expect(mockWindowOptions.map((options) => options.preloadPath)).toEqual([
      path.join(mainDir, '../../preload/index.js'),
    ]);
  });

  it("builds the container (the vault's first use) after ready, on the final userData path, with Electron's safeStorage", async () => {
    await launch();

    const options = mockState.containerOptions as Record<string, unknown> & {
      isReady: () => boolean;
    };
    expect(options).toMatchObject({
      userDataDir: USER_DATA,
      logsDir: path.join(USER_DATA, 'logs'),
      safeStorage: { name: 'electron-safeStorage' },
    });
    expect(options.isReady()).toBe(true); // app.isReady()
  });

  it('a second instance quits without opening the database or waiting for ready', async () => {
    mockState.hasLock = false;

    await launch();

    expect(mockOrder).toEqual([
      'installCrashPolicy',
      `setPath userData ${USER_DATA}`,
      ...AUMID_STEP,
      'requestSingleInstanceLock',
    ]);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(app.listenerCount('window-all-closed')).toBe(0);
  });

  it("hands the migration's follow-ups the local profile, the notifications and the migrated launch-at-login setting", async () => {
    await launch();

    const options = mockState.finishOptions as Record<string, unknown> & {
      replaceLoginItems: (launchOnStartup: boolean) => unknown;
    };
    expect(options).toMatchObject({
      notifications: { name: 'notifications-repository' },
      userId: 1,
      launchOnStartup: true,
      markerPath: path.join(USER_DATA, 'migration.json'),
    });
    mockOrder.length = 0;
    options.replaceLoginItems(true);
    // Start minimised is decided inside the replacement (Windows, installed): startup stores
    // nothing itself, and hands over the stored choice
    expect(mockOrder).toEqual(['replaceLegacyLoginItems true']);
    const store = mockState.startMinimisedStore;
    expect(store?.get()).toBeNull();
    store?.set(true);
    expect(mockOrder).toEqual([
      'replaceLegacyLoginItems true',
      'settings.set app.startMinimised true',
    ]);
    expect(store?.get()).toBe(true);
  });

  it.each<[boolean | null, boolean]>([
    [false, false],
    [null, false],
  ])('launchOnStartup %s is passed on as %s', async (stored, passed) => {
    mockState.launchOnStartup = stored;

    await launch();

    expect(mockState.finishOptions).toMatchObject({ launchOnStartup: passed });
  });

  it('the user quits after a failed copy: the app quits without opening the database', async () => {
    mockState.migrationOutcome = 'quit';

    await launch();

    expect(mockOrder).not.toContain(`openDatabase ${path.join(USER_DATA, 'wa-stay.db')}`);
    expect(mockOrder).not.toContain('createContainer');
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(mockCrashPolicy.markReady).not.toHaveBeenCalled();
    expect(mockCrashPolicy.failStartup).not.toHaveBeenCalled();
  });

  it('a quit hides the window, then disposes the container once and holds the quit', async () => {
    await launch();
    mockOrder.length = 0;
    const [notify] = mockCrashPolicy.markReady.mock.calls[0] as [(error: Error) => void];
    notify(new Error('before the quit'));
    expect(mockContainer.notifyError).toHaveBeenCalledTimes(1);

    const quit = { preventDefault: jest.fn() };
    app.emit('before-quit', quit);
    app.emit('before-quit', { preventDefault: jest.fn() });

    expect(mockOrder).toEqual(['hide', 'dispose']);
    expect(quit.preventDefault).toHaveBeenCalled();
    // The database is closed from here: an error is logged by the policy, never notified
    notify(new Error('during the hold'));
    expect(mockContainer.notifyError).toHaveBeenCalledTimes(1);

    // Disposed: the hold quits again
    await new Promise((resolve) => setImmediate(resolve));
    expect(app.quit).toHaveBeenCalledTimes(1);
  });

  it('a desktop notification click restores and focuses the window, and is ignored once the quit has started', async () => {
    await launch();
    const { showMainWindow } = mockState.containerOptions as { showMainWindow: () => boolean };
    const [window] = mockWindows as unknown as Array<{
      isMinimized: jest.Mock;
      restore: jest.Mock;
      show: jest.Mock;
      focus: jest.Mock;
    }>;
    window.isMinimized.mockReturnValue(true);

    expect(showMainWindow()).toBe(true);
    expect(window.restore).toHaveBeenCalledTimes(1);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);

    app.emit('before-quit', { preventDefault: jest.fn() });
    expect(showMainWindow()).toBe(false);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it('a failed start is handed to the crash policy (error box, exit 1) and never marked ready', async () => {
    const error = new Error('database is locked');
    mockState.openDatabaseError = error;

    await launch();

    expect(mockCrashPolicy.failStartup).toHaveBeenCalledWith(error);
    expect(mockCrashPolicy.markReady).not.toHaveBeenCalled();
    expect(mockOrder).not.toContain('createMainWindow');
  });
});
