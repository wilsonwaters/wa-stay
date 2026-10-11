/**
 * Migration integration tests: fresh databases, real v5 (v1.2.0) and v6 (pre-P2 branch)
 * fixtures upgraded to v7, schema equivalence, idempotency and atomicity.
 *
 * These pin the target to v7 (`runMigrations(db, 7)`) so they keep testing exactly what
 * v7 does; `migration-v8.test.ts` covers v8 and full upgrades to the latest version.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadFixture, disposeFixture } from '@tests/utils/database-helper';
import {
  FIXTURE_MACHINE_ID,
  FIXTURE_SMTP_PASSWORD,
  FixtureName,
  V5_ROW_COUNTS,
  V6_ROW_COUNTS,
} from '@tests/fixtures/db/constants';
import {
  applyMigration,
  LATEST_SCHEMA_VERSION,
  MigrationError,
  runMigrations,
} from '@main/database/connection';
import { NotifierRepository, NotificationRepository } from '@main/database/repositories';
import { decryptLegacyNotifierConfig } from '@main/security/legacy-decryptors';
import { NotifierChannel } from '@shared/types';
import { logger } from '@main/utils/logger';
import { testVault } from '@tests/utils/fake-safe-storage';

const V7_TABLES = [
  'bookings',
  'job_logs',
  'migrations',
  'notification_delivery_logs',
  'notifications',
  'notifiers',
  'queue_session',
  'settings',
  'site_snipes',
  'sqlite_sequence',
  'users',
  'watches',
];

/** Tables v7 must carry over row for row, column for column, with no change at all. */
const UNCHANGED_TABLES = [
  'users',
  'bookings',
  'watches',
  'notifications',
  'job_logs',
  'settings',
  'queue_session',
];

type Row = Record<string, unknown>;
type Snapshot = Record<string, Row[]>;

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
}

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

