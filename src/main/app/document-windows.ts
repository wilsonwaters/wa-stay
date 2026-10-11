/**
 * Document windows: a provider's document about a location, such as ParkStay's campground map
 * (a one-page PDF), in Electron's built-in PDF viewer (`catalog.openDocument`).
 *
 * The document is not ours, and the provider serves it with `X-Frame-Options: DENY`, so it
 * gets a window of its own, which gets nothing of the app:
 * - `sandbox`, `contextIsolation`, no Node integration (frames and workers included), web
 *   security on, no `<webview>`, no drag-and-drop navigation, no spellchecker, safe dialogs,
 *   DevTools only from source, no preload and no script of ours. `plugins` is on for this
 *   window only: it is what turns on the PDF viewer;
 * - its own in-memory partition (`documents-<providerId>`, no `persist:`), so it never sends
 *   or receives the provider's cookies, and nothing it gets is kept after the app quits;
 * - it is never a trusted IPC sender (`isDocumentWindow` keeps the sender guard honest);
 * - the top level shows only the document's own URL (a fragment aside): every other
 *   navigation and main-frame redirect is cancelled, a redirect before the document arrives
 *   closes the window, and new windows are refused. Each is logged by origin only;
 * - downloads are refused, except the viewer's own: the document itself, or the copy the
 *   viewer saves from its own (extension) origin;
 * - every permission request and check, and every device request, is refused; certificate
 *   errors are rejected; no client certificate or HTTP credentials are offered; a page cannot
 *   stop the window closing;
 * - the window's title is "<place> · <document>", which the document cannot change.
 *
 * An answer that is not the document's media type (ParkStay may answer a missing file with a
 * 200 `text/plain` "ERROR opening file"), or an HTTP error, closes the window before it shows
 * anything, and `open` rejects with a `ProviderError` (`PROVIDER_ERROR`) in plain words. A
 * second `open` of a document already open focuses its window. The windows close with the main
 * window and on quit (`closeAll`).
 */

import { BrowserWindow, session as electronSession } from 'electron';
import type { Session, WebContents } from 'electron';
import type { ProviderId } from '@shared/types/provider.types';
import { ProviderError } from '../providers/sdk/errors';
import { describeUrl } from '../providers/sdk/url-patterns';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'document-windows' });

const WIDTH = 900;
const HEIGHT = 760;

/** A window shows this long after it opens at the latest, painted or not. */
export const DOCUMENT_SHOW_AFTER_MS = 1500;
/** `net::ERR_ABORTED`: a navigation the window (or a newer one) cancelled. */
const ERR_ABORTED = -3;
/** Chromium's PDF viewer, an extension: the copy it saves comes from its own origin. */
export const PDF_VIEWER_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** The in-memory partition of a provider's document windows (never `persist:`). */
export function documentPartition(providerId: ProviderId): string {
  return `documents-${providerId}`;
}

/** Every document window's webContents. */
const documentContents = new WeakSet<object>();

/** True for the webContents of a document window. */
export function isDocumentWindow(contents: unknown): boolean {
  return typeof contents === 'object' && contents !== null && documentContents.has(contents);
}

/**
 * The URL a document window may open: https with no user name or password. Plain http only on
 * a loopback host, which only the live Electron tests use (main resolves every real document
 * to https).
 */
export function isDocumentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    return (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname))
    );
  } catch {
    return false;
  }
}

/** `url` without its fragment, or undefined for an invalid URL. */
function withoutFragment(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return undefined;
  }
}

/** True when `url` is the document `documentUrl`, whatever its fragment. */
export function isSameDocument(url: string, documentUrl: string): boolean {
  const here = withoutFragment(url);
  return here !== undefined && here === withoutFragment(documentUrl);
}

/** A response header's value, whatever the case of its name. */
function headerValue(
  headers: Record<string, string[] | string> | undefined,
  name: string
): string | undefined {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === name) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

/** `text/plain; charset=utf-8` → `text/plain`. */
function essence(mediaType: string | undefined): string {
  return (mediaType ?? '').split(';')[0].trim().toLowerCase();
}

export interface DocumentWindowRequest {
  /** One window per key: `${locationKey}#${documentId}`. */
  key: string;
  providerId: ProviderId;
  /** The provider's short name, for messages ("ParkStay"). */
  providerName: string;
  /** The document's address (`isDocumentUrl`), resolved in main. */
  url: string;
  /** The window title: "<place> · <document>". */
  title: string;
  /** What the document's title says in a sentence ("campground map"). */
  documentName: string;
  /** The media type the answer must have (`application/pdf`). */
  mediaType: string;
}

