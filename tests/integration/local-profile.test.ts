/**
 * Architecture-notes §12.21 and §12.22: the local profile row (`users` id 1) must always
 * exist and nothing may delete it. Every watch, booking, snipe and notification has
 * `user_id ... ON DELETE CASCADE`, so deleting the row wipes all of the user's data.
 *
 * Migration v8 seeds the profile row (platform open question 1), v9 leaves it the profile
 * only (no credential columns), startup creates it when the table is empty
 * (`ensureLocalProfile`), and a provider sign-out clears only the provider's session
 * partition and account row (V6).
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { TestDatabaseHelper } from '@tests/utils/database-helper';
import {
  ProviderAccountRepository,
  UserRepository,
  WatchRepository,
} from '@main/database/repositories';
import { createLocalProfile } from '@main/app/profile';
import { ProviderAccountService } from '@main/core/accounts/provider-account.service';
import { ProviderRegistry } from '@main/providers/registry';
import {
  createFakeProvider,
  createMemoryLogger,
  createTestProviderContext,
} from '@tests/utils/fake-provider';
import { createMockWatchInput } from '@tests/fixtures/watches';

describe('local profile row', () => {
  let dbHelper: TestDatabaseHelper;
  let db: Database.Database;

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('local-profile');
    db = await dbHelper.setup();
  });

  afterEach(async () => {
    await dbHelper.teardown();
  });

  test('exists on a fresh install, as id 1 with no email and no credential columns, and startup keeps it', () => {
    const users = new UserRepository(db);
    expect(db.prepare('SELECT * FROM users').all()).toEqual([
      expect.objectContaining({ id: 1, email: null }),
    ]);
    expect(
      (db.prepare('SELECT name FROM pragma_table_info(?)').all('users') as { name: string }[]).map(
        (c) => c.name
      )
    ).toEqual(['id', 'email', 'first_name', 'last_name', 'phone', 'created_at', 'updated_at']);

    expect(createLocalProfile(users).ensureLocalProfile()).toBe(1);

    expect(users.findAll()).toEqual([expect.objectContaining({ id: 1, email: '' })]);
  });

  test('ensureLocalProfile creates id 1 when the table is empty', () => {
    db.exec('DELETE FROM users');
    const users = new UserRepository(db);

    expect(createLocalProfile(users).ensureLocalProfile()).toBe(1);
    expect(createLocalProfile(users).ensureLocalProfile()).toBe(1);
    expect(users.findAll().map((u) => u.id)).toEqual([1]);
  });

  test('a provider sign-out clears only its session: the profile row and its data stay', async () => {
    const users = new UserRepository(db);
    const userId = createLocalProfile(users).ensureLocalProfile();
    const watch = new WatchRepository(db).create(userId, createMockWatchInput());
    const registry = new ProviderRegistry();
    const fake = createFakeProvider({ id: 'parkstay' });
    registry.register(fake.factory, (manifest) => createTestProviderContext(manifest));
    const sessions = {
      clear: jest.fn(async () => undefined),
      flush: jest.fn(async () => undefined),
    };
    const accounts = new ProviderAccountService({
      providers: registry,
      accounts: new ProviderAccountRepository(db),
      windows: { open: jest.fn(), find: jest.fn(), closeAll: jest.fn() },
      sessions,
      events: { emit: jest.fn() },
      isBusy: () => false,
      logger: createMemoryLogger(),
    });

    await expect(accounts.signOut('parkstay')).resolves.toMatchObject({ status: 'signed-out' });

    expect(sessions.clear).toHaveBeenCalledTimes(1);
    expect(users.findAll().map((u) => u.id)).toEqual([userId]);
    expect(new WatchRepository(db).findById(watch.id)).not.toBeNull();
  });

  test('no main-process code deletes users rows (§12.22)', () => {
    const offenders: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (/\.ts$/.test(entry.name)) {
          const source = fs.readFileSync(file, 'utf8');
          if (
            /DELETE\s+FROM\s+["'`]?users\b/i.test(source) ||
            /\busers?(?:Repo(?:sitory)?)?\s*\.\s*deleteById\s*\(/i.test(source)
          ) {
            offenders.push(path.relative(process.cwd(), file));
          }
        }
      }
    };
    visit(path.resolve(__dirname, '../../src/main'));

    expect(offenders).toEqual([]);
  });
});
