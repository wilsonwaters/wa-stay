/**
 * RAC snipes end to end in the core: the real JobScheduler, SiteSniperService and
 * NotificationService over the real RAC module, on an in-memory database. Its requests go
 * through the core's paced client (one at a time, 10 s apart) to a FixtureHttpClient that
 * answers from a temp copy of RAC's trimmed Busselton answer, moved to 20–21 Dec 2027 (the
 * summer 2027–28 holidays, released at 8 am Perth on 5 Feb 2027). Jest's fake timers drive the
 * clock; only the fixture file reads are real I/O, and each finishes before the clock moves on.
 *
 * It checks the timing a snipe keeps (terms rules 2 and 3): the first request at the release
 * instant, none closer than 10 s, a 30-minute window; the alert (no hold, no night guard, a
 * booking page and never a cart); a block (rule 5); sleep and resume; and a member number
 * moving the release 48 hours earlier (rule 14), or not when the pre-sale's window has passed
 * for the snipe's own 15 minutes. Nothing is sent anywhere.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import type Database from 'better-sqlite3';
import { NightGuard } from '@main/core/holds/night-guard';
import { NotificationService } from '@main/core/notifications/notification.service';
import { SiteSniperService } from '@main/core/snipes/snipe.service';
import { WatchService } from '@main/core/watches/watch.service';
import { openDatabase } from '@main/database/connection';
import {
  NotificationRepository,
  SiteSniperRepository,
  WatchRepository,
} from '@main/database/repositories';
import { createRacModules, racManifest } from '@main/providers/rac';
import { RAC_AVAILABILITY_PATH } from '@main/providers/rac/availability';
import { ProviderRegistry } from '@main/providers/registry';
import {
  createProviderContext,
  defineProvider,
  FakeSecretVault,
  InMemoryKeyValueStore,
  type HttpMethod,
  type HttpRequestOptions,
  type HttpResponse,
} from '@main/providers/sdk';
import { JobScheduler } from '@main/scheduler/job-scheduler';
import { FixtureHttpClient } from '@main/testing/fixture-http-client';
import type { SiteSnipe, SiteSnipeInput } from '@shared/types';
import { SnipeReleaseMode, SnipeResult, SnipeStatus } from '@shared/types/common.types';
import { createMemoryLogger, TEST_PROVIDERS_DIR } from '@tests/utils/fake-provider';

const RAC = 'https://parksandresorts.rac.com.au';
const RAC_FIXTURES = path.join(__dirname, '../fixtures/providers/rac');
/** The public release of the summer 2027–28 holidays at Busselton: 8 am Perth, 5 Feb 2027. */
const RELEASE = Date.parse('2027-02-05T00:00:00.000Z');
/** The members' pre-sale, 48 hours earlier. */
const PRE_SALE = Date.parse('2027-02-03T00:00:00.000Z');
const SECOND = 1_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** RAC's booking page for the powered site and the stay, in `online_booking_url`'s form. */
const POWERED_SITE_LINK =
  `${RAC}/busselton/booking/?available_from=2027-12-20&available_to=2027-12-22` +
  '&force_category_id=4&adults=2&children=0&infants=0&animals=0';

/**
 * Only the clock's timers are fake: the event loop's own turns stay real for file reads, and
 * `process.hrtime` measures how long one takes.
 */
const REAL = ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask', 'hrtime'] as const;

/** RAC's Busselton answer, moved from 6–7 Nov 2026 to 20–21 Dec 2027. */
function answer(free: boolean): string {
  const json = JSON.parse(
    fs
      .readFileSync(path.join(RAC_FIXTURES, 'availability-busselton-2026-11-06-2n.json'), 'utf8')
      .replaceAll('2026-11-06', '2027-12-20')
      .replaceAll('2026-11-07', '2027-12-21')
      .replaceAll('2026-11-08', '2027-12-22')
  ) as { data: Record<string, Record<string, unknown>> };
  if (!free) {
    // The powered site sold out too (the ensuite is already)
    Object.assign(json.data['4'], {
      sites_available: { '2027-12-20': 0, '2027-12-21': 0 },
      sites_code: { '2027-12-20': 3, '2027-12-21': 3 },
      stay_through_sites_available: 0,
      stay_through_sites_code: 3,
    });
  }
  return JSON.stringify(json);
}

