/**
 * Migration v8 (V2): the provider-aware data model, upgraded from the real v5 (v1.2.0) and
 * v6 (pre-P2 branch) fixtures and from a fresh v7 database, with P2-style full-row
 * before/after assertions on every table.
 *
 * Each fixture is loaded with `loadFixture`, then the extra rows below are inserted at the
 * fixture's own version, in its column layout, before migrating:
 * - 3 watches: written at UTC midnight, at AWST midnight (`T16:00:00.000Z`), and an inactive
 *   one with preferred sites and a site type;
 * - 2 snipes (v6 only, since `site_snipes` arrives in v6): daily rollover, and scheduled with
 *   the queue on and a held booking pk;
 * - 2 bookings, and notifications for every related type (`snipe` needs v6's CHECK).
 * The fixtures already hold a user with encrypted credentials, the SMTP notifier, a
 * `queue_session` row and settings (tests/fixtures/db/README.md).
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { disposeFixture, loadFixture } from '@tests/utils/database-helper';
import {
  FIXTURE_MACHINE_ID,
  FIXTURE_SMTP_PASSWORD,
  FixtureName,
} from '@tests/fixtures/db/constants';
import {
  closeDatabase,
  LATEST_SCHEMA_VERSION,
  MigrationError,
  openDatabase,
  runMigrations,
} from '@main/database/connection';
import {
  BookingRepository,
  LocationRepository,
  NotificationRepository,
  ProviderAccountRepository,
  ProviderStateRepository,
  SiteSniperRepository,
  UserRepository,
  WatchRepository,
} from '@main/database/repositories';
import { createLocalProfile } from '@main/app/profile';
import {
  QUEUE_SESSION_KEY,
  type StoredQueueSession,
} from '@main/providers/parkstay/queue/access-gate';
import { decryptLegacyNotifierConfig } from '@main/security/legacy-decryptors';
import { LocationSummary } from '@shared/types';
import { isCalendarDate } from '@shared/utils/calendar-date';
import { logger } from '@main/utils/logger';

jest.mock('node-machine-id', () => ({ machineIdSync: () => FIXTURE_MACHINE_ID }));

/**
 * A new database file migrated to v8 the way `openDatabase` opens one (foreign keys on, WAL).
 * These tests pin v8: v9 (V6) has its own upgrade test (`migration-v9.test.ts`).
 */
function openV8(file: string): Database.Database {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db, 8);
  return db;
}

type Row = Record<string, unknown>;
type Snapshot = Record<string, Row[]>;

const FIXTURE_VERSION: Record<FixtureName, number> = { 'v5-release-1.2.0': 5, 'v6-branch': 6 };

const V8_TABLES = [
  'bookings',
  'job_logs',
  'locations',
  'locations_fts',
  'locations_fts_config',
  'locations_fts_data',
  'locations_fts_docsize',
  'locations_fts_idx',
  'migrations',
  'notification_delivery_logs',
  'notifications',
  'notifiers',
  'provider_accounts',
  'provider_state',
  'settings',
  'site_snipes',
  'sqlite_sequence',
  'users',
  'watches',
];

const SECRET_COLUMNS = [
  'email',
  'encrypted_password',
  'encryption_key',
  'encryption_iv',
  'encryption_auth_tag',
];

// ---------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------

function version(db: Database.Database): number {
  return (db.prepare('SELECT MAX(version) AS v FROM migrations').get() as { v: number }).v;
}

function tables(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
}

/** sqlite_master with whitespace collapsed, ordered by type and name. */
function normalisedSchema(db: Database.Database) {
  return (
    db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all() as {
      type: string;
      name: string;
      tbl_name: string;
      sql: string | null;
    }[]
  ).map((o) => ({ ...o, sql: o.sql === null ? null : o.sql.replace(/\s+/g, ' ').trim() }));
}

/**
 * Every row and column of every table. sqlite_sequence is ordered by name, because table
 * rebuilds delete and re-insert its rows. The FTS index's shadow tables are internal; the
 * FTS tests check the index itself.
 */
function snapshot(db: Database.Database): Snapshot {
  return Object.fromEntries(
    tables(db)
      .filter((t) => !t.startsWith('locations_fts'))
      .map((t) => [
        t,
        db
          .prepare(`SELECT * FROM "${t}" ORDER BY ${t === 'sqlite_sequence' ? 'name' : 'rowid'}`)
          .all() as Row[],
      ])
  );
}

function byName(a: Row, b: Row): number {
  return String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0;
}

/**
 * What D(col) makes of a legacy date (independently of the SQL): an ISO instant rounds to the
 * nearest UTC midnight; values of 10 characters or fewer, and values that do not start with
 * a real date, are kept.
 */
function D(value: unknown): unknown {
  if (typeof value !== 'string' || value.length <= 10) return value;
  if (!isCalendarDate(value.slice(0, 10))) return value;
  const ms = Date.parse(value);
  return Number.isNaN(ms)
    ? value.slice(0, 10)
    : new Date(ms + 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** A stay_params JSON text: the members in order, without the NULL ones. */
function params(members: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(members).filter(([, v]) => v !== null && v !== undefined))
  );
}

const nullIfEmpty = (value: unknown): unknown => (value === '' ? null : value);

/**
 * The v7 contents of a v5 or v6 snapshot (P2's mapping, see migrations.test.ts): the notifier
 * rename, the delivery-log FK repair, Skip The Queue dropped, `site_snipes` created.
 */
function expectedAfterV7(before: Snapshot): Snapshot {
  const notificationIds = new Set(before.notifications.map((n) => n.id));
  const applied = new Set(before.migrations.map((m) => m.version));
  const { notification_providers: notifiers, skip_the_queue_entries: _dropped, ...kept } = before;
  return {
    ...kept,
    site_snipes: before.site_snipes ?? [],
    notifiers,
    notification_delivery_logs: before.notification_delivery_logs.map(
      ({ provider_channel, ...log }) => ({
        ...log,
        notification_id: notificationIds.has(log.notification_id) ? log.notification_id : null,
        notifier_channel: provider_channel,
      })
    ),
    migrations: [
      ...before.migrations,
      ...[6, 7]
        .filter((v) => !applied.has(v))
        .map((v) => ({ version: v, applied_at: expect.any(String) })),
    ],
    sqlite_sequence: before.sqlite_sequence
      .filter((s) => s.name !== 'skip_the_queue_entries')
      .map((s) => (s.name === 'notification_providers' ? { ...s, name: 'notifiers' } : s)),
  };
}

