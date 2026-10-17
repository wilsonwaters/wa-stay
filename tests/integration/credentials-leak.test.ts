/**
 * A `credentials` account's values never leave main except to the clipboard, on copy
 * (R15; brief R5, RO4; RAC terms rules 11 and 12).
 *
 * A real container with every handler registered through `handle()`, and a credentials
 * FakeProvider ("KeyStay") built the way the container builds a provider: its state in
 * `provider_state`, its secrets sealed by the container's SecretVault, the app logger, and an
 * HTTP client that records every request. Its `signIn` makes one request of its own (with no
 * value in it), accepts only the right member number, and returns it normalised (digits only)
 * for the core to store instead of what was typed.
 *
 * Two made-up sentinels (never a real member number) go through every `accounts` channel:
 * list, status, saveCredentials (each refusal and the save), copyCredential (refused and
 * done) and signOut. Neither is in any IPC response, any `account:updated` payload, any log
 * line (debug included), any request the provider's HTTP client sees, or the database in
 * plain text (while the values are stored, and after they are removed). The clipboard
 * (Electron's `clipboard`, mocked) receives the normalised member number exactly once, on copy.
 */

import { Writable } from 'stream';
import winston from 'winston';
import { createContainer, type AppContainer } from '@main/app/container';
import { openDatabase } from '@main/database/connection';
import { SqliteKeyValueStore } from '@main/database/repositories';
import { registerIpcHandlers } from '@main/ipc';
import { parkstayFactory } from '@main/providers/parkstay';
import { createProviderContext } from '@main/providers/sdk';
import { logger } from '@main/utils/logger';
import type { APIResponse } from '@shared/types';
import type { ProviderAccount } from '@shared/types/provider.types';
import { RecordingHttpClient } from '@tests/utils/fake-paced-provider';
import {
  createFakeProvider,
  TEST_PROVIDERS_DIR,
  type FakeProvider,
} from '@tests/utils/fake-provider';
import { containerSecrets, removeUserData } from '@tests/utils/fake-safe-storage';
import {
  FakeIpcMain,
  fakeEvent,
  fakeWebContents,
  TEST_LOGS_DIR,
  TRUSTED_SENDER_ID,
  type FakeWebContents,
} from '@tests/utils/ipc-harness';

jest.mock('electron', () => jest.requireActual('@tests/utils/electron-mocks').electron());
jest.mock('electron-updater', () =>
  jest.requireActual('@tests/utils/electron-mocks').electronUpdater()
);
jest.mock('node-machine-id', () => ({ machineIdSync: () => 'test-machine-id' }));

const { clipboard } = jest.requireMock('electron') as { clipboard: { writeText: jest.Mock } };

/** Made-up sentinels: a member number in the documented test format, and a password. */
const NUMBER = '1234567890123';
/** The same number as the person types it; KeyStay's `signIn` normalises it to `NUMBER`. */
const TYPED = '1234 5678 90123';
const PASSWORD = 'made-up-sentinel-Q7v';
const SENTINELS = [NUMBER, TYPED, PASSWORD];

