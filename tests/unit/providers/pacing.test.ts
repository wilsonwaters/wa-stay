/**
 * The paced HTTP client (`src/main/providers/sdk/pacing.ts`), on Jest's fake timers (which
 * drive `performance.now()`, the monotonic clock it measures gaps with): one request in
 * flight, the gap from the end of one request to the start of the next (10 s background, 1 s
 * interactive), interactive requests first, one queue for every `withDefaults` view and every
 * kind of call, aborts and timeouts while waiting, `onSend` at the turn (never for a request
 * aborted while it waits), failures and redirect chains as one turn,
 * and the request priority: explicit, ambient, nested and inside a limiter task.
 */

import {
  createLimiter,
  createPacedHttpClient,
  currentRequestPriority,
  INTERACTIVE_REQUEST_GAP_MS,
  ProviderHttpError,
  ProviderTimeoutError,
  withRequestPriority,
  type HttpClient,
} from '@main/providers/sdk';
import { RecordingHttpClient, type HopAnswer } from '@tests/utils/fake-paced-provider';

const SECOND = 1_000;
const INTERVAL = 10 * SECOND;
const NOW = new Date('2026-10-16T02:00:00.000Z');
const BASE = 'https://paced.example';

let inner: RecordingHttpClient;
let paced: HttpClient;

/** A paced client over a recording client whose hops take `delayMs`. */
function setUp(delayMs = 3 * SECOND, respond?: (url: string) => HopAnswer): void {
  jest.useFakeTimers({ now: NOW });
  inner = new RecordingHttpClient({ delayMs, respond: respond && ((hop) => respond(hop.url)) });
  paced = createPacedHttpClient(inner, { intervalMs: INTERVAL });
}

afterEach(() => {
  jest.useRealTimers();
});

/** When each request started, relative to the first one (ms), by URL path. */
function starts(): Record<string, number> {
  const first = inner.requests[0]?.sentAt ?? 0;
  return Object.fromEntries(inner.requests.map((r) => [new URL(r.url).pathname, r.sentAt - first]));
}

/** Each request's start minus the previous one's end, in the order they were sent. */
function gaps(): number[] {
  return inner.requests.slice(1).map((r, i) => r.sentAt - inner.requests[i].endedAt!);
}

const get = (path: string, options: Parameters<HttpClient['request']>[2] = {}) =>
  paced.request('GET', `${BASE}${path}`, options);

