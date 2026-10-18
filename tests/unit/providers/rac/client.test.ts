/**
 * The RAC client (`src/main/providers/rac/client.ts`), on a recording HTTP client that never
 * sends anything: RAC's host only, redirects by hand on that host only, the headers RAC's own
 * pages send and never a User-Agent, one request at a time (a page may wait in its turn for
 * what it is `ready` on, and is sent only if that resolves), and the block: a 403, a 429 or
 * Cloudflare's challenge rejects with a non-retryable `ProviderHttpError` (403 or 429) and stops
 * every request for 30 minutes, kept in the provider's state; a 5xx does not. Blocks in a row
 * double the cool-down up to a day, and a longer `Retry-After` is honoured, up to a day.
 */

import {
  InMemoryKeyValueStore,
  isAbortError,
  ProviderHttpError,
  type HopRequest,
} from '@main/providers/sdk';
import {
  isChallengePage,
  RAC_BLOCK_COOLDOWN_MS,
  RAC_BLOCK_STATE_KEY,
  RAC_MAX_BLOCK_COOLDOWN_MS,
  RAC_MAX_REDIRECTS,
  RacClient,
  retryAfterMs,
} from '@main/providers/rac/client';
import { RAC_AVAILABILITY_PATH } from '@main/providers/rac/cart-guard';
import { createMemoryLogger, type MemoryLogger } from '@tests/utils/fake-provider';
import { RecordingHttpClient, type HopAnswer } from '@tests/utils/fake-paced-provider';

const RAC = 'https://parksandresorts.rac.com.au';
/** The one form the client may post outside the cart (`cart-guard.ts`): RAC's availability. */
const AJAX = RAC_AVAILABILITY_PATH;
const BOOK_NOW = `${RAC}/busselton/book-now/`;
const PAGE = '<html><body><div class="accommodation-item" data-cat-id="4"></div></body></html>';
/** 3:15 pm in Perth (UTC+8). */
const START = new Date('2026-10-17T07:15:00.000Z');

let now: Date;
let state: InMemoryKeyValueStore;
let logger: MemoryLogger;
let http: RecordingHttpClient;

function makeClient(respond?: (hop: HopRequest) => HopAnswer): RacClient {
  http = new RecordingHttpClient({
    providerId: 'rac',
    respond: respond ?? (() => ({ body: PAGE, headers: { 'content-type': 'text/html' } })),
  });
  return new RacClient({
    providerId: 'rac',
    providerName: 'RAC Parks & Resorts',
    http,
    state,
    logger,
    clock: () => now,
    timezone: 'Australia/Perth',
    maxConcurrent: 1,
  });
}

/** What `pending` rejected with. */
async function failure(pending: Promise<unknown>): Promise<ProviderHttpError> {
  const error = await pending.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(ProviderHttpError);
  return error as ProviderHttpError;
}

beforeEach(() => {
  now = START;
  state = new InMemoryKeyValueStore();
  logger = createMemoryLogger();
});

