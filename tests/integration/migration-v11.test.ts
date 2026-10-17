/**
 * Migration v11 (R1): unit kinds.
 *
 * - From the real v5 (v1.2.0) and v6 fixtures: `locations`, `watches` and `site_snipes` gain
 *   `unit_kinds JSON NOT NULL DEFAULT '[]'`; existing watches and snipes read `'[]'` (any
 *   kind), and read as `unitKinds: []` through their repositories (R3); every other table is
 *   unchanged from the same fixture at v10; `foreign_key_check` and `integrity_check` are clean.
 * - A v10 database with one `locations` row per location kind is backfilled from each row's
 *   kind (`deriveUnitKinds`), so the catalogue's SQL filter sees every cached place.
 * - A column already there (a partly migrated database) is skipped, and a row that already has
 *   unit kinds keeps them.
 * - Re-running is a no-op, and a fresh database has the same normalised schema as the migrated
 *   ones.
 *
 * The fixture tests pin the target to v11 (`runMigrations(db, 11)`) so they keep testing
 * exactly what v11 does; later versions have their own tests.
 */

import Database from 'better-sqlite3';
import {
  closeDatabase,
  LATEST_SCHEMA_VERSION,
  openDatabase,
  runMigrations,
} from '@main/database/connection';
import {
  LocationRepository,
  SiteSniperRepository,
  WatchRepository,
} from '@main/database/repositories';
import { logger } from '@main/utils/logger';
import { LOCATION_KINDS, type LocationKind } from '@shared/types/provider.types';
import { deriveUnitKinds } from '@shared/utils/unit-kinds';
import type { FixtureName } from '@tests/fixtures/db/constants';
import { disposeFixture, loadFixture } from '@tests/utils/database-helper';

type Row = Record<string, unknown>;

const FIXTURES: FixtureName[] = ['v5-release-1.2.0', 'v6-branch'];
const TABLES = ['locations', 'watches', 'site_snipes'];

function version(db: Database.Database): number {
  return (db.prepare('SELECT MAX(version) AS v FROM migrations').get() as { v: number }).v;
}

/** `unit_kinds` as `PRAGMA table_info` describes it, or undefined. */
function unitKindsColumn(db: Database.Database, table: string): Row | undefined {
  return (
    db
      .prepare(`SELECT name, type, "notnull", dflt_value FROM pragma_table_info(?)`)
      .all(table) as Row[]
  ).find((c) => c.name === 'unit_kinds');
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

/** Inserts a cached location of `kind` straight into a v10 table, as v8–v10 code wrote them. */
function insertLocation(db: Database.Database, externalId: string, kind: string): void {
  db.prepare(
    `INSERT INTO locations (provider_id, external_id, name, kind, booking_mode, lat, lng, fetched_at)
     VALUES ('fake', ?, ?, ?, 'online', -32, 116, '2026-10-02T02:00:00.000Z')`
  ).run(externalId, `Place ${externalId}`, kind);
}

function unitKindsByExternalId(db: Database.Database): Record<string, unknown> {
  const rows = db.prepare('SELECT external_id, unit_kinds FROM locations ORDER BY id').all() as {
    external_id: string;
    unit_kinds: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.external_id, JSON.parse(r.unit_kinds)]));
}

