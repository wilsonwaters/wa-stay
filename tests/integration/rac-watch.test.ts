/**
 * RAC watches end to end in the core: the real WatchService over the real RAC module, answered
 * from the trimmed availability answers in `tests/fixtures/providers/rac/` (or a recording
 * client for a block), on an in-memory database. A Busselton watch finds the powered site and
 * alerts with RAC's booking page for it (R7); a school-holiday stay RAC refuses is never found
 * (terms rule 16); watches run every 15 minutes at most (rule 3); and a block is shown, sends
 * nothing until its cool-down ends, and never makes the watch run before its interval (rule 5).
 * Nothing is sent anywhere.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';
import { NightGuard } from '@main/core/holds/night-guard';
import { effectiveIntervalMinutes } from '@main/core/watches/next-check';
import { WatchService } from '@main/core/watches/watch.service';
import { openDatabase } from '@main/database/connection';
import { SiteSniperRepository, WatchRepository } from '@main/database/repositories';
import { racFactory, racManifest } from '@main/providers/rac';
import { RAC_BLOCK_COOLDOWN_MS } from '@main/providers/rac/client';
import { ProviderRegistry } from '@main/providers/registry';
import type { HttpClient } from '@main/providers/sdk';
import { FixtureHttpClient } from '@main/testing/fixture-http-client';
import { WatchResult } from '@shared/types/common.types';
import type { WatchInput } from '@shared/types';
import { fakeDateOnly, recordingNotifications } from '@tests/utils/core-harness';
import { createTestProviderContext } from '@tests/utils/fake-provider';
import { RecordingHttpClient, type HopAnswer } from '@tests/utils/fake-paced-provider';

const FIXTURES_DIR = path.join(__dirname, '../fixtures/providers');
const UNEXPECTED_LOG = path.join(os.tmpdir(), `rac-watch-unexpected-${process.pid}.log`);
const RAC = 'https://parksandresorts.rac.com.au';
/** 10 am in Perth, 17 Oct 2026: the day after the answers were recorded. */
const NOW = new Date('2026-10-17T02:00:00.000Z');
const MINUTE = 60_000;
const POWERED_SITE_LINK =
  `${RAC}/busselton/booking/?available_from=2026-11-06&available_to=2026-11-08` +
  '&force_category_id=4&adults=2&children=0&infants=0&animals=0';
const BUSSELTON_ANSWER = fs.readFileSync(
  path.join(FIXTURES_DIR, 'rac/availability-busselton-2026-11-06-2n.json'),
  'utf8'
);

let db: Database.Database;
let service: WatchService;
let repo: WatchRepository;
let notifications: ReturnType<typeof recordingNotifications>;

/** The WatchService over a registry holding only RAC, its requests answered by `http`. */
function setUp(http: HttpClient): void {
  const registry = new ProviderRegistry();
  registry.register(racFactory, () =>
    createTestProviderContext(racManifest, { http, clock: () => new Date() })
  );
  db = openDatabase(':memory:');
  repo = new WatchRepository(db);
  notifications = recordingNotifications();
  service = new WatchService({
    watches: repo,
    providers: registry,
    notifications,
    nightGuard: new NightGuard(new SiteSniperRepository(db), repo),
    random: () => 0,
  });
}

const fixtureHttp = (): HttpClient =>
  new FixtureHttpClient({ providerId: 'rac', fixturesDir: FIXTURES_DIR, logFile: UNEXPECTED_LOG });

function busselton(overrides: Partial<WatchInput> = {}): WatchInput {
  return {
    providerId: 'rac',
    name: 'Busselton',
    location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
    stay: { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 },
    checkIntervalMinutes: 15,
    ...overrides,
  };
}

beforeEach(() => fakeDateOnly(NOW));

afterEach(() => {
  db?.close();
  jest.useRealTimers();
});

afterAll(() => fs.rmSync(UNEXPECTED_LOG, { force: true }));

