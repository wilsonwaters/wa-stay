/**
 * `PlaywrightBrowserAutomation` (V7) against a mocked `playwright-core`
 * (`tests/utils/fake-playwright.ts`): channel order and caching, the no-browser error,
 * serialised `withPage`, abort and timeouts, headed/headless relaunch, idle close, the kill
 * path, crashes, a locked profile, `registry.disposeAll()`, and the browser-driven
 * FakeProvider on it (its contract and mapping tests run on `tests/utils/fake-browser.ts`, in
 * `tests/integration/browser-provider-contract.test.ts`).
 */

jest.mock('playwright-core', () =>
  jest.requireActual('@tests/utils/fake-playwright').fakePlaywrightModule()
);

import childProcess from 'child_process';
import path from 'path';
import {
  BROWSER_CHANNEL_KEY,
  BROWSER_CLOSE_TIMEOUT_MS,
  BROWSER_IDLE_CLOSE_MS,
  BROWSER_KILL_TIMEOUT_MS,
  BrowserUnavailableError,
  DEFAULT_PAGE_TIMEOUT_MS,
  InMemoryKeyValueStore,
  isAbortError,
  PlaywrightBrowserAutomation,
  PROFILE_LOCK_RETRY_MS,
  toApiError,
  type PlaywrightBrowserAutomationOptions,
} from '@main/providers/sdk';
import { ProviderRegistry } from '@main/providers/registry';
import { renderFakeSite } from '@tests/fixtures/fake-browser-site';
import { createFakeBrowserProviderFactory } from '@tests/utils/fake-browser-provider';
import {
  fakePlaywright,
  type FakeBrowserContext,
  type FakePage,
} from '@tests/utils/fake-playwright';
import {
  createFakeProvider,
  createMemoryLogger,
  createPlaywrightTestProviderContext,
  TEST_PROVIDERS_DIR,
  type MemoryLogger,
} from '@tests/utils/fake-provider';

const PROFILE = path.join(TEST_PROVIDERS_DIR, 'fake', 'browser');

interface Harness {
  browser: PlaywrightBrowserAutomation;
  logger: MemoryLogger;
  state: InMemoryKeyValueStore;
}

const opened: PlaywrightBrowserAutomation[] = [];

function automation(overrides: Partial<PlaywrightBrowserAutomationOptions> = {}): Harness {
  const logger = createMemoryLogger();
  const state = (overrides.state as InMemoryKeyValueStore) ?? new InMemoryKeyValueStore();
  const browser = new PlaywrightBrowserAutomation({
    providerId: 'fake',
    providerName: 'Fake Parks',
    userDataDir: PROFILE,
    timezoneId: 'Australia/Perth',
    platform: 'linux',
    logger,
    ...overrides,
    state,
  });
  opened.push(browser);
  return { browser, logger, state };
}

function deferred<T = void>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Lets pending promise callbacks run. */
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const noop = async (): Promise<void> => undefined;

beforeEach(() => {
  fakePlaywright.reset();
});

afterEach(async () => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  await Promise.all(opened.splice(0).map((browser) => browser.close()));
});

