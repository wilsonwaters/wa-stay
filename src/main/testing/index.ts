/**
 * Test-support code for the Electron smoke tests (architecture-notes §12.14).
 *
 * Everything here is driven by environment variables that only an app running from source
 * reads (`env.ts`: unpackaged and not loaded from an asar archive). A packaged build, even with
 * its executable renamed to `electron`, never sets userData from the environment, never serves
 * fixtures and never installs the network guard.
 *
 * `src/main/index.ts` calls:
 * 1. `applyTestEnvHooks(app)` before the single-instance lock, for the userData override;
 * 2. `selectProviders(hooks, BUILT_IN_PROVIDERS)` after `ready`, for the providers the
 *    container registers (`WA_STAY_PROVIDERS`);
 * 3. `startFixtureMode(hooks, …)` after `ready` and before the container, which gives every
 *    provider a `FixtureHttpClient` when it returns a config, and the document windows
 *    `serveDocumentFixtures`.
 */

import type { FixtureHttpClientOptions } from './fixture-http-client';
import type { TestHooks } from './env';
import { installNetworkGuard, type GuardableSession, type SessionSource } from './network-guard';
import { unexpectedRequestsLogPath } from './request-log';

export * from './env';
export * from './fixture-documents';
export * from './fixture-http-client';
export * from './network-guard';
export * from './request-log';

/** What the composition root needs to serve providers from fixtures. */
export type FixtureModeOptions = Omit<FixtureHttpClientOptions, 'providerId'>;

export interface FixtureModeDeps {
  app: SessionSource;
  /** Electron's `session` module; read only in fixture mode. */
  session: { readonly defaultSession: GuardableSession };
  userDataDir: string;
  log: { warn(message: string): void };
}

/**
 * Fixture mode: installs the network guard and returns the options for the providers'
 * `FixtureHttpClient`. Returns undefined, and installs nothing, unless the hooks ask for it
 * (never unless running from source).
 */
export function startFixtureMode(
  hooks: TestHooks,
  deps: FixtureModeDeps
): FixtureModeOptions | undefined {
  const mode = hooks.fixtureMode;
  if (!mode) return undefined;

  const logFile = unexpectedRequestsLogPath(deps.userDataDir);
  installNetworkGuard({
    sessions: [deps.session.defaultSession],
    app: deps.app,
    allowHosts: mode.allowHosts,
    logFile,
  });
  const allowed = mode.allowHosts.length > 0 ? mode.allowHosts.join(', ') : 'none';
  deps.log.warn(
    `Test fixture mode: providers answer from ${mode.fixturesDir}; network blocked (allowed hosts: ${allowed})`
  );
  return { fixturesDir: mode.fixturesDir, logFile };
}
