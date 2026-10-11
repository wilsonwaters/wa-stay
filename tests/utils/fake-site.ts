/**
 * A made-up provider site (`FakeBrowserSite`: a route map or one handler, as the fake browser
 * takes) and how it answers a request, shared by two consumers:
 *
 * - the fake browser (`tests/utils/fake-browser.ts`), which loads its pages into jsdom;
 * - `serveFakeSite(site)`, which serves it on loopback HTTP for a real browser: the
 *   real-browser smoke test, and a browser provider's preview in the app
 *   (`scripts/serve-provider-site.mjs`, "Preview in the app" in
 *   docs/providers/browser-providers.md).
 *
 * A route key that names an absolute URL (`https://parks.test/search`) matches only that
 * origin, so a site served on loopback answers by path and query.
 */

import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import type {
  FakeBrowserSite,
  FakeResourceType,
  FakeRoute,
  FakeRouteMap,
  FakeSiteRequest,
} from './fake-browser';

/** A site's answer, ready to send: a status, lower-case headers and the body. */
export interface FakeSiteResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

const NOT_FOUND_HTML = '<!doctype html><title>Not found</title><h1>Not found</h1>';

function routeFor(routes: FakeRouteMap, request: FakeSiteRequest): FakeRoute | string | undefined {
  const { url, method } = request;
  const keys = [
    url.origin + url.pathname + url.search,
    url.origin + url.pathname,
    url.pathname + url.search,
    url.pathname,
  ];
  for (const prefix of [`${method} `, '']) {
    for (const key of keys) {
      const route = routes[prefix + key];
      if (route !== undefined) return typeof route === 'function' ? route(url, request) : route;
    }
  }
  return undefined;
}

/** What `site` answers `request`: its route, a 404 page when it has none. */
export function answerFakeSite(site: FakeBrowserSite, request: FakeSiteRequest): FakeSiteResponse {
  const raw = typeof site === 'function' ? site(request.url, request) : routeFor(site, request);
  const route: FakeRoute =
    raw === undefined
      ? { status: 404, body: NOT_FOUND_HTML }
      : typeof raw === 'string'
        ? { body: raw }
        : raw;
  const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' };
  for (const [name, value] of Object.entries(route.headers ?? {})) {
    headers[name.toLowerCase()] = value;
  }
  let body = route.body ?? route.html ?? '';
  if (route.file !== undefined) {
    const file = path.resolve(route.file);
    if (!fs.existsSync(file)) throw new Error(`fake site: ${request.url.href}: no file ${file}`);
    body = fs.readFileSync(file, 'utf8');
  }
  return { url: request.url.href, status: route.status ?? 200, headers, body };
}

/** What made a request, from the browser's `Sec-Fetch-Dest` header. */
function resourceTypeOf(destination: string | string[] | undefined): FakeResourceType {
  switch (destination) {
    case 'document':
    case 'iframe':
      return 'document';
    case 'script':
      return 'script';
    case 'style':
      return 'stylesheet';
    case 'empty':
      return 'fetch';
    default:
      return 'other';
  }
}

export interface ServeFakeSiteOptions {
  /** The loopback port. Default 0: any free port (read it from `baseUrl`). */
  port?: number;
  /** Called after each answer, e.g. to log it. */
  onRequest?: (request: FakeSiteRequest, response: Pick<FakeSiteResponse, 'status'>) => void;
}

export interface FakeSiteServer {
  /** `http://127.0.0.1:<port>`, with no trailing slash. */
  baseUrl: string;
  port: number;
  close(): Promise<void>;
}

/**
 * Serves `site` on `http://127.0.0.1:<port>`, reachable from this computer only. A form's or a
 * page script's request body reaches the site as `request.body`; a site that throws answers
 * 500 with the error's message.
 */
export async function serveFakeSite(
  site: FakeBrowserSite,
  { port = 0, onRequest }: ServeFakeSiteOptions = {}
): Promise<FakeSiteServer> {
  let baseUrl = '';
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const request: FakeSiteRequest = {
        method: req.method ?? 'GET',
        url: new URL(req.url ?? '/', baseUrl),
        resourceType: resourceTypeOf(req.headers['sec-fetch-dest']),
        ...(text ? { body: text } : {}),
      };
      let response: Pick<FakeSiteResponse, 'status' | 'headers' | 'body'>;
      try {
        response = answerFakeSite(site, request);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        response = { status: 500, headers: { 'content-type': 'text/plain' }, body: message };
      }
      res.writeHead(response.status, response.headers);
      res.end(response.body);
      onRequest?.(request, response);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  const actual = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${actual}`;
  return {
    baseUrl,
    port: actual,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
