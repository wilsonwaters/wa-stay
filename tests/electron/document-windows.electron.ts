/**
 * Live Electron test of the document windows (`app/document-windows.ts`): a location's
 * document (ParkStay's campground map) in Electron's built-in PDF viewer. This file is
 * Electron's main script: `tests/electron/run.js` bundles it and launches Electron with it.
 * Real BrowserWindows against a loopback server check what mocks cannot:
 * - the PDF opens in the viewer, sandboxed with no Node, on the document partition (in memory,
 *   not the provider's: its cookies are never sent), under the app's title;
 * - a scripted navigation off the document's URL is cancelled, and `window.open` gets nothing;
 * - an answer that is not a PDF (a 200 `text/plain` "ERROR opening file"), an HTTP error, or a
 *   redirect elsewhere closes the window, never shown, and rejects with a `ProviderError`;
 * - a second open focuses the same window.
 * Output is TAP; the exit code is the number of failures (capped at 1).
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import {
  documentPartition,
  DocumentWindows,
  type DocumentWindowRequest,
} from '../../src/main/app/document-windows';
import { ProviderError } from '../../src/main/providers/sdk/errors';

const PROVIDER_ID = 'etest';
const WATCHDOG_MS = 120_000;

const userData = mkdtempSync(join(tmpdir(), 'wa-stay-electron-documents-'));
app.setPath('userData', userData);
app.disableHardwareAcceleration();

/** A one-page PDF with a line of text. */
function onePagePdf(): Buffer {
  const content = 'BT /F1 24 Tf 72 720 Td (Campground map) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

interface Server {
  origin: string;
  /** Another origin, never the document's. */
  other: string;
  /** Cookies each request for the map carried. */
  cookies: string[];
  /** Paths requested on `other`. */
  otherPaths: string[];
  close(): Promise<void>;
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  );
}