describe('channel detection', () => {
  it('tries msedge first on Windows', async () => {
    const { browser } = automation({ platform: 'win32' });
    await browser.withPage(noop);
    expect(fakePlaywright.launchedWith()).toEqual(['msedge']);
  });

  it('moves from a missing msedge to chrome, and remembers chrome in the KV store', async () => {
    fakePlaywright.installed = new Set(['chrome']);
    const { browser, state } = automation({ platform: 'win32' });

    await browser.withPage(noop);

    expect(fakePlaywright.launchedWith()).toEqual(['msedge', 'chrome']);
    expect(await state.get(BROWSER_CHANNEL_KEY)).toBe('chrome');
    expect(await browser.isAvailable()).toEqual({ available: true, channel: 'chrome' });
  });

  it('tries the remembered channel first on the next launch', async () => {
    fakePlaywright.installed = new Set(['chrome']);
    const state = new InMemoryKeyValueStore();
    await automation({ platform: 'win32', state }).browser.withPage(noop);
    fakePlaywright.chromium.launchPersistentContext.mockClear();
    fakePlaywright.installed = new Set(['chrome', 'msedge']);

    // The next app start: a new instance on the same provider state.
    await automation({ platform: 'win32', state }).browser.withPage(noop);

    expect(fakePlaywright.launchedWith()).toEqual(['chrome']);
  });

  it.each(['linux', 'darwin'] as const)('tries chrome, then msedge, on %s', async (platform) => {
    fakePlaywright.installed = new Set(['msedge']);
    const { browser, state } = automation({ platform });
    await browser.withPage(noop);
    expect(fakePlaywright.launchedWith()).toEqual(['chrome', 'msedge']);
    expect(await state.get(BROWSER_CHANNEL_KEY)).toBe('msedge');
  });

  it('moves on when Playwright says a channel is not supported on this platform', async () => {
    fakePlaywright.unsupported = new Set(['chrome']);
    const { browser } = automation({ platform: 'linux' });
    await browser.withPage(noop);
    expect(fakePlaywright.launchedWith()).toEqual(['chrome', 'msedge']);
  });

  it('automates executablePath instead of detecting, and does not remember it', async () => {
    const executable = path.join(path.sep, 'opt', 'browsers', 'chromium');
    fakePlaywright.installed = new Set([executable]);
    const { browser, state } = automation({ executablePath: executable });

    await browser.withPage(noop);

    const [, options] = fakePlaywright.chromium.launchPersistentContext.mock.calls[0];
    expect(options).toMatchObject({ executablePath: executable });
    expect(options).not.toHaveProperty('channel');
    // A development build keeps Playwright's default (no sandbox): it often runs as root.
    expect(options).not.toHaveProperty('chromiumSandbox');
    expect(await state.get(BROWSER_CHANNEL_KEY)).toBeUndefined();
    expect(await browser.isAvailable()).toEqual({ available: true, channel: 'custom' });
  });

  it('launches the persistent context with the agreed settings, sandboxed', async () => {
    const { browser } = automation();
    await browser.withPage(noop);

    const [userDataDir, options] = fakePlaywright.chromium.launchPersistentContext.mock.calls[0];
    expect(userDataDir).toBe(PROFILE);
    expect(options).toEqual({
      channel: 'chrome',
      // Without it Playwright adds --no-sandbox to the person's own Edge or Chrome.
      chromiumSandbox: true,
      headless: true,
      timeout: 30_000,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      viewport: { width: 1280, height: 800 },
      locale: 'en-AU',
      timezoneId: 'Australia/Perth',
      acceptDownloads: false,
    });
    // The browser's own user agent: none is set.
    expect(options).not.toHaveProperty('userAgent');
  });
});

