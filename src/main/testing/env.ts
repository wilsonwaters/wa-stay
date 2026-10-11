/**
 * Test-only environment hooks (architecture-notes §12.14).
 *
 * They are honoured only when the app runs from source: unpackaged, and not loaded from an asar
 * archive (`runsFromSource`, `app/app-source.ts`), so a packaged executable renamed to
 * `electron` still ignores them. A packaged build reads none of these variables, so nothing
 * here is production behaviour.
 *
 * - `WA_STAY_USER_DATA_DIR` replaces userData: the database, logs, secrets and the
 *   single-instance lock. The Electron smoke tests (`tests/e2e`) give every launch its own.
 * - `WA_STAY_LEGACY_DATA_DIR` is reserved for B3: the legacy data folder to migrate from.
 *   When userData is overridden without it, the legacy source is disabled (`null`), so a
 *   test never reads a real profile.
 * - `WA_STAY_E2E_FIXTURES_DIR` turns on network-free fixture mode: every provider's HTTP is
 *   served from `<dir>/<providerId>/manifest.json` (`FixtureHttpClient`), and the network
 *   guard cancels any other http(s) request the app's sessions make.
 * - `WA_STAY_E2E_ALLOW_HOSTS` lists the hosts the guard lets through in fixture mode,
 *   comma-separated, empty by default. An entry also allows its subdomains.
 * - `WA_STAY_PROVIDERS` lists the built-in providers to register, by id, comma-separated
 *   (`parkstay`); the others are left out. The Electron smoke tests set it, so a journey sees
 *   the providers it was written for however many are built in. An id that is not a built-in
 *   provider fails start-up (`selectProviders`).
 */

import path from 'path';
import { runsFromSource } from '../app/app-source';

export const TEST_ENV = {
  userDataDir: 'WA_STAY_USER_DATA_DIR',
  legacyDataDir: 'WA_STAY_LEGACY_DATA_DIR',
  fixturesDir: 'WA_STAY_E2E_FIXTURES_DIR',
  allowHosts: 'WA_STAY_E2E_ALLOW_HOSTS',
  providers: 'WA_STAY_PROVIDERS',
} as const;

export interface FixtureModeConfig {
  /** Absolute. Holds one folder per provider, each with a `manifest.json`. */
  readonly fixturesDir: string;
  /** Lower-case hosts the network guard allows (each with its subdomains). */
  readonly allowHosts: readonly string[];
}

export interface TestHooks {
  /** Absolute; replaces userData. */
  readonly userDataDir?: string;
  /**
   * The legacy data folder for B3's migration: an absolute path when overridden, `null` when
   * userData is overridden without one (migration disabled), and undefined otherwise (the
   * real legacy folder).
   */
  readonly legacyDataDir?: string | null;
  /** Set only in fixture mode. */
  readonly fixtureMode?: FixtureModeConfig;
  /**
   * The ids `WA_STAY_PROVIDERS` lists, as given (possibly none, or unknown ids:
   * `selectProviders` refuses those). Undefined when it is not set: every built-in provider.
   */
  readonly providers?: readonly string[];
}

export type TestEnv = Readonly<Record<string, string | undefined>>;

/** The part of Electron's `app` the hooks use. */
export interface TestHooksApp {
  readonly isPackaged: boolean;
  getAppPath(): string;
  setPath(name: 'userData', value: string): void;
}

function readPath(env: TestEnv, name: string, cwd: string): string | undefined {
  const value = env[name]?.trim();
  return value ? path.resolve(cwd, value) : undefined;
}

export function parseAllowHosts(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0);
}

/** `WA_STAY_PROVIDERS`'s ids; undefined when it is unset or blank. */
export function parseProviderIds(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;
  return value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * The built-in providers to register: those `hooks.providers` lists, in their built-in order,
 * or all of `builtIns` when the hook is not set. Throws when the list names no provider or an
 * id that is not built in, so a mistyped list stops start-up instead of running a test with
 * other providers than it was written for.
 */
export function selectProviders<T extends { readonly id: string }>(
  hooks: TestHooks,
  builtIns: readonly T[]
): readonly T[] {
  const ids = hooks.providers;
  if (!ids) return builtIns;
  const known = builtIns.map((factory) => factory.id);
  const unknown = ids.filter((id) => !known.includes(id));
  if (ids.length === 0 || unknown.length > 0) {
    const problem =
      ids.length === 0
        ? 'names no provider'
        : `names ${unknown.map((id) => `"${id}"`).join(', ')}, not a built-in provider`;
    throw new Error(
      `${TEST_ENV.providers} ${problem}. The built-in providers are: ${known.join(', ')}.`
    );
  }
  return builtIns.filter((factory) => ids.includes(factory.id));
}

/**
 * The hooks the environment asks for. Unless the app runs from source (`isPackaged` false and
 * `appPath` outside any asar archive): none, whatever the environment says. Relative paths
 * resolve against `cwd`.
 */
export function resolveTestHooks(options: {
  env: TestEnv;
  /** `app.isPackaged`. */
  isPackaged: boolean;
  /** `app.getAppPath()`. */
  appPath: string;
  cwd: string;
}): TestHooks {
  const { env, isPackaged, appPath, cwd } = options;
  if (!runsFromSource({ isPackaged, appPath })) return {};

  const userDataDir = readPath(env, TEST_ENV.userDataDir, cwd);
  const legacyOverride = readPath(env, TEST_ENV.legacyDataDir, cwd);
  const fixturesDir = readPath(env, TEST_ENV.fixturesDir, cwd);
  const providers = parseProviderIds(env[TEST_ENV.providers]);

  return {
    ...(userDataDir ? { userDataDir } : {}),
    ...(legacyOverride
      ? { legacyDataDir: legacyOverride }
      : userDataDir
        ? { legacyDataDir: null }
        : {}),
    ...(fixturesDir
      ? { fixtureMode: { fixturesDir, allowHosts: parseAllowHosts(env[TEST_ENV.allowHosts]) } }
      : {}),
    ...(providers ? { providers } : {}),
  };
}

/**
 * Resolves the hooks and applies the userData override. Call it before anything reads
 * userData, and as the last change to it: the single-instance lock lives there.
 */
export function applyTestEnvHooks(
  app: TestHooksApp,
  env: TestEnv = process.env,
  cwd: string = process.cwd()
): TestHooks {
  const hooks = resolveTestHooks({
    env,
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    cwd,
  });
  if (hooks.userDataDir) app.setPath('userData', hooks.userDataDir);
  return hooks;
}
