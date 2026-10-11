/**
 * `HttpClient` transport cases, shared by both clients so they are held to the same
 * semantics (architecture-notes §12.30):
 *
 * - `NodeHttpClient` runs them under Jest (`tests/unit/providers/http-transport-parity.test.ts`);
 * - `ElectronSessionHttpClient` runs them live, inside Electron, against the same servers
 *   (`tests/electron/http-transport.electron.ts`, `npm run test:electron`).
 *
 * The cases use `node:assert`, not Jest, so they run in both places. Two loopback servers
 * give two origins (`base` and `other`, different ports on 127.0.0.1).
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  isAbortError,
  MAX_REDIRECTS,
  ProviderHttpError,
  ProviderParseError,
  ProviderTimeoutError,
  type HttpClient,
} from '../../src/main/providers/sdk';

export interface TransportCaseContext {
  client: HttpClient;
  /** The user agent the client presents (the Electron partition's follows its Chromium). */
  userAgent: string;
  /** Origin A, e.g. `http://127.0.0.1:41234`. */
  base: string;
  /** Origin B: another port, so another origin. */
  other: string;
  /** A loopback port nothing listens on. */
  closedPort: number;
}

export interface TransportCase {
  name: string;
  run(ctx: TransportCaseContext): Promise<void>;
}

export interface TransportTestServers {
  base: string;
  other: string;
  closedPort: number;
  close(): Promise<void>;
}

interface Echo {
  method: string;
  url: string;
  cookie: string | null;
  referer: string | null;
  authorization: string | null;
  userAgent: string | null;
  contentType: string | null;
  body: string;
}

type Route = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: string,
  origins: { other: string }
) => void;

const ROUTES: Record<string, Route> = {
  '/echo': (req, res, body) => {
    const echo: Echo = {
      method: req.method ?? '',
      url: req.url ?? '',
      cookie: req.headers.cookie ?? null,
      referer: req.headers.referer ?? null,
      authorization: req.headers.authorization ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      contentType: req.headers['content-type'] ?? null,
      body,
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(echo));
  },
  '/json': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  },
  '/html': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><script>window.location.replace("/queue")</script></html>');
  },
  '/fail': (_req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"boom"}');
  },
  '/unauthorized': (_req, res) => {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="test"', 'content-type': 'text/plain' });
    res.end('sign in');
  },
  '/start': (_req, res) => {
    res.writeHead(302, { location: '/middle', 'set-cookie': 'first=1=2; Path=/' });
    res.end('redirect body');
  },
  '/middle': (_req, res) => {
    res.writeHead(302, {
      location: '/echo',
      'set-cookie': ['second=b; Path=/', 'third=c; Path=/'],
    });
    res.end();
  },
  '/post-redirect': (_req, res) => {
    res.writeHead(303, { location: '/echo' });
    res.end();
  },
  '/hops': (req, res) => {
    const n = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('n') ?? 0);
    if (n >= MAX_REDIRECTS) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ hops: n }));
      return;
    }
    res.writeHead(302, { location: `/hops?n=${n + 1}` });
    res.end();
  },
  '/loop': (req, res) => {
    const n = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('n') ?? 0);
    res.writeHead(302, { location: `/loop?n=${n + 1}` });
    res.end();
  },
  '/to-other': (_req, res, _body, { other }) => {
    res.writeHead(302, { location: `${other}/echo` });
    res.end();
  },
  '/to-file': (_req, res) => {
    res.writeHead(302, { location: 'file:///etc/passwd' });
    res.end();
  },
  '/to-plain-http': (_req, res) => {
    res.writeHead(302, { location: 'http://example.com/' });
    res.end();
  },
  '/hang': () => {
    // Never answers.
  },
  '/slow-body': (_req, res) => {
    // Headers and half a body, then nothing.
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '1000' });
    res.write('{"partial":');
  },
};

function createServer(origins: { other: string }): http.Server {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const route = ROUTES[new URL(req.url ?? '/', 'http://x').pathname];
      if (route) route(req, res, body, origins);
      else {
        res.writeHead(404);
        res.end('not found');
      }
    });
  });
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  );
}

function shut(server: http.Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

/** Starts both origins and finds a closed port. */
export async function startTransportTestServers(): Promise<TransportTestServers> {
  const origins = { other: '' };
  const a = createServer(origins);
  const b = createServer(origins);
  const base = `http://127.0.0.1:${await listen(a)}`;
  origins.other = `http://127.0.0.1:${await listen(b)}`;

  const closed = http.createServer();
  const closedPort = await listen(closed);
  await shut(closed);

  return {
    base,
    other: origins.other,
    closedPort,
    close: async () => {
      await Promise.all([shut(a), shut(b)]);
    },
  };
}

/** The error `pending` rejects with; fails if it resolves. */
async function rejection(pending: Promise<unknown>): Promise<unknown> {
  try {
    await pending;
  } catch (error) {
    return error;
  }
  assert.fail('expected the request to fail');
}

function assertHttpError(
  error: unknown,
  expected: Partial<Pick<ProviderHttpError, 'status' | 'reason' | 'retryable' | 'message'>>
): asserts error is ProviderHttpError {
  assert.ok(error instanceof ProviderHttpError, `expected ProviderHttpError, got ${String(error)}`);
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(error[key as keyof ProviderHttpError], value, `${key} of ${error.message}`);
  }
}

