/**
 * The main window and the guards around it (architecture-notes §1, §7; ui-review item 10).
 *
 * - `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webviewTag: false`.
 *   The preload is one bundled file (`scripts/build-preload.js`) that loads only `electron`.
 *   If it is missing (say `npm start` ran before the first preload build), the window shows
 *   an error page that says so instead of a blank app.
 * - The window's webContents is the trusted IPC sender and event target.
 * - New windows are always denied: http(s) and mailto links go to the system browser or mail
 *   app through `shell.openExternal`; anything else (`javascript:`, `file:`, …) is logged.
 * - Navigations and redirects off the app origin are cancelled. Hash-route changes are
 *   in-page navigations and never reach these guards.
 * - Its session (the default session) refuses every permission request and check, except
 *   `clipboard-sanitized-write` for the app's own page (`guardPermissions`).
 * - No request the app makes offers a client certificate (`refuseClientCertificates`).
 * - In development the CSP is sent as a response header from the Vite dev server. The
 *   production build carries it as a `<meta>` tag (`csp.ts`, `vite.config.ts`).
 * - A crashed renderer is reloaded once (`crash-policy.ts`).
 *
 * Provider sign-in and payment windows have their own policy (`provider-windows.ts`).
 */

import { App, BrowserWindow, Session, shell, WebContents } from 'electron';
import fs from 'fs';
import { APP_NAME } from '@shared/constants';
import type { TrustedWebContents } from '../ipc/trusted-web-contents';
import { describeUrl } from '../providers/sdk/url-patterns';
import { logger } from '../utils/logger';
import { reloadOnceOnRenderCrash } from './crash-policy';
import { buildCsp } from './csp';
import { createAppUrlMatcher, RendererEntry } from './renderer-entry';

const log = logger.child({ module: 'main-window' });

/** Protocols a link may hand to the operating system. */
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * The only permission the app's page may use: `navigator.clipboard.writeText` ("Copy
 * reference", "Copy error details") asks for it, and fails when it is refused. Desktop
 * notifications come from the main process (Electron's `Notification`) and need none.
 */
export const APP_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write']);

export interface MainWindowOptions {
  entry: RendererEntry;
  preloadPath: string;
  trustedWebContents: TrustedWebContents;
  /**
   * Launched at login with `--hidden` ("Start minimised"): the window opens minimised to the
   * taskbar instead of on screen (master plan OQ8). There is no tray, so a window that was
   * never shown could not be reached except by launching the app again.
   */
  startMinimised: boolean;
  /** The window icon (`getBrandIconPath`). Omitted, the window uses the executable's icon. */
  icon?: string;
}

export function createMainWindow({
  entry,
  preloadPath,
  trustedWebContents,
  startMinimised,
  icon,
}: MainWindowOptions): BrowserWindow {
  const hasPreload = fs.existsSync(preloadPath);
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      ...(hasPreload ? { preload: preloadPath } : {}),
    },
    title: APP_NAME,
    ...(icon ? { icon } : {}),
    show: false, // Don't show until ready
  });
  const contents = window.webContents;

  // Only this window's webContents may call IPC and receive events
  trustedWebContents.register(contents);
  const isAppUrl = createAppUrlMatcher(entry);
  guardNavigation(contents, {
    isAppUrl,
    openExternal: (url) => shell.openExternal(url),
  });
  guardPermissions(contents.session, { isAppUrl });
  reloadOnceOnRenderCrash(contents, log);

  if (!hasPreload) {
    log.error(`The preload script is missing: ${preloadPath}`);
    logLoadFailure(window.loadURL(preloadMissingPage(preloadPath)));
  } else if (entry.kind === 'dev-server') {
    installDevCsp(contents.session, entry.url);
    logLoadFailure(window.loadURL(entry.url));
    contents.openDevTools();
    log.info(`Loading from dev server: ${entry.url}`);
  } else {
    logLoadFailure(window.loadFile(entry.path));
    log.info(`Loading from file: ${entry.path}`);
  }

  window.once('ready-to-show', () => {
    if (startMinimised) {
      // Electron shows a window that was never shown as minimised, without bringing it forward
      log.info('Launched minimised at login');
      window.minimize();
      return;
    }
    window.show();
  });

  return window;
}

/**
 * A self-contained error page (no scripts, nothing fetched) for a window whose preload
 * script is missing, as a `data:` URL.
 */