describe('RAC watches (core, fixtures)', () => {
  it("finds Busselton's powered site, with one alert whose link is RAC's booking page for it", async () => {
    setUp(fixtureHttp());
    const watch = await service.create(1, busselton({ unitKinds: ['campsite'] }));
    expect(watch.stayParams).toEqual({ pets: 0 });

    const result = await service.execute(watch.id);

    expect(result.found).toBe(true);
    expect(result.matches).toEqual([
      {
        unitId: 'cat:4',
        unitName: 'Powered Site',
        unitType: 'Sites',
        unitKind: 'campsite',
        arrival: '2026-11-06',
        departure: '2026-11-08',
        partial: false,
        // The powered site's 51 sites free for the whole stay, as Explore counts them
        freeCount: 51,
        priceKnown: true,
        total: 150,
      },
    ]);
    expect(notifications.notifyWatchFound).toHaveBeenCalledTimes(1);
    const [, found, , link] = notifications.notifyWatchFound.mock.calls[0];
    expect(found).toHaveLength(1);
    expect(link).toBe(POWERED_SITE_LINK);
    expect(link).not.toMatch(/cart|rest_api_data_id/);
    expect(notifications.notifyWatchPartialFound).not.toHaveBeenCalled();

    const stored = await service.get(watch.id);
    expect(stored?.lastResult).toBe(WatchResult.FOUND);
    // The stored units keep their counts, for the watch's card and night grid
    expect(stored?.lastAvailability?.map((unit) => [unit.unitId, unit.freeCount])).toEqual([
      ['cat:7', 0],
      ['cat:4', 51],
    ]);
    expect(stored?.bookingLink).toEqual({
      url: POWERED_SITE_LINK,
      arrival: '2026-11-06',
      departure: '2026-11-08',
    });
  });

  it('never alerts on the school-holiday stay RAC refuses (3-night minimum, no arrivals): NOT_FOUND', async () => {
    setUp(fixtureHttp());
    const watch = await service.create(
      1,
      busselton({
        name: 'School holidays',
        stay: { arrival: '2027-09-25', departure: '2027-09-27', adults: 2 },
        allowPartialMatch: true,
      })
    );

    const result = await service.execute(watch.id);

    expect([result.success, result.found, result.matches]).toEqual([true, false, []]);
    expect((await service.get(watch.id))?.lastResult).toBe(WatchResult.NOT_FOUND);
    expect(notifications.notifyWatchFound).not.toHaveBeenCalled();
    expect(notifications.notifyWatchPartialFound).not.toHaveBeenCalled();
  });

  it('refuses pets RAC never takes with VALIDATION, and keeps 0 to 2 (rule 16)', async () => {
    setUp(fixtureHttp());
    await expect(service.create(1, busselton({ stayParams: { pets: 3 } }))).rejects.toMatchObject({
      code: 'VALIDATION',
      issues: ['stayParams.pets'],
    });
    const watch = await service.create(1, busselton({ stayParams: { pets: 2 } }));
    expect(watch.stayParams).toEqual({ pets: 2 });
  });

  it('runs every 15 minutes at most, whatever the watch asks (rule 3)', async () => {
    expect(effectiveIntervalMinutes(5, racManifest)).toBe(15);
    setUp(fixtureHttp());
    const watch = await service.create(1, busselton());
    const result = await service.execute(watch.id);
    const stored = repo.findById(watch.id)!;
    expect(stored.nextCheckAt!.getTime() - result.checkedAt.getTime()).toBe(15 * MINUTE);
    expect(service.findDue(new Date(NOW.getTime() + 14 * MINUTE), ['rac'])).toEqual([]);
  });
});

describe('RAC watches when RAC turns the request away (rule 5)', () => {
  it.each<[string, HopAnswer, string]>([
    ['a 403', { status: 403, body: 'Access denied' }, 'HTTP 403'],
    ['a 429', { status: 429, body: 'Too many requests' }, 'HTTP 429'],
    [
      "Cloudflare's challenge",
      { status: 503, body: '<title>Just a moment...</title>' },
      'a security check',
    ],
  ])(
    '%s: ERROR with the reason, nothing sent until the cool-down ends, never early',
    async (_, block, why) => {
      let answer: HopAnswer = block;
      const http = new RecordingHttpClient({ providerId: 'rac', respond: () => answer });
      setUp(http);
      const watch = await service.create(1, busselton());
      const at = (minutes: number) => new Date(NOW.getTime() + minutes * MINUTE);

      // The first run is turned away: the watch shows why, and is due again in 15 minutes
      const first = await service.execute(watch.id);
      expect(first.success).toBe(false);
      const message = `RAC Parks & Resorts turned the request away (${why}). WA Stay won't ask again until 10:30 am.`;
      expect(first.error).toBe(message);
      let stored = repo.findById(watch.id)!;
      expect(stored.lastResult).toBe(WatchResult.ERROR);
      expect(stored.lastError).toBe(message);
      expect(stored.nextCheckAt).toEqual(at(15));
      expect(http.requests).toHaveLength(1);
      expect(notifications.notifyWatchFound).not.toHaveBeenCalled();

      // Not run again before its interval
      expect(service.findDue(at(14), ['rac'])).toEqual([]);

      // Due at 15 minutes, still cooling down: it fails at once and sends nothing
      jest.setSystemTime(at(15));
      expect(service.findDue(at(15), ['rac']).map((w) => w.id)).toEqual([watch.id]);
      answer = { body: BUSSELTON_ANSWER };
      const second = await service.execute(watch.id);
      expect(second.error).toBe(message);
      expect(http.requests).toHaveLength(1);
      stored = repo.findById(watch.id)!;
      expect(stored.nextCheckAt).toEqual(at(30));
      expect(service.findDue(at(29), ['rac'])).toEqual([]);

      // After the cool-down the next run asks RAC again
      jest.setSystemTime(new Date(NOW.getTime() + RAC_BLOCK_COOLDOWN_MS));
      const third = await service.execute(watch.id);
      expect(http.requests).toHaveLength(2);
      expect(third.found).toBe(true);
      expect(repo.findById(watch.id)!.lastResult).toBe(WatchResult.FOUND);
    }
  );

  it('a 520 is shown and the watch waits for its interval: no retry loop', async () => {
    const http = new RecordingHttpClient({
      providerId: 'rac',
      respond: () => ({ status: 520, body: 'Web server is returning an unknown error' }),
    });
    setUp(http);
    const watch = await service.create(1, busselton());
    const result = await service.execute(watch.id);
    expect(result.success).toBe(false);
    expect(repo.findById(watch.id)!.lastResult).toBe(WatchResult.ERROR);
    expect(http.requests).toHaveLength(1);
    expect(service.findDue(new Date(NOW.getTime() + 14 * MINUTE), ['rac'])).toEqual([]);
  });
});
