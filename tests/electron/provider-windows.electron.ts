/**
 * Live Electron test of the provider sign-in and payment windows (`app/provider-windows.ts`,
 * architecture-notes §7, §12.32). This file is Electron's main script: `tests/electron/run.js`
 * bundles it and launches Electron with it. Real BrowserWindows against loopback servers
 * check what mocks cannot:
 * - the page runs sandboxed with no Node, on the provider partition, as desktop Chrome at the
 *   Chromium version Electron runs;
 * - a scripted navigation off the allow-list is cancelled; window.open stays in place for an
 *   allowed origin; a permission request is denied; a self-signed https page never loads;
 * - the window and `ElectronSessionHttpClient` share one cookie jar, and clearing the
 *   partition empties it;
 * - navigations reach the handle with their HTTP status, and the title shows the host;
 * - a first page redirected off the allow-list closes the window (never shown) and rejects
 *   `loaded`, naming the origin only; a hanging first response still shows the window;
 * - after a waiting room (a 200 page that sends the person to the site's home page), the
 *   window loads its page again, once;
 * - `hasText` reads the page with find-in-page.
 * Output is TAP; the exit code is the number of failures (capped at 1).
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, session, shell } from 'electron';
import { ProviderWindows } from '../../src/main/app/provider-windows';
import type { ProviderWindowRequest } from '../../src/main/core/accounts/ports';
import { ElectronSessionHttpClient } from '../../src/main/providers/sdk/http-electron';
import { chromeUserAgent, runtimeChromeMajor } from '../../src/main/providers/sdk/user-agent';

const PROVIDER_ID = 'etest';
const WATCHDOG_MS = 120_000;

const userData = mkdtempSync(join(tmpdir(), 'wa-stay-electron-windows-'));
app.setPath('userData', userData);
app.disableHardwareAcceleration();

interface Servers {
  /** The provider's own site: http://127.0.0.1:<port> */
  site: string;
  /** Another origin, not on the allow-list. */
  other: string;
  /** The provider's waiting room: a page that sends the person on to the site's home page. */
  queue: string;
  /** A self-signed https origin (when openssl is available). */
  selfSigned?: string;
  /** Cookies each request to `site` carried. */
  cookies: string[];
  close(): Promise<void>;
}

const PAGE = (title: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`;

function listen(server: http.Server | https.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  );
}

/** A self-signed certificate for 127.0.0.1, made with openssl in a temp folder. */
function selfSignedCertificate(): { key: Buffer; cert: Buffer } | undefined {
  const dir = mkdtempSync(join(tmpdir(), 'wa-stay-cert-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem'),
      ],
      { stdio: 'ignore' }
    );
    return { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
  } catch {
    return undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function startServers(): Promise<Servers> {
  const cookies: string[] = [];
  const hanging: http.ServerResponse[] = [];
  let otherOrigin = '';
  let queueOrigin = '';
  let siteOrigin = '';
  const site = http.createServer((req, res) => {
    cookies.push(String(req.headers.cookie ?? ''));
    if (req.url?.startsWith('/redirect-off')) {
      res.writeHead(302, { location: `${otherOrigin}/landing?token=SECRET` });
      return res.end();
    }
    if (req.url?.startsWith('/hang')) {
      hanging.push(res); // never answered
      return;
    }
    if (req.url?.startsWith('/target') && !/queue_passed=1/.test(String(req.headers.cookie))) {
      // Not through the queue yet: off to the waiting room
      res.writeHead(302, { location: `${queueOrigin}/waiting-room` });
      return res.end();
    }
    if (req.url?.startsWith('/receipt')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end(PAGE('Receipt') + '<p>Your booking PB2072968 is completed</p>');
    }
    if (req.url?.startsWith('/set-cookie')) {
      res.writeHead(200, { 'set-cookie': 'from_server=s1; Path=/', 'content-type': 'text/plain' });
      return res.end('ok');
    }
    if (req.url?.startsWith('/missing')) {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end(PAGE('Missing'));
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE(`Site ${req.url}`));
  });
  const other = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE('Other'));
  });
  // The waiting room lets the person through (a cookie for 127.0.0.1, any port) and, as the
  // DBCA queue does, sends them to the site's home page, not back where they were going
  const queue = http.createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/html',
      'set-cookie': 'queue_passed=1; Path=/',
    });
    res.end(
      PAGE('Waiting room') +
        `<script>setTimeout(() => { location.href = ${JSON.stringify(`${siteOrigin}/home`)}; }, 200)</script>`
    );
  });
  const servers: Array<http.Server | https.Server> = [site, other, queue];
  const [sitePort, otherPort, queuePort] = [
    await listen(site),
    await listen(other),
    await listen(queue),
  ];
  siteOrigin = `http://127.0.0.1:${sitePort}`;
  otherOrigin = `http://127.0.0.1:${otherPort}`;
  queueOrigin = `http://127.0.0.1:${queuePort}`;

  let selfSigned: string | undefined;
  const certificate = selfSignedCertificate();
  if (certificate) {
    const secure = https.createServer(certificate, (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE('Self-signed'));
    });
    servers.push(secure);
    selfSigned = `https://127.0.0.1:${await listen(secure)}`;
  }

  return {
    site: siteOrigin,
    other: otherOrigin,
    queue: queueOrigin,
    selfSigned,
    cookies,
    close: () => {
      for (const res of hanging.splice(0)) res.destroy();
      return Promise.all(
        servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve())))
      ).then(() => undefined);
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `check` passes, or fails with its last error after `ms`. */
async function eventually(check: () => void | Promise<void>, ms = 5_000): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > until) throw error;
      await sleep(50);
    }
  }
}

