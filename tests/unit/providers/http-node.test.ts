/**
 * NodeHttpClient against a real local server on 127.0.0.1: redirects with cookies on every
 * hop, timeouts, aborts, JSON helpers and their errors.
 */

import http from 'http';
import type { AddressInfo } from 'net';
import {
  isAbortError,
  NodeHttpClient,
  ProviderHttpError,
  ProviderParseError,
  ProviderTimeoutError,
} from '@main/providers/sdk';

type Route = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void;

const routes: Record<string, Route> = {
  '/json': (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  },
  '/echo': (req, res, body) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        method: req.method,
        url: req.url,
        cookie: req.headers.cookie ?? null,
        referer: req.headers.referer ?? null,
        accept: req.headers.accept ?? null,
        contentType: req.headers['content-type'] ?? null,
        custom: req.headers['x-custom'] ?? null,
        body,
      })
    );
  },
  '/html': (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><script>window.location.replace("/queue")</script></html>');
  },
  '/fail': (_req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end('{"error":"boom"}');
  },
  '/no-content': (_req, res) => {
    res.writeHead(204);
    res.end();
  },
  '/hang': () => {
    // Never answers.
  },
  '/start': (_req, res) => {
    res.writeHead(302, { location: '/middle', 'set-cookie': 'first=1=2; Path=/' });
    res.end();
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
  '/loop': (req, res) => {
    const n = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('n') ?? 0);
    res.writeHead(302, { location: `/loop?n=${n + 1}` });
    res.end();
  },
};

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const route = routes[new URL(req.url ?? '/', 'http://x').pathname];
      if (route) route(req, res, body);
      else {
        res.writeHead(404);
        res.end('not found');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const activeTimers = (): number =>
  process.getActiveResourcesInfo().filter((type) => type === 'Timeout').length;

describe('NodeHttpClient', () => {
  let client: NodeHttpClient;

  beforeEach(() => {
    client = new NodeHttpClient({ providerId: 'fake' });
  });

  it('stores cookies set on 302 hops and sends them on the final hop', async () => {
    const response = await client.request('GET', `${base}/start`);
    const echo = await response.json<{ url: string; cookie: string }>();

    expect(response.status).toBe(200);
    expect(response.url).toBe(`${base}/echo`);
    expect(echo.url).toBe('/echo');
    // Multiple Set-Cookie headers in one response are all kept (getSetCookie).
    expect(echo.cookie).toBe('first=1=2; second=b; third=c');
    expect(await client.cookies.get(base, 'first')).toMatchObject({ value: '1=2' });
  });

  it('turns a POST into a GET on 303 and drops the body', async () => {
    const echo = await client.postForm<{
      method: string;
      body: string;
      contentType: string | null;
    }>(`${base}/post-redirect`, { a: 1 });
    expect(echo).toMatchObject({ method: 'GET', body: '', contentType: null });
  });

  it('returns a 3xx as is with redirect: manual', async () => {
    const response = await client.request('GET', `${base}/start`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/middle');
    expect(await client.cookies.get(base, 'first')).toBeDefined();
  });

  it('throws ProviderHttpError on a redirect loop over 5 hops', async () => {
    const error = await client.request('GET', `${base}/loop`).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ status: 302, message: 'fake: more than 5 redirects' });
  });

  it('throws ProviderHttpError on any redirect with redirect: error', async () => {
    await expect(client.request('GET', `${base}/start`, { redirect: 'error' })).rejects.toThrow(
      /unexpected redirect/
    );
  });

  it('throws ProviderTimeoutError when timeoutMs (100) passes on a hanging route', async () => {
    const started = Date.now();
    const error = await client.request('GET', `${base}/hang`, { timeoutMs: 100 }).catch((e) => e);

    expect(error).toBeInstanceOf(ProviderTimeoutError);
    expect(error).toMatchObject({ providerId: 'fake', timeoutMs: 100, retryable: true });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('rejects with an AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await client
      .request('GET', `${base}/json`, { signal: controller.signal })
      .catch((e) => e);
    expect(isAbortError(error)).toBe(true);
  });

  it('rejects with an AbortError when the caller aborts before the timeout', async () => {
    const controller = new AbortController();
    const pending = client.request('GET', `${base}/hang`, {
      signal: controller.signal,
      timeoutMs: 5000,
    });
    setTimeout(() => controller.abort(), 20);
    const error = await pending.catch((e) => e);
    expect(isAbortError(error)).toBe(true);
    expect(error).not.toBeInstanceOf(ProviderTimeoutError);
  });

  it('times out first when the timeout is shorter than the caller abort', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const error = await client
      .request('GET', `${base}/hang`, { signal: controller.signal, timeoutMs: 50 })
      .catch((e) => e);
    clearTimeout(timer);
    expect(error).toBeInstanceOf(ProviderTimeoutError);
  });

  it('clears its timer on success, leaving no open timeout', async () => {
    const before = activeTimers();
    await client.getJson(`${base}/json`, { timeoutMs: 60_000 });
    expect(activeTimers()).toBe(before);
  });

  it('getJson parses JSON and sends query params and an Accept header', async () => {
    const echo = await client.getJson<{ url: string; accept: string }>(`${base}/echo`, {
      query: { arrival: '2026/11/10', adults: 2, skip: undefined, none: null, flag: true },
    });
    expect(echo.url).toBe('/echo?arrival=2026%2F11%2F10&adults=2&flag=true');
    expect(echo.accept).toContain('application/json');
  });

  it('getJson on a text/html 200 throws ProviderParseError', async () => {
    const error = await client.getJson(`${base}/html`).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderParseError);
    expect(error).toMatchObject({ message: 'fake: expected JSON but got text/html' });
  });

  it('getJson on a 500 throws ProviderHttpError with status 500', async () => {
    const error = await client.getJson(`${base}/fail`).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ status: 500, url: `${base}/fail`, retryable: true });
  });

  it('getJson on a 204 resolves undefined', async () => {
    await expect(client.getJson(`${base}/no-content`)).resolves.toBeUndefined();
  });

  it('getJson on a 404 throws a non-retryable ProviderHttpError', async () => {
    await expect(client.getJson(`${base}/missing`)).rejects.toMatchObject({
      status: 404,
      retryable: false,
    });
  });

  it('a refused connection is a retryable ProviderHttpError with status 0', async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));

    const error = await client.getJson(`http://127.0.0.1:${port}/`).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({ status: 0, retryable: true });
  });

  it('postForm sends a urlencoded body', async () => {
    const echo = await client.postForm<{ method: string; body: string; contentType: string }>(
      `${base}/echo`,
      { arrival: '2026/11/10', num_adult: 2, skipped: undefined }
    );
    expect(echo.method).toBe('POST');
    expect(echo.contentType).toContain('application/x-www-form-urlencoded');
    expect(echo.body).toBe('arrival=2026%2F11%2F10&num_adult=2');
  });

  it('withDefaults adds headers to every request, request headers win, and cookies are shared', async () => {
    await client.cookies.set({ url: base, name: 'shared', value: 'yes' });
    const withReferer = client.withDefaults({
      headers: { Referer: 'https://parkstay.dbca.wa.gov.au/', 'X-Custom': 'default' },
    });

    const echo = await withReferer.getJson<{ referer: string; custom: string; cookie: string }>(
      `${base}/echo`,
      { headers: { 'x-custom': 'override' } }
    );

    expect(echo).toMatchObject({
      referer: 'https://parkstay.dbca.wa.gov.au/',
      custom: 'override',
      cookie: 'shared=yes',
    });
    expect(withReferer.cookies).toBe(client.cookies);
    expect(withReferer.providerId).toBe('fake');
  });
});