export function preloadMissingPage(preloadPath: string): string {
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<title>The app could not start</title>',
    '<style>body{font:15px/1.5 system-ui,sans-serif;margin:48px;max-width:640px}',
    'code{font-family:ui-monospace,monospace;word-break:break-all}</style></head><body>',
    '<h1>The app could not start</h1>',
    `<p>Its preload script is missing:</p><p><code>${escapeHtml(preloadPath)}</code></p>`,
    '<p>Running from source? Run <code>npm run build:preload</code> (or wait for',
    ' <code>npm run dev</code> to finish its first build), then restart the app.',
    ' Otherwise, reinstall the app.</p>',
    '</body></html>',
  ].join('');
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char
  );
}

export interface NavigationGuardOptions {
  /** True for pages of the app itself (`createAppUrlMatcher`). */
  isAppUrl(url: string): boolean;
  openExternal(url: string): Promise<void>;
}

/** Denies every new window (sending http, https and mailto links out) and off-origin navigation. */
export function guardNavigation(
  contents: Pick<WebContents, 'setWindowOpenHandler' | 'on'>,
  { isAppUrl, openExternal }: NavigationGuardOptions
): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      openExternal(url).catch((error: unknown) =>
        log.warn(`Could not open ${describeUrl(url)} externally: ${String(error)}`)
      );
    } else {
      log.warn(`Blocked a new window for ${describeUrl(url)}`);
    }
    return { action: 'deny' };
  });

  const blockForeign =
    (what: string) =>
    (event: { preventDefault(): void; url?: string }, legacyUrl?: string): void => {
      const url = event.url ?? legacyUrl ?? '';
      if (isAppUrl(url)) return;
      event.preventDefault();
      log.warn(`Blocked ${what} to ${describeUrl(url)}`);
    };
  contents.on('will-navigate', blockForeign('a navigation'));
  contents.on('will-redirect', blockForeign('a redirect'));
}

/**
 * The permission policy of the main window's session, the default session. Electron grants
 * whatever a page asks for until a session has handlers; this one refuses every request and
 * check except `APP_PERMISSIONS`, and those only for the app's own page in the top frame.
 * Refused requests are logged by permission and origin. Provider partitions refuse everything
 * (`provider-windows.ts`).
 */
export function guardPermissions(
  session: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>,
  { isAppUrl }: Pick<NavigationGuardOptions, 'isAppUrl'>
): void {
  const allowed = (permission: string, url: string | undefined, isMainFrame: boolean): boolean =>
    APP_PERMISSIONS.has(permission) && isMainFrame && url !== undefined && isAppUrl(url);

  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const granted = allowed(permission, details.requestingUrl, details.isMainFrame);
    if (!granted) {
      log.warn(`Refused the ${permission} permission for ${describeUrl(details.requestingUrl)}`);
    }
    callback(granted);
  });
  session.setPermissionCheckHandler((_contents, permission, _origin, details) =>
    allowed(permission, details.requestingUrl, details.isMainFrame)
  );
}

/**
 * No request the app makes offers a client certificate. Since Electron 44, `app` emits
 * `select-client-certificate` for `net` requests too (every provider's HttpClient and the
 * updater, with `webContents` null), and when nothing handles it Electron sends the first
 * matching certificate from the system store; before 44 those requests failed instead. Provider
 * windows refuse their own requests as well (`provider-windows.ts`). Logged by origin only.
 */
export function refuseClientCertificates(app: Pick<App, 'on'>): void {
  app.on('select-client-certificate', (event, _contents, url, _certificates, callback) => {
    event.preventDefault();
    callback();
    log.warn(`Refused a client certificate request from ${describeUrl(url)}`);
  });
}

/** Every webContents the app creates refuses to attach a `<webview>`. */
export function denyWebviews(app: Pick<App, 'on'>): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
      log.warn('Blocked a <webview> attach');
    });
  });
}

/** Development only: sends the dev CSP as a header on every response from the dev server. */
export function installDevCsp(session: Pick<Session, 'webRequest'>, devServerUrl: string): void {
  const origin = new URL(devServerUrl).origin;
  const policy = buildCsp({ dev: true, devOrigin: origin });

  session.webRequest.onHeadersReceived((details, callback) => {
    if (originOf(details.url) !== origin) {
      callback({});
      return;
    }
    const responseHeaders: Record<string, string[] | string> = {};
    for (const [name, value] of Object.entries(details.responseHeaders ?? {})) {
      if (name.toLowerCase() !== 'content-security-policy') responseHeaders[name] = value;
    }
    responseHeaders['Content-Security-Policy'] = [policy];
    callback({ responseHeaders });
  });
}

function isExternalUrl(url: string): boolean {
  const protocol = protocolOf(url);
  return protocol !== null && EXTERNAL_PROTOCOLS.has(protocol);
}

function protocolOf(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function logLoadFailure(load: Promise<void>): void {
  load.catch((error: unknown) => log.error(`The main window failed to load: ${String(error)}`));
}