/**
 * A FixtureHttpClient that also records when each request was sent (the fake clock) and how
 * many are reading their fixture file, and can change the answer before a request is sent.
 */
class RecordingFixtureClient extends FixtureHttpClient {
  readonly sentAt: number[] = [];
  inFlight = 0;
  beforeSend?: (count: number) => void;

  override async request(
    method: HttpMethod,
    url: string,
    options?: HttpRequestOptions
  ): Promise<HttpResponse> {
    this.sentAt.push(Date.now());
    this.beforeSend?.(this.sentAt.length);
    this.inFlight++;
    try {
      return await super.request(method, url, options);
    } finally {
      this.inFlight--;
    }
  }
}

let dir: string;
let http: RecordingFixtureClient;
let db: Database.Database;
let repo: SiteSniperRepository;
let snipes: SiteSniperService;
let scheduler: JobScheduler;
let nightGuard: NightGuard;
let notifications: NotificationRepository;
let power: EventEmitter;
let member: boolean;
/** When each snipe status was first emitted (fake clock). */
let statusAt: Map<SnipeStatus, number>;

/** The fixture folder: Busselton's availability route answering `file` with `status`. */
function writeFixtures(file: string, status?: number): void {
  fs.mkdirSync(path.join(dir, 'rac'), { recursive: true });
  const route = {
    method: 'POST',
    path: RAC_AVAILABILITY_PATH,
    form: { blog_id: '6', available_from: '20 Dec 2027' },
    file,
    ...(status ? { status } : {}),
  };
  fs.writeFileSync(path.join(dir, 'rac', 'manifest.json'), JSON.stringify({ routes: [route] }));
}

const setAnswer = (free: boolean) =>
  fs.writeFileSync(path.join(dir, 'rac', 'answer.json'), answer(free));

/** The services and scheduler over RAC at `now`, its requests answered from `dir`. */
function setUp(now: number): void {
  jest.useFakeTimers({ now, doNotFake: [...REAL] });
  http = new RecordingFixtureClient({
    providerId: 'rac',
    fixturesDir: dir,
    logFile: path.join(dir, 'unexpected.log'),
  });
  const registry = new ProviderRegistry();
  const factory = defineProvider(racManifest, (ctx) =>
    createRacModules(ctx, { isMember: async () => member })
  );
  // The real context: paced (10 s apart, one at a time), as in the app
  registry.register(factory, (manifest) =>
    createProviderContext(manifest, {
      createHttp: () => http,
      createState: () => new InMemoryKeyValueStore(),
      vault: new FakeSecretVault(),
      logger: createMemoryLogger(),
      providersDir: TEST_PROVIDERS_DIR,
    })
  );
  db = openDatabase(':memory:');
  repo = new SiteSniperRepository(db);
  const watchRepo = new WatchRepository(db);
  nightGuard = new NightGuard(repo, watchRepo);
  notifications = new NotificationRepository(db);
  const notifier = new NotificationService(notifications, undefined, undefined, {
    providerName: (id) => registry.tryGet(id)?.manifest.shortName,
    providerManifest: (id) => registry.tryGet(id)?.manifest,
    preferences: () => ({ desktop: false, sound: false }),
  });
  statusAt = new Map();
  const events = {
    emit: jest.fn((name: string, payload: unknown) => {
      const status = (payload as SiteSnipe).status;
      if (name === 'snipe:updated' && !statusAt.has(status)) statusAt.set(status, Date.now());
    }),
  };
  snipes = new SiteSniperService({
    snipes: repo,
    providers: registry,
    notifications: notifier,
    nightGuard,
    events,
  });
  const watches = new WatchService({
    watches: watchRepo,
    providers: registry,
    notifications: notifier,
    nightGuard,
  });
  power = new EventEmitter();
  scheduler = new JobScheduler({ watches, snipes, providers: registry, power });
}

