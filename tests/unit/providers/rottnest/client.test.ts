/**
 * The Stay Rottnest client (`src/main/providers/rottnest/client.ts`), on a recording HTTP client
 * that never sends anything. Its rules are the terms review's §9 (`ai-state/research/
 * rottnest-terms.md`): only `GET /rates-room1` with the search's own fields; no redirect
 * followed; a 403, 429, Cloudflare challenge or waiting room rejects with a non-retryable
 * `ProviderHttpError` (403 or 429) and stops every request for 12 hours, doubling to 7 days,
 * kept in the provider's state; nothing on an Open Day morning.
 */

import {
  InMemoryKeyValueStore,
  isProviderBlock,
  ProviderError,
  ProviderHttpError,
  type HopRequest,
} from '@main/providers/sdk';
import {
  isChallengePage,
  isWaitingRoom,
  retryAfterMs,
  ROTTNEST_BLOCK_COOLDOWN_MS,
  ROTTNEST_BLOCK_STATE_KEY,
  ROTTNEST_MAX_BLOCK_COOLDOWN_MS,
  RottnestClient,
} from '@main/providers/rottnest/client';
import type { StayQuery } from '@shared/types/provider.types';
import { createMemoryLogger, type MemoryLogger } from '@tests/utils/fake-provider';
import { RecordingHttpClient, type HopAnswer } from '@tests/utils/fake-paced-provider';

const PAGE =
  '<html><body><div class="room-and-rates" room-calendar-root="GPV04"></div></body></html>';
const STAY: StayQuery = { arrival: '2027-06-28', departure: '2027-07-01', adults: 2, children: 1 };
/** 3:15 pm in Perth (UTC+8) on a Saturday: not an Open Day. */
const START = new Date('2026-10-17T07:15:00.000Z');
const HOUR = 60 * 60_000;

let now: Date;
let state: InMemoryKeyValueStore;
let logger: MemoryLogger;
let http: RecordingHttpClient;

function makeClient(respond?: (hop: HopRequest) => HopAnswer): RottnestClient {
  http = new RecordingHttpClient({
    providerId: 'rottnest',
    respond: respond ?? (() => ({ body: PAGE, headers: { 'content-type': 'text/html' } })),
  });
  return new RottnestClient({
    providerId: 'rottnest',
    providerName: 'Stay Rottnest',
    http,
    state,
    logger,
    clock: () => now,
    maxConcurrent: 1,
  });
}

async function failure<T extends Error>(pending: Promise<unknown>, type: new (...a: never[]) => T) {
  const error = await pending.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(type);
  return error as T;
}

beforeEach(() => {
  now = START;
  state = new InMemoryKeyValueStore();
  logger = createMemoryLogger();
});

