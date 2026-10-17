/**
 * ProviderAccountService on a real database (`provider_accounts`), a registry of
 * FakeProviders and in-memory windows and sessions:
 * - `list` (no network), `status` (single flight, 60 s cache, 5 s for an unknown answer,
 *   sticky definite answers,
 *   `account:updated` only for visible changes, 15 s limit), `ensureForHolds`;
 * - sign-in: completion confirmed by a check, the 3 s poll only on the provider's own site,
 *   a second call joining the first, closing early, pasted links;
 * - sign-out: `ACCOUNT_BUSY`, clearing the partition once, a check in flight discarded;
 * - the startup refresh of stale accounts, and dispose.
 */

import type Database from 'better-sqlite3';
import { closeDatabase, openDatabase } from '@main/database/connection';
import {
  ProviderAccountRepository,
  ProviderStateRepository,
  SqliteKeyValueStore,
} from '@main/database/repositories';
import {
  ProviderAccountService,
  type AccountTimings,
} from '@main/core/accounts/provider-account.service';
import type { ProviderSessionStore } from '@main/core/accounts/ports';
import { ProviderRegistry } from '@main/providers/registry';
import {
  createScopedSecretVault,
  FakeSecretVault,
  ProviderAuthRequiredError,
  ProviderCapabilityError,
  toApiError,
  UnknownProviderError,
  type SecretVaultLike,
} from '@main/providers/sdk';
import { SecretVaultNotReadyError } from '@main/security/secret-vault';
import { PARKSTAY_SIGN_IN_COMPLETE } from '@main/providers/parkstay/auth';
import { AppError } from '@main/utils/app-error';
import type { AccountStatus, ProviderAccount } from '@shared/types/provider.types';
import { RecordingHttpClient } from '@tests/utils/fake-paced-provider';
import {
  FAKE_CONFIRMATIONS,
  FAKE_CREDENTIAL_FIELDS,
  createFakeProvider,
  createMemoryLogger,
  createTestProviderContext,
  type FakeCredentialsOptions,
  type FakeProvider,
  type MemoryLogger,
} from '@tests/utils/fake-provider';
import { FakeOpener } from '@tests/utils/fake-provider-windows';

const SITE = 'https://parkstay.dbca.wa.gov.au';
const B2C = 'https://dbcab2c.b2clogin.com';
const SIGN_IN_URL = `${SITE}/ssologin`;