async function startServer(): Promise<Server> {
  const pdf = onePagePdf();
  const cookies: string[] = [];
  const otherPaths: string[] = [];
  let otherOrigin = '';
  const site = http.createServer((req, res) => {
    const path = req.url ?? '/';
    if (path.startsWith('/map.pdf')) {
      cookies.push(String(req.headers.cookie ?? ''));
      res.writeHead(200, { 'content-type': 'application/pdf', 'x-frame-options': 'DENY' });
      return res.end(pdf);
    }
    if (path.startsWith('/missing.pdf')) {
      // What ParkStay's media server may answer for a missing file
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ERROR opening file');
    }
    if (path.startsWith('/gone.pdf')) {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('<!doctype html><title>Not found</title>');
    }
    if (path.startsWith('/moved.pdf')) {
      res.writeHead(302, { location: `${otherOrigin}/landing?token=SECRET` });
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  const other = http.createServer((req, res) => {
    otherPaths.push(req.url ?? '/');
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Elsewhere</title><p>Elsewhere</p>');
  });
  const [sitePort, otherPort] = await Promise.all([listen(site), listen(other)]);
  otherOrigin = `http://127.0.0.1:${otherPort}`;
  return {
    origin: `http://127.0.0.1:${sitePort}`,
    other: otherOrigin,
    cookies,
    otherPaths,
    close: async () => {
      site.closeAllConnections();
      other.closeAllConnections();
      await Promise.all([
        new Promise((resolve) => site.close(resolve)),
        new Promise((resolve) => other.close(resolve)),
      ]);
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

/** The document window with this title, if open. */
const windowTitled = (title: string): BrowserWindow | undefined =>
  BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getTitle() === title);

interface Case {
  name: string;
  run(ctx: {
    server: Server;
    windows: DocumentWindows;
    request: DocumentWindowRequest;
  }): Promise<void>;
}

const CASES: Case[] = [
  {
    name: 'opens the PDF in the viewer, sandboxed with no Node, on its own partition, untitled by the page',
    async run({ server, windows, request }) {
      // A cookie on the provider's partition must never reach the document
      await session
        .fromPartition(`persist:provider-${PROVIDER_ID}`)
        .cookies.set({ url: server.origin, name: 'provider_session', value: 'SECRET' });

      await windows.open(request);
      const window = windowTitled(request.title);
      assert.ok(window, 'the document window is open under its title');
      assert.equal(window.webContents.getURL(), request.url);
      const prefs = window.webContents.getLastWebPreferences();
      assert.equal(prefs?.sandbox, true);
      assert.equal(prefs?.contextIsolation, true);
      assert.equal(prefs?.nodeIntegration, false);
      assert.equal(prefs?.preload ?? undefined, undefined);
      assert.equal(
        window.webContents.session,
        session.fromPartition(documentPartition(PROVIDER_ID))
      );
      assert.equal(window.webContents.session.isPersistent(), false);
      assert.deepEqual(server.cookies, ['']);
      // The viewer (plugins on) is the PDF extension's frame inside the page
      await eventually(() =>
        assert.ok(
          window.webContents.mainFrame.framesInSubtree.some((f) =>
            f.url.startsWith('chrome-extension://')
          ),
          'the PDF viewer loaded'
        )
      );
      const seen = await window.webContents.executeJavaScript(
        '[typeof require, typeof process, typeof module].join("|")'
      );
      assert.equal(seen, 'undefined|undefined|undefined');
      // The viewer's own title (the file name) never replaces the app's
      await sleep(300);
      assert.equal(window.getTitle(), request.title);
    },
  },
  {
    name: 'refuses navigation off the document URL, and new windows',
    async run({ server, windows, request }) {
      await windows.open(request);
      const window = windowTitled(request.title)!;
      const before = BrowserWindow.getAllWindows().length;

      await window.webContents.executeJavaScript(
        `location.href = ${JSON.stringify(`${server.other}/phish`)}`
      );
      await sleep(700);
      assert.equal(window.webContents.getURL(), request.url);

      const opened = await window.webContents.executeJavaScript(
        `window.open(${JSON.stringify(`${server.other}/popup`)}) === null`
      );
      assert.equal(opened, true);
      await sleep(300);
      assert.equal(BrowserWindow.getAllWindows().length, before);
      assert.deepEqual(server.otherPaths, []);
    },
  },
  {
    name: 'a second open focuses the same window',
    async run({ windows, request }) {
      await windows.open(request);
      const count = BrowserWindow.getAllWindows().length;
      await windows.open(request);
      assert.equal(BrowserWindow.getAllWindows().length, count);
    },
  },
  {
    name: 'a text/plain answer closes the window, never shown, with a ProviderError',
    async run({ server, windows, request }) {
      const error = await windows
        .open({ ...request, key: 'missing', url: `${server.origin}/missing.pdf` })
        .then(
          () => undefined,
          (e: unknown) => e
        );
      assert.ok(error instanceof ProviderError, String(error));
      assert.equal(error.message, "Test Provider didn't send the campground map. Try again later.");
      await sleep(200);
      assert.equal(windowTitled(request.title), undefined);
    },
  },
  {
    name: 'an HTTP error closes the window with a ProviderError',
    async run({ server, windows, request }) {
      const error = await windows
        .open({ ...request, key: 'gone', url: `${server.origin}/gone.pdf` })
        .then(
          () => undefined,
          (e: unknown) => e
        );
      assert.ok(error instanceof ProviderError, String(error));
      await sleep(200);
      assert.equal(windowTitled(request.title), undefined);
    },
  },
  {
    name: 'a redirect elsewhere closes the window with a ProviderError, and never loads there',
    async run({ server, windows, request }) {
      const error = await windows
        .open({ ...request, key: 'moved', url: `${server.origin}/moved.pdf` })
        .then(
          () => undefined,
          (e: unknown) => e
        );
      assert.ok(error instanceof ProviderError, String(error));
      assert.doesNotMatch(error.message, /SECRET|landing/);
      await sleep(200);
      assert.equal(windowTitled(request.title), undefined);
      assert.deepEqual(server.otherPaths, []);
    },
  },
];

async function main(): Promise<number> {
  const server = await startServer();
  const windows = new DocumentWindows({ devTools: false });
  const request: DocumentWindowRequest = {
    key: `${PROVIDER_ID}:1#campground-map`,
    providerId: PROVIDER_ID,
    providerName: 'Test Provider',
    url: `${server.origin}/map.pdf`,
    title: 'Test Camp · Campground map',
    documentName: 'campground map',
    mediaType: 'application/pdf',
  };

  let failures = 0;
  console.log('TAP version 13');
  console.log(`1..${CASES.length}`);
  for (const [index, testCase] of CASES.entries()) {
    const started = Date.now();
    try {
      await testCase.run({ server, windows, request });
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

  await server.close();
  console.log(`# electron ${process.versions.electron}, chrome ${process.versions.chrome}`);
  console.log(`# ${CASES.length - failures} passed, ${failures} failed`);
  return failures;
}

const watchdog = setTimeout(() => {
  console.log('Bail out! the document window tests did not finish in time');
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
