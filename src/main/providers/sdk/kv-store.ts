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

/**
 * The prefix of the keys the core keeps in a provider's `provider_state`, such as the person's
 * experiment choices (`core.experiments`) and the catalogue's sync state. A provider's own store
 * never reaches them (`withoutCoreKeys`).
 */
export const CORE_STATE_PREFIX = 'core.';

const isCoreKey = (key: string): boolean => key.startsWith(CORE_STATE_PREFIX);

/**
 * `store` as a provider's `ctx.state`: getting, setting or deleting a `core.*` key rejects,
 * and `list` leaves those keys out, so a provider cannot read or change what the core keeps
 * there (it cannot turn its own experiment on). The core reads them through the repository.
 */
export function withoutCoreKeys(store: KeyValueStore, providerId: string): KeyValueStore {
  const refuse = (key: string): Promise<never> =>
    Promise.reject(
      new Error(
        `${providerId}: state key "${key}" is the app's (${CORE_STATE_PREFIX}* is reserved)`
      )
    );
  return {
    get: (key) => (isCoreKey(key) ? refuse(key) : store.get(key)),
    set: (key, value) => (isCoreKey(key) ? refuse(key) : store.set(key, value)),
    delete: (key) => (isCoreKey(key) ? refuse(key) : store.delete(key)),
    list: async <T = unknown>(prefix?: string) =>
      (await store.list<T>(prefix)).filter((entry) => !isCoreKey(entry.key)),
  };
}
