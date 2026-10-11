/**
 * Migration runner unit tests: applyMigration's transaction and foreign-key rule, the
 * foreign_keys toggling (and its guards) in runMigrations, and the too-new guard.
 */

import Database from 'better-sqlite3';
import {
  applyMigration,
  DatabaseTooNewError,
  LATEST_SCHEMA_VERSION,
  MigrationError,
  runMigrations,
} from '@main/database/connection';
import { logger } from '@main/utils/logger';

/** 1, 2, …, `last`. */
function versionsUpTo(last: number): number[] {
  return Array.from({ length: last }, (_, i) => i + 1);
}

function versions(db: Database.Database): number[] {
  return (
    db.prepare('SELECT version FROM migrations ORDER BY version').all() as {
      version: number;
    }[]
  ).map((r) => r.version);
}

function tableNames(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
}

describe('applyMigration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    // runMigrations turns foreign keys off around the steps; do the same here.
    db.pragma('foreign_keys = OFF');
    db.exec(`
      CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE parents (id INTEGER PRIMARY KEY);
      CREATE TABLE legacy_children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id));
      INSERT INTO legacy_children VALUES (1, 404);
    `);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    db.close();
  });

  it('commits the step and records its version together', () => {
    applyMigration(db, 1, ['things'], () => {
      db.exec('CREATE TABLE things (id INTEGER PRIMARY KEY); INSERT INTO things VALUES (1);');
    });

    expect(versions(db)).toEqual([1]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM things').get()).toEqual({ n: 1 });
  });

  it('rolls the whole step back and throws MigrationError(version, cause) when it fails', () => {
    const cause = new Error('step exploded');
    let thrown: unknown;
    try {
      applyMigration(db, 2, ['things'], () => {
        db.exec('CREATE TABLE things (id INTEGER PRIMARY KEY); INSERT INTO things VALUES (1);');
        throw cause;
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MigrationError);
    expect((thrown as MigrationError).version).toBe(2);
    expect((thrown as MigrationError).cause).toBe(cause);
    expect((thrown as MigrationError).message).toContain('step exploded');
    expect(versions(db)).toEqual([]);
    expect(tableNames(db)).not.toContain('things');
  });

  it('only warns about a pre-existing violation outside the tables the step lists', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    // The orphan in legacy_children was there before the step ran: warn, commit.
    applyMigration(db, 8, ['things'], () => {
      db.exec('CREATE TABLE things (id INTEGER PRIMARY KEY)');
    });

    expect(versions(db)).toEqual([8]);
    expect(warn).toHaveBeenCalledWith(
      'Migration 8: 1 pre-existing foreign-key violation(s), not introduced by migration 8: legacy_children -> parents (1)'
    );
  });

  it('fails when a step leaves any violation in a table it lists, even a pre-existing one', () => {
    // An orphan the step writes into its own table.
    expect(() =>
      applyMigration(db, 8, ['kids'], () => {
        db.exec(`
          CREATE TABLE kids (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id));
          INSERT INTO kids VALUES (1, 999);
        `);
      })
    ).toThrow(
      "Database migration 8 failed: foreign_key_check found 1 violation(s) in this step's tables: kids -> parents (1)"
    );
    expect(tableNames(db)).not.toContain('kids');

    // A listed table must be fully clean, so a step that rebuilds it must repair old orphans.
    // This holds for historic steps too.
    expect(() =>
      applyMigration(db, 6, ['legacy_children'], () => {
        db.exec('CREATE INDEX idx_legacy_children_parent ON legacy_children(parent_id)');
      })
    ).toThrow(/migration 6 failed: .* in this step's tables: legacy_children -> parents \(1\)/);
    expect(versions(db)).toEqual([]);
  });

  it('fails, and rolls back, when a v7+ step introduces a violation in a table it does not list', () => {
    expect(() =>
      applyMigration(db, 8, ['things'], () => {
        db.exec(`
          CREATE TABLE things (id INTEGER PRIMARY KEY);
          INSERT INTO legacy_children VALUES (2, 405);
        `);
      })
    ).toThrow(
      // Only the new orphan counts; row 1's orphan was already there.
      'Database migration 8 failed: foreign_key_check found 1 new violation(s) introduced by this step: legacy_children -> parents (1)'
    );

    expect(versions(db)).toEqual([]);
    expect(tableNames(db)).not.toContain('things');
    expect(db.prepare('SELECT id FROM legacy_children').all()).toEqual([{ id: 1 }]);
  });

  it('lets a historic step (v1-v6) introduce a violation outside its tables, with a warning', () => {
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    applyMigration(db, 6, ['things'], () => {
      db.exec(`
        CREATE TABLE things (id INTEGER PRIMARY KEY);
        INSERT INTO legacy_children VALUES (2, 405);
      `);
    });

    expect(versions(db)).toEqual([6]);
    expect(warn).toHaveBeenCalledWith(
      'Migration 6: historic step introduced 1 foreign-key violation(s), to be repaired by a later migration: legacy_children -> parents (1)'
    );
    expect(warn).toHaveBeenCalledWith(
      'Migration 6: 1 pre-existing foreign-key violation(s), not introduced by migration 6: legacy_children -> parents (1)'
    );
  });
});

describe('runMigrations', () => {
  afterEach(() => jest.restoreAllMocks());

  it('turns foreign keys off before the first step and back on after the last, outside any transaction', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    const events: string[] = [];
    const pragma = db.pragma.bind(db);
    const prepare = db.prepare.bind(db);
    jest.spyOn(db, 'pragma').mockImplementation(((source: string, options?: unknown) => {
      if (/^foreign_keys\s*=/.test(source)) {
        events.push(`${source.replace(/\s+/g, '')}${db.inTransaction ? ' (in transaction)' : ''}`);
      }
      return pragma(source, options as Database.PragmaOptions);
    }) as typeof db.pragma);
    jest.spyOn(db, 'prepare').mockImplementation(((source: string) => {
      if (source.startsWith('INSERT INTO migrations')) {
        events.push(`record${db.inTransaction ? ' (in transaction)' : ''}`);
      }
      return prepare(source);
    }) as typeof db.prepare);

    runMigrations(db);

    expect(events[0]).toBe('foreign_keys=OFF');
    expect(events[events.length - 1]).toBe('foreign_keys=ON');
    expect(events.slice(1, -1)).toEqual(
      Array.from({ length: LATEST_SCHEMA_VERSION }, () => 'record (in transaction)')
    );
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });

  it('refuses to run inside an open transaction, where foreign_keys cannot be turned off', () => {
    const db = new Database(':memory:');
    db.exec('BEGIN');

    expect(() => runMigrations(db)).toThrow(
      'runMigrations cannot run inside an open transaction: PRAGMA foreign_keys is a no-op there, so table rebuilds would run with foreign keys on'
    );
    expect(db.inTransaction).toBe(true);
    expect(versions(db)).toEqual([]);
    expect(tableNames(db)).toEqual(['migrations']);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);

    db.exec('ROLLBACK');
    db.close();
  });

  it('runs no step when foreign keys do not read back as off', () => {
    const db = new Database(':memory:');
    const pragma = db.pragma.bind(db);
    // Simulate a connection on which the OFF pragma does not take effect.
    jest
      .spyOn(db, 'pragma')
      .mockImplementation(((source: string, options?: unknown) =>
        /^foreign_keys\s*=\s*OFF$/i.test(source.trim())
          ? []
          : pragma(source, options as Database.PragmaOptions)) as typeof db.pragma);

    expect(() => runMigrations(db)).toThrow(
      'runMigrations could not turn foreign keys off (PRAGMA foreign_keys still reads on); no migration was run'
    );
    expect(versions(db)).toEqual([]);
    expect(tableNames(db)).toEqual(['migrations']);
    expect(pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });

  it('refuses a database newer than this build with DatabaseTooNewError and runs nothing', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    db.prepare('INSERT INTO migrations (version) VALUES (?)').run(LATEST_SCHEMA_VERSION + 1);
    const schemaBefore = db.prepare('SELECT type, name, sql FROM sqlite_master').all();
    const pragma = jest.spyOn(db, 'pragma');

    let thrown: unknown;
    try {
      runMigrations(db);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DatabaseTooNewError);
    expect((thrown as DatabaseTooNewError).version).toBe(LATEST_SCHEMA_VERSION + 1);
    expect((thrown as Error).message).toMatch(
      new RegExp(`newer than this app supports \\(${LATEST_SCHEMA_VERSION}\\)`)
    );
    expect(pragma).not.toHaveBeenCalled();
    expect(db.prepare('SELECT type, name, sql FROM sqlite_master').all()).toEqual(schemaBefore);
    expect(versions(db)).toEqual([
      ...versionsUpTo(LATEST_SCHEMA_VERSION),
      LATEST_SCHEMA_VERSION + 1,
    ]);
    db.close();
  });

  it('stops at a lower target version, and a later call carries on from there', () => {
    const db = new Database(':memory:');

    runMigrations(db, 5);
    expect(versions(db)).toEqual([1, 2, 3, 4, 5]);
    expect(tableNames(db)).not.toContain('site_snipes');

    runMigrations(db, 5);
    expect(versions(db)).toEqual([1, 2, 3, 4, 5]);

    runMigrations(db);
    expect(versions(db)).toEqual(versionsUpTo(LATEST_SCHEMA_VERSION));
    db.close();
  });

  it.each([0, LATEST_SCHEMA_VERSION + 1, 2.5, NaN])(
    'rejects the target version %p, running nothing',
    (target) => {
      const db = new Database(':memory:');

      expect(() => runMigrations(db, target)).toThrow(RangeError);
      expect(tableNames(db)).toEqual([]);
      db.close();
    }
  );
});
