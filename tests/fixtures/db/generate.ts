/**
 * Regenerates the schema fixtures in this folder. Run from the repository root:
 *
 *   npx ts-node --transpile-only tests/fixtures/db/generate.ts
 *
 * - `v5-release-1.2.0.sql`: schema and migrations from the released v1.2.0 `connection.ts`
 *   (V5_SHA), plus the fixture rows below.
 * - `v6-branch.sql`: the v5 dump replayed and migrated by the pre-P2 v6 `connection.ts`
 *   (V6_SHA), exactly as a dev build would upgrade it, plus one Site Sniper row.
 *
 * Both `connection.ts` versions are read with `git show`, so the history must be available.
 * The output is deterministic (fixed IVs, keys and timestamps), so regenerating without a
 * change reproduces the files byte for byte. Never hand-edit the dumps: change this script
 * and regenerate. See README.md for the row inventory and the fake plaintexts.
 */

import Database from 'better-sqlite3';
import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import ts from 'typescript';
import { FIXTURE_MACHINE_ID, FIXTURE_SMTP_PASSWORD, FIXTURE_USER_PASSWORD } from './constants';

const V5_SHA = 'dcccfa72a5c89f13aaec3c78f207e3e8ffc90147'; // chore: prepare release v1.2.0
const V6_SHA = '29bd91f78a1d17361e8b9126cb1f3fdd554634ab'; // last pre-P2 commit used for v6

const REPO_ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = __dirname;

interface LegacyConnection {
  SCHEMA_SQL: string;
  runMigrations(db: Database.Database): void;
}

/**
 * Loads `src/main/database/connection.ts` as it was at `sha`. Only `SCHEMA_SQL` and
 * `runMigrations` are used; the `electron` import is satisfied with a stub because the
 * functions that need it (`initializeDatabase` and friends) are never called.
 */
function loadLegacyConnection(sha: string): LegacyConnection {
  const source = execFileSync('git', ['show', `${sha}:src/main/database/connection.ts`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const baseRequire = createRequire(path.join(REPO_ROOT, 'package.json'));
  const legacyRequire = (id: string): unknown =>
    id === 'electron' ? { app: undefined } : baseRequire(id);
  const module = { exports: {} as Record<string, unknown> };
  const filename = path.join(REPO_ROOT, 'src/main/database', `connection.${sha.slice(0, 7)}.js`);
  const wrapper = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    outputText
  );
  wrapper(module.exports, legacyRequire, module, filename, path.dirname(filename));
  return module.exports as unknown as LegacyConnection;
}

/** AES-256-GCM with a PBKDF2(machineId + secret) key: the v1.x scheme, with a fixed IV. */
function legacyEncrypt(secret: string, salt: string, ivHex: string, plaintext: string) {
  const key = crypto.pbkdf2Sync(FIXTURE_MACHINE_ID + secret, salt, 100000, 32, 'sha512');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encrypted, iv: ivHex, authTag: cipher.getAuthTag().toString('hex') };
}

/** `AuthService.encryptPassword` (v1.2.0). */
function encryptUserPassword(password: string) {
  return legacyEncrypt(
    'parkstay-bookings-v1-secret',
    'parkstay-salt',
    '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
    password
  );
}

/** The v1.2.0 notifier repository's `encryptConfig` (now `NotifierRepository`): `iv:authTag:ciphertext`. */
function encryptNotifierConfig(config: object): string {
  const { encrypted, iv, authTag } = legacyEncrypt(
    'parkstay-notification-providers-v1',
    'parkstay-provider-salt',
    'a0b1c2d3e4f5061728394a5b6c7d8e9f',
    JSON.stringify(config)
  );
  return `${iv}:${authTag}:${encrypted}`;
}

