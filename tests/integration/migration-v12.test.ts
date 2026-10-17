/**
 * Migration v12 (R12): release-alert snipes, and estimated hold expiries for R18.
 *
 * - From the real v5 (v1.2.0) and v6 fixtures: `site_snipes` gains `action TEXT NOT NULL
 *   DEFAULT 'hold'` and `alert JSON` (nullable); `watches` and `site_snipes` gain
 *   `hold_expires_estimated INTEGER NOT NULL DEFAULT 0`. Every existing snipe reads `hold` with
 *   no alert (through its repository too), every watch and snipe has
 *   `hold_expires_estimated = 0`, and every other table is unchanged from the same fixture at
 *   v11; `foreign_key_check` and `integrity_check` are clean.
 * - No CHECK constraint on `action`: the repository validates it.
 * - A column already there (a partly migrated database) is skipped.
 * - Re-running is a no-op, and a fresh database has the same normalised schema as the migrated
 *   ones.
 *
 * The fixture tests pin the target to v12 (`runMigrations(db, 12)`) so they keep testing
 * exactly what v12 does; later versions have their own tests.
 */

import Database from 'better-sqlite3';
import {
  closeDatabase,
  LATEST_SCHEMA_VERSION,
  openDatabase,
  runMigrations,
} from '@main/database/connection';
import { SiteSniperRepository } from '@main/database/repositories';
import type { FixtureName } from '@tests/fixtures/db/constants';
import { disposeFixture, loadFixture } from '@tests/utils/database-helper';

type Row = Record<string, unknown>;

const FIXTURES: FixtureName[] = ['v5-release-1.2.0', 'v6-branch'];

/** The columns v12 adds, as `PRAGMA table_info` describes them. */
const ADDED: Record<'site_snipes' | 'watches', Row[]> = {
  site_snipes: [
    { name: 'action', type: 'TEXT', notnull: 1, dflt_value: "'hold'" },
    { name: 'alert', type: 'JSON', notnull: 0, dflt_value: null },
    { name: 'hold_expires_estimated', type: 'INTEGER', notnull: 1, dflt_value: '0' },
  ],
  watches: [{ name: 'hold_expires_estimated', type: 'INTEGER', notnull: 1, dflt_value: '0' }],
};

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

describe.each(FIXTURES)('migration v12 from the %s fixture', (fixture) => {
  let db: Database.Database;
  let atV11: Record<string, Row[]>;

  beforeEach(() => {
    db = loadFixture(fixture);
    runMigrations(db, 11);
    atV11 = snapshot(db);
    runMigrations(db, 12);
  });

  afterEach(() => disposeFixture(db));

  it('adds action and alert to site_snipes, and hold_expires_estimated to watches and site_snipes', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(12);
    expect(version(db)).toBe(12);
    for (const [table, added] of Object.entries(ADDED)) {
      const names = added.map((c) => c.name as string);
      expect([table, columns(db, table, names)]).toEqual([table, added]);
    }
    // The repository validates the action: no CHECK constraint (as v7 did for notifications)
    const sql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'site_snipes'").get() as {
        sql: string;
      }
    ).sql;
    expect(sql).not.toMatch(/CHECK\s*\(\s*action/i);
  });

  it("gives every snipe action 'hold' and no alert, every watch and snipe hold_expires_estimated 0; nothing else changes", () => {
    // Not vacuous: the fixture has watches (and, from v6, a snipe)
    expect(atV11.watches.length).toBeGreaterThan(0);
    expect(atV11.site_snipes.length).toBe(fixture === 'v6-branch' ? 1 : 0);
    expect(snapshot(db)).toEqual({
      ...atV11,
      watches: atV11.watches.map((row) => ({ ...row, hold_expires_estimated: 0 })),
      site_snipes: atV11.site_snipes.map((row) => ({
        ...row,
        action: 'hold',
        alert: null,
        hold_expires_estimated: 0,
      })),
    });
  });

  it('its snipes read action hold with no alert through their repository', () => {
    const snipes = new SiteSniperRepository(db).findAll();
    expect(snipes.length).toBe(fixture === 'v6-branch' ? 1 : 0);
    for (const snipe of snipes) {
      expect(snipe.action).toBe('hold');
      expect(snipe.alert).toBeUndefined();
    }
  });

  it('passes foreign_key_check and integrity_check', () => {
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('changes nothing when run again', () => {
    const schema = normalisedSchema(db);
    const data = snapshot(db);
    runMigrations(db, 12);
    runMigrations(db, 12);
    expect(version(db)).toBe(12);
    expect(normalisedSchema(db)).toEqual(schema);
    expect(snapshot(db)).toEqual(data);
  });
});

describe('migration v12', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, 11);
  });

  afterEach(() => {
    if (db.open) db.close();
  });

  it('skips a column that is already there (a partly migrated database)', () => {
    db.exec(`ALTER TABLE site_snipes ADD COLUMN action TEXT NOT NULL DEFAULT 'hold'`);
    db.exec(`ALTER TABLE watches ADD COLUMN hold_expires_estimated INTEGER NOT NULL DEFAULT 0`);

    runMigrations(db, 12);

    expect(version(db)).toBe(12);
    expect(columns(db, 'site_snipes', ['action', 'alert', 'hold_expires_estimated'])).toEqual(
      ADDED.site_snipes
    );
    expect(columns(db, 'watches', ['hold_expires_estimated'])).toEqual(ADDED.watches);
  });

  it('a fresh database is at the latest version with every v12 column', () => {
    const fresh = openDatabase(':memory:');
    try {
      expect(version(fresh)).toBe(LATEST_SCHEMA_VERSION);
      for (const [table, added] of Object.entries(ADDED)) {
        expect(
          columns(
            fresh,
            table,
            added.map((c) => c.name as string)
          )
        ).toEqual(added);
      }
      expect(fresh.pragma('foreign_key_check')).toEqual([]);
    } finally {
      closeDatabase(fresh);
    }
  });

  it('produces the same normalised schema from a fresh database, both fixtures and a fresh v11', () => {
    const fresh = new Database(':memory:');
    const v5 = loadFixture('v5-release-1.2.0');
    const v6 = loadFixture('v6-branch');
    try {
      runMigrations(fresh);
      runMigrations(db); // the fresh v11 from beforeEach
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
