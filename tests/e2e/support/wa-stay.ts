/**
 * The Electron smoke-test harness: `test` is Playwright's `test` with a `launchWaStay()`
 * fixture that starts the built app, isolated and network-free.
 *
 * Every launch:
 * - gets its own temp userData (`WA_STAY_USER_DATA_DIR`), unless it reuses one to relaunch,
 *   and checks that the app really uses it before anything else (the isolation guarantee);
 * - runs in fixture mode (`WA_STAY_E2E_FIXTURES_DIR`): providers answer from
 *   `tests/e2e/fixtures/http`, and every other request is cancelled and logged;
 * - registers only the providers the journey was written for (`WA_STAY_PROVIDERS`): ParkStay
 *   (`DEFAULT_PROVIDERS`) unless the launch passes its own `providers`, however many providers
 *   are built in;
 * - runs as a production build (`NODE_ENV=production`, no `ELECTRON_RENDERER_URL`, no Mapbox
 *   token), in Perth time and Australian English;
 * - is online as far as the window can tell (`navigator.onLine`), whatever the host's network
 *   (`forceOnline`);
 * - records a trace and the main process's output.
 *
 * After the test, every app still running is closed (or killed), then the temp folders
 * (`tempDir`) are removed.
 * When a test fails, the window's trace and a screenshot, the main-process output, the main
 * log file, the renderer console errors and the unexpected requests are attached to the
 * report. (The config's `use.trace` records only the test's own steps, so the harness
 * traces the Electron window itself; see playwright.config.ts for the screenshot.)
 */

import type { ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from '@playwright/test';
import {
  readUnexpectedRequests,
  unexpectedRequestsLogPath,
  type UnexpectedRequest,
} from '../../../src/main/testing/request-log';
import { HTTP_FIXTURES_DIR, REPO_ROOT } from './paths';

/**
 * The providers a launch registers unless it passes its own: the journeys' counts and
 * pre-selections (11 places, ParkStay chosen for you) are ParkStay's fixture.
 */
const DEFAULT_PROVIDERS: readonly string[] = ['parkstay'];

/** How long a launch may take to show its first page heading. */
const STARTUP_TIMEOUT_MS = 30_000;
/** How long `app.close()` may take before the process is killed in teardown. */
const CLOSE_TIMEOUT_MS = 10_000;

export interface ConsoleError {
  kind: 'console' | 'pageerror';
  /** The console text, or the uncaught exception's message. */
  text: string;
  /** The script that logged it, or the resource that failed to load. */
  url: string;
}

export interface WaStay {
  app: ElectronApplication;
  /** The main window. */
  window: Page;
  /** This launch's userData folder. */
  userDataDir: string;
  /** Renderer console errors and uncaught exceptions in every window since launch. */
  consoleErrors(): Promise<ConsoleError[]>;
  /** The main process's stdout and stderr so far. */
  mainLog(): string;
  /** What fixture mode refused (`e2e-unexpected-requests.log`). */
  unexpectedRequests(): UnexpectedRequest[];
  /** Quits the app; resolves with the exit code once the process has exited. */
  close(): Promise<number | null>;
}

export interface LaunchOptions {
  /** Relaunch on an existing profile. By default each launch gets a fresh temp folder. */
  userDataDir?: string;
  /**
   * Prepares the profile before the app starts, e.g. seeds its database (`support/seed.ts`).
   * Runs on the fresh temp folder, or on `userDataDir`.
   */
  prepare?: (userDataDir: string) => void | Promise<void>;
  /**
   * The built-in providers to register, by id (`WA_STAY_PROVIDERS`). Default:
   * `DEFAULT_PROVIDERS`. An id that is not built in stops the app at start-up.
   */
  providers?: readonly string[];
  /**
   * Extra environment, e.g. `WA_STAY_E2E_ALLOW_HOSTS` for documentation screenshots or
   * `WA_STAY_LEGACY_DATA_DIR` for the v1.x upgrade.
   */
  env?: Record<string, string>;
  /**
   * Extra Electron switches, after the project root, e.g. software GL for a run with the map
   * (`explore-resize.spec.ts`). Never needed for a network-free run.
   */
  args?: string[];
}

/** Console errors the network guard explains: a request it cancelled and logged. */
export function withoutGuardedRequests(
  errors: readonly ConsoleError[],
  requests: readonly UnexpectedRequest[]
): ConsoleError[] {
  const guarded = new Set(
    requests.filter((r) => r.source === 'network-guard').map((request) => request.url)
  );
  return errors.filter(
    (error) => !(error.text.includes('net::ERR_BLOCKED_BY_CLIENT') && guarded.has(error.url))
  );
}

/**
 * Without the provider photos the network guard cancelled. Explore hot-links provider images
 * (brief O8), which fixture mode never loads; anything else the guard stopped still counts.
 */
export function withoutRemoteImages(requests: readonly UnexpectedRequest[]): UnexpectedRequest[] {
  return requests.filter(
    (request) => !(request.source === 'network-guard' && request.resourceType === 'image')
  );
}

function launchEnv(
  userDataDir: string,
  providers: readonly string[],
  extra: Record<string, string> = {}
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // Production mode, never the dev server, no Mapbox token and no inherited test hooks
    if (name === 'ELECTRON_RENDERER_URL' || name === 'MAPBOX_ACCESS_TOKEN') continue;
    if (name === 'ELECTRON_RUN_AS_NODE' || name.startsWith('WA_STAY_')) continue;
    env[name] = value;
  }
  return {
    ...env,
    NODE_ENV: 'production',
    TZ: 'Australia/Perth',
    LANG: 'en_AU.UTF-8',
    WA_STAY_USER_DATA_DIR: userDataDir,
    WA_STAY_E2E_FIXTURES_DIR: HTTP_FIXTURES_DIR,
    WA_STAY_PROVIDERS: providers.join(','),
    ...extra,
  };
}

