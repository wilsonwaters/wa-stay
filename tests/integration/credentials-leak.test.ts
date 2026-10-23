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
 *
 * A split stay found with the values saved (the place page's `splitStays`, a watch's split
 * alert and its links) carries neither either.
 *
 * RAC's own member number sign-in (R16) goes through the same channels: typed with hyphens, it
 * is stored and copied as its digits, and is in no answer, event, log line, request or plain
 * row either (its sign-in sends no request at all).
 *
 * With RAC's auto-cart on (R19), a member's automatic hold (`holds.create`: the cart page, the
 * availability POST, the member rate's cart address) and its release (the cart page and the
 * removal) send the number nowhere: not in a request's address, form or headers, the hold's
 * reference, a log line, a notification or an answer; nor is the cart address (the synthetic
 * fixtures' made-up token) in any of those.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { Writable } from 'stream';
import winston from 'winston';
import { createContainer, type AppContainer } from '@main/app/container';
import { openDatabase } from '@main/database/connection';
import { SqliteKeyValueStore } from '@main/database/repositories';
import { registerIpcHandlers } from '@main/ipc';
import { parkstayFactory } from '@main/providers/parkstay';
import { withExperiments } from '@main/providers/experiments';
import { racFactory } from '@main/providers/rac';
import { RAC_AVAILABILITY_PATH } from '@main/providers/rac/availability';
import {
  createProviderContext,
  type HttpMethod,
  type HttpRequestOptions,
  type HttpResponse,
} from '@main/providers/sdk';
import { FixtureHttpClient } from '@main/testing/fixture-http-client';
import { logger } from '@main/utils/logger';
import type { APIResponse, LocationCheck, Watch } from '@shared/types';
import type { ProviderAccount } from '@shared/types/provider.types';
import { RecordingHttpClient } from '@tests/utils/fake-paced-provider';
import { fakeDateOnly } from '@tests/utils/core-harness';
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

const CART_FIXTURES = path.join(__dirname, '../fixtures/providers/rac/cart');
/** Anything of a cart address: its token, its `cart` key, a tariff's `rand`. */
const CART_ADDRESS = /rest_api_data_id|0{32}|\?cart|cart&|rand=100/;

/** A FixtureHttpClient that records every request: address, form and headers. */
class RecordingFixtureClient extends FixtureHttpClient {
  readonly sent: Array<{ method: string; url: string; body?: string; headers?: unknown }> = [];
  override async request(
    method: HttpMethod,
    url: string,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse> {
    this.sent.push({
      method,
      url,
      ...(options.body === undefined ? {} : { body: String(options.body) }),
      headers: options.headers,
    });
    return super.request(method, url, options);
  }
}

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

  it('a split-stay alert carries no value: not the split stays, their links, the alert or any answer', async () => {
    fakeDateOnly(new Date('2026-10-17T02:00:00.000Z'));
    try {
      const responses: Array<APIResponse<unknown>> = [];
      const record = async <T>(pending: Promise<APIResponse<T>>) => {
        const response = await pending;
        responses.push(response);
        return response;
      };
      await expect(
        record(
          call('accounts:save-credentials', {
            providerId: 'keystay',
            values: { memberNumber: TYPED, password: PASSWORD },
            confirmed: ['own'],
          })
        )
      ).resolves.toMatchObject({ success: true });
      // Free both nights, but u1 the first and u2 the second: booked a part at a time
      keystay.setAvailability('1', {
        u1: [{ state: 'available' }, { state: 'booked' }],
        u2: [{ state: 'booked' }, { state: 'available' }],
      });
      const stay = { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 };

      const checked = await record(
        call<LocationCheck>('catalog:check-location', { key: 'keystay:1', stay })
      );
      expect(checked).toMatchObject({ success: true, data: { splitStays: [{ units: 2 }] } });
      const created = await record(
        call<Watch>('watches:create', {
          providerId: 'keystay',
          name: 'Banksia',
          location: { externalId: '1', name: 'Banksia Camp' },
          stay,
          allowSplitStay: true,
        })
      );
      const id = (created as { data: Watch }).data.id;
      await record(call('watches:run-now', { id }));
      const found = await record(call<Watch>('watches:get', { id }));
      expect(found).toMatchObject({
        success: true,
        data: { lastResult: 'split_found', splitStays: [{ units: 2 }] },
      });

      const notifications = JSON.stringify(
        container.db.prepare('SELECT * FROM notifications').all()
      );
      expect(notifications).toContain('Free if you move');
      const logs = logLines.join('\n');
      for (const sentinel of SENTINELS) {
        for (const text of [
          JSON.stringify(responses),
          JSON.stringify(renderer.sent),
          JSON.stringify(http.requests),
          notifications,
          logs,
        ]) {
          expect(text).not.toContain(sentinel);
        }
      }
    } finally {
      jest.useRealTimers();
    }
  });

  it("RAC's member number: stored and copied as its digits, sent nowhere, in no answer, event, log line or plain row", async () => {
    const racHttp = new RecordingHttpClient({ providerId: 'rac' });
    container.providers.register(racFactory, (manifest) =>
      createProviderContext(manifest, {
        createHttp: () => racHttp,
        createState: (id) => new SqliteKeyValueStore(container.repositories.providerState, id),
        vault: container.vault,
        logger,
        providersDir: TEST_PROVIDERS_DIR,
        unpaced: true,
      })
    );
    const typed = '1234-5678-90123';
    const responses: Array<APIResponse<unknown>> = [];
    const record = async (pending: Promise<APIResponse<unknown>>) => {
      const response = await pending;
      responses.push(response);
      return response;
    };
    const statements = ['ownNumber', 'willStay', 'nameOnCard'];

    await expect(
      record(
        call('accounts:save-credentials', {
          providerId: 'rac',
          values: { memberNumber: `${typed}x` },
          confirmed: statements,
        })
      )
    ).resolves.toMatchObject({ success: false, code: 'VALIDATION' });
    await expect(
      record(
        call('accounts:save-credentials', {
          providerId: 'rac',
          values: { memberNumber: typed },
          confirmed: statements,
        })
      )
    ).resolves.toMatchObject({ success: true, data: { savedFields: ['memberNumber'] } });
    await record(call('accounts:list'));
    await record(call('accounts:status', { providerId: 'rac' }));
    await expect(
      record(call('accounts:copy-credential', { providerId: 'rac', key: 'memberNumber' }))
    ).resolves.toEqual({ success: true });
    const savedDatabase = plainDatabase();
    expect(savedDatabase).toContain('secret:account.memberNumber');
    await record(call('accounts:sign-out', { providerId: 'rac' }));

    // Copied once, as RAC's checkout takes it: the digits, as text
    expect(clipboard.writeText.mock.calls).toEqual([[NUMBER]]);
    expect(racHttp.requests).toEqual([]);
    const updates = renderer.sent.filter(
      ([name, payload]) =>
        name === 'account:updated' && (payload as ProviderAccount).providerId === 'rac'
    );
    expect(updates.length).toBeGreaterThanOrEqual(2);
    const logs = logLines.join('\n');
    for (const sentinel of [NUMBER, typed]) {
      expect(JSON.stringify(responses)).not.toContain(sentinel);
      expect(JSON.stringify(updates)).not.toContain(sentinel);
      expect(logs).not.toContain(sentinel);
      expect(savedDatabase).not.toContain(sentinel);
      expect(plainDatabase()).not.toContain(sentinel);
    }
  });

  it("RAC's auto-cart: a member's hold and its release send the number nowhere, and the cart address is in no answer, log line, notification or row", async () => {
    fakeDateOnly(new Date('2026-10-17T02:00:00.000Z'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-cart-leak-'));
    try {
      // The synthetic cart fixtures: the cart page (empty, then holding the stay), the
      // availability answer with cart addresses, the member rate's cart address, the removal
      fs.mkdirSync(path.join(dir, 'rac'));
      for (const file of fs.readdirSync(CART_FIXTURES)) {
        fs.copyFileSync(path.join(CART_FIXTURES, file), path.join(dir, 'rac', file));
      }
      const cartShows = (file: string) =>
        fs.copyFileSync(path.join(CART_FIXTURES, file), path.join(dir, 'rac', 'cart-now.html'));
      cartShows('cart-page-empty.html');
      fs.writeFileSync(
        path.join(dir, 'rac', 'manifest.json'),
        JSON.stringify({
          routes: [
            {
              method: 'GET',
              path: '/busselton/booking/',
              query: { rand: '1002' },
              file: 'cart-page-one-stay.html',
            },
            { method: 'GET', path: '/busselton/booking/', file: 'cart-now.html' },
            {
              method: 'POST',
              path: RAC_AVAILABILITY_PATH,
              form: { blog_id: '6', available_from: '6 Nov 2026' },
              file: 'availability-busselton-2026-11-06-2n.json',
            },
            {
              method: 'POST',
              path: '/busselton/wp-content/themes/parks-and-resorts/inc/newbook/api/rac-busselton-holiday-park.php',
              query: { query: 'remove_item_from_cart' },
              file: 'remove-item-from-cart.json',
            },
          ],
        })
      );
      const racHttp = new RecordingFixtureClient({
        providerId: 'rac',
        fixturesDir: dir,
        logFile: path.join(dir, 'unexpected.log'),
      });
      container.providers.register(withExperiments(racFactory, ['autoCart']), (manifest) =>
        createProviderContext(manifest, {
          createHttp: () => racHttp,
          createState: (id) => new SqliteKeyValueStore(container.repositories.providerState, id),
          vault: container.vault,
          logger,
          providersDir: TEST_PROVIDERS_DIR,
          unpaced: true,
        })
      );
      const responses: Array<APIResponse<unknown>> = [];
      const record = async <T>(pending: Promise<APIResponse<T>>) => {
        const response = await pending;
        responses.push(response);
        return response;
      };
      await expect(
        record(
          call('accounts:save-credentials', {
            providerId: 'rac',
            values: { memberNumber: NUMBER },
            confirmed: ['ownNumber', 'willStay', 'nameOnCard'],
          })
        )
      ).resolves.toMatchObject({ success: true });

      // A member's automatic hold on Busselton's powered site
      const created = await record(
        call<Watch>('watches:create', {
          providerId: 'rac',
          name: 'Busselton',
          location: { externalId: 'busselton', name: 'RAC Busselton Holiday Park' },
          stay: { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 },
          unitKinds: ['campsite'],
          checkIntervalMinutes: 15,
          autoHold: true,
          stayParams: { equipmentType: '1', equipmentLength: '6.5', equipmentWidth: '2.5' },
        })
      );
      const id = (created as { data: Watch }).data.id;
      await record(call('watches:run-now', { id }));
      const held = await record(call<Watch>('watches:get', { id }));
      expect(held).toMatchObject({
        success: true,
        data: {
          lastResult: 'held',
          hold: { paymentUrl: 'https://parksandresorts.rac.com.au/busselton/booking/' },
        },
      });
      // The member rate's cart address, the only one opened
      expect(racHttp.sent.filter((r) => CART_ADDRESS.test(r.url)).map((r) => r.url)).toEqual([
        expect.stringMatching(/rand=1002$/),
      ]);

      // "Let it go": the cart still holds the stay
      cartShows('cart-page-one-stay.html');
      const released = await record(call<Watch>('watches:release-hold', { id }));
      expect(released).toMatchObject({ success: true, data: { lastError: 'You let it go.' } });
      expect(racHttp.sent.filter((r) => r.url.includes('remove_item_from_cart'))).toHaveLength(1);

      const logs = logLines.join('\n');
      const notifications = JSON.stringify(
        container.db.prepare('SELECT * FROM notifications').all()
      );
      const rows = JSON.stringify([
        container.db.prepare('SELECT * FROM watches').all(),
        container.db.prepare('SELECT * FROM provider_state').all(),
      ]);
      const events = JSON.stringify(renderer.sent);
      expect(JSON.stringify(racHttp.sent)).not.toContain(NUMBER);
      for (const text of [JSON.stringify(responses), logs, notifications, rows, events]) {
        expect(text).not.toContain(NUMBER);
        expect(text).not.toMatch(CART_ADDRESS);
      }
      expect(String((held as { data: Watch }).data.hold?.reference)).not.toContain(NUMBER);
    } finally {
      jest.useRealTimers();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
