/**
 * Database Connection & Migrations
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH FOR DATABASE INITIALIZATION AND MIGRATIONS.
 * All migrations live in the runMigrations() function below.
 *
 * To add a new migration:
 * 1. Bump LATEST_SCHEMA_VERSION to the new version N
 * 2. Add a new `if (pending(N))` block at the bottom of runMigrations()
 * 3. Wrap its body in applyMigration(db, N, [tables it creates or rebuilds], () => { ... }).
 *    applyMigration runs the body and records version N in one transaction. The listed
 *    tables must be free of foreign-key violations when it commits, and the step may not
 *    introduce a violation in any other table (see assertForeignKeys).
 *
 * This module never imports the app shell: the caller passes the database file path.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

/** Schema version this build creates and understands. */
export const LATEST_SCHEMA_VERSION = 10;

/** A migration step failed. Its transaction was rolled back, so the database is still at the previous version. */
export class MigrationError extends Error {
  readonly version: number;

  constructor(version: number, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Database migration ${version} failed: ${reason}`, { cause });
    this.name = 'MigrationError';
    this.version = version;
  }
}

/** The database was written by a newer build. Nothing is migrated: this build does not know that schema. */
export class DatabaseTooNewError extends Error {
  readonly version: number;
  readonly supportedVersion: number;

  constructor(version: number, supportedVersion: number) {
    super(
      `Database schema version ${version} is newer than this app supports (${supportedVersion}). ` +
        'Install the latest version of the app to open it.'
    );
    this.name = 'DatabaseTooNewError';
    this.version = version;
    this.supportedVersion = supportedVersion;
  }
}

// Inlined schema to avoid file I/O issues in packaged (asar) builds
const SCHEMA_SQL = `
  -- Users table
  CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      encrypted_password TEXT NOT NULL,
      encryption_key TEXT NOT NULL,
      encryption_iv TEXT NOT NULL,
      encryption_auth_tag TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

  -- Bookings table
  CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      booking_reference TEXT UNIQUE NOT NULL,
      park_name TEXT NOT NULL,
      campground_name TEXT NOT NULL,
      site_number TEXT,
      site_type TEXT,
      arrival_date DATE NOT NULL,
      departure_date DATE NOT NULL,
      num_nights INTEGER NOT NULL,
      num_guests INTEGER NOT NULL,
      total_cost DECIMAL(10,2),
      currency TEXT DEFAULT 'AUD',
      status TEXT NOT NULL CHECK(status IN ('confirmed', 'cancelled', 'pending')),
      booking_data JSON,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      synced_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_user_id ON bookings(user_id);
  CREATE INDEX IF NOT EXISTS idx_bookings_reference ON bookings(booking_reference);
  CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
  CREATE INDEX IF NOT EXISTS idx_bookings_arrival_date ON bookings(arrival_date);
  CREATE INDEX IF NOT EXISTS idx_bookings_dates ON bookings(arrival_date, departure_date);

  -- Watches table
  CREATE TABLE IF NOT EXISTS watches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      park_id TEXT NOT NULL,
      park_name TEXT NOT NULL,
      campground_id TEXT NOT NULL,
      campground_name TEXT NOT NULL,
      arrival_date DATE NOT NULL,
      departure_date DATE NOT NULL,
      num_guests INTEGER NOT NULL,
      preferred_sites JSON,
      site_type TEXT,
      check_interval_minutes INTEGER DEFAULT 5,
      is_active BOOLEAN DEFAULT 1,
      last_checked_at DATETIME,
      next_check_at DATETIME,
      last_result TEXT,
      found_count INTEGER DEFAULT 0,
      auto_book BOOLEAN DEFAULT 0,
      notify_only BOOLEAN DEFAULT 1,
      max_price DECIMAL(10,2),
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_watches_user_id ON watches(user_id);
  CREATE INDEX IF NOT EXISTS idx_watches_active ON watches(is_active);
  CREATE INDEX IF NOT EXISTS idx_watches_next_check ON watches(next_check_at);
  CREATE INDEX IF NOT EXISTS idx_watches_dates ON watches(arrival_date, departure_date);

  -- Skip The Queue entries table
  CREATE TABLE IF NOT EXISTS skip_the_queue_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      booking_id INTEGER NOT NULL,
      booking_reference TEXT NOT NULL,
      is_active BOOLEAN DEFAULT 1,
      check_interval_minutes INTEGER DEFAULT 2,
      last_checked_at DATETIME,
      next_check_at DATETIME,
      attempts_count INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 1000,
      last_result TEXT,
      success_date DATETIME,
      new_booking_reference TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_stq_user_id ON skip_the_queue_entries(user_id);
  CREATE INDEX IF NOT EXISTS idx_stq_booking_id ON skip_the_queue_entries(booking_id);
  CREATE INDEX IF NOT EXISTS idx_stq_active ON skip_the_queue_entries(is_active);
  CREATE INDEX IF NOT EXISTS idx_stq_next_check ON skip_the_queue_entries(next_check_at);

  -- Notifications table
  CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('watch_found', 'stq_success', 'booking_confirmed', 'error', 'warning', 'info')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      related_id INTEGER,
      related_type TEXT CHECK(related_type IN ('booking', 'watch', 'stq')),
      action_url TEXT,
      is_read BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
  CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
  CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);

  -- Job logs table (never written; migration 010 drops it)
  CREATE TABLE IF NOT EXISTS job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL CHECK(job_type IN ('watch_poll', 'stq_check', 'cleanup')),
      job_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('success', 'failure', 'error')),
      message TEXT,
      error_details TEXT,
      duration_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_job_logs_type ON job_logs(job_type);
  CREATE INDEX IF NOT EXISTS idx_job_logs_job_id ON job_logs(job_id);
  CREATE INDEX IF NOT EXISTS idx_job_logs_status ON job_logs(status);
  CREATE INDEX IF NOT EXISTS idx_job_logs_created_at ON job_logs(created_at);

  -- Settings table
  CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      value_type TEXT NOT NULL CHECK(value_type IN ('string', 'number', 'boolean', 'json')),
      category TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);

  -- Triggers for auto-updating timestamps
  CREATE TRIGGER IF NOT EXISTS update_users_timestamp
  AFTER UPDATE ON users
  BEGIN
      UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS update_bookings_timestamp
  AFTER UPDATE ON bookings
  BEGIN
      UPDATE bookings SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS update_watches_timestamp
  AFTER UPDATE ON watches
  BEGIN
      UPDATE watches SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS update_stq_timestamp
  AFTER UPDATE ON skip_the_queue_entries
  BEGIN
      UPDATE skip_the_queue_entries SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS update_settings_timestamp
  AFTER UPDATE ON settings
  BEGIN
      UPDATE settings SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
  END;
