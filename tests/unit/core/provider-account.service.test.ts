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
import { ProviderAccountRepository } from '@main/database/repositories';
import {
  ProviderAccountService,
  type AccountTimings,
} from '@main/core/accounts/provider-account.service';
import type { ProviderSessionStore } from '@main/core/accounts/ports';
import { ProviderRegistry } from '@main/providers/registry';
import {
  ProviderAuthRequiredError,
  ProviderCapabilityError,
  toApiError,
  UnknownProviderError,
} from '@main/providers/sdk';
import { PARKSTAY_SIGN_IN_COMPLETE } from '@main/providers/parkstay/auth';
import { AppError } from '@main/utils/app-error';
import type { ProviderAccount } from '@shared/types/provider.types';
import {
  createFakeProvider,
  createMemoryLogger,
  createTestProviderContext,
  type FakeProvider,
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
      events,
      isBusy: (_providerId, now) => {
        busyAsked.push(now);
        return busy;
      },
      logger: createMemoryLogger(),
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
    build();
  });

  afterEach(() => {
    service.dispose();
    jest.useRealTimers();
    closeDatabase(db);
  });

  describe('list and status', () => {
    it('lists only providers with accounts, from the stored rows, without asking anyone', () => {
      expect(service.list()).toEqual([
        { providerId: 'parkstay', requirement: 'optional', status: 'unknown' },
      ]);
      repo.upsert({ providerId: 'parkstay', status: 'signed-out', email: 'hint@example.com' });
      expect(service.list()).toEqual([
        {
          providerId: 'parkstay',
          requirement: 'optional',
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
});