const REFERER = 'https://parkstay.dbca.wa.gov.au/search-availability/campground/?site_id=20';

export const HTTP_TRANSPORT_CASES: readonly TransportCase[] = [
  {
    name: 'follows redirects, stores and sends cookies on every hop, and reports the final URL',
    async run({ client, base }) {
      const response = await client.request('GET', `${base}/start`);
      const echo = await response.json<Echo>();
      assert.equal(response.status, 200);
      assert.equal(response.url, `${base}/echo`);
      assert.equal(echo.url, '/echo');
      assert.equal(echo.cookie, 'first=1=2; second=b; third=c');
      assert.equal((await client.cookies.get(base, 'first'))?.value, '1=2');
    },
  },
  {
    name: "returns a 3xx as is under redirect: 'manual' (Location, empty body) and keeps its cookies",
    async run({ client, base }) {
      const response = await client.request('GET', `${base}/start`, { redirect: 'manual' });
      assert.equal(response.status, 302);
      assert.equal(response.ok, false);
      assert.equal(response.url, `${base}/start`);
      assert.equal(response.headers.get('location'), '/middle');
      assert.equal(await response.text(), '');
      assert.equal((await client.cookies.get(base, 'first'))?.value, '1=2');
    },
  },
  {
    name: `follows exactly ${MAX_REDIRECTS} redirects`,
    async run({ client, base }) {
      const response = await client.request('GET', `${base}/hops?n=0`);
      assert.equal(response.status, 200);
      assert.equal(response.url, `${base}/hops?n=${MAX_REDIRECTS}`);
      assert.deepEqual(await response.json(), { hops: MAX_REDIRECTS });
    },
  },
  {
    name: `rejects a redirect loop past ${MAX_REDIRECTS} hops (redirect-limit, not retryable)`,
    async run({ client, base }) {
      const error = await rejection(client.request('GET', `${base}/loop`));
      assertHttpError(error, {
        status: 302,
        reason: 'redirect-limit',
        retryable: false,
        message: `${client.providerId}: more than ${MAX_REDIRECTS} redirects`,
      });
      assert.equal(error.url, `${base}/loop?n=${MAX_REDIRECTS}`);
    },
  },
  {
    name: "rejects any redirect under redirect: 'error' (redirect, not retryable)",
    async run({ client, base }) {
      const error = await rejection(client.request('GET', `${base}/start`, { redirect: 'error' }));
      assertHttpError(error, { status: 302, reason: 'redirect', retryable: false });
      assert.match(error.message, /unexpected redirect \(HTTP 302\)/);
    },
  },
  {
    name: 'turns a POST into a GET on 303 and drops the body',
    async run({ client, base }) {
      const echo = await client.postForm<Echo>(`${base}/post-redirect`, { a: 1 });
      assert.equal(echo.method, 'GET');
      assert.equal(echo.body, '');
      assert.equal(echo.contentType, null);
    },
  },
  {
    name: 'posts a urlencoded form',
    async run({ client, base }) {
      const echo = await client.postForm<Echo>(`${base}/echo`, { arrival: '2026/11/10', n: 2 });
      assert.equal(echo.method, 'POST');
      assert.match(echo.contentType ?? '', /application\/x-www-form-urlencoded/);
      assert.equal(echo.body, 'arrival=2026%2F11%2F10&n=2');
    },
  },
  {
    name: 'sends a cross-origin Referer with its full path, also after redirects',
    async run({ client, base }) {
      const direct = await client.getJson<Echo>(`${base}/echo`, { headers: { Referer: REFERER } });
      assert.equal(direct.referer, REFERER);
      const redirected = await client
        .withDefaults({ headers: { Referer: REFERER } })
        .getJson<Echo>(`${base}/start`);
      assert.equal(redirected.referer, REFERER);
    },
  },
  {
    name: 'keeps Authorization on a same-origin redirect and drops it when the origin changes',
    async run({ client, base, other }) {
      const headers = { Authorization: 'Bearer secret' };
      const same = await client.getJson<Echo>(`${base}/start`, { headers });
      assert.equal(same.authorization, 'Bearer secret');
      const crossed = await client.request('GET', `${base}/to-other`, { headers });
      assert.equal(crossed.url, `${other}/echo`);
      assert.equal((await crossed.json<Echo>()).authorization, null);
    },
  },
  {
    name: 'sends the desktop Chrome user agent',
    async run({ client, base, userAgent }) {
      const echo = await client.getJson<Echo>(`${base}/echo`);
      assert.equal(echo.userAgent, userAgent);
      assert.match(
        userAgent,
        /^Mozilla\/5\.0 \(Windows NT 10\.0; Win64; x64\).* Chrome\/\d+\.0\.0\.0 Safari/
      );
    },
  },
  {
    name: 'sends cookies set through the cookie store, and forgets them after clear()',
    async run({ client, base }) {
      await client.cookies.set({ url: base, name: 'preset', value: 'a=b' });
      assert.equal((await client.getJson<Echo>(`${base}/echo`)).cookie, 'preset=a=b');
      await client.cookies.clear();
      assert.equal((await client.getJson<Echo>(`${base}/echo`)).cookie, null);
    },
  },
  {
    name: 'ignores a Cookie header the caller sets: cookies come from the cookie store',
    async run({ client, base }) {
      await client.cookies.set({ url: base, name: 'jar', value: '1' });
      const echo = await client.getJson<Echo>(`${base}/echo`, { headers: { Cookie: 'forged=2' } });
      assert.equal(echo.cookie, 'jar=1');
    },
  },
  {
    name: 'times out before the headers with ProviderTimeoutError (retryable)',
    async run({ client, base }) {
      const started = Date.now();
      const error = await rejection(client.request('GET', `${base}/hang`, { timeoutMs: 200 }));
      assert.ok(error instanceof ProviderTimeoutError, String(error));
      assert.equal(error.retryable, true);
      assert.equal(error.timeoutMs, 200);
      assert.ok(Date.now() - started < 5000);
    },
  },
  {
    name: 'times out in the middle of the body with ProviderTimeoutError',
    async run({ client, base }) {
      const error = await rejection(client.request('GET', `${base}/slow-body`, { timeoutMs: 300 }));
      assert.ok(error instanceof ProviderTimeoutError, String(error));
    },
  },
  {
    name: 'rejects with an AbortError when the caller aborts: already, before headers, mid-body',
    async run({ client, base }) {
      const early = new AbortController();
      early.abort();
      assert.ok(
        isAbortError(
          await rejection(client.request('GET', `${base}/json`, { signal: early.signal }))
        )
      );

      for (const path of ['/hang', '/slow-body']) {
        const controller = new AbortController();
        const pending = client.request('GET', `${base}${path}`, {
          signal: controller.signal,
          timeoutMs: 5000,
        });
        setTimeout(() => controller.abort(), 100);
        const error = await rejection(pending);
        assert.ok(isAbortError(error), `${path}: ${String(error)}`);
        assert.ok(!(error instanceof ProviderTimeoutError), path);
      }
    },
  },
  {
    name: 'refuses file:, ftp: and plain http to a remote host without sending (blocked, not retryable)',
    async run({ client }) {
      for (const url of ['file:///etc/passwd', 'ftp://example.com/x', 'http://example.com/']) {
        const error = await rejection(client.request('GET', url));
        assertHttpError(error, { status: 0, reason: 'blocked', retryable: false });
        assert.match(error.message, /only https URLs are allowed/);
      }
      assertHttpError(await rejection(client.request('GET', 'not a url')), {
        reason: 'blocked',
        retryable: false,
      });
    },
  },
  {
    name: 'refuses a redirect to file: or to plain http on a remote host',
    async run({ client, base }) {
      for (const path of ['/to-file', '/to-plain-http']) {
        const error = await rejection(client.request('GET', `${base}${path}`));
        assertHttpError(error, { status: 0, reason: 'blocked', retryable: false });
      }
    },
  },
  {
    name: 'a refused connection is a retryable network error naming the transport code',
    async run({ client, closedPort }) {
      const error = await rejection(client.getJson(`http://127.0.0.1:${closedPort}/`));
      assertHttpError(error, { status: 0, reason: 'network', retryable: true });
      assert.ok(
        error.netError === 'ECONNREFUSED' || error.netError === 'ERR_CONNECTION_REFUSED',
        `netError ${error.netError}`
      );
    },
  },
  {
    name: 'getJson: 500 is a retryable ProviderHttpError, text/html is a ProviderParseError',
    async run({ client, base }) {
      assertHttpError(await rejection(client.getJson(`${base}/fail`)), {
        status: 500,
        reason: 'status',
        retryable: true,
      });
      const parse = await rejection(client.getJson(`${base}/html`));
      assert.ok(parse instanceof ProviderParseError, String(parse));
      assert.equal(parse.message, `${client.providerId}: expected JSON but got text/html`);
    },
  },
  {
    name: 'returns a 401 challenge as a response',
    async run({ client, base }) {
      const response = await client.request('GET', `${base}/unauthorized`);
      assert.equal(response.status, 401);
      assert.equal(await response.text(), 'sign in');
    },
  },
];
