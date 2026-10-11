/**
 * @jest-environment node
 *
 * `serveFakeSite` (tests/utils/fake-site.ts) serves a made-up site on loopback HTTP, answering
 * as the fake browser does: routes by path and method, a request's body, redirects, a 404 for
 * anything else, and a 500 when the site throws.
 */

import type { FakeSiteRequest } from '@tests/utils/fake-browser';
import { serveFakeSite, type FakeSiteServer } from '@tests/utils/fake-site';

describe('serveFakeSite', () => {
  let server: FakeSiteServer;
  const seen: { request: FakeSiteRequest; status: number }[] = [];

  beforeAll(async () => {
    server = await serveFakeSite(
      {
        '/parks': '<ul><li data-park="sunset">Sunset</li></ul>',
        'POST /search': (_url, request) => ({ body: `searched ${request.body ?? ''}` }),
        '/api/nights': { headers: { 'Content-Type': 'application/json' }, body: '{"nights":[]}' },
        '/old': { status: 302, headers: { location: '/parks' } },
        '/broken': () => {
          throw new Error('the site broke');
        },
      },
      { onRequest: (request, response) => seen.push({ request, status: response.status }) }
    );
  });
  afterAll(() => server.close());

  it('listens on loopback only, on the port it reports', () => {
    expect(server.baseUrl).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.port).toBeGreaterThan(0);
  });

  it('answers a page by path, whatever the query, as HTML', async () => {
    const response = await fetch(`${server.baseUrl}/parks?page=2`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    await expect(response.text()).resolves.toContain('data-park="sunset"');
  });

  it("passes a form's body to the site, and keeps the site's own headers", async () => {
    const form = await fetch(`${server.baseUrl}/search`, { method: 'POST', body: 'q=bay' });
    await expect(form.text()).resolves.toBe('searched q=bay');
    const json = await fetch(`${server.baseUrl}/api/nights`);
    expect(json.headers.get('content-type')).toBe('application/json');
  });

  it('redirects, answers 404 for a path it does not know, and 500 when the site throws', async () => {
    const moved = await fetch(`${server.baseUrl}/old`, { redirect: 'manual' });
    expect([moved.status, moved.headers.get('location')]).toEqual([302, '/parks']);
    expect((await fetch(`${server.baseUrl}/nowhere`)).status).toBe(404);
    const broken = await fetch(`${server.baseUrl}/broken`);
    expect(broken.status).toBe(500);
    await expect(broken.text()).resolves.toBe('the site broke');
  });

  it("tells the site what made the request, from the browser's Sec-Fetch-Dest", async () => {
    seen.length = 0;
    await fetch(`${server.baseUrl}/api/nights`, { headers: { 'Sec-Fetch-Dest': 'empty' } });
    await fetch(`${server.baseUrl}/parks`, { headers: { 'Sec-Fetch-Dest': 'document' } });
    expect(seen.map(({ request, status }) => [request.resourceType, status])).toEqual([
      ['fetch', 200],
      ['document', 200],
    ]);
    expect(seen[0].request.url.href).toBe(`${server.baseUrl}/api/nights`);
  });
});