/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('ProviderAccountService', () => {
  let db: Database.Database;
  let repo: ProviderAccountRepository;
  let registry: ProviderRegistry;
  let parkstay: FakeProvider;
  let windows: FakeOpener;
  let sessions: { clear: jest.Mock; flush: jest.Mock } & ProviderSessionStore;
  let events: { emit: jest.Mock };
  let busy: boolean;
  let busyAsked: Date[];
  let logger: MemoryLogger;
  let clipboard: { writeText: jest.Mock };
  let credentialsChanged: jest.Mock;
  let service: ProviderAccountService;

  const probes = (fake: FakeProvider = parkstay) =>
    fake.calls.filter((c) => c.module === 'auth' && c.method === 'isSignedIn').length;
  const updates = () =>
    events.emit.mock.calls.filter(([name]) => name === 'account:updated').map(([, a]) => a);

  function build(
    timings: Partial<AccountTimings> = {},
    clock?: () => Date
  ): ProviderAccountService {
    service = new ProviderAccountService({
      clock,
      providers: registry,
      accounts: repo,
      windows,
      sessions,
      clipboard,
      events,
      isBusy: (_providerId, now) => {
        busyAsked.push(now);
        return busy;
      },
      onCredentialsChanged: credentialsChanged,
      logger,
      timings,
    });
    return service;
  }

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new ProviderAccountRepository(db);
    registry = new ProviderRegistry();
    // A stand-in for ParkStay: its sign-in URL, origins and completion page
    parkstay = createFakeProvider({
      id: 'parkstay',
      name: 'ParkStay WA',
      shortName: 'ParkStay',
      account: 'signed-out',
      capabilities: { account: 'optional' },
      auth: {
        signInUrl: SIGN_IN_URL,
        allowedOrigins: [SITE, B2C, 'https://queue.dbca.wa.gov.au'],
        completionUrlPatterns: PARKSTAY_SIGN_IN_COMPLETE,
      },
    });
    registry.register(parkstay.factory, (m) => createTestProviderContext(m));
    registry.register(
      createFakeProvider({ id: 'noacct', capabilities: { account: 'none' } }).factory,
      (m) => createTestProviderContext(m)
    );
    windows = new FakeOpener();
    sessions = {
      clear: jest.fn(async () => undefined),
      flush: jest.fn(async () => undefined),
    };
    events = { emit: jest.fn() };
    busy = false;
    busyAsked = [];
    logger = createMemoryLogger();
    clipboard = { writeText: jest.fn() };
    credentialsChanged = jest.fn();
    build();
  });

  afterEach(() => {
    service.dispose();
    jest.useRealTimers();
    closeDatabase(db);
  });

  describe('list and status', () => {
    it('lists only providers with accounts, from the stored rows, without asking anyone', async () => {
      await expect(service.list()).resolves.toEqual([
        {
          providerId: 'parkstay',
          requirement: 'optional',
          authKind: 'browser-session',
          status: 'unknown',
        },
      ]);
      repo.upsert({ providerId: 'parkstay', status: 'signed-out', email: 'hint@example.com' });
      await expect(service.list()).resolves.toEqual([
        {
          providerId: 'parkstay',
          requirement: 'optional',
          authKind: 'browser-session',
          status: 'signed-out',
          email: 'hint@example.com',
        },
      ]);
      expect(probes()).toBe(0);
    });

    it('signed-in sets last_signed_in_at and emits one account:updated', async () => {
      parkstay.setAccount('signed-in');
      const account = await service.status('parkstay');

      expect(account).toMatchObject({
        providerId: 'parkstay',
        status: 'signed-in',
        email: 'person@parkstay.example',
        displayName: 'Pat Person',
        lastSignedInAt: expect.any(String),
        lastCheckedAt: expect.any(String),
      });
      const row = repo.get('parkstay');
      expect(row).toMatchObject({ status: 'signed-in', email: 'person@parkstay.example' });
      expect(row?.lastSignedInAt).toBeInstanceOf(Date);
      expect(updates()).toEqual([account]);

      // The same answer again (forced past the cache): nothing visible changed, no event,
      // and last_signed_in_at stays the first sign-in
      const again = await service.status('parkstay', { force: true });
      expect(again.lastSignedInAt).toBe(account.lastSignedInAt);
      expect(updates()).toHaveLength(1);
    });

    it('two concurrent status calls make one request', async () => {
      parkstay.setAccount('signed-in');
      parkstay.delayMs = 20;
      const [a, b] = await Promise.all([service.status('parkstay'), service.status('parkstay')]);

      expect(probes()).toBe(1);
      expect(a).toEqual(b);
      expect(updates()).toHaveLength(1);
    });

    it('answers are cached for 60 s; force asks again', async () => {
      let now = new Date('2026-10-04T00:00:00Z');
      build({}, () => now);
      await service.status('parkstay');
      await service.status('parkstay');
      expect(probes()).toBe(1);

      now = new Date('2026-10-04T00:00:59Z');
      await service.status('parkstay');
      expect(probes()).toBe(1);
      now = new Date('2026-10-04T00:01:01Z');
      await service.status('parkstay');
      expect(probes()).toBe(2);
      await service.status('parkstay', { force: true });
      expect(probes()).toBe(3);
    });

    it('an unknown answer (queue, 5xx, no network) is reused for 5 s only', async () => {
      let now = new Date('2026-10-04T00:00:00Z');
      build({}, () => now);
      parkstay.setAccount('unknown');
      await service.status('parkstay');
      now = new Date('2026-10-04T00:00:04Z');
      await service.status('parkstay');
      expect(probes()).toBe(1);

      // The queue let it through: the next look asks again, and its answer keeps for 60 s
      parkstay.setAccount('signed-in');
      now = new Date('2026-10-04T00:00:06Z');
      await expect(service.status('parkstay')).resolves.toMatchObject({ status: 'signed-in' });
      expect(probes()).toBe(2);
      now = new Date('2026-10-04T00:00:50Z');
      await service.status('parkstay');
      expect(probes()).toBe(2);
    });

    it('an unknown answer keeps the last definite status, writes nothing and emits nothing', async () => {
      const checked = new Date('2026-10-01T00:00:00Z');
      repo.upsert({
        providerId: 'parkstay',
        status: 'signed-in',
        email: 'a@b.au',
        lastCheckedAt: checked,
      });
      parkstay.setAccount('unknown');

      await expect(service.status('parkstay')).resolves.toMatchObject({
        status: 'signed-in',
        email: 'a@b.au',
      });
      expect(repo.get('parkstay')?.lastCheckedAt?.toISOString()).toBe(checked.toISOString());
      expect(updates()).toEqual([]);
    });

    it('a failing check is unknown, not an error', async () => {
      parkstay.failNext('auth', new Error('socket hang up'));
      await expect(service.status('parkstay')).resolves.toMatchObject({ status: 'unknown' });
      expect(repo.get('parkstay')).toBeNull();
    });

    it('a check slower than the limit is abandoned as unknown', async () => {
      build({ probeTimeoutMs: 30 });
      parkstay.setAccount('signed-in');
      parkstay.delayMs = 5_000;
      await expect(service.status('parkstay')).resolves.toMatchObject({ status: 'unknown' });
      expect(repo.get('parkstay')).toBeNull();
    });

    it('a session that expired turns signed-out, keeping the email as a hint (one event)', async () => {
      parkstay.setAccount('signed-in');
      await service.status('parkstay');
      parkstay.setAccount('signed-out');

      await expect(service.status('parkstay', { force: true })).resolves.toMatchObject({
        status: 'signed-out',
        email: 'person@parkstay.example',
        lastSignedInAt: expect.any(String),
      });
      expect(updates().map((a) => (a as ProviderAccount).status)).toEqual([
        'signed-in',
        'signed-out',
      ]);
    });

    it('updates the email from the profile when the account changes between sessions', async () => {
      repo.upsert({ providerId: 'parkstay', status: 'signed-in', email: 'old@example.com' });
      parkstay.setAccount('signed-in');

      await expect(service.status('parkstay')).resolves.toMatchObject({
        email: 'person@parkstay.example',
      });
      expect(updates()).toHaveLength(1);
    });

    it('refuses unknown providers and providers without accounts', () => {
      expect(() => service.status('nope')).toThrow(UnknownProviderError);
      expect(() => service.status('noacct')).toThrow(ProviderCapabilityError);
    });
  });

  describe('ensureForHolds', () => {
    it('never blocks an optional account, and asks nobody', async () => {
      await expect(service.ensureForHolds('parkstay')).resolves.toBeUndefined();
      expect(probes()).toBe(0);
    });

    it('a required-for-holds provider needs a signed-in account', async () => {
      const strict = createFakeProvider({
        id: 'strict',
        account: 'signed-out',
        capabilities: { account: 'required-for-holds' },
      });
      registry.register(strict.factory, (m) => createTestProviderContext(m));

      await expect(service.ensureForHolds('strict')).rejects.toBeInstanceOf(
        ProviderAuthRequiredError
      );
      await expect(service.ensureForHolds('strict')).rejects.toMatchObject({
        message: 'Sign in to strict first',
      });
      strict.setAccount('signed-in');
      await expect(service.ensureForHolds('strict')).rejects.toBeInstanceOf(
        ProviderAuthRequiredError
      ); // still cached
      await service.status('strict', { force: true });
      await expect(service.ensureForHolds('strict')).resolves.toBeUndefined();
    });
  });

  describe('sign-in', () => {
    it("opens the provider's sign-in page on its origins, and sends blocked pages outside", () => {
      void service.signIn('parkstay');

      expect(windows.requests).toEqual([
        {
          // The short name, as every window title uses
          providerId: 'parkstay',
          providerName: 'ParkStay',
          kind: 'sign-in',
          url: SIGN_IN_URL,
          allowedOrigins: [SITE, B2C, 'https://queue.dbca.wa.gov.au'],
          openBlockedExternally: true,
          // From the provider's access gate: back to the sign-in page after its waiting room
          waitingRoomOrigins: ['https://queue.parkstay.example'],
        },
      ]);
    });

    it('a first page that is blocked or fails rejects signIn with that PROVIDER_ERROR; a new signIn opens again', async () => {
      const pending = service.signIn('parkstay');
      windows.last.failFirstPage(
        "ParkStay's page sent the window to https://evil.example, which it does not allow"
      );

      const error = await pending.catch((e: unknown) => e);
      expect(toApiError(error)).toEqual({
        code: 'PROVIDER_ERROR',
        message: "ParkStay's page sent the window to https://evil.example, which it does not allow",
      });
      expect(probes()).toBe(0);

      void service.signIn('parkstay');
      expect(windows.windows).toHaveLength(2);
    });

    it('a pasted link whose window fails leaves no unhandled rejection', async () => {
      service.openSignInLink('parkstay', `${B2C}/link?token=abc`);
      windows.last.failFirstPage("ParkStay's page could not be loaded (ERR_CONNECTION_REFUSED)");
      await settle();
      expect(windows.last.closed).toBe(true);
    });

    it('/login-success/ resolves signIn as signed-in once a check confirms it, and closes the window', async () => {
      const pending = service.signIn('parkstay');
      parkstay.setAccount('signed-in');
      windows.last.navigate(`${SITE}/login-success/`);

      await expect(pending).resolves.toMatchObject({ status: 'signed-in' });
      expect(windows.last.closed).toBe(true);
      expect(sessions.flush).toHaveBeenCalledWith('parkstay');
      expect(updates()).toHaveLength(1);
    });

    it('a completion page that says the session expired does not finish sign-in', async () => {
      const pending = service.signIn('parkstay');
      let done = false;
      void pending.then(() => (done = true));
      windows.last.navigate(`${SITE}/login-success/`); // still signed out
      await settle();

      expect(done).toBe(false);
      expect(windows.last.closed).toBe(false);
      expect(probes()).toBe(1);
    });

    it('closing the window first resolves with the unchanged status', async () => {
      repo.upsert({ providerId: 'parkstay', status: 'signed-out', email: 'hint@example.com' });
      const pending = service.signIn('parkstay');
      windows.last.close();

      await expect(pending).resolves.toEqual({
        providerId: 'parkstay',
        requirement: 'optional',
        authKind: 'browser-session',
        status: 'signed-out',
        email: 'hint@example.com',
        lastCheckedAt: expect.any(String),
      });
      expect(updates()).toEqual([]);
    });

    it('a second signIn focuses the open window and returns the same promise', () => {
      const first = service.signIn('parkstay');
      const second = service.signIn('parkstay');

      expect(second).toBe(first);
      expect(windows.windows).toHaveLength(1);
      expect(windows.last.focused).toBe(1);
    });

    it('polls every 3 s only while the window shows the provider’s own site', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate'] });
      const pending = service.signIn('parkstay');
      windows.last.navigate(`${B2C}/dbcab2c.onmicrosoft.com/b2c_1a_parkstay_prod/oauth2`);

      await jest.advanceTimersByTimeAsync(9_000);
      expect(probes()).toBe(0); // the identity provider's pages: nothing to ask yet

      windows.last.navigate(`${SITE}/`); // back on ParkStay, not a completion page
      await jest.advanceTimersByTimeAsync(3_000);
      await jest.advanceTimersByTimeAsync(1); // let that check answer (signed out)
      expect(probes()).toBe(1);
      expect(windows.last.closed).toBe(false);

      parkstay.setAccount('signed-in');
      await jest.advanceTimersByTimeAsync(3_000);
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toMatchObject({ status: 'signed-in' });
      expect(probes()).toBe(2);
      expect(windows.last.closed).toBe(true);

      await jest.advanceTimersByTimeAsync(30_000);
      expect(probes()).toBe(2); // the poll stopped
      expect(jest.getTimerCount()).toBe(0);
    });

    it('a pasted link on a sign-in origin loads in the open window', () => {
      void service.signIn('parkstay');
      service.openSignInLink('parkstay', `${B2C}/link?token=abc`);

      expect(windows.windows).toHaveLength(1);
      expect(windows.last.loads).toEqual([`${B2C}/link?token=abc`]);
      expect(windows.last.focused).toBe(1);
    });

    it('a pasted link opens the sign-in window on it when none is open', () => {
      service.openSignInLink('parkstay', `${B2C}/link?token=abc`);
      expect(windows.requests[0]).toMatchObject({ kind: 'sign-in', url: `${B2C}/link?token=abc` });
    });

    it('a pasted link off the sign-in origins is VALIDATION and never loaded', () => {
      for (const url of ['https://evil.example/x', `http://dbcab2c.b2clogin.com/x`]) {
        let thrown: unknown;
        try {
          service.openSignInLink('parkstay', url);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(AppError);
        expect(thrown).toMatchObject({ code: 'VALIDATION', issues: ['url'] });
      }
      expect(windows.requests).toEqual([]);
    });

    it('sign-in kinds other than browser-session are not available yet', () => {
      const automated = createFakeProvider({ id: 'auto' });
      automated.auth = {
        kind: 'automation',
        signIn: async () => ({ state: 'signed-in' }),
        isSignedIn: async () => ({ state: 'signed-out' }),
      };
      registry.register(automated.factory, (m) => createTestProviderContext(m));

      expect(() => service.signIn('auto')).toThrow(
        expect.objectContaining({ code: 'NOT_IMPLEMENTED' })
      );
    });
  });

  describe('sign-out', () => {
    it('is ACCOUNT_BUSY while a snipe or hold needs the session, and clears nothing', async () => {
      const now = new Date('2026-10-04T00:00:00Z');
      build({}, () => now);
      busy = true;
      await expect(service.signOut('parkstay')).rejects.toMatchObject({ code: 'ACCOUNT_BUSY' });
      // Asked at the service's own clock
      expect(busyAsked).toEqual([now]);
      expect(sessions.clear).not.toHaveBeenCalled();
      expect(repo.get('parkstay')).toBeNull();
    });

    it('clears the partition once, stores signed-out keeping the email, and emits', async () => {
      repo.upsert({ providerId: 'parkstay', status: 'signed-in', email: 'a@b.au' });

      const account = await service.signOut('parkstay');

      expect(sessions.clear).toHaveBeenCalledTimes(1);
      expect(sessions.clear).toHaveBeenCalledWith('parkstay');
      expect(account).toMatchObject({ status: 'signed-out', email: 'a@b.au' });
      expect(repo.get('parkstay')).toMatchObject({ status: 'signed-out', email: 'a@b.au' });
      expect(updates()).toEqual([account]);
    });

    it('a check in flight when signing out records nothing', async () => {
      parkstay.setAccount('signed-in');
      parkstay.delayMs = 30;
      const checking = service.status('parkstay');

      await service.signOut('parkstay');
      await checking;

      expect(repo.get('parkstay')?.status).toBe('signed-out');
    });

    it('closes an open sign-in window, which resolves its signIn', async () => {
      const pending = service.signIn('parkstay');
      await service.signOut('parkstay');

      await expect(pending).resolves.toMatchObject({ providerId: 'parkstay' });
      expect(windows.last.closed).toBe(true);
    });
  });

  describe('recheck (after a payment window closes)', () => {
    it('checks once, bypassing the cache, and stores a definite answer', async () => {
      await service.status('parkstay');
      expect(probes()).toBe(1);
      parkstay.setAccount('signed-in');

      await service.recheck('parkstay');

      expect(probes()).toBe(2);
      expect(service.storedState('parkstay')).toBe('signed-in');
      expect(updates()).toHaveLength(2);
    });

    it('never rejects, and does nothing for a provider without accounts or after dispose', async () => {
      const none = createFakeProvider({ id: 'none', capabilities: { account: 'none' } });
      registry.register(none.factory, (m) => createTestProviderContext(m));

      await expect(service.recheck('none')).resolves.toBeUndefined();
      await expect(service.recheck('missing')).resolves.toBeUndefined();
      expect(probes(none)).toBe(0);

      service.dispose();
      await service.recheck('parkstay');
      expect(probes()).toBe(0);
    });
  });

  describe('startup refresh and dispose', () => {
    it('checks only accounts never checked or last checked more than 6 h ago', async () => {
      const other = createFakeProvider({ id: 'other', account: 'signed-in' });
      registry.register(other.factory, (m) => createTestProviderContext(m));
      repo.upsert({
        providerId: 'other',
        status: 'signed-in',
        lastCheckedAt: new Date(Date.now() - 60 * 60_000),
      });

      await service.refreshStale();

      expect(probes()).toBe(1); // parkstay: never checked
      expect(probes(other)).toBe(0); // checked an hour ago
    });

    it('dispose settles a pending sign-in from the stored row and stops checking', async () => {
      const pending = service.signIn('parkstay');
      service.dispose();

      await expect(pending).resolves.toMatchObject({ status: 'unknown' });
      await expect(service.status('parkstay', { force: true })).resolves.toMatchObject({
        status: 'unknown',
      });
      expect(probes()).toBe(0);
    });
  });

  describe('credentials accounts', () => {
    /** Made-up values only (never a real member number). */
    const NUMBER = '1234567890123';
    const PASSWORD = 'made-up-pass-77';
    const VALUES = { memberNumber: ` ${NUMBER} `, password: PASSWORD };

    let keystay: FakeProvider;
    let http: RecordingHttpClient;
    let state: ProviderStateRepository;
    let answers: Array<Readonly<Record<string, string>>>;

    /** A `credentials` provider whose secrets live in `provider_state`, through `vault`. */
    function registerKeyStay(
      options: { vault?: SecretVaultLike; signIn?: FakeCredentialsOptions['signIn'] } = {}
    ): FakeProvider {
      const fake = createFakeProvider({
        id: 'keystay',
        name: 'Key Stay',
        shortName: 'KeyStay',
        capabilities: { account: 'optional' },
        credentials: {
          signIn:
            options.signIn ??
            ((values) => {
              answers.push(values);
              return { state: 'signed-in' };
            }),
        },
      });
      registry.register(fake.factory, (m) => {
        const store = new SqliteKeyValueStore(state, m.id);
        return createTestProviderContext(m, {
          http,
          state: store,
          secrets: createScopedSecretVault({
            providerId: m.id,
            vault: options.vault ?? new FakeSecretVault(),
            store,
            logger: createMemoryLogger(),
          }),
        });
      });
      return fake;
    }

    const secretRows = () =>
      db
        .prepare("SELECT key, value FROM provider_state WHERE provider_id = 'keystay' ORDER BY key")
        .all() as Array<{ key: string; value: string }>;
    const everything = () =>
      JSON.stringify([
        db.prepare('SELECT * FROM provider_state').all(),
        db.prepare('SELECT * FROM provider_accounts').all(),
        logger.lines,
        events.emit.mock.calls,
      ]);
    /** After the fake's own timer (its calls wait one). */
    const later = () => new Promise((resolve) => setTimeout(resolve, 10));
    const signIns = () =>
      keystay.calls.filter((c) => c.module === 'auth' && c.method === 'signIn').length;
    const refusal = (promise: Promise<unknown>) =>
      promise.then(
        () => {
          throw new Error('expected a refusal');
        },
        (error: AppError) => ({ code: error.code, message: error.message, issues: error.issues })
      );

    beforeEach(() => {
      http = new RecordingHttpClient({ providerId: 'keystay' });
      state = new ProviderStateRepository(db);
      answers = [];
      keystay = registerKeyStay();
    });

    it('lists the account with its fields and statements, worked out with no isSignedIn and no request', async () => {
      const expected = {
        providerId: 'keystay',
        requirement: 'optional',
        authKind: 'credentials',
        status: 'signed-out',
        fields: FAKE_CREDENTIAL_FIELDS,
        confirmations: FAKE_CONFIRMATIONS,
        savedFields: [],
      };

      expect((await service.list()).find((a) => a.providerId === 'keystay')).toEqual(expected);
      await expect(service.status('keystay', { force: true })).resolves.toEqual(expected);
      await service.ensureForHolds('keystay');
      await service.recheck('keystay');
      await service.refreshStale();

      expect(probes(keystay)).toBe(0);
      expect(http.requests).toEqual([]);
      expect(service.storedState('keystay')).toBe('unknown');
      expect(updates().filter((a) => (a as ProviderAccount).providerId === 'keystay')).toEqual([]);
    });

    it('saving stores ciphertext under secret:account.<key> in provider_state, and no row holds the plaintext', async () => {
      const account = await service.saveCredentials('keystay', VALUES, ['own']);

      expect(account).toEqual({
        providerId: 'keystay',
        requirement: 'optional',
        authKind: 'credentials',
        status: 'signed-in',
        lastSignedInAt: expect.any(String),
        lastCheckedAt: expect.any(String),
        fields: FAKE_CREDENTIAL_FIELDS,
        confirmations: FAKE_CONFIRMATIONS,
        savedFields: ['memberNumber', 'password'],
      });
      // The provider checked the trimmed values, at the person's (interactive) priority
      expect(answers).toEqual([{ memberNumber: NUMBER, password: PASSWORD }]);
      expect(keystay.calls.find((c) => c.method === 'signIn')).toMatchObject({
        args: [['memberNumber', 'password']],
        priority: 'interactive',
      });
      const rows = secretRows();
      expect(rows.map((r) => r.key)).toEqual([
        'secret:account.memberNumber',
        'secret:account.password',
      ]);
      for (const row of rows) expect(JSON.parse(row.value)).toMatch(/^fake-vault:/);
      expect(everything()).not.toContain(NUMBER);
      expect(everything()).not.toContain(PASSWORD);
      // The provider reads it back with ctx.secrets
      await expect(keystay.ctx!.secrets.get('account.memberNumber')).resolves.toBe(NUMBER);
      expect(repo.get('keystay')).toMatchObject({
        status: 'signed-in',
        lastSignedInAt: expect.any(Date),
      });
      expect(updates()).toEqual([account]);
      expect(credentialsChanged.mock.calls).toEqual([['keystay']]);
      expect(http.requests).toEqual([]);
    });

    it('saving again replaces every value; removing deletes them, never ACCOUNT_BUSY or a cleared session', async () => {
      await service.saveCredentials('keystay', VALUES, ['own']);
      await service.saveCredentials(
        'keystay',
        { memberNumber: '012345678', password: 'other-made-up-1' },
        ['own']
      );
      await expect(keystay.ctx!.secrets.get('account.memberNumber')).resolves.toBe('012345678');
      await expect(keystay.ctx!.secrets.get('account.password')).resolves.toBe('other-made-up-1');

      busy = true;
      const removed = await service.signOut('keystay');

      expect(removed).toMatchObject({ status: 'signed-out', savedFields: [] });
      expect(secretRows()).toEqual([]);
      expect(sessions.clear).not.toHaveBeenCalled();
      expect(busyAsked).toEqual([]);
      expect(service.storedState('keystay')).toBe('signed-out');
      expect(updates().at(-1)).toEqual(removed);
      // Save, replace, remove: once each, with the provider id and nothing else
      expect(credentialsChanged.mock.calls).toEqual([['keystay'], ['keystay'], ['keystay']]);
      expect((await service.list()).find((a) => a.providerId === 'keystay')).toMatchObject({
        status: 'signed-out',
        savedFields: [],
      });
    });

    it('saving without the confirmations is VALIDATION with ["confirmed"]; nothing is asked or stored', async () => {
      await expect(refusal(service.saveCredentials('keystay', VALUES, []))).resolves.toEqual({
        code: 'VALIDATION',
        message: 'Tick each statement to save',
        issues: ['confirmed'],
      });
      await expect(
        refusal(service.saveCredentials('keystay', VALUES, ['other']))
      ).resolves.toMatchObject({
        issues: ['confirmed'],
      });
      expect(signIns()).toBe(0);
      expect(secretRows()).toEqual([]);
      expect(credentialsChanged).not.toHaveBeenCalled();
    });

    it.each<[string, Record<string, string>, string[], string]>([
      ['a missing field', { memberNumber: NUMBER }, ['values.password'], 'Password is missing'],
      [
        'an empty field',
        { memberNumber: '   ', password: PASSWORD },
        ['values.memberNumber'],
        'Member number is missing',
      ],
      [
        'an unknown field',
        { ...VALUES, pin: '4321' },
        ['values.pin'],
        "KeyStay doesn't ask for that detail",
      ],
      [
        'a value over 256 characters',
        { memberNumber: '9'.repeat(257), password: PASSWORD },
        ['values.memberNumber'],
        'Member number is too long (256 characters at most)',
      ],
    ])(
      '%s is VALIDATION with values.<key>, and the message quotes no value',
      async (_label, values, issues, message) => {
        await expect(refusal(service.saveCredentials('keystay', values, ['own']))).resolves.toEqual(
          {
            code: 'VALIDATION',
            message,
            issues,
          }
        );
        expect(signIns()).toBe(0);
        expect(secretRows()).toEqual([]);
      }
    );

    it('trims the ends only: spaces and dashes inside, and Unicode, are kept for the provider', async () => {
      await service.saveCredentials(
        'keystay',
        { memberNumber: ' 1234-5678 90 ', password: 'Zoë ß ✓' },
        ['own']
      );
      await expect(keystay.ctx!.secrets.get('account.memberNumber')).resolves.toBe('1234-5678 90');
      await expect(keystay.ctx!.secrets.get('account.password')).resolves.toBe('Zoë ß ✓');
      // 256 characters (code points) is allowed
      await service.saveCredentials(
        'keystay',
        { memberNumber: '😀'.repeat(256), password: PASSWORD },
        ['own']
      );
    });

    it('a signIn may return normalised values: those are stored and copied, and none is logged', async () => {
      registry = new ProviderRegistry();
      keystay = registerKeyStay({
        signIn: (values) => ({
          state: 'signed-in',
          // The provider's own form: digits only. The password is left out, so kept as typed.
          values: { memberNumber: values.memberNumber.replace(/[\s-]/g, '') },
        }),
      });
      build();

      const spaced = '1234 5678-90123';
      await service.saveCredentials(
        'keystay',
        { memberNumber: ` ${spaced} `, password: PASSWORD },
        ['own']
      );
      await expect(keystay.ctx!.secrets.get('account.memberNumber')).resolves.toBe(NUMBER);
      await expect(keystay.ctx!.secrets.get('account.password')).resolves.toBe(PASSWORD);
      await service.copyCredential('keystay', 'memberNumber');

      expect(clipboard.writeText.mock.calls).toEqual([[NUMBER]]);
      for (const value of [NUMBER, spaced, PASSWORD]) expect(everything()).not.toContain(value);
      expect(logger.lines.filter((l) => l.level === 'warn')).toEqual([]);
    });

    it.each<[string, unknown]>([
      ['an undeclared key', { memberNumber: NUMBER, pin: '4321' }],
      ['an empty value', { memberNumber: '  ' }],
      ['a value over 256 characters', { memberNumber: '1'.repeat(257) }],
      ['a value that is not text', { memberNumber: 1234567890123 }],
      ['values that are not an object', 'digits'],
    ])(
      'normalised values with %s are ignored: the typed ones are stored, with a warning that names none',
      async (_label, returned) => {
        registry = new ProviderRegistry();
        keystay = registerKeyStay({
          signIn: () => ({ state: 'signed-in', values: returned }) as unknown as AccountStatus,
        });
        build();

        await service.saveCredentials(
          'keystay',
          { memberNumber: '012345678', password: PASSWORD },
          ['own']
        );

        await expect(keystay.ctx!.secrets.get('account.memberNumber')).resolves.toBe('012345678');
        const warnings = logger.lines.filter((l) => l.level === 'warn').map((l) => l.message);
        expect(warnings).toEqual([
          'Account keystay: its normalised values were ignored (an undeclared key, or a value that is not text, empty or too long); the typed ones are kept',
        ]);
        expect(everything()).not.toContain('012345678');
      }
    );

    it('a signed-out answer is VALIDATION and an unknown one PROVIDER_ERROR; neither stores anything', async () => {
      registry = new ProviderRegistry();
      const scripted: AccountStatus['state'][] = ['signed-out', 'unknown'];
      keystay = registerKeyStay({ signIn: () => ({ state: scripted.shift()! }) });
      build();

      await expect(refusal(service.saveCredentials('keystay', VALUES, ['own']))).resolves.toEqual({
        code: 'VALIDATION',
        message: "KeyStay didn't accept these details",
        issues: ['values.memberNumber', 'values.password'],
      });
      await expect(refusal(service.saveCredentials('keystay', VALUES, ['own']))).resolves.toEqual({
        code: 'PROVIDER_ERROR',
        message: "Couldn't check these details. Try again.",
        issues: undefined,
      });
      expect(secretRows()).toEqual([]);
      expect(repo.get('keystay')).toBeNull();
      expect(updates()).toEqual([]);
      expect(credentialsChanged).not.toHaveBeenCalled();
    });

    it('a signIn that throws is PROVIDER_ERROR, and its message (which quotes the value) is never logged', async () => {
      registry = new ProviderRegistry();
      keystay = registerKeyStay({
        signIn: (values) => {
          throw new Error(`bad number ${values.memberNumber}`);
        },
      });
      build();

      await expect(
        refusal(service.saveCredentials('keystay', VALUES, ['own']))
      ).resolves.toMatchObject({
        code: 'PROVIDER_ERROR',
      });
      expect(everything()).not.toContain(NUMBER);
      expect(secretRows()).toEqual([]);
    });

    it('the check is bounded by the probe limit, even when the provider ignores its signal', async () => {
      registry = new ProviderRegistry();
      keystay = registerKeyStay({ signIn: () => new Promise<AccountStatus>(() => undefined) });
      build({ probeTimeoutMs: 20 });

      await expect(
        refusal(service.saveCredentials('keystay', VALUES, ['own']))
      ).resolves.toMatchObject({
        code: 'PROVIDER_ERROR',
      });
      expect(secretRows()).toEqual([]);
    });

    it('saves for a provider are one at a time: the second waits for the first', async () => {
      registry = new ProviderRegistry();
      const gates: Array<() => void> = [];
      keystay = registerKeyStay({
        signIn: () =>
          new Promise<AccountStatus>((resolve) =>
            gates.push(() => resolve({ state: 'signed-in' }))
          ),
      });
      build();

      const first = service.saveCredentials('keystay', VALUES, ['own']);
      const second = service.saveCredentials('keystay', { ...VALUES, memberNumber: '012345678' }, [
        'own',
      ]);
      await later();
      expect(gates).toHaveLength(1);

      gates[0]();
      await first;
      await later();
      expect(gates).toHaveLength(2);
      gates[1]();
      await second;
      await expect(keystay.ctx!.secrets.get('account.memberNumber')).resolves.toBe('012345678');
    });

    it('a save the provider answers after quit stores nothing: "WA Stay is closing; nothing was saved."', async () => {
      registry = new ProviderRegistry();
      let answer!: () => void;
      keystay = registerKeyStay({
        signIn: () =>
          new Promise<AccountStatus>((resolve) => {
            answer = () => resolve({ state: 'signed-in' });
          }),
      });
      build();

      const saving = refusal(service.saveCredentials('keystay', VALUES, ['own']));
      await later();
      service.dispose();
      answer();

      await expect(saving).resolves.toEqual({
        code: 'INTERNAL',
        message: 'WA Stay is closing; nothing was saved.',
        issues: undefined,
      });
      expect(secretRows()).toEqual([]);
      expect(repo.get('keystay')).toBeNull();
      expect(updates()).toEqual([]);
      expect(credentialsChanged).not.toHaveBeenCalled();
    });

    it('a vault that is not ready fails the save with INTERNAL (nothing stored) and reads as not saved, with one warning per key', async () => {
      registry = new ProviderRegistry();
      let ready = false;
      const fake = new FakeSecretVault();
      const notReady = () => {
        if (!ready) throw new SecretVaultNotReadyError();
      };
      keystay = registerKeyStay({
        vault: {
          encrypt: (text) => (notReady(), fake.encrypt(text)),
          decrypt: (text) => (notReady(), fake.decrypt(text)),
        },
      });
      build();

      await expect(refusal(service.saveCredentials('keystay', VALUES, ['own']))).resolves.toEqual({
        code: 'INTERNAL',
        message: "Couldn't save your details on this computer. Try again.",
        issues: undefined,
      });
      expect(secretRows()).toEqual([]);
      expect(credentialsChanged).not.toHaveBeenCalled();
      expect(updates()).toEqual([]);

      ready = true;
      await service.saveCredentials('keystay', VALUES, ['own']);
      ready = false;
      for (let i = 0; i < 2; i++) {
        expect((await service.list()).find((a) => a.providerId === 'keystay')).toMatchObject({
          status: 'signed-out',
          savedFields: [],
        });
      }

      const warnings = logger.lines.filter((l) => l.level === 'warn').map((l) => l.message);
      expect(warnings).toEqual([
        'Account keystay: the details could not be stored (SecretVaultNotReadyError)',
        "Account keystay: the saved memberNumber can't be read; it counts as not saved",
        "Account keystay: the saved password can't be read; it counts as not saved",
      ]);
      expect(everything()).not.toContain(NUMBER);
    });

    it('a failure part-way through leaves no half-saved set: the values already written are deleted', async () => {
      await service.saveCredentials('keystay', VALUES, ['own']);
      registry = new ProviderRegistry();
      let encrypts = 0;
      const fake = new FakeSecretVault();
      keystay = registerKeyStay({
        vault: {
          encrypt: (text) => {
            if (++encrypts === 2) throw new Error('disk full');
            return fake.encrypt(text);
          },
          decrypt: (text) => fake.decrypt(text),
        },
      });
      build();

      await expect(
        refusal(
          service.saveCredentials('keystay', { memberNumber: '012345678', password: 'x-1' }, [
            'own',
          ])
        )
      ).resolves.toMatchObject({ code: 'INTERNAL' });

      expect(secretRows()).toEqual([]);
      expect(service.storedState('keystay')).toBe('signed-out');
      expect(credentialsChanged.mock.calls).toEqual([['keystay'], ['keystay']]);
    });

    it('a saved value that cannot be read counts as not saved, with one warning naming the key only', async () => {
      await service.saveCredentials('keystay', VALUES, ['own']);
      events.emit.mockClear();
      state.set('keystay', 'secret:account.memberNumber', 'not-a-vault-envelope');

      const listed = (await service.list()).find((a) => a.providerId === 'keystay');
      expect(listed).toMatchObject({ status: 'signed-out', savedFields: ['password'] });
      // status() brings the stored row in line, once
      await expect(service.status('keystay')).resolves.toMatchObject({ status: 'signed-out' });
      await service.status('keystay');
      expect(service.storedState('keystay')).toBe('signed-out');
      expect(updates()).toHaveLength(1);
      await expect(refusal(service.copyCredential('keystay', 'memberNumber'))).resolves.toEqual({
        code: 'INTERNAL',
        message: "Couldn't read your saved Member number. Add it again.",
        issues: undefined,
      });

      const warnings = logger.lines.filter((l) => l.level === 'warn').map((l) => l.message);
      expect(warnings).toEqual([
        "Account keystay: the saved memberNumber can't be read; it counts as not saved",
      ]);
      expect(clipboard.writeText).not.toHaveBeenCalled();
    });

    it('copyCredential writes a saved copyable value to the clipboard once, and answers nothing', async () => {
      await service.saveCredentials('keystay', VALUES, ['own']);

      await expect(service.copyCredential('keystay', 'memberNumber')).resolves.toBeUndefined();

      expect(clipboard.writeText.mock.calls).toEqual([[NUMBER]]);
      expect(JSON.stringify(logger.lines)).not.toContain(NUMBER);
    });

    it('copyCredential refuses a field that is not copyable, not declared, or not saved', async () => {
      await expect(refusal(service.copyCredential('keystay', 'memberNumber'))).resolves.toEqual({
        code: 'NOT_FOUND',
        message: 'No Member number is saved',
        issues: undefined,
      });
      await service.saveCredentials('keystay', VALUES, ['own']);
      await expect(refusal(service.copyCredential('keystay', 'password'))).resolves.toEqual({
        code: 'VALIDATION',
        message: "Password can't be copied",
        issues: ['key'],
      });
      await expect(refusal(service.copyCredential('keystay', 'pin'))).resolves.toMatchObject({
        code: 'VALIDATION',
        issues: ['key'],
      });
      expect(clipboard.writeText).not.toHaveBeenCalled();
    });

    it('a browser-session provider is VALIDATION; unknown is UNKNOWN_PROVIDER; no account is CAPABILITY; no sign-in window', async () => {
      await expect(refusal(service.saveCredentials('parkstay', {}, []))).resolves.toEqual({
        code: 'VALIDATION',
        message: "ParkStay doesn't use saved details",
        issues: ['providerId'],
      });
      await expect(service.copyCredential('parkstay', 'x')).rejects.toMatchObject({
        code: 'VALIDATION',
      });
      await expect(service.saveCredentials('nope', {}, [])).rejects.toBeInstanceOf(
        UnknownProviderError
      );
      await expect(service.saveCredentials('noacct', {}, [])).rejects.toBeInstanceOf(
        ProviderCapabilityError
      );
      expect(() => service.signIn('keystay')).toThrow(
        expect.objectContaining({ code: 'NOT_IMPLEMENTED' })
      );
      expect(() => service.openSignInLink('keystay', 'https://keystay.example/x')).toThrow(
        expect.objectContaining({ code: 'NOT_IMPLEMENTED' })
      );
      expect(windows.windows).toHaveLength(0);
    });

    it('a failing change hook is logged by name and never fails the save', async () => {
      credentialsChanged.mockImplementation(() => {
        throw new Error(`hook saw ${NUMBER}`);
      });
      await expect(service.saveCredentials('keystay', VALUES, ['own'])).resolves.toMatchObject({
        status: 'signed-in',
      });
      credentialsChanged.mockImplementation(() => Promise.reject(new Error('later')));
      await service.signOut('keystay');
      await settle();

      const warnings = logger.lines.filter((l) => l.level === 'warn').map((l) => l.message);
      expect(warnings).toEqual([
        'Account keystay: the change hook failed (Error)',
        'Account keystay: the change hook failed (Error)',
      ]);
    });
  });
});
