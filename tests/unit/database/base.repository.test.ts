/**
 * BaseRepository unit tests, using a minimal subclass over an in-memory table.
 */

import Database from 'better-sqlite3';
import { BaseRepository } from '@main/database/repositories/base.repository';

interface Thing {
  id: number;
  name: string;
  tags?: unknown;
  seenAt?: Date;
}

interface ThingRow {
  id: number;
  name: string;
  tags: string | null;
  seen_at: string | null;
}

class ThingRepository extends BaseRepository<Thing> {
  protected readonly tableName = 'things';

  insert(name: string, tags?: unknown, seenAt?: Date): Thing {
    const result = this.db
      .prepare('INSERT INTO things (name, tags, seen_at) VALUES (?, ?, ?)')
      .run(name, this.stringifyJson(tags), this.formatDate(seenAt));
    return this.findById(result.lastInsertRowid as number)!;
  }

  rawTags(id: number): string | null {
    return (this.db.prepare('SELECT tags FROM things WHERE id = ?').get(id) as ThingRow).tags;
  }

  insertAll(names: string[], failAfter?: number): void {
    this.transaction(() => {
      names.forEach((name, i) => {
        if (i === failAfter) throw new Error('boom');
        this.insert(name);
      });
    });
  }

  protected mapRow(row: ThingRow): Thing {
    return {
      id: row.id,
      name: row.name,
      tags: this.parseJson(row.tags),
      seenAt: this.parseDate(row.seen_at),
    };
  }
}

/** A repository keyed by a text column, like `settings`. */
class KeyedRepository extends BaseRepository<{ key: string; value: string }, string> {
  protected readonly tableName = 'kv';
  protected readonly idColumn = 'key';

  protected mapRow(row: { key: string; value: string }) {
    return { key: row.key, value: row.value };
  }
}

describe('BaseRepository', () => {
  let db: Database.Database;
  let repo: ThingRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE things (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, tags TEXT, seen_at TEXT);
      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    repo = new ThingRepository(db);
  });

  afterEach(() => db.close());

  it('findById maps the row, and returns null (not undefined) when it is missing', () => {
    const created = repo.insert('tent');

    expect(repo.findById(created.id)).toEqual({
      id: created.id,
      name: 'tent',
      tags: undefined,
      seenAt: undefined,
    });
    expect(repo.findById(999)).toBeNull();
  });

  it('findAll maps every row', () => {
    repo.insert('tent');
    repo.insert('swag');

    expect(repo.findAll().map((t) => t.name)).toEqual(['tent', 'swag']);
  });

  it('deleteById reports whether a row was deleted, and exists follows it', () => {
    const created = repo.insert('tent');

    expect(repo.exists(created.id)).toBe(true);
    expect(repo.deleteById(created.id)).toBe(true);
    expect(repo.exists(created.id)).toBe(false);
    expect(repo.deleteById(created.id)).toBe(false);
  });

  it('honours an overridden id column for text-keyed tables', () => {
    db.prepare("INSERT INTO kv (key, value) VALUES ('theme', 'light')").run();
    const kv = new KeyedRepository(db);

    expect(kv.findById('theme')).toEqual({ key: 'theme', value: 'light' });
    expect(kv.exists('missing')).toBe(false);
    expect(kv.deleteById('theme')).toBe(true);
    expect(kv.findAll()).toEqual([]);
  });

  it('stringifyJson stores NULL only for null/undefined and JSON for falsy values', () => {
    const cases: Array<[unknown, string | null]> = [
      [undefined, null],
      [null, null],
      [false, 'false'],
      [0, '0'],
      ['', '""'],
      [[], '[]'],
      [{ a: 1 }, '{"a":1}'],
    ];

    for (const [value, stored] of cases) {
      const created = repo.insert('x', value);
      expect(repo.rawTags(created.id)).toBe(stored);
      expect(created.tags).toEqual(value === null ? undefined : value);
    }
  });

  it('round-trips dates as ISO strings and tolerates malformed JSON', () => {
    const seenAt = new Date('2026-04-03T08:30:00.000Z');
    const created = repo.insert('dated', undefined, seenAt);
    expect(created.seenAt?.toISOString()).toBe(seenAt.toISOString());

    db.prepare("UPDATE things SET tags = '{not json' WHERE id = ?").run(created.id);
    expect(repo.findById(created.id)?.tags).toBeUndefined();
  });

  it('transaction commits when fn returns and rolls back when it throws', () => {
    repo.insertAll(['a', 'b']);
    expect(repo.findAll()).toHaveLength(2);

    expect(() => repo.insertAll(['c', 'd', 'e'], 2)).toThrow('boom');
    expect(repo.findAll().map((t) => t.name)).toEqual(['a', 'b']);
  });
});