/**
 * The full v8 contents a v7 snapshot must turn into. Every table not named here
 * (users, settings, job_logs, notifiers, notification_delivery_logs) comes through
 * identical, encrypted columns byte for byte.
 */
function expectedAfterV8(v7: Snapshot): Snapshot {
  const { queue_session: queueSession = [], ...kept } = v7;
  const firstUser = v7.users[0];
  return {
    ...kept,
    watches: v7.watches.map((w) => ({
      id: w.id,
      user_id: w.user_id,
      provider_id: 'parkstay',
      name: w.name,
      location_external_id: w.campground_id,
      location_name: w.campground_name,
      area_name: w.park_name,
      arrival_date: D(w.arrival_date),
      departure_date: D(w.departure_date),
      num_adults: w.num_guests,
      num_children: 0,
      num_infants: 0,
      num_concessions: 0,
      unit_ids: w.preferred_sites ?? '[]',
      stay_params: params({ parkId: w.park_id, gearType: w.site_type }),
      check_interval_minutes: w.check_interval_minutes,
      is_active: w.is_active,
      last_checked_at: w.last_checked_at,
      next_check_at: w.next_check_at,
      last_result: w.last_result,
      found_count: w.found_count,
      // 1.x never acted on "auto-booking"; it now places holds, so it starts off (§12.31)
      auto_book: 0,
      notify_only: w.notify_only,
      allow_partial_match: w.allow_partial_match,
      max_price: w.max_price,
      notes: w.notes,
      last_availability: w.last_availability,
      created_at: w.created_at,
      updated_at: w.updated_at,
    })),
    site_snipes: v7.site_snipes.map((s) => ({
      id: s.id,
      user_id: s.user_id,
      provider_id: 'parkstay',
      name: s.name,
      location_external_id: s.campground_id,
      location_name: s.campground_name,
      area_name: null,
      unit_ids: s.target_site_ids ?? '[]',
      arrival_date: D(s.arrival_date),
      departure_date: D(s.departure_date),
      num_adults: s.num_adult,
      num_children: s.num_child,
      num_infants: s.num_infant,
      num_concessions: s.num_concession,
      stay_params: params({
        gearType: s.site_type,
        numVehicles: s.num_vehicle,
        postcode: s.postcode,
      }),
      release_mode: s.release_mode,
      release_at: s.release_at,
      access_gate_enabled: s.queue_enabled,
      lead_time_seconds: s.lead_time_seconds,
      poll_interval_ms: s.poll_interval_ms,
      window_duration_ms: s.window_duration_ms,
      status: s.status,
      is_active: s.is_active,
      attempts_count: s.attempts_count,
      max_attempts: s.max_attempts,
      last_checked_at: s.last_checked_at,
      next_check_at: s.next_check_at,
      last_result: s.last_result,
      last_error: s.last_error,
      hold_reference: s.held_booking_pk,
      hold_expires_at: s.held_expires_at,
      hold_unit_id: null,
      payment_url: s.payment_url,
      booked_reference: s.booked_reference,
      notes: s.notes,
      created_at: s.created_at,
      updated_at: s.updated_at,
    })),
    bookings: v7.bookings.map((b) => ({
      id: b.id,
      user_id: b.user_id,
      provider_id: 'parkstay',
      booking_reference: b.booking_reference,
      location_external_id: null,
      location_name: b.campground_name,
      area_name: b.park_name,
      unit_ids: b.site_number === null ? '[]' : JSON.stringify([b.site_number]),
      stay_params: params({ siteType: b.site_type }),
      arrival_date: D(b.arrival_date),
      departure_date: D(b.departure_date),
      num_nights: b.num_nights,
      num_adults: b.num_guests,
      num_children: 0,
      num_infants: 0,
      num_concessions: 0,
      total_cost: b.total_cost,
      currency: b.currency,
      status: b.status,
      booking_data: b.booking_data,
      notes: b.notes,
      created_at: b.created_at,
      updated_at: b.updated_at,
      synced_at: b.synced_at,
    })),
    notifications: v7.notifications.map((n) => ({
      ...n,
      provider_id: ['watch', 'snipe', 'booking'].includes(String(n.related_type))
        ? 'parkstay'
        : null,
    })),
    provider_accounts: firstUser
      ? [
          {
            provider_id: 'parkstay',
            status: 'unknown',
            display_name: nullIfEmpty(
              `${firstUser.first_name ?? ''} ${firstUser.last_name ?? ''}`.trim()
            ),
            email: nullIfEmpty(firstUser.email),
            last_signed_in_at: null,
            created_at: expect.any(String),
            updated_at: expect.any(String),
          },
        ]
      : [],
    provider_state: queueSession.slice(0, 1).map((q) => ({
      provider_id: 'parkstay',
      key: 'queue.session',
      value: JSON.stringify({
        sessionKey: q.session_key,
        status: q.status,
        position: q.position,
        estimatedWaitSeconds: q.estimated_wait_seconds,
        expirySeconds: q.expiry_seconds,
        expiresAt: q.expires_at,
        createdAt: q.created_at,
      }),
      updated_at: q.updated_at,
    })),
    locations: [],
    migrations: [...v7.migrations, { version: 8, applied_at: expect.any(String) }],
    sqlite_sequence: [
      ...v7.sqlite_sequence,
      // Copying into a rebuilt AUTOINCREMENT table gives it a sequence row, seq 0 when empty
      ...['users', 'watches', 'site_snipes', 'bookings']
        .filter((t) => !v7.sqlite_sequence.some((s) => s.name === t))
        .map((t) => ({ name: t, seq: 0 })),
    ].sort(byName),
  };
}