/**
 * Makes the window report itself online (`navigator.onLine`, the `online` event). Chromium
 * derives it from the host's network interfaces, so a host with loopback only (a sandbox,
 * `unshare -n`) reads offline, and Explore then turns its availability off. Fixture mode never
 * uses the network, so the suite must not depend on it.
 *
 * DevTools network emulation with `offline: false` and no throttling overrides it. (Playwright's
 * `setOffline(false)` sends nothing unless the context was offline before.) The emulation
 * belongs to this CDP session, which is kept open for the window's life.
 */
async function forceOnline(window: Page): Promise<void> {
  const cdp = await window.context().newCDPSession(window);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- colour codes start with ESC
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function hasExited(proc: ChildProcess): boolean {
  return proc.exitCode !== null || proc.signalCode !== null;
}

/** Rejects with "`what` took more than `ms` ms" unless `promise` settles first. */
export function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} took more than ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function collectConsoleErrors(app: ElectronApplication): Promise<ConsoleError[]> {
  const errors: ConsoleError[] = [];
  for (const page of app.windows()) {
    // Read from the page's own buffer, so messages logged before the test looked are included.
    for (const message of await page.consoleMessages()) {
      if (message.type() !== 'error') continue;
      errors.push({ kind: 'console', text: message.text(), url: message.location().url });
    }
    for (const error of await page.pageErrors()) {
      errors.push({ kind: 'pageerror', text: error.stack ?? error.message, url: page.url() });
    }
  }
  return errors;
}

function tail(text: string, lines = 60): string {
  return text.split(/\r?\n/).slice(-lines).join('\n');
}