describe('RacClient: host and headers', () => {
  it('GETs a page on RAC asking for HTML, and never sets a User-Agent', async () => {
    const client = makeClient();
    const page = await client.getPage('/busselton/book-now/');
    expect(page).toEqual({
      status: 200,
      url: BOOK_NOW,
      contentType: 'text/html',
      body: PAGE,
    });
    expect(http.requests).toHaveLength(1);
    expect(http.requests[0].method).toBe('GET');
    expect(http.requests[0].url).toBe(BOOK_NOW);
    expect(http.requests[0].headers).toEqual({ accept: 'text/html' });
  });

  it("POSTs an AJAX form as RAC's own page does: X-Requested-With, Origin and Referer", async () => {
    const client = makeClient();
    await client.postAjax(
      '/wp-content/themes/parks-and-resorts/template-parts/components/booking-engine/availability-ajax.php',
      { blog_id: 6, adults: 2, skipped: undefined },
      { referer: BOOK_NOW }
    );
    const [request] = http.requests;
    expect(request.method).toBe('POST');
    expect(request.url).toBe(
      `${RAC}/wp-content/themes/parks-and-resorts/template-parts/components/booking-engine/availability-ajax.php`
    );
    expect(request.body).toBe('blog_id=6&adults=2');
    expect(request.headers).toMatchObject({
      'x-requested-with': 'XMLHttpRequest',
      origin: RAC,
      referer: BOOK_NOW,
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    });
    expect(Object.keys(request.headers)).not.toContain('user-agent');
  });

  it.each([
    'https://driveau.newbook.cloud/crop_800_450/a.jpg',
    'https://apiau.newbook.cloud/cc_secure/1230',
    'http://parksandresorts.rac.com.au/busselton/',
    'https://parksandresorts.rac.com.au.example.com/',
    '//rac.example/',
  ])('refuses %s and sends nothing', async (address) => {
    const client = makeClient();
    const error = await failure(client.getPage(address));
    expect(error.reason).toBe('blocked');
    expect(error.retryable).toBe(false);
    expect(http.requests).toHaveLength(0);
  });

  it('follows redirects on RAC by hand, at most 3', async () => {
    const client = makeClient((hop) =>
      hop.url.endsWith('/busselton/book-now')
        ? { status: 301, headers: { location: '/busselton/book-now/' } }
        : { body: PAGE }
    );
    const page = await client.getPage('/busselton/book-now');
    expect(page.url).toBe(BOOK_NOW);
    expect(http.hops.map((hop) => hop.url)).toEqual([`${RAC}/busselton/book-now`, BOOK_NOW]);

    let hops = 0;
    const looping = makeClient(() => ({
      status: 302,
      headers: { location: `/loop/${++hops}/` },
    }));
    const error = await failure(looping.getPage('/loop/0/'));
    expect(error.reason).toBe('redirect-limit');
    expect(http.hops).toHaveLength(RAC_MAX_REDIRECTS + 1);
  });

  it('refuses a redirect to another host, and never sends it', async () => {
    const client = makeClient((hop) =>
      hop.url.startsWith(RAC)
        ? { status: 302, headers: { location: 'https://apiau.newbook.cloud/cc_secure/1230' } }
        : { body: 'sent' }
    );
    const error = await failure(client.getPage('/busselton/book-now/'));
    expect(error.reason).toBe('blocked');
    expect(http.hops.map((hop) => new URL(hop.url).host)).toEqual(['parksandresorts.rac.com.au']);
  });

  it('turns a POST into a GET on a 302, as browsers do', async () => {
    const client = makeClient((hop) =>
      hop.method === 'POST' ? { status: 302, headers: { location: '/done/' } } : { body: '{}' }
    );
    await client.postAjax(AJAX, { a: 1 }, { referer: BOOK_NOW });
    expect(http.hops.map((hop) => [hop.method, hop.url, hop.body])).toEqual([
      ['POST', `${RAC}${AJAX}`, 'a=1'],
      ['GET', `${RAC}/done/`, undefined],
    ]);
    expect(http.hops[1].headers.get('content-type')).toBeNull();
  });

  it('says once that an AJAX POST was sent, redirects included, and never for one called off while it waits', async () => {
    const client = makeClient((hop) =>
      hop.method === 'POST'
        ? { status: 302, headers: { location: '/done/' }, delayMs: 20 }
        : { body: '{}' }
    );
    const onSend = jest.fn();
    const first = client.postAjax(AJAX, { a: 1 }, { referer: BOOK_NOW, onSend });
    const controller = new AbortController();
    const waiting = jest.fn();
    const second = client.postAjax(
      AJAX,
      { a: 2 },
      { referer: BOOK_NOW, signal: controller.signal, onSend: waiting }
    );
    controller.abort();
    expect(isAbortError(await second.catch((e: unknown) => e))).toBe(true);
    await first;
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(waiting).not.toHaveBeenCalled();
    expect(http.hops).toHaveLength(2);
  });

  it('sends one request at a time', async () => {
    const client = makeClient();
    await Promise.all([client.getPage('/a/'), client.getPage('/b/'), client.getPage('/c/')]);
    expect(http.requests).toHaveLength(3);
    expect(http.peakInFlight).toBe(1);
  });

  it('rejects a request aborted while it waits for the one before it, and never sends it', async () => {
    const client = makeClient((hop) => ({ body: PAGE, delayMs: hop.url.endsWith('/a/') ? 50 : 0 }));
    const first = client.getPage('/a/');
    const controller = new AbortController();
    const second = client.getPage('/b/', { signal: controller.signal });
    controller.abort();
    expect(isAbortError(await second.catch((e: unknown) => e))).toBe(true);
    await first;
    expect(http.requests.map((r) => r.url)).toEqual([`${RAC}/a/`]);
  });

  it('honours an aborted signal before anything is sent', async () => {
    const client = makeClient();
    const controller = new AbortController();
    controller.abort();
    const error = await client.getPage('/a/', { signal: controller.signal }).catch((e) => e);
    expect(isAbortError(error)).toBe(true);
    expect(http.requests).toHaveLength(0);
  });

  it('waits for what a page is ready on in its turn, keeping its place, and sends it only if that resolves', async () => {
    const client = makeClient((hop) => ({ body: PAGE, delayMs: hop.url.endsWith('/a/') ? 20 : 0 }));
    const order: string[] = [];
    const first = client.getPage('/a/');
    // Ready once /a/ has answered: asked only when its turn comes, after /a/
    const second = client.getPage('/b/', {
      ready: async () => {
        order.push(`ready after ${http.requests.length} sent`);
        await first;
      },
    });
    const third = client.getPage('/c/');
    await Promise.all([first, second, third]);
    expect(order).toEqual(['ready after 1 sent']);
    expect(http.requests.map((r) => r.url)).toEqual([`${RAC}/a/`, `${RAC}/b/`, `${RAC}/c/`]);
    expect(http.peakInFlight).toBe(1);
  });

  it('sends nothing for a page whose ready rejects, rejecting with its error; the next one goes on', async () => {
    const client = makeClient();
    const refused = new Error('the categories were not read');
    const page = client.getPage('/b/', { ready: () => Promise.reject(refused) });
    const next = client.getPage('/c/');
    expect(await page.catch((e: unknown) => e)).toBe(refused);
    await next;
    expect(http.requests.map((r) => r.url)).toEqual([`${RAC}/c/`]);
  });

  it('sends nothing for a page aborted while it waits on ready', async () => {
    const client = makeClient();
    const controller = new AbortController();
    let release!: () => void;
    const page = client.getPage('/b/', {
      signal: controller.signal,
      ready: () => new Promise<void>((resolve) => (release = resolve)),
    });
    await Promise.resolve();
    controller.abort();
    expect(isAbortError(await page.catch((e: unknown) => e))).toBe(true);
    release();
    await client.getPage('/c/');
    expect(http.requests.map((r) => r.url)).toEqual([`${RAC}/c/`]);
  });
});