`;

interface ForeignKeyViolation {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
}

/** "child -> parent (count)" for each table pair, e.g. "notification_delivery_logs -> notifications_old (1)". */
function summariseViolations(violations: ForeignKeyViolation[]): string {
  const counts = new Map<string, number>();
  for (const v of violations) {
    const pair = `${v.table} -> ${v.parent}`;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return [...counts].map(([pair, n]) => `${pair} (${n})`).join(', ');
}

/**
 * The first migration held to the strict foreign-key rule (see assertForeignKeys).
 * v1-v6 are the historic steps: their SQL is frozen as released, and v6 is known to break
 * the delivery-log FK, which v7 repairs.
 */
const STRICT_FK_FROM_VERSION = 7;

function readViolations(db: Database.Database): ForeignKeyViolation[] {
  return db.pragma('foreign_key_check') as ForeignKeyViolation[];
}

/** Identity of a violation: the same child row, FK and parent table. */
function violationKey(v: ForeignKeyViolation): string {
  return JSON.stringify([v.table, v.rowid, v.fkid, v.parent]);
}

/**
 * Runs `PRAGMA foreign_key_check` at the end of migration `version` and compares it with
 * `baseline`, the check taken just before the step ran (same transaction). The rule:
 *
 * 1. **The step's own tables must be fully clean.** Any violation in, or pointing at, one of
 *    `checkedTables` is fatal, even one that is in the baseline. A step that creates or
 *    rebuilds a table controls every row it writes there, so it must leave it clean. This is
 *    what proves v7 actually repairs the delivery-log FK that v6 broke: without it, that
 *    violation would be "pre-existing" from v7's point of view and only warned about.
 * 2. **From STRICT_FK_FROM_VERSION (v7) on, a step may not introduce a violation anywhere.**
 *    A violation that is not in the baseline is fatal in any table, listed or not.
 * 3. **A historic step (v1-v6) that introduces a violation outside its own tables only warns.**
 *    Their SQL is frozen, and v6 breaks `notification_delivery_logs -> notifications_old` on
 *    every database that has delivery logs. A later step of the same run (v7) repairs it,
 *    and rule 1 makes v7 prove it did, so a v5 -> v7 upgrade succeeds.
 * 4. **Pre-existing violations outside the step's own tables only warn.** That is old orphan
 *    data the step did not cause, and it must not brick startup.
 */
function assertForeignKeys(
  db: Database.Database,
  version: number,
  checkedTables: readonly string[],
  baseline: readonly ForeignKeyViolation[]
): void {
  const before = new Set(baseline.map(violationKey));
  const after = readViolations(db);
  const own = after.filter(
    (v) => checkedTables.includes(v.table) || checkedTables.includes(v.parent)
  );
  const other = after.filter((v) => !own.includes(v));
  const introduced = other.filter((v) => !before.has(violationKey(v)));
  const preExisting = other.filter((v) => before.has(violationKey(v)));

  if (own.length > 0) {
    throw new Error(
      `foreign_key_check found ${own.length} violation(s) in this step's tables: ${summariseViolations(own)}`
    );
  }
  if (introduced.length > 0) {
    if (version >= STRICT_FK_FROM_VERSION) {
      throw new Error(
        `foreign_key_check found ${introduced.length} new violation(s) introduced by this step: ${summariseViolations(introduced)}`
      );
    }
    logger.warn(
      `Migration ${version}: historic step introduced ${introduced.length} foreign-key violation(s), to be repaired by a later migration: ${summariseViolations(introduced)}`
    );
  }
  if (preExisting.length > 0) {
    logger.warn(
      `Migration ${version}: ${preExisting.length} pre-existing foreign-key violation(s), not introduced by migration ${version}: ${summariseViolations(preExisting)}`
    );
  }
}

/**
 * Applies one migration step atomically: `fn`, the foreign-key check and the
 * `INSERT INTO migrations` run in a single transaction, so a crash or error leaves the
 * database at the previous version. Any failure is rethrown as `MigrationError(version)`.
 *
 * `checkedTables` lists the tables the step creates or rebuilds. They must be completely
 * free of foreign-key violations when it commits; see assertForeignKeys for the full rule,
 * including how violations elsewhere are treated. The caller turns `foreign_keys` off around
 * the steps, because the pragma is a no-op inside a transaction.
 */
export function applyMigration(
  db: Database.Database,
  version: number,
  checkedTables: readonly string[],
  fn: () => void
): void {
  try {
    db.transaction(() => {
      const baseline = readViolations(db);
      fn();
      assertForeignKeys(db, version, checkedTables, baseline);
      db.prepare('INSERT INTO migrations (version) VALUES (?)').run(version);
    })();
  } catch (error) {
    throw error instanceof MigrationError ? error : new MigrationError(version, error);
  }
  logger.info(`Migration ${String(version).padStart(3, '0')} completed`);
}

/** The AUTOINCREMENT high-water mark of `table`, if it has one. */
function readSequence(db: Database.Database, table: string): number | undefined {
  const row = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table) as
    { seq: number } | undefined;
  return row?.seq;
}

/** Restores a rebuilt table's AUTOINCREMENT high-water mark, so deleted ids are not reused. */
function restoreSequence(db: Database.Database, table: string, seq: number | undefined): void {
  if (seq === undefined) return;
  const updated = db
    .prepare('UPDATE sqlite_sequence SET seq = MAX(seq, ?) WHERE name = ?')
    .run(seq, table);
  if (updated.changes === 0) {
    db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(table, seq);
  }
}

// ---------------------------------------------------------------------------------------
// Migration 008 helpers: the provider-aware data model (architecture-notes §5)
// ---------------------------------------------------------------------------------------

/** Whether `table` exists (tables only; not views or indexes). */
function hasTable(db: Database.Database, table: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
    undefined
  );
}

/** Column name → NOT NULL flag, from `PRAGMA table_info`. Empty when the table is absent. */
function columnsOf(db: Database.Database, table: string): Map<string, boolean> {
  const rows = db.prepare('SELECT name, "notnull" FROM pragma_table_info(?)').all(table) as {
    name: string;
    notnull: number;
  }[];
  return new Map(rows.map((r) => [r.name, r.notnull === 1]));
}

/**
 * D(col): the calendar date `YYYY-MM-DD` a legacy date column meant (tech-review #14).
 *
 * Legacy code wrote calendar dates as ISO instants: UTC midnight (`toISOString` of a date
 * input) or local midnight on the user's machine, e.g. `2026-12-12T16:00:00.000Z` for
 * 13 Dec in Perth. Adding 12 hours and taking the date rounds to the nearest UTC midnight,
 * which recovers the intended day for writes at UTC midnight and at local midnight anywhere
 * from UTC-11 to UTC+12 (every Australian zone included).
 *
 * This is the spec's `CASE WHEN length(col) > 10 THEN COALESCE(date(col, '+12 hours'),
 * substr(col, 1, 10)) ELSE col END`, applied only when the value starts with a real date.
 * Values of 10 characters or fewer (already `YYYY-MM-DD`, empty, or junk) are copied
 * unchanged, and so is NULL. A longer value that does not start with a real date is copied
 * unchanged too, because SQLite would otherwise roll `2026-02-30` over to `2026-03-02` and
 * truncate junk into a different value. A real date followed by a time SQLite cannot read
 * keeps its date. `column` is a code constant. Exported for its tests.
 */
export function calendarDateSql(column: string): string {
  return `CASE
      WHEN length(${column}) > 10 AND date(substr(${column}, 1, 10)) IS substr(${column}, 1, 10)
        THEN COALESCE(date(${column}, '+12 hours'), substr(${column}, 1, 10))
      ELSE ${column}
    END`;
}