interface Case {
  name: string;
  run(ctx: {
    servers: Servers;
    windows: ProviderWindows;
    request: ProviderWindowRequest;
  }): Promise<void>;
}

/** The newest BrowserWindow: the provider window the case opened. */
const newest = (): BrowserWindow => {
  const all = BrowserWindow.getAllWindows();
  return all.reduce((a, b) => (a.id > b.id ? a : b));
};

const CASES: Case[] = [
  {
    name: 'runs the page sandboxed with no Node, on the provider partition, as desktop Chrome',
    async run({ windows, request }) {
      windows.open(request);
      const window = newest();
      await eventually(() => assert.match(window.webContents.getURL(), /\/start$/));
      const prefs = window.webContents.getLastWebPreferences();
      assert.equal(prefs?.sandbox, true);
      assert.equal(prefs?.contextIsolation, true);
      assert.equal(prefs?.nodeIntegration, false);
      assert.equal(prefs?.preload ?? undefined, undefined);
      assert.equal(
        window.webContents.session,
        session.fromPartition(`persist:provider-${PROVIDER_ID}`)
      );
      const seen = await window.webContents.executeJavaScript(
        '[typeof require, typeof process, typeof module, navigator.userAgent].join("|")'
      );
      assert.equal(seen, `undefined|undefined|undefined|${chromeUserAgent(runtimeChromeMajor())}`);
      assert.match(window.getTitle(), /^Test Provider — Payment · 127\.0\.0\.1:\d+$/);
    },
  },
  {
    name: 'cancels a scripted navigation off the allow-list, and allows one on it',
    async run({ servers, windows, request }) {
      const handle = windows.open(request);
      const window = newest();
      await eventually(() => assert.match(window.webContents.getURL(), /\/start$/));

      await window.webContents.executeJavaScript(
        `location.href = ${JSON.stringify(`${servers.other}/x`)}`
      );
      await sleep(700);
      assert.match(handle.currentUrl(), /\/start$/);

      const navigations: Array<{ url: string; httpStatus: number }> = [];
      handle.onNavigate((n) => navigations.push(n));
      await window.webContents.executeJavaScript(
        `location.href = ${JSON.stringify(`${servers.site}/missing`)}`
      );
      await eventually(() =>
        assert.deepEqual(navigations, [{ url: `${servers.site}/missing`, httpStatus: 404 }])
      );
    },
  },
  {
    name: 'window.open: an allowed URL loads in the same window, another is not opened as a window',
    async run({ servers, windows, request }) {
      windows.open(request);
      const window = newest();
      await eventually(() => assert.match(window.webContents.getURL(), /\/start$/));
      const before = BrowserWindow.getAllWindows().length;

      await window.webContents.executeJavaScript(
        `window.open(${JSON.stringify(`${servers.site}/popup`)})`
      );
      await eventually(() => assert.equal(window.webContents.getURL(), `${servers.site}/popup`));
      await window.webContents.executeJavaScript(
        `window.open(${JSON.stringify(`${servers.other}/popup`)})`
      );
      await sleep(300);
      assert.equal(BrowserWindow.getAllWindows().length, before);
      assert.deepEqual(openedExternally.slice(-1), [`${servers.other}/popup`]);
    },
  },
  {
    name: 'denies permission requests (notifications, geolocation)',
    async run({ windows, request }) {
      windows.open(request);
      const window = newest();
      await eventually(() => assert.match(window.webContents.getURL(), /\/start$/));
      const answers = await window.webContents.executeJavaScript(`
        Promise.all([
          Notification.requestPermission(),
          new Promise((resolve) => navigator.geolocation.getCurrentPosition(
            () => resolve('granted'), (error) => resolve('error ' + error.code))),
        ]).then((all) => all.join('|'))
      `);
      assert.equal(answers, 'denied|error 1');
    },
  },
  {
    name: 'a self-signed https page never loads: the window closes itself (certificate errors are rejected)',
    async run({ servers, windows, request }) {
      if (!servers.selfSigned) {
        console.log('  # skipped: openssl is not available');
        return;
      }
      const handle = windows.open({
        ...request,
        allowedOrigins: [...request.allowedOrigins, servers.selfSigned],
        url: `${servers.selfSigned}/`,
      });
      const committed: number[] = [];
      handle.onNavigate((n) => committed.push(n.httpStatus));
      // The first page failed: the window has nothing to show and says why
      const error = await handle.loaded.then(
        () => assert.fail('the self-signed page should not load'),
        (e: unknown) => e as Error
      );
      assert.equal(
        error.message,
        "Test Provider's page could not be loaded (ERR_CERT_AUTHORITY_INVALID)"
      );
      assert.equal(handle.isClosed(), true);
      assert.deepEqual(committed, []);
    },
  },
  {
    name: 'shares one cookie jar with ElectronSessionHttpClient; clearing the partition empties it',
    async run({ servers, windows, request }) {
      const client = new ElectronSessionHttpClient({ providerId: PROVIDER_ID });
      windows.open(request);
      const window = newest();
      await eventually(() => assert.match(window.webContents.getURL(), /\/start$/));

      // Set by the page, sent by the client
      await window.webContents.executeJavaScript('document.cookie = "from_page=p1; path=/"');
      servers.cookies.length = 0;
      await client.request('GET', `${servers.site}/echo`);
      assert.match(servers.cookies[0], /from_page=p1/);

      // Set by a response to the client, seen by the page
      await client.request('GET', `${servers.site}/set-cookie`);
      assert.match(
        String(await window.webContents.executeJavaScript('document.cookie')),
        /from_server=s1/
      );

      await windows.clear(PROVIDER_ID);
      await windows.flush(PROVIDER_ID);
      servers.cookies.length = 0;
      await client.request('GET', `${servers.site}/echo`);
      assert.equal(servers.cookies[0], '');
    },
  },
];