describe('RottnestClient: the one request', () => {
  it('GETs the results page with exactly the search form fields, asking for HTML', async () => {
    const client = makeClient();
    const page = await client.search(STAY);
    expect(page.body).toBe(PAGE);
    expect(http.requests).toHaveLength(1);
    const sent = http.requests[0];
    expect(sent.method).toBe('GET');
    // The hop is what went on the wire, query included
    const url = new URL(http.hops[0].url);
    expect(url.origin + url.pathname).toBe('https://bookings.stayrottnest.com/rates-room1');
    expect([...url.searchParams]).toEqual([
      ['hotel', '62607'],
      ['arrival', '2027-06-28'],
      ['departure', '2027-07-01'],
      ['rooms', '1'],
      ['adults[1]', '2'],
      ['children[1]', '1'],
    ]);
    // The partition presents the app's one identity: the client sets only Accept
    expect(sent.headers).toEqual({ accept: 'text/html' });
  });

  it('counts infants as children, as Stay Rottnest does (0–17)', async () => {
    const client = makeClient();
    await client.search({ ...STAY, children: 1, infants: 2 });
    expect(new URL(http.hops[0].url).searchParams.get('children[1]')).toBe('3');
  });

  it.each([
    ['another path', '/details/hotel/62607/arrival/2027-06-28', {}],
    ['the sign-in page', '/login', {}],
    ['the bare search page', '/search-rates', {}],
    ['a field the search lacks', '/rates-room1', { hotel: '62607', promo: 'x' }],
  ])('refuses %s, sending nothing', async (_label, path, query) => {
    const client = makeClient();
    await failure(client.get(path, query as Record<string, string>), ProviderError);
    expect(http.requests).toHaveLength(0);
  });

  it('never follows a redirect: another place is an error, with no cool-down', async () => {
    const client = makeClient(() => ({ status: 302, headers: { location: '/search-rates' } }));
    const error = await failure(client.search(STAY), ProviderHttpError);
    expect(error.reason).toBe('redirect');
    expect(error.retryable).toBe(false);
    expect(isProviderBlock(error)).toBe(false);
    expect(http.requests).toHaveLength(1);
    expect(await state.get(ROTTNEST_BLOCK_STATE_KEY)).toBeUndefined();
  });

  it('rejects a 5xx as retryable, with no cool-down', async () => {
    const client = makeClient(() => ({ status: 520, body: 'origin error' }));
    const error = await failure(client.search(STAY), ProviderHttpError);
    expect(error.status).toBe(520);
    expect(error.retryable).toBe(true);
    expect(await state.get(ROTTNEST_BLOCK_STATE_KEY)).toBeUndefined();
  });
});

