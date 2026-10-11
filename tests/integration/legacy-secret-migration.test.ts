/**
 * `migrateLegacySecrets` on the real v5 (v1.2.0) and v6 fixtures, loaded and upgraded to the
 * latest schema. The v1.x ParkStay password is not among the secrets: migration v9 drops it
 * before this runs (§12.32). Nor is the retired Gmail OTP sign-in: `removeRetiredGmailStore`
 * deletes it (P7).
 *
 * - every legacy ciphertext becomes a vault envelope that decrypts to the original plaintext,
 *   with no legacy layout left; a second run reports `migrated: 0`;
 * - with the wrong machine id the rows stay byte-identical, the notifier reads as
 *   `unreadable`/`error`, the dispatcher never calls `send`, and no secret is logged;
 * - a faulty encrypt (a new envelope that does not read back) replaces nothing and counts
 *   the item as failed; the machine id is read only when a machine-bound value is found;
 * - the retired `gmail-oauth.json` and its leftovers are deleted, and nothing else;
 * - after saving secrets, a byte scan of the database (and its WAL) and of the data folder's
 *   Gmail file finds none of the plaintexts.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Writable } from 'stream';
import winston from 'winston';
import type Database from 'better-sqlite3';
import { openDatabase, runMigrations } from '@main/database/connection';
import { createContainer, type AppContainer } from '@main/app/container';
import { registerIpcHandlers } from '@main/ipc';
import { migrateLegacySecrets, removeRetiredGmailStore } from '@main/security/legacy-migration';
import { NotifierRepository } from '@main/database/repositories';
import { logger } from '@main/utils/logger';
import { NotifierChannel, NotifierStatus, SMTPPreset } from '@shared/types';
import type { APIResponse } from '@shared/types';
import {
  FIXTURE_MACHINE_ID,
  FIXTURE_SMTP_PASSWORD,
  FIXTURE_USER_PASSWORD,
  type FixtureName,
} from '@tests/fixtures/db/constants';
import { disposeFixture, loadFixture } from '@tests/utils/database-helper';
import {
  containerSecrets,
  FakeSafeStorage,
  removeUserData,
  testVault,
  type TestVault,
} from '@tests/utils/fake-safe-storage';
import { FakeIpcMain, fakeEvent, TEST_LOGS_DIR } from '@tests/utils/ipc-harness';

let mockMachineId = FIXTURE_MACHINE_ID;
jest.mock('node-machine-id', () => ({ machineIdSync: () => mockMachineId }));
jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
// SMTP connections and sends are recorded, never made
const mockSmtp = { connections: 0, sent: 0 };
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: () => {
      mockSmtp.connections += 1;
      return {
        verify: async () => true,
        sendMail: async () => {
          mockSmtp.sent += 1;
          return { messageId: 'test-message' };
        },
      };
    },
  },
}));

const FIXTURES: FixtureName[] = ['v5-release-1.2.0', 'v6-branch'];

/** The documented plaintext of the fixture's SMTP notifier config. */
const FIXTURE_NOTIFIER_CONFIG = {
  preset: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: { user: 'fixture.user@example.com', pass: FIXTURE_SMTP_PASSWORD },
  toEmail: 'fixture.user@example.com',
};

const LEGACY_NOTIFIER_LAYOUT = /^[0-9a-f]{32}:[0-9a-f]{32}:/;
const HEX = /^[0-9a-f]+$/;

/** The refresh token in a retired Gmail OTP sign-in file (`writeRetiredGmailStore`). */
const RETIRED_GMAIL_TOKEN = '1//retired-gmail-refresh-token-7d3a';

/** Every plaintext the fixtures and the retired Gmail file hold. */
const LEGACY_PLAINTEXTS = [FIXTURE_USER_PASSWORD, FIXTURE_SMTP_PASSWORD, RETIRED_GMAIL_TOKEN];

/** `<dir>/gmail-oauth.json` as the Gmail OTP feature left it (plain JSON here); its path. */
function writeRetiredGmailStore(dir: string): string {
  const file = path.join(dir, 'gmail-oauth.json');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ gmail_oauth_tokens: { refresh_token: RETIRED_GMAIL_TOKEN } })
  );
  return file;
}

