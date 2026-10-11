/**
 * Provider sign-in and payment windows against a mocked `electron` (`FakeBrowserWindow`):
 * the sandboxed window on the provider partition with no script of ours, the top-level
 * origin allow-list (navigations, main-frame redirects, new windows), refused permissions,
 * certificates, client certificates and HTTP credentials, the title, closing with the main
 * window, clearing and flushing the partition, and the shared partition and user agent; that
 * a window always shows (ready to paint, or after `SHOW_AFTER_MS`), closes itself with a
 * `PROVIDER_ERROR` when its first page is blocked or fails, goes back to its page after the
 * provider's waiting room, and reads page text with find-in-page.
 * `npm run test:electron` runs the real windows.
 */

import fs from 'fs';
import path from 'path';
import type { BrowserWindow } from 'electron';
import { isProviderWindow, ProviderWindows } from '@main/app/provider-windows';
import type { ProviderWindowRequest } from '@main/core/accounts/ports';
import { ElectronSessionHttpClient } from '@main/providers/sdk/http-electron';
import { CHROME_USER_AGENT, chromeUserAgent } from '@main/providers/sdk';
import { PARKSTAY_SIGN_IN_ORIGINS, PARKSTAY_SIGN_IN_URL } from '@main/providers/parkstay/auth';
import { toApiError } from '@main/providers/sdk/errors';
import { logger } from '@main/utils/logger';
import type { FakeBrowserWindow } from '@tests/utils/electron-mocks';
import { stripComments } from '@tests/utils/strip-comments';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());

const electron = jest.requireMock('electron') as {
  BrowserWindow: typeof FakeBrowserWindow;
  shell: { openExternal: jest.Mock };
  session: { fromPartition: jest.Mock };
};

type FakeSession = {
  setUserAgent: jest.Mock;
  setPermissionRequestHandler: jest.Mock;
  setPermissionCheckHandler: jest.Mock;
  setDevicePermissionHandler: jest.Mock;
  clearStorageData: jest.Mock;
  clearAuthCache: jest.Mock;
  cookies: { flushStore: jest.Mock };
  webRequest?: { onHeadersReceived: jest.Mock; onBeforeRequest: jest.Mock };
};

const partitionSession = (id = 'parkstay'): FakeSession =>
  electron.session.fromPartition(`persist:provider-${id}`) as FakeSession;

const SIGN_IN: ProviderWindowRequest = {
  providerId: 'parkstay',
  providerName: 'ParkStay',
  kind: 'sign-in',
  url: PARKSTAY_SIGN_IN_URL,
  allowedOrigins: PARKSTAY_SIGN_IN_ORIGINS,
  openBlockedExternally: true,
};

const PAYMENT: ProviderWindowRequest = {
  providerId: 'parkstay',
  providerName: 'ParkStay',
  kind: 'payment',
  url: 'https://parkstay.dbca.wa.gov.au/booking/',
  allowedOrigins: [...PARKSTAY_SIGN_IN_ORIGINS, 'https://*.dbca.wa.gov.au'],
  openBlockedExternally: false,
};

/** An Electron-style event whose `preventDefault` is recorded. */
function event(extra: Record<string, unknown> = {}) {
  return { ...extra, preventDefault: jest.fn() };
}

