/**
 * NotifierRepository and the SecretVault: configs are stored as vault envelopes; a config
 * that cannot be decrypted reads as `secretState: 'unreadable'` with `status: 'error'` (never
 * as an empty "not configured" notifier) and is kept until the user saves new settings; a
 * `local` envelope is re-encrypted to `os` when that becomes available.
 */

import type Database from 'better-sqlite3';
import { openDatabase } from '@main/database/connection';
import { NotifierRepository } from '@main/database/repositories';
import { NotifierChannel, NotifierStatus, SMTPPreset } from '@shared/types';
import {
  FakeSafeStorage,
  FOREIGN_OS_KEY,
  removeUserData,
  testVault,
  type TestVault,
} from '@tests/utils/fake-safe-storage';

const CONFIG = {
  preset: SMTPPreset.GMAIL,
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: 'me@example.com', pass: 'repo-app-password' },
};

describe('NotifierRepository secrets', () => {
  let db: Database.Database;
  let t: TestVault;
  let repo: NotifierRepository;

  const storedConfig = (): string =>
    (db.prepare('SELECT config FROM notifiers').get() as { config: string }).config;
  const save = (r: NotifierRepository = repo, enabled = true) =>
    r.upsert({
      channel: NotifierChannel.EMAIL_SMTP,
      displayName: 'Email',
      enabled,
      config: CONFIG,
    });

  beforeEach(() => {
    db = openDatabase(':memory:');
    t = testVault();
    repo = new NotifierRepository(db, t.vault);
  });

  afterEach(() => {
    db.close();
    removeUserData(t.userDataDir);
  });

  it('stores the config as a vault envelope and reads it back (secretState ok)', () => {
    const saved = save();

    expect(storedConfig()).toMatch(/^vault:v1:os:/);
    expect(storedConfig()).not.toContain('repo-app-password');
    expect(saved).toMatchObject({
      config: CONFIG,
      secretState: 'ok',
      status: NotifierStatus.CONFIGURED,
    });
  });

  it('an undecryptable config reads as unreadable with status error, not as an empty notifier, and is kept until a user save', () => {
    save(
      new NotifierRepository(
        db,
        testVault({ safeStorage: new FakeSafeStorage(FOREIGN_OS_KEY) }).vault
      )
    );
    const before = storedConfig();

    const notifier = repo.findByChannel(NotifierChannel.EMAIL_SMTP);
    expect(notifier).toMatchObject({
      enabled: true,
      config: {},
      secretState: 'unreadable',
      status: NotifierStatus.ERROR,
      lastError: 'Saved password could not be decrypted; re-enter it',
    });
    expect(repo.findAll()).toEqual([notifier]);

    // Reads and non-config changes never overwrite it
    repo.updateNotifier(notifier!.id, { enabled: false, displayName: 'Renamed' });
    repo.enable(NotifierChannel.EMAIL_SMTP);
    expect(storedConfig()).toBe(before);
    // The error state is computed, not written
    expect(db.prepare('SELECT status, last_error FROM notifiers').get()).toEqual({
      status: NotifierStatus.CONFIGURED,
      last_error: null,
    });

    // Saving settings is the explicit save that replaces it
    expect(save()).toMatchObject({ secretState: 'ok', config: CONFIG });
    expect(storedConfig()).not.toBe(before);
  });

  it('a leftover legacy (v1.x) ciphertext reads as unreadable', () => {
    save();
    db.prepare('UPDATE notifiers SET config = ?').run(`${'a'.repeat(32)}:${'b'.repeat(32)}:cc`);

    expect(repo.findByChannel(NotifierChannel.EMAIL_SMTP)).toMatchObject({
      secretState: 'unreadable',
      status: NotifierStatus.ERROR,
    });
  });

  it('an empty stored config reads as missing', () => {
    save();
    db.prepare("UPDATE notifiers SET config = ''").run();

    expect(repo.findByChannel(NotifierChannel.EMAIL_SMTP)).toMatchObject({
      secretState: 'missing',
      config: {},
      status: NotifierStatus.CONFIGURED,
    });
  });

  it('re-encrypts a local-key config to OS encryption once that is available, and stores it', () => {
    t.safeStorage.available = false;
    save();
    expect(storedConfig()).toMatch(/^vault:v1:local:/);

    t.safeStorage.available = true;
    expect(repo.findByChannel(NotifierChannel.EMAIL_SMTP)).toMatchObject({
      secretState: 'ok',
      config: CONFIG,
    });
    expect(storedConfig()).toMatch(/^vault:v1:os:/);
    expect(JSON.parse(t.vault.decrypt(storedConfig()))).toEqual(CONFIG);
  });
});
