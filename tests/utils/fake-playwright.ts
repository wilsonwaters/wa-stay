/**
 * A fake `playwright-core` for main-process tests of browser automation itself (V7):
 * `PlaywrightBrowserAutomation`'s launch, channels, serialisation, crashes and kill path
 * (`tests/unit/providers/browser-automation.test.ts`), loading `playwright-core` lazily
 * (`browser-automation-loading.test.ts`) and a hung browser at quit
 * (`tests/unit/app/quit-hold.test.ts`). Build their contexts with
 * `createPlaywrightTestProviderContext`. A provider's own tests use the fake browser
 * (`tests/utils/fake-browser.ts`) instead, which runs page scripts and has locators.
 *
 *   jest.mock('playwright-core', () =>
 *     jest.requireActual('@tests/utils/fake-playwright').fakePlaywrightModule()
 *   );
 *   import { fakePlaywright } from '@tests/utils/fake-playwright';
 *   beforeEach(() => fakePlaywright.reset());
 *
 * `chromium.launchPersistentContext` and `chromium.launch` behave like Playwright's for the
 * parts the runtime uses:
 * - a channel that is not in `installed` fails with Playwright's own "Chromium distribution
 *   '<name>' is not found" message (or "is not supported on <platform>" for `unsupported`),
 *   and an `executablePath` that is not in `installed` with "executable doesn't exist";
 * - `profileLockedLaunches` launches fail with Chromium's ProcessSingleton message;
 * - a persistent context starts with one blank page, and reports its browser's process id
 *   through `browser().newBrowserCDPSession()` (`SystemInfo.getProcessInfo`);
 * - its `browser()` emits `disconnected` when the browser goes (`crash()`, `disconnect()`).
 *
 * Pages load the HTML that `site` returns into jsdom, so `page.$$eval(selector, fn)` runs a
 * provider's real DOM code; results come back JSON-serialised, as from a real browser.
 */

import { EventEmitter } from 'events';
import { JSDOM } from 'jsdom';

export interface FakeSiteResponse {
  status: number;
  html: string;
}

/** Answers a page navigation. */
export type FakeSite = (url: URL) => FakeSiteResponse;

const CLOSED = 'Target page, context or browser has been closed';

export class FakePage extends EventEmitter {
  private dom = new JSDOM('<!doctype html><title></title>');
  private closed = false;
  private currentUrl = 'about:blank';

  readonly setDefaultTimeout = jest.fn<void, [number]>();
  readonly setDefaultNavigationTimeout = jest.fn<void, [number]>();

  readonly goto = jest.fn(async (url: string) => {
    this.assertOpen('page.goto');
    const site = this.context.playwright.site;
    const response = site ? site(new URL(url)) : { status: 404, html: '' };
    // A navigation takes a turn of the event loop, so a close can land in the middle.
    await new Promise((resolve) => setImmediate(resolve));
    this.assertOpen('page.goto');
    this.dom = new JSDOM(response.html, { url });
    this.currentUrl = url;
    return { status: () => response.status, ok: () => response.status < 400, url: () => url };
  });

  readonly title = jest.fn(async () => {
    this.assertOpen('page.title');
    return this.dom.window.document.title;
  });

  readonly $$eval = jest.fn(
    async <R, A>(selector: string, fn: (elements: Element[], arg: A) => R, arg?: A) => {
      this.assertOpen('page.$$eval');
      const elements = Array.from(this.dom.window.document.querySelectorAll(selector));
      const result = fn(elements, arg as A);
      return result === undefined ? result : (JSON.parse(JSON.stringify(result)) as R);
    }
  );

  readonly close = jest.fn(async () => {
    this.markClosed();
  });

  constructor(readonly context: FakeBrowserContext) {
    super();
  }

  url(): string {
    return this.currentUrl;
  }

  isClosed(): boolean {
    return this.closed;
  }

  /** Closes the page without a call (its context closed). */
  markClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.context.forget(this);
    this.emit('close', this);
  }

  private assertOpen(method: string): void {
    if (this.closed) throw new Error(`${method}: ${CLOSED}`);
  }
}

/** The `Browser` behind a persistent context: it emits `disconnected` when the browser goes. */
export class FakeBrowser extends EventEmitter {
  constructor(private readonly pid: number) {
    super();
  }

  async newBrowserCDPSession(): Promise<FakeCdpSession> {
    return {
      send: async (method: string) => {
        if (method !== 'SystemInfo.getProcessInfo') throw new Error(`Unexpected ${method}`);
        return {
          processInfo: [
            { type: 'renderer', id: this.pid + 1, cpuTime: 0 },
            { type: 'browser', id: this.pid, cpuTime: 0 },
          ],
        };
      },
      detach: async () => undefined,
    };
  }
}

export class FakeBrowserContext extends EventEmitter {
  private readonly openPages: FakePage[] = [];
  private readonly ownBrowser: FakeBrowser;
  private closed = false;
  private disconnected = false;
  /** When true, `close()` never settles (a hung browser). */
  hangOnClose = false;

  readonly newPage = jest.fn(async () => {
    if (this.closed) throw new Error(`browserContext.newPage: ${CLOSED}`);
    return this.addPage();
  });

  readonly close = jest.fn(async (): Promise<void> => {
    if (this.hangOnClose) return new Promise<void>(() => undefined);
    this.shutDown();
    this.disconnect();
  });