describe('ProviderWindows', () => {
  let windows: ProviderWindows;
  const lastWindow = (): FakeBrowserWindow =>
    electron.BrowserWindow.instances[electron.BrowserWindow.instances.length - 1];

  beforeEach(() => {
    electron.BrowserWindow.instances.length = 0;
    // The mocked partitions live for the whole file: forget their calls
    jest.clearAllMocks();
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'debug').mockImplementation(() => logger);
    windows = new ProviderWindows({ devTools: true });
  });

  afterEach(() => {
    windows.closeAll();
    jest.restoreAllMocks();
  });

  it('creates a sandboxed persist:provider-parkstay window with no preload', () => {
    const main = new electron.BrowserWindow({ title: 'WA Stay' });
    windows.attachMainWindow(main as unknown as BrowserWindow);
    windows.open(SIGN_IN);
    const window = lastWindow();
    const prefs = window.options.webPreferences;

    expect(prefs.partition).toBe('persist:provider-parkstay');
    expect(prefs.preload).toBeUndefined();
    expect(Object.keys(prefs)).not.toContain('preload');
    expect(prefs).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: true,
    });
    expect(window.options).toMatchObject({
      parent: main,
      width: 520,
      height: 760,
      title: 'ParkStay — Sign in',
      show: false,
    });
    expect(window.setMenu).toHaveBeenCalledWith(null);
    expect(window.loadURL).toHaveBeenCalledWith(PARKSTAY_SIGN_IN_URL);
    expect(isProviderWindow(window.webContents)).toBe(true);
    expect(isProviderWindow(main.webContents)).toBe(false);
  });

  it('uses the partition the provider’s HTTP client uses, with the same user agent', () => {
    const client = new ElectronSessionHttpClient({ providerId: 'parkstay' });
    windows.open(SIGN_IN);

    expect(lastWindow().options.webPreferences.partition).toBe(client.partition);
    expect(partitionSession().setUserAgent).toHaveBeenLastCalledWith(client.userAgent);
    expect(client.userAgent).toBe(CHROME_USER_AGENT); // no process.versions.chrome in Jest

    const electron120 = new ProviderWindows({ devTools: false, chromeMajor: '120' });
    electron120.open({ ...SIGN_IN, providerId: 'other' });
    expect(partitionSession('other').setUserAgent).toHaveBeenCalledWith(chromeUserAgent('120'));
    expect(lastWindow().options.webPreferences.devTools).toBe(false);
    electron120.closeAll();
  });

  it('blocks will-navigate to https://evil.example/ and opens it in the system browser', () => {
    windows.open(SIGN_IN);
    const contents = lastWindow().webContents;

    expect(contents.willNavigate('https://evil.example/')).toBe(true);
    expect(electron.shell.openExternal).toHaveBeenCalledWith('https://evil.example/');
    expect(logger.warn).toHaveBeenCalledWith(
      'The parkstay sign-in window blocked a navigation to https://evil.example'
    );
  });

  it('allows will-navigate to dbcab2c.b2clogin.com and the other sign-in hosts', () => {
    windows.open(SIGN_IN);
    const contents = lastWindow().webContents;

    for (const url of [
      'https://dbcab2c.b2clogin.com/dbcab2c.onmicrosoft.com/b2c_1a_parkstay_prod/oauth2/v2.0/authorize?x=1',
      'https://auth2.dbca.wa.gov.au/sso/auth_local?next=/ssologin',
      'https://login.microsoftonline.com/common/x',
      'https://queue.dbca.wa.gov.au/site-queue/waiting-room/parkstayv2/',
      'https://parkstay.dbca.wa.gov.au/login-success/',
    ]) {
      expect([url, contents.willNavigate(url)]).toEqual([url, false]);
    }
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
  });

  it('checks main-frame redirects, not sub-frame ones', () => {
    windows.open(SIGN_IN);
    const contents = lastWindow().webContents;

    expect(contents.willRedirect('https://accounts.google.com/o/oauth2/auth', true)).toBe(true);
    expect(contents.willRedirect('https://3ds.bank.example/challenge', false)).toBe(false);
    expect(contents.willRedirect('https://dbcab2c.b2clogin.com/x', true)).toBe(false);
  });

  it('logs only the origin of a blocked URL, never its path or query', () => {
    windows.open(SIGN_IN);
    lastWindow().webContents.willNavigate('https://evil.example/steal?token=SECRET-TOKEN');

    const logged = JSON.stringify((logger.warn as jest.Mock).mock.calls);
    expect(logged).toContain('https://evil.example');
    expect(logged).not.toContain('SECRET-TOKEN');
    expect(logged).not.toContain('/steal');
  });

  it('new windows: an allowed URL loads in place, another web URL opens outside, others are denied', () => {
    windows.open(SIGN_IN);
    const window = lastWindow();
    const open = window.webContents.windowOpenHandler!;

    expect(open({ url: 'https://dbcab2c.b2clogin.com/help' })).toEqual({ action: 'deny' });
    expect(window.loadURL).toHaveBeenLastCalledWith('https://dbcab2c.b2clogin.com/help');
    expect(open({ url: 'https://www.dbca.wa.gov.au/privacy' })).toEqual({ action: 'deny' });
    expect(electron.shell.openExternal).toHaveBeenCalledWith('https://www.dbca.wa.gov.au/privacy');
    expect(open({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    expect(electron.shell.openExternal).toHaveBeenCalledTimes(1);
  });

  it('denies every permission request', () => {
    windows.open(SIGN_IN);
    const ses = partitionSession();
    const [requestHandler] = ses.setPermissionRequestHandler.mock.calls[0];
    const [checkHandler] = ses.setPermissionCheckHandler.mock.calls[0];
    const [deviceHandler] = ses.setDevicePermissionHandler.mock.calls[0];

    for (const permission of ['geolocation', 'notifications', 'media', 'clipboard-read']) {
      const callback = jest.fn();
      requestHandler(lastWindow().webContents, permission, callback);
      expect(callback).toHaveBeenCalledWith(false);
      expect(checkHandler(lastWindow().webContents, permission)).toBe(false);
    }
    expect(deviceHandler({ deviceType: 'usb' })).toBe(false);

    // Once per partition: a second window does not register them again
    windows.closeAll();
    windows.open(SIGN_IN);
    expect(ses.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
  });

  it('rejects certificate errors and offers no client certificate or HTTP credentials', () => {
    windows.open(SIGN_IN);
    const contents = lastWindow().webContents;

    const cert = event();
    const certCallback = jest.fn();
    contents.emit(
      'certificate-error',
      cert,
      'https://parkstay.dbca.wa.gov.au/',
      'net::ERR_CERT_DATE_INVALID',
      {},
      certCallback
    );
    expect(cert.preventDefault).toHaveBeenCalled();
    expect(certCallback).toHaveBeenCalledWith(false);

    const client = event();
    const clientCallback = jest.fn();
    contents.emit('select-client-certificate', client, 'https://x.example/', [{}], clientCallback);
    expect(client.preventDefault).toHaveBeenCalled();
    expect(clientCallback).toHaveBeenCalledWith();

    const login = event();
    const loginCallback = jest.fn();
    contents.emit('login', login, {}, {}, loginCallback);
    expect(login.preventDefault).toHaveBeenCalled();
    expect(loginCallback).toHaveBeenCalledWith();

    const unload = event();
    contents.emit('will-prevent-unload', unload);
    expect(unload.preventDefault).toHaveBeenCalled();
  });

  it('never touches the partition’s response headers (the pages keep their own CSP)', () => {
    const ses = partitionSession();
    ses.webRequest = { onHeadersReceived: jest.fn(), onBeforeRequest: jest.fn() };
    windows.open(SIGN_IN);

    expect(ses.webRequest.onHeadersReceived).not.toHaveBeenCalled();
    expect(ses.webRequest.onBeforeRequest).not.toHaveBeenCalled();
  });

  it('keeps its title against the page, showing the host it is on', () => {
    const handle = windows.open(SIGN_IN);
    const window = lastWindow();
    const seen = jest.fn();
    handle.onNavigate(seen);

    const titleChange = event();
    window.emit('page-title-updated', titleChange, 'Sign in to Microsoft');
    expect(titleChange.preventDefault).toHaveBeenCalled();

    window.webContents.navigate('https://dbcab2c.b2clogin.com/x?y=1');
    expect(window.title).toBe('ParkStay — Sign in · dbcab2c.b2clogin.com');
    expect(seen).toHaveBeenCalledWith({
      url: 'https://dbcab2c.b2clogin.com/x?y=1',
      httpStatus: 200,
    });
    expect(handle.currentUrl()).toBe('https://dbcab2c.b2clogin.com/x?y=1');
  });

  it('the payment window allows *.dbca.wa.gov.au, and only logs a blocked host', () => {
    windows.open(PAYMENT);
    const window = lastWindow();
    expect(window.options.title).toBe('ParkStay — Payment');

    expect(window.webContents.willNavigate('https://ledger.dbca.wa.gov.au/pay')).toBe(false);
    expect(window.webContents.willNavigate('https://payments.bank.example/3ds')).toBe(true);
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      'The parkstay payment window blocked a navigation to https://payments.bank.example'
    );
  });

  it('refuses to open or load a URL off the allow-list, and a second window of a kind', () => {
    expect(() => windows.open({ ...SIGN_IN, url: 'https://evil.example/' })).toThrow(
      'not an allowed origin'
    );
    expect(electron.BrowserWindow.instances).toHaveLength(0);

    const handle = windows.open(SIGN_IN);
    expect(() => handle.load('https://evil.example/x')).toThrow('not an allowed origin');
    expect(() => windows.open(SIGN_IN)).toThrow('already open');
  });

  it('closing: the handle hears it, find forgets it; the main window closing closes them all', () => {
    const main = new electron.BrowserWindow({ title: 'WA Stay' });
    windows.attachMainWindow(main as unknown as BrowserWindow);
    const signIn = windows.open(SIGN_IN);
    const payment = windows.open(PAYMENT);
    const closed = jest.fn();
    signIn.onClosed(closed);
    expect(windows.find('parkstay', 'sign-in')).toBe(signIn);

    main.close();

    expect(closed).toHaveBeenCalledTimes(1);
    expect(signIn.isClosed()).toBe(true);
    expect(payment.isClosed()).toBe(true);
    expect(windows.find('parkstay', 'sign-in')).toBeUndefined();
  });

  describe('showing and the first page', () => {
    afterEach(() => jest.useRealTimers());

    it('shows when the first page is ready to paint, or after 1.5 s at the latest (a hanging first response)', () => {
      jest.useFakeTimers();
      windows.open(SIGN_IN);
      const hanging = lastWindow();
      expect(hanging.options.show).toBe(false);
      jest.advanceTimersByTime(1499);
      expect(hanging.isVisible()).toBe(false);
      jest.advanceTimersByTime(1);
      expect(hanging.isVisible()).toBe(true);
      expect(hanging.focus).toHaveBeenCalled();

      windows.open(PAYMENT);
      const quick = lastWindow();
      quick.emit('ready-to-show');
      expect(quick.isVisible()).toBe(true);
      jest.advanceTimersByTime(2000);
      expect(quick.show).toHaveBeenCalledTimes(1);
    });

    it('a first-page redirect off the allow-list closes the window: loaded rejects with PROVIDER_ERROR naming the origin only', async () => {
      jest.useFakeTimers();
      const handle = windows.open(SIGN_IN);
      const window = lastWindow();
      const closed = jest.fn();
      handle.onClosed(closed);

      expect(window.webContents.willRedirect('https://evil.example/login?token=SECRET')).toBe(true);

      const error = await handle.loaded.catch((e: unknown) => e);
      expect(toApiError(error)).toEqual({
        code: 'PROVIDER_ERROR',
        message: "ParkStay's page sent the window to https://evil.example, which it does not allow",
      });
      expect(String((error as Error).message)).not.toContain('SECRET');
      expect(window.destroyed).toBe(true);
      expect(handle.isClosed()).toBe(true);
      expect(closed).toHaveBeenCalledWith(error);
      // It never showed, and nothing went to the system browser
      jest.advanceTimersByTime(5000);
      expect(window.show).not.toHaveBeenCalled();
      expect(electron.shell.openExternal).not.toHaveBeenCalled();
    });

    it('a first page that fails to load closes the window with the reason; aborted loads and sub-frames do not', async () => {
      const handle = windows.open(PAYMENT);
      const contents = lastWindow().webContents;

      contents.failLoad(-3, 'ERR_ABORTED');
      contents.failLoad(-105, 'ERR_NAME_NOT_RESOLVED', 'https://frame.example/', false);
      expect(handle.isClosed()).toBe(false);

      contents.failLoad(-105, 'ERR_NAME_NOT_RESOLVED');
      await expect(handle.loaded).rejects.toMatchObject({
        code: 'provider',
        message: "ParkStay's page could not be loaded (ERR_NAME_NOT_RESOLVED)",
      });
      expect(handle.isClosed()).toBe(true);
    });

    it('after the first page, a failed load or a blocked redirect leaves the window open', async () => {
      const handle = windows.open(SIGN_IN);
      const contents = lastWindow().webContents;
      contents.showPage('https://parkstay.dbca.wa.gov.au/ssologin');
      await expect(handle.loaded).resolves.toBeUndefined();

      expect(contents.willRedirect('https://evil.example/')).toBe(true);
      contents.failLoad(-105, 'ERR_NAME_NOT_RESOLVED');
      expect(handle.isClosed()).toBe(false);
      // A sign-in window still hands a blocked page to the system browser
      expect(electron.shell.openExternal).toHaveBeenCalledWith('https://evil.example/');
    });
  });

  describe("the provider's waiting room", () => {
    const QUEUE = 'https://queue.dbca.wa.gov.au';
    const SITE = 'https://parkstay.dbca.wa.gov.au';
    const loads = () => lastWindow().loadURL.mock.calls.map(([url]) => url);

    it('coming back from it to the site on another page loads the target again, once', () => {
      windows.open({ ...SIGN_IN, waitingRoomOrigins: [QUEUE] });
      const contents = lastWindow().webContents;

      // As seen live: /ssologin, the SSO gateway, the queue, then ParkStay's home page
      contents.showPage('https://auth2.dbca.wa.gov.au/sso/auth_local');
      contents.showPage(`${QUEUE}/site-queue/waiting-room/parkstayv2/`);
      contents.showPage(`${SITE}/search-availability/information/`);
      expect(loads()).toEqual([PARKSTAY_SIGN_IN_URL, PARKSTAY_SIGN_IN_URL]);

      // Once only: a second bounce stays where it lands
      contents.showPage(`${QUEUE}/site-queue/waiting-room/parkstayv2/`);
      contents.showPage(`${SITE}/search-availability/information/`);
      expect(loads()).toHaveLength(2);
    });

    it('no reload when the waiting room returns to the target, leaves the site, or is not declared', () => {
      windows.open({ ...PAYMENT, waitingRoomOrigins: [QUEUE] });
      let contents = lastWindow().webContents;
      contents.showPage(`${QUEUE}/site-queue/waiting-room/parkstayv2/`);
      contents.showPage(`${SITE}/booking/`);
      contents.showPage(`${QUEUE}/site-queue/waiting-room/parkstayv2/`);
      contents.showPage('https://auth2.dbca.wa.gov.au/sso/auth_local');
      expect(loads()).toEqual([`${SITE}/booking/`]);
      lastWindow().close();

      windows.open(PAYMENT);
      contents = lastWindow().webContents;
      contents.showPage(`${QUEUE}/site-queue/waiting-room/parkstayv2/`);
      contents.showPage(`${SITE}/search-availability/information/`);
      expect(loads()).toEqual([`${SITE}/booking/`]);
    });

    it('a page loaded later (a pasted link) is the new target', () => {
      const handle = windows.open({ ...SIGN_IN, waitingRoomOrigins: [QUEUE] });
      const contents = lastWindow().webContents;
      const link = `${SITE}/ssologin?next=/my-bookings/`;
      handle.load(link);
      contents.showPage(`${QUEUE}/site-queue/waiting-room/parkstayv2/`);
      contents.showPage(`${SITE}/search-availability/information/`);
      expect(loads()).toEqual([PARKSTAY_SIGN_IN_URL, link, link]);
    });
  });

  it('onLoaded hears finished pages; hasText reads them with find-in-page (case-sensitive) and clears the selection', async () => {
    const handle = windows.open(PAYMENT);
    const contents = lastWindow().webContents;
    const loaded = jest.fn();
    handle.onLoaded(loaded);

    contents.showPage('https://parkstay.dbca.wa.gov.au/success/?checkouthash=abc', {
      text: 'Your booking PB2072968 is completed',
    });
    expect(loaded).toHaveBeenCalledWith({
      url: 'https://parkstay.dbca.wa.gov.au/success/?checkouthash=abc',
      httpStatus: 200,
    });
    await expect(handle.hasText('PB2072968')).resolves.toBe(true);
    await expect(handle.hasText('pb2072968')).resolves.toBe(false);
    await expect(handle.hasText('PB1')).resolves.toBe(false);
    expect(contents.stopFindInPage).toHaveBeenCalledWith('clearSelection');

    handle.close();
    await expect(handle.hasText('PB2072968')).resolves.toBe(false);
  });

  it("hasText waits out Chromium's early 0-match answer for the real count (seen live)", async () => {
    const handle = windows.open(PAYMENT);
    const contents = lastWindow().webContents;
    contents.showPage('https://parkstay.dbca.wa.gov.au/success/', { text: 'PB2072968' });
    contents.findInPage = jest.fn(() => {
      setImmediate(() =>
        contents.emit('found-in-page', {}, { requestId: 7, matches: 0, finalUpdate: true })
      );
      setTimeout(
        () => contents.emit('found-in-page', {}, { requestId: 7, matches: 1, finalUpdate: true }),
        50
      );
      return 7;
    }) as typeof contents.findInPage;

    await expect(handle.hasText('PB2072968')).resolves.toBe(true);
  });

  it('clears and flushes the provider partition', async () => {
    await windows.clear('parkstay');
    await windows.flush('parkstay');
    const ses = partitionSession();

    expect(ses.clearStorageData).toHaveBeenCalledTimes(1);
    expect(ses.clearAuthCache).toHaveBeenCalledTimes(1);
    expect(ses.cookies.flushStore).toHaveBeenCalledTimes(1);
  });

  it('provider-windows.ts never mentions preload outside comments', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../src/main/app/provider-windows.ts'),
      'utf8'
    );
    expect(stripComments(source)).not.toMatch(/preload/i);
  });
});
