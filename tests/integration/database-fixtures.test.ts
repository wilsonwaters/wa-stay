/**
 * Schema fixture loader tests.
 *
 * The SQL dumps in tests/fixtures/db/ stand in for real user databases: v5 is what the
 * released v1.2.0 ships, v6 is what a pre-P2 dev build leaves behind. These tests check the
 * dumps replay faithfully, including the broken v6 foreign key, before any migration runs.
 */

import crypto from 'crypto';
import Database from 'better-sqlite3';
import { loadFixture, disposeFixture } from '@tests/utils/database-helper';
import {
  FIXTURE_MACHINE_ID,
  FIXTURE_USER_PASSWORD,
  V5_ROW_COUNTS,
  V6_ROW_COUNTS,
} from '@tests/fixtures/db/constants';

/**
 * Decrypts the fixture's v1.x ParkStay password (AES-256-GCM, the v1.2.0 `AuthService` key).
 * The app no longer can (migration v9 drops the columns), so the fixture check does it here.
 */
function decryptFixturePassword(row: Record<string, string>): string {
  const key = crypto.pbkdf2Sync(
    FIXTURE_MACHINE_ID + 'parkstay-bookings-v1-secret', // legacy-name-ok: the v1.x key
    'parkstay-salt',
    100000,
    32,
    'sha512'
  );
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(row.encryption_iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(row.encryption_auth_tag, 'hex'));
  return decipher.update(row.encrypted_password, 'hex', 'utf8') + decipher.final('utf8');
}

function rowCounts(db: Database.Database, tables: string[]): Record<string, number> {
  return Object.fromEntries(
    tables.map((t) => [
      t,
      (db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n,
    ])
  );
}

function schemaVersion(db: Database.Database): number {
  return (db.prepare('SELECT MAX(version) AS v FROM migrations').get() as { v: number }).v;
}

function fkTargets(db: Database.Database, table: string): string[] {
  return (db.pragma(`foreign_key_list(${table})`) as { table: string }[]).map((fk) => fk.table);
}

describe('schema fixtures', () => {
  let db: Database.Database;

  afterEach(() => disposeFixture(db));

  describe('v5-release-1.2.0', () => {
    beforeEach(() => {
      db = loadFixture('v5-release-1.2.0');
    });

    it('replays at schema version 5 with foreign keys off and the documented rows', () => {
      expect(schemaVersion(db)).toBe(5);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(0);
      expect(rowCounts(db, Object.keys(V5_ROW_COUNTS))).toEqual(V5_ROW_COUNTS);
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'site_snipes'").get()
      ).toBeUndefined();
    });

    it('is internally consistent: delivery logs reference notifications', () => {
      expect(fkTargets(db, 'notification_delivery_logs')).toEqual(['notifications']);
      expect(db.pragma('foreign_key_check')).toEqual([]);
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    });

    it('stores the user password with the legacy scheme and fixture machine id', () => {
      const row = db
        .prepare('SELECT email, encrypted_password, encryption_iv, encryption_auth_tag FROM users')
        .get() as Record<string, string>;
      expect(row.email).toBe('fixture.user@example.com');
      expect(decryptFixturePassword(row)).toBe(FIXTURE_USER_PASSWORD);
    });
  });

  describe('v6-branch', () => {
    beforeEach(() => {
      db = loadFixture('v6-branch');
    });

    it('replays at schema version 6 with the documented rows', () => {
      expect(schemaVersion(db)).toBe(6);
      expect(rowCounts(db, Object.keys(V6_ROW_COUNTS))).toEqual(V6_ROW_COUNTS);
    });

    it('reproduces the v6 bug: the delivery-log FK targets the dropped notifications_old', () => {
      expect(fkTargets(db, 'notification_delivery_logs')).toEqual(['notifications_old']);
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'notifications_old'").get()
      ).toBeUndefined();
    });

    it('keeps the SMTP notifier config ciphertext from v5 unchanged', () => {
      const v5 = loadFixture('v5-release-1.2.0');
      try {
        const config = (d: Database.Database) =>
          (d.prepare('SELECT config FROM notification_providers').get() as { config: string })
            .config;
        expect(config(db)).toBe(config(v5));
        expect(config(db)).toMatch(/^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+$/);
      } finally {
        disposeFixture(v5);
      }
    });
  });
});