describe('no browser', () => {
  it('rejects withPage with BrowserUnavailableError no-browser naming Edge, Chrome and the provider', async () => {
    fakePlaywright.installed = new Set();
    const { browser, logger } = automation({ platform: 'win32' });

    const error = await browser.withPage(noop).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BrowserUnavailableError);
    expect(error).toMatchObject({
      code: 'browser-unavailable',
      reason: 'no-browser',
      providerId: 'fake',
      message: 'WA Stay needs Microsoft Edge or Google Chrome installed to use Fake Parks',
    });
    expect(toApiError(error)).toEqual({
      code: 'PROVIDER_ERROR',
      message: 'WA Stay needs Microsoft Edge or Google Chrome installed to use Fake Parks',
    });
    expect(fakePlaywright.launchedWith()).toEqual(['msedge', 'chrome']);
    expect(logger.lines.map((l) => l.message)).toContain(
      'No browser to automate (tried msedge, chrome)'
    );

    // Answered from what the launch found, without another launch.
    expect(await browser.isAvailable()).toEqual({ available: false, reason: 'no-browser' });
    expect(fakePlaywright.chromium.launch).not.toHaveBeenCalled();
  });

  it('isAvailable probes with a throwaway browser when nothing has launched, and keeps the answer', async () => {
    fakePlaywright.installed = new Set();
    expect(await automation().browser.isAvailable()).toEqual({
      available: false,
      reason: 'no-browser',
    });

    fakePlaywright.reset();
    fakePlaywright.installed = new Set(['msedge']);
    const { browser, state } = automation({ platform: 'linux' });
    expect(await browser.isAvailable()).toEqual({ available: true, channel: 'msedge' });
    expect(await browser.isAvailable()).toEqual({ available: true, channel: 'msedge' });

    // Probed once per channel, headless, and closed: the provider's profile is never opened.
    expect(fakePlaywright.chromium.launch.mock.calls.map(([o]) => o?.channel)).toEqual([
      'chrome',
      'msedge',
    ]);
    expect(fakePlaywright.browsers[0].options).toMatchObject({
      headless: true,
      chromiumSandbox: true,
    });
    expect(fakePlaywright.browsers[0].close).toHaveBeenCalledTimes(1);
    expect(fakePlaywright.chromium.launchPersistentContext).not.toHaveBeenCalled();
    expect(await state.get(BROWSER_CHANNEL_KEY)).toBe('msedge');
  });

  it('does not keep a launch-failed probe: the next isAvailable probes again', async () => {
    fakePlaywright.launchError = new Error('browserType.launch: crashed');
    const { browser } = automation();

    expect(await browser.isAvailable()).toEqual({ available: false, reason: 'launch-failed' });
    expect(await browser.isAvailable()).toEqual({ available: true, channel: 'chrome' });
    // Then the definitive answer is kept.
    expect(await browser.isAvailable()).toEqual({ available: true, channel: 'chrome' });
    expect(fakePlaywright.chromium.launch).toHaveBeenCalledTimes(2);
  });

  it('reports a browser that is installed but does not start as launch-failed, retryable', async () => {
    fakePlaywright.launchError = new Error('browserType.launchPersistentContext: crashed');
    const { browser } = automation();
    await expect(browser.withPage(noop)).rejects.toMatchObject({
      name: 'BrowserUnavailableError',
      reason: 'launch-failed',
      retryable: true,
    });
    // The next call tries again.
    await expect(browser.withPage(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('withPage', () => {
  it('runs two concurrent calls on one provider strictly one after the other', async () => {
    const { browser } = automation();
    const release = deferred();
    const order: string[] = [];

    const a = browser.withPage(async () => {
      order.push('a:start');
      await release.promise;
      order.push('a:end');
      return 'a';
    });
    const b = browser.withPage(async () => {
      order.push('b:start');
      return 'b';
    });
    for (let i = 0; i < 5; i++) await flush();
    expect(order).toEqual(['a:start']);

    release.resolve();
    await expect(Promise.all([a, b])).resolves.toEqual(['a', 'b']);
    expect(order).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('lets the next call run after one rejects', async () => {
    const { browser } = automation();
    const first = browser.withPage(async () => {
      throw new Error('scrape failed');
    });
    const second = browser.withPage(async () => 'second');
    await expect(first).rejects.toThrow('scrape failed');
    await expect(second).resolves.toBe('second');
  });

  it('closes the page even when fn throws', async () => {
    const { browser } = automation();
    let used: FakePage | undefined;

    await expect(
      browser.withPage(async (page) => {
        used = page as unknown as FakePage;
        throw new Error('selector not found');
      })
    ).rejects.toThrow('selector not found');

    expect(used?.close).toHaveBeenCalled();
    expect(used?.isClosed()).toBe(true);
    expect(fakePlaywright.openPages()).toBe(0);
  });

  it('launches the persistent context once, with userDataDir ending in providers/fake/browser', async () => {
    const ctx = createPlaywrightTestProviderContext('fake');
    opened.push(ctx.browser as PlaywrightBrowserAutomation);

    await ctx.browser.withPage(noop);
    await ctx.browser.withPage(noop);

    expect(fakePlaywright.chromium.launchPersistentContext).toHaveBeenCalledTimes(1);
    const [userDataDir] = fakePlaywright.chromium.launchPersistentContext.mock.calls[0];
    expect(userDataDir.endsWith(path.join('providers', 'fake', 'browser'))).toBe(true);
  });

  it('uses the blank page of a fresh context, then a new page per call, and closes every page', async () => {
    const { browser } = automation();
    const pages: unknown[] = [];

    await browser.withPage(async (page) => {
      pages.push(page);
      // A popup the provider's flow opened.
      await fakePlaywright.contexts[0].newPage();
    });
    expect(fakePlaywright.openPages()).toBe(0);

    await browser.withPage(async (page) => void pages.push(page));
    const [context] = fakePlaywright.contexts;
    expect(context.newPage).toHaveBeenCalledTimes(2);
    expect(pages[0]).not.toBe(pages[1]);
    expect(context.pages()).toEqual([]);
  });

  it('rejects with AbortError and closes the page when the signal aborts mid-fn', async () => {
    const { browser } = automation();
    const controller = new AbortController();
    const started = deferred<FakePage>();

    const run = browser.withPage(
      async (page) => {
        started.resolve(page as unknown as FakePage);
        // Waits on the page, as a scrape would; fails once the page closes.
        await page.goto('https://fake.example/slow');
        await new Promise((resolve) => (page as unknown as FakePage).once('close', resolve));
        throw new Error('page closed under fn');
      },
      { signal: controller.signal }
    );
    const page = await started.promise;
    controller.abort();

    const error = await run.catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(page.close).toHaveBeenCalled();
    expect(page.isClosed()).toBe(true);

    // The provider is free for the next call.
    await expect(browser.withPage(async () => 'next')).resolves.toBe('next');
  });

  it('rejects an already-aborted call without launching', async () => {
    const { browser } = automation();
    const controller = new AbortController();
    controller.abort();
    const fn = jest.fn(noop);

    const error = await browser.withPage(fn, { signal: controller.signal }).catch((e) => e);

    expect(isAbortError(error)).toBe(true);
    expect(fn).not.toHaveBeenCalled();
    expect(fakePlaywright.chromium.launchPersistentContext).not.toHaveBeenCalled();
  });

  it('rejects a queued call aborted while it waits, and never runs it', async () => {
    const { browser } = automation();
    const release = deferred();
    const first = browser.withPage(() => release.promise);
    const controller = new AbortController();
    const fn = jest.fn(noop);
    const queued = browser.withPage(fn, { signal: controller.signal });

    controller.abort();
    expect(isAbortError(await queued.catch((e) => e))).toBe(true);
    release.resolve();
    await first;
    await flush();
    expect(fn).not.toHaveBeenCalled();
    expect(fakePlaywright.openPages()).toBe(0);
  });

  it('applies timeoutMs to page actions and navigation (default 60 s)', async () => {
    const { browser } = automation();
    let page: FakePage | undefined;

    await browser.withPage(async (p) => void (page = p as unknown as FakePage), {
      timeoutMs: 1000,
    });
    expect(page?.setDefaultTimeout).toHaveBeenCalledWith(1000);
    expect(page?.setDefaultNavigationTimeout).toHaveBeenCalledWith(1000);

    await browser.withPage(async (p) => void (page = p as unknown as FakePage));
    expect(page?.setDefaultTimeout).toHaveBeenCalledWith(DEFAULT_PAGE_TIMEOUT_MS);
    expect(page?.setDefaultNavigationTimeout).toHaveBeenCalledWith(DEFAULT_PAGE_TIMEOUT_MS);
  });
});

describe('headed and headless', () => {
  it('closes the headless context once and relaunches headed when headed is requested', async () => {
    const { browser, logger } = automation();
    await browser.withPage(noop);
    const [headless] = fakePlaywright.contexts;
    expect(headless.options).toMatchObject({ headless: true });

    await browser.withPage(
      async () => {
        expect(headless.close).toHaveBeenCalledTimes(1);
        expect(fakePlaywright.chromium.launchPersistentContext).toHaveBeenCalledTimes(2);
        expect(fakePlaywright.contexts[1].options).toMatchObject({ headless: false });
      },
      { headed: true }
    );

    expect(headless.close).toHaveBeenCalledTimes(1);
    expect(logger.lines.map((l) => l.message)).toContain('Relaunching the browser headed');
  });

  it('closes a headed window when its step is done; the next call is headless again', async () => {
    const { browser } = automation();
    await browser.withPage(noop, { headed: true });
    const [headed] = fakePlaywright.contexts;
    expect(headed.close).toHaveBeenCalledTimes(1);

    await browser.withPage(noop);
    expect(fakePlaywright.contexts[1].options).toMatchObject({ headless: true });
  });
});

describe('lifecycle', () => {
  it('closes the context after 5 minutes without a call, and relaunches on the next one', async () => {
    jest.useFakeTimers();
    const { browser } = automation();
    await browser.withPage(noop);
    const [context] = fakePlaywright.contexts;

    await jest.advanceTimersByTimeAsync(BROWSER_IDLE_CLOSE_MS - 1);
    expect(context.close).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(context.close).toHaveBeenCalledTimes(1);

    await browser.withPage(noop);
    expect(fakePlaywright.chromium.launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it('restarts the idle countdown on every call', async () => {
    jest.useFakeTimers();
    const { browser } = automation();
    await browser.withPage(noop);
    await jest.advanceTimersByTimeAsync(BROWSER_IDLE_CLOSE_MS - 1000);
    await browser.withPage(noop);
    await jest.advanceTimersByTimeAsync(BROWSER_IDLE_CLOSE_MS - 1000);
    expect(fakePlaywright.contexts[0].close).not.toHaveBeenCalled();
  });

  it('close() resolves within 5 s when context.close() hangs, by killing the browser process group', async () => {
    jest.useFakeTimers();
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const { browser } = automation();
    await browser.withPage(noop);
    const [context] = fakePlaywright.contexts;
    context.hangOnClose = true;

    let closed = false;
    const closing = browser.close().then(() => (closed = true));
    await jest.advanceTimersByTimeAsync(BROWSER_CLOSE_TIMEOUT_MS - 1);
    expect(closed).toBe(false);
    expect(kill).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await closing;
    expect(closed).toBe(true);
    expect(kill).toHaveBeenCalledWith(-context.pid, 'SIGKILL');
  });

  it('kills the process tree with taskkill on Windows', async () => {
    jest.useFakeTimers();
    const spawnSync = jest
      .spyOn(childProcess, 'spawnSync')
      .mockReturnValue({} as ReturnType<typeof childProcess.spawnSync>);
    const { browser } = automation({ platform: 'win32' });
    await browser.withPage(noop);
    const [context] = fakePlaywright.contexts;
    context.hangOnClose = true;

    const closing = browser.close();
    await jest.advanceTimersByTimeAsync(BROWSER_CLOSE_TIMEOUT_MS);
    await closing;

    expect(spawnSync).toHaveBeenCalledWith(
      'taskkill',
      ['/pid', String(context.pid), '/T', '/F'],
      // Bounded: spawnSync blocks the main process.
      expect.objectContaining({ windowsHide: true, timeout: BROWSER_KILL_TIMEOUT_MS })
    );
  });

  it.each([
    ['its context closes', (context: FakeBrowserContext) => context.crash()],
    ['its browser disconnects', (context: FakeBrowserContext) => context.disconnect()],
  ])(
    'does not kill a browser that exits while close() hangs (%s): its pid may be reused',
    async (_how, exit) => {
      jest.useFakeTimers();
      const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
      const spawnSync = jest.spyOn(childProcess, 'spawnSync');
      const { browser, logger } = automation();
      await browser.withPage(noop);
      const [context] = fakePlaywright.contexts;
      context.hangOnClose = true;

      let closed = false;
      const closing = browser.close().then(() => (closed = true));
      await jest.advanceTimersByTimeAsync(1000);
      exit(context);

      // close() still waits for context.close() (it flushes the profile), at most 5 s.
      await jest.advanceTimersByTimeAsync(BROWSER_CLOSE_TIMEOUT_MS - 1000);
      await closing;
      expect(closed).toBe(true);
      expect(kill).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
      expect(logger.lines.map((l) => l.message)).toContain(
        'The browser exited but its close did not finish within 5 s; not killing it'
      );
    }
  );

  it('does not kill a browser that exited on its own before close()', async () => {
    jest.useFakeTimers();
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const { browser } = automation();
    await browser.withPage(noop);
    const [context] = fakePlaywright.contexts;
    context.hangOnClose = true;
    context.disconnect();

    const closing = browser.close();
    await jest.advanceTimersByTimeAsync(BROWSER_CLOSE_TIMEOUT_MS);
    await closing;

    expect(context.close).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  });

  it('close() does not kill a browser that closes in time', async () => {
    const kill = jest.spyOn(process, 'kill');
    const { browser } = automation();
    await browser.withPage(noop);
    await browser.close();
    expect(fakePlaywright.contexts[0].close).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
  });

  it('rejects withPage while closing, without relaunching', async () => {
    jest.useFakeTimers();
    jest.spyOn(process, 'kill').mockImplementation(() => true);
    const { browser } = automation();
    await browser.withPage(noop);
    fakePlaywright.contexts[0].hangOnClose = true;

    const closing = browser.close();
    await expect(browser.withPage(noop)).rejects.toMatchObject({
      name: 'BrowserUnavailableError',
      reason: 'closing',
    });
    expect(await browser.isAvailable()).toEqual({ available: false, reason: 'closing' });
    await jest.advanceTimersByTimeAsync(BROWSER_CLOSE_TIMEOUT_MS);
    await closing;
    await expect(browser.withPage(noop)).rejects.toMatchObject({ reason: 'closing' });
    expect(fakePlaywright.chromium.launchPersistentContext).toHaveBeenCalledTimes(1);
  });

  it('turns the failure of a call that close() interrupts into BrowserUnavailableError closing', async () => {
    const { browser } = automation();
    const started = deferred();
    const run = browser.withPage(async (page) => {
      started.resolve();
      await page.goto('https://fake.example/');
    });
    await started.promise;
    await browser.close();
    await expect(run).rejects.toMatchObject({ reason: 'closing' });
  });

  it('drops a crashed or disconnected context and relaunches on the next call', async () => {
    fakePlaywright.installed = new Set(['msedge']);
    const { browser, logger } = automation();
    await browser.withPage(noop);
    fakePlaywright.contexts[0].crash();

    expect(logger.lines.map((l) => l.message)).toContain(
      'The browser closed by itself (crash, update or disconnect)'
    );
    await expect(browser.withPage(async () => 'again')).resolves.toBe('again');
    // The second launch starts with the channel that worked.
    expect(fakePlaywright.launchedWith()).toEqual(['chrome', 'msedge', 'msedge']);
  });

  it('retries a locked profile once after 1 s', async () => {
    jest.useFakeTimers();
    fakePlaywright.profileLockedLaunches = 1;
    const { browser } = automation();

    const run = browser.withPage(async () => 'ok');
    await jest.advanceTimersByTimeAsync(PROFILE_LOCK_RETRY_MS);

    await expect(run).resolves.toBe('ok');
    expect(fakePlaywright.chromium.launchPersistentContext).toHaveBeenCalledTimes(2);
  });

  it('raises profile-locked, with the path in the log, when the profile stays locked', async () => {
    jest.useFakeTimers();
    fakePlaywright.profileLockedLaunches = 2;
    const { browser, logger } = automation();

    const run = browser.withPage(noop).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(PROFILE_LOCK_RETRY_MS);

    expect(await run).toMatchObject({ name: 'BrowserUnavailableError', reason: 'profile-locked' });
    expect(logger.lines).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: `The browser profile ${PROFILE} is still locked`,
      })
    );
    expect(fakePlaywright.chromium.launchPersistentContext).toHaveBeenCalledTimes(2);
  });
});

describe('registry.disposeAll()', () => {
  it('closes the browser contexts of every provider that launched one', async () => {
    const registry = new ProviderRegistry();
    const fakes = ['fake', 'fake2', 'fake3'].map((id) => createFakeProvider({ id }));
    for (const fake of fakes) {
      registry.register(fake.factory, (manifest) => createPlaywrightTestProviderContext(manifest));
    }
    const [a, b, c] = fakes.map((fake) => fake.ctx!.browser);
    await a.withPage(noop);
    await b.withPage(noop);
    const closeC = jest.spyOn(c, 'close');
    const [contextA, contextB] = fakePlaywright.contexts;

    await registry.disposeAll();

    expect(contextA.close).toHaveBeenCalledTimes(1);
    expect(contextB.close).toHaveBeenCalledTimes(1);
    expect(closeC).toHaveBeenCalledTimes(1);
    // Closing fake3, which never launched, launched nothing.
    expect(fakePlaywright.chromium.launchPersistentContext).toHaveBeenCalledTimes(2);
    expect(fakePlaywright.contexts.map((context) => context.isClosed())).toEqual([true, true]);
  });
});

describe('the browser-driven FakeProvider on PlaywrightBrowserAutomation', () => {
  const STAY = { arrival: '2026-11-13', departure: '2026-11-16', adults: 2 };
  const factory = createFakeBrowserProviderFactory();

  beforeEach(() => {
    fakePlaywright.site = renderFakeSite;
  });

  it('does it all in one persistent context, at providers/fake-browser/browser, one page at a time', async () => {
    const ctx = createPlaywrightTestProviderContext(factory.manifest);
    opened.push(ctx.browser as PlaywrightBrowserAutomation);
    const provider = factory(ctx);

    const results = await Promise.all([
      provider.catalog!.listLocations!(),
      provider.catalog!.getLocation('busselton-jetty'),
      provider.availability!.check('busselton-jetty', STAY),
    ]);
    expect(results).toHaveLength(3);

    expect(fakePlaywright.chromium.launchPersistentContext).toHaveBeenCalledTimes(1);
    const [userDataDir, options] = fakePlaywright.chromium.launchPersistentContext.mock.calls[0];
    expect(userDataDir.endsWith(path.join('providers', 'fake-browser', 'browser'))).toBe(true);
    // The manifest's time zone reaches the browser.
    expect(options).toMatchObject({ timezoneId: 'Australia/Perth', locale: 'en-AU' });
    expect(fakePlaywright.peakOpenPages).toBe(1);
    expect(fakePlaywright.openPages()).toBe(0);
  });

  it('turns "no browser installed" into the user-facing BrowserUnavailableError', async () => {
    const ctx = createPlaywrightTestProviderContext(factory.manifest);
    opened.push(ctx.browser as PlaywrightBrowserAutomation);
    const lonely = factory(ctx);
    fakePlaywright.installed = new Set();

    await expect(lonely.catalog!.listLocations!()).rejects.toMatchObject({
      name: 'BrowserUnavailableError',
      reason: 'no-browser',
      message: 'WA Stay needs Microsoft Edge or Google Chrome installed to use Fake Holiday Parks',
    });
  });
});
