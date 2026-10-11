/**
 * `provider_state`: each provider's small persistent key-value state (migration v8), such as
 * ParkStay's DBCA queue session (`queue.session`) or a provider's scoped secrets
 * (`secret:<key>`, ciphertext only). Values are JSON.
 *
 * The table has a composite key, `(provider_id, key)`, so this repository does not extend
 * `BaseRepository`, whose helpers address rows by a single id column. It follows the same
 * style: an injected `Database` and parameterised SQL only.
 */

import type Database from 'better-sqlite3';
import type { ProviderId } from '@shared/types';
import type { KeyValueEntry, KeyValueStore } from '../../providers/sdk/kv-store';
import { readInstant } from './base.repository';

export interface ProviderStateEntry<T = unknown> extends KeyValueEntry<T> {
  /** When the value was last written. */
  updatedAt: Date;
}

interface ProviderStateRow {
  key: string;
  value: string;
  updated_at: string | null;
}

export class ProviderStateRepository {
  constructor(private readonly db: Database.Database) {}

  /** The value stored under `key`, or undefined. */
  get<T = unknown>(providerId: ProviderId, key: string): T | undefined {
    return this.getEntry<T>(providerId, key)?.value;
  }

  /** The value and when it was written, or undefined. */
  getEntry<T = unknown>(providerId: ProviderId, key: string): ProviderStateEntry<T> | undefined {
    const row = this.db
      .prepare(
        'SELECT key, value, updated_at FROM provider_state WHERE provider_id = ? AND key = ?'
      )
      .get(providerId, key) as ProviderStateRow | undefined;
    return row ? this.toEntry<T>(row) : undefined;
  }

  /** Stores a JSON-serialisable value, replacing any previous one. `undefined` deletes the key. */
  set(providerId: ProviderId, key: string, value: unknown, now: Date = new Date()): void {
    if (value === undefined) {
      this.delete(providerId, key);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO provider_state (provider_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (provider_id, key) DO UPDATE
           SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(providerId, key, JSON.stringify(value), now.toISOString());
  }

  delete(providerId: ProviderId, key: string): void {
    this.db
      .prepare('DELETE FROM provider_state WHERE provider_id = ? AND key = ?')
      .run(providerId, key);
  }

  /** The provider's entries whose key starts with `prefix` (all without one), sorted by key. */
  list<T = unknown>(providerId: ProviderId, prefix = ''): ProviderStateEntry<T>[] {
    const rows = this.db
      .prepare(
        `SELECT key, value, updated_at FROM provider_state
         WHERE provider_id = ? AND substr(key, 1, length(?)) = ?
         ORDER BY key`
      )
      .all(providerId, prefix, prefix) as ProviderStateRow[];
    return rows.map((row) => this.toEntry<T>(row));
  }

  private toEntry<T>(row: ProviderStateRow): ProviderStateEntry<T> {
    return {
      key: row.key,
      value: JSON.parse(row.value) as T,
      updatedAt: readInstant(row.updated_at) ?? new Date(0),
    };
  }
}

/**
 * V1's `KeyValueStore` on `provider_state`, scoped to one provider. The container gives one
 * to each provider as `ProviderContext.state`, which is also where its scoped secrets live.
 */
export class SqliteKeyValueStore implements KeyValueStore {
  constructor(
    private readonly repo: ProviderStateRepository,
    private readonly providerId: ProviderId
  ) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.repo.get<T>(this.providerId, key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.repo.set(this.providerId, key, value);
  }

  async delete(key: string): Promise<void> {
    this.repo.delete(this.providerId, key);
  }

  async list<T = unknown>(prefix = ''): Promise<KeyValueEntry<T>[]> {
    return this.repo.list<T>(this.providerId, prefix).map(({ key, value }) => ({ key, value }));
  }
}