/**
 * The provider's own stay fields as a JSON object, from `name, value` pairs of SQL
 * expressions (code constants). Members whose value is NULL are left out: json_patch with
 * a NULL member removes it (RFC 7396).
 */
function stayParamsSql(...pairs: [string, string][]): string {
  const members = pairs.map(([name, value]) => `'${name}', ${value}`).join(', ');
  return `json_patch('{}', json_object(${members}))`;
}

/** Logs, once per table, how many rows kept a stay date that is not a calendar date. */
function warnOnInvalidStayDates(db: Database.Database, table: string): void {
  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ${table}
       WHERE date(arrival_date) IS NOT arrival_date OR date(departure_date) IS NOT departure_date`
    )
    .get() as { n: number };
  if (n > 0) {
    logger.warn(
      `Migration 008: ${n} ${table} row(s) have an arrival or departure that is not a calendar date (YYYY-MM-DD); copied unchanged`
    );
  }
}

/**
 * users: the local profile no longer needs credentials (platform open question 1). The
 * credential columns become nullable; every value is copied unchanged (P5 re-encrypts them,
 * V6 drops them).
 */
function v8RebuildUsers(db: Database.Database): void {
  if (columnsOf(db, 'users').get('email') === false) return;
  const seq = readSequence(db, 'users');
  db.exec(`
    CREATE TABLE users_v8 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      encrypted_password TEXT,
      encryption_key TEXT,
      encryption_iv TEXT,
      encryption_auth_tag TEXT,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users_v8 (id, email, encrypted_password, encryption_key, encryption_iv,
        encryption_auth_tag, first_name, last_name, phone, created_at, updated_at)
      SELECT id, email, encrypted_password, encryption_key, encryption_iv,
        encryption_auth_tag, first_name, last_name, phone, created_at, updated_at
      FROM users;
    DROP TABLE users;
    ALTER TABLE users_v8 RENAME TO users;
    CREATE INDEX idx_users_email ON users(email);
    CREATE TRIGGER update_users_timestamp
    AFTER UPDATE ON users
    BEGIN
        UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `);
  restoreSequence(db, 'users', seq);
}

/**
 * provider_accounts, with the ParkStay account taken from the first `users` row: its email
 * and name. Sign-in state is unknown until V6 checks it.
 */
function v8CreateProviderAccounts(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_accounts (
      provider_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'unknown',
      display_name TEXT,
      email TEXT,
      last_signed_in_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const { n: users } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (users > 1) {
    logger.warn(`Migration 008: ${users} users rows; only the first becomes the ParkStay account`);
  }
  db.exec(`
    INSERT OR IGNORE INTO provider_accounts (provider_id, status, display_name, email, last_signed_in_at)
      SELECT 'parkstay', 'unknown',
        NULLIF(trim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
        NULLIF(email, ''),
        NULL
      FROM users ORDER BY id LIMIT 1;
  `);
}

/** The single local profile (§12.21): id 1 with no credentials, when there is no row. */
function v8EnsureLocalProfile(db: Database.Database): void {
  db.exec(`
    INSERT INTO users (id, email, encrypted_password, encryption_key, encryption_iv,
        encryption_auth_tag)
      SELECT 1, NULL, NULL, NULL, NULL, NULL
      WHERE NOT EXISTS (SELECT 1 FROM users);
  `);
}

/**
 * watches: provider id, generic location, stay and unit columns; ParkStay extras in stay_params.
 * `auto_book` starts off for every copied watch: 1.x showed it as "auto-booking" but never acted
 * on it, and it now places real holds (§12.31), so it is never turned on without the person.
 */
function v8RebuildWatches(db: Database.Database): void {
  if (columnsOf(db, 'watches').has('provider_id')) return;
  const seq = readSequence(db, 'watches');
  db.exec(`
    CREATE TABLE watches_v8 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider_id TEXT NOT NULL DEFAULT 'parkstay',
      name TEXT NOT NULL,
      location_external_id TEXT NOT NULL,
      location_name TEXT NOT NULL,
      area_name TEXT,
      arrival_date TEXT NOT NULL,
      departure_date TEXT NOT NULL,
      num_adults INTEGER NOT NULL,
      num_children INTEGER NOT NULL DEFAULT 0,
      num_infants INTEGER NOT NULL DEFAULT 0,
      num_concessions INTEGER NOT NULL DEFAULT 0,
      unit_ids JSON NOT NULL DEFAULT '[]',
      stay_params JSON NOT NULL DEFAULT '{}',
      check_interval_minutes INTEGER DEFAULT 5,
      is_active BOOLEAN DEFAULT 1,
      last_checked_at DATETIME,
      next_check_at DATETIME,
      last_result TEXT,
      found_count INTEGER DEFAULT 0,
      auto_book BOOLEAN DEFAULT 0,
      notify_only BOOLEAN DEFAULT 1,
      allow_partial_match BOOLEAN DEFAULT 0,
      max_price DECIMAL(10,2),
      notes TEXT,
      last_availability JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    INSERT INTO watches_v8 (id, user_id, provider_id, name, location_external_id,
        location_name, area_name, arrival_date, departure_date, num_adults, num_children,
        num_infants, num_concessions, unit_ids, stay_params, check_interval_minutes,
        is_active, last_checked_at, next_check_at, last_result, found_count, auto_book,
        notify_only, allow_partial_match, max_price, notes, last_availability, created_at,
        updated_at)
      SELECT id, user_id, 'parkstay', name, campground_id,
        campground_name, park_name, ${calendarDateSql('arrival_date')},
        ${calendarDateSql('departure_date')}, num_guests, 0,
        0, 0, COALESCE(preferred_sites, '[]'),
        ${stayParamsSql(['parkId', 'park_id'], ['gearType', 'site_type'])},
        check_interval_minutes,
        is_active, last_checked_at, next_check_at, last_result, found_count, 0,
        notify_only, allow_partial_match, max_price, notes, last_availability, created_at,
        updated_at
      FROM watches;
    DROP TABLE watches;
    ALTER TABLE watches_v8 RENAME TO watches;
    CREATE INDEX idx_watches_user_id ON watches(user_id);
    CREATE INDEX idx_watches_active ON watches(is_active);
    CREATE INDEX idx_watches_next_check ON watches(next_check_at);
    CREATE INDEX idx_watches_dates ON watches(arrival_date, departure_date);
    CREATE INDEX idx_watches_provider_active ON watches(provider_id, is_active);
    CREATE TRIGGER update_watches_timestamp
    AFTER UPDATE ON watches
    BEGIN
        UPDATE watches SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `);
  restoreSequence(db, 'watches', seq);
  warnOnInvalidStayDates(db, 'watches');
}

/**
 * site_snipes: as watches, plus the access gate and hold columns (`queue_enabled` →
 * `access_gate_enabled`, `held_*` → `hold_*`, new `hold_unit_id`). The release_mode CHECK
 * is dropped: release modes are provider-described (§12.3).
 */
function v8RebuildSiteSnipes(db: Database.Database): void {
  if (!hasTable(db, 'site_snipes') || columnsOf(db, 'site_snipes').has('provider_id')) return;
  const seq = readSequence(db, 'site_snipes');
  db.exec(`
    CREATE TABLE site_snipes_v8 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider_id TEXT NOT NULL DEFAULT 'parkstay',
      name TEXT NOT NULL,
      location_external_id TEXT NOT NULL,
      location_name TEXT,
      area_name TEXT,
      unit_ids JSON NOT NULL DEFAULT '[]',
      arrival_date TEXT NOT NULL,
      departure_date TEXT NOT NULL,
      num_adults INTEGER DEFAULT 2,
      num_children INTEGER DEFAULT 0,
      num_infants INTEGER DEFAULT 0,
      num_concessions INTEGER DEFAULT 0,
      stay_params JSON NOT NULL DEFAULT '{}',
      release_mode TEXT NOT NULL DEFAULT 'daily_rollover',
      release_at DATETIME,
      access_gate_enabled BOOLEAN DEFAULT 0,
      lead_time_seconds INTEGER DEFAULT 120,
      poll_interval_ms INTEGER DEFAULT 1500,
      window_duration_ms INTEGER DEFAULT 900000,
      status TEXT DEFAULT 'armed',
      is_active BOOLEAN DEFAULT 1,
      attempts_count INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 0,
      last_checked_at DATETIME,
      next_check_at DATETIME,
      last_result TEXT,
      last_error TEXT,
      hold_reference TEXT,
      hold_expires_at DATETIME,
      hold_unit_id TEXT,
      payment_url TEXT,
      booked_reference TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    INSERT INTO site_snipes_v8 (id, user_id, provider_id, name, location_external_id,
        location_name, area_name, unit_ids, arrival_date, departure_date, num_adults,
        num_children, num_infants, num_concessions, stay_params, release_mode, release_at,
        access_gate_enabled, lead_time_seconds, poll_interval_ms, window_duration_ms, status,
        is_active, attempts_count, max_attempts, last_checked_at, next_check_at, last_result,
        last_error, hold_reference, hold_expires_at, hold_unit_id, payment_url,
        booked_reference, notes, created_at, updated_at)
      SELECT id, user_id, 'parkstay', name, campground_id,
        campground_name, NULL, COALESCE(target_site_ids, '[]'),
        ${calendarDateSql('arrival_date')}, ${calendarDateSql('departure_date')}, num_adult,
        num_child, num_infant, num_concession,
        ${stayParamsSql(['gearType', 'site_type'], ['numVehicles', 'num_vehicle'], ['postcode', 'postcode'])},
        release_mode, release_at,
        queue_enabled, lead_time_seconds, poll_interval_ms, window_duration_ms, status,
        is_active, attempts_count, max_attempts, last_checked_at, next_check_at, last_result,
        last_error, held_booking_pk, held_expires_at, NULL, payment_url,
        booked_reference, notes, created_at, updated_at
      FROM site_snipes;
    DROP TABLE site_snipes;
    ALTER TABLE site_snipes_v8 RENAME TO site_snipes;
    CREATE INDEX idx_snipe_user_id ON site_snipes(user_id);
    CREATE INDEX idx_snipe_active ON site_snipes(is_active);
    CREATE INDEX idx_snipe_release_at ON site_snipes(release_at);
    CREATE TRIGGER update_site_snipes_timestamp
    AFTER UPDATE ON site_snipes
    BEGIN
      UPDATE site_snipes SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `);
  restoreSequence(db, 'site_snipes', seq);
  warnOnInvalidStayDates(db, 'site_snipes');
}

/**
 * bookings: unique per provider (`UNIQUE(provider_id, booking_reference)`), generic location,
 * stay and unit columns. The site number becomes the only unit id, the site type a stay
 * param, and `num_guests` the adults, as for watches.
 */
function v8RebuildBookings(db: Database.Database): void {
  if (columnsOf(db, 'bookings').has('provider_id')) return;
  const seq = readSequence(db, 'bookings');
  db.exec(`
    CREATE TABLE bookings_v8 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider_id TEXT NOT NULL DEFAULT 'parkstay',
      booking_reference TEXT NOT NULL,
      location_external_id TEXT,
      location_name TEXT NOT NULL,
      area_name TEXT,
      unit_ids JSON NOT NULL DEFAULT '[]',
      stay_params JSON NOT NULL DEFAULT '{}',
      arrival_date TEXT NOT NULL,
      departure_date TEXT NOT NULL,
      num_nights INTEGER NOT NULL,
      num_adults INTEGER NOT NULL,
      num_children INTEGER NOT NULL DEFAULT 0,
      num_infants INTEGER NOT NULL DEFAULT 0,
      num_concessions INTEGER NOT NULL DEFAULT 0,
      total_cost DECIMAL(10,2),
      currency TEXT DEFAULT 'AUD',
      status TEXT NOT NULL CHECK(status IN ('confirmed', 'cancelled', 'pending')),
      booking_data JSON,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      synced_at DATETIME,
      UNIQUE (provider_id, booking_reference),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    INSERT INTO bookings_v8 (id, user_id, provider_id, booking_reference,
        location_external_id, location_name, area_name, unit_ids, stay_params, arrival_date,
        departure_date, num_nights, num_adults, num_children, num_infants, num_concessions,
        total_cost, currency, status, booking_data, notes, created_at, updated_at, synced_at)
      SELECT id, user_id, 'parkstay', booking_reference,
        NULL, campground_name, park_name,
        CASE WHEN site_number IS NULL THEN '[]' ELSE json_array(site_number) END,
        ${stayParamsSql(['siteType', 'site_type'])}, ${calendarDateSql('arrival_date')},
        ${calendarDateSql('departure_date')}, num_nights, num_guests, 0, 0, 0,
        total_cost, currency, status, booking_data, notes, created_at, updated_at, synced_at
      FROM bookings;
    DROP TABLE bookings;
    ALTER TABLE bookings_v8 RENAME TO bookings;
    CREATE INDEX idx_bookings_user_id ON bookings(user_id);
    CREATE INDEX idx_bookings_reference ON bookings(booking_reference);
    CREATE INDEX idx_bookings_status ON bookings(status);
    CREATE INDEX idx_bookings_arrival_date ON bookings(arrival_date);
    CREATE INDEX idx_bookings_dates ON bookings(arrival_date, departure_date);
    CREATE INDEX idx_bookings_provider_arrival ON bookings(provider_id, arrival_date);
    CREATE TRIGGER update_bookings_timestamp
    AFTER UPDATE ON bookings
    BEGIN
        UPDATE bookings SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `);
  restoreSequence(db, 'bookings', seq);
  warnOnInvalidStayDates(db, 'bookings');
}

/** notifications: a nullable provider id, 'parkstay' for those about a watch, snipe or booking. */
function v8AddNotificationProvider(db: Database.Database): void {
  if (columnsOf(db, 'notifications').has('provider_id')) return;
  db.exec(`
    ALTER TABLE notifications ADD COLUMN provider_id TEXT;
    UPDATE notifications SET provider_id = 'parkstay'
      WHERE related_type IN ('watch', 'snipe', 'booking');
    CREATE INDEX idx_notifications_provider_id ON notifications(provider_id);
  `);
}

/**
 * provider_state, each provider's key-value store. The DBCA queue session moves into it as
 * ('parkstay', 'queue.session'), in the JSON shape agreed with V3, and queue_session goes.
 */
function v8CreateProviderState(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_state (
      provider_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value JSON NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (provider_id, key)
    );
  `);
  if (!hasTable(db, 'queue_session')) return;
  db.exec(`
    INSERT OR IGNORE INTO provider_state (provider_id, key, value, updated_at)
      SELECT 'parkstay', 'queue.session',
        json_object('sessionKey', session_key, 'status', status, 'position', position,
          'estimatedWaitSeconds', estimated_wait_seconds, 'expirySeconds', expiry_seconds,
          'expiresAt', expires_at, 'createdAt', created_at),
        COALESCE(updated_at, CURRENT_TIMESTAMP)
      FROM queue_session ORDER BY id LIMIT 1;
    DROP TABLE queue_session;
  `);
}

