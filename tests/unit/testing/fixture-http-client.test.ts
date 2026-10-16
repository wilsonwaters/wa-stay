/**
 * FixtureHttpClient (test-only fixture mode): answers provider requests from
 * `<dir>/<providerId>/manifest.json`, matching by method, path, query and form fields; logs
 * and rejects anything no route matches, without sending it.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  FixtureHttpClient,
  fixtureManifestSchema,
  matchFixtureRoute,
  readUnexpectedRequests,
  UnexpectedNetworkRequestError,
  type FixtureRoute,
} from '@main/testing';
import { ProviderError, ProviderHttpError } from '@main/providers/sdk';

const BASE = 'https://provider.example';

let root: string;
let logFile: string;

function writeFixtures(providerId: string, manifest: unknown, files: Record<string, string>): void {
  const dir = path.join(root, 'fixtures', providerId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest)
  );
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
}

function client(providerId = 'fake'): FixtureHttpClient {
  return new FixtureHttpClient({ providerId, fixturesDir: path.join(root, 'fixtures'), logFile });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-fixture-http-'));
  logFile = path.join(root, 'e2e-unexpected-requests.log');
  writeFixtures(
    'fake',
    {
      routes: [
        { method: 'GET', path: '/api/map/', file: 'map.json' },
        { method: 'POST', path: '/api/map/', file: 'posted.json', status: 201 },
        { method: 'GET', path: '/api/avail/', query: { gear: 'tent' }, file: 'tent.json' },
        { method: 'GET', path: '/api/avail/', query: { gear: 'van' }, file: 'van.json' },
        { method: 'GET', path: '/page', file: 'page.html' },
        // One availability path, told apart by the park's blog_id in the form
        { method: 'POST', path: '/booking/', form: { blog_id: '3' }, file: 'busselton.json' },
        { method: 'POST', path: '/booking/', form: { blog_id: '7' }, file: 'esperance.json' },
        {
          method: 'POST',
          path: '/search/',
          query: { lang: 'en' },
          form: { kind: 'cabin' },
          file: 'cabins.json',
        },
        { method: 'GET', path: '/gone', status: 404, file: 'gone.txt', contentType: 'text/x-gone' },
      ],
    },
    {
      'map.json': '{"items":[1,2,3]}',
      'posted.json': '{"created":true}',
      'tent.json': '{"gear":"tent"}',
      'van.json': '{"gear":"van"}',
      'page.html': '<p>queue</p>',
      'busselton.json': '{"park":"Busselton"}',
      'esperance.json': '{"park":"Esperance"}',
      'cabins.json': '{"kind":"cabin"}',
      'gone.txt': 'not here',
    }
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('FixtureHttpClient', () => {
  it('matches by method: the same path answers GET and POST from different files', async () => {
    const http = client();

    await expect(http.getJson(`${BASE}/api/map/`)).resolves.toEqual({ items: [1, 2, 3] });
    await expect(http.postForm(`${BASE}/api/map/`, { a: 1 })).resolves.toEqual({ created: true });
    const posted = await http.request('POST', `${BASE}/api/map/`);
    expect(posted.status).toBe(201);
    await expect(http.request('DELETE', `${BASE}/api/map/`)).rejects.toBeInstanceOf(
      UnexpectedNetworkRequestError
    );
  });

  it('matches by exact path (trailing slash included), on any host', async () => {
    const http = client();

    await expect(http.getJson('https://other.example/api/map/')).resolves.toEqual({
      items: [1, 2, 3],
    });
    await expect(http.getJson(`${BASE}/api/map`)).rejects.toBeInstanceOf(
      UnexpectedNetworkRequestError
    );
    await expect(http.getJson(`${BASE}/api/map/more`)).rejects.toBeInstanceOf(
      UnexpectedNetworkRequestError
    );
  });

  it("matches by query: every value the route names must equal the request's, others may be anything", async () => {
    const http = client();

    await expect(http.getJson(`${BASE}/api/avail/`, { query: { gear: 'van' } })).resolves.toEqual({
      gear: 'van',
    });
    await expect(
      http.getJson(`${BASE}/api/avail/?arrival=2026/11/10`, { query: { gear: 'tent' } })
    ).resolves.toEqual({ gear: 'tent' });
    // A route without `query` matches any query string
    await expect(http.getJson(`${BASE}/api/map/?format=json`)).resolves.toEqual({
      items: [1, 2, 3],
    });
    // A query value no route names
    await expect(
      http.getJson(`${BASE}/api/avail/`, { query: { gear: 'caravan' } })
    ).rejects.toBeInstanceOf(UnexpectedNetworkRequestError);
    await expect(http.getJson(`${BASE}/api/avail/`)).rejects.toBeInstanceOf(
      UnexpectedNetworkRequestError
    );
  });

  it('a form route matches the fields of a form body; fields it leaves out may be anything', async () => {
    const http = client();

    await expect(http.postForm(`${BASE}/booking/`, { blog_id: 3 })).resolves.toEqual({
      park: 'Busselton',
    });
    await expect(
      http.postForm(`${BASE}/booking/`, {
        action: 'search',
        arrive: '2026-11-10',
        blog_id: '3',
        depart: '2026-11-12',
      })
    ).resolves.toEqual({ park: 'Busselton' });
    // A body sent with request() is read as a form too
    const raw = await http.request('POST', `${BASE}/booking/`, {
      body: new URLSearchParams({ x: '1', blog_id: '3' }),
    });
    await expect(raw.json()).resolves.toEqual({ park: 'Busselton' });
  });

  it('two routes on one path are told apart by blog_id', async () => {
    const http = client();

    await expect(http.postForm(`${BASE}/booking/`, { blog_id: 7 })).resolves.toEqual({
      park: 'Esperance',
    });
    await expect(http.postForm(`${BASE}/booking/`, { blog_id: 3 })).resolves.toEqual({
      park: 'Busselton',
    });
    await expect(http.postForm(`${BASE}/booking/`, { blog_id: 9 })).rejects.toBeInstanceOf(
      UnexpectedNetworkRequestError
    );
  });

  it('a form route never matches a request without a body', async () => {
    const http = client();

    await expect(http.request('POST', `${BASE}/booking/?blog_id=3`)).rejects.toBeInstanceOf(
      UnexpectedNetworkRequestError
    );
    expect(
      matchFixtureRoute([{ method: 'GET', path: '/x', form: {}, file: 'f' }], 'GET', `${BASE}/x`)
    ).toBeUndefined();
    expect(
      matchFixtureRoute(
        [{ method: 'GET', path: '/x', form: {}, file: 'f' }],
        'GET',
        `${BASE}/x`,
        ''
      )
    ).toMatchObject({ file: 'f' });
  });

  it('a route with both query and form needs both to match', async () => {
    const http = client();

    await expect(
      http.postForm(`${BASE}/search/`, { kind: 'cabin' }, { query: { lang: 'en' } })
    ).resolves.toEqual({ kind: 'cabin' });
    await expect(
      http.postForm(`${BASE}/search/`, { kind: 'cabin' }, { query: { lang: 'fr' } })
    ).rejects.toBeInstanceOf(UnexpectedNetworkRequestError);
    await expect(
      http.postForm(`${BASE}/search/`, { kind: 'site' }, { query: { lang: 'en' } })
    ).rejects.toBeInstanceOf(UnexpectedNetworkRequestError);
  });

  it('names the form fields of a refused request in its log entry and its message', async () => {
    const http = client();

    const error = await http
      .postForm(`${BASE}/booking/`, { blog_id: 9, arrive: '2026-11-10' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnexpectedNetworkRequestError);
    expect(error).toMatchObject({ form: { blog_id: '9', arrive: '2026-11-10' } });
    expect((error as Error).message).toContain(
      `POST ${BASE}/booking/ with form {"blog_id":"9","arrive":"2026-11-10"}; add a route to`
    );
    expect(readUnexpectedRequests(logFile)).toEqual([
      {
        time: expect.any(String),
        source: 'fixture-http',
        providerId: 'fake',
        method: 'POST',
        url: `${BASE}/booking/`,
        form: { blog_id: '9', arrive: '2026-11-10' },
      },
    ]);
  });

  it('logs and rejects an unmatched request, naming the manifest, and never sends it', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const http = client();

    const error = await http
      .getJson(`${BASE}/api/unknown/`, { query: { id: 7 } })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnexpectedNetworkRequestError);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error).toMatchObject({
      providerId: 'fake',
      method: 'GET',
      reason: 'blocked',
      retryable: false,
      url: `${BASE}/api/unknown/?id=7`,
    });
    expect((error as Error).message).toContain(
      `GET ${BASE}/api/unknown/?id=7; add a route to ${path.join(root, 'fixtures', 'fake', 'manifest.json')}`
    );
    expect(readUnexpectedRequests(logFile)).toEqual([
      {
        time: expect.any(String),
        source: 'fixture-http',
        providerId: 'fake',
        method: 'GET',
        url: `${BASE}/api/unknown/?id=7`,
      },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('a provider without a fixture folder has no routes: every request is logged and rejected', async () => {
    const http = client('nofixtures');

    await expect(http.getJson(`${BASE}/api/map/`)).rejects.toBeInstanceOf(
      UnexpectedNetworkRequestError
    );
    expect(readUnexpectedRequests(logFile)).toHaveLength(1);
  });

  it("answers with the route's status and content type (by extension unless given)", async () => {
    const http = client();

    const page = await http.request('GET', `${BASE}/page`);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(page.text()).resolves.toBe('<p>queue</p>');

    const json = await http.request('GET', `${BASE}/api/map/`);
    expect(json.headers.get('content-type')).toBe('application/json');
    expect(json.url).toBe(`${BASE}/api/map/`);

    const gone = await http.request('GET', `${BASE}/gone`);
    expect(gone).toMatchObject({ status: 404, ok: false });
    expect(gone.headers.get('content-type')).toBe('text/x-gone');
    await expect(http.getJson(`${BASE}/gone`)).rejects.toMatchObject({ status: 404 });
  });

  it('keeps the default headers of withDefaults and the same routes', async () => {
    const http = client().withDefaults({ headers: { Referer: `${BASE}/` } });

    await expect(http.getJson(`${BASE}/api/map/`)).resolves.toEqual({ items: [1, 2, 3] });
    expect(http.providerId).toBe('fake');
  });

  it('rejects with a ProviderError naming the manifest when it is not valid', async () => {
    writeFixtures('broken', '{ "routes": [ { "method": "GET" } ] }', {});
    writeFixtures('notjson', '{ routes: ', {});

    const broken = await client('broken')
      .getJson(`${BASE}/x`)
      .catch((e: unknown) => e);
    expect(broken).toBeInstanceOf(ProviderError);
    expect((broken as Error).message).toMatch(
      /broken[\\/]manifest\.json is invalid at routes\.0\./
    );

    await expect(client('notjson').getJson(`${BASE}/x`)).rejects.toThrow(
      /notjson[\\/]manifest\.json is not valid JSON/
    );
  });

  it('rejects with a ProviderError when the fixture file of a matched route is missing', async () => {
    writeFixtures('missing', { routes: [{ method: 'GET', path: '/x', file: 'absent.json' }] }, {});

    await expect(client('missing').getJson(`${BASE}/x`)).rejects.toThrow(
      /fixture file .*absent\.json for GET \/x cannot be read/
    );
  });
});

describe('matchFixtureRoute', () => {
  const routes: FixtureRoute[] = [
    { method: 'GET', path: '/a', query: { x: '1' }, file: 'first' },
    { method: 'GET', path: '/a', file: 'fallback' },
    { method: 'POST', path: '/a', form: { y: '2' }, file: 'form' },
    { method: 'POST', path: '/a', file: 'any-post' },
  ];

  it('returns the first route that matches', () => {
    expect(matchFixtureRoute(routes, 'GET', `${BASE}/a?x=1`)?.file).toBe('first');
    expect(matchFixtureRoute(routes, 'GET', `${BASE}/a?x=2`)?.file).toBe('fallback');
    expect(matchFixtureRoute(routes, 'PUT', `${BASE}/a`)).toBeUndefined();
  });

  it('matches a form route by the body, and without a body (a document request) never', () => {
    expect(matchFixtureRoute(routes, 'POST', `${BASE}/a`, 'y=2&z=3')?.file).toBe('form');
    expect(matchFixtureRoute(routes, 'POST', `${BASE}/a`, 'y=1')?.file).toBe('any-post');
    expect(matchFixtureRoute(routes, 'POST', `${BASE}/a`)?.file).toBe('any-post');
    // A route without form matches any body
    expect(matchFixtureRoute(routes, 'GET', `${BASE}/a`, 'y=2')?.file).toBe('fallback');
  });
});

describe('fixtureManifestSchema', () => {
  const route = { method: 'POST', path: '/booking/', file: 'a.json' };

  it('accepts string form values', () => {
    expect(
      fixtureManifestSchema.safeParse({ routes: [{ ...route, form: { blog_id: '3' } }] }).success
    ).toBe(true);
  });

  it.each([{ blog_id: 3 }, { blog_id: true }, { blog_id: null }, { blog_id: ['3'] }, 'blog_id=3'])(
    'rejects non-string form values (%j)',
    (form) => {
      const parsed = fixtureManifestSchema.safeParse({ routes: [{ ...route, form }] });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0].path.slice(0, 3)).toEqual(['routes', 0, 'form']);
    }
  );
});