/** A fixture loaded and upgraded (the database migrations run before this one). */
function loadUpgraded(name: FixtureName): Database.Database {
  const db = loadFixture(name);
  runMigrations(db);
  return db;
}

function rows(db: Database.Database, table: 'users' | 'notifiers'): Record<string, unknown>[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as Record<string, unknown>[];
}

/** Captures every log line (debug included) while `run` runs; the console stays quiet. */
async function captureLogs<T>(run: () => Promise<T> | T): Promise<{ result: T; logs: string }> {
  const lines: string[] = [];
  const capture = new winston.transports.Stream({
    stream: new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    }),
  });
  const levelBefore = logger.level;
  logger.add(capture);
  logger.level = 'debug';
  const silenced = logger.transports.filter((t) => t !== capture);
  silenced.forEach((t) => (t.silent = true));
  try {
    const result = await run();
    return { result, logs: lines.join('\n') };
  } finally {
    logger.remove(capture);
    logger.level = levelBefore;
    silenced.forEach((t) => (t.silent = false));
  }
}

describe.each(FIXTURES)('migrateLegacySecrets on the %s fixture', (fixture) => {
  let db: Database.Database;
  let t: TestVault;

  const migrate = (machineId: string = FIXTURE_MACHINE_ID) =>
    migrateLegacySecrets({ db, vault: t.vault, machineId: () => machineId });

  beforeEach(() => {
    mockMachineId = FIXTURE_MACHINE_ID;
    db = loadUpgraded(fixture);
    t = testVault();
  });

  afterEach(() => {
    disposeFixture(db);
    removeUserData(t.userDataDir);
  });

  it('re-encrypts every legacy secret: no legacy layout left, and each decrypts to its original plaintext', () => {
    // Not vacuous: the fixture holds the legacy layout; v9 already dropped the ParkStay password
    expect(rows(db, 'notifiers')[0].config).toMatch(LEGACY_NOTIFIER_LAYOUT);
    expect(rows(db, 'users')[0]).not.toHaveProperty('encrypted_password');

    expect(migrate()).toEqual({ migrated: 1, current: 0, failed: 0 });

    for (const row of [...rows(db, 'users'), ...rows(db, 'notifiers')]) {
      for (const value of Object.values(row)) {
        if (typeof value !== 'string') continue;
        expect(value).not.toMatch(LEGACY_NOTIFIER_LAYOUT);
        if (value.length >= 32) expect(value).not.toMatch(HEX);
      }
    }
    const [notifier] = rows(db, 'notifiers');
    expect(notifier.config).toMatch(/^vault:v1:os:/);
    expect(JSON.parse(t.vault.decrypt(notifier.config as string))).toEqual(FIXTURE_NOTIFIER_CONFIG);
  });

  it('is idempotent: a second run reports migrated 0 and changes nothing', () => {
    migrate();
    const users = rows(db, 'users');
    const notifiers = rows(db, 'notifiers');

    expect(migrate()).toEqual({ migrated: 0, current: 1, failed: 0 });
    expect(rows(db, 'users')).toEqual(users);
    expect(rows(db, 'notifiers')).toEqual(notifiers);
  });

  it('the consumers read the migrated secrets', async () => {
    migrate();

    expect(
      new NotifierRepository(db, t.vault).findByChannel(NotifierChannel.EMAIL_SMTP)
    ).toMatchObject({ secretState: 'ok', config: FIXTURE_NOTIFIER_CONFIG });
  });

  it('with the wrong machine id leaves the rows byte-identical and counts them failed, logging no value', async () => {
    const users = rows(db, 'users');
    const notifiers = rows(db, 'notifiers');

    const { result, logs } = await captureLogs(() => migrate('another-machine'));

    expect(result).toEqual({ migrated: 0, current: 0, failed: 1 });
    expect(rows(db, 'users')).toEqual(users);
    expect(rows(db, 'notifiers')).toEqual(notifiers);
    expect(logs).toMatch(/notifier email_smtp could not be migrated and was left unchanged/);
    for (const value of [...LEGACY_PLAINTEXTS, notifiers[0].config as string]) {
      expect(logs).not.toContain(value);
    }

    // The next start tries again, and with the right id it finishes the job
    expect(migrate()).toEqual({ migrated: 1, current: 0, failed: 0 });
  });

  it.each<[string, (real: (text: string) => Buffer, text: string) => Buffer]>([
    ['decrypts to another value', (real, text) => real(`${text}!`)],
    ['does not decrypt', () => Buffer.from('not-a-ciphertext')],
  ])(
    'a new envelope that does not read back (%s) never replaces the legacy value: the item is failed and kept',
    async (_fault, faulty) => {
      const users = rows(db, 'users');
      const notifiers = rows(db, 'notifiers');
      const real = t.safeStorage.encryptString.bind(t.safeStorage);
      const encryptString = jest
        .spyOn(t.safeStorage, 'encryptString')
        .mockImplementation((text) => faulty(real, text));

      const { result, logs } = await captureLogs(() => migrate());

      expect(result).toEqual({ migrated: 0, current: 0, failed: 1 });
      expect(rows(db, 'users')).toEqual(users);
      expect(rows(db, 'notifiers')).toEqual(notifiers);
      expect(logs).toMatch(
        /notifier email_smtp could not be migrated and was left unchanged \(The new envelope did not decrypt to the original secret\)/
      );
      for (const value of LEGACY_PLAINTEXTS) expect(logs).not.toContain(value);

      // With a working encrypt the next start finishes the job
      encryptString.mockRestore();
      expect(migrate()).toEqual({ migrated: 1, current: 0, failed: 0 });
      expect(JSON.parse(t.vault.decrypt(rows(db, 'notifiers')[0].config as string))).toEqual(
        FIXTURE_NOTIFIER_CONFIG
      );
    }
  );

  it('reads the machine id only when a machine-bound legacy value is found, once per run', () => {
    const machineId = jest.fn(() => FIXTURE_MACHINE_ID);
    const run = () => migrateLegacySecrets({ db, vault: t.vault, machineId });

    expect(run()).toEqual({ migrated: 1, current: 0, failed: 0 });
    expect(machineId).toHaveBeenCalledTimes(1);

    machineId.mockClear();
    expect(run()).toEqual({ migrated: 0, current: 1, failed: 0 });
    expect(machineId).not.toHaveBeenCalled(); // nothing legacy left
  });

  it('a crash part-way leaves the item old; the next run finishes', () => {
    const encrypt = jest.spyOn(t.vault, 'encrypt');
    encrypt.mockImplementationOnce(() => {
      throw new Error('simulated crash');
    }); // notifier: fails before its UPDATE
    const notifierBefore = rows(db, 'notifiers');

    expect(migrate()).toEqual({ migrated: 0, current: 0, failed: 1 });
    expect(rows(db, 'notifiers')).toEqual(notifierBefore);

    encrypt.mockRestore();
    expect(migrate()).toEqual({ migrated: 1, current: 0, failed: 0 });
    expect(rows(db, 'notifiers')[0].config).toMatch(/^vault:v1:os:/);
  });
});