/** The extra rows, in the fixture's own (v5 or v6) column layout. */
function seedExtraRows(db: Database.Database, fixtureVersion: number): void {
  db.exec(`
    INSERT INTO watches (id, user_id, name, park_id, park_name, campground_id, campground_name,
        arrival_date, departure_date, num_guests, preferred_sites, site_type,
        check_interval_minutes, is_active, last_checked_at, next_check_at, last_result,
        found_count, auto_book, notify_only, max_price, notes, created_at, updated_at,
        last_availability, allow_partial_match)
    VALUES
      (10, 1, 'Summer at UTC midnight', '17', 'Cape Range National Park', '34', 'Osprey Bay',
        '2026-12-13T00:00:00.000Z', '2026-12-15T00:00:00.000Z', 3, NULL, NULL,
        60, 1, NULL, NULL, NULL, 0, 0, 1, NULL, NULL, '2026-01-02 03:04:05', '2026-01-02 03:04:05',
        NULL, 0),
      (11, 1, 'Summer at AWST midnight', '42', 'Cape Le Grand National Park', '88', 'Lucky Bay',
        '2026-12-12T16:00:00.000Z', '2026-12-14T16:00:00.000Z', 2, NULL, 'Powered',
        240, 1, '2026-01-03T01:00:00.000Z', '2026-01-03T05:00:00.000Z', 'not_found', 0, 0, 1,
        45.5, 'AWST write', '2026-01-03 00:00:00', '2026-01-03 01:00:00', '[]', 1),
      (12, 1, 'Paused long weekend', '17', 'Cape Range National Park', '34', 'Osprey Bay',
        '2027-01-02T00:00:00.000Z', '2027-01-05T00:00:00.000Z', 4, '["Site 7","Site 8"]',
        'Unpowered', 1440, 0, NULL, NULL, 'found', 3, 1, 0, NULL, 'Inactive', '2026-01-04 00:00:00',
        '2026-01-05 00:00:00', NULL, 0);

    INSERT INTO bookings (id, user_id, booking_reference, park_name, campground_name, site_number,
        site_type, arrival_date, departure_date, num_nights, num_guests, total_cost, currency,
        status, booking_data, notes, created_at, updated_at, synced_at)
    VALUES
      (10, 1, 'PS0099001', 'Karijini National Park', 'Dales', '21', 'Unpowered',
        '2026-12-12T16:00:00.000Z', '2026-12-15T16:00:00.000Z', 3, 2, 66, 'AUD', 'confirmed',
        '{"id":"99001"}', NULL, '2026-01-06 00:00:00', '2026-01-06 00:00:00', NULL),
      (11, 1, 'PS0099002', 'Cape Range National Park', 'Osprey Bay', NULL, NULL,
        '2027-01-02', '2027-01-04', 2, 5, NULL, 'AUD', 'pending', NULL, 'Typed in',
        '2026-01-07 00:00:00', '2026-01-07 00:00:00', NULL);

    INSERT INTO notifications (id, user_id, type, title, message, related_id, related_type,
        action_url, is_read, created_at)
    VALUES
      (10, 1, 'booking_confirmed', 'Booking Confirmed', 'PS0099001 confirmed', 10, 'booking',
        '/bookings/10', 0, '2026-01-06 00:00:01'),
      (11, 1, 'error', 'Error', 'Something failed', NULL, NULL, NULL, 1, '2026-01-06 00:00:02');
  `);

  if (fixtureVersion >= 6) {
    db.exec(`
      INSERT INTO site_snipes (id, user_id, name, campground_id, campground_name, target_site_ids,
          site_type, arrival_date, departure_date, num_adult, num_concession, num_child,
          num_infant, num_vehicle, postcode, release_mode, release_at, queue_enabled,
          lead_time_seconds, poll_interval_ms, window_duration_ms, status, is_active,
          attempts_count, max_attempts, last_checked_at, next_check_at, last_result, last_error,
          held_booking_pk, held_expires_at, payment_url, booked_reference, notes, created_at,
          updated_at)
      VALUES
        (10, 1, 'Christmas rollover', '34', 'Osprey Bay', '["136"]', 'tent',
          '2026-12-24T16:00:00.000Z', '2026-12-27T16:00:00.000Z', 2, 1, 1, 0, 2, '6530',
          'daily_rollover', '2026-06-27T16:00:00.000Z', 0, 90, 1000, 600000, 'armed', 1, 0, 0,
          NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, '2026-01-08 00:00:00',
          '2026-01-08 00:00:00'),
        (11, 1, 'Ningaloo scheduled', '120', NULL, NULL, 'all',
          '2027-02-05T00:00:00.000Z', '2027-02-07T00:00:00.000Z', 2, 0, 0, 0, 1, NULL,
          'scheduled', '2026-08-04T02:00:00.000Z', 1, 120, 1500, 900000, 'held', 0, 7, 0,
          '2026-08-04T02:00:03.000Z', NULL, 'held', NULL, '987654', '2026-08-04T02:30:03.000Z',
          'https://parkstay.dbca.wa.gov.au/booking/', NULL, NULL, '2026-01-09 00:00:00',
          '2026-08-04 02:00:03');

      INSERT INTO notifications (id, user_id, type, title, message, related_id, related_type,
          action_url, is_read, created_at)
      VALUES (12, 1, 'snipe_held', 'Site Held', 'Held at Ningaloo', 11, 'snipe',
          '/site-sniper/11', 0, '2026-08-04 02:00:04');
    `);
  }
}

/**
 * A database at v7 as P3 left a fresh install: the blank local profile (''-credentials,
 * the NOT NULL columns of v1-v7), and rows written by the v7 app.
 */
function freshV7(file: string): Database.Database {
  const db = new Database(file);
  runMigrations(db, 7);
  db.exec(`
    INSERT INTO users (id, email, encrypted_password, encryption_key, encryption_iv,
        encryption_auth_tag)
      VALUES (1, '', '', '', '', '');
    INSERT INTO notifiers (id, channel, display_name, enabled, config)
      VALUES (1, 'email_smtp', 'Email (SMTP)', 1, 'aa:bb:ccdd');
    INSERT INTO queue_session (id, session_key, status, position, estimated_wait_seconds,
        expiry_seconds, expires_at, created_at, updated_at)
      VALUES (1, 'V7SESSION', 'Waiting', 12, 240, 600, '2026-10-01T00:10:00.000Z',
        '2026-10-01T00:00:00.000Z', '2026-10-01T00:05:00.000Z');
    INSERT INTO settings (key, value, value_type, category)
      VALUES ('notifications.desktop', 'true', 'boolean', 'notifications');
  `);
  seedExtraRows(db, 7);
  return db;
}

// ---------------------------------------------------------------------------------------
// Upgrades from the v5 and v6 fixtures
// ---------------------------------------------------------------------------------------

