/**
 * The main window and its guards, against a mocked `electron`:
 * - new windows are always denied; http(s) and mailto go to `shell.openExternal`;
 * - navigations and redirects off the app origin are cancelled, hash routes are not;
 * - `<webview>` attaches are denied for every webContents;
 * - no request offers a client certificate, `net` requests (no webContents) included;
 * - its session (the default session) refuses every permission request and check except a
 *   clipboard write from the app's own page;
 * - the window is sandboxed and isolated, registered as the trusted IPC sender, and in
 *   development gets the dev CSP as a response header;
 * - without its preload file the window shows a "preload missing" page instead of the app.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import type { App, Session, WebContents } from 'electron';
import { buildCsp } from '@main/app/csp';
import {
  APP_PERMISSIONS,
  createMainWindow,
  denyWebviews,
  guardNavigation,
  guardPermissions,
  installDevCsp,
  preloadMissingPage,
  refuseClientCertificates,
} from '@main/app/main-window';
import { createAppUrlMatcher } from '@main/app/renderer-entry';
import { TrustedWebContents } from '@main/ipc/trusted-web-contents';
import { logger } from '@main/utils/logger';

jest.mock('electron', () => {
  const { EventEmitter: Emitter } = jest.requireActual('events');

  class FakeWebContents extends Emitter {
    static nextId = 1;
    id = FakeWebContents.nextId++;
    windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null;
    headersListener: ((details: unknown, callback: (r: unknown) => void) => void) | null = null;
    permissionRequestHandler: unknown = null;
    permissionCheckHandler: unknown = null;
    session = {
      webRequest: {
        onHeadersReceived: (listener: FakeWebContents['headersListener']) => {
          this.headersListener = listener;
        },
      },
      setPermissionRequestHandler: (handler: unknown) => {
        this.permissionRequestHandler = handler;
      },
      setPermissionCheckHandler: (handler: unknown) => {
        this.permissionCheckHandler = handler;
      },
    };
    setWindowOpenHandler(handler: FakeWebContents['windowOpenHandler']) {
      this.windowOpenHandler = handler;
    }
    isDestroyed = () => false;
    send = jest.fn();
    reload = jest.fn();
    openDevTools = jest.fn();
  }

  class BrowserWindow extends Emitter {
    static all: BrowserWindow[] = [];
    static getAllWindows = () => BrowserWindow.all;
    webContents = new FakeWebContents();
    loadURL = jest.fn(() => Promise.resolve());
    loadFile = jest.fn(() => Promise.resolve());
    show = jest.fn();
    minimize = jest.fn();
    focus = jest.fn();
    constructor(public options: Record<string, unknown>) {
      super();
      BrowserWindow.all.push(this);
    }
  }

  return { BrowserWindow, shell: { openExternal: jest.fn(() => Promise.resolve()) } };
});

const { BrowserWindow, shell } = jest.requireMock('electron') as {
  BrowserWindow: {
    all: Array<FakeWindow>;
    getAllWindows(): FakeWindow[];
  };
  shell: { openExternal: jest.Mock };
};

interface FakeWindow extends EventEmitter {
  options: { webPreferences: Record<string, unknown>; show: boolean };
  webContents: FakeContents;
  loadURL: jest.Mock;
  loadFile: jest.Mock;
  show: jest.Mock;
  minimize: jest.Mock;
  focus: jest.Mock;
}

interface FakeContents extends EventEmitter {
  id: number;
  windowOpenHandler: (details: { url: string }) => { action: string };
  headersListener:
    | ((
        details: { url: string; responseHeaders?: Record<string, string[]> },
        callback: (response: { responseHeaders?: Record<string, string[]> }) => void
      ) => void)
    | null;
  permissionRequestHandler: PermissionRequestHandler | null;
  permissionCheckHandler: PermissionCheckHandler | null;
  reload: jest.Mock;
  openDevTools: jest.Mock;
}

/** The handlers `guardPermissions` installs, as Electron calls them. */
type PermissionRequestHandler = (
  contents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
  details: { requestingUrl: string; isMainFrame: boolean }
) => void;
type PermissionCheckHandler = (
  contents: unknown,
  permission: string,
  requestingOrigin: string,
  details: { requestingUrl?: string; isMainFrame: boolean }
) => boolean;

