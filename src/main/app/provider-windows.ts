/**
 * Provider sign-in and payment windows (brief D5; architecture-notes §7, §12.32).
 *
 * A provider window shows the provider's own pages, on the provider's session partition
 * (`persist:provider-<id>`), the one its `ElectronSessionHttpClient` uses. Cookies the person
 * gets by signing in are therefore the ones API calls and holds send, and a hold placed
 * through the client is in the basket the payment window shows.
 *
 * The pages are not ours, so the window gets nothing of the app:
 * - `sandbox`, `contextIsolation`, no Node integration (frames and workers included), web
 *   security on, no `<webview>`, no drag-and-drop navigation, no spellchecker downloads, safe
 *   dialogs, DevTools only when not packaged, and no script of ours injected into the page;
 * - it is never a trusted IPC sender (`isProviderWindow` keeps the sender guard honest);
 * - top-level navigations and redirects (`will-navigate`, main-frame `will-redirect`) are
 *   allowed only to the window's origin allow-list (`url-patterns.ts`). Anything else is
 *   cancelled and logged by origin only, never with its path or query (a sign-in link carries
 *   a token, a payment page a booking hash). A sign-in window sends a blocked http(s) page to
 *   the system browser; a payment window only logs it, so the host can be added (PQ5).
 *   Sub-frames are not restricted: payment providers use them (BPOINT, 3-D Secure);
 * - a new window for an allowed URL loads in the same window; any other http(s) URL opens in
 *   the system browser;
 * - every permission request and check, and every device request, is refused; certificate
 *   errors are rejected; no client certificate or HTTP credentials are offered; a page cannot
 *   stop the window closing (`will-prevent-unload`);
 * - the page keeps its own Content-Security-Policy: nothing here touches response headers.
 *
 * The window has no address bar, so its title names the provider, the purpose and the host
 * it shows (`ParkStay — Sign in · dbcab2c.b2clogin.com`); a page cannot change it.
 *
 * Opening and loading:
 * - the window shows when its first page is ready to paint, or `SHOW_AFTER_MS` after it opens
 *   at the latest, so a slow or hanging first response never leaves an invisible window;
 * - when the first page is blocked (a redirect off the allow-list) or cannot be loaded, the
 *   window closes itself and `loaded` rejects with a `ProviderError` naming the origin only;
 * - a provider's waiting room (its queue) may send the person on to the provider's home
 *   page rather than the page the window was opened for: coming back from a
 *   `waitingRoomOrigins` page to the target's origin on another path loads the target once
 *   more.
 *
 * `hasText` asks Chromium's find-in-page whether the page shows a text: read-only, and no
 * script of ours runs in the page.
 */

import { BrowserWindow, session as electronSession, shell } from 'electron';
import type { Session, WebContents } from 'electron';
import type { ProviderId } from '@shared/types/provider.types';
import type {
  ProviderSessionStore,
  ProviderWindowHandle,
  ProviderWindowKind,
  ProviderWindowNavigation,
  ProviderWindowOpener,
  ProviderWindowRequest,
} from '../core/accounts/ports';
import { ProviderError } from '../providers/sdk/errors';
import { providerPartition } from '../providers/sdk/http-electron';
import { describeUrl, matchesOrigin } from '../providers/sdk/url-patterns';
import { chromeUserAgent, runtimeChromeMajor } from '../providers/sdk/user-agent';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'provider-windows' });

const WIDTH = 520;
const HEIGHT = 760;

/** A window shows this long after it opens at the latest, painted or not. */
export const SHOW_AFTER_MS = 1500;
/** How long find-in-page may take to answer. */
const FIND_TIMEOUT_MS = 3000;
/**
 * How long a "no match" answer is given to change. Chromium's first final answer for a page
 * can be 0 matches, with the real count following (seen live on Electron 28).
 */
const FIND_SETTLE_MS = 500;
/** `net::ERR_ABORTED`: a navigation the window (or a newer one) cancelled. */
const ERR_ABORTED = -3;

/** Every provider window's webContents. */
const providerContents = new WeakSet<object>();