describe('createPacedHttpClient', () => {
  it('no two background requests start within intervalMs of the previous end', async () => {
    setUp();
    const all = Promise.all(['/a', '/b', '/c', '/d'].map((path) => get(path)));

    await jest.advanceTimersByTimeAsync(60 * SECOND);
    await all;

    // Each 3 s long, each 10 s after the previous one ended: 0, 13, 26 and 39 s
    expect(starts()).toEqual({ '/a': 0, '/b': 13_000, '/c': 26_000, '/d': 39_000 });
    expect(gaps()).toEqual([INTERVAL, INTERVAL, INTERVAL]);
  });

  it('the first request goes at once, and a request after a long pause too', async () => {
    setUp();
    const first = get('/a');
    await jest.advanceTimersByTimeAsync(0);
    expect(inner.requests).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(3 * SECOND);
    await first;

    await jest.advanceTimersByTimeAsync(30 * SECOND);
    void get('/b');
    await jest.advanceTimersByTimeAsync(0);
    expect(inner.requests).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(3 * SECOND);
  });

  it('one in flight', async () => {
    setUp();
    const all = Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        i % 2 ? get(`/bg${i}`) : get(`/now${i}`, { priority: 'interactive' })
      )
    );
    await jest.advanceTimersByTimeAsync(5 * 60 * SECOND);
    await all;

    expect(inner.requests).toHaveLength(6);
    expect(inner.peakInFlight).toBe(1);
    expect(gaps().every((gap) => gap >= INTERACTIVE_REQUEST_GAP_MS)).toBe(true);
  });

  it('interactive first, after a 1 s gap', async () => {
    setUp();
    const background = [get('/bg1'), get('/bg2'), get('/bg3')];
    await jest.advanceTimersByTimeAsync(SECOND);
    // While /bg1 is in flight, /bg2 and /bg3 wait; two interactive requests arrive
    const interactive = [
      get('/now1', { priority: 'interactive' }),
      get('/now2', { priority: 'interactive' }),
    ];

    await jest.advanceTimersByTimeAsync(2 * 60 * SECOND);
    await Promise.all([...background, ...interactive]);

    expect(inner.requests.map((r) => new URL(r.url).pathname)).toEqual([
      '/bg1',
      '/now1',
      '/now2',
      '/bg2',
      '/bg3',
    ]);
    // 1 s before each interactive one, 10 s before each background one
    expect(gaps()).toEqual([1_000, 1_000, INTERVAL, INTERVAL]);
    expect(inner.requests.map((r) => r.priority)).toEqual([
      'background',
      'interactive',
      'interactive',
      'background',
      'background',
    ]);
  });

  it('an interactive request that arrives during a background gap goes 1 s after the last end', async () => {
    setUp();
    void get('/bg1');
    void get('/bg2');
    // /bg1 ended at 3 s; /bg2 waits until 13 s
    await jest.advanceTimersByTimeAsync(3_500);
    void get('/now1', { priority: 'interactive' });
    await jest.advanceTimersByTimeAsync(0);
    expect(inner.requests).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(500);
    expect(inner.requests).toHaveLength(2);
    // /now1 ended at 7 s; 5 s later, a second one goes at once
    await jest.advanceTimersByTimeAsync(3_000 + 5_000);
    void get('/now2', { priority: 'interactive' });
    await jest.advanceTimersByTimeAsync(0);
    expect(inner.requests).toHaveLength(3);

    await jest.advanceTimersByTimeAsync(60 * SECOND);
    expect(starts()).toEqual({ '/bg1': 0, '/now1': 4_000, '/now2': 12_000, '/bg2': 25_000 });
  });

  it('withDefaults shares the queue', async () => {
    setUp();
    const view = paced.withDefaults({ headers: { Referer: `${BASE}/` } });
    const nested = view.withDefaults({ headers: { 'X-Extra': '1' } });
    const all = Promise.all([
      get('/plain'),
      view.request('GET', `${BASE}/view`),
      nested.getJson(`${BASE}/nested`),
    ]);

    await jest.advanceTimersByTimeAsync(60 * SECOND);
    await all;

    expect(starts()).toEqual({ '/plain': 0, '/view': 13_000, '/nested': 26_000 });
    expect(inner.peakInFlight).toBe(1);
    expect(inner.requests[1].headers).toMatchObject({ referer: `${BASE}/` });
    expect(inner.requests[2].headers).toMatchObject({ referer: `${BASE}/`, 'x-extra': '1' });
    expect(view.cookies).toBe(inner.cookies);
    expect(paced.cookies).toBe(inner.cookies);
    expect(view.providerId).toBe(inner.providerId);
  });

  it('getJson and postForm take a turn', async () => {
    setUp(3 * SECOND, (url) => ({ body: JSON.stringify({ path: new URL(url).pathname }) }));
    const json = paced.getJson(`${BASE}/json`);
    const form = paced.postForm(`${BASE}/form`, { blog_id: 3, arrive: '2026-11-10' });
    const raw = paced.request('POST', `${BASE}/raw`, { body: 'a=1' });

    await jest.advanceTimersByTimeAsync(60 * SECOND);

    await expect(json).resolves.toEqual({ path: '/json' });
    await expect(form).resolves.toEqual({ path: '/form' });
    expect((await raw).status).toBe(200);
    expect(starts()).toEqual({ '/json': 0, '/form': 13_000, '/raw': 26_000 });
    expect(inner.requests[1]).toMatchObject({
      method: 'POST',
      body: 'blog_id=3&arrive=2026-11-10',
    });
  });

  it('abort leaves the queue without a turn', async () => {
    setUp();
    const first = get('/a');
    const controller = new AbortController();
    const aborted = get('/aborted', { signal: controller.signal });
    const last = get('/last');
    await jest.advanceTimersByTimeAsync(SECOND);

    controller.abort();
    // At once, while /a is still in flight
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });

    await jest.advanceTimersByTimeAsync(60 * SECOND);
    await Promise.all([first, last]);
    // /last took the aborted request's place: 10 s after /a ended
    expect(starts()).toEqual({ '/a': 0, '/last': 13_000 });
    expect(inner.hops.map((hop) => new URL(hop.url).pathname)).not.toContain('/aborted');
  });

  it('an aborted signal is refused at once, and an abort after the send is the transport’s', async () => {
    setUp();
    await expect(get('/never', { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: 'AbortError',
    });
    const controller = new AbortController();
    const sent = get('/sent', { signal: controller.signal });
    const next = get('/next');
    await jest.advanceTimersByTimeAsync(SECOND);
    controller.abort();
    await expect(sent).rejects.toMatchObject({ name: 'AbortError' });

    await jest.advanceTimersByTimeAsync(60 * SECOND);
    await next;
    expect(inner.requests.map((r) => new URL(r.url).pathname)).toEqual(['/sent', '/next']);
    // The aborted request ended its turn when it was aborted, 1 s in
    expect(starts()['/next']).toBe(SECOND + INTERVAL);
  });

  it('onSend is called when a request leaves the queue, never for one aborted while it waits', async () => {
    setUp();
    const sent: string[] = [];
    const onSend = (path: string) => () => sent.push(`${path}@${performance.now() - start}`);
    const start = performance.now();
    const first = get('/a', { onSend: onSend('/a') });
    const controller = new AbortController();
    const aborted = get('/aborted', { signal: controller.signal, onSend: onSend('/aborted') });
    const last = get('/last', { onSend: onSend('/last') });
    expect(sent).toEqual(['/a@0']);
    await jest.advanceTimersByTimeAsync(SECOND);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    await jest.advanceTimersByTimeAsync(60 * SECOND);
    await Promise.all([first, last]);
    // /last when its turn came: 10 s after /a ended at 3 s
    expect(sent).toEqual(['/a@0', '/last@13000']);
  });

  it('the timeout counts from the send', async () => {
    setUp(8 * SECOND, (url) => (url.endsWith('/slow') ? { delayMs: 6 * SECOND } : {}));
    const first = get('/first');
    // Waits 18 s for its turn, then gets 5 s on the wire
    const quick = get('/quick', { timeoutMs: 5 * SECOND }).catch((error: unknown) => error);
    const slow = get('/slow', { timeoutMs: 5 * SECOND });
    const outcome = slow.catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(2 * 60 * SECOND);
    await first;

    // 8 s on the wire is over its 5 s, counted from the send
    expect(await quick).toBeInstanceOf(ProviderTimeoutError);
    expect(inner.requests[1].endedAt! - inner.requests[1].sentAt).toBe(5 * SECOND);
    // 6 s on the wire, also over: but only after it was sent, 10 s after /quick timed out
    expect(await outcome).toBeInstanceOf(ProviderTimeoutError);
    expect(starts()).toEqual({ '/first': 0, '/quick': 18_000, '/slow': 33_000 });
  });

  it('a request whose answer comes in time is not timed out by its wait', async () => {
    setUp(8 * SECOND, (url) => (url.endsWith('/next') ? { delayMs: 4 * SECOND } : {}));
    void get('/first');
    const next = get('/next', { timeoutMs: 5 * SECOND });

    await jest.advanceTimersByTimeAsync(60 * SECOND);

    expect((await next).status).toBe(200);
    expect(starts()['/next']).toBe(18_000);
  });

  it('a request that fails still ends its turn and starts the gap', async () => {
    setUp(2 * SECOND, (url) => {
      if (url.endsWith('/error')) return { status: 500 };
      if (url.endsWith('/reset'))
        return { fail: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) };
      return {};
    });
    const error = paced.getJson(`${BASE}/error`).catch((e: unknown) => e);
    const reset = get('/reset').catch((e: unknown) => e);
    const after = get('/after');

    await jest.advanceTimersByTimeAsync(60 * SECOND);

    expect(await error).toMatchObject({ status: 500 });
    expect(await error).toBeInstanceOf(ProviderHttpError);
    expect(await reset).toMatchObject({ status: 0, reason: 'network' });
    expect((await after).status).toBe(200);
    expect(gaps()).toEqual([INTERVAL, INTERVAL]);
  });

  it('a redirect chain counts as one request', async () => {
    setUp(SECOND, (url) =>
      url.endsWith('/moved') ? { status: 302, headers: { location: `${BASE}/here` } } : {}
    );
    const moved = get('/moved');
    const next = get('/next');

    await jest.advanceTimersByTimeAsync(60 * SECOND);

    expect((await moved).url).toBe(`${BASE}/here`);
    await next;
    // Two hops back to back (1 s each), then the gap
    expect(inner.hops.map((hop) => new URL(hop.url).pathname)).toEqual([
      '/moved',
      '/here',
      '/next',
    ]);
    expect(starts()['/next']).toBe(2 * SECOND + INTERVAL);
  });

  it('the wall clock set back never shortens the gap', async () => {
    setUp();
    void get('/a');
    const b = get('/b');
    await jest.advanceTimersByTimeAsync(3 * SECOND + 2 * SECOND);
    jest.setSystemTime(new Date(NOW.getTime() - 3_600_000));

    await jest.advanceTimersByTimeAsync(7 * SECOND);
    expect(inner.requests).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(SECOND);
    expect(inner.requests).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(3 * SECOND);
    await b;
    expect(gaps()).toEqual([INTERVAL]);
  });

  it('an interval of 0 or less is refused; an interval under 1 s is the interactive gap too', async () => {
    jest.useFakeTimers({ now: NOW });
    const recording = new RecordingHttpClient({ delayMs: 100 });
    expect(() => createPacedHttpClient(recording, { intervalMs: 0 })).toThrow(RangeError);
    expect(() => createPacedHttpClient(recording, { intervalMs: -5 })).toThrow(RangeError);

    const fast = createPacedHttpClient(recording, { intervalMs: 500 });
    void fast.request('GET', `${BASE}/a`);
    void fast.request('GET', `${BASE}/b`, { priority: 'interactive' });
    await jest.advanceTimersByTimeAsync(10 * SECOND);
    const [a, b] = recording.requests;
    expect(b.sentAt - a.endedAt!).toBe(500);
  });
});

