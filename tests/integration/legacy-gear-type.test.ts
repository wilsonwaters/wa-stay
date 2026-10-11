/**
 * A 1.x watch's site type ("Unpowered") after the upgrade: migration v8 copies `site_type` into
 * `stay_params.gearType` unchanged, although ParkStay's `gearType` field only lists Any, Tent,
 * Campervan and Caravan. Like the 1.x gear CSV (U1), the value must be shown honestly and kept
 * unless the person picks another option.
 *
 * The real v5 (v1.2.0) fixture, whose watch 1 has "Unpowered", plus a hand-made watch in the
 * v1 column layout (written by 1.0, before `last_availability` and `allow_partial_match`),
 * migrated to the latest schema; the edit form's own mapping (`fromWatch`, `toWatchUpdate`)
 * with the real ParkStay manifest; and WatchService on the ParkStay module against the fixture
 * server.
 */

import type Database from 'better-sqlite3';
import { runMigrations } from '@main/database/connection';
import { SiteSniperRepository, WatchRepository } from '@main/database/repositories';
import { NightGuard } from '@main/core/holds/night-guard';
import { WatchService } from '@main/core/watches/watch.service';
import { parkstayManifest } from '@main/providers/parkstay';
import { disposeFixture, loadFixture } from '@tests/utils/database-helper';
import { FIXED_NOW } from '@tests/utils/fake-provider';
import {
  startParkStayFixtureServer,
  type ParkStayFixtureServer,
} from '@tests/utils/parkstay-fixture-server';
import { createTestParkStay } from '@tests/utils/parkstay-provider';
import { logger } from '@main/utils/logger';
import {
  fromWatch,
  toWatchUpdate,
} from '../../src/renderer/features/watches/form/watchFormMapping';

// Only `Date` is faked (2 Oct 2026), so the hand-made watch's November stay is in the future.
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

/** The v1.2.0 fixture's own watch (Osprey Bay, "Unpowered"). */
const FIXTURE_WATCH = 1;
/** The hand-made 1.0 watch (Bungarra, "Unpowered"). */
const V1_WATCH = 3;

const NOTE =
  'Camping with was saved as "Unpowered", which can\'t be checked any more, so it is now Any.';

describe('a 1.x watch with a legacy site type ("Unpowered")', () => {
  let server: ParkStayFixtureServer;
  let db: Database.Database;
  let repo: WatchRepository;
  let service: WatchService;

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
    // The fixture's known v6 foreign-key warning (repaired by v7) is not this test's subject.
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    db = loadFixture('v5-release-1.2.0');
    // As 1.0 wrote it: v1's columns only, ISO timestamps for the dates, the site type as typed
    db.prepare(
      `INSERT INTO watches (id, user_id, name, park_id, park_name, campground_id,
         campground_name, arrival_date, departure_date, num_guests, preferred_sites, site_type,
         check_interval_minutes, is_active, created_at, updated_at)
       VALUES (?, 1, 'Bungarra in November', '1', 'Cape Range National Park', '20', 'Bungarra',
         '2026-11-10T00:00:00.000Z', '2026-11-12T00:00:00.000Z', 1, NULL, 'Unpowered', 60, 1,
         '2025-06-01 00:00:00', '2025-06-01 00:00:00')`
    ).run(V1_WATCH);
    runMigrations(db);
    repo = new WatchRepository(db);
    service = new WatchService({
      watches: repo,
      providers: createTestParkStay(server).registry,
      notifications: {
        notifyWatchFound: jest.fn().mockResolvedValue(undefined),
        notifyWatchPartialFound: jest.fn().mockResolvedValue(undefined),
        notifyWatchHeld: jest.fn(),
      },
      nightGuard: new NightGuard(new SiteSniperRepository(db), repo),
    });
  });

  afterEach(() => {
    disposeFixture(db);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('is migrated unchanged into stayParams.gearType, beside the park id', () => {
    expect(repo.findById(FIXTURE_WATCH)?.stayParams).toEqual({
      parkId: '17',
      gearType: 'Unpowered',
    });
    expect(repo.findById(V1_WATCH)).toMatchObject({
      providerId: 'parkstay',
      stay: { arrival: '2026-11-10', departure: '2026-11-12', adults: 1 },
      stayParams: { parkId: '1', gearType: 'Unpowered' },
    });
    // Not one of ParkStay's options: the form cannot select it as it is.
    const gear = parkstayManifest.stayFields?.find((field) => field.key === 'gearType');
    expect(gear?.options?.map((option) => option.value)).not.toContain('Unpowered');
  });

  it.each([FIXTURE_WATCH, V1_WATCH])(
    'watch %i: the edit form shows Any and says what it was; an untouched save keeps it',
    async (id) => {
      const watch = repo.findById(id)!;
      const { values, notes } = fromWatch(watch, parkstayManifest);
      expect(values.stayParams.gearType).toBe('all');
      expect(notes.gearType).toBe(NOTE);

      // Save changes with nothing changed: nothing is sent.
      expect(toWatchUpdate(values, values, watch, parkstayManifest)).toEqual({});

      // A rename sends the name alone, and main keeps the stored value.
      const update = toWatchUpdate({ ...values, name: 'Renamed' }, values, watch, parkstayManifest);
      expect(update).toEqual({ name: 'Renamed' });
      await service.update(id, update);
      expect(repo.findById(id)).toMatchObject({
        name: 'Renamed',
        stayParams: { parkId: watch.stayParams.parkId, gearType: 'Unpowered' },
      });
    }
  );

  it('changes only when the person picks another option, keeping the park id', async () => {
    const watch = repo.findById(V1_WATCH)!;
    const { values } = fromWatch(watch, parkstayManifest);
    const picked = { ...values, stayParams: { ...values.stayParams, gearType: 'tent' } };
    const update = toWatchUpdate(picked, values, watch, parkstayManifest);
    expect(update).toEqual({ stayParams: { parkId: '1', gearType: 'tent' } });
    await service.update(V1_WATCH, update);
    expect(repo.findById(V1_WATCH)?.stayParams).toEqual({ parkId: '1', gearType: 'tent' });
  });

  it('is checked as ParkStay’s "all", what the form shows (never sent as "Unpowered")', async () => {
    await service.execute(V1_WATCH);
    const [view] = server.requestsTo('/api/campsite_availablity_view/20/');
    expect(view.query.get('gear_type')).toBe('all');
    expect(repo.findById(V1_WATCH)?.stayParams.gearType).toBe('Unpowered');
  });
});