function readIfExists(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** One launch, with what teardown needs. */
class Launch implements WaStay {
  window!: Page;
  private readonly output: string[] = [];
  private consoleSnapshot: ConsoleError[] | null = null;
  private traceSaved = false;
  private closing: Promise<number | null> | null = null;
  /** Resolves with the exit code once the process has exited and its output is drained. */
  private readonly closed: Promise<number | null>;

  constructor(
    readonly app: ElectronApplication,
    readonly proc: ChildProcess,
    readonly userDataDir: string,
    readonly tracePath: string
  ) {
    proc.stdout?.on('data', (chunk) => this.output.push(stripAnsi(String(chunk))));
    proc.stderr?.on('data', (chunk) => this.output.push(stripAnsi(String(chunk))));
    this.closed = new Promise((resolve) => proc.once('close', (code) => resolve(code)));
  }

  get hasWindow(): boolean {
    return this.window !== undefined;
  }

  get running(): boolean {
    return !hasExited(this.proc);
  }

  mainLog(): string {
    return this.output.join('');
  }

  /** The app's own log file: it also has what was written before `mainLog` was listening. */
  mainLogFile(): string {
    return readIfExists(path.join(this.userDataDir, 'logs', 'combined.log'));
  }

  unexpectedRequests(): UnexpectedRequest[] {
    return readUnexpectedRequests(unexpectedRequestsLogPath(this.userDataDir));
  }

  async consoleErrors(): Promise<ConsoleError[]> {
    if (this.consoleSnapshot) return this.consoleSnapshot;
    return collectConsoleErrors(this.app);
  }

  get hasTrace(): boolean {
    return this.traceSaved;
  }

  /** Stops tracing into `tracePath` (kept or discarded in teardown). */
  async saveTrace(): Promise<void> {
    if (this.traceSaved) return;
    this.traceSaved = true;
    await this.app.context().tracing.stop({ path: this.tracePath });
  }

  close(): Promise<number | null> {
    this.closing ??= (async () => {
      if (!this.running) return this.closed;
      this.consoleSnapshot = await collectConsoleErrors(this.app).catch(() => []);
      await this.saveTrace().catch(() => undefined);
      await this.app.close();
      return this.closed;
    })();
    return this.closing;
  }

  /** Why a launch failed, with what the main process said. */
  startupError(reason: string, playwrightLog?: string): Error {
    const log = playwrightLog?.includes('Browser logs:')
      ? playwrightLog.slice(playwrightLog.indexOf('Browser logs:'))
      : `--- main process output (tail) ---\n${tail(this.mainLog()) || '(none)'}`;
    return new Error(
      [
        `WA Stay did not start: ${reason}`,
        stripAnsi(log),
        'If it says NODE_MODULE_VERSION, node_modules predates better-sqlite3 13: run `npm ci`.',
      ].join('\n')
    );
  }
}

async function startWaStay(
  testInfo: TestInfo,
  options: LaunchOptions,
  launches: Launch[],
  tempDir: TempDir
): Promise<Launch> {
  const userDataDir = options.userDataDir ?? tempDir('profile');
  await options.prepare?.(userDataDir);

  const app = await electron.launch({
    // The project root, not the main script, so Electron reads package.json (name, version, main)
    args: [
      REPO_ROOT,
      ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []),
      ...(options.args ?? []),
    ],
    cwd: REPO_ROOT,
    env: launchEnv(userDataDir, options.providers ?? DEFAULT_PROVIDERS, options.env),
  });
  const tracePath = testInfo.outputPath(`trace-${launches.length + 1}.zip`);
  const launch = new Launch(app, app.process(), userDataDir, tracePath);
  // From here on teardown closes it and reports on it, whatever happens next.
  launches.push(launch);

  // One deadline for the whole start. A failed start can block on an error dialog, so every
  // step is bounded. On a timeout the process is killed: Playwright then fails the pending call
  // with its browser log, which has everything the main process printed from its first line.
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  const step = async <T>(what: string, promise: Promise<T>): Promise<T> => {
    try {
      return await within(promise, Math.max(1, deadline - Date.now()), what);
    } catch (error) {
      launch.proc.kill('SIGKILL');
      const pending = await within(
        promise.then(
          () => null,
          (rejection: Error) => rejection
        ),
        CLOSE_TIMEOUT_MS,
        'Stopping WA Stay'
      ).catch(() => null);
      throw launch.startupError(`${what}: ${(error as Error).message}`, pending?.message);
    }
  };

  try {
    await app
      .context()
      .tracing.start({ screenshots: true, snapshots: true, title: testInfo.title });

    // The isolation guarantee: never run a test against a real profile.
    const actual = await step(
      'reading userData',
      app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
    );
    if (actual !== userDataDir) {
      throw new Error(
        `Isolation check failed: the app uses userData ${actual}, not the test's ${userDataDir}. ` +
          'Is the build current (`npm run build:e2e`)?'
      );
    }

    launch.window = await step('opening the window', app.firstWindow());
    await step('forcing the window online', forceOnline(launch.window));
    // The app is up when its page heading shows (not on ready-to-show).
    await step(
      'showing a page heading',
      launch.window.getByRole('heading', { level: 1 }).first().waitFor()
    );
    return launch;
  } catch (error) {
    if (launch.running) {
      await within(launch.saveTrace(), CLOSE_TIMEOUT_MS, 'Saving the trace').catch(() => undefined);
      // No graceful quit: a failed start can hang on an error dialog.
      launch.proc.kill('SIGKILL');
    }
    throw error;
  }
}

