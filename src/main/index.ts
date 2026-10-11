/**
 * Electron Main Process Entry Point
 *
 * The order matters:
 * 1. The crash policy is installed first, so a failed start shows an error box and exits.
 * 2. `bootstrapShell`: userData becomes `<appData>/WA Stay` before anything uses it, then
 *    the AppUserModelId (Windows), then the single-instance lock, which lives in userData.
 *    The lock is taken before any database or scheduler work. A second instance hands over
 *    to the first (which brings its window to the front) and quits.
 * 3. After `ready`: log files under userData, the first-run copy of a v1.x install
 *    (`migration/legacy-install.ts`), the database, the container, the IPC handlers, the
 *    scheduler, the main window and then the catalogue sync and the stale-account check (each
 *    waits 5 s). From then on errors are logged and survived.
 *
 * The container's SecretVault uses `safeStorage`, whose Windows key lives in userData's
 * `Local State`: the final userData path is set before `ready`, and the legacy data is
 * copied before `createContainer` (architecture-notes §12.23).
 */

import { app, BrowserWindow, dialog, safeStorage, session } from 'electron';
import path from 'path';
import { openDatabase } from './database/connection';
import { bootstrapShell } from './app/bootstrap';
import { createContainer, AppContainer } from './app/container';
import { installCrashPolicy } from './app/crash-policy';
import {
  currentLaunchTarget,
  replaceLegacyLoginItems,
  startMinimisedSetting,
} from './app/login-item';
import { createMainWindow, denyWebviews, refuseClientCertificates } from './app/main-window';
import { getBrandIconPath } from './app/paths';
import { isDocumentWindow } from './app/document-windows';
import { isProviderWindow } from './app/provider-windows';
import { installQuitHold } from './app/quit-hold';
import { createAppUrlMatcher, resolveRendererEntry } from './app/renderer-entry';
import { bringToFront, HIDDEN_ARG } from './app/single-instance';
import { registerIpcHandlers } from './ipc';
import { createSenderGuard } from './ipc/sender-guard';
import {
  createLegacyInstallDeps,
  finishLegacyInstall,
  migrateLegacyInstall,
} from './migration/legacy-install';
import { BUILT_IN_PROVIDERS } from './providers';
import { selectProviders, startFixtureMode } from './testing';
import { initFileLogging, logger } from './utils/logger';

const crashPolicy = installCrashPolicy({ process, app, dialog, log: logger });

// userData (<appData>/WA Stay, then the test-only override when running from source), the
// AppUserModelId, then the single-instance lock
const { paths, testHooks, instance } = bootstrapShell(app, {
  platform: process.platform,
  execPath: process.execPath,
  log: logger,
  // e.g. macOS after the window was closed; during startup the request waits for the window
  requestWindow: () => {
    if (container && mainWindow === null) createWindow(false);
  },
});

// Where the renderer is loaded from. The IPC sender guard trusts exactly this origin.
const rendererEntry = resolveRendererEntry(
  process.env,
  path.join(__dirname, '../../../dist/renderer/index.html'),
  { isPackaged: app.isPackaged, appPath: app.getAppPath() }
);

// Global references
let container: AppContainer | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * A login launch with "Start minimised": the Windows Run value adds `--hidden`. macOS login
 * items can no longer open hidden (`app/login-item.ts`).
 */
function isHiddenLaunch(): boolean {
  return process.argv.includes(HIDDEN_ARG);
}

/**
 * Restores, shows and focuses the main window for a click on a desktop notification. While the
 * app is quitting (`container` is cleared) or with no window, it does nothing and says so.
 */
function showMainWindow(): boolean {
  if (!container || !mainWindow || mainWindow.isDestroyed()) return false;
  bringToFront(mainWindow);
  return true;
}

/**
 * Create the main window. Only the first window of a login launch starts minimised.
 */
function createWindow(startMinimised: boolean): void {
  if (!container) return;

  const window = createMainWindow({
    entry: rendererEntry,
    // The bundled preload (`npm run build:preload`): dist/preload/, next to dist/main/
    preloadPath: path.join(__dirname, '../../preload/index.js'),
    trustedWebContents: container.trustedWebContents,
    startMinimised,
    // A packaged Windows or macOS window shows the executable's own icon
    icon: process.platform === 'linux' || !app.isPackaged ? getBrandIconPath() : undefined,
  });
  mainWindow = window;
  // Provider sign-in and payment windows, and document windows, sit above it and close with it
  container.providerWindows.attachMainWindow(window);
  container.documentWindows.attachMainWindow(window);
  window.on('closed', () => {
    if (mainWindow !== window) return;
    mainWindow = null;
    instance.attachWindow(null);
  });
  // Brings the window forward if a second launch arrived during startup
  instance.attachWindow(window);

  // Check for updates once the window exists (results arrive as updater:* events)
  container.autoUpdater.scheduleUpdateCheck();
}