describe('RacClient: a block', () => {
  const blocked = (answer: HopAnswer) => () => answer;

  it.each<[string, HopAnswer, number]>([
    ['a 403', { status: 403, body: 'Access denied' }, 403],
    ['a 429', { status: 429, body: 'Too many requests' }, 429],
    ['a challenge as a 503', { status: 503, body: '<title>Just a moment...</title>' }, 403],
    ['a challenge as a 200 page', { status: 200, body: '<title>Just a moment...</title>' }, 403],
    [
      "a 200 with Cloudflare's challenge settings",
      { status: 200, body: '<script>window._cf_chl_opt={cvId: "3"}</script>' },
      403,
    ],
    [
      'a cf-mitigated: challenge header',
      { status: 200, headers: { 'cf-mitigated': 'challenge' } },
      403,
    ],
  ])('%s rejects with a non-retryable ProviderHttpError, status %d', async (_, answer, status) => {
    const client = makeClient(blocked(answer));
    const error = await failure(client.getPage('/busselton/book-now/'));
    expect(error.status).toBe(status);
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(
      /^RAC Parks & Resorts turned the request away \((HTTP 4\d\d|a security check)\)\. WA Stay won't ask again until 3:45 pm\.$/
    );
    expect(await state.get(RAC_BLOCK_STATE_KEY)).toMatchObject({
      until: '2026-10-17T07:45:00.000Z',
      status,
    });
  });

  it('says which status, in plain words, with the time in Perth', async () => {
    const client = makeClient(blocked({ status: 429 }));
    const error = await failure(client.getPage('/busselton/book-now/'));
    expect(error.message).toBe(
      "RAC Parks & Resorts turned the request away (HTTP 429). WA Stay won't ask again until 3:45 pm."
    );
  });

  it('gives the time in Perth after midnight too', async () => {
    // 11:50 pm in Perth: the cool-down ends at 12:20 am
    now = new Date('2026-10-17T15:50:00.000Z');
    const client = makeClient(blocked({ status: 403 }));
    const error = await failure(client.getPage('/busselton/book-now/'));
    expect(error.message).toBe(
      "RAC Parks & Resorts turned the request away (HTTP 403). WA Stay won't ask again until 12:20 am."
    );
  });

  it('sends nothing for 30 minutes, rejecting the same way, then asks again', async () => {
    let answer: HopAnswer = { status: 429 };
    const client = makeClient(() => answer);
    const first = await failure(client.getPage('/busselton/book-now/?arrival=2026-11-10'));
    expect(http.requests).toHaveLength(1);

    answer = { body: PAGE };
    now = new Date(START.getTime() + RAC_BLOCK_COOLDOWN_MS - 1_000);
    const second = await failure(client.getPage('/margaret-river/book-now/'));
    expect(http.requests).toHaveLength(1);
    expect(second.status).toBe(429);
    expect(second.retryable).toBe(false);
    expect(second.message).toBe(first.message);
    // An AJAX call too
    await failure(client.postAjax(AJAX, { a: 1 }, { referer: BOOK_NOW }));
    expect(http.requests).toHaveLength(1);

    now = new Date(START.getTime() + RAC_BLOCK_COOLDOWN_MS);
    await expect(client.getPage('/margaret-river/book-now/')).resolves.toMatchObject({
      status: 200,
    });
    expect(http.requests).toHaveLength(2);
  });

  it('keeps the cool-down in the state, so a new client (a restart) is still blocked', async () => {
    await failure(makeClient(blocked({ status: 403 })).getPage('/busselton/book-now/'));
    now = new Date(START.getTime() + 10 * 60_000);
    const restarted = makeClient();
    const error = await failure(restarted.getPage('/busselton/book-now/'));
    expect(error.status).toBe(403);
    expect(http.requests).toHaveLength(0);
  });

  it('counts a cool-down more than 30 minutes ahead (the clock was set back) as 30 minutes from now', async () => {
    await failure(makeClient(blocked({ status: 429 })).getPage('/busselton/book-now/'));
    // The clock goes back 2 hours: the stored end is 2.5 hours away
    now = new Date(START.getTime() - 2 * 60 * 60_000);
    const client = makeClient();
    const error = await failure(client.getPage('/busselton/book-now/'));
    expect(error.message).toMatch(/until 1:45 pm\.$/);
    now = new Date(now.getTime() + RAC_BLOCK_COOLDOWN_MS);
    await expect(client.getPage('/busselton/book-now/')).resolves.toMatchObject({ status: 200 });
  });

  it('logs one warning per block, with the status and never the query or the answer', async () => {
    const client = makeClient(blocked({ status: 429, body: 'secret-body' }));
    await failure(client.getPage('/busselton/book-now/', { query: { adults: 2, code: 'Q1' } }));
    await failure(client.getPage('/busselton/book-now/', { query: { adults: 2, code: 'Q1' } }));
    const warnings = logger.lines.filter((line) => line.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('HTTP 429');
    const logged = JSON.stringify(logger.lines);
    for (const secret of ['adults', 'code=', 'Q1', 'secret-body', '?']) {
      expect(logged).not.toContain(secret);
    }
  });

  it("does not take a normal page's bot detection script for a challenge", async () => {
    const page =
      '<html><head><title>Book now</title></head><body>' +
      "<script>a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';</script>" +
      '<div class="accommodation-item" data-cat-id="4"></div></body></html>';
    expect(isChallengePage(page)).toBe(false);
    const client = makeClient(() => ({ body: page }));
    await expect(client.getPage('/busselton/book-now/')).resolves.toMatchObject({ status: 200 });
    expect(await state.get(RAC_BLOCK_STATE_KEY)).toBeUndefined();
  });

  it.each([500, 502, 503, 520])('a %d is a retryable error with no cool-down', async (status) => {
    let answer: HopAnswer = { status, body: 'Web server is returning an unknown error' };
    const client = makeClient(() => answer);
    const error = await failure(client.getPage('/busselton/book-now/'));
    expect(error.status).toBe(status);
    expect(error.retryable).toBe(true);
    expect(await state.get(RAC_BLOCK_STATE_KEY)).toBeUndefined();
    answer = { body: PAGE };
    await expect(client.getPage('/busselton/book-now/')).resolves.toMatchObject({ status: 200 });
  });

  it('a 404 is a plain status error, not a block', async () => {
    const client = makeClient(() => ({ status: 404 }));
    const error = await failure(client.getPage('/ningaloo/book-now/'));
    expect([error.status, error.retryable, error.reason]).toEqual([404, false, 'status']);
    expect(await state.get(RAC_BLOCK_STATE_KEY)).toBeUndefined();
  });

  it('ignores a stored cool-down it cannot read', async () => {
    await state.set(RAC_BLOCK_STATE_KEY, { until: 'tomorrow', status: 418 });
    await expect(makeClient().getPage('/busselton/book-now/')).resolves.toMatchObject({
      status: 200,
    });
  });
});

describe('RacClient: blocks in a row and Retry-After', () => {
  const HOUR = 60 * 60_000;

  /** Moves the clock to `at` ms after START, sends one page request, and returns its error. */
  async function blockedAt(client: RacClient, at: number): Promise<ProviderHttpError> {
    now = new Date(START.getTime() + at);
    return failure(client.getPage('/busselton/book-now/'));
  }

  it('doubles the cool-down for each block after the last one ends, up to a day', async () => {
    const client = makeClient(() => ({ status: 403 }));
    let at = 0;
    const lengths: number[] = [];
    for (let block = 0; block < 8; block++) {
      await blockedAt(client, at);
      const stored = (await state.get(RAC_BLOCK_STATE_KEY)) as { until: string };
      const length = Date.parse(stored.until) - (START.getTime() + at);
      lengths.push(length / 60_000);
      // Nothing is sent a minute before it ends
      const sent = http.requests.length;
      await blockedAt(client, at + length - 60_000);
      expect(http.requests).toHaveLength(sent);
      at += length;
    }
    expect(lengths).toEqual([30, 60, 120, 240, 480, 960, 1440, 1440]);
    expect(http.requests).toHaveLength(8);
  });

  it('a successful answer ends the run: the next block is 30 minutes again', async () => {
    let answer: HopAnswer = { status: 429 };
    const client = makeClient(() => answer);
    await blockedAt(client, 0);
    await blockedAt(client, RAC_BLOCK_COOLDOWN_MS);
    expect((await state.get(RAC_BLOCK_STATE_KEY)) as object).toMatchObject({ strikes: 2 });
    answer = { body: PAGE };
    now = new Date(START.getTime() + RAC_BLOCK_COOLDOWN_MS + HOUR);
    await expect(client.getPage('/busselton/book-now/')).resolves.toMatchObject({ status: 200 });
    expect(await state.get(RAC_BLOCK_STATE_KEY)).toBeUndefined();
    answer = { status: 429 };
    const error = await blockedAt(client, RAC_BLOCK_COOLDOWN_MS + HOUR + 60_000);
    // 3:15 pm + 1 h 31 min = 4:46 pm, then 30 minutes
    expect(error.message).toMatch(/until 5:16 pm\.$/);
  });

  it('a 5xx between blocks does not end the run', async () => {
    let answer: HopAnswer = { status: 403 };
    const client = makeClient(() => answer);
    await blockedAt(client, 0);
    answer = { status: 520 };
    now = new Date(START.getTime() + RAC_BLOCK_COOLDOWN_MS);
    await failure(client.getPage('/busselton/book-now/'));
    answer = { status: 403 };
    await blockedAt(client, RAC_BLOCK_COOLDOWN_MS + 60_000);
    expect((await state.get(RAC_BLOCK_STATE_KEY)) as object).toMatchObject({
      strikes: 2,
      durationMs: HOUR,
    });
  });

  it('a block more than a day after the last one ended starts a new run', async () => {
    const client = makeClient(() => ({ status: 403 }));
    await blockedAt(client, 0);
    await blockedAt(client, RAC_BLOCK_COOLDOWN_MS + RAC_MAX_BLOCK_COOLDOWN_MS + 60_000);
    expect((await state.get(RAC_BLOCK_STATE_KEY)) as object).toMatchObject({
      strikes: 1,
      durationMs: RAC_BLOCK_COOLDOWN_MS,
    });
  });

  it.each<[string, string, number]>([
    ['seconds', '7200', 2 * HOUR],
    ['an HTTP date', 'Sat, 17 Oct 2026 12:15:00 GMT', 5 * HOUR],
    ['more than a day', String(3 * 24 * 3600), RAC_MAX_BLOCK_COOLDOWN_MS],
    ['less than the cool-down', '120', RAC_BLOCK_COOLDOWN_MS],
    ['nothing it can read', 'soon', RAC_BLOCK_COOLDOWN_MS],
  ])('honours a Retry-After of %s when it asks for longer, up to a day', async (_, value, ms) => {
    const client = makeClient(() => ({ status: 429, headers: { 'retry-after': value } }));
    await failure(client.getPage('/busselton/book-now/'));
    const stored = (await state.get(RAC_BLOCK_STATE_KEY)) as { until: string };
    expect(Date.parse(stored.until) - START.getTime()).toBe(ms);
    // Nothing is sent until it ends
    now = new Date(START.getTime() + ms - 1_000);
    await failure(client.getPage('/busselton/book-now/'));
    expect(http.requests).toHaveLength(1);
  });

  it('names the day when a longer cool-down ends on another day in Perth', async () => {
    const client = makeClient(() => ({ status: 429, headers: { 'retry-after': '64800' } }));
    const error = await failure(client.getPage('/busselton/book-now/'));
    // 3:15 pm + 18 hours: 9:15 am the next day
    expect(error.message).toBe(
      "RAC Parks & Resorts turned the request away (HTTP 429). WA Stay won't ask again until 9:15 am on Sun 18 Oct."
    );
    expect(logger.lines.filter((line) => line.level === 'warn')[0].message).toBe(
      'Turned away (HTTP 429); no requests for 18 hours'
    );
  });

  it('cuts a longer cool-down that ends further ahead than its length (the clock went back) to its length', async () => {
    const client = makeClient(() => ({ status: 403 }));
    await blockedAt(client, 0);
    await blockedAt(client, RAC_BLOCK_COOLDOWN_MS);
    // A 1-hour cool-down from 3:45 pm; the clock goes back 3 hours
    const error = await blockedAt(client, -3 * HOUR);
    expect(error.message).toMatch(/until 1:15 pm\.$/);
  });

  it('reads Retry-After as seconds or a date, and nothing else', () => {
    const at = START.getTime();
    expect(retryAfterMs('30', at)).toBe(30_000);
    expect(retryAfterMs(' 0 ', at)).toBe(0);
    expect(retryAfterMs('Sat, 17 Oct 2026 07:16:00 GMT', at)).toBe(60_000);
    expect(retryAfterMs('Sat, 17 Oct 2026 07:00:00 GMT', at)).toBe(0);
    expect(retryAfterMs(null, at)).toBeUndefined();
    expect(retryAfterMs('', at)).toBeUndefined();
    expect(retryAfterMs('-5', at)).toBeUndefined();
    expect(retryAfterMs('later', at)).toBeUndefined();
  });

  it('reads a cool-down kept before its length was stored as 30 minutes', async () => {
    await state.set(RAC_BLOCK_STATE_KEY, {
      until: new Date(START.getTime() + 20 * 60_000).toISOString(),
      status: 403,
      cause: 'status',
    });
    const client = makeClient(() => ({ status: 403 }));
    await failure(client.getPage('/busselton/book-now/'));
    expect(http.requests).toHaveLength(0);
    // After it, the next block is the second in a row
    await blockedAt(client, 20 * 60_000);
    expect((await state.get(RAC_BLOCK_STATE_KEY)) as object).toMatchObject({ strikes: 2 });
  });

  it('ignores a stored cool-down with a length or a count it cannot read', async () => {
    for (const bad of [
      { durationMs: -1 },
      { durationMs: 2 * RAC_MAX_BLOCK_COOLDOWN_MS },
      { strikes: 0 },
    ]) {
      await state.set(RAC_BLOCK_STATE_KEY, {
        until: new Date(START.getTime() + 20 * 60_000).toISOString(),
        status: 403,
        cause: 'status',
        ...bad,
      });
      await expect(makeClient().getPage('/busselton/book-now/')).resolves.toMatchObject({
        status: 200,
      });
    }
  });
});
