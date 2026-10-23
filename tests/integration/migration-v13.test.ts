/**
 * Migration v13 (split stays, architecture-notes §12.36): `watches.allow_split_stay`.
 *
 * - From the real v5 (v1.2.0) and v6 fixtures: `watches` gains `allow_split_stay INTEGER NOT
 *   NULL DEFAULT 0`. Every existing watch reads 0 (through its repository: `allowSplitStay`
 *   false), and every other table and column is unchanged from the same fixture at v12;
 *   `foreign_key_check` and `integrity_check` are clean.
 * - From a v12 database with a watch written by v12's columns: the same, its data intact.
 * - A column already there (a partly migrated database) is skipped.
 * - Re-running is a no-op, and a fresh database has the same normalised schema as the migrated
 *   ones.
 * - The repository writes and reads it: create, update, and a watch created without it.
 *
 * The fixture tests pin the target to v13 (`runMigrations(db, 13)`) so they keep testing
 * exactly what v13 does; later versions have their own tests.
 */

import Database from 'better-sqlite3';
import {
  closeDatabase,
  LATEST_SCHEMA_VERSION,
  openDatabase,
  runMigrations,
} from '@main/database/connection';
import { WatchRepository } from '@main/database/repositories';
import type { WatchInput } from '@shared/types';
import { WatchResult } from '@shared/types/common.types';
import type { FixtureName } from '@tests/fixtures/db/constants';
import { disposeFixture, loadFixture } from '@tests/utils/database-helper';

type Row = Record<string, unknown>;

const FIXTURES: FixtureName[] = ['v5-release-1.2.0', 'v6-branch'];

/** The column v13 adds, as `PRAGMA table_info` describes it. */
const ADDED: Row[] = [{ name: 'allow_split_stay', type: 'INTEGER', notnull: 1, dflt_value: '0' }];

function version(db: Database.Database): number {
  return (db.prepare('SELECT MAX(version) AS v FROM migrations').get() as { v: number }).v;
}

/** `table`'s columns among `names`, as `PRAGMA table_info` describes them, in table order. */
function columns(db: Database.Database, table: string, names: string[]): Row[] {
  return (
    db
      .prepare(`SELECT name, type, "notnull", dflt_value FROM pragma_table_info(?)`)
      .all(table) as Row[]
  ).filter((c) => names.includes(c.name as string));
}

