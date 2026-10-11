/**
 * The Electron shell's first steps, in the order they must run, all before `ready`:
 *
 * 1. `configureAppPaths`: userData becomes `<appData>/WA Stay`, then (from source only) the
 *    test-only override `WA_STAY_USER_DATA_DIR` (§12.14). Everything after this reads it:
 *    the single-instance lock, the log files, the vault (§12.23).
 * 2. `app.setAppUserModelId` (Windows): the packaged app uses its appId, so taskbar
 *    grouping, toasts and the launch-at-login entry name agree with the installer's
 *    shortcuts. From source it is `process.execPath` (the Electron binary), so a dev run
 *    never shares an identity with the installed app.
 * 3. The single-instance lock, which lives in userData.
 *
 * After `ready`, `index.ts` runs the legacy install migration, then opens the database.
 */

import type { TestEnv, TestHooks } from '../testing/env';
import { configureAppPaths, type AppPaths, type PathsApp } from './paths';
import {
  acquireSingleInstance,
  type SingleInstance,
  type SingleInstanceApp,
  type SingleInstanceOptions,
} from './single-instance';

/** electron-builder's `appId`, kept from v1.x so installs upgrade in place (O1). */
export const APP_USER_MODEL_ID = 'com.parkstay.bookings';

/** The part of Electron's `app` the shell's first steps use. */
export interface ShellApp extends PathsApp, SingleInstanceApp {
  /** Windows only: Electron defines it on no other platform. */
  setAppUserModelId?(id: string): void;
}

export interface BootstrapOptions extends SingleInstanceOptions {
  /** `process.platform`. */
  platform: NodeJS.Platform;
  /** `process.execPath`: the AppUserModelId when running from source. */
  execPath: string;
  /** `process.env` (the test hooks are read only when running from source). */
  env?: TestEnv;
}

export interface Shell {
  readonly paths: AppPaths;
  /** The test-only hooks in effect (none unless running from source). */
  readonly testHooks: TestHooks;
  readonly instance: SingleInstance;
}

export function bootstrapShell(app: ShellApp, options: BootstrapOptions): Shell {
  const { platform, execPath, env, ...singleInstance } = options;
  const { paths, testHooks } = configureAppPaths(app, env);
  if (platform === 'win32') {
    app.setAppUserModelId?.(app.isPackaged ? APP_USER_MODEL_ID : execPath);
  }
  const instance = acquireSingleInstance(app, singleInstance);
  return { paths, testHooks, instance };
}