describe('migrateLegacySecrets edge cases', () => {
  let db: Database.Database;
  let t: TestVault;

  beforeEach(() => {
    db = loadUpgraded('v5-release-1.2.0');
    t = testVault();
  });

  afterEach(() => {
    disposeFixture(db);
    removeUserData(t.userDataDir);
  });

  it('an empty notifier config migrates as missing, not unreadable, without reading the machine id', () => {
    db.prepare(`UPDATE notifiers SET config = ''`).run();
    const machineId = jest.fn(() => FIXTURE_MACHINE_ID);

    expect(migrateLegacySecrets({ db, vault: t.vault, machineId })).toEqual({
      migrated: 0,
      current: 1,
      failed: 0,
    });
    expect(machineId).not.toHaveBeenCalled();
    expect(
      new NotifierRepository(db, t.vault).findByChannel(NotifierChannel.EMAIL_SMTP)
    ).toMatchObject({ secretState: 'missing', config: {} });
  });
});

describe('removeRetiredGmailStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stay-gmail-'));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('deletes gmail-oauth.json and what earlier builds left beside it, and nothing else', async () => {
    writeRetiredGmailStore(dir);
    const leftovers = [
      'gmail-oauth.json.migrating',
      'gmail-oauth.json.corrupt-2026-10-01T00-00-00-000Z',
      '.gmail-oauth.json.a1b2c3d4e5f6.tmp',
    ];
    const kept = ['wa-stay.db', 'secret-vault.key', 'migration.json', 'gmail-notes.txt'];
    for (const name of [...leftovers, ...kept]) fs.writeFileSync(path.join(dir, name), 'x');

    const { result, logs } = await captureLogs(() => removeRetiredGmailStore(dir));

    expect(result).toBe(4);
    expect(fs.readdirSync(dir).sort()).toEqual([...kept].sort());
    expect(logs).toContain('Retired Gmail sign-in: deleted 4 file(s)');
    expect(logs).not.toContain(RETIRED_GMAIL_TOKEN);
  });

  it('is a quiet no-op once they are gone, or with no data folder at all', async () => {
    const { result, logs } = await captureLogs(() => [
      removeRetiredGmailStore(dir),
      removeRetiredGmailStore(path.join(dir, 'missing')),
    ]);
    expect(result).toEqual([0, 0]);
    expect(logs).not.toContain('Retired Gmail sign-in');
  });
});