describe('request priority', () => {
  it('is background outside any scope; the innermost withRequestPriority wins', async () => {
    expect(currentRequestPriority()).toBe('background');
    withRequestPriority('interactive', () => {
      expect(currentRequestPriority()).toBe('interactive');
      withRequestPriority('background', () => {
        expect(currentRequestPriority()).toBe('background');
      });
      expect(currentRequestPriority()).toBe('interactive');
    });
    // It holds across awaits inside the scope
    await withRequestPriority('interactive', async () => {
      await Promise.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(currentRequestPriority()).toBe('interactive');
    });
    expect(currentRequestPriority()).toBe('background');
  });

  it('is read when request is called', async () => {
    setUp();
    void get('/bg1');
    void get('/bg2');
    void withRequestPriority('interactive', () => get('/now'));
    await jest.advanceTimersByTimeAsync(60 * SECOND);

    expect(inner.requests.map((r) => [new URL(r.url).pathname, r.priority])).toEqual([
      ['/bg1', 'background'],
      ['/now', 'interactive'],
      ['/bg2', 'background'],
    ]);
  });

  it('explicit priority beats the ambient one', async () => {
    setUp();
    void get('/first');
    void withRequestPriority('interactive', () =>
      get('/told-background', { priority: 'background' })
    );
    void get('/told-interactive', { priority: 'interactive' });
    await jest.advanceTimersByTimeAsync(60 * SECOND);

    expect(inner.requests.map((r) => [new URL(r.url).pathname, r.priority])).toEqual([
      ['/first', 'background'],
      ['/told-interactive', 'interactive'],
      ['/told-background', 'background'],
    ]);
    expect(gaps()).toEqual([INTERACTIVE_REQUEST_GAP_MS, INTERVAL]);
  });

  it("a module's own limiter in front of the paced client lets an interactive request go next", async () => {
    setUp();
    // As the scaffold's API provider does: every request through one limiter
    const limit = createLimiter(1);
    const background = ['/bg1', '/bg2', '/bg3'].map((path) => limit(() => get(path)));
    await jest.advanceTimersByTimeAsync(SECOND);
    const interactive = withRequestPriority('interactive', () => limit(() => get('/now')));

    await jest.advanceTimersByTimeAsync(2 * 60 * SECOND);
    await Promise.all([...background, interactive]);

    // Next after the one in flight, not behind the background requests queued before it
    expect(inner.requests.map((r) => [new URL(r.url).pathname, r.priority])).toEqual([
      ['/bg1', 'background'],
      ['/now', 'interactive'],
      ['/bg2', 'background'],
      ['/bg3', 'background'],
    ]);
    expect(starts()).toEqual({ '/bg1': 0, '/now': 4_000, '/bg2': 17_000, '/bg3': 30_000 });
  });

  it('the ambient priority holds inside a limiter task', async () => {
    setUp();
    const limit = createLimiter(1);
    // A background task holds the limiter; the tasks behind it start when it ends, from its
    // context, yet each keeps the priority it was asked with.
    const holding = limit(() => get('/holding'));
    const askedInteractive = withRequestPriority('interactive', () =>
      limit(() => get('/asked-interactive'))
    );
    const scopedInside = limit(() => withRequestPriority('interactive', () => get('/scoped')));
    const askedBackground = limit(() => get('/asked-background'));

    await jest.advanceTimersByTimeAsync(2 * 60 * SECOND);
    await Promise.all([holding, askedInteractive, scopedInside, askedBackground]);

    expect(inner.requests.map((r) => [new URL(r.url).pathname, r.priority])).toEqual([
      ['/holding', 'background'],
      ['/asked-interactive', 'interactive'],
      ['/scoped', 'interactive'],
      ['/asked-background', 'background'],
    ]);
    expect(gaps()).toEqual([1_000, 1_000, INTERVAL]);
  });
});
