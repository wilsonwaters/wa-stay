/**
 * Migration v10 (P7, architecture-notes §12.26): drops the never-written `job_logs` table.
 *
 * - From the real v5 (v1.2.0) and v6 fixtures: `job_logs`, its four indexes and its
 *   sqlite_sequence row are gone, every other table is unchanged from the same fixture at v9,
 *   and `foreign_key_check`/`integrity_check` are clean.
 * - A fresh database has no `job_logs`, and has the same normalised schema as both migrated
 *   fixtures and a fresh v9 database migrated to v10.
 * - Rows `job_logs` somehow holds are dropped with it and counted in the log.
 * - Re-running is a no-op.
 */

import Database from 'better-sqlite3';
import {
  closeDatabase,
  LATEST_SCHEMA_VERSION,
  openDatabase,
  runMigrations,
} from '@main/database/connection';
import { logger } from '@main/utils/logger';
import type { FixtureName } from '@tests/fixtures/db/constants';
import { disposeFixture, loadFixture } from '@tests/utils/database-helper';

type Row = Record<string, unknown>;

const FIXTURES: FixtureName[] = ['v5-release-1.2.0', 'v6-branch'];

function version(db: Database.Database): number {
  return (db.prepare('SELECT MAX(version) AS v FROM migrations').get() as { v: number }).v;
}

/** Every `sqlite_master` object (table, index, trigger) that names `job_logs`. */
function jobLogsObjects(db: Database.Database): Row[] {
  return db
    .prepare(
      "SELECT type, name FROM sqlite_master WHERE tbl_name = 'job_logs' OR name = 'job_logs'"
    )
    .all() as Row[];
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

describe.each(FIXTURES)('migration v10 from the %s fixture', (fixture) => {
  let db: Database.Database;
  let atV9: Record<string, Row[]>;

  beforeEach(() => {
    db = loadFixture(fixture);
    runMigrations(db, 9);
    atV9 = snapshot(db);
    runMigrations(db);
  });

  afterEach(() => disposeFixture(db));

  it('drops job_logs with its indexes; every other table is unchanged', () => {
    expect(LATEST_SCHEMA_VERSION).toBe(10);
    expect(version(db)).toBe(10);
    // Not vacuous: the fixture at v9 still had the table and its four indexes
    expect(atV9.job_logs).toEqual([]);
    expect(jobLogsObjects(db)).toEqual([]);

    const { job_logs: _dropped, ...unchanged } = atV9;
    expect(snapshot(db)).toEqual({
      ...unchanged,
      sqlite_sequence: atV9.sqlite_sequence.filter((s) => s.name !== 'job_logs'),
    });
  });

  it('passes foreign_key_check and integrity_check', () => {
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('changes nothing when run again', () => {
    const schema = normalisedSchema(db);
    const data = snapshot(db);
    runMigrations(db);
    expect(version(db)).toBe(10);
    expect(normalisedSchema(db)).toEqual(schema);
    expect(snapshot(db)).toEqual(data);
  });
});

describe('migration v10', () => {
  it('the fixtures had job_logs and its four indexes before v10', () => {
    const db = loadFixture('v5-release-1.2.0');
    try {
      runMigrations(db, 9);
      expect(jobLogsObjects(db)).toEqual(
        expect.arrayContaining([
          { type: 'table', name: 'job_logs' },
          { type: 'index', name: 'idx_job_logs_type' },
          { type: 'index', name: 'idx_job_logs_job_id' },
          { type: 'index', name: 'idx_job_logs_status' },
          { type: 'index', name: 'idx_job_logs_created_at' },
        ])
      );
    } finally {
      disposeFixture(db);
    }
  });

  it('a fresh database has no job_logs', () => {
    const db = openDatabase(':memory:');
    try {
      expect(version(db)).toBe(10);
      expect(jobLogsObjects(db)).toEqual([]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      closeDatabase(db);
    }
  });

  it('produces the same normalised schema from a fresh database, both fixtures and a fresh v9', () => {
    const fresh = new Database(':memory:');
    const v9 = new Database(':memory:');
    const v5 = loadFixture('v5-release-1.2.0');
    const v6 = loadFixture('v6-branch');
    try {
      runMigrations(fresh);
      runMigrations(v9, 9);
      runMigrations(v9);
      runMigrations(v5);
      runMigrations(v6);

      const expected = normalisedSchema(fresh);
      expect(expected.length).toBeGreaterThan(50);
      expect(normalisedSchema(v9)).toEqual(expected);
      expect(normalisedSchema(v5)).toEqual(expected);
      expect(normalisedSchema(v6)).toEqual(expected);
    } finally {
      fresh.close();
      v9.close();
      disposeFixture(v5);
      disposeFixture(v6);
    }
  });

  it('drops rows job_logs somehow holds with the table, and logs how many', () => {
    const db = loadFixture('v6-branch');
    const info = jest.spyOn(logger, 'info');
    try {
      runMigrations(db, 9);
      const insert = db.prepare(
        "INSERT INTO job_logs (job_type, job_id, status) VALUES ('watch_poll', ?, 'success')"
      );
      insert.run(1);
      insert.run(2);

      runMigrations(db);

      expect(jobLogsObjects(db)).toEqual([]);
      expect(db.prepare("SELECT * FROM sqlite_sequence WHERE name = 'job_logs'").all()).toEqual([]);
      expect(info).toHaveBeenCalledWith('Migration 010: dropped job_logs (2 row(s))');
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      info.mockRestore();
      disposeFixture(db);
    }
  });
});