describe.each<FixtureName>(['v5-release-1.2.0', 'v6-branch'])(
  'migration v8 from the %s fixture',
  (fixture) => {
    let db: Database.Database;
    let before: Snapshot;

    beforeEach(() => {
      db = loadFixture(fixture);
      seedExtraRows(db, FIXTURE_VERSION[fixture]);
      before = snapshot(db);
      runMigrations(db, 8);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      disposeFixture(db);
    });

    it('reaches v8 and maps every row and column of every table (full-row)', () => {
      // The seeding is not vacuous
      expect(before.watches.length).toBe(5);
      expect(before.bookings.length).toBe(4);
      expect(before.queue_session).toHaveLength(1);

      expect(version(db)).toBe(8);
      expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(8);
      expect(tables(db)).toEqual(V8_TABLES);
      expect(snapshot(db)).toEqual(expectedAfterV8(expectedAfterV7(before)));
    });

    it('passes foreign_key_check and integrity_check, and leaves no temp or aside names', () => {
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(
        db
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE name LIKE '%\\_v8' ESCAPE '\\' OR name LIKE '%\\_old' ESCAPE '\\'
                OR sql LIKE '%\\_v8%' ESCAPE '\\' OR sql LIKE '%\\_old%' ESCAPE '\\'`
          )
          .all()
      ).toEqual([]);
      for (const table of ['watches', 'site_snipes', 'bookings', 'notifications']) {
        expect(db.pragma(`foreign_key_list(${table})`)).toEqual([
          expect.objectContaining({ table: 'users', from: 'user_id', on_delete: 'CASCADE' }),
        ]);
      }
    });

    it('changes nothing when run a second time, staying at v8', () => {
      const schema = normalisedSchema(db);
      const data = snapshot(db);

      expect(() => runMigrations(db, 8)).not.toThrow();
      expect(version(db)).toBe(8);
      expect(normalisedSchema(db)).toEqual(schema);
      expect(snapshot(db)).toEqual(data);
    });

    it('stores the same calendar day for watches written at UTC midnight and at AWST midnight', () => {
      const dates = db
        .prepare('SELECT id, arrival_date, departure_date FROM watches WHERE id IN (10, 11, 12)')
        .all();
      expect(dates).toEqual([
        { id: 10, arrival_date: '2026-12-13', departure_date: '2026-12-15' },
        { id: 11, arrival_date: '2026-12-13', departure_date: '2026-12-15' },
        { id: 12, arrival_date: '2027-01-02', departure_date: '2027-01-05' },
      ]);
      // Every stay date is now a calendar date
      for (const table of ['watches', 'site_snipes', 'bookings']) {
        const rows = db.prepare(`SELECT arrival_date, departure_date FROM ${table}`).all() as {
          arrival_date: string;
          departure_date: string;
        }[];
        for (const row of rows) {
          expect(isCalendarDate(row.arrival_date)).toBe(true);
          expect(isCalendarDate(row.departure_date)).toBe(true);
        }
      }
    });

    it('labels every watch ParkStay and maps its location, area, stay params and units', () => {
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM watches WHERE provider_id <> 'parkstay'").get()
      ).toEqual({ n: 0 });
      const legacy = new Map(before.watches.map((w) => [w.id, w]));
      const rows = db.prepare('SELECT * FROM watches').all() as Row[];
      for (const row of rows) {
        const old = legacy.get(row.id)!;
        expect(row.location_external_id).toBe(old.campground_id);
        expect(row.area_name).toBe(old.park_name);
        expect(row.unit_ids).toBe(old.preferred_sites ?? '[]');
      }
      expect(db.prepare('SELECT stay_params, unit_ids FROM watches WHERE id = 12').get()).toEqual({
        stay_params: '{"parkId":"17","gearType":"Unpowered"}',
        unit_ids: '["Site 7","Site 8"]',
      });
      expect(db.prepare('SELECT stay_params FROM watches WHERE id = 10').get()).toEqual({
        stay_params: '{"parkId":"17"}',
      });
    });

    it('makes bookings unique per provider, not per reference', () => {
      const insert = db.prepare(
        `INSERT INTO bookings (user_id, provider_id, booking_reference, location_name,
           arrival_date, departure_date, num_nights, num_adults, status)
         VALUES (1, ?, 'PS0012345', 'Elsewhere', '2027-03-01', '2027-03-02', 1, 2, 'confirmed')`
      );

      expect(() => insert.run('fake')).not.toThrow();
      expect(() => insert.run('parkstay')).toThrow(
        /UNIQUE constraint failed: bookings.provider_id, bookings.booking_reference/
      );
      expect(
        db
          .prepare(
            "SELECT unit_ids, stay_params FROM bookings WHERE booking_reference = 'PS0099001'"
          )
          .get()
      ).toEqual({ unit_ids: '["21"]', stay_params: '{"siteType":"Unpowered"}' });
    });

    it('creates the ParkStay account from the fixture user and keeps the user byte-identical', () => {
      expect(db.prepare('SELECT * FROM provider_accounts').all()).toEqual([
        expect.objectContaining({
          provider_id: 'parkstay',
          status: 'unknown',
          display_name: 'Fixture User',
          email: 'fixture.user@example.com',
          last_signed_in_at: null,
        }),
      ]);

      const columns = ['id', 'first_name', 'last_name', 'phone', ...SECRET_COLUMNS].join(', ');
      expect(db.prepare(`SELECT ${columns} FROM users`).all()).toEqual(
        before.users.map((u) =>
          Object.fromEntries(
            ['id', 'first_name', 'last_name', 'phone', ...SECRET_COLUMNS].map((c) => [c, u[c]])
          )
        )
      );
      // The credential columns are nullable now; the profile row is the same single row
      const notNull = (db.pragma('table_info(users)') as { name: string; notnull: number }[])
        .filter((c) => SECRET_COLUMNS.includes(c.name))
        .map((c) => c.notnull);
      expect(notNull).toEqual([0, 0, 0, 0, 0]);
      expect(createLocalProfile(new UserRepository(db)).requireUserId()).toBe(1);
      expect(createLocalProfile(new UserRepository(db)).ensureLocalProfile()).toBe(1);
      expect(count(db, 'users')).toBe(1);
    });

    it('moves the queue session into provider_state and drops queue_session', () => {
      expect(tables(db)).not.toContain('queue_session');
      const state = db
        .prepare(
          "SELECT value FROM provider_state WHERE provider_id = 'parkstay' AND key = 'queue.session'"
        )
        .get() as { value: string };
      expect(JSON.parse(state.value)).toMatchObject({
        sessionKey: 'FIXTURESESSIONKEY00000000000000000000000000000000000',
      });

      // The shape the ParkStay access gate reads back (`StoredQueueSession`)
      const session = queueSession(db);
      expect(session?.value).toEqual({
        sessionKey: 'FIXTURESESSIONKEY00000000000000000000000000000000000',
        status: 'Active',
        position: 0,
        estimatedWaitSeconds: 0,
        expirySeconds: 600,
        expiresAt: '2025-11-06T04:10:00.000Z',
        createdAt: '2025-11-06T04:00:00.000Z',
      } satisfies StoredQueueSession);
      expect(session?.updatedAt.toISOString()).toBe('2025-11-06T04:00:00.000Z');
    });

    it('labels notifications about a watch, snipe or booking ParkStay, and no others', () => {
      const rows = db
        .prepare('SELECT related_type, provider_id FROM notifications ORDER BY id')
        .all() as { related_type: string | null; provider_id: string | null }[];
      expect(rows.length).toBe(before.notifications.length);
      for (const row of rows) {
        const about = ['watch', 'snipe', 'booking'].includes(String(row.related_type));
        expect(row.provider_id).toBe(about ? 'parkstay' : null);
      }
      expect(rows.map((r) => r.related_type)).toEqual(
        expect.arrayContaining(['watch', 'booking', 'stq', null])
      );
      const info = new NotificationRepository(db).findById(2);
      expect(info).toMatchObject({ type: 'info' });
      expect(info?.providerId).toBeUndefined();
      expect(new NotificationRepository(db).findById(1)?.providerId).toBe('parkstay');
    });

    it('keeps the notifier config ciphertext byte-identical and still decryptable', () => {
      expect(db.prepare('SELECT * FROM notifiers').all()).toEqual(before.notification_providers);

      // The schema migration leaves the legacy ciphertext alone; migrateLegacySecrets (P5)
      // converts it afterwards, when the container is built
      const { config } = db.prepare('SELECT config FROM notifiers').get() as { config: string };
      expect(JSON.parse(decryptLegacyNotifierConfig(config, FIXTURE_MACHINE_ID))).toMatchObject({
        auth: { user: 'fixture.user@example.com', pass: FIXTURE_SMTP_PASSWORD },
      });
    });

    it('keeps the settings rows unchanged', () => {
      expect(db.prepare('SELECT * FROM settings ORDER BY rowid').all()).toEqual(before.settings);
    });

    it('reads the migrated rows through the repositories as provider-aware domain objects', () => {
      const awst = new WatchRepository(db).findById(11);
      expect(awst).toMatchObject({
        providerId: 'parkstay',
        locationKey: 'parkstay:88',
        location: {
          externalId: '88',
          name: 'Lucky Bay',
          areaName: 'Cape Le Grand National Park',
        },
        stay: {
          arrival: '2026-12-13',
          departure: '2026-12-15',
          adults: 2,
          children: 0,
          infants: 0,
          concessions: 0,
        },
        unitIds: [],
        stayParams: { parkId: '42', gearType: 'Powered' },
        isActive: true,
        allowPartialMatch: true,
        maxPrice: 45.5,
        lastAvailability: [],
      });
      expect(awst?.lastCheckedAt?.toISOString()).toBe('2026-01-03T01:00:00.000Z');
      expect(new WatchRepository(db).findById(1)?.unitIds).toEqual(['136', '137']);

      const booking = new BookingRepository(db).findByReference('parkstay', 'PS0099001');
      expect(booking).toMatchObject({
        providerId: 'parkstay',
        location: { name: 'Dales', areaName: 'Karijini National Park' },
        stay: { arrival: '2026-12-13', departure: '2026-12-16', adults: 2 },
        unitIds: ['21'],
        stayParams: { siteType: 'Unpowered' },
        numNights: 3,
        bookingData: { id: '99001' },
      });
      expect(booking?.locationKey).toBeUndefined();
      expect(new BookingRepository(db).findByReference('fake', 'PS0099001')).toBeNull();

      expect(new ProviderAccountRepository(db).get('parkstay')).toMatchObject({
        providerId: 'parkstay',
        status: 'unknown',
        displayName: 'Fixture User',
        email: 'fixture.user@example.com',
      });
    });
  }
);

/** The DBCA queue session as migration v8 stores it for the ParkStay access gate. */
function queueSession(db: Database.Database) {
  return new ProviderStateRepository(db).getEntry<StoredQueueSession>(
    'parkstay',
    QUEUE_SESSION_KEY
  );
}

describe('migration v8 of the v6 fixture snipes', () => {
  let db: Database.Database;
  let before: Snapshot;

  beforeEach(() => {
    db = loadFixture('v6-branch');
    seedExtraRows(db, 6);
    before = snapshot(db);
    runMigrations(db, 8);
  });

  afterEach(() => disposeFixture(db));

  it('keeps release mode, release time, status and attempts, and maps the queue and hold', () => {
    const scheduled = db.prepare('SELECT * FROM site_snipes WHERE id = 11').get() as Row;
    const legacy = before.site_snipes.find((s) => s.id === 11)!;

    expect(scheduled).toMatchObject({
      release_mode: legacy.release_mode,
      release_at: legacy.release_at,
      status: legacy.status,
      attempts_count: legacy.attempts_count,
      access_gate_enabled: 1,
      hold_reference: '987654',
      hold_expires_at: '2026-08-04T02:30:03.000Z',
      hold_unit_id: null,
      location_name: null,
      unit_ids: '[]',
      arrival_date: '2027-02-05',
      departure_date: '2027-02-07',
    });
    expect(scheduled).toMatchObject({
      release_mode: 'scheduled',
      release_at: '2026-08-04T02:00:00.000Z',
      status: 'held',
      attempts_count: 7,
    });
  });

  it('keeps the vehicles, postcode and gear type in stay_params', () => {
    const rollover = db.prepare('SELECT * FROM site_snipes WHERE id = 10').get() as Row;
    expect(JSON.parse(String(rollover.stay_params))).toEqual({
      gearType: 'tent',
      numVehicles: 2,
      postcode: '6530',
    });
    expect(rollover).toMatchObject({
      arrival_date: '2026-12-25',
      departure_date: '2026-12-28',
      num_adults: 2,
      num_children: 1,
      num_infants: 0,
      num_concessions: 1,
      access_gate_enabled: 0,
      unit_ids: '["136"]',
    });

    const snipe = new SiteSniperRepository(db).findById(11);
    expect(snipe).toMatchObject({
      accessGateEnabled: true,
      holdReference: '987654',
      location: { externalId: '120', name: '' },
      stayParams: { gearType: 'all', numVehicles: 1 },
    });
    expect(snipe?.holdExpiresAt?.toISOString()).toBe('2026-08-04T02:30:03.000Z');
  });

  it('accepts a release mode outside the old CHECK', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO site_snipes (user_id, provider_id, name, location_external_id,
             arrival_date, departure_date, release_mode)
           VALUES (1, 'fake', 'Custom', 'x1', '2027-03-01', '2027-03-02', 'custom')`
        )
        .run()
    ).not.toThrow();
    expect(
      db.prepare("SELECT release_mode FROM site_snipes WHERE location_external_id = 'x1'").get()
    ).toEqual({ release_mode: 'custom' });
  });
});