/** Every table's rows except the migrations log, sqlite_sequence ordered by name. */
function snapshot(db: Database.Database): Record<string, Row[]> {
  const tables = (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table'
         AND name NOT LIKE 'locations\\_fts%' ESCAPE '\\' AND name <> 'migrations' ORDER BY name`
      )
      .all() as { name: string }[]
  ).map((t) => t.name);
  return Object.fromEntries(
    tables.map((table) => [
      table,
      db
        .prepare(
          `SELECT * FROM "${table}" ORDER BY ${table === 'sqlite_sequence' ? 'name' : 'rowid'}`
        )
        .all() as Row[],
    ])
  );
}

/** sqlite_master with whitespace collapsed, ordered by type and name. */
function normalisedSchema(db: Database.Database): Row[] {
  return (
    db.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name').all() as {
      sql: string | null;
    }[]
  ).map((o) => ({ ...o, sql: o.sql === null ? null : o.sql.replace(/\s+/g, ' ').trim() }));
}

describe.each(FIXTURES)('migration v13 from the %s fixture', (fixture) => {
  let db: Database.Database;
  let atV12: Record<string, Row[]>;

  beforeEach(() => {
    db = loadFixture(fixture);
    runMigrations(db, 12);
    atV12 = snapshot(db);
    runMigrations(db, 13);
  });

  afterEach(() => disposeFixture(db));

  it('adds allow_split_stay to watches, in place', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(13);
    expect(version(db)).toBe(13);
    expect(columns(db, 'watches', ['allow_split_stay'])).toEqual(ADDED);
  });

  it('gives every watch allow_split_stay 0; nothing else changes', () => {
    // Not vacuous: the fixture has watches
    expect(atV12.watches.length).toBeGreaterThan(0);
    expect(snapshot(db)).toEqual({
      ...atV12,
      watches: atV12.watches.map((row) => ({ ...row, allow_split_stay: 0 })),
    });
  });

  it('its watches read allowSplitStay false through their repository', () => {
    const watches = new WatchRepository(db).findAll();
    expect(watches.length).toBe(atV12.watches.length);
    expect(watches.every((watch) => watch.allowSplitStay === false)).toBe(true);
  });

  it('passes foreign_key_check and integrity_check', () => {
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('changes nothing when run again', () => {
    const schema = normalisedSchema(db);
    const data = snapshot(db);
    runMigrations(db, 13);
    runMigrations(db);
    expect(version(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(normalisedSchema(db)).toEqual(schema);
    expect(snapshot(db)).toEqual(data);
  });
});

describe('migration v13', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, 12);
  });

  afterEach(() => {
    if (db.open) db.close();
  });

  it('from v12: a watch keeps every value it had, and reads allow_split_stay 0', () => {
    db.prepare(
      `INSERT INTO watches (
         user_id, provider_id, name, location_external_id, location_name, area_name,
         arrival_date, departure_date, num_adults, unit_ids, unit_kinds, stay_params,
         check_interval_minutes, auto_book, notify_only, allow_partial_match, max_price,
         last_result, last_availability, found_count, hold_expires_estimated
       ) VALUES (1, 'rac', 'Busselton in July', 'busselton', 'RAC Busselton Holiday Park', NULL,
         '2027-07-01', '2027-07-06', 2, '[]', '["campsite"]', '{"pets":0}', 60, 0, 1, 1, 80,
         'partial_found', '[]', 3, 0)`
    ).run();
    const before = snapshot(db);

    runMigrations(db, 13);

    expect(version(db)).toBe(13);
    expect(snapshot(db)).toEqual({
      ...before,
      watches: before.watches.map((row) => ({ ...row, allow_split_stay: 0 })),
    });
    expect(db.pragma('foreign_key_check')).toEqual([]);
    const [watch] = new WatchRepository(db).findAll();
    expect(watch).toMatchObject({
      providerId: 'rac',
      unitKinds: ['campsite'],
      stayParams: { pets: 0 },
      allowPartialMatch: true,
      allowSplitStay: false,
      maxPrice: 80,
      foundCount: 3,
    });
  });

  it('skips the column when it is already there (a partly migrated database)', () => {
    db.exec(`ALTER TABLE watches ADD COLUMN allow_split_stay INTEGER NOT NULL DEFAULT 0`);

    runMigrations(db, 13);

    expect(version(db)).toBe(13);
    expect(columns(db, 'watches', ['allow_split_stay'])).toEqual(ADDED);
  });

  it('a fresh database is at the latest version with the v13 column', () => {
    const fresh = openDatabase(':memory:');
    try {
      expect(version(fresh)).toBe(LATEST_SCHEMA_VERSION);
      expect(columns(fresh, 'watches', ['allow_split_stay'])).toEqual(ADDED);
      expect(fresh.pragma('foreign_key_check')).toEqual([]);
    } finally {
      closeDatabase(fresh);
    }
  });

  it('produces the same normalised schema from a fresh database, both fixtures and a fresh v12', () => {
    const fresh = new Database(':memory:');
    const v5 = loadFixture('v5-release-1.2.0');
    const v6 = loadFixture('v6-branch');
    try {
      runMigrations(fresh);
      runMigrations(db); // the fresh v12 from beforeEach
      runMigrations(v5);
      runMigrations(v6);

      const expected = normalisedSchema(fresh);
      expect(expected.length).toBeGreaterThan(50);
      expect(normalisedSchema(db)).toEqual(expected);
      expect(normalisedSchema(v5)).toEqual(expected);
      expect(normalisedSchema(v6)).toEqual(expected);
    } finally {
      fresh.close();
      disposeFixture(v5);
      disposeFixture(v6);
    }
  });
});

describe('WatchRepository: allowSplitStay', () => {
  let db: Database.Database;
  let repo: WatchRepository;
  const input = (extra: Partial<WatchInput> = {}): WatchInput => ({
    providerId: 'rac',
    name: 'Busselton in July',
    location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
    stay: { arrival: '2027-07-01', departure: '2027-07-06', adults: 2 },
    ...extra,
  });

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new WatchRepository(db);
  });

  afterEach(() => closeDatabase(db));

  it('round-trips through create and update, and is off when left out', () => {
    const on = repo.create(1, input({ allowSplitStay: true }));
    expect(on.allowSplitStay).toBe(true);
    expect(repo.findById(on.id)?.allowSplitStay).toBe(true);

    expect(repo.update(on.id, { allowSplitStay: false }).allowSplitStay).toBe(false);
    expect(repo.update(on.id, { name: 'Renamed' }).allowSplitStay).toBe(false);
    expect(repo.update(on.id, { allowSplitStay: true }).allowSplitStay).toBe(true);
    expect(db.prepare('SELECT allow_split_stay FROM watches WHERE id = ?').get(on.id)).toEqual({
      allow_split_stay: 1,
    });

    const off = repo.create(1, input());
    expect(off.allowSplitStay).toBe(false);
  });

  it('stores and reads a split-found result, which needs no CHECK change', () => {
    const watch = repo.create(1, input({ allowSplitStay: true }));
    repo.setLastResult(watch.id, WatchResult.SPLIT_FOUND);
    expect(repo.findById(watch.id)?.lastResult).toBe(WatchResult.SPLIT_FOUND);
    expect(WatchResult.SPLIT_FOUND).toBe('split_found');
  });
});
