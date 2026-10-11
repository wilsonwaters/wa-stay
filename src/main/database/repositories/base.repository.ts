import Database from 'better-sqlite3';

/**
 * Reads an instant column written either as ISO (`toISOString`) or by SQLite itself
 * (`DEFAULT CURRENT_TIMESTAMP`, `SET x = CURRENT_TIMESTAMP`: 'YYYY-MM-DD HH:MM:SS', which SQLite
 * writes in UTC but `new Date` would read as local time, 8 h off in Perth). NULL or empty reads
 * as `undefined`. Every instant a repository reads goes through here; calendar dates
 * (`YYYY-MM-DD`) are not instants and never do.
 */
export function readInstant(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
    ? new Date(`${value.replace(' ', 'T')}Z`)
    : new Date(value);
}

/**
 * Base class for every repository. The database is injected; repositories never open or
 * look up a connection themselves.
 *
 * SQL safety: every value is bound as a `?` parameter, enum values included. The only text
 * interpolated into SQL is code constants: `tableName`, `idColumn`, and dynamic `SET` lists
 * built from code-literal column names. No method accepts a SQL fragment.
 */
export abstract class BaseRepository<T, K extends number | string = number> {
  /** Table this repository owns. A code constant, never user input. */
  protected abstract readonly tableName: string;

  /** Primary-key column used by the id-based helpers. A code constant. */
  protected readonly idColumn: string = 'id';

  constructor(protected readonly db: Database.Database) {}

  /** Maps a raw database row to the domain model. */
  protected abstract mapRow(row: unknown): T;

  findById(id: K): T | null {
    const row = this.db
      .prepare(`SELECT * FROM ${this.tableName} WHERE ${this.idColumn} = ?`)
      .get(id);
    return row ? this.mapRow(row) : null;
  }

  findAll(): T[] {
    const rows = this.db.prepare(`SELECT * FROM ${this.tableName}`).all();
    return rows.map((row) => this.mapRow(row));
  }

  deleteById(id: K): boolean {
    const result = this.db
      .prepare(`DELETE FROM ${this.tableName} WHERE ${this.idColumn} = ?`)
      .run(id);
    return result.changes > 0;
  }

  exists(id: K): boolean {
    const row = this.db
      .prepare(`SELECT 1 FROM ${this.tableName} WHERE ${this.idColumn} = ? LIMIT 1`)
      .get(id);
    return row !== undefined;
  }

  /** Parses a JSON column. NULL, empty or malformed text reads as `undefined`. */
  protected parseJson<J>(value: string | null | undefined): J | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    try {
      return JSON.parse(value) as J;
    } catch {
      return undefined;
    }
  }

  /** Serialises a JSON column. Only `null` and `undefined` become NULL; `false`, `0` and `''` are stored as JSON. */
  protected stringifyJson(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    return JSON.stringify(value);
  }

  /** Parses an instant column (`readInstant`). NULL or empty reads as `undefined`. */
  protected parseDate(value: string | number | null | undefined): Date | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    return typeof value === 'number' ? new Date(value) : readInstant(value);
  }

  /** Formats a date for storage as an ISO-8601 string. */
  protected formatDate(date: Date | null | undefined): string | null {
    if (!date) return null;
    return date.toISOString();
  }

  /** Runs `fn` in a transaction: it commits if `fn` returns and rolls back if it throws. */
  protected transaction<R>(fn: () => R): R {
    return this.db.transaction(fn)();
  }
}
