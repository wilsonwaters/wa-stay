/**
 * Module factories for the Electron-only dependencies of the composition root, for main
 * tests that build a real container:
 *
 *   jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
 *   jest.mock('electron-updater', () => jest.requireActual('@tests/utils/electron-mocks').electronUpdater());
 *
 * `FakeBrowserWindow` stands in for provider sign-in and payment windows: a test reads the
 * windows from `FakeBrowserWindow.instances` and drives them (`webContents.navigate`,
 * `willNavigate`, `close`).
 */

import { EventEmitter } from 'events';

/** A provider window's webContents: records handlers and replays Electron's events. */
export class FakeWebContents extends EventEmitter {
  static nextId = 1000;
  readonly id = FakeWebContents.nextId++;
  url = '';
  /** The text the page shows, for find-in-page. */
  pageText = '';
  windowOpenHandler?: (details: { url: string }) => { action: string };
  private findRequests = 0;
  readonly stopFindInPage = jest.fn();

  /** Chromium's find-in-page: answers `found-in-page` (final) on the next turn. */
  findInPage(text: string, options: { matchCase?: boolean } = {}): number {
    const requestId = ++this.findRequests;
    const haystack = options.matchCase ? this.pageText : this.pageText.toLowerCase();
    const needle = options.matchCase ? text : text.toLowerCase();
    const matches = needle ? haystack.split(needle).length - 1 : 0;
    setImmediate(() =>
      this.emit(
        'found-in-page',
        {},
        { requestId, matches, activeMatchOrdinal: 1, finalUpdate: true }
      )
    );
    return requestId;
  }

  /** A page that commits (`did-navigate`) and finishes loading (`did-finish-load`). */
  showPage(
    url: string,
    { text = '', status = 200 }: { text?: string; status?: number } = {}
  ): void {
    this.pageText = text;
    this.navigate(url, status);
    this.emit('did-finish-load', {});
  }

  /** A load that failed (`did-fail-load`), as Electron 28 emits it. */
  failLoad(errorCode: number, errorDescription: string, url = this.url, isMainFrame = true): void {
    this.emit('did-fail-load', {}, errorCode, errorDescription, url, isMainFrame);
  }

  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void {
    this.windowOpenHandler = handler;
  }

  getURL(): string {
    return this.url;
  }

  isDestroyed(): boolean {
    return false;
  }

  /** A committed top-level page (`did-navigate`), after any redirects. */
  navigate(url: string, httpStatus = 200): void {
    this.url = url;
    this.emit('did-navigate', {}, url, httpStatus, 'OK');
  }

  /** Emits `will-navigate` as Electron 28 does. True when a handler prevented it. */
  willNavigate(url: string): boolean {
    let prevented = false;
    this.emit('will-navigate', { url, preventDefault: () => (prevented = true) }, url);
    return prevented;
  }

  /** Emits `will-redirect` as Electron 28 does. True when a handler prevented it. */
  willRedirect(url: string, isMainFrame = true): boolean {
    let prevented = false;
    const event = { url, isMainFrame, preventDefault: () => (prevented = true) };
    this.emit('will-redirect', event, url, false, isMainFrame);
    return prevented;
  }
}

export class FakeBrowserWindow extends EventEmitter {
  static instances: FakeBrowserWindow[] = [];

  readonly webContents = new FakeWebContents();
  title: string;
  destroyed = false;
  readonly loadURL = jest.fn((url: string) => {
    this.webContents.url = url;
    return Promise.resolve();
  });
  readonly setMenu = jest.fn();
  visible = false;
  readonly show = jest.fn(() => {
    this.visible = true;
  });
  readonly focus = jest.fn();
  readonly restore = jest.fn();
  readonly setTitle = jest.fn((title: string) => {
    this.title = title;
  });
  readonly close = jest.fn(() => this.finish());
  readonly destroy = jest.fn(() => this.finish());

  constructor(
    readonly options: { webPreferences?: Record<string, unknown>; [option: string]: unknown }
  ) {
    super();
    this.title = String(options.title ?? '');
    FakeBrowserWindow.instances.push(this);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isMinimized(): boolean {
    return false;
  }

  isVisible(): boolean {
    return this.visible;
  }

  private finish(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
}

export function electron(): Record<string, unknown> {
  // One session per partition, as Electron's `session.fromPartition` does
  const sessions = new Map<string, Record<string, unknown>>();
  return {
    app: {
      getAppPath: () => '/app',
      getPath: () => '/tmp/wa-stay-test',
      getName: () => 'WA Stay',
      getVersion: () => '0.0.0-test',
      isPackaged: false,
      setLoginItemSettings: jest.fn(),
    },
    BrowserWindow: FakeBrowserWindow,
    Notification: jest.fn().mockImplementation(() => ({ on: jest.fn(), show: jest.fn() })),
    shell: { openExternal: jest.fn(() => Promise.resolve()), openPath: jest.fn() },
    // The scheduler re-arms its timers on `resume` and `unlock-screen`; a test emits them.
    powerMonitor: new EventEmitter(),
    ipcMain: { handle: jest.fn() },
    session: {
      fromPartition: jest.fn((partition: string) => {
        let ses = sessions.get(partition);
        if (!ses) sessions.set(partition, (ses = fakeSession()));
        return ses;
      }),
    },
    // Providers' HTTP clients send through `net.request`; it fails unless a test stubs it.
    net: {
      request: jest.fn(() => {
        throw new Error('net.request is not mocked in this test');
      }),
    },
  };
}

/**
 * A session partition (`session.fromPartition`): providers' HTTP clients are built on it,
 * provider windows harden and clear it, and document windows harden it and check its answers.
 */
export function fakeSession(): Record<string, unknown> {
  // Session events (`will-download`): a test emits them with `emit`
  const events = new EventEmitter();
  // One session per partition lives for a whole test file, through many containers
  events.setMaxListeners(0);
  return {
    on: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
      events.on(event, listener);
    }),
    emit: (event: string, ...args: unknown[]) => events.emit(event, ...args),
    // A test reads the listeners from the mocks' calls
    webRequest: { onHeadersReceived: jest.fn(), onBeforeRequest: jest.fn() },
    protocol: { handle: jest.fn() },
    setUserAgent: jest.fn(),
    setPermissionRequestHandler: jest.fn(),
    setPermissionCheckHandler: jest.fn(),
    setDevicePermissionHandler: jest.fn(),
    clearStorageData: jest.fn(() => Promise.resolve()),
    clearAuthCache: jest.fn(() => Promise.resolve()),
    cookies: {
      get: jest.fn(() => Promise.resolve([])),
      set: jest.fn(() => Promise.resolve()),
      remove: jest.fn(() => Promise.resolve()),
      flushStore: jest.fn(() => Promise.resolve()),
    },
  };
}

/** `autoUpdater` is an EventEmitter, so a test can emit `update-available` and the like. */
export function electronUpdater(): Record<string, unknown> {
  const autoUpdater = Object.assign(new EventEmitter(), {
    checkForUpdates: jest.fn(),
    downloadUpdate: jest.fn(),
    quitAndInstall: jest.fn(),
  });
  return { autoUpdater };
}