// ---------------------------------------------------------------------------------------
// A fresh v7 database (P3's blank profile) and fresh installs
// ---------------------------------------------------------------------------------------

describe('migration v8 of a fresh v7 database', () => {
  let tmpDir: string;
  let db: Database.Database;
  let before: Snapshot;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-v8-'));
    db = freshV7(path.join(tmpDir, 'v7.db'));
    before = snapshot(db);
    runMigrations(db, 8);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('maps every row and column of every table (full-row)', () => {
    expect(version(db)).toBe(8);
    expect(tables(db)).toEqual(V8_TABLES);
    expect(snapshot(db)).toEqual(expectedAfterV8(before));
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('keeps the blank profile as it is and creates a ParkStay account with no email or name', () => {
    expect(db.prepare(`SELECT id, ${SECRET_COLUMNS.join(', ')} FROM users`).all()).toEqual([
      {
        id: 1,
        email: '',
        encrypted_password: '',
        encryption_key: '',
        encryption_iv: '',
        encryption_auth_tag: '',
      },
    ]);
    expect(
      db.prepare('SELECT provider_id, display_name, email FROM provider_accounts').all()
    ).toEqual([{ provider_id: 'parkstay', display_name: null, email: null }]);
    expect(queueSession(db)?.value).toMatchObject({ sessionKey: 'V7SESSION', position: 12 });
  });
});

describe('migration v8 on a fresh install', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-v8-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates exactly the local profile row (id 1, no credentials) and no account', () => {
    const db = openV8(path.join(tmpDir, 'fresh.db'));
    try {
      expect(version(db)).toBe(8);
      expect(tables(db)).toEqual(V8_TABLES);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(db.prepare('SELECT * FROM users').all()).toEqual([
        expect.objectContaining({
          id: 1,
          email: null,
          encrypted_password: null,
          encryption_key: null,
          encryption_iv: null,
          encryption_auth_tag: null,
          first_name: null,
          last_name: null,
          phone: null,
        }),
      ]);
      expect(createLocalProfile(new UserRepository(db)).requireUserId()).toBe(1);
      expect(count(db, 'provider_accounts')).toBe(0);
      expect(count(db, 'provider_state')).toBe(0);
    } finally {
      closeDatabase(db);
    }
  });

  it('produces the same normalised schema as the migrated v5, v6 and fresh-v7 databases', () => {
    const fresh = openV8(path.join(tmpDir, 'fresh.db'));
    const v5 = loadFixture('v5-release-1.2.0');
    const v6 = loadFixture('v6-branch');
    const v7 = freshV7(path.join(tmpDir, 'v7.db'));
    try {
      runMigrations(v5, 8);
      runMigrations(v6, 8);
      runMigrations(v7, 8);

      const expected = normalisedSchema(fresh);
      expect(expected.length).toBeGreaterThan(50);
      expect(normalisedSchema(v5)).toEqual(expected);
      expect(normalisedSchema(v6)).toEqual(expected);
      expect(normalisedSchema(v7)).toEqual(expected);
    } finally {
      closeDatabase(fresh);
      disposeFixture(v5);
      disposeFixture(v6);
      v7.close();
    }
  });
});