describe('credentials values never leak', () => {
  let container: AppContainer;
  let userDataDir: string;
  let ipc: FakeIpcMain;
  let renderer: FakeWebContents;
  let http: RecordingHttpClient;
  let keystay: FakeProvider;
  let logLines: string[];
  let capture: winston.transport;
  const levelBefore = logger.level;

  const call = <T = unknown>(channel: string, payload?: unknown): Promise<APIResponse<T>> =>
    ipc.invoke(channel, fakeEvent(), payload) as Promise<APIResponse<T>>;
  /** What the database holds, as plain text. */
  const plainDatabase = () =>
    JSON.stringify([
      container.db.prepare('SELECT * FROM provider_state').all(),
      container.db.prepare('SELECT * FROM provider_accounts').all(),
    ]);

  beforeEach(() => {
    // Every log line, debug included; the console stays quiet
    logLines = [];
    capture = new winston.transports.Stream({
      stream: new Writable({
        write(chunk, _encoding, done) {
          logLines.push(String(chunk));
          done();
        },
      }),
    });
    logger.add(capture);
    logger.level = 'debug';
    for (const transport of logger.transports) {
      if (transport !== capture) transport.silent = true;
    }
    clipboard.writeText.mockClear();

    const secrets = containerSecrets();
    userDataDir = secrets.userDataDir;
    container = createContainer({
      db: openDatabase(':memory:'),
      logsDir: TEST_LOGS_DIR,
      ...secrets,
      providerFactories: [parkstayFactory],
    });
    container.profile.ensureLocalProfile();

    http = new RecordingHttpClient({ providerId: 'keystay' });
    keystay = createFakeProvider({
      id: 'keystay',
      name: 'Key Stay',
      shortName: 'KeyStay',
      capabilities: { account: 'optional' },
      credentials: {
        // A check of its own, with no value in it; only the right number is accepted
        // and it returns the number in its own form (digits only) to store instead
        signIn: async (values, client, signal) => {
          await client.request('GET', 'https://keystay.example/api/members/check', { signal });
          const digits = values.memberNumber.replace(/[\s-]/g, '');
          return digits === NUMBER
            ? { state: 'signed-in', values: { memberNumber: digits } }
            : { state: 'signed-out' };
        },
      },
    });
    // As the container builds a provider: provider_state, the app's vault, the app logger
    container.providers.register(keystay.factory, (manifest) =>
      createProviderContext(manifest, {
        createHttp: () => http,
        createState: (id) => new SqliteKeyValueStore(container.repositories.providerState, id),
        vault: container.vault,
        logger,
        providersDir: TEST_PROVIDERS_DIR,
      })
    );

    renderer = fakeWebContents(TRUSTED_SENDER_ID);
    container.trustedWebContents.register(renderer);
    ipc = new FakeIpcMain();
    registerIpcHandlers(container, { isTrustedSender: () => true, ipc });
  });

  afterEach(async () => {
    await container.dispose();
    removeUserData(userDataDir);
    logger.remove(capture);
    logger.level = levelBefore;
    for (const transport of logger.transports) transport.silent = false;
  });

  it('no response, account:updated payload, log line, provider request or plain database row carries a value; the clipboard gets it once, on copy', async () => {
    const save = (values: unknown, confirmed: unknown = ['own']) =>
      call<ProviderAccount>('accounts:save-credentials', {
        providerId: 'keystay',
        values,
        confirmed,
      });
    const responses: Array<APIResponse<unknown>> = [];
    const expectRefusal = async (pending: Promise<APIResponse<unknown>>, code: string) => {
      const response = await pending;
      expect(response).toMatchObject({ success: false, code });
      responses.push(response);
    };

    responses.push(await call('accounts:list'));
    responses.push(await call('accounts:status', { providerId: 'keystay' }));

    // Each refusal: the statement not ticked, an unknown field, too long, a payload zod
    // refuses, the provider's "no", a copy before anything is saved, another provider's account
    await expectRefusal(save({ memberNumber: NUMBER, password: PASSWORD }, []), 'VALIDATION');
    await expectRefusal(
      save({ memberNumber: NUMBER, password: PASSWORD, pin: NUMBER }),
      'VALIDATION'
    );
    await expectRefusal(
      save({ memberNumber: NUMBER.repeat(20), password: PASSWORD }),
      'VALIDATION'
    );
    await expectRefusal(save({ memberNumber: NUMBER, 'pass-word': PASSWORD }), 'VALIDATION');
    await expectRefusal(save({ memberNumber: Number(NUMBER), password: PASSWORD }), 'VALIDATION');
    await expectRefusal(save({ memberNumber: `${NUMBER}9`, password: PASSWORD }), 'VALIDATION');
    await expectRefusal(
      call('accounts:copy-credential', { providerId: 'keystay', key: 'memberNumber' }),
      'NOT_FOUND'
    );
    await expectRefusal(
      call('accounts:save-credentials', {
        providerId: 'parkstay',
        values: { memberNumber: NUMBER },
        confirmed: ['own'],
      }),
      'VALIDATION'
    );
    expect(clipboard.writeText).not.toHaveBeenCalled();

    // The save, and everything a renderer can read afterwards
    const saved = await save({ memberNumber: ` ${TYPED} `, password: PASSWORD });
    expect(saved).toMatchObject({
      success: true,
      data: { status: 'signed-in', savedFields: ['memberNumber', 'password'] },
    });
    responses.push(saved);
    responses.push(await call('accounts:list'));
    responses.push(await call('accounts:status', { providerId: 'keystay' }));
    await expectRefusal(
      call('accounts:copy-credential', { providerId: 'keystay', key: 'password' }),
      'VALIDATION'
    );

    const copied = await call('accounts:copy-credential', {
      providerId: 'keystay',
      key: 'memberNumber',
    });
    expect(copied).toEqual({ success: true });
    responses.push(copied);
    // The provider reads it back with ctx.secrets (R16 learns membership this way), normalised
    await expect(keystay.ctx!.secrets.get('account.memberNumber')).resolves.toBe(NUMBER);
    // The stored rows, before sign-out deletes them: envelopes only
    const savedDatabase = plainDatabase();
    expect(savedDatabase).toContain('secret:account.memberNumber');
    expect(savedDatabase).toContain('secret:account.password');

    responses.push(await call('accounts:sign-out', { providerId: 'keystay' }));
    responses.push(await call('accounts:list'));

    // The clipboard got the member number once, on copy, and nothing else
    expect(clipboard.writeText.mock.calls).toEqual([[NUMBER]]);

    const updates = renderer.sent.filter(([name]) => name === 'account:updated');
    expect(updates.length).toBeGreaterThanOrEqual(2);
    // The provider's own checks went out, with neither value in them
    expect(http.requests.length).toBeGreaterThanOrEqual(2);
    const removedDatabase = plainDatabase();
    const logs = logLines.join('\n');
    expect(logs).toContain('accounts:save-credentials');

    for (const sentinel of SENTINELS) {
      expect(JSON.stringify(responses)).not.toContain(sentinel);
      expect(JSON.stringify(updates)).not.toContain(sentinel);
      expect(logs).not.toContain(sentinel);
      expect(JSON.stringify(http.requests)).not.toContain(sentinel);
      expect(savedDatabase).not.toContain(sentinel);
      expect(removedDatabase).not.toContain(sentinel);
    }
  });
});