/** True for the webContents of a provider sign-in or payment window. */
export function isProviderWindow(contents: unknown): boolean {
  return typeof contents === 'object' && contents !== null && providerContents.has(contents);
}

function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/** Origin and path, or undefined for an invalid URL. */
function placeOf(url: string): { origin: string; path: string } | undefined {
  try {
    const { origin, pathname } = new URL(url);
    return { origin, path: pathname };
  } catch {
    return undefined;
  }
}

export interface ProviderWindowsOptions {
  /** DevTools in provider windows: never in a packaged build. */
  devTools: boolean;
  /** The Chrome major version the partition presents. Defaults to the one Electron runs. */
  chromeMajor?: string;
  /** Tests only: `SHOW_AFTER_MS`. */
  showAfterMs?: number;
}

export class ProviderWindows implements ProviderWindowOpener, ProviderSessionStore {
  private readonly windows = new Map<
    string,
    { handle: ProviderWindowHandle; window: BrowserWindow }
  >();
  private readonly hardened = new WeakSet<Session>();
  private readonly userAgent: string;
  private parent: BrowserWindow | null = null;

  constructor(private readonly options: ProviderWindowsOptions) {
    this.userAgent = chromeUserAgent(options.chromeMajor ?? runtimeChromeMajor());
  }

  /** Provider windows sit above the main window, and close with it. */
  attachMainWindow(window: BrowserWindow): void {
    this.parent = window;
    window.once('closed', () => {
      if (this.parent === window) this.parent = null;
      this.closeAll();
    });
  }

  open(request: ProviderWindowRequest): ProviderWindowHandle {
    const { providerId, kind } = request;
    if (!matchesOrigin(request.url, request.allowedOrigins)) {
      throw new Error(
        `A ${kind} window for ${providerId} cannot open ${describeUrl(request.url)}: it is not an allowed origin`
      );
    }
    const key = `${providerId}:${kind}`;
    if (this.windows.has(key)) {
      throw new Error(`A ${kind} window for ${providerId} is already open`);
    }

    const partition = providerPartition(providerId);
    this.harden(electronSession.fromPartition(partition));
    const baseTitle = `${request.providerName} — ${kind === 'sign-in' ? 'Sign in' : 'Payment'}`;
    const parent = this.parent && !this.parent.isDestroyed() ? this.parent : undefined;
    const window = new BrowserWindow({
      ...(parent ? { parent } : {}),
      width: WIDTH,
      height: HEIGHT,
      title: baseTitle,
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
        devTools: this.options.devTools,
      },
    });
    window.setMenu(null);
    const contents = window.webContents;
    providerContents.add(contents);

    const what = `${providerId} ${kind} window`;
    const { providerName } = request;
    const allowed = (url: string): boolean => matchesOrigin(url, request.allowedOrigins);
    const waitingRoom = (url: string): boolean =>
      (request.waitingRoomOrigins?.length ?? 0) > 0 &&
      matchesOrigin(url, request.waitingRoomOrigins ?? []);
    const openOutside = (url: string): void => {
      shell
        .openExternal(url)
        .catch((error: unknown) =>
          log.warn(`Could not open ${describeUrl(url)} externally: ${String(error)}`)
        );
    };
    const load = (url: string): void => {
      window
        .loadURL(url)
        .catch((error: unknown) =>
          log.debug(`The ${what} did not finish loading ${describeUrl(url)}: ${String(error)}`)
        );
    };

    let closed = false;
    let shown = false;
    /** The first page committed: later failures are the page's own business. */
    let committed = false;
    let failure: ProviderError | undefined;
    let lastStatus = 0;
    /** The page the window was opened for (or last loaded), and whether it came back to it. */
    let target = request.url;
    let returnedToTarget = false;
    let fromWaitingRoom = false;
    const navigationListeners = new Set<(navigation: ProviderWindowNavigation) => void>();
    const loadedListeners = new Set<(page: ProviderWindowNavigation) => void>();
    const closedListeners: Array<(failure?: ProviderError) => void> = [];
    let resolveLoaded!: () => void;
    let rejectLoaded!: (error: ProviderError) => void;
    const loaded = new Promise<void>((resolve, reject) => {
      resolveLoaded = resolve;
      rejectLoaded = reject;
    });
    // A caller that does not wait for the first page must not see an unhandled rejection
    loaded.catch(() => undefined);