const INDEX = path.join(os.tmpdir(), 'WA Stay', 'resources', 'dist', 'renderer', 'index.html');
const APP_URL = pathToFileURL(INDEX).href;
const PRELOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-preload-'));
const PRELOAD = path.join(PRELOAD_DIR, 'index.js');

beforeAll(() => {
  fs.writeFileSync(PRELOAD, '// the bundled preload\n');
});

afterAll(() => {
  fs.rmSync(PRELOAD_DIR, { recursive: true, force: true });
});

/** Emits a navigation-type event the way Electron 28 does: an event object plus the URL. */
function navigate(
  contents: EventEmitter,
  name: string,
  url: string
): { preventDefault: jest.Mock } {
  const event = { url, preventDefault: jest.fn() };
  contents.emit(name, event, url);
  return event;
}

beforeEach(() => {
  jest.spyOn(logger, 'warn').mockImplementation(() => logger);
  jest.spyOn(logger, 'info').mockImplementation(() => logger);
  shell.openExternal.mockClear();
  BrowserWindow.all.length = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('guardNavigation', () => {
  let contents: FakeContents;
  let openExternal: jest.Mock;

  beforeEach(() => {
    contents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler(handler: FakeContents['windowOpenHandler']) {
        contents.windowOpenHandler = handler;
      },
    }) as unknown as FakeContents;
    openExternal = jest.fn(() => Promise.resolve());
    guardNavigation(contents as unknown as WebContents, {
      isAppUrl: createAppUrlMatcher({ kind: 'file', path: INDEX }),
      openExternal,
    });
  });

  it("window.open('https://example.com') is denied and opened once in the system browser", () => {
    expect(contents.windowOpenHandler({ url: 'https://example.com' })).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
  });

  it('http and mailto links go out too; every new window is denied', () => {
    expect(contents.windowOpenHandler({ url: 'http://parks.dbca.wa.gov.au/x' })).toEqual({
      action: 'deny',
    });
    expect(contents.windowOpenHandler({ url: 'mailto:help@example.com' })).toEqual({
      action: 'deny',
    });
    expect(openExternal.mock.calls).toEqual([
      ['http://parks.dbca.wa.gov.au/x'],
      ['mailto:help@example.com'],
    ]);
  });

  it('javascript:, file: and other schemes are neither opened nor allowed a window', () => {
    for (const url of [
      'javascript:alert(document.cookie)',
      'file:///etc/passwd',
      `${APP_URL}#/settings`,
      'ms-settings:privacy',
      'not a url',
    ]) {
      expect(contents.windowOpenHandler({ url })).toEqual({ action: 'deny' });
    }
    expect(openExternal).not.toHaveBeenCalled();
    // The log names the scheme only, never the full URL
    expect(logger.warn).toHaveBeenCalledWith('Blocked a new window for a javascript: URL');
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('cookie');
  });

  it('cancels navigation off the app origin, including javascript: and other file: pages', () => {
    for (const url of [
      'https://example.com/',
      'javascript:void(0)',
      'file:///etc/passwd',
      pathToFileURL(path.join(os.tmpdir(), 'other.html')).href,
    ]) {
      expect(navigate(contents, 'will-navigate', url).preventDefault).toHaveBeenCalledTimes(1);
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('lets the app navigate to its own page (any hash route)', () => {
    expect(navigate(contents, 'will-navigate', APP_URL).preventDefault).not.toHaveBeenCalled();
    expect(
      navigate(contents, 'will-navigate', `${APP_URL}#/watches/3`).preventDefault
    ).not.toHaveBeenCalled();
  });

  it('cancels redirects off the app origin', () => {
    expect(
      navigate(contents, 'will-redirect', 'https://evil.example/').preventDefault
    ).toHaveBeenCalledTimes(1);
    expect(navigate(contents, 'will-redirect', APP_URL).preventDefault).not.toHaveBeenCalled();
  });
});

describe('guardPermissions', () => {
  let request: PermissionRequestHandler;
  let check: PermissionCheckHandler;

  /** What the request handler answers for `permission` asked by `requestingUrl`. */
  function ask(permission: string, requestingUrl: string, isMainFrame = true): boolean {
    const callback = jest.fn();
    request({}, permission, callback, { requestingUrl, isMainFrame });
    expect(callback).toHaveBeenCalledTimes(1);
    return callback.mock.calls[0][0];
  }

  beforeEach(() => {
    const session = {
      setPermissionRequestHandler: jest.fn(),
      setPermissionCheckHandler: jest.fn(),
    };
    guardPermissions(session as unknown as Session, {
      isAppUrl: createAppUrlMatcher({ kind: 'file', path: INDEX }),
    });
    request = session.setPermissionRequestHandler.mock.calls[0][0];
    check = session.setPermissionCheckHandler.mock.calls[0][0];
  });

  it('refuses every permission request from the app page except a clipboard write', () => {
    for (const permission of [
      'media',
      'display-capture',
      'geolocation',
      'notifications',
      'clipboard-read',
      'fullscreen',
      'openExternal',
      'hid',
      'serial',
      'usb',
      'storage-access',
      'unknown',
    ]) {
      expect(`${permission}: ${ask(permission, `${APP_URL}#/watches`)}`).toBe(
        `${permission}: false`
      );
    }
    expect([...APP_PERMISSIONS]).toEqual(['clipboard-sanitized-write']);
    expect(ask('clipboard-sanitized-write', `${APP_URL}#/bookings/1`)).toBe(true);
  });

  it('refuses even a clipboard write to a sub-frame or a page that is not the app', () => {
    expect(ask('clipboard-sanitized-write', APP_URL, false)).toBe(false);
    for (const url of [
      'https://parkstay.dbca.wa.gov.au/',
      pathToFileURL(path.join(os.tmpdir(), 'other.html')).href,
      'devtools://devtools/bundled/inspector.html',
      '',
    ]) {
      expect(ask('clipboard-sanitized-write', url)).toBe(false);
    }
  });

  it('logs a refused request by permission and origin only', () => {
    ask('geolocation', 'https://example.com/path?token=secret');
    expect(logger.warn).toHaveBeenCalledWith(
      'Refused the geolocation permission for https://example.com'
    );
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('secret');
  });

  it('answers permission checks the same way', () => {
    const appPage = { requestingUrl: `${APP_URL}#/settings`, isMainFrame: true };
    expect(check(null, 'clipboard-sanitized-write', 'file:///', appPage)).toBe(true);
    for (const permission of ['media', 'notifications', 'geolocation', 'clipboard-read', 'hid']) {
      expect(`${permission}: ${check(null, permission, 'file:///', appPage)}`).toBe(
        `${permission}: false`
      );
    }
    expect(
      check(null, 'clipboard-sanitized-write', 'file:///', { ...appPage, isMainFrame: false })
    ).toBe(false);
    expect(
      check(null, 'clipboard-sanitized-write', 'https://example.com', {
        requestingUrl: 'https://example.com/',
        isMainFrame: true,
      })
    ).toBe(false);
    expect(check(null, 'clipboard-sanitized-write', 'file:///', { isMainFrame: true })).toBe(false);
  });
});

describe('denyWebviews', () => {
  it('every webContents the app creates refuses a <webview> attach', () => {
    const app = new EventEmitter();
    denyWebviews(app as unknown as App);

    const created = new EventEmitter();
    app.emit('web-contents-created', {}, created);
    const attach = { preventDefault: jest.fn() };
    created.emit('will-attach-webview', attach, {}, {});

    expect(attach.preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe('refuseClientCertificates', () => {
  it.each([
    ['a net request (no webContents, as Electron 44 emits it)', null],
    ['a page', { id: 7 }],
  ])('offers no certificate to %s and logs the origin only', (_case, contents) => {
    const app = new EventEmitter();
    refuseClientCertificates(app as unknown as App);

    const event = { preventDefault: jest.fn() };
    const callback = jest.fn();
    const certificate = { subjectName: 'CN=Someone', fingerprint: 'sha256/abc' };
    app.emit(
      'select-client-certificate',
      event,
      contents,
      'https://parkstay.dbca.wa.gov.au/api/profile?token=secret',
      [certificate],
      callback
    );

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith();
    expect(logger.warn).toHaveBeenCalledWith(
      'Refused a client certificate request from https://parkstay.dbca.wa.gov.au'
    );
    expect(JSON.stringify((logger.warn as jest.Mock).mock.calls)).not.toContain('secret');
  });
});

describe('createMainWindow', () => {
  it('runs the renderer sandboxed and isolated, with the bundled preload', () => {
    const window = createMainWindow({
      entry: { kind: 'file', path: INDEX },
      preloadPath: PRELOAD,
      trustedWebContents: new TrustedWebContents(),
      startMinimised: false,
    }) as unknown as FakeWindow;

    expect(window.options.webPreferences).toEqual(
      expect.objectContaining({ sandbox: true, contextIsolation: true, nodeIntegration: false })
    );
    expect(window.options.webPreferences.preload).toBe(PRELOAD);
  });

  it('a missing preload shows an error page naming it, not a blank app', () => {
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const missing = path.join(PRELOAD_DIR, 'not-built-yet', 'index.js');

    const window = createMainWindow({
      entry: { kind: 'file', path: INDEX },
      preloadPath: missing,
      trustedWebContents: new TrustedWebContents(),
      startMinimised: false,
    }) as unknown as FakeWindow;

    expect(logger.error).toHaveBeenCalledWith(`The preload script is missing: ${missing}`);
    expect(window.loadFile).not.toHaveBeenCalled();
    expect(window.loadURL).toHaveBeenCalledWith(preloadMissingPage(missing));
    // Still sandboxed, and no preload for Electron to fail on
    expect(window.options.webPreferences).toEqual(
      expect.objectContaining({ sandbox: true, contextIsolation: true, nodeIntegration: false })
    );
    expect(window.options.webPreferences).not.toHaveProperty('preload');

    // The window still appears, with the error
    window.emit('ready-to-show');
    expect(window.show).toHaveBeenCalledTimes(1);
  });

  it('the dev server is not loaded either while the preload is missing', () => {
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const window = createMainWindow({
      entry: { kind: 'dev-server', url: 'http://localhost:3000' },
      preloadPath: path.join(PRELOAD_DIR, 'missing.js'),
      trustedWebContents: new TrustedWebContents(),
      startMinimised: false,
    }) as unknown as FakeWindow;

    expect(window.loadURL).toHaveBeenCalledTimes(1);
    expect(window.loadURL.mock.calls[0][0]).toMatch(/^data:text\/html;charset=utf-8,/);
  });

  it('is isolated, trusted, guarded and loads the built index.html without a CSP header', () => {
    const trusted = new TrustedWebContents();
    const window = createMainWindow({
      entry: { kind: 'file', path: INDEX },
      preloadPath: PRELOAD,
      trustedWebContents: trusted,
      startMinimised: false,
    }) as unknown as FakeWindow;

    expect(window.options.webPreferences).toEqual(
      expect.objectContaining({
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        preload: PRELOAD,
      })
    );
    expect(window.options.show).toBe(false);
    expect(trusted.isTrusted(window.webContents.id)).toBe(true);
    expect(window.loadFile).toHaveBeenCalledWith(INDEX);
    expect(window.webContents.headersListener).toBeNull();
    expect(window.webContents.openDevTools).not.toHaveBeenCalled();

    // The guards are installed on this window
    expect(window.webContents.windowOpenHandler({ url: 'https://example.com' })).toEqual({
      action: 'deny',
    });
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
    expect(BrowserWindow.getAllWindows()).toHaveLength(1);
    expect(
      navigate(window.webContents, 'will-navigate', 'https://example.com').preventDefault
    ).toHaveBeenCalled();

    // Its session (the default session) refuses permissions but a clipboard write from the app
    const request = window.webContents.permissionRequestHandler;
    const check = window.webContents.permissionCheckHandler;
    if (!request || !check) throw new Error('The permission handlers are not installed');
    const callback = jest.fn();
    request({}, 'media', callback, { requestingUrl: APP_URL, isMainFrame: true });
    request({}, 'clipboard-sanitized-write', callback, {
      requestingUrl: APP_URL,
      isMainFrame: true,
    });
    expect(callback.mock.calls).toEqual([[false], [true]]);
    expect(
      check(null, 'notifications', 'file:///', { requestingUrl: APP_URL, isMainFrame: true })
    ).toBe(false);

    // Shown when ready, unless launched hidden
    window.emit('ready-to-show');
    expect(window.show).toHaveBeenCalledTimes(1);
  });

  it('a hidden login launch (Start minimised) opens minimised: never shown on screen or focused', () => {
    const window = createMainWindow({
      entry: { kind: 'file', path: INDEX },
      preloadPath: PRELOAD,
      trustedWebContents: new TrustedWebContents(),
      startMinimised: true,
    }) as unknown as FakeWindow;

    expect(window.minimize).not.toHaveBeenCalled();
    window.emit('ready-to-show');
    expect(window.minimize).toHaveBeenCalledTimes(1);
    expect(window.show).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
  });

  it('is titled WA Stay and uses the icon it is given, if any', () => {
    const options = { entry: { kind: 'file', path: INDEX }, preloadPath: PRELOAD } as const;
    const plain = createMainWindow({
      ...options,
      trustedWebContents: new TrustedWebContents(),
      startMinimised: false,
    }) as unknown as FakeWindow;
    expect(plain.options.title).toBe('WA Stay');
    expect(plain.options).not.toHaveProperty('icon');

    const withIcon = createMainWindow({
      ...options,
      trustedWebContents: new TrustedWebContents(),
      startMinimised: false,
      icon: '/repo/resources/icons/icon.png',
    }) as unknown as FakeWindow;
    expect(withIcon.options.icon).toBe('/repo/resources/icons/icon.png');
  });

  it('development: loads the dev server and sends the dev CSP header on its responses only', () => {
    const window = createMainWindow({
      entry: { kind: 'dev-server', url: 'http://localhost:3005' },
      preloadPath: PRELOAD,
      trustedWebContents: new TrustedWebContents(),
      startMinimised: false,
    }) as unknown as FakeWindow;

    expect(window.loadURL).toHaveBeenCalledWith('http://localhost:3005');
    const listener = window.webContents.headersListener;
    expect(listener).not.toBeNull();

    const fromDevServer = jest.fn();
    listener?.(
      {
        url: 'http://localhost:3005/',
        responseHeaders: { 'content-type': ['text/html'], 'content-security-policy': ['x'] },
      },
      fromDevServer
    );
    expect(fromDevServer).toHaveBeenCalledWith({
      responseHeaders: {
        'content-type': ['text/html'],
        'Content-Security-Policy': [buildCsp({ dev: true, devOrigin: 'http://localhost:3005' })],
      },
    });

    const elsewhere = jest.fn();
    listener?.({ url: 'https://api.mapbox.com/styles/v1', responseHeaders: {} }, elsewhere);
    expect(elsewhere).toHaveBeenCalledWith({});
  });

  it('reloads a crashed renderer once', () => {
    jest.spyOn(logger, 'error').mockImplementation(() => logger);
    const window = createMainWindow({
      entry: { kind: 'file', path: INDEX },
      preloadPath: PRELOAD,
      trustedWebContents: new TrustedWebContents(),
      startMinimised: false,
    }) as unknown as FakeWindow;

    window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 });
    window.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 133 });

    expect(window.webContents.reload).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith('Renderer process gone: crashed (exit code 133)');
  });
});

describe('preloadMissingPage', () => {
  it('is a static page that names the missing file, HTML-escaped', () => {
    const url = preloadMissingPage(
      'C:\\Apps\\<WA Stay>\\resources\\app.asar\\dist\\preload\\index.js'
    );
    const html = decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));

    expect(html).toContain('preload script is missing');
    expect(html).toContain(
      'C:\\Apps\\&lt;WA Stay&gt;\\resources\\app.asar\\dist\\preload\\index.js'
    );
    expect(html).not.toContain('<WA Stay>');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain(`default-src 'none'`);
  });
});

describe('installDevCsp', () => {
  it('ignores responses that are not from the dev server origin', () => {
    let listener: ((details: { url: string }, cb: (r: unknown) => void) => void) | undefined;
    const session = {
      webRequest: { onHeadersReceived: (l: typeof listener) => (listener = l) },
    };
    installDevCsp(session as unknown as Session, 'http://localhost:3000/some/path');

    const callback = jest.fn();
    listener?.({ url: 'http://localhost:30001/' }, callback);
    expect(callback).toHaveBeenCalledWith({});
  });
});