  constructor(
    readonly playwright: FakePlaywright,
    readonly userDataDir: string,
    readonly options: Record<string, unknown>,
    readonly pid: number
  ) {
    super();
    this.ownBrowser = new FakeBrowser(pid);
    // Like Chromium, a persistent context opens with one blank page.
    this.addPage();
  }

  pages(): FakePage[] {
    return [...this.openPages];
  }

  isClosed(): boolean {
    return this.closed;
  }

  browser(): FakeBrowser {
    return this.ownBrowser;
  }

  /** The browser crashed, updated itself or disconnected. */
  crash(): void {
    this.shutDown();
    this.disconnect();
  }

  /** The browser process went away; only `browser().on('disconnected')` hears it. */
  disconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    this.ownBrowser.emit('disconnected', this.ownBrowser);
  }

  forget(page: FakePage): void {
    const index = this.openPages.indexOf(page);
    if (index >= 0) this.openPages.splice(index, 1);
  }

  private addPage(): FakePage {
    const page = new FakePage(this);
    this.openPages.push(page);
    this.playwright.peakOpenPages = Math.max(
      this.playwright.peakOpenPages,
      this.playwright.openPages()
    );
    return page;
  }

  private shutDown(): void {
    if (this.closed) return;
    this.closed = true;
    this.pages().forEach((page) => page.markClosed());
    this.emit('close', this);
  }
}

interface FakeCdpSession {
  send(method: string): Promise<{ processInfo: { type: string; id: number; cpuTime: number }[] }>;
  detach(): Promise<void>;
}

export interface FakeLaunchedBrowser {
  options: Record<string, unknown>;
  close: jest.Mock<Promise<void>, []>;
}

export class FakePlaywright {
  /** Installed channels (`msedge`, `chrome`) and executable paths. */
  installed = new Set<string>();
  /** Channels Playwright says are not made for this platform. */
  unsupported = new Set<string>();
  /** How many more launches fail because the profile is locked. */
  profileLockedLaunches = 0;
  /** The next launch fails with this error. */
  launchError: Error | null = null;
  site: FakeSite | null = null;
  /** The most pages open at once since `reset()`, across every context. */
  peakOpenPages = 0;
  readonly contexts: FakeBrowserContext[] = [];
  readonly browsers: FakeLaunchedBrowser[] = [];
  private nextPid = 4000;

  readonly chromium = {
    launchPersistentContext: jest.fn(
      async (userDataDir: string, options: Record<string, unknown> = {}) => {
        this.failIfMissing('launchPersistentContext', options);
        if (this.profileLockedLaunches > 0) {
          this.profileLockedLaunches--;
          throw new Error(
            'browserType.launchPersistentContext: Failed to create a ProcessSingleton for your profile directory. This usually means that the profile is already in use by another instance of Chromium.'
          );
        }
        this.nextPid += 10;
        const context = new FakeBrowserContext(this, userDataDir, options, this.nextPid);
        this.contexts.push(context);
        return context;
      }
    ),
    launch: jest.fn(async (options: Record<string, unknown> = {}) => {
      this.failIfMissing('launch', options);
      const browser: FakeLaunchedBrowser = { options, close: jest.fn(async () => undefined) };
      this.browsers.push(browser);
      return browser;
    }),
  };

  /** Every open page, across every context. */
  openPages(): number {
    return this.contexts.reduce((count, context) => count + context.pages().length, 0);
  }

  /** The channel (or executable) each persistent launch asked for, in order. */
  launchedWith(): string[] {
    return this.chromium.launchPersistentContext.mock.calls.map(([, options]) =>
      String(options?.channel ?? options?.executablePath)
    );
  }

  reset(): void {
    this.installed = new Set(['msedge', 'chrome']);
    this.unsupported = new Set();
    this.profileLockedLaunches = 0;
    this.launchError = null;
    this.site = null;
    this.peakOpenPages = 0;
    this.contexts.length = 0;
    this.browsers.length = 0;
    this.chromium.launchPersistentContext.mockClear();
    this.chromium.launch.mockClear();
  }

  private failIfMissing(method: string, options: Record<string, unknown>): void {
    if (this.launchError) {
      const error = this.launchError;
      this.launchError = null;
      throw error;
    }
    const executablePath = options.executablePath as string | undefined;
    if (executablePath) {
      if (this.installed.has(executablePath)) return;
      throw new Error(
        `browserType.${method}: Failed to launch chromium because executable doesn't exist at ${executablePath}`
      );
    }
    const channel = String(options.channel ?? 'chromium');
    if (this.unsupported.has(channel)) {
      throw new Error(
        `browserType.${method}: Chromium distribution '${channel}' is not supported on ${process.platform}`
      );
    }
    if (!this.installed.has(channel)) {
      throw new Error(
        `browserType.${method}: Chromium distribution '${channel}' is not found at /opt/${channel}/${channel}\nRun "npx playwright install ${channel}"`
      );
    }
  }
}

/** The one fake the mocked module and the tests share. */
export const fakePlaywright = new FakePlaywright();
fakePlaywright.reset();

/** What `jest.mock('playwright-core', …)` returns. */
export function fakePlaywrightModule(): { chromium: FakePlaywright['chromium'] } {
  return { chromium: fakePlaywright.chromium };
}