// ---------------------------------------------------------------------------------------
// Atomicity
// ---------------------------------------------------------------------------------------

describe('migration v8 atomicity', () => {
  it('rolls back completely when a step fails mid-way, leaving the database at v7', () => {
    const db = loadFixture('v6-branch');
    try {
      runMigrations(db, 7);
      // Squat on the bookings rebuild's temp name: v8 fails after rebuilding users, watches
      // and site_snipes in the same transaction.
      db.exec('CREATE TABLE bookings_v8 (id INTEGER PRIMARY KEY)');
      const schema = normalisedSchema(db);
      const data = snapshot(db);

      let thrown: unknown;
      try {
        runMigrations(db, 8);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(MigrationError);
      expect((thrown as MigrationError).version).toBe(8);
      expect((thrown as Error).message).toMatch(/bookings_v8 already exists/);
      expect(version(db)).toBe(7);
      expect(normalisedSchema(db)).toEqual(schema);
      expect(snapshot(db)).toEqual(data);
      expect(db.prepare('SELECT * FROM watches ORDER BY id').all()).toEqual(data.watches);
      expect(tables(db)).toContain('queue_session');
      expect(tables(db)).not.toContain('provider_state');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);

      // The next start resumes from v7
      db.exec('DROP TABLE bookings_v8');
      runMigrations(db, 8);
      expect(version(db)).toBe(8);
    } finally {
      disposeFixture(db);
    }
  });

  it('keeps AUTOINCREMENT high-water marks across the v8 table rebuilds', () => {
    const db = loadFixture('v6-branch');
    try {
      db.exec(`
        UPDATE sqlite_sequence SET seq = 40 WHERE name = 'users';
        UPDATE sqlite_sequence SET seq = 50 WHERE name = 'watches';
        UPDATE sqlite_sequence SET seq = 60 WHERE name = 'site_snipes';
        UPDATE sqlite_sequence SET seq = 70 WHERE name = 'bookings';
      `);

      runMigrations(db, 8);

      const seq = (name: string) =>
        (db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(name) as { seq: number })
          .seq;
      expect([seq('users'), seq('watches'), seq('site_snipes'), seq('bookings')]).toEqual([
        40, 50, 60, 70,
      ]);
    } finally {
      disposeFixture(db);
    }
  });

  it('recreates the indexes and update_*_timestamp triggers of the rebuilt tables', () => {
    const db = loadFixture('v5-release-1.2.0');
    try {
      runMigrations(db, 8);
      const names = (type: string) =>
        (
          db.prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name').all(type) as {
            name: string;
          }[]
        ).map((r) => r.name);

      expect(names('trigger')).toEqual(
        expect.arrayContaining([
          'update_users_timestamp',
          'update_watches_timestamp',
          'update_site_snipes_timestamp',
          'update_bookings_timestamp',
          'locations_fts_insert',
          'locations_fts_update',
          'locations_fts_delete',
        ])
      );
      expect(names('index')).toEqual(
        expect.arrayContaining([
          'idx_users_email',
          'idx_watches_provider_active',
          'idx_bookings_provider_arrival',
          'idx_notifications_provider_id',
          'idx_locations_provider',
          'idx_locations_kind',
          'idx_locations_booking_mode',
          'idx_locations_region',
          'idx_locations_lat_lng',
          'idx_snipe_release_at',
        ])
      );

      db.prepare("UPDATE watches SET updated_at = '2000-01-01 00:00:00' WHERE id = 1").run();
      db.prepare("UPDATE watches SET name = 'Renamed' WHERE id = 1").run();
      expect(
        (db.prepare('SELECT updated_at FROM watches WHERE id = 1').get() as { updated_at: string })
          .updated_at
      ).not.toBe('2000-01-01 00:00:00');
    } finally {
      disposeFixture(db);
    }
  });
});

