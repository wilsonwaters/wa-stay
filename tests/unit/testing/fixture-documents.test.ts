/**
 * Fixture mode for document windows (test-only): a document partition answers every http(s)
 * request from the provider's fixture routes, bytes as they are, refuses the rest with a 404
 * (logged), and its request filter lets only the routes and local resources through.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { readUnexpectedRequests, serveDocumentFixtures } from '@main/testing';

const MAP_PATH = '/media/parkstay/campground_maps/20/Bungarra_Campground_mud_map.pdf';
const MAP_URL = `https://parkstay.dbca.wa.gov.au${MAP_PATH}`;
/** The start of a PDF, with a byte that is not valid UTF-8. */
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0xe2, 0xff, 0x0a]);

type Handler = (request: Request) => Promise<Response>;
type Filter = (
  details: { url: string; method: string },
  callback: (response: { cancel?: boolean }) => void
) => void;

let dir: string;
let logFile: string;
let handlers: Map<string, Handler>;
let filter: Filter;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-fixture-documents-'));
  fs.mkdirSync(path.join(dir, 'parkstay'));
  fs.writeFileSync(
    path.join(dir, 'parkstay', 'manifest.json'),
    JSON.stringify({ routes: [{ method: 'GET', path: MAP_PATH, file: 'map.pdf' }] })
  );
  fs.writeFileSync(path.join(dir, 'parkstay', 'map.pdf'), PDF);
  logFile = path.join(dir, 'e2e-unexpected-requests.log');
  handlers = new Map();
  serveDocumentFixtures(
    {
      protocol: { handle: (scheme, handler) => void handlers.set(scheme, handler) },
      webRequest: { onBeforeRequest: (listener) => (filter = listener) },
    },
    'parkstay',
    { fixturesDir: dir, logFile }
  );
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const allowed = (url: string, method = 'GET'): boolean => {
  let cancelled = false;
  filter({ url, method }, (response) => (cancelled = response.cancel === true));
  return !cancelled;
};

it('serves a route’s file byte for byte, with its content type', async () => {
  const response = await handlers.get('https')!(new Request(MAP_URL));
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/pdf');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(PDF);
  expect(readUnexpectedRequests(logFile)).toEqual([]);
});

it('answers a request no route matches with a 404, logged, on https and http', async () => {
  const other = await handlers.get('https')!(new Request('https://parkstay.dbca.wa.gov.au/x'));
  expect(other.status).toBe(404);
  const plain = await handlers.get('http')!(
    new Request(`http://parkstay.dbca.wa.gov.au${MAP_PATH}`)
  );
  expect(plain.status).toBe(200);
  expect(readUnexpectedRequests(logFile)).toEqual([
    expect.objectContaining({
      source: 'fixture-document',
      providerId: 'parkstay',
      method: 'GET',
      url: 'https://parkstay.dbca.wa.gov.au/x',
    }),
  ]);
});

it('lets through only the routes and local resources; cancels and logs the rest', () => {
  expect(allowed(MAP_URL)).toBe(true);
  expect(allowed('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html')).toBe(true);
  expect(allowed('chrome://resources/css/roboto.css')).toBe(true);
  expect(readUnexpectedRequests(logFile)).toEqual([]);

  expect(allowed('https://parkstay.dbca.wa.gov.au/api/profile')).toBe(false);
  expect(allowed(MAP_URL, 'POST')).toBe(false);
  expect(allowed('wss://evil.example/socket', 'GET')).toBe(false);
  expect(readUnexpectedRequests(logFile).map((r) => r.url)).toEqual([
    'https://parkstay.dbca.wa.gov.au/api/profile',
    MAP_URL,
    'wss://evil.example/socket',
  ]);
});

it('serves nothing when the provider has no manifest', async () => {
  const empty: Map<string, Handler> = new Map();
  serveDocumentFixtures(
    {
      protocol: { handle: (scheme, handler) => void empty.set(scheme, handler) },
      webRequest: { onBeforeRequest: () => undefined },
    },
    'nobody',
    { fixturesDir: dir, logFile }
  );
  expect((await empty.get('https')!(new Request(MAP_URL))).status).toBe(404);
});