/**
 * Initialize logging, database and services, then open the window
 */
async function start(): Promise<void> {
  const logsDir = initFileLogging(path.join(paths.userData, 'logs'));
  logger.info('Initializing application...');

  // Every built-in provider, or (test-only, WA_STAY_PROVIDERS) those listed; an id that is not
  // built in fails start-up here, before anything is written
  const providerFactories = selectProviders(testHooks, BUILT_IN_PROVIDERS);

  // Test-only network-free mode (WA_STAY_E2E_FIXTURES_DIR), before anything can send a request
  const fixtureMode = startFixtureMode(testHooks, {
    app,
    session,
    userDataDir: paths.userData,
    log: logger,
  });

  // First start after an upgrade from v1.x: copy its data into the WA Stay data folder
  const migration = await migrateLegacyInstall(
    paths,
    createLegacyInstallDeps({ dialog, appVersion: app.getVersion() })
  );
  if (migration.outcome === 'quit') {
    logger.info('Quitting: the legacy data could not be copied');
    app.quit();
    return;
  }

  // Open and migrate the database
  const db = openDatabase(paths.dbPath);

  // Build every service once, then make sure the local profile row exists
  // Builds the SecretVault and migrates v1.x secrets into it: its first use of safeStorage
  const ready = createContainer({
    db,
    logsDir,
    userDataDir: paths.userData,
    safeStorage,
    isReady: () => app.isReady(),
    fixtureMode,
    providerFactories,
    showMainWindow,
  });
  container = ready;
  ready.profile.ensureLocalProfile();

  // A copy's follow-ups still pending (this start's copy, or one whose start crashed after
  // it): the welcome notice and launch at login under WA Stay
  finishLegacyInstall(migration, {
    notifications: ready.repositories.notifications,
    userId: ready.profile.requireUserId(),
    launchOnStartup: ready.repositories.settings.getValue<boolean>('launchOnStartup') === true,
    // v1.x always started hidden: such a user keeps a quiet start ("Start minimised"), set
    // only where the entry is really replaced (Windows, installed)
    replaceLoginItems: (launchOnStartup) =>
      replaceLegacyLoginItems(
        { launchOnStartup, startMinimised: startMinimisedSetting(ready.repositories.settings) },
        { ...currentLaunchTarget(), log: logger }
      ),
    markerPath: paths.markerPath,
    logger,
  });

  const trusted = ready.trustedWebContents;
  registerIpcHandlers(ready, {
    isTrustedSender: createSenderGuard({
      isTrustedWebContents: (id) => trusted.isTrusted(id),
      isAppUrl: createAppUrlMatcher(rendererEntry),
      // Never a provider or document window, even one registered by mistake
      isProviderWindow: (sender) => isProviderWindow(sender) || isDocumentWindow(sender),
    }),
  });

  ready.scheduler.start();
  createWindow(isHiddenLaunch());
  // Stale catalogues sync a few seconds after the window is up, not during startup
  ready.catalogService.start();
  // Accounts not checked for 6 h are checked a few seconds after startup, quietly
  ready.accounts.startRefresh();

  // From here on an error is logged and survived; the user hears about it (throttled), but
  // not once the quit has started: the database is closed then.
  crashPolicy.markReady((error) => {
    if (container !== ready) return;
    ready.notificationService.notifyError(ready.profile.requireUserId(), error, 'Unexpected error');
  });

  logger.info('Application initialized successfully');
}

if (instance.isPrimary) {
  denyWebviews(app);
  refuseClientCertificates(app);

  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => crashPolicy.failStartup(error));

  /**
   * All windows closed event
   */
  app.on('window-all-closed', () => {
    // On macOS, keep app running until user quits explicitly
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  /**
   * Activate event (macOS)
   */
  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (container && mainWindow === null) {
      createWindow(false);
    }
  });

  /**
   * Quit. The first `before-quit` hides the windows, disposes the container and holds the
   * quit until the providers have closed their browsers (bounded); see `app/quit-hold.ts`.
   */
  installQuitHold({
    app,
    windows: () => BrowserWindow.getAllWindows(),
    shutDown: () => {
      const closing = container;
      if (!closing) return null;
      container = null;
      logger.info('Application shutting down...');
      // Cuts the renderer off, aborts the scheduler's jobs, disposes the providers (ParkStay's
      // queue gate with them) and closes the database once the jobs have settled; resolves
      // once every browser has closed
      return closing.dispose();
    },
    log: logger,
  });
}