/** Rows shared by both fixtures. Inserted with explicit ids and timestamps. */
function insertFixtureRows(db: Database.Database): void {
  const password = encryptUserPassword(FIXTURE_USER_PASSWORD);
  db.prepare(
    `INSERT INTO users (id, email, encrypted_password, encryption_key, encryption_iv,
       encryption_auth_tag, first_name, last_name, phone, created_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'fixture.user@example.com',
    password.encrypted,
    '5c'.repeat(32),
    password.iv,
    password.authTag,
    'Fixture',
    'User',
    '+61400000000',
    '2025-11-02 01:00:00',
    '2025-11-02 01:00:00'
  );

  const booking = db.prepare(
    `INSERT INTO bookings (id, user_id, booking_reference, park_name, campground_name,
       site_number, site_type, arrival_date, departure_date, num_nights, num_guests,
       total_cost, currency, status, booking_data, notes, created_at, updated_at, synced_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUD', ?, ?, ?, ?, ?, ?)`
  );
  booking.run(
    1,
    'PS0012345',
    'Cape Range National Park',
    'Osprey Bay',
    '12',
    'Unpowered',
    '2026-01-10T00:00:00.000Z',
    '2026-01-13T00:00:00.000Z',
    3,
    2,
    85.5,
    'confirmed',
    JSON.stringify({ gearType: 'tent', vehicles: 1 }),
    'Ocean-side site',
    '2025-11-03 02:00:00',
    '2025-11-03 02:00:00',
    '2025-11-03 02:05:00'
  );
  booking.run(
    2,
    'PS0067890',
    'Cape Le Grand National Park',
    'Lucky Bay',
    null,
    null,
    '2026-03-20T00:00:00.000Z',
    '2026-03-22T00:00:00.000Z',
    2,
    4,
    null,
    'cancelled',
    null,
    null,
    '2025-11-04 03:00:00',
    '2025-11-05 03:00:00',
    null
  );

  const watch = db.prepare(
    `INSERT INTO watches (id, user_id, name, park_id, park_name, campground_id, campground_name,
       arrival_date, departure_date, num_guests, preferred_sites, site_type,
       check_interval_minutes, is_active, last_checked_at, next_check_at, last_result,
       found_count, auto_book, notify_only, max_price, notes, created_at, updated_at,
       last_availability, allow_partial_match)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, ?, ?)`
  );
  watch.run(
    1,
    'Osprey Bay Easter',
    '17',
    'Cape Range National Park',
    '34',
    'Osprey Bay',
    '2026-04-03T00:00:00.000Z',
    '2026-04-06T00:00:00.000Z',
    2,
    JSON.stringify(['136', '137']),
    'Unpowered',
    15,
    1,
    '2025-11-06 04:00:00',
    '2025-11-06 04:15:00',
    'found',
    2,
    60,
    null,
    '2025-11-05 04:00:00',
    '2025-11-06 04:00:00',
    JSON.stringify([
      {
        siteId: '136',
        siteName: 'Site 136',
        siteType: 'Unpowered',
        available: true,
        price: 20,
        dates: [{ date: '2026-04-03', available: true, price: 20 }],
      },
    ]),
    1
  );
  watch.run(
    2,
    'Lucky Bay long weekend',
    '42',
    'Cape Le Grand National Park',
    '88',
    'Lucky Bay',
    '2026-06-01T00:00:00.000Z',
    '2026-06-03T00:00:00.000Z',
    4,
    null,
    null,
    60,
    0,
    null,
    null,
    null,
    0,
    null,
    'Paused',
    '2025-11-07 05:00:00',
    '2025-11-07 05:00:00',
    null,
    0
  );

  const notification = db.prepare(
    `INSERT INTO notifications (id, user_id, type, title, message, related_id, related_type,
       action_url, is_read, created_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  notification.run(
    1,
    'watch_found',
    'Availability found',
    'Osprey Bay has 2 sites free',
    1,
    'watch',
    null,
    0,
    '2025-11-06 04:00:01'
  );
  notification.run(
    2,
    'info',
    'Welcome',
    'ParkStay Bookings is ready',
    null,
    null,
    null,
    1,
    '2025-11-02 01:00:01'
  );
  // Legacy Skip The Queue values: no longer in the enums, but must stay readable.
  notification.run(
    3,
    'stq_success',
    'Rebooked',
    'Skip The Queue rebooked PS0012345',
    1,
    'stq',
    null,
    1,
    '2025-11-04 03:30:00'
  );

  db.prepare(
    `INSERT INTO notification_providers (id, channel, display_name, enabled, config, status,
       last_tested_at, last_error, created_at, updated_at)
     VALUES (1, 'email_smtp', 'Email (SMTP)', 1, ?, 'configured', ?, NULL, ?, ?)`
  ).run(
    encryptNotifierConfig({
      preset: 'gmail',
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: 'fixture.user@example.com', pass: FIXTURE_SMTP_PASSWORD },
      toEmail: 'fixture.user@example.com',
    }),
    '2025-11-02 01:10:00',
    '2025-11-02 01:05:00',
    '2025-11-02 01:10:00'
  );

  const deliveryLog = db.prepare(
    `INSERT INTO notification_delivery_logs (id, notification_id, provider_channel, status,
       message_id, error_message, sent_at, created_at)
     VALUES (?, ?, 'email_smtp', ?, ?, ?, ?, ?)`
  );
  deliveryLog.run(
    1,
    1,
    'sent',
    '<fixture-1@example.com>',
    null,
    '2025-11-06T04:00:02.000Z',
    '2025-11-06 04:00:02'
  );
  deliveryLog.run(2, null, 'failed', null, 'Invalid login', null, '2025-11-04 03:30:01');

  const setting = db.prepare(
    `INSERT INTO settings (key, value, value_type, category, description, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  setting.run('launchOnStartup', 'true', 'boolean', 'general', null, '2025-11-02 01:20:00');
  setting.run(
    'defaultCheckIntervalMinutes',
    '15',
    'number',
    'watches',
    'Default watch interval',
    '2025-11-02 01:20:00'
  );
  setting.run(
    'dashboardLayout',
    JSON.stringify({ cards: ['watches', 'bookings'] }),
    'json',
    'ui',
    null,
    '2025-11-02 01:20:00'
  );

  db.prepare(
    `INSERT INTO queue_session (id, session_key, status, position, estimated_wait_seconds,
       expiry_seconds, expires_at, created_at, updated_at)
     VALUES (1, ?, 'Active', 0, 0, 600, ?, ?, ?)`
  ).run(
    'FIXTURESESSIONKEY00000000000000000000000000000000000',
    '2025-11-06T04:10:00.000Z',
    '2025-11-06T04:00:00.000Z',
    '2025-11-06T04:00:00.000Z'
  );

  db.prepare(
    `INSERT INTO skip_the_queue_entries (id, user_id, booking_id, booking_reference, is_active,
       check_interval_minutes, last_checked_at, next_check_at, attempts_count, max_attempts,
       last_result, success_date, new_booking_reference, notes, created_at, updated_at)
     VALUES (1, 1, 1, 'PS0012345', 0, 2, ?, NULL, 41, 1000, 'success', ?, 'PS0012399', NULL, ?, ?)`
  ).run('2025-11-04 03:29:00', '2025-11-04 03:29:00', '2025-11-03 02:10:00', '2025-11-04 03:29:00');
}

/** The one row added on the v6 branch. */
function insertV6Rows(db: Database.Database): void {
  db.prepare(
    `INSERT INTO site_snipes (id, user_id, name, campground_id, campground_name, target_site_ids,
       site_type, arrival_date, departure_date, num_adult, num_concession, num_child, num_infant,
       num_vehicle, postcode, release_mode, release_at, queue_enabled, lead_time_seconds,
       poll_interval_ms, window_duration_ms, status, is_active, attempts_count, max_attempts,
       last_checked_at, next_check_at, last_result, last_error, held_booking_pk, held_expires_at,
       payment_url, booked_reference, notes, created_at, updated_at)
     VALUES (1, 1, ?, '34', 'Osprey Bay', ?, 'all', ?, ?, 2, 0, 0, 0, 1, '6000',
       'daily_rollover', ?, 1, 120, 1500, 900000, 'armed', 1, 0, 0, NULL, NULL, NULL, NULL,
       NULL, NULL, NULL, NULL, ?, ?, ?)`
  ).run(
    'Osprey Bay July',
    JSON.stringify(['136', '137']),
    '2026-07-19T00:00:00.000Z',
    '2026-07-21T00:00:00.000Z',
    '2026-01-19T16:00:00.000Z',
    'High demand weekend',
    '2026-01-05 06:00:00',
    '2026-01-05 06:00:00'
  );
}

/** Pins `migrations.applied_at` so the dump does not depend on when it was generated. */
function pinMigrationTimes(db: Database.Database, appliedAt: string, versions: number[]): void {
  const stmt = db.prepare('UPDATE migrations SET applied_at = ? WHERE version = ?');
  for (const version of versions) stmt.run(appliedAt, version);
}

interface MasterRow {
  type: string;
  name: string;
  sql: string;
}

/**
 * Dumps every table (schema and rows), `sqlite_sequence`, then every index and trigger,
 * each group in creation (rowid) order. Values are written with SQLite's own `quote()`.
 */
function dumpDatabase(db: Database.Database, title: string, sha: string): string {
  const objects = db
    .prepare(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid`
    )
    .all() as MasterRow[];
  const version = (db.prepare('SELECT MAX(version) AS v FROM migrations').get() as { v: number }).v;

  const lines = [
    `-- ${title}`,
    `-- Schema version ${version}, generated from connection.ts at ${sha}.`,
    '-- Generated by tests/fixtures/db/generate.ts. Do not edit by hand: regenerate instead.',
    'BEGIN TRANSACTION;',
  ];

  for (const table of objects.filter((o) => o.type === 'table')) {
    lines.push(`${table.sql};`);
    const columns = (
      db.prepare('SELECT name FROM pragma_table_info(?)').all(table.name) as {
        name: string;
      }[]
    ).map((c) => `quote("${c.name}")`);
    const rows = db
      .prepare(`SELECT ${columns.join(" || ',' || ")} AS v FROM "${table.name}" ORDER BY rowid`)
      .all() as { v: string }[];
    for (const row of rows) lines.push(`INSERT INTO "${table.name}" VALUES(${row.v});`);
  }

  lines.push('DELETE FROM sqlite_sequence;');
  const sequences = db
    .prepare('SELECT quote(name) AS name, seq FROM sqlite_sequence ORDER BY rowid')
    .all() as { name: string; seq: number }[];
  for (const s of sequences) lines.push(`INSERT INTO sqlite_sequence VALUES(${s.name},${s.seq});`);

  for (const type of ['index', 'trigger']) {
    for (const object of objects.filter((o) => o.type === type)) lines.push(`${object.sql};`);
  }

  lines.push('COMMIT;', '');
  return lines.join('\n');
}

function main(): void {
  const legacyV5 = loadLegacyConnection(V5_SHA);
  const legacyV6 = loadLegacyConnection(V6_SHA);

  // v5: what a v1.2.0 install looks like. initializeDatabase() at V5_SHA does exactly this.
  const v5 = new Database(':memory:');
  v5.pragma('foreign_keys = ON');
  v5.exec(legacyV5.SCHEMA_SQL);
  legacyV5.runMigrations(v5);
  pinMigrationTimes(v5, '2025-11-01 00:00:00', [1, 2, 3, 4, 5]);
  insertFixtureRows(v5);
  const v5Dump = dumpDatabase(v5, 'WA ParkStay Bookings v1.2.0 database (schema v5)', V5_SHA);
  v5.close();
  fs.writeFileSync(path.join(OUT_DIR, 'v5-release-1.2.0.sql'), v5Dump);

  // v6: replay the v5 dump, then start it the way a pre-P2 dev build would.
  const v6 = new Database(':memory:');
  v6.pragma('foreign_keys = OFF');
  v6.exec(v5Dump);
  v6.pragma('foreign_keys = ON');
  v6.exec(legacyV6.SCHEMA_SQL);
  legacyV6.runMigrations(v6);
  pinMigrationTimes(v6, '2026-01-05 00:00:00', [6]);
  insertV6Rows(v6);
  const v6Dump = dumpDatabase(
    v6,
    'WA ParkStay Bookings pre-P2 branch database (schema v6)',
    V6_SHA
  );
  v6.close();
  fs.writeFileSync(path.join(OUT_DIR, 'v6-branch.sql'), v6Dump);

  console.log('Wrote v5-release-1.2.0.sql and v6-branch.sql');
}

main();
