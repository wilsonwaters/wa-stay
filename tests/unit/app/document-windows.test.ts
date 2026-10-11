/**
 * Document windows (a location's campground map) against a mocked `electron`
 * (`FakeBrowserWindow`): the sandboxed window with plugins on an in-memory partition of its own,
 * no preload and no script of ours; the top level locked to the document's URL (navigations,
 * main-frame redirects, new windows); refused permissions, devices, certificates, client
 * certificates, HTTP credentials and downloads beyond the viewer's own; the title; a non-PDF
 * answer or an HTTP error closing the window with `PROVIDER_ERROR`; a second open focusing the
 * window; and closing with the main window and on `closeAll`. `npm run test:electron` runs the
 * real window.
 */

import type { BrowserWindow } from 'electron';
import {
  documentPartition,
  DocumentWindows,
  isDocumentUrl,
  isDocumentWindow,
  isSameDocument,
  PDF_VIEWER_ORIGIN,
  type DocumentWindowRequest,
} from '@main/app/document-windows';
import { isProviderWindow } from '@main/app/provider-windows';
import { ProviderError, toApiError } from '@main/providers/sdk/errors';
import { logger } from '@main/utils/logger';
import type { FakeBrowserWindow } from '@tests/utils/electron-mocks';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());

const electron = jest.requireMock('electron') as {
  BrowserWindow: typeof FakeBrowserWindow;
  shell: { openExternal: jest.Mock };
  session: { fromPartition: jest.Mock };
};

type HeadersListener = (
  details: Record<string, unknown>,
  callback: (response: { cancel?: boolean }) => void
) => void;

type FakeSession = {
  setPermissionRequestHandler: jest.Mock;
  setPermissionCheckHandler: jest.Mock;
  setDevicePermissionHandler: jest.Mock;
  setUserAgent: jest.Mock;
  on: jest.Mock;
  emit(event: string, ...args: unknown[]): boolean;
  webRequest: { onHeadersReceived: jest.Mock; onBeforeRequest: jest.Mock };
  protocol: { handle: jest.Mock };
};

const MAP_URL =
  'https://parkstay.dbca.wa.gov.au/media/parkstay/campground_maps/20/Bungarra_Campground_mud_map.pdf';

const MAP: DocumentWindowRequest = {
  key: 'parkstay:20#campground-map',
  providerId: 'parkstay',
  providerName: 'ParkStay',
  url: MAP_URL,
  title: 'Bungarra · Campground map',
  documentName: 'campground map',
  mediaType: 'application/pdf',
};

const documentSession = (id = 'parkstay'): FakeSession =>
  electron.session.fromPartition(`documents-${id}`) as FakeSession;

function event(extra: Record<string, unknown> = {}) {
  return { ...extra, preventDefault: jest.fn() };
}

