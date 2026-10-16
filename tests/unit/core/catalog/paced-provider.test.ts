/**
 * `LocationCatalogService` with a paced provider (`limits.minRequestIntervalMs: 10 s`, its
 * http wrapped by the real `createProviderContext`) on Jest's fake timers: which calls ask at
 * interactive priority (a place's detail, its check, Explore's bulk availability) and which
 * at background (sync, refresh), and deadlines that grow with the pacing (`pacedDeadlineMs`)
 * while an unpaced provider keeps the plain ones.
 */

import type Database from 'better-sqlite3';
import {
  DEFAULT_CATALOG_TIMINGS,
  LocationCatalogService,
} from '@main/core/catalog/location-catalog.service';
import { closeDatabase, openDatabase } from '@main/database/connection';
import { LocationRepository, ProviderStateRepository } from '@main/database/repositories';
import { ProviderRegistry } from '@main/providers/registry';
import { createMemoryLogger } from '@tests/utils/fake-provider';
import {
  createFakePacedProvider,
  pacedContext,
  RecordingHttpClient,
  type HopAnswer,
} from '@tests/utils/fake-paced-provider';

const SECOND = 1_000;
const STAY = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };
const NOW = new Date('2026-10-16T02:00:00.000Z');

interface Setup {
  db: Database.Database;
  registry: ProviderRegistry;
  inner: RecordingHttpClient;
  catalog: LocationCatalogService;
}

let current: Setup | undefined;

/** A paced (or, with `intervalMs: 0`, unpaced) provider of 8 places whose hops take `delayMs`. */
function setUp(
  options: { intervalMs?: number; delayMs?: number; respond?: (path: string) => HopAnswer } = {}
): Setup {
  jest.useFakeTimers({ now: NOW });
  const db = openDatabase(':memory:');
  const registry = new ProviderRegistry();
  const inner = new RecordingHttpClient({
    delayMs: options.delayMs ?? SECOND,
    respond: options.respond && ((hop) => options.respond!(new URL(hop.url).pathname)),
  });
  const provider = createFakePacedProvider({ intervalMs: options.intervalMs });
  registry.register(provider.factory, (manifest) => pacedContext(manifest, inner));
  const catalog = new LocationCatalogService({
    registry,
    locations: new LocationRepository(db),
    providerState: new ProviderStateRepository(db),
    events: { emit: () => undefined },
    logger: createMemoryLogger(),
  });
  current = { db, registry, inner, catalog };
  return current;
}

afterEach(async () => {
  if (current) {
    current.catalog.stop();
    await current.registry.disposeAll();
    closeDatabase(current.db);
    current = undefined;
  }
  jest.useRealTimers();
});

/** Runs fake time until `promise` settles (at most `limitMs`); returns how long it took. */
async function timed<T>(
  promise: Promise<T>,
  limitMs = 5 * 60 * SECOND
): Promise<{ value?: T; error?: unknown; ms: number }> {
  const start = performance.now();
  let outcome: { value?: T; error?: unknown } | undefined;
  promise.then(
    (value) => (outcome = { value }),
    (error: unknown) => (outcome = { error })
  );
  for (let waited = 0; !outcome && waited < limitMs; waited += 100) {
    await jest.advanceTimersByTimeAsync(100);
  }
  return { ...outcome, ms: performance.now() - start };
}

async function synced(s: Setup): Promise<void> {
  await timed(s.catalog.sync('paced'));
  expect(s.catalog.status().providers[0]).toMatchObject({ count: 8 });
}

const priorities = (s: Setup, from = 0) => s.inner.requests.slice(from).map((r) => r.priority);

