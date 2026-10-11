/**
 * The finders that used to take raw SQL condition strings now run explicit
 * prepared statements with every value, enums included, bound as a `?` parameter.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { insertUser, TestDatabaseHelper } from '@tests/utils/database-helper';
import {
  BookingRepository,
  NotificationRepository,
  SiteSniperRepository,
  WatchRepository,
} from '@main/database/repositories';
import { mockUserInput, mockUserInput2 } from '@tests/fixtures/users';
import { createMockWatchInput } from '@tests/fixtures/watches';
import { createMockSiteSnipeInput } from '@tests/fixtures/site-sniper';
import { NotificationType, SnipeReleaseMode, SnipeStatus } from '@shared/types/common.types';

describe('parameterised repository SQL', () => {
  let dbHelper: TestDatabaseHelper;
  let db: Database.Database;
  let userId: number;
  let otherUserId: number;

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('parameterised-sql');
    db = await dbHelper.setup();
    userId = insertUser(db, mockUserInput.email).id;
    otherUserId = insertUser(db, mockUserInput2.email).id;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await dbHelper.teardown();
  });

  /** SQL text of every statement prepared while `fn` runs. */
  function preparedSql(fn: () => void): string[] {
    const spy = jest.spyOn(db, 'prepare');
    fn();
    const sql = spy.mock.calls.map(([text]) => text);
    spy.mockRestore();
    return sql;
  }

  it('WatchRepository.findByUserId returns only that user’s watches', () => {
    const watches = new WatchRepository(db);
    const mine = watches.create(userId, createMockWatchInput({ name: 'Mine' }));
    watches.create(otherUserId, createMockWatchInput({ name: 'Theirs' }));

    expect(watches.findByUserId(userId).map((w) => w.id)).toEqual([mine.id]);
    expect(watches.findByUserId(12345)).toEqual([]);
  });

  it('WatchRepository.findActive and findDue filter by state, due time and provider', () => {
    const watches = new WatchRepository(db);
    const due = watches.create(userId, createMockWatchInput({ name: 'Due' }));
    const later = watches.create(userId, createMockWatchInput({ name: 'Later' }));
    const inactive = watches.create(userId, createMockWatchInput({ name: 'Inactive' }));
    const other = watches.create(
      userId,
      createMockWatchInput({ name: 'Other provider', providerId: 'fake' })
    );
    watches.setNextCheckAt(later.id, new Date(Date.now() + 3600_000));
    watches.deactivate(inactive.id);

    expect(watches.findActive().map((w) => w.id)).toEqual([due.id, later.id, other.id]);
    let found: number[] = [];
    const sql = preparedSql(() => {
      found = watches.findDue(new Date(), ['parkstay']).map((w) => w.id);
    });
    expect(found).toEqual([due.id]);
    // The provider ids are bound as parameters, never written into the SQL.
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('provider_id IN (?)');
    expect(sql[0]).not.toContain('parkstay');
    expect(watches.findDue(new Date(), [])).toEqual([]);
  });

  it('WatchRepository round-trips an empty unit-ids list as JSON, not NULL', () => {
    const watches = new WatchRepository(db);
    const watch = watches.create(userId, createMockWatchInput({ unitIds: [] }));

    expect(watches.findById(watch.id)?.unitIds).toEqual([]);
    expect(db.prepare('SELECT unit_ids FROM watches WHERE id = ?').get(watch.id)).toEqual({
      unit_ids: '[]',
    });
  });

  it('no repository interpolates a snipe status or release mode into SQL', () => {
    const offenders: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (/\$\{\s*Snipe(?:Status|ReleaseMode)\b/.test(fs.readFileSync(file, 'utf8'))) {
          offenders.push(entry.name);
        }
      }
    };
    visit(path.resolve(__dirname, '../../../src/main/database'));

    expect(offenders).toEqual([]);
  });

  it('SiteSniperRepository.findArmed binds the statuses as parameters', () => {
    const snipes = new SiteSniperRepository(db);
    const armed = snipes.create(userId, createMockSiteSnipeInput({ name: 'Armed' }));
    const waiting = snipes.create(userId, createMockSiteSnipeInput({ name: 'Waiting' }));
    const held = snipes.create(userId, createMockSiteSnipeInput({ name: 'Held' }));
    snipes.updateStatus(waiting.id, SnipeStatus.WAITING_RELEASE);
    snipes.updateStatus(held.id, SnipeStatus.HELD);

    let found: number[] = [];
    const sql = preparedSql(() => {
      found = snipes.findArmed().map((s) => s.id);
    });

    expect(found).toEqual([armed.id, waiting.id]);
    expect(sql).toEqual(['SELECT * FROM site_snipes WHERE is_active = 1 AND status IN (?, ?)']);
  });

  it('SiteSniperRepository.findDueForCheck binds the release mode and returns newest-first lists', () => {
    const snipes = new SiteSniperRepository(db);
    const cancellation = snipes.create(
      userId,
      createMockSiteSnipeInput({ name: 'C', releaseMode: SnipeReleaseMode.CANCELLATION })
    );
    snipes.create(userId, createMockSiteSnipeInput({ name: 'D' }));
    db.prepare("UPDATE site_snipes SET created_at = '2000-01-01 00:00:00' WHERE id = ?").run(
      cancellation.id
    );

    let due: number[] = [];
    const sql = preparedSql(() => {
      due = snipes.findDueForCheck().map((s) => s.id);
    });

    expect(due).toEqual([cancellation.id]);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('release_mode = ?');
    expect(sql[0]).not.toContain(SnipeReleaseMode.CANCELLATION);
    expect(snipes.findByUserId(userId).map((s) => s.name)).toEqual(['D', 'C']);
    expect(snipes.findById(cancellation.id)?.unitIds).toEqual(['136', '137']);
  });

  it('NotificationRepository counts and deletes with bound parameters', () => {
    const notifications = new NotificationRepository(db);
    const create = (uid: number) =>
      notifications.create({
        userId: uid,
        type: NotificationType.INFO,
        title: 't',
        message: 'm',
      });
    const read = create(userId);
    create(userId);
    create(otherUserId);
    notifications.markAsRead(read.id);
    db.prepare("UPDATE notifications SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(
      read.id
    );

    expect(notifications.getUnreadCount(userId)).toBe(1);
    expect(notifications.deleteCreatedBefore(new Date(Date.now() - 30 * 86_400_000), 100)).toBe(1);
    expect(notifications.deleteAllForUser(userId)).toBe(1);
    expect(notifications.getUnreadCount(otherUserId)).toBe(1);
  });

  it('BookingRepository reads booking_data JSON, including falsy JSON values', () => {
    const bookings = new BookingRepository(db);
    const insert = db.prepare(
      `INSERT INTO bookings (user_id, booking_reference, area_name, location_name,
         arrival_date, departure_date, num_nights, num_adults, status, booking_data)
       VALUES (?, ?, 'Park', 'Camp', '2026-01-01', '2026-01-02', 1, 2, 'confirmed', ?)`
    );
    const withData = insert.run(userId, 'REF-1', '{"gearType":"tent"}').lastInsertRowid as number;
    const withFalse = insert.run(userId, 'REF-2', 'false').lastInsertRowid as number;

    expect(bookings.findById(withData)?.bookingData).toEqual({ gearType: 'tent' });
    expect(bookings.findById(withFalse)?.bookingData).toBe(false);
  });
});
