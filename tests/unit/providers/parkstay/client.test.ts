/**
 * The ParkStay client: dates, browser headers, the DBCA queue interstitial (a 200 HTML page
 * or a redirect to the waiting room), HTTP errors, the concurrency cap, and the links.
 */

import {
  isQueueInterstitial,
  ParkStayClient,
  toParkStayDate,
} from '@main/providers/parkstay/client';
import { parkstayApiHeaders, queueApiHeaders } from '@main/providers/parkstay/headers';
import { parkstayLinks } from '@main/providers/parkstay/links';
import {
  AccessGateError,
  CHROME_USER_AGENT,
  isAbortError,
  NodeHttpClient,
  ProviderHttpError,
  ProviderParseError,
} from '@main/providers/sdk';
import {
  readParkStayFixture,
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '@tests/utils/parkstay-fixture-server';
import { BUNGARRA_STAY, createTestParkStay } from '@tests/utils/parkstay-provider';

describe('toParkStayDate', () => {
  it('turns a calendar date into ParkStay’s YYYY/MM/DD', () => {
    expect(toParkStayDate('2026-11-10')).toBe('2026/11/10');
    expect(toParkStayDate('2027-01-01')).toBe('2027/01/01');
  });

  it('is a string transform: no time-zone shift at midnight boundaries', () => {
    // A `Date` round trip in a UTC-negative zone would give 2026/12/31.
    expect(toParkStayDate('2027-01-01')).not.toContain('2026');
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(() => toParkStayDate('2026/11/10')).toThrow(RangeError);
    expect(() => toParkStayDate('10-11-2026')).toThrow(RangeError);
    expect(() => toParkStayDate('')).toThrow(RangeError);
  });
});

describe('ParkStay headers', () => {
  it('present the Chrome user agent and the ParkStay Referer, never a library default', () => {
    for (const headers of [
      parkstayApiHeaders('GET'),
      parkstayApiHeaders('POST'),
      queueApiHeaders(),
    ]) {
      expect(headers['User-Agent']).toBe(CHROME_USER_AGENT);
      expect(headers['User-Agent']).toMatch(/Chrome\/\d+/);
      expect(headers['User-Agent']).not.toMatch(/axios|python|curl|java|httpclient|node/i);
      expect(headers.Referer).toBe('https://parkstay.dbca.wa.gov.au/');
    }
  });

  it('add Origin to a POST only (as Chrome does for same-origin), and to cross-site queue calls', () => {
    expect(parkstayApiHeaders('GET').Origin).toBeUndefined();
    expect(parkstayApiHeaders('POST').Origin).toBe('https://parkstay.dbca.wa.gov.au');
    expect(queueApiHeaders().Origin).toBe('https://parkstay.dbca.wa.gov.au');
  });

  it('leave the Sec-Fetch-* headers to Chromium (setting Sec-Fetch-Mode fails the request)', () => {
    for (const headers of [
      parkstayApiHeaders('GET'),
      parkstayApiHeaders('POST'),
      queueApiHeaders(),
    ]) {
      expect(Object.keys(headers).filter((name) => /^sec-fetch-/i.test(name))).toEqual([]);
    }
  });
});

describe('isQueueInterstitial', () => {
  const page = readParkStayFixture('queue-interstitial.html');

  it('recognises the queue middleware’s redirect page', () => {
    expect(isQueueInterstitial('text/html; charset=utf-8', page)).toBe(true);
  });

  it('ignores JSON, and HTML without the redirect script', () => {
    expect(isQueueInterstitial('application/json', page)).toBe(false);
    expect(isQueueInterstitial('text/html', '<p>Hello</p>')).toBe(false);
    expect(isQueueInterstitial(null, page)).toBe(false);
  });
});

describe('ParkStayClient against the fixture server', () => {
  let server: ParkStayFixtureServer;

  beforeEach(async () => {
    server = await startParkStayFixtureServer();
  });

  afterEach(async () => {
    await server.close();
  });

  function client(maxConcurrent = 4): ParkStayClient {
    return new ParkStayClient(
      new NodeHttpClient({ providerId: 'parkstay' }),
      'parkstay',
      server.endpoints,
      maxConcurrent
    );
  }

  it('sends the Chrome user agent and the ParkStay Referer on API calls', async () => {
    await client().getApi('/campground_map/');
    const [request] = server.requests;
    expect(request.headers['user-agent']).toBe(CHROME_USER_AGENT);
    expect(request.headers.referer).toBe('https://parkstay.dbca.wa.gov.au/');
    expect(request.headers.origin).toBeUndefined();
  });

  it.each([
    ['a 200 text/html redirect page', 'html' as const],
    ['a redirect to the waiting room', 'redirect' as const],
  ])('rejects %s on any /api/ call with AccessGateError (waiting)', async (_name, gate) => {
    server.queueGate = gate;
    const { provider } = createTestParkStay(server);
    const calls = [
      () => provider.catalog.listLocations!(),
      () => provider.availability.check('20', BUNGARRA_STAY),
      () => provider.availability.search(BUNGARRA_STAY),
      () => provider.holds.create({ externalId: '20', unitId: '3', stay: BUNGARRA_STAY }),
    ];
    for (const call of calls) {
      const error = await call().then(
        () => undefined,
        (e: unknown) => e
      );
      expect(error).toBeInstanceOf(AccessGateError);
      expect(error).toMatchObject({ state: 'waiting', code: 'access-gate' });
      // Never a JSON parse error.
      expect(error).not.toBeInstanceOf(ProviderParseError);
    }
  });

  it('turns HTTP 500 into ProviderHttpError with a hint about dates and the Referer', async () => {
    server.overrides.set('/api/campground_map/', { status: 500, body: {} });
    await expect(client().getApi('/campground_map/')).rejects.toMatchObject({
      name: 'ProviderHttpError',
      status: 500,
      message: expect.stringContaining('YYYY/MM/DD'),
    });
    await expect(client().getApi('/campground_map/')).rejects.toBeInstanceOf(ProviderHttpError);
  });

  it('turns HTTP 429 into a retryable ProviderHttpError with status 429, for a GET and a form POST', async () => {
    const throttled = { status: 429, body: { detail: 'Request was throttled.' } };
    server.overrides.set('/api/campground_map/', throttled);
    await expect(client().getApi('/campground_map/')).rejects.toMatchObject({
      name: 'ProviderHttpError',
      status: 429,
      retryable: true,
    });
    // A rate limit on create_booking is not a refusal (which would read as "taken").
    server.createBooking = throttled;
    await expect(
      client().postApiForm('/create_booking', { arrival: '2026/11/10' })
    ).rejects.toMatchObject({ name: 'ProviderHttpError', status: 429, retryable: true });
  });

  it('turns HTTP 408 into a retryable ProviderHttpError with status 408, for a form POST too', async () => {
    const timedOut = { status: 408, body: { detail: 'Request timed out.' } };
    server.overrides.set('/api/campground_map/', timedOut);
    await expect(client().getApi('/campground_map/')).rejects.toMatchObject({
      name: 'ProviderHttpError',
      status: 408,
      retryable: true,
    });
    // A timeout on create_booking is not a refusal either.
    server.createBooking = timedOut;
    await expect(
      client().postApiForm('/create_booking', { arrival: '2026/11/10' })
    ).rejects.toMatchObject({ name: 'ProviderHttpError', status: 408, retryable: true });
  });

  it('turns a body that is not JSON into ProviderParseError', async () => {
    server.overrides.set('/api/campground_map/', { status: 200, body: undefined });
    // JSON.stringify(undefined) sends an empty body.
    await expect(client().getApi('/campground_map/')).rejects.toBeInstanceOf(ProviderParseError);
  });

  it('reads a 400 JSON answer to a form POST and sends Origin with it', async () => {
    server.createBooking = { status: 400, body: { status: 'error', msg: 'nope' } };
    const answer = await client().postApiForm('/create_booking', { arrival: '2026/11/10' });
    expect(answer).toEqual({ status: 400, body: { status: 'error', msg: 'nope' } });
    const post = server.requestsTo('/api/create_booking')[0];
    expect(post.headers.origin).toBe('https://parkstay.dbca.wa.gov.au');
    expect(post.headers['content-type']).toMatch(/application\/x-www-form-urlencoded/);
    expect(post.body).toBe('arrival=2026%2F11%2F10');
  });

  it('never has more than 4 requests in flight, however many are asked for', async () => {
    server.delayMs = 40;
    const c = client(4);
    const pending = Array.from({ length: 10 }, () => c.getApi('/campground_availabilty_view/'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(c.activeCount).toBeLessThanOrEqual(4);
    expect(c.pendingCount).toBe(6);
    await Promise.all(pending);
    expect(server.requests).toHaveLength(10);
    expect(server.maxInFlight).toBe(4);
  });

  it('shares the cap across the whole module: a snipe poll, a search and the queue', async () => {
    server.delayMs = 40;
    const { provider } = createTestParkStay(server);
    await Promise.all([
      ...Array.from({ length: 3 }, () => provider.availability.check('20', BUNGARRA_STAY)),
      ...Array.from({ length: 3 }, () => provider.availability.search(BUNGARRA_STAY)),
      provider.access.ensure(),
      provider.catalog.listLocations!(),
    ]);
    expect(server.maxInFlight).toBeLessThanOrEqual(4);
  });

  it('releases a caller that aborts while waiting for a slot', async () => {
    server.delayMs = 100;
    const c = client(1);
    const first = c.getApi('/campground_map/');
    const controller = new AbortController();
    const second = c.getApi('/campground_map/', { signal: controller.signal });
    controller.abort();
    const error = await second.catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    await first;
    // The aborted call never reached the server.
    expect(server.requests).toHaveLength(1);
  });
});

describe('ParkStay links', () => {
  const INFO = 'https://parkstay.dbca.wa.gov.au/search-availability/information/';
  const STAY = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };

  it('links a campground to the search page with it preselected', () => {
    expect(parkstayLinks.location('20')).toBe(`${INFO}?campground_id=20`);
    expect(parkstayLinks.booking('20')).toBe(parkstayLinks.location('20'));
  });

  it('adds a stay’s dates in ParkStay’s form, and never the guests the page ignores', () => {
    expect(parkstayLinks.booking('20', STAY)).toBe(
      `${INFO}?campground_id=20&arrival=2026/11/10&departure=2026/11/12`
    );
    expect(parkstayLinks.booking('20', { ...STAY, adults: 4, children: 2, infants: 1 })).toBe(
      parkstayLinks.booking('20', STAY)
    );
  });

  it('never sends site_id to the campground page, which refuses requests without its Referer', () => {
    const links = [
      parkstayLinks.location('20'),
      parkstayLinks.location('43'),
      parkstayLinks.booking('20'),
      parkstayLinks.booking('43', STAY),
    ];
    for (const link of links) {
      const url = new URL(link!);
      expect(url.pathname).toBe('/search-availability/information/');
      expect(url.searchParams.has('site_id')).toBe(false);
      expect(link).not.toContain('/search-availability/campground/');
    }
  });

  it('sends people to My Bookings to manage a booking', () => {
    expect(parkstayLinks.manageBooking!('PS123')).toBe(
      'https://parkstay.dbca.wa.gov.au/mybookings/'
    );
  });

  it('escapes the campground id', () => {
    expect(parkstayLinks.location('a&b')).toBe(`${INFO}?campground_id=a%26b`);
  });
});
