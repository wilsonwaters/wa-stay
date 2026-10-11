/**
 * Migration v9 (V6, architecture-notes §12.26, §12.31, §12.32), upgraded from the real v5
 * (v1.2.0) and v6 fixtures and from a fresh v8 database:
 * - `users` keeps only the profile (id, email, names, phone, timestamps): the four `encrypt*`
 *   columns of the never-used ParkStay password are gone, every id, email and name is
 *   byte-identical, and every foreign key still binds to it (ON DELETE CASCADE included);
 * - `watches` gains `hold_reference`, `hold_expires_at`, `hold_unit_id`, `payment_url` and
 *   `last_error` (NULL on existing rows), `provider_accounts` gains `last_checked_at`; every
 *   other value is unchanged from the same fixture at v8;
 * - the dropped ciphertext is not left in the database file, in WAL mode (as the app opens
 *   it) or not (the file is rewritten after v9);
 * - re-running is a no-op, and a failing step rolls back to v8.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  closeDatabase,
  LATEST_SCHEMA_VERSION,
  MigrationError,
  openDatabase,
  runMigrations,
} from '@main/database/connection';
import { FIXTURE_MACHINE_ID, type FixtureName } from '@tests/fixtures/db/constants';
import { disposeFixture, loadFixture } from '@tests/utils/database-helper';

jest.mock('node-machine-id', () => ({ machineIdSync: () => FIXTURE_MACHINE_ID }));

type Row = Record<string, unknown>;

const FIXTURES: FixtureName[] = ['v5-release-1.2.0', 'v6-branch'];
const PROFILE_COLUMNS = [
  'id',
  'email',
  'first_name',
  'last_name',
  'phone',
  'created_at',
  'updated_at',
];
const WATCH_HOLD_COLUMNS = [
  'hold_reference',
  'hold_expires_at',
  'hold_unit_id',
  'payment_url',
  'last_error',
];

function version(db: Database.Database): number {
  return (db.prepare('SELECT MAX(version) AS v FROM migrations').get() as { v: number }).v;
}

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as { name: string }[]).map(
    (c) => c.name
  );
}

function rows(db: Database.Database, table: string): Row[] {
  return db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all() as Row[];
}

/** Every table's rows (not SQLite's own, the FTS index's or the migrations log). */
function snapshot(db: Database.Database): Record<string, Row[]> {
  const tables = (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table'
         AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE 'locations\\_fts%' ESCAPE '\\'
         AND name <> 'migrations' ORDER BY name`
      )
      .all() as { name: string }[]
  ).map((t) => t.name);
  return Object.fromEntries(tables.map((table) => [table, rows(db, table)]));
}

/** Drops the given keys from every row. */
function without(list: Row[], keys: string[]): Row[] {
  return list.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)))
  );
}

/** The fixture's legacy ParkStay password ciphertext: the hex strings of its three columns. */
function legacyCiphertext(db: Database.Database): string[] {
  const row = db
    .prepare('SELECT encrypted_password, encryption_iv, encryption_auth_tag FROM users')
    .get() as Record<string, string>;
  const values = Object.values(row);
  expect(values.every((value) => /^[0-9a-f]{20,}$/.test(value))).toBe(true); // not vacuous
  return values;
}

/** Which of `needles` the files' bytes still hold. */
function foundIn(files: string[], needles: string[]): string[] {
  return files
    .filter((file) => fs.existsSync(file))
    .flatMap((file) => {
      const bytes = fs.readFileSync(file);
      return needles
        .filter((needle) => bytes.includes(Buffer.from(needle, 'utf8')))
        .map((needle) => `${path.basename(file)}: ${needle.slice(0, 12)}…`);
    });
}

describe.each(FIXTURES)('migration v9 from the %s fixture', (fixture) => {
  let db: Database.Database;
  let atV8: Record<string, Row[]>;
  let sequenceAtV8: Row[];

  beforeEach(() => {
    db = loadFixture(fixture);
    runMigrations(db, 8);
    atV8 = snapshot(db);
    sequenceAtV8 = rows(db, 'sqlite_sequence');
    // Pinned to v9, so these keep testing exactly what v9 does (migration-v10.test.ts: v10)
    runMigrations(db, 9);
  });

  afterEach(() => disposeFixture(db));

  it('users keeps the profile only: no encrypt* columns, the same id, email and names', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(9);
    expect(version(db)).toBe(9);
    expect(columns(db, 'users')).toEqual(PROFILE_COLUMNS);
    expect(columns(db, 'users').filter((c) => c.startsWith('encrypt'))).toEqual([]);
    expect(rows(db, 'users')).toEqual(
      without(atV8.users, [
        'encrypted_password',
        'encryption_key',
        'encryption_iv',
        'encryption_auth_tag',
      ])
    );
    expect(rows(db, 'users')).toEqual([
      expect.objectContaining({ id: 1, email: 'fixture.user@example.com' }),
    ]);
  });

  it('PRAGMA foreign_key_check is empty, and every foreign key still binds to users', () => {
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    for (const table of ['watches', 'site_snipes', 'bookings', 'notifications']) {
      expect(db.pragma(`foreign_key_list(${table})`)).toEqual([
        expect.objectContaining({ table: 'users', from: 'user_id', on_delete: 'CASCADE' }),
      ]);
    }
    // No temp name left behind
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%\\_v9' ESCAPE '\\'").all()
    ).toEqual([]);
  });

  it('keeps the users index, timestamp trigger and AUTOINCREMENT high-water mark', () => {
    expect(
      db
        .prepare(
          "SELECT type, name FROM sqlite_master WHERE tbl_name = 'users' AND type <> 'table' ORDER BY name"
        )
        .all()
    ).toEqual([
      { type: 'index', name: 'idx_users_email' },
      // UNIQUE (email)
      { type: 'index', name: 'sqlite_autoindex_users_1' },
      { type: 'trigger', name: 'update_users_timestamp' },
    ]);
    const byName = (list: Row[]) =>
      [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    expect(byName(rows(db, 'sqlite_sequence'))).toEqual(byName(sequenceAtV8));
  });

  it('adds the five watch hold columns, NULL on existing rows; everything else is unchanged', () => {
    expect(columns(db, 'watches').slice(-5)).toEqual(WATCH_HOLD_COLUMNS);
    expect(atV8.watches.length).toBeGreaterThan(0);
    for (const watch of rows(db, 'watches')) {
      expect(WATCH_HOLD_COLUMNS.map((c) => watch[c])).toEqual([null, null, null, null, null]);
    }
    expect(without(rows(db, 'watches'), WATCH_HOLD_COLUMNS)).toEqual(atV8.watches);

    expect(rows(db, 'provider_accounts')).toEqual(
      atV8.provider_accounts.map((account) => ({ ...account, last_checked_at: null }))
    );

    const after = snapshot(db);
    for (const table of Object.keys(atV8)) {
      if (['users', 'watches', 'provider_accounts'].includes(table)) continue;
      expect([table, after[table]]).toEqual([table, atV8[table]]);
    }
  });

  it('changes nothing when run again', () => {
    const before = snapshot(db);
    runMigrations(db, 9);
    expect(version(db)).toBe(9);
    expect(snapshot(db)).toEqual(before);
  });

  it('still cascades from the rebuilt users table', () => {
    db.prepare("INSERT INTO users (id, email) VALUES (50, 'other@example.com')").run();
    db.prepare(
      `INSERT INTO watches (user_id, name, location_external_id, location_name, arrival_date,
         departure_date, num_adults) VALUES (50, 'Theirs', '1', 'Somewhere', '2026-12-01', '2026-12-02', 2)`
    ).run();
    const ownWatches = rows(db, 'watches').filter((w) => w.user_id === 1).length;

    db.prepare('DELETE FROM users WHERE id = 50').run();

    expect(rows(db, 'watches').filter((w) => w.user_id === 50)).toEqual([]);
    expect(rows(db, 'watches').filter((w) => w.user_id === 1)).toHaveLength(ownWatches);
  });
});

describe('migration v9: the dropped ciphertext is not left in the file', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-v9-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /** The v5 fixture as a database file in `tmpDir`, and its legacy ciphertext. */
  function fixtureFile(): { file: string; ciphertext: string[] } {
    const loaded = loadFixture('v5-release-1.2.0');
    const ciphertext = legacyCiphertext(loaded);
    const file = path.join(tmpDir, 'wa-stay.db');
    loaded.close();
    fs.copyFileSync(path.join(path.dirname(loaded.name), 'v5-release-1.2.0.db'), file);
    fs.rmSync(path.dirname(loaded.name), { recursive: true, force: true });
    return { file, ciphertext };
  }

  it('the scan sees the ciphertext while it is there (v8 keeps it)', () => {
    const { file, ciphertext } = fixtureFile();
    const db = new Database(file);
    runMigrations(db, 8);
    db.close();

    expect(foundIn([file], ciphertext)).toHaveLength(3);
  });

  it('opened as the app opens it (WAL), upgraded to v9 and closed: no byte of it is left', () => {
    const { file, ciphertext } = fixtureFile();
    const db = openDatabase(file);
    expect(version(db)).toBe(LATEST_SCHEMA_VERSION);
    // Before the app has even closed it: the WAL was emptied after the rewrite
    expect(foundIn([file, `${file}-wal`], ciphertext)).toEqual([]);
    closeDatabase(db);

    expect(foundIn([file, `${file}-wal`, `${file}-shm`], ciphertext)).toEqual([]);
  });

  it('upgraded without WAL (rollback journal): no byte of it is left', () => {
    const { file, ciphertext } = fixtureFile();
    const db = new Database(file);
    runMigrations(db);
    db.close();

    expect(foundIn([file, `${file}-journal`], ciphertext)).toEqual([]);
  });

  it('a v8 database that already freed its pages (v8 rebuilt users) is cleaned by v9 too', () => {
    const { file, ciphertext } = fixtureFile();
    const v8 = openDatabase(file); // v9 runs here: v8 and v9 in one start
    closeDatabase(v8);
    expect(foundIn([file], ciphertext)).toEqual([]);
  });

  /** `db` whose VACUUM fails as on a full disk; everything else runs. */
  function vacuumFails(db: Database.Database): jest.SpyInstance {
    const exec = db.exec.bind(db);
    return jest.spyOn(db, 'exec').mockImplementation((sql: string) => {
      if (sql.trim() === 'VACUUM') throw new Error('SQLITE_FULL: database or disk is full');
      return exec(sql);
    });
  }

  const tasks = (db: Database.Database) => db.prepare('SELECT task FROM maintenance').all();
  const freePages = (db: Database.Database) =>
    Number(db.pragma('freelist_count', { simple: true }));

  /** `db` with the runner's `secure_delete = ON` ignored, as a runner without it would run. */
  function withoutSecureDelete(db: Database.Database): void {
    const pragma = db.pragma.bind(db);
    jest
      .spyOn(db, 'pragma')
      .mockImplementation(((source: string, options?: Database.PragmaOptions) =>
        /secure_delete\s*=\s*ON/i.test(source) ? [] : pragma(source, options)) as never);
  }

  it('VACUUM fails (a full disk): secure_delete zeroed what the migrations freed, so no byte is left (without it, all of it would be)', () => {
    const control = fixtureFile();
    const unprotected = new Database(control.file);
    withoutSecureDelete(unprotected);
    vacuumFails(unprotected);
    runMigrations(unprotected, 9);
    unprotected.close();
    expect(foundIn([control.file], control.ciphertext)).toHaveLength(3);
    fs.rmSync(control.file);

    const { file, ciphertext } = fixtureFile();
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    vacuumFails(db);
    runMigrations(db, 9);

    expect(version(db)).toBe(9);
    // The runner put secure_delete back as it found it
    expect(db.pragma('secure_delete', { simple: true })).toBe(0);
    expect(foundIn([file, `${file}-wal`], ciphertext)).toEqual([]);
    db.close();
    expect(foundIn([file, `${file}-wal`], ciphertext)).toEqual([]);
  });

  it('free pages an older build left holding it: a failed VACUUM keeps the task, and the next start rewrites the file', () => {
    const { file, ciphertext } = fixtureFile();
    const old = new Database(file);
    // As a build without secure_delete could leave it: copies of the ciphertext on free pages
    old.exec(`
      CREATE TABLE copied AS SELECT * FROM users;
      CREATE TABLE padding AS
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 500)
        SELECT i, hex(randomblob(100)) AS b FROM n;
      DROP TABLE copied;
      DROP TABLE padding;
    `);
    expect(freePages(old)).toBeGreaterThan(2);
    vacuumFails(old);
    runMigrations(old, 9);
    expect(version(old)).toBe(9);
    expect(tasks(old)).toEqual([{ task: 'vacuum-freed-pages' }]);
    expect(freePages(old)).toBeGreaterThan(0);
    old.close();
    expect(foundIn([file], ciphertext).length).toBeGreaterThan(0);

    const next = new Database(file);
    const exec = jest.spyOn(next, 'exec');
    runMigrations(next, 9); // already at v9: no step runs, the owed scrub does
    expect(exec).toHaveBeenCalledWith('VACUUM');
    expect(freePages(next)).toBe(0);
    expect(tasks(next)).toEqual([]);

    // Done: later starts do not rewrite the file again
    exec.mockClear();
    runMigrations(next, 9);
    expect(exec).not.toHaveBeenCalledWith('VACUUM');
    next.close();
    expect(foundIn([file, `${file}-journal`], ciphertext)).toEqual([]);
  });

  it('with no free page left, the task is cleared without a VACUUM; a v9 database without the table owes nothing', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare("INSERT INTO maintenance (task) VALUES ('vacuum-freed-pages')").run();
    expect(freePages(db)).toBe(0);
    const exec = jest.spyOn(db, 'exec');

    runMigrations(db);
    expect(exec).not.toHaveBeenCalledWith('VACUUM');
    expect(tasks(db)).toEqual([]);

    // A v9 database from before the table (development builds only)
    db.exec('DROP TABLE maintenance');
    expect(() => runMigrations(db)).not.toThrow();
    db.close();
  });
});

describe('migration v9 from a fresh v8 database', () => {
  it('keeps the local profile row (id 1) and adds the columns', () => {
    const db = new Database(':memory:');
    runMigrations(db, 8);
    expect(rows(db, 'users')).toEqual([
      expect.objectContaining({ id: 1, email: null, encrypted_password: null }),
    ]);

    runMigrations(db, 9);

    expect(version(db)).toBe(9);
    expect(rows(db, 'users')).toEqual([
      {
        id: 1,
        email: null,
        first_name: null,
        last_name: null,
        phone: null,
        created_at: expect.any(String),
        updated_at: expect.any(String),
      },
    ]);
    expect(columns(db, 'provider_accounts')).toContain('last_checked_at');
    expect(columns(db, 'watches')).toEqual(expect.arrayContaining(WATCH_HOLD_COLUMNS));
    db.close();
  });

  it('rolls back completely when the step fails, leaving the database at v8', () => {
    const db = loadFixture('v6-branch');
    try {
      runMigrations(db, 8);
      // Squat on the users rebuild's temp name: v9 fails before it writes anything
      db.exec('CREATE TABLE users_v9 (id INTEGER PRIMARY KEY)');
      const before = snapshot(db);

      let thrown: unknown;
      try {
        runMigrations(db);
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(MigrationError);
      expect((thrown as MigrationError).version).toBe(9);
      expect(version(db)).toBe(8);
      expect(columns(db, 'users')).toContain('encrypted_password');
      expect(columns(db, 'watches')).not.toContain('hold_reference');
      expect(snapshot(db)).toEqual(before);
    } finally {
      disposeFixture(db);
    }
  });
});