CASES.push(
  {
    name: 'a first page redirected off the allow-list closes the window, never shown; loaded rejects naming the origin only',
    async run({ servers, windows, request }) {
      const handle = windows.open({ ...request, url: `${servers.site}/redirect-off` });
      const window = newest();
      let shown = false;
      window.on('show', () => (shown = true));
      const closedWith = new Promise<unknown>((resolve) => handle.onClosed(resolve));

      const error = await handle.loaded.then(
        () => assert.fail('the first page should not load'),
        (e: unknown) => e as Error
      );
      assert.equal(
        error.message,
        `Test Provider's page sent the window to ${servers.other}, which it does not allow`
      );
      assert.doesNotMatch(error.message, /SECRET|landing/);
      assert.equal(await closedWith, error);
      assert.equal(window.isDestroyed(), true);
      assert.equal(shown, false);
      assert.deepEqual(
        openedExternally.filter((url) => url.includes('landing')),
        []
      );
    },
  },
  {
    name: 'a hanging first response still shows the window (at 1.5 s at the latest)',
    async run({ servers, windows, request }) {
      const handle = windows.open({ ...request, url: `${servers.site}/hang` });
      const window = newest();
      assert.equal(window.isVisible(), false);
      let settled = false;
      handle.loaded.then(
        () => (settled = true),
        () => (settled = true)
      );
      await eventually(() => assert.equal(window.isVisible(), true), 3_000);
      assert.equal(settled, false);
      assert.equal(handle.isClosed(), false);
    },
  },
  {
    name: "after the waiting room sends it to the site's home page, the window loads its page again, once",
    async run({ servers, windows, request }) {
      await session.fromPartition(`persist:provider-${PROVIDER_ID}`).clearStorageData();
      const handle = windows.open({
        ...request,
        url: `${servers.site}/target`,
        allowedOrigins: [servers.site, servers.queue],
        waitingRoomOrigins: [servers.queue],
      });
      const pages: string[] = [];
      handle.onNavigate((n) => pages.push(n.url));

      await eventually(() => assert.equal(handle.currentUrl(), `${servers.site}/target`), 8_000);
      assert.deepEqual(pages, [
        `${servers.queue}/waiting-room`,
        `${servers.site}/home`,
        `${servers.site}/target`,
      ]);
      const text = await newest().webContents.executeJavaScript('document.body.innerText');
      assert.match(String(text), /Site \/target/);
    },
  },
  {
    name: 'hasText reads the page with find-in-page (case-sensitive), and the page stays unchanged',
    async run({ servers, windows, request }) {
      const handle = windows.open({ ...request, url: `${servers.site}/receipt` });
      await handle.loaded;
      await new Promise<void>((resolve) => {
        const stop = handle.onLoaded(() => {
          stop();
          resolve();
        });
        // Already loaded? Then the next tick decides
        setTimeout(resolve, 1_000);
      });
      assert.equal(await handle.hasText('PB2072968'), true);
      assert.equal(await handle.hasText('pb2072968'), false);
      assert.equal(await handle.hasText('PB2070000'), false);
      assert.equal(handle.currentUrl(), `${servers.site}/receipt`);
    },
  }
);

