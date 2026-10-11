/**
 * `ParkStayAccessGate` (the DBCA queue) with fake timers: waiting → active, abort and
 * `maxWaitMs`, backoff while the queue API is down, the ref-counted keep-alive, expired
 * versus idle, the `sitequeuesession` key, the saved session, and no `'error'` event to go
 * unhandled.
 */

import { EventEmitter } from 'events';
import {
  ParkStayAccessGate,
  QUEUE_SESSION_KEY,
  type StoredQueueSession,
} from '@main/providers/parkstay/queue/access-gate';
import type { QueueApi } from '@main/providers/parkstay/queue/queue-api';
import type { QueueApiResponse } from '@main/providers/parkstay/types';
import {
  AccessGateError,
  CookieJar,
  InMemoryKeyValueStore,
  isAbortError,
  ProviderHttpError,
} from '@main/providers/sdk';
import type { AccessStatus } from '@shared/types/provider.types';
import { createMemoryLogger, type MemoryLogger } from '@tests/utils/fake-provider';
import { parkStayFixture } from '@tests/utils/parkstay-fixture-server';

const PARKSTAY = 'https://parkstay.dbca.wa.gov.au/';
const COOKIE_KEY = 'COOKIEKEY0000000000000000000000000000000000000000000';

const active = (overrides: Partial<QueueApiResponse> = {}): QueueApiResponse => ({
  ...parkStayFixture<QueueApiResponse>('queue-active.json'),
  ...overrides,
});
const waiting = (overrides: Partial<QueueApiResponse> = {}): QueueApiResponse => ({
  ...parkStayFixture<QueueApiResponse>('queue-waiting.json'),
  ...overrides,
});