describe('a paced provider', () => {
  it('a bulk search of 8 places sending 8 requests finishes inside its deadline', async () => {
    const s = setUp({ delayMs: 6 * SECOND });
    await synced(s);
    const before = s.inner.requests.length;

    const { value, ms } = await timed(s.catalog.availability(STAY));

    expect(value?.errors).toEqual([]);
    expect(value?.entries).toHaveLength(8);
    expect(s.inner.requests.slice(before)).toHaveLength(8);
    expect(s.inner.peakInFlight).toBe(1);
    // 8 requests of 6 s, 1 s apart: far beyond the unpaced 20 s, inside 20 s + 8 × (1 s + 10 s)
    expect(ms).toBeGreaterThan(DEFAULT_CATALOG_TIMINGS.availabilityTimeoutMs);
    expect(ms).toBeLessThan(20 * SECOND + 8 * 11 * SECOND);
  });

  it('a bulk search that runs past its grown deadline still times out', async () => {
    const s = setUp({ delayMs: 14 * SECOND });
    await synced(s);

    const { value, ms } = await timed(s.catalog.availability(STAY));

    // 20 s + 8 × 11 s = 108 s, well before 8 requests of 14 s (and their gaps) finish
    expect(value?.errors).toEqual([
      expect.objectContaining({
        providerId: 'paced',
        code: 'timeout',
        message: 'paced: no answer within 108 s',
      }),
    ]);
    expect(Math.round(ms)).toBe(108 * SECOND);
  });

  it("a place's detail and check wait for a request in flight and still finish inside their deadlines", async () => {
    const s = setUp({ delayMs: 12 * SECOND });
    await synced(s);

    // A background re-sync is on the wire (its 10 s gap passed) when the place page opens
    await jest.advanceTimersByTimeAsync(10 * SECOND);
    void s.catalog.refresh('paced');
    await jest.advanceTimersByTimeAsync(SECOND);
    expect(s.inner.requests).toHaveLength(2);
    const detail = await timed(s.catalog.get('paced:1'));
    const check = await timed(s.catalog.checkLocation('paced:1', STAY));

    // 11 s of the re-sync left, a 1 s gap, then 12 s: over 20 s, inside 20 s + 2 × 11 s
    expect(detail.error).toBeUndefined();
    expect(detail.value).toMatchObject({ key: 'paced:1' });
    expect(detail.value?.stale).toBeUndefined();
    expect(Math.round(detail.ms)).toBe(24 * SECOND);
    expect(check.error).toBeUndefined();
    expect(check.value?.units).toHaveLength(1);
  });

  it('get, checkLocation and availability send interactive requests, and sync sends background ones', async () => {
    const s = setUp();
    await synced(s);
    expect(priorities(s)).toEqual(['background']);

    let from = s.inner.requests.length;
    await timed(s.catalog.get('paced:2'));
    expect(priorities(s, from)).toEqual(['interactive']);

    from = s.inner.requests.length;
    await timed(s.catalog.checkLocation('paced:2', STAY));
    expect(priorities(s, from)).toEqual(['interactive']);

    from = s.inner.requests.length;
    await timed(s.catalog.availability(STAY));
    expect(priorities(s, from)).toEqual(Array(8).fill('interactive'));

    from = s.inner.requests.length;
    await timed(s.catalog.refresh('paced'));
    expect(priorities(s, from)).toEqual(['background']);
  });

  it('an interactive call goes ahead of a waiting background one', async () => {
    const s = setUp({ delayMs: 2 * SECOND });
    await synced(s);
    // The catalogue's sync ended; a forced re-sync now waits its 10 s gap
    void s.catalog.refresh('paced');
    await jest.advanceTimersByTimeAsync(SECOND);
    expect(s.inner.requests).toHaveLength(1);
    void s.catalog.get('paced:3');
    await jest.advanceTimersByTimeAsync(60 * SECOND);

    expect(s.inner.requests.map((r) => [new URL(r.url).pathname, r.priority])).toEqual([
      ['/places', 'background'],
      ['/places/3', 'interactive'],
      ['/places', 'background'],
    ]);
  });
});

describe('an unpaced provider', () => {
  it('keeps the 20 s deadline', async () => {
    const s = setUp({ intervalMs: 0, delayMs: 6 * SECOND });
    await synced(s);

    const { value, ms } = await timed(s.catalog.availability(STAY));

    expect(value?.errors).toEqual([
      expect.objectContaining({ code: 'timeout', message: 'paced: no answer within 20 s' }),
    ]);
    expect(Math.round(ms)).toBe(DEFAULT_CATALOG_TIMINGS.availabilityTimeoutMs);
  });

  it('keeps the detail and check deadlines, and sends its requests at once', async () => {
    const s = setUp({ intervalMs: 0, delayMs: 25 * SECOND });
    // The first sync of 25 s is inside its 60 s
    await synced(s);

    const detail = await timed(s.catalog.get('paced:1'));
    expect(detail.value?.stale).toBe(true);
    expect(Math.round(detail.ms)).toBe(DEFAULT_CATALOG_TIMINGS.detailTimeoutMs);
    const check = await timed(s.catalog.checkLocation('paced:1', STAY));
    expect(check.error).toMatchObject({ code: 'timeout' });
    expect(Math.round(check.ms)).toBe(DEFAULT_CATALOG_TIMINGS.availabilityTimeoutMs);
  });
});