    const show = (): void => {
      if (shown || closed || window.isDestroyed()) return;
      shown = true;
      window.show();
      window.focus();
    };
    const showTimer = setTimeout(show, this.options.showAfterMs ?? SHOW_AFTER_MS);
    /** The first page was blocked or failed: say why (origin only), and close. */
    const fail = (message: string): void => {
      if (committed || failure || closed) return;
      failure = new ProviderError({ providerId, message });
      log.warn(`The ${what} closed itself: ${message}`);
      rejectLoaded(failure);
      if (!window.isDestroyed()) window.destroy();
    };
    const blocked = (url: string, action: 'a navigation' | 'a redirect'): void => {
      log.warn(`The ${what} blocked ${action} to ${describeUrl(url)}`);
      // The first page redirected off the allow-list: the window has nothing to show
      if (action === 'a redirect' && !committed) {
        fail(
          `${providerName}'s page sent the window to ${describeUrl(url)}, which it does not allow`
        );
      } else if (request.openBlockedExternally && isWebUrl(url)) {
        openOutside(url);
      }
    };

    this.guard(contents, { allowed, blocked, load, openOutside, what });
    window.on('page-title-updated', (event) => event.preventDefault());
    window.once('ready-to-show', show);
    contents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return;
      fail(`${providerName}'s page could not be loaded (${errorDescription || errorCode})`);
    });
    contents.on('did-navigate', (_event, url, httpResponseCode) => {
      committed = true;
      resolveLoaded();
      lastStatus = typeof httpResponseCode === 'number' ? httpResponseCode : 0;
      const host = hostOf(url);
      if (!window.isDestroyed()) window.setTitle(host ? `${baseTitle} · ${host}` : baseTitle);
      if (waitingRoom(url)) {
        fromWaitingRoom = true;
      } else if (fromWaitingRoom) {
        fromWaitingRoom = false;
        const here = placeOf(url);
        const there = placeOf(target);
        if (
          !returnedToTarget &&
          here &&
          there &&
          here.origin === there.origin &&
          here.path !== there.path
        ) {
          returnedToTarget = true;
          log.info(
            `The ${what} came back from the waiting room on another page; reloading its page`
          );
          load(target);
        }
      }
      for (const listener of [...navigationListeners]) listener({ url, httpStatus: lastStatus });
    });
    contents.on('did-finish-load', () => {
      const page = { url: contents.getURL(), httpStatus: lastStatus };
      for (const listener of [...loadedListeners]) listener(page);
    });
    window.once('closed', () => {
      closed = true;
      clearTimeout(showTimer);
      if (this.windows.get(key)?.handle === handle) this.windows.delete(key);
      for (const listener of closedListeners.splice(0)) listener(failure);
    });

    const handle: ProviderWindowHandle = {
      providerId,
      kind,
      loaded,
      focus: () => {
        if (closed) return;
        if (window.isMinimized()) window.restore();
        shown = true;
        window.show();
        window.focus();
      },
      close: () => {
        if (!closed) window.close();
      },
      load: (url) => {
        if (!allowed(url)) {
          throw new Error(
            `The ${what} cannot load ${describeUrl(url)}: it is not an allowed origin`
          );
        }
        if (closed) return;
        target = url;
        returnedToTarget = false;
        load(url);
      },
      currentUrl: () => (closed ? '' : contents.getURL()),
      onNavigate: (listener) => {
        navigationListeners.add(listener);
        return () => navigationListeners.delete(listener);
      },
      onLoaded: (listener) => {
        loadedListeners.add(listener);
        return () => loadedListeners.delete(listener);
      },
      onClosed: (listener) => {
        if (closed) listener(failure);
        else closedListeners.push(listener);
      },
      hasText: (text) => (closed ? Promise.resolve(false) : findText(contents, text)),
      isClosed: () => closed,
    };
    this.windows.set(key, { handle, window });

    log.info(`Opened the ${what} on ${describeUrl(request.url)}`);
    load(request.url);
    return handle;
  }

  find(providerId: ProviderId, kind: ProviderWindowKind): ProviderWindowHandle | undefined {
    return this.windows.get(`${providerId}:${kind}`)?.handle;
  }

  /** Closes every provider window at once (`destroy`: no page can hold it open). */
  closeAll(): void {
    for (const { window } of [...this.windows.values()]) {
      if (!window.isDestroyed()) window.destroy();
    }
  }

  async clear(providerId: ProviderId): Promise<void> {
    const ses = electronSession.fromPartition(providerPartition(providerId));
    await ses.clearStorageData();
    await ses.clearAuthCache();
  }

  async flush(providerId: ProviderId): Promise<void> {
    await electronSession.fromPartition(providerPartition(providerId)).cookies.flushStore();
  }

  /** Permission, device and identity settings for a provider partition, once per session. */
  private harden(ses: Session): void {
    if (this.hardened.has(ses)) return;
    this.hardened.add(ses);
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.setUserAgent(this.userAgent);
  }

  private guard(
    contents: WebContents,
    handlers: {
      allowed(url: string): boolean;
      blocked(url: string, action: 'a navigation' | 'a redirect'): void;
      load(url: string): void;
      openOutside(url: string): void;
      what: string;
    }
  ): void {
    const { allowed, blocked, load, openOutside, what } = handlers;

    contents.on('will-navigate', (event, legacyUrl) => {
      const url = (event as { url?: string }).url ?? legacyUrl;
      if (allowed(url)) return;
      event.preventDefault();
      blocked(url, 'a navigation');
    });
    contents.on('will-redirect', (event, legacyUrl, _isInPlace, legacyIsMainFrame) => {
      const details = event as { url?: string; isMainFrame?: boolean };
      if (!(details.isMainFrame ?? legacyIsMainFrame)) return;
      const url = details.url ?? legacyUrl;
      if (allowed(url)) return;
      event.preventDefault();
      blocked(url, 'a redirect');
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (allowed(url)) load(url);
      else if (isWebUrl(url)) openOutside(url);
      else log.warn(`The ${what} blocked a new window for ${describeUrl(url)}`);
      return { action: 'deny' };
    });
    contents.on('certificate-error', (event, url, error, _certificate, callback) => {
      event.preventDefault();
      callback(false);
      log.warn(`The ${what} rejected a certificate for ${describeUrl(url)} (${error})`);
    });
    contents.on('select-client-certificate', (event, _url, _list, callback) => {
      // As for `app`'s event: no certificate is offered (the default would send the first).
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
  }
}

/**
 * Whether the page shows `text`, by Chromium's find-in-page (case-sensitive, read-only; the
 * selection is cleared again). A match answers at once; "no match" stands once no other
 * answer came for `FIND_SETTLE_MS`. False when nothing answers within `FIND_TIMEOUT_MS`.
 */
function findText(contents: WebContents, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    let requestId = -1;
    let settled = false;
    let noMatch: ReturnType<typeof setTimeout> | undefined;
    const finish = (found: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (noMatch) clearTimeout(noMatch);
      contents.removeListener('found-in-page', onFound);
      if (!contents.isDestroyed()) contents.stopFindInPage('clearSelection');
      resolve(found);
    };
    const onFound = (_event: unknown, result: Electron.Result): void => {
      if (result.requestId !== requestId) return;
      if (result.matches > 0) return finish(true);
      if (result.finalUpdate && !noMatch) noMatch = setTimeout(() => finish(false), FIND_SETTLE_MS);
    };
    const timer = setTimeout(() => finish(false), FIND_TIMEOUT_MS);
    contents.on('found-in-page', onFound);
    try {
      requestId = contents.findInPage(text, { matchCase: true });
    } catch {
      finish(false);
    }
  });
}
