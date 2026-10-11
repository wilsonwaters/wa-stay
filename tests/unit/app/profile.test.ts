/**
 * The local profile (architecture-notes §12.21): migration v8 seeds the single profile row,
 * `ensureLocalProfile` creates it when the table is empty and never touches an existing one;
 * `requireUserId` resolves it for IPC handlers, or throws NO_PROFILE.
 */

import Database from 'better-sqlite3';
import { TestDatabaseHelper } from '@tests/utils/database-helper';
import { UserRepository } from '@main/database/repositories';
import { createLocalProfile } from '@main/app/profile';
import { AppError } from '@main/utils/app-error';

describe('local profile', () => {
  let dbHelper: TestDatabaseHelper;
  let db: Database.Database;
  let users: UserRepository;

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('local-profile-unit');
    db = await dbHelper.setup();
    users = new UserRepository(db);
  });

  afterEach(async () => {
    await dbHelper.teardown();
  });

  it('resolves the profile row a fresh v8 database already has (id 1, no credentials)', () => {
    const profile = createLocalProfile(users);

    expect(profile.requireUserId()).toBe(1);
    expect(profile.ensureLocalProfile()).toBe(1);
    expect(users.findAll()).toHaveLength(1);
  });

  it('requireUserId throws AppError NO_PROFILE when there is no users row', () => {
    db.exec('DELETE FROM users');
    const profile = createLocalProfile(users);

    expect(() => profile.requireUserId()).toThrow(AppError);
    expect(() => profile.requireUserId()).toThrow(expect.objectContaining({ code: 'NO_PROFILE' }));
  });

  it('ensureLocalProfile creates id 1 once and is idempotent', () => {
    db.exec('DELETE FROM users');
    const profile = createLocalProfile(users);

    expect(profile.ensureLocalProfile()).toBe(1);
    expect(profile.ensureLocalProfile()).toBe(1);

    expect(users.findAll()).toHaveLength(1);
    expect(profile.requireUserId()).toBe(1);
  });

  it('keeps an existing profile, even one that is not id 1, and resolves the first users.id', () => {
    db.exec('DELETE FROM users');
    db.prepare(
      `INSERT INTO users (id, email, first_name) VALUES (7, 'me@example.com', 'Kept')`
    ).run();
    const profile = createLocalProfile(users);

    expect(profile.ensureLocalProfile()).toBe(7);

    expect(users.findAll()).toEqual([
      expect.objectContaining({ id: 7, email: 'me@example.com', firstName: 'Kept' }),
    ]);
    expect(profile.requireUserId()).toBe(7);
  });
});