function fkTargets(db: Database.Database, table: string): string[] {
  return (db.pragma(`foreign_key_list(${table})`) as { table: string }[]).map((fk) => fk.table);
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

function byName(a: Row, b: Row): number {
  return String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0;
}

/**
 * Every row and column of every table. sqlite_sequence is ordered by name, because v7's
 * table rebuilds delete and re-insert its rows.
 */
function snapshot(db: Database.Database): Snapshot {
  return Object.fromEntries(
    tables(db).map((t) => [
      t,
      db
        .prepare(`SELECT * FROM "${t}" ORDER BY ${t === 'sqlite_sequence' ? 'name' : 'rowid'}`)
        .all() as Row[],
    ])
  );
}

/**
 * The full v7 contents a v5 or v6 snapshot must turn into. Only the documented changes are
 * mapped; every other table must come through identical (UNCHANGED_TABLES):
 * - `notification_providers` is renamed to `notifiers`, rows untouched (and its
 *   sqlite_sequence row with it);
 * - `notification_delivery_logs.provider_channel` becomes `notifier_channel`, and a
 *   `notification_id` with no parent notification becomes NULL;
 * - `skip_the_queue_entries` is dropped (and SQLite drops its sqlite_sequence row);
 * - `site_snipes` exists (v6 creates it empty when upgrading v5);
 * - `migrations` keeps its rows and gains one per version applied.
 */
function expectedAfterV7(before: Snapshot): Snapshot {
  const notificationIds = new Set(before.notifications.map((n) => n.id));
  const applied = new Set(before.migrations.map((m) => m.version));
  return {
    ...Object.fromEntries(UNCHANGED_TABLES.map((t) => [t, before[t]])),
    site_snipes: before.site_snipes ?? [],
    notifiers: before.notification_providers,
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
      .map((s) => (s.name === 'notification_providers' ? { ...s, name: 'notifiers' } : s))
      .sort(byName),
  };
}

function notifierConfig(db: Database.Database, table: string): string {
  return (
    db.prepare(`SELECT config FROM ${table} WHERE channel = 'email_smtp'`).get() as {
      config: string;
    }
  ).config;
}

describe('database migrations', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-migrations-'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('brings a fresh database to v7 with exactly the v7 tables', () => {
    const db = new Database(path.join(tmpDir, 'fresh.db'));
    try {
      runMigrations(db, 7);
      expect(version(db)).toBe(7);
      expect(LATEST_SCHEMA_VERSION).toBeGreaterThan(7);
      expect(tables(db)).toEqual(V7_TABLES);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(fkTargets(db, 'notification_delivery_logs')).toEqual(['notifications']);
    } finally {
      db.close();
    }
  });

  describe.each<[FixtureName, Readonly<Record<string, number>>]>([
    ['v5-release-1.2.0', V5_ROW_COUNTS],
    ['v6-branch', V6_ROW_COUNTS],
  ])('upgrading the %s fixture', (fixture, rowCounts) => {
    let db: Database.Database;
    let configBefore: string;
    let rowsBefore: Snapshot;

    beforeEach(() => {
      db = loadFixture(fixture);
      configBefore = notifierConfig(db, 'notification_providers');
      rowsBefore = snapshot(db);
      runMigrations(db, 7);
    });

    afterEach(() => disposeFixture(db));

    it('reaches v7 and keeps every row and column of every kept table', () => {
      // The fixture holds the documented rows, so the comparison below is not vacuous.
      const { sqlite_sequence: sequences, ...data } = rowsBefore;
      expect(Object.fromEntries(Object.entries(data).map(([t, rows]) => [t, rows.length]))).toEqual(
        rowCounts
      );
      expect(sequences.length).toBeGreaterThan(0);
      expect(rowsBefore.users[0]).toMatchObject({
        encrypted_password: expect.stringMatching(/^[0-9a-f]+$/),
        encryption_iv: expect.stringMatching(/^[0-9a-f]+$/),
        encryption_auth_tag: expect.stringMatching(/^[0-9a-f]+$/),
      });

      expect(version(db)).toBe(7);
      expect(tables(db)).toEqual(V7_TABLES);
      expect(snapshot(db)).toEqual(expectedAfterV7(rowsBefore));
    });

    it('passes foreign_key_check and integrity_check with the delivery-log FK repaired', () => {
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(fkTargets(db, 'notification_delivery_logs')).toEqual(['notifications']);
      expect(
        db
          .prepare(
            'SELECT id, notification_id, notifier_channel, status FROM notification_delivery_logs'
          )
          .all()
      ).toEqual([
        { id: 1, notification_id: 1, notifier_channel: 'email_smtp', status: 'sent' },
        { id: 2, notification_id: null, notifier_channel: 'email_smtp', status: 'failed' },
      ]);
    });

    it('keeps the notifier config ciphertext byte-identical and still decryptable', () => {
      expect(notifierConfig(db, 'notifiers')).toBe(configBefore);

      // The schema migration leaves the legacy ciphertext alone; migrateLegacySecrets (P5)
      // converts it afterwards (tests/integration/legacy-secret-migration.test.ts)
      expect(
        JSON.parse(decryptLegacyNotifierConfig(notifierConfig(db, 'notifiers'), FIXTURE_MACHINE_ID))
      ).toMatchObject({
        auth: { user: 'fixture.user@example.com', pass: FIXTURE_SMTP_PASSWORD },
      });
    });

    it('accepts new delivery logs and keeps legacy notification types readable', () => {
      const notifiers = new NotifierRepository(db, testVault().vault);
      const log = notifiers.logDelivery({
        notificationId: 2,
        notifierChannel: NotifierChannel.EMAIL_SMTP,
        status: 'sent',
      });
      expect(log.notificationId).toBe(2);

      const legacy = new NotificationRepository(db).findById(3);
      expect(legacy).toMatchObject({ type: 'stq_success', relatedType: 'stq' });
    });
  });

  it('produces the same normalised schema from a fresh database and both fixtures', () => {
    const fresh = new Database(path.join(tmpDir, 'fresh.db'));
    const v5 = loadFixture('v5-release-1.2.0');
    const v6 = loadFixture('v6-branch');
    try {
      runMigrations(fresh, 7);
      runMigrations(v5, 7);
      runMigrations(v6, 7);

      const expected = normalisedSchema(fresh);
      expect(expected.length).toBeGreaterThan(40);
      expect(normalisedSchema(v5)).toEqual(expected);
      expect(normalisedSchema(v6)).toEqual(expected);
    } finally {
      fresh.close();
      disposeFixture(v5);
      disposeFixture(v6);
    }
  });

  it('changes nothing and throws nothing when run a second time', () => {
    const db = loadFixture('v5-release-1.2.0');
    try {
      runMigrations(db, 7);
      const schema = normalisedSchema(db);
      const data = snapshot(db);

      expect(() => runMigrations(db, 7)).not.toThrow();
      expect(normalisedSchema(db)).toEqual(schema);
      expect(snapshot(db)).toEqual(data);
    } finally {
      disposeFixture(db);
    }
  });

  it('rolls v7 back completely when a step fails, leaving the database at v6', () => {
    const db = loadFixture('v6-branch');
    try {
      // Squat on v7's temp table name so its first CREATE TABLE fails.
      db.exec('CREATE TABLE notifications_v7 (id INTEGER PRIMARY KEY)');
      db.pragma('foreign_keys = ON');
      const schema = normalisedSchema(db);
      const data = snapshot(db);

      let thrown: unknown;
      try {
        runMigrations(db, 7);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(MigrationError);
      expect((thrown as MigrationError).version).toBe(7);
      expect((thrown as Error).message).toMatch(/notifications_v7 already exists/);
      expect(version(db)).toBe(6);
      expect(normalisedSchema(db)).toEqual(schema);
      expect(snapshot(db)).toEqual(data);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);

      // The next start resumes from the last committed version.
      db.exec('DROP TABLE notifications_v7');
      runMigrations(db, 7);
      expect(version(db)).toBe(7);
    } finally {
      disposeFixture(db);
    }
  });

  it('also undoes the v7 rebuilds that already ran when a later v7 step fails', () => {
    const db = loadFixture('v5-release-1.2.0');
    try {
      // Step 3 creates idx_notifiers_channel; taking the name makes it fail after steps 1-2.
      db.exec('CREATE INDEX idx_notifiers_channel ON settings(category)');

      expect(() => runMigrations(db, 7)).toThrow(/Database migration 7 failed/);

      // v6 committed on its own; v7's notifications and delivery-log rebuilds did not.
      expect(version(db)).toBe(6);
      expect(fkTargets(db, 'notification_delivery_logs')).toEqual(['notifications_old']);
      expect(tables(db)).toEqual(
        expect.arrayContaining(['notification_providers', 'skip_the_queue_entries'])
      );
      expect(tables(db)).not.toContain('notifications_v7');
      expect(count(db, 'notification_delivery_logs')).toBe(
        V5_ROW_COUNTS.notification_delivery_logs
      );
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    } finally {
      disposeFixture(db);
    }
  });

  it('keeps delivery logs whose notification is gone, with notification_id cleared', () => {
    const db = loadFixture('v6-branch');
    try {
      db.prepare(
        `INSERT INTO notification_delivery_logs (id, notification_id, provider_channel, status)
         VALUES (3, 999, 'email_smtp', 'sent')`
      ).run();
      const info = jest.spyOn(logger, 'info');

      runMigrations(db, 7);

      expect(
        db.prepare('SELECT notification_id FROM notification_delivery_logs WHERE id = 3').get()
      ).toEqual({ notification_id: null });
      expect(count(db, 'notification_delivery_logs')).toBe(3);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(info).toHaveBeenCalledWith(expect.stringContaining('cleared notification_id on 1'));
      expect(info).toHaveBeenCalledWith(
        'Migration 007: dropped skip_the_queue_entries, discarding 1 row(s)'
      );
    } finally {
      disposeFixture(db);
    }
  });

  it('keeps AUTOINCREMENT high-water marks across the v7 table rebuilds', () => {
    const db = loadFixture('v6-branch');
    try {
      db.exec(`
        UPDATE sqlite_sequence SET seq = 50 WHERE name = 'notifications';
        UPDATE sqlite_sequence SET seq = 70 WHERE name = 'notification_delivery_logs';
      `);

      runMigrations(db, 7);

      const seq = (name: string) =>
        (db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(name) as { seq: number })
          .seq;
      expect(seq('notifications')).toBe(50);
      expect(seq('notification_delivery_logs')).toBe(70);
      expect(seq('notifiers')).toBe(1);
    } finally {
      disposeFixture(db);
    }
  });

  it('upgrades a pre-v2 install (tables but no migration rows) without losing data', () => {
    const db = loadFixture('v5-release-1.2.0');
    try {
      db.exec('DELETE FROM migrations');

      runMigrations(db, 7);

      expect(version(db)).toBe(7);
      expect(count(db, 'watches')).toBe(V5_ROW_COUNTS.watches);
      expect(count(db, 'notifications')).toBe(V5_ROW_COUNTS.notifications);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      disposeFixture(db);
    }
  });

  it('lets historic v6 break the delivery-log FK on v5 data, with a warning, because v7 repairs it', () => {
    const db = loadFixture('v5-release-1.2.0');
    const warn = jest.spyOn(logger, 'warn');
    try {
      runMigrations(db, 7);

      expect(warn).toHaveBeenCalledWith(
        'Migration 6: historic step introduced 1 foreign-key violation(s), to be repaired by a later migration: notification_delivery_logs -> notifications_old (1)'
      );
      // v7 found the violation in its own table and had to leave that table clean.
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Migration 7'));
      expect(version(db)).toBe(7);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      disposeFixture(db);
    }
  });

  it('repairs the delivery-log FK a v6 database already has, without any warning', () => {
    const db = loadFixture('v6-branch');
    const warn = jest.spyOn(logger, 'warn');
    try {
      expect(db.pragma('foreign_key_check')).toHaveLength(1);

      runMigrations(db, 7);

      expect(warn).not.toHaveBeenCalled();
      expect(version(db)).toBe(7);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      disposeFixture(db);
    }
  });

  it('rejects, and rolls back, a v8-style step that breaks a foreign key in a table it does not list', () => {
    const db = loadFixture('v5-release-1.2.0');
    try {
      runMigrations(db, 7);
      const data = snapshot(db);
      // As runMigrations does around every step.
      db.pragma('foreign_keys = OFF');

      let thrown: unknown;
      try {
        applyMigration(db, 8, ['site_snipes'], () => {
          db.exec('ALTER TABLE site_snipes ADD COLUMN v8_note TEXT');
          db.exec('UPDATE watches SET user_id = 999 WHERE id = 1');
        });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(MigrationError);
      expect((thrown as MigrationError).version).toBe(8);
      expect((thrown as Error).message).toBe(
        'Database migration 8 failed: foreign_key_check found 1 new violation(s) introduced by this step: watches -> users (1)'
      );
      expect(version(db)).toBe(7);
      expect(snapshot(db)).toEqual(data);
      expect(
        (db.pragma('table_info(site_snipes)') as { name: string }[]).map((c) => c.name)
      ).not.toContain('v8_note');
    } finally {
      disposeFixture(db);
    }
  });
});