describe.each(FIXTURES)('migration v11 from the %s fixture', (fixture) => {
  let db: Database.Database;
  let atV10: Record<string, Row[]>;

  beforeEach(() => {
    db = loadFixture(fixture);
    runMigrations(db, 10);
    atV10 = snapshot(db);
    runMigrations(db, 11);
  });

  afterEach(() => disposeFixture(db));

  it("adds unit_kinds JSON NOT NULL DEFAULT '[]' to locations, watches and site_snipes", () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(11);
    expect(version(db)).toBe(11);
    for (const table of TABLES) {
      expect([table, unitKindsColumn(db, table)]).toEqual([
        table,
        { name: 'unit_kinds', type: 'JSON', notnull: 1, dflt_value: "'[]'" },
      ]);
    }
  });

  it("gives existing watches and snipes '[]' (any kind); every other table is unchanged from v10", () => {
    // Not vacuous: the fixture has watches (and, from v6, a snipe)
    expect(atV10.watches.length).toBeGreaterThan(0);
    const anyKind = (rows: Row[]): Row[] => rows.map((row) => ({ ...row, unit_kinds: '[]' }));
    expect(snapshot(db)).toEqual({
      ...atV10,
      watches: anyKind(atV10.watches),
      site_snipes: anyKind(atV10.site_snipes),
      locations: anyKind(atV10.locations),
    });
  });

  it('its watches and snipes read unitKinds: [] (any kind) through their repositories', () => {
    const watches = new WatchRepository(db).findAll();
    const snipes = new SiteSniperRepository(db).findAll();
    // The v5 (v1.2.0) fixture has watches only; Site Sniper's table arrived in v6
    expect(watches.length).toBeGreaterThan(0);
    expect(snipes.length).toBe(fixture === 'v6-branch' ? 1 : 0);
    for (const row of [...watches, ...snipes]) expect(row.unitKinds).toEqual([]);
  });

  it('passes foreign_key_check and integrity_check', () => {
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('changes nothing when run again', () => {
    const schema = normalisedSchema(db);
    const data = snapshot(db);
    runMigrations(db, 11);
    runMigrations(db, 11);
    expect(version(db)).toBe(11);
    expect(normalisedSchema(db)).toEqual(schema);
    expect(snapshot(db)).toEqual(data);
  });
});

describe('migration v11', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, 10);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (db.open) db.close();
  });

  it('backfills one cached location of each kind from its kind, and logs how many', () => {
    const info = jest.spyOn(logger, 'info');
    LOCATION_KINDS.forEach((kind) => insertLocation(db, kind, kind));
    insertLocation(db, 'unknown', 'castle');

    runMigrations(db, 11);

    expect(unitKindsByExternalId(db)).toEqual({
      campground: ['campsite'],
      'caravan-park': ['campsite'],
      'holiday-park': ['campsite', 'cabin'],
      cabin: ['cabin'],
      hut: ['dorm'],
      glamping: ['glamping'],
      'farm-stay': ['other'],
      home: ['other'],
      other: ['other'],
      unknown: ['other'],
    });
    for (const kind of LOCATION_KINDS) {
      expect(unitKindsByExternalId(db)[kind]).toEqual(deriveUnitKinds(kind as LocationKind));
    }
    expect(info).toHaveBeenCalledWith('Migration 011: derived unit kinds for 10 location(s)');
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('leaves the FTS index whole: the backfilled places are still found by name', () => {
    insertLocation(db, '1', 'holiday-park');
    runMigrations(db, 11);

    const locations = new LocationRepository(db);
    expect(locations.search({ text: 'place' }, ['fake']).items).toEqual([
      expect.objectContaining({ key: 'fake:1', unitKinds: ['campsite', 'cabin'] }),
    ]);
    expect(locations.search({ unitKinds: ['cabin'] }, ['fake']).total).toBe(1);
    db.exec("INSERT INTO locations_fts (locations_fts) VALUES ('integrity-check')");
  });

  it('skips a column that is already there, and keeps unit kinds a row already has', () => {
    db.exec(`ALTER TABLE locations ADD COLUMN unit_kinds JSON NOT NULL DEFAULT '[]'`);
    insertLocation(db, 'kept', 'campground');
    insertLocation(db, 'empty', 'hut');
    insertLocation(db, 'broken', 'cabin');
    db.prepare(
      "UPDATE locations SET unit_kinds = '[\"glamping\"]' WHERE external_id = 'kept'"
    ).run();
    db.prepare("UPDATE locations SET unit_kinds = 'not json' WHERE external_id = 'broken'").run();

    runMigrations(db, 11);

    expect(version(db)).toBe(11);
    expect(unitKindsByExternalId(db)).toEqual({
      kept: ['glamping'],
      empty: ['dorm'],
      broken: ['cabin'],
    });
    for (const table of TABLES) {
      expect(unitKindsColumn(db, table)).toMatchObject({ notnull: 1, dflt_value: "'[]'" });
    }
  });

  it('a fresh database is at the latest version with every unit_kinds column', () => {
    const fresh = openDatabase(':memory:');
    try {
      expect(version(fresh)).toBe(LATEST_SCHEMA_VERSION);
      for (const table of TABLES) expect(unitKindsColumn(fresh, table)).toBeDefined();
      expect(fresh.pragma('foreign_key_check')).toEqual([]);
    } finally {
      closeDatabase(fresh);
    }
  });

  it('produces the same normalised schema from a fresh database, both fixtures and a fresh v10', () => {
    const fresh = new Database(':memory:');
    const v5 = loadFixture('v5-release-1.2.0');
    const v6 = loadFixture('v6-branch');
    try {
      runMigrations(fresh);
      runMigrations(db); // the fresh v10 from beforeEach
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