/**
 * locations, the cached catalogue of every provider, with an FTS5 index over name, area,
 * region and summary kept in sync by triggers.
 *
 * `id INTEGER PRIMARY KEY` makes the rowid a real column, so it survives VACUUM: the FTS
 * index is external-content and refers to rows by rowid. A location is identified by
 * `UNIQUE (provider_id, external_id)`. Writers must upsert with ON CONFLICT DO UPDATE,
 * never INSERT OR REPLACE, whose implicit delete skips the FTS delete trigger.
 */
function v8CreateLocations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY,
      provider_id TEXT NOT NULL,
      external_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      booking_mode TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      area_name TEXT,
      region TEXT,
      summary TEXT,
      description_html TEXT,
      image_urls JSON NOT NULL DEFAULT '[]',
      amenities JSON NOT NULL DEFAULT '[]',
      unit_count INTEGER,
      info_url TEXT,
      booking_url TEXT,
      raw JSON,
      fetched_at DATETIME NOT NULL,
      detail JSON,
      detail_fetched_at DATETIME,
      UNIQUE (provider_id, external_id)
    );
    CREATE INDEX IF NOT EXISTS idx_locations_provider ON locations(provider_id);
    CREATE INDEX IF NOT EXISTS idx_locations_kind ON locations(kind);
    CREATE INDEX IF NOT EXISTS idx_locations_booking_mode ON locations(booking_mode);
    CREATE INDEX IF NOT EXISTS idx_locations_region ON locations(region);
    CREATE INDEX IF NOT EXISTS idx_locations_lat_lng ON locations(lat, lng);

    CREATE VIRTUAL TABLE IF NOT EXISTS locations_fts USING fts5(
      name, area_name, region, summary,
      content = 'locations',
      content_rowid = 'rowid',
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TRIGGER IF NOT EXISTS locations_fts_insert
    AFTER INSERT ON locations
    BEGIN
      INSERT INTO locations_fts (rowid, name, area_name, region, summary)
        VALUES (NEW.rowid, NEW.name, NEW.area_name, NEW.region, NEW.summary);
    END;
    CREATE TRIGGER IF NOT EXISTS locations_fts_delete
    AFTER DELETE ON locations
    BEGIN
      INSERT INTO locations_fts (locations_fts, rowid, name, area_name, region, summary)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.area_name, OLD.region, OLD.summary);
    END;
    CREATE TRIGGER IF NOT EXISTS locations_fts_update
    AFTER UPDATE OF name, area_name, region, summary ON locations
    BEGIN
      INSERT INTO locations_fts (locations_fts, rowid, name, area_name, region, summary)
        VALUES ('delete', OLD.rowid, OLD.name, OLD.area_name, OLD.region, OLD.summary);
      INSERT INTO locations_fts (rowid, name, area_name, region, summary)
        VALUES (NEW.rowid, NEW.name, NEW.area_name, NEW.region, NEW.summary);
    END;
  `);
}

/** Tables whose rows belong to the local profile through `user_id`. */
const PROFILE_OWNED_TABLES = ['watches', 'site_snipes', 'bookings', 'notifications'] as const;

/**
 * Gives rows whose `user_id` names no `users` row to the local profile. v1.x always ran with
 * foreign keys on, so there should be none; but v8 lists `users` and the rebuilt tables as
 * its own, which must be clean, so an orphan would otherwise stop the app from starting.
 * The app has one profile, so the orphan was the user's own data: it is kept, not dropped.
 */
function v8AdoptOrphans(db: Database.Database): void {
  const profile = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() as
    { id: number } | undefined;
  if (!profile) return;
  for (const table of PROFILE_OWNED_TABLES) {
    if (!hasTable(db, table)) continue;
    // Moving a row to the profile is not an edit by the user, so its `updated_at` must not
    // change: set the table's timestamp triggers aside for the UPDATE and put them back from
    // their stored SQL (all inside the migration's transaction).
    const triggers = db
      .prepare(
        `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? AND name LIKE 'update\\_%' ESCAPE '\\'`
      )
      .all(table) as Array<{ name: string; sql: string }>;
    for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name}"`);
    const { changes } = db
      .prepare(
        `UPDATE ${table} SET user_id = ? WHERE user_id IS NULL OR user_id NOT IN (SELECT id FROM users)`
      )
      .run(profile.id);
    for (const trigger of triggers) db.exec(trigger.sql);
    if (changes > 0) {
      logger.warn(
        `Migration 008: gave ${changes} ${table} row(s) whose user no longer exists to the local profile (id ${profile.id})`
      );
    }
  }
}

