/**
 * The core Site Sniper against the real ParkStay module (through its registry) and a
 * fixture server: an in-memory database, the real snipe repository, and Bungarra's live
 * sample. It covers the hold being placed, the race being lost (and won on the next tick),
 * HTTP 500, and the daily-rollover release time recomputed when a migrated snipe is armed.
 */

import type Database from 'better-sqlite3';
import { Writable } from 'stream';
import winston from 'winston';
import { openDatabase } from '@main/database/connection';
import { SiteSniperRepository } from '@main/database/repositories';
import { insertUser } from '@tests/utils/database-helper';
import { NightGuard } from '@main/core/holds/night-guard';
import { SiteSniperService } from '@main/core/snipes/snipe.service';
import { WatchRepository } from '@main/database/repositories';
import { SnipeRunner } from '@main/scheduler/snipe-runner';
import { logger } from '@main/utils/logger';
import { SnipeReleaseMode, SnipeResult, SnipeStatus } from '@shared/types/common.types';
import { FIXED_NOW } from '@tests/utils/fake-provider';
import {
  parkStayFixture,
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '@tests/utils/parkstay-fixture-server';
import {
  createTestParkStay,
  LUCKY_BAY_CLASS,
  LUCKY_BAY_STAY,
  luckyBaySites,
  luckyBayView,
  type TestParkStay,
} from '@tests/utils/parkstay-provider';

// Only `Date` is faked (2 Oct 2026), so the fixture's November stay is in the future.
const REAL_TIMERS = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

describe('SiteSniperService on ParkStay (fixture server)', () => {
  let server: ParkStayFixtureServer;
  let db: Database.Database;
  let repo: SiteSniperRepository;
  let parkstay: TestParkStay;
  let notifications: { notifySnipeHeld: jest.Mock };
  let service: SiteSniperService;
  let userId: number;

  beforeAll(async () => {
    server = await startParkStayFixtureServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: [...REAL_TIMERS] });
    server.requests.length = 0;
    server.views.clear();
    server.overrides.clear();
    server.classSites.clear();
    server.createBooking = { status: 200, body: parkStayFixture('create-booking-success.json') };
    db = openDatabase(':memory:');
    userId = insertUser(db, 'me@example.com').id;
    repo = new SiteSniperRepository(db);
    parkstay = createTestParkStay(server);
    notifications = { notifySnipeHeld: jest.fn().mockResolvedValue(undefined) };
    service = new SiteSniperService({
      snipes: repo,
      providers: parkstay.registry,
      notifications,
      nightGuard: new NightGuard(repo, new WatchRepository(db)),
    });
  });

  afterEach(() => {
    db.close();
    jest.useRealTimers();
  });

  /** A cancellation snipe on Bungarra (20) for the fixture's two nights. */
  async function bungarraSnipe(unitIds: string[] = []) {
    const snipe = await service.create(userId, {
      providerId: 'parkstay',
      name: 'Bungarra',
      location: { externalId: '20', name: 'Bungarra' },
      stay: { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 },
      unitIds,
      stayParams: { gearType: 'all', numVehicles: 1, postcode: '6000' },
      releaseMode: SnipeReleaseMode.CANCELLATION,
    });
    repo.activate(snipe.id);
    repo.updateStatus(snipe.id, SnipeStatus.SNIPING);
    return snipe;
  }

  /** One attempt, as a scheduler tick makes it. */
  async function attempt(id: number) {
    return (await service.execute(id)).result;
  }

  it('polls with ParkStay dates (no HTTP 500), finds site 3 free and places the hold', async () => {
    const snipe = await bungarraSnipe();

    const result = await attempt(snipe.id);

    expect(result).toMatchObject({
      success: true,
      result: SnipeResult.HELD,
      held: true,
      holdReference: '1234567',
      matchedSiteId: '3',
      paymentUrl: 'https://parkstay.dbca.wa.gov.au/booking/',
    });
    const poll = server.requestsTo('/api/campsite_availablity_view/20/')[0];
    expect(poll.query.get('arrival')).toBe('2026/11/10');
    expect(poll.query.get('departure')).toBe('2026/11/12');
    const hold = new URLSearchParams(server.requestsTo('/api/create_booking')[0].body);
    expect([hold.get('arrival'), hold.get('departure'), hold.get('campsite')]).toEqual([
      '2026/11/10',
      '2026/11/12',
      '3',
    ]);
    expect(hold.get('postcode')).toBe('6000');

    const stored = repo.findById(snipe.id)!;
    expect(stored).toMatchObject({
      status: SnipeStatus.HELD,
      isActive: false,
      holdReference: '1234567',
      holdUnitId: '3',
      holdExpiresAt: new Date('2026-10-02T02:30:00.000Z'),
      paymentUrl: 'https://parkstay.dbca.wa.gov.au/booking/',
    });
    expect(notifications.notifySnipeHeld).toHaveBeenCalledTimes(1);
  });

  it('holds the class for a Lucky Bay snipe kept with a site id from before #21 (#21)', async () => {
    // A fresh run (nothing in memory); the view names site 338, ParkStay takes 05 (id 313).
    server.views.set('43', luckyBayView(338));
    server.classSites.set('43', luckyBaySites(['05', '30']));
    server.classHolds.length = 0;
    const snipe = await service.create(userId, {
      providerId: 'parkstay',
      name: 'Lucky Bay',
      location: { externalId: '43', name: 'Lucky Bay (Cape Le Grand)' },
      stay: LUCKY_BAY_STAY,
      unitIds: ['350'],
      stayParams: { gearType: 'all', numVehicles: 1, postcode: '6000' },
      releaseMode: SnipeReleaseMode.CANCELLATION,
    });
    repo.activate(snipe.id);
    repo.updateStatus(snipe.id, SnipeStatus.SNIPING);

    const result = await attempt(snipe.id);

    expect(result).toMatchObject({ result: SnipeResult.HELD, matchedSiteId: LUCKY_BAY_CLASS });
    const posts = server.requestsTo('/api/create_booking');
    expect(posts).toHaveLength(1);
    const form = new URLSearchParams(posts[0].body);
    expect(form.get('campsite_class')).toBe('117');
    expect(form.has('campsite')).toBe(false);
    expect(server.classHolds).toEqual([{ campground: '43', campsiteClass: '117', site: 313 }]);
    expect(repo.findById(snipe.id)).toMatchObject({
      status: SnipeStatus.HELD,
      holdUnitId: LUCKY_BAY_CLASS,
    });
  });

  it('logs the night state of every unit it polled', async () => {
    const lines: string[] = [];
    const transport = new winston.transports.Stream({
      stream: new Writable({
        write(chunk, _encoding, done) {
          lines.push(String(chunk));
          done();
        },
      }),
      format: winston.format.printf(({ message }) => String(message)),
    });
    // Tests log at warn; this poll line is info.
    const levelBefore = logger.level;
    const quiet = logger.transports.filter((t) => !t.silent);
    quiet.forEach((t) => (t.silent = true));
    logger.add(transport);
    logger.level = 'info';
    try {
      const snipe = await bungarraSnipe(['1', '2']);
      await attempt(snipe.id);
      // Units 1 and 2 are booked both nights: nothing to hold.
      expect(repo.findById(snipe.id)!.lastResult).toBe(SnipeResult.UNAVAILABLE);
      expect(server.requestsTo('/api/create_booking')).toHaveLength(0);
      expect(lines.join('')).toContain(
        `Snipe ${snipe.id} poll: 2 unit(s), none free — CAMPSITE 01 booked/booked, CAMPSITE 02 booked/booked`
      );
    } finally {
      logger.remove(transport);
      logger.level = levelBefore;
      quiet.forEach((t) => (t.silent = false));
    }
  });

  it('records a lost race as unavailable and holds on the next tick', async () => {
    const snipe = await bungarraSnipe(['4']);
    server.createBooking = { status: 400, body: parkStayFixture('create-booking-error.json') };

    const lost = await attempt(snipe.id);
    expect(lost).toMatchObject({ success: true, result: SnipeResult.UNAVAILABLE, held: false });
    expect(lost.error).toContain("Someone hit 'Book now' before you");
    expect(repo.findById(snipe.id)).toMatchObject({ isActive: true });

    server.createBooking = { status: 200, body: parkStayFixture('create-booking-success.json') };
    const won = await attempt(snipe.id);
    expect(won).toMatchObject({ result: SnipeResult.HELD, matchedSiteId: '4' });
  });

  it('records HTTP 500 from ParkStay as an error, not as unavailable', async () => {
    const snipe = await bungarraSnipe();
    server.overrides.set('/api/campsite_availablity_view/20/', { status: 500, body: {} });

    const result = await attempt(snipe.id);

    expect(result).toMatchObject({ success: false, result: SnipeResult.ERROR, held: false });
    expect(result.error).toMatch(/HTTP 500/);
    expect(repo.findById(snipe.id)).toMatchObject({
      lastResult: SnipeResult.ERROR,
      isActive: true,
    });
  });

  it('computes a daily-rollover release from Bungarra’s release time (02:00 AWST)', async () => {
    const snipe = await service.create(userId, {
      providerId: 'parkstay',
      name: 'Bungarra rollover',
      location: { externalId: '20', name: 'Bungarra' },
      stay: { arrival: '2027-04-01', departure: '2027-04-03', adults: 2 },
      releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
    });
    expect(snipe.releaseAt?.toISOString()).toBe('2026-10-02T18:00:00.000Z');
  });

  it('re-arms a v8-migrated daily-rollover row stored at 00:00 AWST for the campground’s 02:00 release', async () => {
    // As migration v8 left it: the old midnight-AWST instant for a 1 Apr 2027 arrival
    const migrated = repo.create(userId, {
      providerId: 'parkstay',
      name: 'Bungarra rollover (migrated)',
      location: { externalId: '20', name: 'Bungarra' },
      stay: { arrival: '2027-04-01', departure: '2027-04-03', adults: 2 },
      stayParams: { gearType: 'all', numVehicles: 1 },
      releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
      releaseAt: new Date('2026-10-02T16:00:00.000Z'),
    });
    const runner = new SnipeRunner({ snipes: service });
    try {
      runner.arm(migrated.id);
      // The release time comes from Bungarra's view (02:00 AM)
      const moved = () =>
        repo.findById(migrated.id)!.releaseAt?.getTime() !== Date.parse('2026-10-02T16:00:00Z');
      for (let i = 0; i < 100 && !moved(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(repo.findById(migrated.id)).toMatchObject({
        status: SnipeStatus.ARMED,
        releaseAt: new Date('2026-10-02T18:00:00.000Z'),
      });
      expect(runner.isScheduled(migrated.id)).toBe(true);
    } finally {
      await Promise.all(runner.stop());
    }
  });

  it('expires a stale daily-rollover snipe at start-up without asking ParkStay anything (m1)', async () => {
    // Its arrival (30 Sep) has passed on 2 Oct, and Bungarra's release time is not known yet,
    // so refreshing the release would fetch the campground's view.
    const stale = repo.create(userId, {
      providerId: 'parkstay',
      name: 'Bungarra rollover (stale)',
      location: { externalId: '20', name: 'Bungarra' },
      stay: { arrival: '2026-09-30', departure: '2026-10-02', adults: 2 },
      stayParams: { gearType: 'all', numVehicles: 1 },
      releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
      releaseAt: new Date('2026-04-02T16:00:00.000Z'),
    });
    repo.activate(stale.id);
    const runner = new SnipeRunner({ snipes: service });
    try {
      runner.start();
      for (let i = 0; i < 100 && runner.isScheduled(stale.id); i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(repo.findById(stale.id)).toMatchObject({
        status: SnipeStatus.EXPIRED,
        isActive: false,
      });
      expect(runner.isScheduled(stale.id)).toBe(false);
      expect(server.requests.map((request) => request.path)).toEqual([]);
    } finally {
      await Promise.all(runner.stop());
    }
  });
});
