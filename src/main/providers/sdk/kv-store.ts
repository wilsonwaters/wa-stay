/**
 * `KeyValueStore`: a provider's own small persistent state (queue session, cached release
 * times, scoped secrets). Each provider gets a store scoped to it. Values are JSON.
 *
 * The app gives each provider `SqliteKeyValueStore` on `provider_state`
 * (`database/repositories/provider-state.repository.ts`); `InMemoryKeyValueStore` is for tests.
 */

export interface KeyValueEntry<T = unknown> {
  key: string;
  value: T;
}

export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** Stores a JSON-serialisable value. Setting `undefined` deletes the key. */
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** Entries whose key starts with `prefix` (all of them without one), sorted by key. */
  list<T = unknown>(prefix?: string): Promise<KeyValueEntry<T>[]>;
}

/** Stores JSON text, as the SQLite store does, so callers never share mutable objects with it. */
export class InMemoryKeyValueStore implements KeyValueStore {
  private readonly entries = new Map<string, string>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const json = this.entries.get(key);
    return json === undefined ? undefined : (JSON.parse(json) as T);
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (value === undefined) {
      this.entries.delete(key);
      return;
    }
    this.entries.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async list<T = unknown>(prefix = ''): Promise<KeyValueEntry<T>[]> {
    return [...this.entries.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, json]) => ({ key, value: JSON.parse(json) as T }));
  }
}