describe('the app on a fixture database (container + IPC)', () => {
  let db: Database.Database;
  let container: AppContainer | null;
  let userDataDir: string;
  let ipc: FakeIpcMain;

  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;

  /** Starts the app the way index.ts does (the container runs the secret migration). */
  function start(): AppContainer {
    const started = createContainer({
      db,
      logsDir: TEST_LOGS_DIR,
      ...containerSecrets(new FakeSafeStorage(), userDataDir),
    });
    started.profile.ensureLocalProfile();
    ipc = new FakeIpcMain();
    registerIpcHandlers(started, { isTrustedSender: () => true, ipc });
    container = started;
    return started;
  }

  /** The database file of `loadFixture`, reopened by `openDatabase` (WAL, migrations). */
  function openFixtureFile(name: FixtureName): Database.Database {
    const fixtureDb = loadFixture(name);
    const file = fixtureDb.name;
    fixtureDb.close();
    return openDatabase(file);
  }

  beforeEach(() => {
    mockSmtp.connections = 0;
    mockSmtp.sent = 0;
    container = null;
    db = openFixtureFile('v5-release-1.2.0');
    userDataDir = path.dirname(db.name);
    // As an earlier build left it: the retired Gmail OTP sign-in in the data folder
    writeRetiredGmailStore(userDataDir);
  });

  afterEach(() => {
    if (container) container.dispose();
    disposeFixture(db);
  });

  it('wrong machine id: notifiers.get is unreadable/error, the dispatcher never sends, logs hold no secret, and the rows are never overwritten until a user save', async () => {
    mockMachineId = 'another-machine';
    const usersBefore = rows(db, 'users');
    const notifiersBefore = rows(db, 'notifiers');

    const { logs } = await captureLogs(async () => {
      const app = start();
      const send = jest.spyOn(
        app.notifierDispatcher.getNotifier(NotifierChannel.EMAIL_SMTP)!,
        'send'
      );

      const notifier = await call<Record<string, unknown>>('notifiers:get', {
        channel: NotifierChannel.EMAIL_SMTP,
      });
      expect(notifier).toMatchObject({
        success: true,
        data: {
          secretState: 'unreadable',
          status: NotifierStatus.ERROR,
          lastError: 'Saved password could not be decrypted; re-enter it',
          hasPassword: false,
          enabled: true,
        },
      });

      // Two notifications: neither is sent through the unreadable notifier
      for (const title of ['Availability found', 'Another one']) {
        const results = await app.notifierDispatcher.dispatch({ title, message: 'Site 12' });
        expect(results).toEqual([
          {
            channel: NotifierChannel.EMAIL_SMTP,
            result: { success: false, error: 'Saved password could not be decrypted; re-enter it' },
          },
        ]);
      }
      expect(send).not.toHaveBeenCalled();
      await expect(
        call('notifiers:test', { channel: NotifierChannel.EMAIL_SMTP })
      ).resolves.toMatchObject({ success: true, data: { success: false } });
      expect(mockSmtp).toEqual({ connections: 0, sent: 0 });

      // Reads, a restart (the migration runs again) and an enable never overwrite them
      app.dispose();
      db = openDatabase(db.name);
      start();
      await call('notifiers:enable', { channel: NotifierChannel.EMAIL_SMTP });
      expect(rows(db, 'users')).toEqual(usersBefore);
      expect(rows(db, 'notifiers')).toEqual(notifiersBefore);
    });

    expect(
      logs.match(/Skipping notifier email_smtp: its saved settings could not be decrypted/g)
    ).toHaveLength(1);
    for (const value of [...LEGACY_PLAINTEXTS, notifiersBefore[0].config as string]) {
      expect(logs).not.toContain(value);
    }

    // The user enters the password again: now it is stored, readable and used
    await call('notifiers:configure', {
      channel: NotifierChannel.EMAIL_SMTP,
      displayName: 'Email (SMTP)',
      enabled: true,
      config: {
        ...FIXTURE_NOTIFIER_CONFIG,
        preset: SMTPPreset.GMAIL,
        auth: { user: 'fixture.user@example.com', pass: 'entered-again' },
      },
    });
    expect(rows(db, 'notifiers')[0].config).toMatch(/^vault:v1:os:/);
    await expect(
      call('notifiers:get', { channel: NotifierChannel.EMAIL_SMTP })
    ).resolves.toMatchObject({ data: { secretState: 'ok', hasPassword: true } });
    await container!.notifierDispatcher.dispatch({ title: 'Now sent', message: 'Site 12' });
    expect(mockSmtp.sent).toBe(1);
  });

  it('after saving secrets, a byte scan of the database, its WAL and the data folder finds no plaintext', async () => {
    mockMachineId = FIXTURE_MACHINE_ID;
    start(); // migrates the fixture's legacy secrets, and deletes the retired Gmail sign-in
    expect(fs.existsSync(path.join(userDataDir, 'gmail-oauth.json'))).toBe(false);

    const saved = { smtp: 'scan-smtp-app-password' };
    const response = await call('notifiers:configure', {
      channel: NotifierChannel.EMAIL_SMTP,
      displayName: 'Email (SMTP)',
      enabled: true,
      config: {
        ...FIXTURE_NOTIFIER_CONFIG,
        preset: SMTPPreset.GMAIL,
        auth: { user: 'scan@example.com', pass: saved.smtp },
      },
    });
    expect(response.success).toBe(true);

    const files = [
      db.name,
      `${db.name}-wal`,
      `${db.name}-shm`,
      path.join(userDataDir, 'gmail-oauth.json'),
    ];
    expect(fs.existsSync(`${db.name}-wal`)).toBe(true);
    const scan = (): string[] =>
      files
        .filter((file) => fs.existsSync(file))
        .flatMap((file) => {
          const bytes = fs.readFileSync(file);
          return [...LEGACY_PLAINTEXTS, ...Object.values(saved)]
            .filter((plaintext) => bytes.includes(Buffer.from(plaintext, 'utf8')))
            .map((plaintext) => `${path.basename(file)}: ${plaintext}`);
        });

    expect(scan()).toEqual([]);
    // And once the WAL is checkpointed into the main file
    db.pragma('wal_checkpoint(TRUNCATE)');
    expect(scan()).toEqual([]);

    // Still readable by the app
    await expect(
      call('notifiers:get', { channel: NotifierChannel.EMAIL_SMTP })
    ).resolves.toMatchObject({ data: { secretState: 'ok', hasPassword: true } });
  });
});