describe('ParkStayAccessGate', () => {
  let check: jest.Mock<Promise<QueueApiResponse>, [string, AbortSignal | undefined]>;
  let jar: CookieJar;
  let state: InMemoryKeyValueStore;
  let logger: MemoryLogger;
  let gate: ParkStayAccessGate;

  /** Answers one check-create-session per entry, the last repeating; an Error rejects. */
  function answer(...responses: Array<QueueApiResponse | Error>): void {
    let call = 0;
    check.mockImplementation(async () => {
      const response = responses[Math.min(call++, responses.length - 1)];
      if (response instanceof Error) throw response;
      return response;
    });
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-02T02:00:00.000Z') });
    check = jest.fn();
    jar = new CookieJar(() => Date.now());
    state = new InMemoryKeyValueStore();
    logger = createMemoryLogger();
    gate = new ParkStayAccessGate({
      providerId: 'parkstay',
      api: { checkCreateSession: check } as unknown as QueueApi,
      cookies: jar,
      state,
      logger,
      clock: () => new Date(),
    });
  });

  afterEach(() => {
    gate.dispose();
    jest.useRealTimers();
  });

  it('starts idle, with no timers', () => {
    expect(gate.status()).toMatchObject({ providerId: 'parkstay', state: 'idle' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('waits in the queue (Waiting → Active) and resolves ensure() once active', async () => {
    answer(waiting(), waiting({ queue_position: 12, wait_time: 60 }), active());
    const seen: AccessStatus[] = [];
    gate.onStatus((status) => seen.push(status));

    let resolved: AccessStatus | undefined;
    const pending = gate.ensure().then((status) => (resolved = status));

    await jest.advanceTimersByTimeAsync(0);
    expect(gate.status()).toMatchObject({ state: 'waiting', position: 37, etaSeconds: 180 });
    expect(resolved).toBeUndefined();

    await jest.advanceTimersByTimeAsync(5_000);
    expect(gate.status()).toMatchObject({ state: 'waiting', position: 12 });

    await jest.advanceTimersByTimeAsync(5_000);
    await pending;
    expect(resolved).toMatchObject({
      state: 'active',
      expiresAt: '2026-10-02T02:30:10.000Z', // 1800 s after the third check, at +10 s
    });
    expect(seen.map((s) => s.state)).toEqual(['waiting', 'waiting', 'active']);
    expect(check).toHaveBeenCalledTimes(3);
    // No polling left: only the timer that turns the unused session idle when it ends.
    expect(jest.getTimerCount()).toBe(1);
  });

  it('never puts the session key in a status (statuses reach the renderer)', async () => {
    answer(active());
    const status = await gate.ensure();
    expect(JSON.stringify(status)).not.toMatch(/KEY|session/i);
    expect(Object.keys(status).sort()).toEqual(['expiresAt', 'providerId', 'state', 'updatedAt']);
  });

  it('rejects an aborted ensure() with an AbortError and leaves no timers', async () => {
    answer(waiting());
    const controller = new AbortController();
    const pending = gate.ensure({ signal: controller.signal });
    await jest.advanceTimersByTimeAsync(12_000);
    expect(check).toHaveBeenCalledTimes(3);

    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(jest.getTimerCount()).toBe(0);

    // The loop really stopped.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('rejects an ensure() that is already aborted without calling the queue', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(gate.ensure({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(check).not.toHaveBeenCalled();
  });

  it('is single-flight: concurrent callers share one polling loop', async () => {
    answer(waiting(), active());
    const first = gate.ensure();
    const second = gate.ensure();
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ state: 'active' }),
      expect.objectContaining({ state: 'active' }),
    ]);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('keeps polling for the callers left when one of them aborts', async () => {
    answer(waiting(), waiting(), active());
    const controller = new AbortController();
    const leaving = gate.ensure({ signal: controller.signal });
    const staying = gate.ensure();
    await jest.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(leaving).rejects.toMatchObject({ name: 'AbortError' });
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(staying).resolves.toMatchObject({ state: 'active' });
  });

  it('retries a queue API that is down, with backoff, until maxWaitMs, then AccessGateError(error)', async () => {
    answer(new ProviderHttpError({ providerId: 'parkstay', status: 503, url: 'https://q/x' }));
    const pending = gate.ensure({ maxWaitMs: 60_000 });
    const result = pending.catch((e: unknown) => e);

    // Checks at 0, then 2, 4, 8, 16 and 30 s apart (60 s covers 0, 2, 6, 14, 30).
    await jest.advanceTimersByTimeAsync(60_000);
    const error = await result;
    expect(error).toBeInstanceOf(AccessGateError);
    expect(error).toMatchObject({ state: 'error' });
    expect(check).toHaveBeenCalledTimes(5);
    expect(gate.status()).toMatchObject({ state: 'error' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('gives up waiting in the queue at maxWaitMs with AccessGateError(waiting)', async () => {
    answer(waiting());
    const result = gate.ensure({ maxWaitMs: 30_000 }).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(await result).toMatchObject({ name: 'AccessGateError', state: 'waiting' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports a full queue as waiting, with its message', async () => {
    answer(waiting({ queue_full: true, custom_message: 'Very busy right now' }), active());
    const pending = gate.ensure();
    await jest.advanceTimersByTimeAsync(0);
    expect(gate.status()).toMatchObject({ state: 'waiting', message: 'Very busy right now' });
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toMatchObject({ state: 'active' });
  });

  it('trusts an active session until 120 s before it ends, then refreshes it', async () => {
    answer(active({ expiry_seconds: 600 }));
    await gate.ensure();
    expect(check).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(470_000); // 130 s left
    await gate.ensure();
    expect(check).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(20_000); // 110 s left
    await gate.ensure();
    expect(check).toHaveBeenCalledTimes(2);
  });

  describe('expired or idle', () => {
    let seen: Array<AccessStatus['state']>;

    beforeEach(() => {
      seen = [];
      gate.onStatus((status) => seen.push(status.state));
    });

    it('reports a session that ran out while held open as expired, then idle (announced) at the last release', async () => {
      answer(active({ expiry_seconds: 10 }));
      await gate.ensure();
      const release = gate.holdOpen();
      await jest.advanceTimersByTimeAsync(11_000); // before the 20 s keep-alive
      expect(gate.status().state).toBe('expired');

      release();
      expect(gate.status()).toEqual({
        providerId: 'parkstay',
        state: 'idle',
        updatedAt: '2026-10-02T02:00:11.000Z',
      });
      expect(seen).toEqual(['active', 'idle']);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('goes idle, and announces it, when a session nothing uses any more ends', async () => {
      answer(active({ expiry_seconds: 60 }));
      await gate.ensure();
      const release = gate.holdOpen();
      await jest.advanceTimersByTimeAsync(20_000); // keep-alive: the session now ends at +80 s
      release();
      expect(gate.status().state).toBe('active');

      await jest.advanceTimersByTimeAsync(59_999);
      expect(seen).toEqual(['active', 'active']);
      await jest.advanceTimersByTimeAsync(1);
      expect(seen).toEqual(['active', 'active', 'idle']);
      expect(gate.status().state).toBe('idle');
      expect(jest.getTimerCount()).toBe(0);
      expect(check).toHaveBeenCalledTimes(2);
    });

    it('reports expired while an ensure() waits for the refresh, and idle once it gives up', async () => {
      answer(active({ expiry_seconds: 150 }));
      await gate.ensure();
      await jest.advanceTimersByTimeAsync(40_000); // 110 s left: refreshed, not trusted
      check.mockImplementation(() => new Promise<QueueApiResponse>(() => {})); // no answer
      const result = gate.ensure({ maxWaitMs: 120_000 }).catch((e: unknown) => e);

      await jest.advanceTimersByTimeAsync(111_000);
      expect(gate.status().state).toBe('expired');
      expect(seen).toEqual(['active']);

      await jest.advanceTimersByTimeAsync(9_000);
      expect(await result).toBeInstanceOf(AccessGateError);
      expect(gate.status().state).toBe('idle');
      expect(seen).toEqual(['active', 'idle']);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('a new hold or ensure() stops the wait to go idle', async () => {
      answer(active({ expiry_seconds: 60 }));
      await gate.ensure();
      expect(jest.getTimerCount()).toBe(1);
      const release = gate.holdOpen();
      expect(jest.getTimerCount()).toBe(1); // the keep-alive only
      release();
      await jest.advanceTimersByTimeAsync(61_000);
      expect(gate.status().state).toBe('idle');
    });
  });

  describe('holdOpen keep-alive', () => {
    it('refreshes every 20 s while held; one of two releases keeps it running, the second stops it', async () => {
      answer(active());
      await gate.ensure();
      check.mockClear();

      const releaseA = gate.holdOpen();
      const releaseB = gate.holdOpen();
      expect(gate.holdCount).toBe(2);
      await jest.advanceTimersByTimeAsync(20_000);
      expect(check).toHaveBeenCalledTimes(1);

      releaseA();
      releaseA(); // a second call of the same release counts once
      expect(gate.holdCount).toBe(1);
      await jest.advanceTimersByTimeAsync(40_000);
      expect(check).toHaveBeenCalledTimes(3);

      releaseB();
      expect(gate.holdCount).toBe(0);
      // No keep-alive left: only the timer that turns the unused session idle when it ends.
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(60_000);
      expect(check).toHaveBeenCalledTimes(3);
    });

    it('keeps going after a failed refresh, reporting the error', async () => {
      answer(new Error('offline'), active());
      const release = gate.holdOpen();
      await jest.advanceTimersByTimeAsync(20_000);
      expect(gate.status().state).toBe('error');
      await jest.advanceTimersByTimeAsync(20_000);
      expect(gate.status().state).toBe('active');
      release();
    });
  });

  describe('status listeners', () => {
    it('is not an EventEmitter: a failure with no listener cannot become an unhandled error event', async () => {
      expect(gate).not.toBeInstanceOf(EventEmitter);
      answer(new Error('queue down'));
      const result = gate.ensure({ maxWaitMs: 5_000 }).catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(5_000);
      expect(await result).toBeInstanceOf(AccessGateError);
    });

    it('runs every listener even when one throws, and unsubscribes', async () => {
      answer(active());
      const good = jest.fn();
      gate.onStatus(() => {
        throw new Error('listener bug');
      });
      const unsubscribe = gate.onStatus(good);
      await gate.ensure();
      expect(good).toHaveBeenCalledWith(expect.objectContaining({ state: 'active' }));
      expect(logger.lines.some((l) => l.message.includes('listener failed'))).toBe(true);

      unsubscribe();
      good.mockClear();
      await jest.advanceTimersByTimeAsync(1_700_000);
      await gate.ensure();
      expect(good).not.toHaveBeenCalled();
    });
  });

  describe('session key', () => {
    it('uses an existing sitequeuesession cookie on dbca.wa.gov.au', async () => {
      await jar.set({
        url: PARKSTAY,
        domain: 'dbca.wa.gov.au',
        name: 'sitequeuesession',
        value: COOKIE_KEY,
      });
      answer(active({ session_key: COOKIE_KEY }));
      await gate.ensure();
      expect(check).toHaveBeenCalledWith(COOKIE_KEY, expect.anything());
    });

    it('makes a 52-character A-Z0-9 key without a cookie or saved session, and sets the cookie', async () => {
      check.mockImplementation(async (key) => active({ session_key: key }));
      await gate.ensure();
      const [key] = check.mock.calls[0];
      expect(key).toMatch(/^[A-Z0-9]{52}$/);
      const cookie = await jar.get('https://queue.dbca.wa.gov.au/', 'sitequeuesession');
      expect(cookie).toMatchObject({ value: key, domain: 'dbca.wa.gov.au', hostOnly: false });
    });

    it('follows the key the queue hands back', async () => {
      answer(active({ session_key: 'NEWKEY' }));
      await gate.ensure();
      expect((await jar.get(PARKSTAY, 'sitequeuesession'))?.value).toBe('NEWKEY');
    });

    it('reuses an unexpired saved session’s key, keeping the queue position across a restart', async () => {
      const saved: StoredQueueSession = {
        sessionKey: 'SAVEDKEY',
        status: 'Waiting',
        position: 4,
        estimatedWaitSeconds: 30,
        expirySeconds: 1800,
        expiresAt: '2026-10-02T02:20:00.000Z',
        createdAt: '2026-10-02T01:50:00.000Z',
      };
      await state.set(QUEUE_SESSION_KEY, saved);
      answer(active({ session_key: 'SAVEDKEY' }));
      await gate.ensure();
      expect(check).toHaveBeenCalledWith('SAVEDKEY', expect.anything());
    });

    it('discards an expired saved session and starts a new one', async () => {
      await state.set(QUEUE_SESSION_KEY, {
        sessionKey: 'OLDKEY',
        status: 'Active',
        position: null,
        estimatedWaitSeconds: 0,
        expirySeconds: 1800,
        expiresAt: '2026-10-02T01:00:00.000Z',
        createdAt: '2026-10-02T00:30:00.000Z',
      });
      check.mockImplementation(async () => {
        // Discarded before the queue is asked.
        expect(await state.get(QUEUE_SESSION_KEY)).toBeUndefined();
        return active();
      });
      await gate.ensure();
      expect(check.mock.calls[0][0]).not.toBe('OLDKEY');
    });

    it('saves the session after each check, in the shape migration v8 writes', async () => {
      answer(active());
      await gate.ensure();
      expect(await state.get(QUEUE_SESSION_KEY)).toEqual({
        sessionKey: 'FIXTUREACTIVEKEY0000000000000000000000000000000000000',
        status: 'Active',
        position: null,
        estimatedWaitSeconds: 0,
        expirySeconds: 1800,
        expiresAt: '2026-10-02T02:30:00.000Z',
        createdAt: '2026-10-02T02:00:00.000Z',
      });
    });

    it('never logs the session key', async () => {
      await jar.set({
        url: PARKSTAY,
        domain: 'dbca.wa.gov.au',
        name: 'sitequeuesession',
        value: COOKIE_KEY,
      });
      answer(
        waiting({ session_key: COOKIE_KEY }),
        new Error(`boom`),
        active({ session_key: COOKIE_KEY })
      );
      const pending = gate.ensure();
      await jest.advanceTimersByTimeAsync(20_000);
      await pending;
      expect(logger.lines.length).toBeGreaterThan(0);
      expect(JSON.stringify(logger.lines)).not.toContain(COOKIE_KEY);
    });
  });

  it('dispose stops the keep-alive and any wait, rejecting waiting callers', async () => {
    answer(waiting());
    const release = gate.holdOpen();
    const pending = gate.ensure().catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(0);
    gate.dispose();
    expect(await pending).toMatchObject({ name: 'AccessGateError', state: 'error' });
    expect(jest.getTimerCount()).toBe(0);
    release();
    await expect(gate.ensure()).rejects.toBeInstanceOf(AccessGateError);
  });
});