export interface DocumentWindowsOptions {
  /** DevTools in document windows: only when running from source. */
  devTools: boolean;
  /**
   * Test-only (fixture mode, from source only): prepares a document partition when it is first
   * used, to serve it from fixtures (`testing/fixture-documents.ts`).
   */
  prepareSession?: (session: Session, providerId: ProviderId) => void;
  /** Tests only: `DOCUMENT_SHOW_AFTER_MS`. */
  showAfterMs?: number;
}

interface OpenDocument {
  request: DocumentWindowRequest;
  window: BrowserWindow;
  loaded: Promise<void>;
  /** The document arrived: later failures are the viewer's own business. */
  committed: boolean;
  fail(message: string): void;
}

export class DocumentWindows {
  private readonly windows = new Map<string, OpenDocument>();
  /** The same entries, by webContents id, for session-wide handlers. */
  private readonly byContentsId = new Map<number, OpenDocument>();
  private readonly prepared = new WeakSet<Session>();
  private parent: BrowserWindow | null = null;

  constructor(private readonly options: DocumentWindowsOptions) {}

  /** Document windows sit above the main window, and close with it. */
  attachMainWindow(window: BrowserWindow): void {
    this.parent = window;
    window.once('closed', () => {
      if (this.parent === window) this.parent = null;
      this.closeAll();
    });
  }

  /**
   * Opens the document in its window, or focuses its window when it is open already.
   * Resolves once the document arrives; rejects with a `ProviderError` (the window closed)
   * when the answer is not the document's media type, an HTTP error, a redirect elsewhere or a
   * failed load.
   */
  open(request: DocumentWindowRequest): Promise<void> {
    if (!isDocumentUrl(request.url)) {
      return Promise.reject(
        new Error(`A document window cannot open ${describeUrl(request.url)}: it is not https`)
      );
    }
    const open = this.windows.get(request.key);
    if (open && !open.window.isDestroyed()) {
      if (open.window.isMinimized()) open.window.restore();
      open.window.show();
      open.window.focus();
      return open.loaded;
    }

    const { providerId, providerName, documentName } = request;
    const partition = documentPartition(providerId);
    this.prepare(electronSession.fromPartition(partition), providerId);
    const parent = this.parent && !this.parent.isDestroyed() ? this.parent : undefined;
    const window = new BrowserWindow({
      ...(parent ? { parent } : {}),
      width: WIDTH,
      height: HEIGHT,
      title: request.title,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition,
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
        // Electron's built-in PDF viewer; only document windows have plugins
        plugins: true,
        devTools: this.options.devTools,
      },
    });
    window.setMenu(null);
    const contents = window.webContents;
    documentContents.add(contents);
    const what = `${providerId} document window`;

    let closed = false;
    let shown = false;
    let failure: ProviderError | undefined;
    let resolveLoaded!: () => void;
    let rejectLoaded!: (error: ProviderError) => void;
    const loaded = new Promise<void>((resolve, reject) => {
      resolveLoaded = resolve;
      rejectLoaded = reject;
    });
    // A caller that does not wait must not see an unhandled rejection
    loaded.catch(() => undefined);

    const show = (): void => {
      if (shown || closed || failure || window.isDestroyed()) return;
      shown = true;
      window.show();
      window.focus();
    };
    const showTimer = setTimeout(show, this.options.showAfterMs ?? DOCUMENT_SHOW_AFTER_MS);

    const entry: OpenDocument = {
      request,
      window,
      loaded,
      committed: false,
      fail: (message: string) => {
        if (entry.committed || failure || closed) return;
        failure = new ProviderError({ providerId, message });
        log.warn(`The ${what} closed itself: ${message}`);
        rejectLoaded(failure);
        if (!window.isDestroyed()) window.destroy();
      },
    };
    const couldNotOpen = `${providerName}'s ${documentName} could not be opened`;