// ---------------------------------------------------------------------------------------
// Locations and FTS5
// ---------------------------------------------------------------------------------------

describe('locations and its FTS5 index', () => {
  let tmpDir: string;
  let db: Database.Database;
  let locations: LocationRepository;

  const summary = (externalId: string, name: string, extra: Partial<LocationSummary> = {}) =>
    ({
      key: `fake:${externalId}`,
      providerId: 'fake',
      externalId,
      name,
      kind: 'campground',
      bookingMode: 'online',
      lat: -31.95,
      lng: 115.86,
      imageUrls: [],
      amenities: ['toilets'],
      ...extra,
    }) as LocationSummary;

  const fts = (query: string): string[] =>
    (
      db
        .prepare(
          `SELECT l.external_id FROM locations_fts
           JOIN locations l ON l.rowid = locations_fts.rowid
           WHERE locations_fts MATCH ? ORDER BY l.external_id`
        )
        .all(query) as { external_id: string }[]
    ).map((r) => r.external_id);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-v8-fts-'));
    db = openDatabase(path.join(tmpDir, 'fts.db'));
    locations = new LocationRepository(db);
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is available in the bundled SQLite (the migration never skips it)', () => {
    expect(db.pragma('compile_options', { simple: false })).toEqual(
      expect.arrayContaining([{ compile_options: 'ENABLE_FTS5' }])
    );
    expect(tables(db)).toContain('locations_fts');
  });

  it('finds an upserted location by prefix, and forgets it when a re-upsert leaves it out', () => {
    const fetchedAt = new Date('2026-10-01T00:00:00.000Z');
    const result = locations.upsertMany(
      'fake',
      [
        summary('a', 'Bungle Bungle Camp', { area: { name: 'Purnululu', region: 'Kimberley' } }),
        summary('b', 'Lucky Bay'),
        summary('c', 'Osprey Bay', { summary: 'Ningaloo reef camp' }),
      ],
      fetchedAt
    );
    expect(result).toEqual({ upserted: 3, deleted: 0 });

    expect(fts('bung*')).toEqual(['a']);
    expect(fts('kimberley')).toEqual(['a']);
    expect(fts('ningaloo')).toEqual(['c']);

    const second = locations.upsertMany(
      'fake',
      [summary('b', 'Lucky Bay'), summary('c', 'Osprey Bay')],
      fetchedAt
    );
    expect(second).toEqual({ upserted: 2, deleted: 1 });
    expect(fts('bung*')).toEqual([]);
    expect(locations.get('fake', 'a')).toBeNull();
    expect(locations.countByProvider()).toEqual({ fake: 2 });
    expect(() =>
      db.prepare("INSERT INTO locations_fts (locations_fts) VALUES ('integrity-check')").run()
    ).not.toThrow();
  });

  it('keeps the index in step with renames, and keeps a cached detail across re-upserts', () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    locations.upsertMany('fake', [summary('a', 'Bungle Bungle Camp')], at);
    expect(
      locations.setDetail(
        'fake',
        'a',
        { ...summary('a', 'Bungle Bungle Camp'), units: [], descriptionHtml: '<p>Red domes</p>' },
        at
      )
    ).toBe(true);

    locations.upsertMany('fake', [summary('a', 'Walardi Camp')], at);

    expect(fts('bung*')).toEqual([]);
    expect(fts('walardi')).toEqual(['a']);
    expect(locations.getDetail('fake', 'a')).toMatchObject({
      detail: { descriptionHtml: '<p>Red domes</p>' },
      fetchedAt: at,
    });
    expect(locations.get('fake', 'a')).toMatchObject({
      key: 'fake:a',
      name: 'Walardi Camp',
      amenities: ['toilets'],
      imageUrls: [],
    });
    expect(locations.setDetail('fake', 'missing', { ...summary('x', 'X'), units: [] }, at)).toBe(
      false
    );
  });

  it("keeps each provider's catalogue separate and refuses another provider's location", () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    locations.upsertMany('fake', [summary('a', 'Bungle Bungle Camp')], at);
    locations.upsertMany(
      'parkstay',
      [{ ...summary('a', 'Osprey Bay'), key: 'parkstay:a', providerId: 'parkstay' }],
      at
    );
    locations.upsertMany('fake', [], at);

    expect(locations.countByProvider()).toEqual({ parkstay: 1 });
    expect(() =>
      locations.upsertMany('fake', [{ ...summary('b', 'B'), providerId: 'other' }], at)
    ).toThrow(/does not belong to provider fake/);
  });
});

// ---------------------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------------------

