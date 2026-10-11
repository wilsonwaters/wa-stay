/**
 * Where the app's files are on disk.
 *
 * - The data folder (userData) is `<appData>/WA Stay`, with the database `wa-stay.db`.
 *   `configureAppPaths` pins it before `ready` (architecture-notes §6, §12.23): the
 *   single-instance lock, the log files, the vault's key and the providers' browser profiles
 *   all live there.
 * - v1.x kept its data in `<appData>/parkstay-bookings` (legacy-name-ok), and the v2
 *   installer may have snapshotted it into `<userData>/legacy-snapshot` (§12.12). The
 *   first-run migration (`migration/legacy-install.ts`) copies from one of them and writes
 *   `migration.json`.
 * - The icons the window, notifications and emails show.
 */

import { app } from 'electron';
import path from 'path';
import {
  applyTestEnvHooks,
  resolveTestHooks,
  type TestEnv,
  type TestHooks,
  type TestHooksApp,
} from '../testing/env';

/** The data folder's name under appData. Existing data depends on it: never change it. */
export const DATA_FOLDER_NAME = 'WA Stay';
/** The database file in the data folder. */
export const DATABASE_FILE_NAME = 'wa-stay.db';
/** The v1.x data folder (package.json `name` in v1.x). Never written to. */
export const LEGACY_DATA_FOLDER_NAME = 'parkstay-bookings'; // legacy-name-ok
/** The v1.x database file, in the legacy folder and in the installer's snapshot. */
export const LEGACY_DATABASE_FILE_NAME = 'parkstay.db'; // legacy-name-ok
/** Where the v2 installer copies the legacy data before the v1 uninstaller runs (B2). */
export const LEGACY_SNAPSHOT_FOLDER_NAME = 'legacy-snapshot';
/** What the first-run migration did (`migration/legacy-install.ts`). */
export const MIGRATION_MARKER_FILE_NAME = 'migration.json';

export interface AppPaths {
  /** The data folder: `<appData>/WA Stay`, or `WA_STAY_USER_DATA_DIR` (from source only). */
  readonly userData: string;
  /** `<userData>/wa-stay.db`. */
  readonly dbPath: string;
  /**
   * The v1.x data folder, `<appData>/parkstay-bookings` (legacy-name-ok), or
   * `WA_STAY_LEGACY_DATA_DIR`. Null when userData is overridden without a legacy override:
   * tests never read a real profile.
   */
  readonly legacyUserData: string | null;
  /** `<legacyUserData>/parkstay.db` (legacy-name-ok), or null with `legacyUserData`. */
  readonly legacyDbPath: string | null;
  /** `<userData>/legacy-snapshot`, written by the installer. */
  readonly snapshotDir: string;
  /** `<userData>/migration.json`. */
  readonly markerPath: string;
}

export interface ResolveAppPathsOptions {
  /** `app.getPath('appData')`. */
  appData: string;
  /** `process.env`: the test hooks (§12.14) are read from it, only when running from source. */
  env: TestEnv;
  /** `app.isPackaged`. */
  isPackaged: boolean;
  /** `app.getAppPath()`: with `isPackaged`, decides whether the app runs from source. */
  appPath: string;
  /** Resolves relative hook paths. Defaults to `process.cwd()`. */
  cwd?: string;
  /** `path.win32` or `path.posix`; defaults to this platform's. */
  pathApi?: path.PlatformPath;
}

/**
 * The data paths, from appData and (when running from source) the test hooks. Pure: it
 * neither reads the disk nor changes the app. A portable build uses the same folders: only the
 * executable is extracted to a temp folder.
 */
export function resolveAppPaths({
  appData,
  env,
  isPackaged,
  appPath,
  cwd = process.cwd(),
  pathApi = path,
}: ResolveAppPathsOptions): AppPaths {
  const hooks = resolveTestHooks({ env, isPackaged, appPath, cwd });
  const userData = hooks.userDataDir ?? pathApi.join(appData, DATA_FOLDER_NAME);
  const legacyUserData =
    hooks.legacyDataDir === undefined
      ? pathApi.join(appData, LEGACY_DATA_FOLDER_NAME)
      : hooks.legacyDataDir;

  return {
    userData,
    dbPath: pathApi.join(userData, DATABASE_FILE_NAME),
    legacyUserData,
    legacyDbPath: legacyUserData ? pathApi.join(legacyUserData, LEGACY_DATABASE_FILE_NAME) : null,
    snapshotDir: pathApi.join(userData, LEGACY_SNAPSHOT_FOLDER_NAME),
    markerPath: pathApi.join(userData, MIGRATION_MARKER_FILE_NAME),
  };
}

/** The part of Electron's `app` `configureAppPaths` uses. */
export interface PathsApp extends TestHooksApp {
  getPath(name: 'appData'): string;
}

export interface ConfiguredPaths {
  readonly paths: AppPaths;
  /** The test-only hooks in effect (none unless running from source), for fixture mode. */
  readonly testHooks: TestHooks;
}

/**
 * Pins userData to `<appData>/WA Stay`, then applies the test-only override
 * (`applyTestEnvHooks`, from source only), and returns the data paths that result. Call it
 * before `ready` and before anything reads userData: the single-instance lock lives there.
 */
export function configureAppPaths(
  electronApp: PathsApp,
  env: TestEnv = process.env,
  cwd: string = process.cwd()
): ConfiguredPaths {
  const appData = electronApp.getPath('appData');
  electronApp.setPath('userData', path.join(appData, DATA_FOLDER_NAME));
  const testHooks = applyTestEnvHooks(electronApp, env, cwd);
  const paths = resolveAppPaths({
    appData,
    env,
    isPackaged: electronApp.isPackaged,
    appPath: electronApp.getAppPath(),
    cwd,
  });
  return { paths, testHooks };
}

export interface AppLocation {
  /** `app.isPackaged`. */
  isPackaged: boolean;
  /** `app.getAppPath()`: the project root when running from source. */
  appPath: string;
  /** `process.resourcesPath`: the packaged app's `resources` folder. */
  resourcesPath: string;
}

/**
 * The WA Stay icon as a PNG, for the window (Linux and development) and OS notifications.
 *
 * - Packaged: `<resources>/icons/icon.png`, copied there by `extraResources` in
 *   `electron-builder.json`. A path under `app.getAppPath()` would point inside `app.asar`,
 *   which Electron cannot load an icon from.
 * - From source: `<project>/resources/icons/icon.png`.
 */
export function getBrandIconPath(location: AppLocation = currentLocation()): string {
  return iconPath('icon.png', location);
}

/**
 * The small (80 px) WA Stay icon the SMTP emails show inline at 40 px, from the same place as
 * `getBrandIconPath` (`extraResources` ships it too). The 1024 px icon would add about 50 KB to
 * every email.
 */
export function getEmailLogoPath(location: AppLocation = currentLocation()): string {
  return iconPath('email-logo.png', location);
}

function iconPath(file: string, location: AppLocation): string {
  return location.isPackaged
    ? path.join(location.resourcesPath, 'icons', file)
    : path.join(location.appPath, 'resources', 'icons', file);
}

function currentLocation(): AppLocation {
  return {
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  };
}