async function attachDiagnostics(testInfo: TestInfo, index: number, launch: Launch): Promise<void> {
  const name = (label: string): string => `${label}-${index}`;
  await testInfo.attach(name('main-process-output'), {
    body: launch.mainLog() || '(none)',
    contentType: 'text/plain',
  });
  const logFile = launch.mainLogFile();
  if (logFile)
    await testInfo.attach(name('main-log'), { body: logFile, contentType: 'text/plain' });
  const errors = await launch.consoleErrors().catch(() => []);
  if (errors.length > 0) {
    await testInfo.attach(name('renderer-console-errors'), {
      body: JSON.stringify(errors, null, 2),
      contentType: 'application/json',
    });
  }
  const requests = launch.unexpectedRequests();
  if (requests.length > 0) {
    await testInfo.attach(name('unexpected-requests'), {
      body: JSON.stringify(requests, null, 2),
      contentType: 'application/json',
    });
  }
}

async function teardown(testInfo: TestInfo, launches: Launch[]): Promise<void> {
  const failed = testInfo.status !== testInfo.expectedStatus;

  for (const [i, launch] of launches.entries()) {
    const index = i + 1;
    if (launch.running) {
      if (failed && launch.hasWindow) {
        const screenshot = await launch.window.screenshot().catch(() => null);
        if (screenshot) {
          await testInfo.attach(`screenshot-${index}`, {
            body: screenshot,
            contentType: 'image/png',
          });
        }
      }
      // A process left over from a crash or a hung quit is killed, so the next test starts clean.
      await within(launch.close(), CLOSE_TIMEOUT_MS, 'Closing WA Stay').catch(() => undefined);
      if (launch.running) launch.proc.kill('SIGKILL');
    }

    if (failed) {
      await attachDiagnostics(testInfo, index, launch);
      if (launch.hasTrace && fs.existsSync(launch.tracePath)) {
        await testInfo.attach(`trace-${index}`, {
          path: launch.tracePath,
          contentType: 'application/zip',
        });
      }
    } else {
      fs.rmSync(launch.tracePath, { force: true });
    }
  }
}

/** Makes a temp folder (`wa-stay-e2e-<label>-…`), removed after the test. */
export type TempDir = (label: string) => string;

export const test = base.extend<{
  tempDir: TempDir;
  launchWaStay: (options?: LaunchOptions) => Promise<WaStay>;
}>({
  tempDir: async ({}, use) => {
    const dirs: string[] = [];
    await use((label) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wa-stay-e2e-${label}-`));
      dirs.push(dir);
      return dir;
    });
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  },
  // On `tempDir`, so its folders are removed only after every app has closed.
  launchWaStay: async ({ tempDir }, use, testInfo) => {
    const launches: Launch[] = [];
    await use((options = {}) => startWaStay(testInfo, options, launches, tempDir));
    // A step of its own: after use() this code still runs in the setup step, which has ended.
    await base.step('Close WA Stay', () => teardown(testInfo, launches), { box: true });
  },
});

export { expect } from '@playwright/test';