// ---------------------------------------------------------------------------------------
// Migration 009 helpers: retire the legacy ParkStay credentials, watch holds, account checks
// (V6; architecture-notes §12.26, §12.31, §12.32)
// ---------------------------------------------------------------------------------------

/**
 * users: the profile only (id, email, names, phone, timestamps). The v1.x ParkStay password
 * (`encrypted_password` and its `encryption_*` columns) is dropped: ParkStay never used it,
 * and sign-in is now a session in the provider partition. The email is kept as the profile's
 * hint; v8 already copied it to the ParkStay account.
 */
function v9RebuildUsers(db: Database.Database): void {
  if (!columnsOf(db, 'users').has('encrypted_password')) return;
  const seq = readSequence(db, 'users');
  db.exec(`
    CREATE TABLE users_v9 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO users_v9 (id, email, first_name, last_name, phone, created_at, updated_at)
      SELECT id, email, first_name, last_name, phone, created_at, updated_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_v9 RENAME TO users;
    CREATE INDEX idx_users_email ON users(email);
    CREATE TRIGGER update_users_timestamp
    AFTER UPDATE ON users
    BEGIN
        UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;
  `);
  restoreSequence(db, 'users', seq);
}

/** Adds each `[name, type]` column to `table` unless it is already there. */
function addColumns(db: Database.Database, table: string, columns: [string, string][]): void {
  const existing = columnsOf(db, table);
  for (const [name, type] of columns) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

/** watches: the details of a watch's automatic hold, and the last run's error (§12.31). */
function v9AddWatchHoldColumns(db: Database.Database): void {
  addColumns(db, 'watches', [
    ['hold_reference', 'TEXT'],
    ['hold_expires_at', 'DATETIME'],
    ['hold_unit_id', 'TEXT'],
    ['payment_url', 'TEXT'],
    ['last_error', 'TEXT'],
  ]);
}

/** provider_accounts: when the sign-in state was last answered for certain. */
function v9AddAccountLastChecked(db: Database.Database): void {
  addColumns(db, 'provider_accounts', [['last_checked_at', 'DATETIME']]);
}

/** The `maintenance` task v9 asks for: rewrite the file so no freed page keeps old data. */
const SCRUB_TASK = 'vacuum-freed-pages';

/**
 * maintenance: work a migration asks for that must run outside its transaction, kept until
 * it has run (a failure, or a quit in between, leaves it for the next start). v9 asks for
 * the freed-page scrub in the same transaction that drops the ciphertext.
 */
function v9RequestScrub(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS maintenance (
      task TEXT PRIMARY KEY,
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.prepare('INSERT OR IGNORE INTO maintenance (task) VALUES (?)').run(SCRUB_TASK);
}

/** Whether the freed-page scrub is still owed (a v9 database from before the table: no). */
function scrubOwed(db: Database.Database): boolean {
  const table = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'maintenance'")
    .get();
  return Boolean(table && db.prepare('SELECT 1 FROM maintenance WHERE task = ?').get(SCRUB_TASK));
}

/**
 * While v9's scrub is owed: rewrites the database file (VACUUM) when it has free pages, so
 * none keeps the dropped legacy password ciphertext (§12.32), then marks it done and empties
 * the WAL. VACUUM keeps every rowid alias (`INTEGER PRIMARY KEY`), so the FTS index on
 * `locations` stays valid. A failure (a full disk) is logged, not fatal: the task stays and
 * the next start tries again. The migrations ran with `secure_delete` on, so freed pages are
 * zeroed already; this is the second line.
 */
function scrubFreedPagesIfOwed(db: Database.Database): void {
  try {
    if (!scrubOwed(db)) return;
    const freePages = Number(db.pragma('freelist_count', { simple: true }));
    if (freePages > 0) {
      db.exec('VACUUM');
      logger.info(`Database file rewritten (VACUUM): ${freePages} free page(s) dropped`);
    }
    db.prepare('DELETE FROM maintenance WHERE task = ?').run(SCRUB_TASK);
  } catch (error) {
    logger.error('VACUUM failed; it is tried again at the next start', error);
  } finally {
    // Zeroed pages reach the main file, and the WAL keeps no old frame
    try {
      if (String(db.pragma('journal_mode', { simple: true })).toLowerCase() === 'wal') {
        db.pragma('wal_checkpoint(TRUNCATE)');
      }
    } catch (error) {
      logger.warn('WAL checkpoint after the freed-page scrub failed', error);
    }
  }
}

// ---------------------------------------------------------------------------------------
// Migration 010 helpers
// ---------------------------------------------------------------------------------------

/**
 * job_logs: no version ever wrote it (its CHECK would even refuse a snipe job), so it is
 * dropped with its four indexes and its sqlite_sequence row. No table references it. Rows
 * it somehow holds go with it; the log says how many.
 */
function v10DropJobLogs(db: Database.Database): void {
  if (!hasTable(db, 'job_logs')) return;
  const { rows } = db.prepare('SELECT COUNT(*) AS rows FROM job_logs').get() as { rows: number };
  db.exec('DROP TABLE job_logs');
  logger.info(`Migration 010: dropped job_logs (${rows} row(s))`);
}

/**
 * Brings the database up to `targetVersion`, LATEST_SCHEMA_VERSION unless given. A lower
 * target stops after that version (tests use it to build a database of an older shape).
 * Add new migrations at the bottom of this function.
 */
export function runMigrations(
  database: Database.Database,
  targetVersion: number = LATEST_SCHEMA_VERSION
): void {
  if (
    !Number.isInteger(targetVersion) ||
    targetVersion < 1 ||
    targetVersion > LATEST_SCHEMA_VERSION
  ) {
    throw new RangeError(
      `runMigrations target version must be 1-${LATEST_SCHEMA_VERSION}, not ${targetVersion}`
    );
  }

  // Create migrations table if it doesn't exist
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Get current version. Pre-v2 installs have tables but no rows here, so they start at 0.
  const currentVersion =
    (
      database.prepare('SELECT MAX(version) as version FROM migrations').get() as {
        version: number | null;
      }
    ).version ?? 0;

  logger.info(`Current database migration version: ${currentVersion}`);

  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new DatabaseTooNewError(currentVersion, LATEST_SCHEMA_VERSION);
  }
  if (currentVersion >= targetVersion) {
    // A scrub an earlier start could not finish (outside every transaction)
    if (!database.inTransaction) scrubFreedPagesIfOwed(database);
    return;
  }
  /** Whether migration `version` still has to run in this call. */
  const pending = (version: number): boolean =>
    currentVersion < version && version <= targetVersion;

  // Table rebuilds need foreign keys off. The pragma is ignored inside a transaction, so it
  // is set here, around all the steps, and always restored. Refuse to run if it cannot take
  // effect: a rebuild with foreign keys on would cascade-delete or reject rows.
  if (database.inTransaction) {
    throw new Error(
      'runMigrations cannot run inside an open transaction: PRAGMA foreign_keys is a no-op there, so table rebuilds would run with foreign keys on'
    );
  }
  database.pragma('foreign_keys = OFF');
  // Deleted content and freed pages are overwritten with zeros while the steps run: the
  // rebuilds of `users` (v8, v9) must not leave the legacy password ciphertext in free pages.
  // Like foreign_keys, it is set outside the transactions and restored.
  const secureDelete = Number(database.pragma('secure_delete', { simple: true }));
  database.pragma('secure_delete = ON');
  try {
    if (database.pragma('foreign_keys', { simple: true }) !== 0) {
      throw new Error(
        'runMigrations could not turn foreign keys off (PRAGMA foreign_keys still reads on); no migration was run'
      );
    }

    // Migration 001: Initial schema. Every statement is CREATE ... IF NOT EXISTS, so it is
    // harmless on pre-v2 installs that already have the tables. It writes no rows, so it
    // has no tables to check.
    if (pending(1)) {
      applyMigration(database, 1, [], () => {
        logger.info('Running migration 001: Initial schema');
        database.exec(SCHEMA_SQL);
      });
    }

    // Migration 002: Add last_availability column to watches
    if (pending(2)) {
      applyMigration(database, 2, [], () => {
        logger.info('Running migration 002: Add last_availability column');

        // Check if column already exists
        const tableInfo = database.prepare('PRAGMA table_info(watches)').all() as {
          name: string;
        }[];
        const hasColumn = tableInfo.some((col) => col.name === 'last_availability');

        if (!hasColumn) {
          database.exec('ALTER TABLE watches ADD COLUMN last_availability JSON');
          logger.info('Added last_availability column to watches table');
        } else {
          logger.info('last_availability column already exists');
        }

        // Kept from the original v2. Migration 001 now always records itself first, so this
        // is a no-op.
        database.prepare('INSERT OR IGNORE INTO migrations (version) VALUES (?)').run(1);
      });
    }

    // Migration 003: Add the notifier tables (named notification_providers until v7)
    if (pending(3)) {
      applyMigration(database, 3, ['notification_providers', 'notification_delivery_logs'], () => {
        logger.info('Running migration 003: Add notifier tables');

        database.exec(`
      -- Notifiers table (named notification_providers until v7)
      CREATE TABLE IF NOT EXISTS notification_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        enabled BOOLEAN DEFAULT 0,
        config JSON NOT NULL,
        status TEXT DEFAULT 'not_configured',
        last_tested_at DATETIME,
        last_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_notification_providers_channel ON notification_providers(channel);
      CREATE INDEX IF NOT EXISTS idx_notification_providers_enabled ON notification_providers(enabled);

      -- Notification delivery logs table
      CREATE TABLE IF NOT EXISTS notification_delivery_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_id INTEGER,
        provider_channel TEXT NOT NULL,
        status TEXT NOT NULL,
        message_id TEXT,
        error_message TEXT,
        sent_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (notification_id) REFERENCES notifications(id)
      );

      CREATE INDEX IF NOT EXISTS idx_delivery_logs_notification_id ON notification_delivery_logs(notification_id);
      CREATE INDEX IF NOT EXISTS idx_delivery_logs_provider ON notification_delivery_logs(provider_channel);
      CREATE INDEX IF NOT EXISTS idx_delivery_logs_status ON notification_delivery_logs(status);
      CREATE INDEX IF NOT EXISTS idx_delivery_logs_created_at ON notification_delivery_logs(created_at);
    `);
      });
    }

    // Migration 004: Add queue_session table for persisting queue position
    if (pending(4)) {
      applyMigration(database, 4, ['queue_session'], () => {
        logger.info('Running migration 004: Add queue_session table');

        database.exec(`
      -- Queue session table for persisting queue position across restarts
      CREATE TABLE IF NOT EXISTS queue_session (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        session_key TEXT NOT NULL,
        status TEXT DEFAULT 'Unknown',
        position INTEGER DEFAULT 0,
        estimated_wait_seconds INTEGER DEFAULT 0,
        expiry_seconds INTEGER DEFAULT 0,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
      });
    }

    // Migration 005: Add allow_partial_match column to watches
    if (pending(5)) {
      applyMigration(database, 5, [], () => {
        logger.info('Running migration 005: Add allow_partial_match column to watches');

        const tableInfo = database.prepare('PRAGMA table_info(watches)').all() as {
          name: string;
        }[];
        const hasColumn = tableInfo.some((col) => col.name === 'allow_partial_match');

        if (!hasColumn) {
          database.exec('ALTER TABLE watches ADD COLUMN allow_partial_match BOOLEAN DEFAULT 0');
          logger.info('Added allow_partial_match column to watches table');
        } else {
          logger.info('allow_partial_match column already exists');
        }
      });
    }

    // Migration 006: Add site_snipes table (Site Sniper feature, replaces STQ) and
    // widen the notifications type/related_type CHECK constraints to include snipe types.
    // NOTE: renaming notifications aside makes SQLite rewrite the delivery-log FK to
    // "notifications_old", which is then dropped. The SQL is kept as released (so v5 → v7
    // upgrades replay it exactly); migration 007 repairs the damage.
    if (pending(6)) {
      applyMigration(database, 6, ['site_snipes', 'notifications'], () => {
        logger.info('Running migration 006: Add site_snipes table + widen notifications CHECK');

        database.exec(`
      -- Site Sniper entries table
      CREATE TABLE IF NOT EXISTS site_snipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        campground_id TEXT NOT NULL,
        campground_name TEXT,
        target_site_ids TEXT,               -- JSON array of site id strings
        site_type TEXT DEFAULT 'all',
        arrival_date DATE NOT NULL,
        departure_date DATE NOT NULL,
        num_adult INTEGER DEFAULT 2,
        num_concession INTEGER DEFAULT 0,
        num_child INTEGER DEFAULT 0,
        num_infant INTEGER DEFAULT 0,
        num_vehicle INTEGER DEFAULT 1,
        postcode TEXT,
        release_mode TEXT NOT NULL DEFAULT 'daily_rollover'
           CHECK(release_mode IN ('daily_rollover','scheduled','cancellation')),
        release_at DATETIME,
        queue_enabled BOOLEAN DEFAULT 0,
        lead_time_seconds INTEGER DEFAULT 120,
        poll_interval_ms INTEGER DEFAULT 1500,
        window_duration_ms INTEGER DEFAULT 900000,
        status TEXT DEFAULT 'armed',
        is_active BOOLEAN DEFAULT 1,
        attempts_count INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 0,
        last_checked_at DATETIME,
        next_check_at DATETIME,
        last_result TEXT,
        last_error TEXT,
        held_booking_pk TEXT,
        held_expires_at DATETIME,
        payment_url TEXT,
        booked_reference TEXT,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_snipe_user_id ON site_snipes(user_id);
      CREATE INDEX IF NOT EXISTS idx_snipe_active ON site_snipes(is_active);
      CREATE INDEX IF NOT EXISTS idx_snipe_release_at ON site_snipes(release_at);
      CREATE TRIGGER IF NOT EXISTS update_site_snipes_timestamp
      AFTER UPDATE ON site_snipes
      BEGIN
        UPDATE site_snipes SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `);

        // Widen the notifications CHECK constraints. SQLite cannot ALTER a CHECK, so we
        // rebuild the table. Old values ('stq_success', related_type 'stq') are preserved
        // for backward compatibility with existing rows; new values are added.
        database.exec(`
      ALTER TABLE notifications RENAME TO notifications_old;
      CREATE TABLE notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('watch_found','stq_success','snipe_held','snipe_booked','booking_confirmed','error','warning','info')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        related_id INTEGER,
        related_type TEXT CHECK(related_type IN ('booking','watch','stq','snipe')),
        action_url TEXT,
        is_read BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO notifications (id,user_id,type,title,message,related_id,related_type,action_url,is_read,created_at)
        SELECT id,user_id,type,title,message,related_id,related_type,action_url,is_read,created_at FROM notifications_old;
      DROP TABLE notifications_old;
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
      CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
    `);
      });
    }

    // Migration 007: Integrity.
    // - Rebuild notifications without its CHECK constraints (types are validated in code).
    // - Rebuild notification_delivery_logs with a real FK to notifications (repairs 006),
    //   renaming provider_channel to notifier_channel.
    // - Rename notification_providers to notifiers.
    // - Drop the dead Skip The Queue table and its trigger.
    // Tables are rebuilt as: create under a temp name -> copy -> drop old -> rename new.
    // The old table is never renamed aside, because SQLite would then rewrite other tables'
    // FKs to the aside name (the 006 bug). Indexes are created only after the old table is
    // dropped, because index names are global.
    if (pending(7)) {
      applyMigration(
        database,
        7,
        ['notifications', 'notification_delivery_logs', 'notifiers'],
        () => {
          logger.info('Running migration 007: Repair delivery-log FK, notifiers, drop STQ');

          // 1. notifications, without the CHECK constraints
          const notificationsSeq = readSequence(database, 'notifications');
          database.exec(`
            CREATE TABLE notifications_v7 (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              type TEXT NOT NULL,
              title TEXT NOT NULL,
              message TEXT NOT NULL,
              related_id INTEGER,
              related_type TEXT,
              action_url TEXT,
              is_read BOOLEAN DEFAULT 0,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            INSERT INTO notifications_v7 (id, user_id, type, title, message, related_id,
                related_type, action_url, is_read, created_at)
              SELECT id, user_id, type, title, message, related_id,
                related_type, action_url, is_read, created_at
              FROM notifications;
            DROP TABLE notifications;
            ALTER TABLE notifications_v7 RENAME TO notifications;
            CREATE INDEX idx_notifications_user_id ON notifications(user_id);
            CREATE INDEX idx_notifications_is_read ON notifications(is_read);
            CREATE INDEX idx_notifications_type ON notifications(type);
            CREATE INDEX idx_notifications_created_at ON notifications(created_at);
          `);
          restoreSequence(database, 'notifications', notificationsSeq);

          // 2. notification_delivery_logs, with a real FK. Logs whose notification no
          //    longer exists are kept, with notification_id cleared.
          const orphaned = (
            database
              .prepare(
                `SELECT COUNT(*) AS n FROM notification_delivery_logs
                 WHERE notification_id IS NOT NULL
                   AND notification_id NOT IN (SELECT id FROM notifications)`
              )
              .get() as { n: number }
          ).n;
          const logsSeq = readSequence(database, 'notification_delivery_logs');
          database.exec(`
            CREATE TABLE notification_delivery_logs_v7 (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              notification_id INTEGER,
              notifier_channel TEXT NOT NULL,
              status TEXT NOT NULL,
              message_id TEXT,
              error_message TEXT,
              sent_at DATETIME,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
            );
            INSERT INTO notification_delivery_logs_v7 (id, notification_id, notifier_channel,
                status, message_id, error_message, sent_at, created_at)
              SELECT id,
                CASE WHEN notification_id IN (SELECT id FROM notifications)
                  THEN notification_id END,
                provider_channel, status, message_id, error_message, sent_at, created_at
              FROM notification_delivery_logs;
            DROP TABLE notification_delivery_logs;
            ALTER TABLE notification_delivery_logs_v7 RENAME TO notification_delivery_logs;
            CREATE INDEX idx_delivery_logs_notification_id ON notification_delivery_logs(notification_id);
            CREATE INDEX idx_delivery_logs_notifier ON notification_delivery_logs(notifier_channel);
            CREATE INDEX idx_delivery_logs_status ON notification_delivery_logs(status);
            CREATE INDEX idx_delivery_logs_created_at ON notification_delivery_logs(created_at);
          `);
          restoreSequence(database, 'notification_delivery_logs', logsSeq);
          if (orphaned > 0) {
            logger.info(
              `Migration 007: cleared notification_id on ${orphaned} delivery log(s) whose notification no longer exists`
            );
          }

          // 3. notification_providers -> notifiers. SQLite cannot rename an index, so the
          //    two indexes are dropped and recreated under the new name.
          database.exec(`
            ALTER TABLE notification_providers RENAME TO notifiers;
            DROP INDEX IF EXISTS idx_notification_providers_channel;
            DROP INDEX IF EXISTS idx_notification_providers_enabled;
            CREATE INDEX idx_notifiers_channel ON notifiers(channel);
            CREATE INDEX idx_notifiers_enabled ON notifiers(enabled);
          `);

          // 4. Skip The Queue is gone; its rows are discarded.
          const hasStq = database
            .prepare(
              "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'skip_the_queue_entries'"
            )
            .get();
          const discarded = hasStq
            ? (
                database.prepare('SELECT COUNT(*) AS n FROM skip_the_queue_entries').get() as {
                  n: number;
                }
              ).n
            : 0;
          database.exec(`
            DROP TRIGGER IF EXISTS update_stq_timestamp;
            DROP TABLE IF EXISTS skip_the_queue_entries;
          `);
          logger.info(
            `Migration 007: dropped skip_the_queue_entries, discarding ${discarded} row(s)`
          );
        }
      );
    }

    // Migration 008: Provider-aware data model (architecture-notes §5).
    // - users: credential columns become nullable; the profile no longer needs a login.
    // - provider_accounts: the ParkStay account, from the first users row; then, when there is
    //   no users row at all, the local profile row (id 1) is inserted.
    // - watches, site_snipes, bookings: rebuilt with provider_id, generic location, stay and
    //   unit columns and calendar dates YYYY-MM-DD; ParkStay extras move into stay_params.
    // - notifications: nullable provider_id.
    // - provider_state (queue_session moves into it) and locations with its FTS5 index.
    // Rebuilds follow v7: create X_v8 -> copy -> drop X -> rename X_v8 to X -> indexes and
    // triggers. Every step checks sqlite_master/table_info first, so it is idempotent.
    if (pending(8)) {
      applyMigration(
        database,
        8,
        [
          'users',
          'provider_accounts',
          'watches',
          'site_snipes',
          'bookings',
          'notifications',
          'provider_state',
          'locations',
        ],
        () => {
          logger.info('Running migration 008: Provider-aware data model');
          v8RebuildUsers(database);
          v8CreateProviderAccounts(database);
          v8EnsureLocalProfile(database);
          v8RebuildWatches(database);
          v8RebuildSiteSnipes(database);
          v8RebuildBookings(database);
          v8AddNotificationProvider(database);
          v8CreateProviderState(database);
          v8CreateLocations(database);
          v8AdoptOrphans(database);
        }
      );
    }

    // Migration 009 (V6): retire the legacy ParkStay credentials and record watch holds.
    // - users: rebuilt without encrypted_password and the encryption_* columns (§12.32);
    // - watches: hold_reference, hold_expires_at, hold_unit_id, payment_url, last_error
    //   (§12.31), added in place;
    // - provider_accounts: last_checked_at;
    // - maintenance: created, with the freed-page scrub requested in the same transaction.
    // After the step, the file is rewritten (VACUUM) so no freed page keeps the ciphertext.
    if (pending(9)) {
      applyMigration(database, 9, ['users', 'watches', 'provider_accounts', 'maintenance'], () => {
        logger.info('Running migration 009: Retire legacy credentials, watch holds');
        v9RebuildUsers(database);
        v9AddWatchHoldColumns(database);
        v9AddAccountLastChecked(database);
        v9RequestScrub(database);
      });
    }

    // Migration 010 (P7): drop the never-written job_logs table (architecture-notes §12.26).
    // It creates or rebuilds no table, so it has none to check.
    if (pending(10)) {
      applyMigration(database, 10, [], () => {
        logger.info('Running migration 010: Drop job_logs');
        v10DropJobLogs(database);
      });
    }
  } finally {
    database.pragma('foreign_keys = ON');
    database.pragma(`secure_delete = ${secureDelete}`);
  }

  // Outside every transaction: VACUUM cannot run inside one.
  scrubFreedPagesIfOwed(database);
}

/**
 * Opens (creating if needed) the database at `filePath`, enables foreign keys and WAL, and
 * migrates it to LATEST_SCHEMA_VERSION. On any failure the connection is closed and the
 * error rethrown.
 */
export function openDatabase(filePath: string): Database.Database {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const db = new Database(filePath, {
    verbose:
      process.env.NODE_ENV === 'development'
        ? (message?: unknown) => logger.debug(String(message))
        : undefined,
  });

  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    runMigrations(db);
  } catch (error) {
    db.close();
    throw error;
  }

  logger.info(`Database initialized at: ${filePath}`);
  return db;
}

/**
 * Closes a database connection opened by openDatabase.
 */
export function closeDatabase(db: Database.Database): void {
  if (db.open) {
    db.close();
    logger.info('Database connection closed');
  }
}