    contents.on('will-navigate', (event, legacyUrl) => {
      const url = (event as { url?: string }).url ?? legacyUrl;
      if (isSameDocument(url, request.url)) return;
      event.preventDefault();
      log.warn(`The ${what} blocked a navigation to ${describeUrl(url)}`);
    });
    contents.on('will-redirect', (event, legacyUrl, _isInPlace, legacyIsMainFrame) => {
      const details = event as { url?: string; isMainFrame?: boolean };
      if (!(details.isMainFrame ?? legacyIsMainFrame)) return;
      const url = details.url ?? legacyUrl;
      if (isSameDocument(url, request.url)) return;
      event.preventDefault();
      log.warn(`The ${what} blocked a redirect to ${describeUrl(url)}`);
      entry.fail(`${couldNotOpen}: ${providerName} sent it somewhere else.`);
    });
    contents.setWindowOpenHandler(({ url }) => {
      log.warn(`The ${what} refused a new window for ${describeUrl(url)}`);
      return { action: 'deny' };
    });
    contents.on('certificate-error', (event, url, error, _certificate, callback) => {
      event.preventDefault();
      callback(false);
      log.warn(`The ${what} rejected a certificate for ${describeUrl(url)} (${error})`);
    });
    contents.on('select-client-certificate', (event, _url, _list, callback) => {
      event.preventDefault();
      (callback as (certificate?: unknown) => void)();
    });
    contents.on('login', (event, _details, _authInfo, callback) => {
      event.preventDefault();
      callback();
    });
    contents.on('will-prevent-unload', (event) => event.preventDefault());
    contents.on('render-process-gone', (_event, details) =>
      log.warn(`The ${what} page stopped (${details.reason})`)
    );
    window.on('page-title-updated', (event) => event.preventDefault());
    window.once('ready-to-show', show);
    contents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return;
      entry.fail(`${couldNotOpen} (${errorDescription || errorCode}). Try again later.`);
    });
    contents.on('did-navigate', (_event, url) => {
      if (entry.committed || failure || !isSameDocument(url, request.url)) return;
      entry.committed = true;
      resolveLoaded();
    });
    const contentsId = contents.id;
    window.once('closed', () => {
      closed = true;
      clearTimeout(showTimer);
      if (this.windows.get(request.key) === entry) this.windows.delete(request.key);
      if (this.byContentsId.get(contentsId) === entry) this.byContentsId.delete(contentsId);
      // Closed by the person (or with the app) before the document arrived
      if (!entry.committed && !failure) {
        failure = new ProviderError({ providerId, message: `${couldNotOpen}: its window closed.` });
        rejectLoaded(failure);
      }
    });

    this.windows.set(request.key, entry);
    this.byContentsId.set(contentsId, entry);
    log.info(`Opened the ${what} on ${describeUrl(request.url)}`);
    window
      .loadURL(request.url)
      .catch((error: unknown) =>
        log.debug(
          `The ${what} did not finish loading ${describeUrl(request.url)}: ${String(error)}`
        )
      );
    return loaded;
  }

  /** Closes every document window at once (`destroy`: no page can hold it open). */
  closeAll(): void {
    for (const { window } of [...this.windows.values()]) {
      if (!window.isDestroyed()) window.destroy();
    }
  }

  /** Permission, download and answer checks for a document partition, once per session. */
  private prepare(ses: Session, providerId: ProviderId): void {
    if (this.prepared.has(ses)) return;
    this.prepared.add(ses);
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.on('will-download', (event, item, contents) => {
      const url = item.getURL();
      if (this.isViewerDownload(contents, url)) return;
      event.preventDefault();
      log.warn(`A ${providerId} document window refused a download from ${describeUrl(url)}`);
    });
    // The document's own answer: the expected media type, or the window closes. Fixture mode
    // serves its answers through a protocol handler, which this does not see.
    ses.webRequest.onHeadersReceived((details, callback) => {
      const entry =
        details.resourceType === 'mainFrame' && typeof details.webContentsId === 'number'
          ? this.byContentsId.get(details.webContentsId)
          : undefined;
      const problem = entry ? this.answerProblem(entry.request, details) : undefined;
      if (entry && problem) {
        callback({ cancel: true });
        log.warn(`The ${providerId} document answered ${problem}`);
        entry.fail(
          `${entry.request.providerName} didn't send the ${entry.request.documentName}. Try again later.`
        );
        return;
      }
      callback({});
    });
    this.options.prepareSession?.(ses, providerId);
  }

  /** Why a main-frame answer is not the document, or undefined when it is (or redirects). */
  private answerProblem(
    request: DocumentWindowRequest,
    details: { statusCode: number; responseHeaders?: Record<string, string[] | string> }
  ): string | undefined {
    const { statusCode } = details;
    // A redirect is for `will-redirect` to judge
    if (statusCode >= 300 && statusCode < 400) return undefined;
    if (statusCode < 200 || statusCode >= 300) return `HTTP ${statusCode}`;
    const type = essence(headerValue(details.responseHeaders, 'content-type'));
    return type === essence(request.mediaType) ? undefined : `${type || 'no content type'}`;
  }

  /** The viewer's own download: the document itself, or the copy the viewer saves. */
  private isViewerDownload(contents: WebContents | undefined, url: string): boolean {
    const entry = contents ? this.byContentsId.get(contents.id) : undefined;
    if (!entry) return false;
    return isSameDocument(url, entry.request.url) || url.startsWith(`blob:${PDF_VIEWER_ORIGIN}/`);
  }
}