describe('DocumentWindows', () => {
  let windows: DocumentWindows;
  const lastWindow = (): FakeBrowserWindow =>
    electron.BrowserWindow.instances[electron.BrowserWindow.instances.length - 1];
  /** The partition's answer check; it is installed once per session, on first use. */
  const headersListener = (): HeadersListener => {
    const calls = documentSession().webRequest.onHeadersReceived.mock.calls;
    return calls[calls.length - 1][0] as HeadersListener;
  };
  /** Runs a main-frame answer for `window` through the check; true when it was cancelled. */
  const answer = (
    window: FakeBrowserWindow,
    statusCode: number,
    headers: Record<string, string[]>,
    resourceType = 'mainFrame'
  ): boolean => {
    let cancelled = false;
    headersListener()(
      {
        url: MAP_URL,
        resourceType,
        webContentsId: window.webContents.id,
        statusCode,
        responseHeaders: headers,
      },
      (response) => (cancelled = response.cancel === true)
    );
    return cancelled;
  };

  beforeEach(() => {
    electron.BrowserWindow.instances.length = 0;
    // The mocked partitions live for the whole file: forget their calls
    jest.clearAllMocks();
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    jest.spyOn(logger, 'info').mockImplementation(() => logger);
    jest.spyOn(logger, 'debug').mockImplementation(() => logger);
    windows = new DocumentWindows({ devTools: false });
  });

  afterEach(() => {
    windows.closeAll();
    jest.restoreAllMocks();
  });

  it('opens a sandboxed window with plugins on an in-memory partition, with no preload', () => {
    const main = new electron.BrowserWindow({ title: 'WA Stay' });
    windows.attachMainWindow(main as unknown as BrowserWindow);
    void windows.open(MAP);
    const window = lastWindow();
    const prefs = window.options.webPreferences!;

    expect(documentPartition('parkstay')).toBe('documents-parkstay');
    expect(prefs.partition).toBe('documents-parkstay');
    // Not `persist:`, so nothing is kept; never the provider's own partition and its cookies
    expect(String(prefs.partition)).not.toMatch(/^persist:/);
    expect(prefs.partition).not.toBe('persist:provider-parkstay');
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
      safeDialogs: true,
      plugins: true,
      devTools: false,
    });
    expect(window.options).toMatchObject({
      parent: main,
      title: 'Bungarra · Campground map',
      show: false,
    });
    expect(window.setMenu).toHaveBeenCalledWith(null);
    expect(window.loadURL).toHaveBeenCalledWith(MAP_URL);
    expect(isDocumentWindow(window.webContents)).toBe(true);
    expect(isDocumentWindow(main.webContents)).toBe(false);
    expect(isProviderWindow(window.webContents)).toBe(false);
  });

  it('keeps its title: the document cannot change it', () => {
    void windows.open(MAP);
    const titleEvent = event();
    lastWindow().emit('page-title-updated', titleEvent, 'Bungarra_Campground_mud_map.pdf');
    expect(titleEvent.preventDefault).toHaveBeenCalled();
  });

  it('refuses every permission request and check, and every device, on its partition', () => {
    void windows.open(MAP);
    const ses = documentSession();
    const callback = jest.fn();
    ses.setPermissionRequestHandler.mock.calls[0][0]({}, 'media', callback, {});
    expect(callback).toHaveBeenCalledWith(false);
    expect(ses.setPermissionCheckHandler.mock.calls[0][0]({}, 'clipboard-read')).toBe(false);
    expect(ses.setDevicePermissionHandler.mock.calls[0][0]({})).toBe(false);
    // The partition is prepared once, however many documents open on it
    windows.closeAll();
    void windows.open({ ...MAP, key: 'parkstay:43#campground-map' });
    expect(ses.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(ses.webRequest.onHeadersReceived).toHaveBeenCalledTimes(1);
  });

  it('shows only the document’s URL at the top level: other navigations are cancelled', () => {
    void windows.open(MAP);
    const contents = lastWindow().webContents;
    expect(contents.willNavigate(MAP_URL)).toBe(false);
    expect(contents.willNavigate(`${MAP_URL}#page=1`)).toBe(false);
    expect(contents.willNavigate('https://parkstay.dbca.wa.gov.au/')).toBe(true);
    expect(contents.willNavigate('https://example.com/phish?token=SECRET')).toBe(true);
    expect(contents.willNavigate(`${MAP_URL}?other=1`)).toBe(true);
    expect(contents.willRedirect('https://example.com/elsewhere', false)).toBe(false);
    // Logged by origin only
    const logged = (logger.warn as jest.Mock).mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('https://example.com');
    expect(logged).not.toContain('SECRET');
  });

  it('refuses new windows, and opens nothing in the browser', () => {
    void windows.open(MAP);
    const contents = lastWindow().webContents;
    expect(contents.windowOpenHandler!({ url: 'https://exploreparks.dbca.wa.gov.au/' })).toEqual({
      action: 'deny',
    });
    expect(contents.windowOpenHandler!({ url: MAP_URL })).toEqual({ action: 'deny' });
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
  });

  it('rejects certificate errors and offers no client certificate or credentials', () => {
    void windows.open(MAP);
    const contents = lastWindow().webContents;
    const certificate = jest.fn();
    const certificateEvent = event();
    contents.emit('certificate-error', certificateEvent, MAP_URL, 'net::ERR_CERT', {}, certificate);
    expect(certificateEvent.preventDefault).toHaveBeenCalled();
    expect(certificate).toHaveBeenCalledWith(false);

    const select = jest.fn();
    const selectEvent = event();
    contents.emit('select-client-certificate', selectEvent, MAP_URL, [{}], select);
    expect(selectEvent.preventDefault).toHaveBeenCalled();
    expect(select).toHaveBeenCalledWith();

    const login = jest.fn();
    const loginEvent = event();
    contents.emit('login', loginEvent, {}, {}, login);
    expect(loginEvent.preventDefault).toHaveBeenCalled();
    expect(login).toHaveBeenCalledWith();

    const unload = event();
    contents.emit('will-prevent-unload', unload);
    expect(unload.preventDefault).toHaveBeenCalled();
  });

  it('allows only the viewer’s own downloads: the document, or the viewer’s saved copy', () => {
    // A partition no earlier test's DocumentWindows has listened on
    void windows.open({ ...MAP, providerId: 'downloads' });
    const ses = documentSession('downloads');
    const contents = lastWindow().webContents;
    const download = (url: string, from: unknown = contents): boolean => {
      const willDownload = event();
      ses.emit('will-download', willDownload, { getURL: () => url }, from);
      return willDownload.preventDefault.mock.calls.length === 0;
    };
    expect(download(MAP_URL)).toBe(true);
    expect(download(`blob:${PDF_VIEWER_ORIGIN}/0b6c4d8e-1111-4c3a-9f1e-123456789abc`)).toBe(true);
    expect(download('https://parkstay.dbca.wa.gov.au/media/other.pdf')).toBe(false);
    expect(download('blob:https://parkstay.dbca.wa.gov.au/0b6c4d8e')).toBe(false);
    // Only from a document window
    expect(download(MAP_URL, { id: 424242 })).toBe(false);
  });

  it('resolves once the document arrives as a PDF, and shows the window', async () => {
    const opened = windows.open(MAP);
    const window = lastWindow();
    expect(answer(window, 200, { 'Content-Type': ['application/pdf'] })).toBe(false);
    window.webContents.navigate(MAP_URL);
    window.emit('ready-to-show');
    await expect(opened).resolves.toBeUndefined();
    expect(window.show).toHaveBeenCalled();
    expect(window.destroy).not.toHaveBeenCalled();
  });

  it('closes the window with PROVIDER_ERROR when ParkStay answers text/plain, never showing it', async () => {
    const opened = windows.open(MAP);
    const window = lastWindow();
    // A missing file: 200 text/plain "ERROR opening file"
    expect(answer(window, 200, { 'content-type': ['text/plain; charset=utf-8'] })).toBe(true);
    window.emit('ready-to-show');

    const error = await opened.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(toApiError(error)).toEqual({
      code: 'PROVIDER_ERROR',
      message: "ParkStay didn't send the campground map. Try again later.",
    });
    expect(window.destroy).toHaveBeenCalled();
    expect(window.show).not.toHaveBeenCalled();
    // Closed, so the next open is a new window
    void windows.open(MAP);
    expect(electron.BrowserWindow.instances).toHaveLength(2);
  });

  it('closes the window with PROVIDER_ERROR on an HTTP error or no content type', async () => {
    const notFound = windows.open(MAP);
    expect(answer(lastWindow(), 404, { 'content-type': ['text/html'] })).toBe(true);
    await expect(notFound).rejects.toMatchObject({ name: 'ProviderError' });

    const untyped = windows.open(MAP);
    expect(answer(lastWindow(), 200, {})).toBe(true);
    await expect(untyped).rejects.toBeInstanceOf(ProviderError);
  });

  it('lets redirects and other resources through the answer check', () => {
    void windows.open(MAP);
    const window = lastWindow();
    expect(answer(window, 302, { location: [MAP_URL] })).toBe(false);
    expect(answer(window, 200, { 'content-type': ['text/css'] }, 'stylesheet')).toBe(false);
    expect(window.destroy).not.toHaveBeenCalled();
  });

  it('closes the window with PROVIDER_ERROR when the first answer redirects elsewhere', async () => {
    const opened = windows.open(MAP);
    const window = lastWindow();
    expect(window.webContents.willRedirect('https://parkstay.dbca.wa.gov.au/')).toBe(true);
    await expect(opened).rejects.toMatchObject({
      message: "ParkStay's campground map could not be opened: ParkStay sent it somewhere else.",
    });
    expect(window.destroy).toHaveBeenCalled();
  });

  it('closes the window with PROVIDER_ERROR when the document cannot be loaded', async () => {
    const opened = windows.open(MAP);
    lastWindow().webContents.failLoad(-105, 'ERR_NAME_NOT_RESOLVED');
    await expect(opened).rejects.toMatchObject({
      message:
        "ParkStay's campground map could not be opened (ERR_NAME_NOT_RESOLVED). Try again later.",
    });
  });

  it('rejects when the person closes the window before the document arrives', async () => {
    const opened = windows.open(MAP);
    lastWindow().close();
    await expect(opened).rejects.toBeInstanceOf(ProviderError);
  });

  it('focuses the open window on a second open of the same document', async () => {
    const first = windows.open(MAP);
    const window = lastWindow();
    window.webContents.navigate(MAP_URL);
    await first;
    window.focus.mockClear();

    await expect(windows.open(MAP)).resolves.toBeUndefined();
    expect(electron.BrowserWindow.instances).toHaveLength(1);
    expect(window.show).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    // Another document gets its own window
    void windows.open({ ...MAP, key: 'parkstay:43#campground-map', url: `${MAP_URL}?43` });
    expect(electron.BrowserWindow.instances).toHaveLength(2);
  });

  it('closes with the main window, and on closeAll (the quit path)', () => {
    const main = new electron.BrowserWindow({ title: 'WA Stay' });
    windows.attachMainWindow(main as unknown as BrowserWindow);
    void windows.open(MAP);
    const first = lastWindow();
    main.close();
    expect(first.destroy).toHaveBeenCalled();

    void windows.open(MAP);
    const second = lastWindow();
    windows.closeAll();
    expect(second.destroy).toHaveBeenCalled();
  });

  it('refuses an address that is not https (loopback http aside)', async () => {
    await expect(
      windows.open({ ...MAP, url: 'http://parkstay.dbca.wa.gov.au/x.pdf' })
    ).rejects.toThrow('not https');
    await expect(windows.open({ ...MAP, url: 'file:///etc/passwd' })).rejects.toThrow();
    expect(electron.BrowserWindow.instances).toHaveLength(0);
  });

  it('passes a new partition to the fixture hook once, from source only', () => {
    const prepareSession = jest.fn();
    windows = new DocumentWindows({ devTools: true, prepareSession });
    void windows.open({ ...MAP, providerId: 'other' });
    void windows.open({ ...MAP, providerId: 'other', key: 'other:2#campground-map' });
    expect(prepareSession).toHaveBeenCalledTimes(1);
    expect(prepareSession).toHaveBeenCalledWith(documentSession('other'), 'other');
    expect(lastWindow().options.webPreferences!.devTools).toBe(true);
  });
});

describe('document URLs', () => {
  it('allows https without credentials, and http only on loopback', () => {
    expect(isDocumentUrl(MAP_URL)).toBe(true);
    expect(isDocumentUrl('http://127.0.0.1:8080/map.pdf')).toBe(true);
    expect(isDocumentUrl('http://parkstay.dbca.wa.gov.au/map.pdf')).toBe(false);
    expect(isDocumentUrl('https://user:pw@parkstay.dbca.wa.gov.au/map.pdf')).toBe(false);
    expect(isDocumentUrl('javascript:alert(1)')).toBe(false);
    expect(isDocumentUrl('not a url')).toBe(false);
  });

  it('compares documents without their fragment', () => {
    expect(isSameDocument(`${MAP_URL}#page=2`, MAP_URL)).toBe(true);
    expect(isSameDocument(`${MAP_URL}?a=1`, MAP_URL)).toBe(false);
    expect(isSameDocument('nonsense', MAP_URL)).toBe(false);
  });
});