describe('migration v8 edge cases', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = loadFixture('v6-branch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    disposeFixture(db);
  });

  it('copies a date it cannot read unchanged, counts it in a warning, and the repository surfaces it', () => {
    db.exec(`
      UPDATE watches SET arrival_date = 'garbage' WHERE id = 2;
      UPDATE watches SET departure_date = '' WHERE id = 1;
    `);
    const warn = jest.spyOn(logger, 'warn');

    runMigrations(db, 8);

    expect(db.prepare('SELECT id, arrival_date, departure_date FROM watches').all()).toEqual([
      { id: 1, arrival_date: '2026-04-03', departure_date: '' },
      { id: 2, arrival_date: 'garbage', departure_date: '2026-06-03' },
    ]);
    expect(warn).toHaveBeenCalledWith(
      'Migration 008: 2 watches row(s) have an arrival or departure that is not a calendar date (YYYY-MM-DD); copied unchanged'
    );
    expect(new WatchRepository(db).findById(2)?.stay.arrival).toBe('garbage');
  });

  it('turns auto-hold off for an active 1.x watch that had "auto-booking" ticked (it never acted)', () => {
    db.exec(`UPDATE watches SET auto_book = 1, is_active = 1, notify_only = 0`);

    runMigrations(db, 8);

    const watches = new WatchRepository(db);
    for (const { id } of db.prepare('SELECT id FROM watches').all() as { id: number }[]) {
      expect(watches.findById(id)).toMatchObject({ isActive: true, autoHold: false });
    }
  });

  it('turns NULL or empty preferred sites into [] and keeps malformed JSON verbatim, read as []', () => {
    db.exec(`
      UPDATE watches SET preferred_sites = '[]' WHERE id = 1;
      UPDATE watches SET preferred_sites = 'Site 1, Site 2' WHERE id = 2;
      UPDATE site_snipes SET target_site_ids = NULL WHERE id = 1;
    `);
    runMigrations(db, 8);

    expect(db.prepare('SELECT id, unit_ids FROM watches').all()).toEqual([
      { id: 1, unit_ids: '[]' },
      { id: 2, unit_ids: 'Site 1, Site 2' },
    ]);
    expect(db.prepare('SELECT unit_ids FROM site_snipes').get()).toEqual({ unit_ids: '[]' });

    const warn = jest.spyOn(logger, 'warn');
    expect(new WatchRepository(db).findById(2)?.unitIds).toEqual([]);
    expect(warn).toHaveBeenCalledWith('watches 2: unit_ids is not a JSON array; read as []');
  });

  it('with no users (never signed in): creates no account, then the empty local profile', () => {
    runMigrations(db, 7);
    // An install that never stored credentials has no users row, and so no rows of its own
    db.pragma('foreign_keys = ON');
    db.exec('DELETE FROM users');
    expect(count(db, 'watches')).toBe(0);

    runMigrations(db, 8);

    expect(count(db, 'provider_accounts')).toBe(0);
    expect(db.prepare('SELECT id, email, encrypted_password FROM users').all()).toEqual([
      { id: 1, email: null, encrypted_password: null },
    ]);
    expect(createLocalProfile(new UserRepository(db)).requireUserId()).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('with two users: only the first becomes the ParkStay account, with a warning', () => {
    db.exec(`
      INSERT INTO users (id, email, encrypted_password, encryption_key, encryption_iv,
          encryption_auth_tag, first_name, last_name)
        VALUES (2, 'second@example.com', 'p2', 'k2', 'iv2', 'tag2', 'Second', 'User');
    `);
    const warn = jest.spyOn(logger, 'warn');

    runMigrations(db, 8);

    expect(db.prepare('SELECT provider_id, email FROM provider_accounts').all()).toEqual([
      { provider_id: 'parkstay', email: 'fixture.user@example.com' },
    ]);
    expect(count(db, 'users')).toBe(2);
    expect(warn).toHaveBeenCalledWith(
      'Migration 008: 2 users rows; only the first becomes the ParkStay account'
    );
  });

  it('gives an account with no name a NULL display name', () => {
    db.exec("UPDATE users SET first_name = NULL, last_name = '  '");

    runMigrations(db, 8);

    expect(db.prepare('SELECT display_name, email FROM provider_accounts').get()).toEqual({
      display_name: null,
      email: 'fixture.user@example.com',
    });
  });

  it('skips an empty queue_session, and still migrates an expired session', () => {
    db.exec('DELETE FROM queue_session');
    runMigrations(db, 8);
    expect(count(db, 'provider_state')).toBe(0);
    expect(tables(db)).not.toContain('queue_session');

    // The fixture session expired in 2025; V3 discards it, v8 still moves it.
    const expired = loadFixture('v5-release-1.2.0');
    try {
      runMigrations(expired, 8);
      expect(queueSession(expired)?.value).toMatchObject({
        sessionKey: 'FIXTURESESSIONKEY00000000000000000000000000000000000',
      });
    } finally {
      disposeFixture(expired);
    }
  });

  it('skips a missing queue_session table', () => {
    runMigrations(db, 7);
    db.exec('DROP TABLE queue_session');

    runMigrations(db, 8);

    expect(version(db)).toBe(8);
    expect(count(db, 'provider_state')).toBe(0);
  });

  it('tolerates a provider_state table left by an earlier run, keeping its entries', () => {
    runMigrations(db, 7);
    db.exec(`
      CREATE TABLE provider_state (
        provider_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value JSON NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider_id, key)
      );
      INSERT INTO provider_state (provider_id, key, value) VALUES ('fake', 'cursor', '"abc"');
    `);

    runMigrations(db, 8);

    expect(version(db)).toBe(8);
    expect(
      db.prepare('SELECT provider_id, key FROM provider_state ORDER BY provider_id').all()
    ).toEqual([
      { provider_id: 'fake', key: 'cursor' },
      { provider_id: 'parkstay', key: 'queue.session' },
    ]);
  });

  it('gives rows whose user no longer exists to the local profile instead of failing to start', () => {
    db.exec('UPDATE watches SET user_id = 999 WHERE id = 2');
    // Seed a past updated_at with the fixture's own timestamp trigger set aside
    const { sql } = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
      .get('update_watches_timestamp') as { sql: string };
    db.exec('DROP TRIGGER update_watches_timestamp');
    db.exec("UPDATE watches SET updated_at = '2026-01-02 03:04:05' WHERE id = 2");
    db.exec(sql);
    const warn = jest.spyOn(logger, 'warn');

    runMigrations(db, 8);

    expect(version(db)).toBe(8);
    expect(db.prepare('SELECT user_id, updated_at FROM watches WHERE id = 2').get()).toEqual({
      user_id: 1,
      updated_at: '2026-01-02 03:04:05',
    });
    // The timestamp triggers set aside for the adoption are back
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = ?")
        .get('update_watches_timestamp')
    ).toEqual({ name: 'update_watches_timestamp' });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'Migration 008: gave 1 watches row(s) whose user no longer exists to the local profile (id 1)'
    );
  });
});