/** Lets the fixture reads in flight finish (real I/O, up to 10 s) and what they started run. */
async function settleIo(): Promise<void> {
  const until = process.hrtime.bigint() + 10_000_000_000n;
  while (http.inFlight > 0 && process.hrtime.bigint() < until) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (http.inFlight > 0) throw new Error('A fixture read never finished');
}

/**
 * Runs the fake clock to `until` (epoch ms), timer by timer, letting each request's file read
 * finish before the clock moves on, so a check ends at the instant it started.
 */
async function runUntil(until: number): Promise<void> {
  const sentinel = setTimeout(() => undefined, Math.max(0, until - Date.now()));
  try {
    for (let i = 0; i < 100_000 && Date.now() < until; i++) {
      await settleIo();
      await jest.advanceTimersToNextTimerAsync();
    }
    for (let i = 0; i < 20; i++) {
      await settleIo();
      await jest.advanceTimersByTimeAsync(0);
    }
    await settleIo();
  } finally {
    clearTimeout(sentinel);
  }
}

/** A snipe on Busselton's powered sites, 20–22 Dec 2027, when these dates open. */
async function createSnipe(overrides: Partial<SiteSnipeInput> = {}): Promise<SiteSnipe> {
  return snipes.create(1, {
    providerId: 'rac',
    name: 'Busselton, summer holidays',
    location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
    stay: { arrival: '2027-12-20', departure: '2027-12-22', adults: 2 },
    unitKinds: ['campsite'],
    releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
    ...overrides,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-snipes-'));
  member = false;
  writeFixtures('answer.json');
  setAnswer(false);
});

afterEach(async () => {
  const stopping = scheduler?.stop();
  await jest.advanceTimersByTimeAsync(10 * SECOND);
  await stopping;
  db?.close();
  jest.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('RAC snipes (JobScheduler, fixtures, paced)', () => {
  it('armed an hour early, sends its first request at the release instant, not before', async () => {
    setUp(RELEASE - HOUR);
    const snipe = await createSnipe();
    expect(snipe.releaseAt?.toISOString()).toBe('2027-02-05T00:00:00.000Z');
    expect(snipe.action).toBe('alert');
    scheduler.start();
    await runUntil(RELEASE - 1);
    expect(repo.findById(snipe.id)?.status).toBe(SnipeStatus.WAITING_RELEASE);
    expect(http.sentAt).toEqual([]);

    await runUntil(RELEASE);
    expect(http.sentAt).toEqual([RELEASE]);
  });

  it('checks every 10 s at the fastest, even when asked for 1.5 s, and expires at release + 30 minutes, after at most 180 checks', async () => {
    setUp(RELEASE - HOUR);
    const snipe = await createSnipe({ pollIntervalMs: 1500, windowDurationMs: 60 * MINUTE });
    expect([snipe.pollIntervalMs, snipe.windowDurationMs]).toEqual([10 * SECOND, 30 * MINUTE]);
    scheduler.start();

    await runUntil(RELEASE + 30 * MINUTE - 1);
    expect(repo.findById(snipe.id)?.status).toBe(SnipeStatus.SNIPING);
    await runUntil(RELEASE + 30 * MINUTE);

    const stored = repo.findById(snipe.id)!;
    expect([stored.status, stored.lastResult]).toEqual([SnipeStatus.EXPIRED, SnipeResult.EXPIRED]);
    expect(stored.lastError).toBe('The window closed before the dates were free');
    expect(statusAt.get(SnipeStatus.EXPIRED)).toBe(RELEASE + 30 * MINUTE);
    expect(http.sentAt[0]).toBe(RELEASE);
    // At release, +10 s, … +1790 s: the 181st would be at the window's end, where it expires
    expect(http.sentAt).toHaveLength(180);
    const gaps = http.sentAt.slice(1).map((at, i) => at - http.sentAt[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(10 * SECOND);
    expect(http.sentAt.at(-1)).toBeLessThan(RELEASE + 30 * MINUTE);

    // Nothing more once it has expired
    const sent = http.sentAt.length;
    await runUntil(RELEASE + 2 * HOUR);
    expect(http.sentAt).toHaveLength(sent);
  });

  it("alerts when a unit is free on the n-th check: ALERTED, one snipe_alert with RAC's booking page, no hold and no night guard", async () => {
    setUp(RELEASE - HOUR);
    const reserve = jest.spyOn(nightGuard, 'tryReserve');
    // Sold out for three checks, then a powered site is free
    http.beforeSend = (count) => setAnswer(count >= 4);
    const snipe = await createSnipe();
    scheduler.start();
    await runUntil(RELEASE + 10 * MINUTE);

    expect(http.sentAt).toEqual([
      RELEASE,
      RELEASE + 10 * SECOND,
      RELEASE + 20 * SECOND,
      RELEASE + 30 * SECOND,
    ]);
    const stored = repo.findById(snipe.id)!;
    expect([stored.status, stored.lastResult, stored.isActive]).toEqual([
      SnipeStatus.ALERTED,
      SnipeResult.ALERTED,
      false,
    ]);
    expect(stored.alert).toMatchObject({
      unitId: 'cat:4',
      unitName: 'Powered Site',
      bookingUrl: POWERED_SITE_LINK,
    });
    expect(stored.alert?.bookingUrl).not.toMatch(/[?&]cart|rest_api_data_id/);
    expect(stored.holdReference).toBeUndefined();
    expect(reserve).not.toHaveBeenCalled();

    const sent = notifications.findByUserId(1);
    expect(sent.map((n) => [n.type, n.providerId, n.relatedId])).toEqual([
      ['snipe_alert', 'rac', snipe.id],
    ]);
  });

  it.each([
    [403, 'blocked-403.html'],
    [429, 'blocked-429.html'],
  ])('a %s ends it FAILED with the reason, and sends nothing more', async (status, page) => {
    fs.copyFileSync(path.join(RAC_FIXTURES, page), path.join(dir, 'rac', page));
    writeFixtures(page, status);
    setUp(RELEASE - HOUR);
    const snipe = await createSnipe();
    scheduler.start();
    await runUntil(RELEASE + 5 * MINUTE);

    const stored = repo.findById(snipe.id)!;
    expect([stored.status, stored.lastResult, stored.isActive]).toEqual([
      SnipeStatus.FAILED,
      SnipeResult.ERROR,
      false,
    ]);
    expect(stored.lastError).toBe(
      `RAC refused the check (HTTP ${status}). Site Sniper stopped and won't try again by itself.`
    );
    await runUntil(RELEASE + 3 * HOUR);
    expect(http.sentAt).toEqual([RELEASE]);
  });

  it('asleep through the whole window: EXPIRED at resume, with no request', async () => {
    setUp(RELEASE - HOUR);
    const snipe = await createSnipe();
    scheduler.start();
    await runUntil(RELEASE - 30 * MINUTE);
    expect(repo.findById(snipe.id)?.status).toBe(SnipeStatus.ARMED);

    // The computer sleeps: the clock moves on, no timer fires
    jest.setSystemTime(RELEASE + 31 * MINUTE);
    power.emit('resume');
    await runUntil(RELEASE + 32 * MINUTE);

    const stored = repo.findById(snipe.id)!;
    expect([stored.status, stored.lastResult]).toEqual([SnipeStatus.EXPIRED, SnipeResult.EXPIRED]);
    expect(http.sentAt).toEqual([]);
  });

  it('asleep through the release, awake inside the window: checks at once', async () => {
    setUp(RELEASE - HOUR);
    const snipe = await createSnipe();
    scheduler.start();
    await runUntil(RELEASE - 30 * MINUTE);

    jest.setSystemTime(RELEASE + 5 * MINUTE);
    power.emit('resume');
    await runUntil(RELEASE + 5 * MINUTE);

    expect(http.sentAt).toEqual([RELEASE + 5 * MINUTE]);
    expect(repo.findById(snipe.id)?.status).toBe(SnipeStatus.SNIPING);
  });

  it('a member number saved 20 minutes into a 15-minute pre-sale window keeps the public release; 10 minutes in, it checks at once', async () => {
    setUp(PRE_SALE - HOUR);
    const late = await createSnipe();
    const early = await createSnipe({ name: 'Busselton, early' });
    expect([late.releaseAt?.getTime(), late.windowDurationMs]).toEqual([RELEASE, 15 * MINUTE]);
    scheduler.start();
    await runUntil(PRE_SALE + 10 * MINUTE);

    // Saved 10 minutes in: inside the pre-sale's window, so the pre-sale, at once
    member = true;
    scheduler.rescheduleSnipe(early.id);
    await runUntil(PRE_SALE + 10 * MINUTE);
    expect(repo.findById(early.id)).toMatchObject({ status: SnipeStatus.SNIPING });
    expect(repo.findById(early.id)?.releaseAt?.getTime()).toBe(PRE_SALE);
    expect(http.sentAt).toEqual([PRE_SALE + 10 * MINUTE]);
    scheduler.unscheduleSnipe(early.id);

    // Re-armed 20 minutes in: the pre-sale's window has passed, so the public release
    await runUntil(PRE_SALE + 20 * MINUTE);
    scheduler.rescheduleSnipe(late.id);
    await runUntil(PRE_SALE + 21 * MINUTE);
    const stored = repo.findById(late.id)!;
    expect([stored.status, stored.releaseAt?.getTime()]).toEqual([SnipeStatus.ARMED, RELEASE]);
    expect(http.sentAt).toEqual([PRE_SALE + 10 * MINUTE]);
  });

  it('a member snipe asleep through the pre-sale wakes armed for the public release, not expired', async () => {
    member = true;
    setUp(PRE_SALE - HOUR);
    const snipe = await createSnipe();
    expect(snipe.releaseAt?.getTime()).toBe(PRE_SALE);
    scheduler.start();
    await runUntil(PRE_SALE - 30 * MINUTE);
    expect(repo.findById(snipe.id)?.status).toBe(SnipeStatus.ARMED);

    // Asleep from 30 minutes before the pre-sale to 20 minutes into it (its window is 15)
    jest.setSystemTime(PRE_SALE + 20 * MINUTE);
    power.emit('resume');
    await runUntil(PRE_SALE + 21 * MINUTE);
    const stored = repo.findById(snipe.id)!;
    expect([stored.status, stored.releaseAt?.getTime()]).toEqual([SnipeStatus.ARMED, RELEASE]);
    expect(http.sentAt).toEqual([]);

    await runUntil(RELEASE);
    expect(http.sentAt).toEqual([RELEASE]);
  });

  it('a member number moves the release 48 hours earlier at the next arm', async () => {
    setUp(Date.parse('2027-02-01T02:00:00.000Z'));
    const snipe = await createSnipe();
    expect(snipe.releaseAt?.getTime()).toBe(RELEASE);
    scheduler.start();
    await runUntil(Date.now() + MINUTE);
    expect(repo.findById(snipe.id)?.status).toBe(SnipeStatus.ARMED);

    member = true;
    scheduler.rescheduleSnipe(snipe.id);
    await runUntil(Date.now() + MINUTE);
    expect(repo.findById(snipe.id)?.releaseAt?.getTime()).toBe(PRE_SALE);
    expect(RELEASE - PRE_SALE).toBe(48 * HOUR);

    // And it checks at the pre-sale
    await runUntil(PRE_SALE);
    expect(http.sentAt).toEqual([PRE_SALE]);
  });
});