describe('RottnestClient: blocks', () => {
  const challenge =
    '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>cf_chl_opt</body></html>';

  it.each<[string, HopAnswer, 403 | 429]>([
    ['a 403', { status: 403, body: 'Forbidden' }, 403],
    ['a 429', { status: 429, body: 'Too many' }, 429],
    ['a cf-mitigated challenge', { status: 403, headers: { 'cf-mitigated': 'challenge' } }, 403],
    ["Cloudflare's challenge page", { status: 200, body: challenge }, 403],
    [
      'a waiting-room redirect',
      { status: 302, headers: { location: 'https://stayrottnest.queue-it.net/?c=x' } },
      403,
    ],
    [
      'a waiting-room page',
      {
        status: 200,
        body: '<script src="//static.queue-it.net/script/queueclient.min.js"></script>',
      },
      403,
    ],
  ])(
    '%s is a block: no answer, no follow, and 12 hours of nothing',
    async (_label, answer, status) => {
      const client = makeClient(() => answer);
      const error = await failure(client.search(STAY), ProviderHttpError);
      expect(error.status).toBe(status);
      expect(error.retryable).toBe(false);
      expect(isProviderBlock(error)).toBe(true);
      expect(error.message).toMatch(
        /^Stay Rottnest turned the check away \(.+\)\. WA Stay won't ask again until /
      );
      expect(http.requests).toHaveLength(1);

      // Every request in the next 12 hours is refused, unsent
      now = new Date(START.getTime() + ROTTNEST_BLOCK_COOLDOWN_MS - 60_000);
      await failure(client.search(STAY), ProviderHttpError);
      expect(http.requests).toHaveLength(1);
      // The log names the cause and the pause, never the stay
      const messages = logger.lines.map((line) => line.message);
      expect(
        messages.some((message) => /Turned away .*no requests for 12 hours/.test(message))
      ).toBe(true);
      expect(messages.join('\n')).not.toMatch(/2027-06-28|adults/);
    }
  );

  it('asks again after the cool-down, and an answer ends the run of blocks', async () => {
    let answer: HopAnswer = { status: 429 };
    const client = makeClient(() => answer);
    await failure(client.search(STAY), ProviderHttpError);
    now = new Date(START.getTime() + ROTTNEST_BLOCK_COOLDOWN_MS + 1);
    answer = { body: PAGE };
    await expect(client.search(STAY)).resolves.toMatchObject({ body: PAGE });
    expect(await state.get(ROTTNEST_BLOCK_STATE_KEY)).toBeUndefined();
  });

  it('doubles the cool-down for blocks in a row, up to 7 days', async () => {
    const client = makeClient(() => ({ status: 403 }));
    const lengths: number[] = [];
    for (let strike = 0; strike < 7; strike++) {
      await failure(client.search(STAY), ProviderHttpError);
      const block = (await state.get(ROTTNEST_BLOCK_STATE_KEY)) as {
        until: string;
        durationMs: number;
      };
      lengths.push(block.durationMs);
      now = new Date(Date.parse(block.until) + 1);
    }
    expect(lengths.map((ms) => ms / HOUR)).toEqual([12, 24, 48, 96, 168, 168, 168]);
    expect(Math.max(...lengths)).toBe(ROTTNEST_MAX_BLOCK_COOLDOWN_MS);
  });

  it('honours a longer Retry-After, up to 7 days', async () => {
    const client = makeClient(() => ({
      status: 429,
      headers: { 'retry-after': String(3 * 24 * 3600) },
    }));
    await failure(client.search(STAY), ProviderHttpError);
    const block = (await state.get(ROTTNEST_BLOCK_STATE_KEY)) as { durationMs: number };
    expect(block.durationMs).toBe(3 * 24 * HOUR);
  });

  it('keeps the cool-down in the provider state, so a new client (a restart) honours it', async () => {
    await failure(makeClient(() => ({ status: 403 })).search(STAY), ProviderHttpError);
    const fresh = makeClient();
    await failure(fresh.search(STAY), ProviderHttpError);
    expect(http.requests).toHaveLength(0);
  });

  it('cuts a cool-down whose end is further away than its length (the clock went back)', async () => {
    await state.set(ROTTNEST_BLOCK_STATE_KEY, {
      until: new Date(START.getTime() + 30 * 24 * HOUR).toISOString(),
      status: 403,
      cause: 'status',
      durationMs: ROTTNEST_BLOCK_COOLDOWN_MS,
      strikes: 1,
    });
    const client = makeClient();
    await failure(client.search(STAY), ProviderHttpError);
    const block = (await state.get(ROTTNEST_BLOCK_STATE_KEY)) as { until: string };
    expect(Date.parse(block.until)).toBe(START.getTime() + ROTTNEST_BLOCK_COOLDOWN_MS);
  });

  it('reads Retry-After seconds and dates, and pages for challenges and waiting rooms', () => {
    expect(retryAfterMs('120', 0)).toBe(120_000);
    expect(retryAfterMs('Sat, 17 Oct 2026 08:15:00 GMT', START.getTime())).toBe(HOUR);
    expect(retryAfterMs('soon', 0)).toBeUndefined();
    expect(isChallengePage(challenge)).toBe(true);
    expect(isChallengePage(PAGE)).toBe(false);
    expect(isWaitingRoom('https://stayrottnest.queue-it.net/')).toBe(true);
    expect(isWaitingRoom(PAGE)).toBe(false);
  });
});

describe('RottnestClient: quiet on Open Day mornings', () => {
  it.each([
    ['5:30 am', '2026-11-03T21:30:00.000Z', true],
    ['8:30 am', '2026-11-04T00:30:00.000Z', true],
    ['11:59 am', '2026-11-04T03:59:00.000Z', true],
    ['5:29 am', '2026-11-03T21:29:00.000Z', false],
    ['noon', '2026-11-04T04:00:00.000Z', false],
  ])('on Wed 4 Nov 2026 at %s Perth, sends %s', async (_label, at, quiet) => {
    now = new Date(at);
    const client = makeClient();
    if (quiet) {
      const error = await failure(client.search(STAY), ProviderError);
      expect(error.message).toMatch(/Open Day.*Checks start again at noon/);
      expect(http.requests).toHaveLength(0);
    } else {
      await expect(client.search(STAY)).resolves.toMatchObject({ body: PAGE });
    }
  });

  it('is not quiet on an ordinary Wednesday', async () => {
    now = new Date('2026-11-11T00:30:00.000Z');
    await expect(makeClient().search(STAY)).resolves.toMatchObject({ body: PAGE });
  });
});