const openedExternally: string[] = [];

async function main(): Promise<number> {
  // Nothing may really open in a browser during the test
  Object.defineProperty(shell, 'openExternal', {
    configurable: true,
    writable: true,
    value: async (url: string) => {
      openedExternally.push(url);
    },
  });

  const servers = await startServers();
  const windows = new ProviderWindows({ devTools: false });
  const request: ProviderWindowRequest = {
    providerId: PROVIDER_ID,
    providerName: 'Test Provider',
    kind: 'payment',
    url: `${servers.site}/start`,
    // Loopback http is allowed only when listed exactly (live tests only)
    allowedOrigins: [servers.site],
    openBlockedExternally: false,
  };

  let failures = 0;
  console.log('TAP version 13');
  console.log(`1..${CASES.length}`);
  for (const [index, testCase] of CASES.entries()) {
    const started = Date.now();
    try {
      await testCase.run({ servers, windows, request });
      console.log(`ok ${index + 1} - ${testCase.name} # ${Date.now() - started} ms`);
    } catch (error) {
      failures++;
      console.log(`not ok ${index + 1} - ${testCase.name}`);
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
      for (const line of detail.split('\n')) console.log(`  # ${line}`);
    } finally {
      windows.closeAll();
      await sleep(100);
    }
  }

  await servers.close();
  console.log(`# electron ${process.versions.electron}, chrome ${process.versions.chrome}`);
  console.log(`# ${CASES.length - failures} passed, ${failures} failed`);
  return failures;
}

const watchdog = setTimeout(() => {
  console.log('Bail out! the provider window tests did not finish in time');
  app.exit(1);
}, WATCHDOG_MS);

// The windows are closed between cases; the test decides when the app quits
app.on('window-all-closed', () => undefined);

app
  .whenReady()
  .then(main)
  .catch((error: unknown) => {
    console.log(`Bail out! ${error instanceof Error ? error.stack : String(error)}`);
    return 1;
  })
  .then((failures) => {
    clearTimeout(watchdog);
    try {
      rmSync(userData, { recursive: true, force: true });
    } catch {
      // A leftover temp folder is harmless.
    }
    app.exit(failures ? 1 : 0);
  });
