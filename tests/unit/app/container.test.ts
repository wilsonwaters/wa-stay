/**
 * Composition root: every service is built once, with shared instances; nothing is a
 * singleton (two containers share nothing); dispose cuts the renderer off, stops the
 * scheduler, disposes the providers (ParkStay's queue gate with them), then closes the
 * database. Watches and snipes get the registry's ParkStay provider. The container registers
 * every built-in provider by default, or only the `providerFactories` it is given; the tests
 * about ParkStay pin `[parkstayFactory]`, so they hold however many providers are built in.
 * The SecretVault is
 * shared by every consumer, including each provider's ScopedSecretVault, and building the
 * container on a fresh install does not touch `safeStorage` or read the machine id.
 */

import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { machineIdSync } from 'node-machine-id';
import { openDatabase } from '@main/database/connection';
import { createContainer, AppContainer } from '@main/app/container';
import * as repositories from '@main/database/repositories';
import { ProviderAccountService } from '@main/core/accounts/provider-account.service';
import { ProviderWindows } from '@main/app/provider-windows';
import { BookingService } from '@main/core/bookings/booking.service';
import { HoldPaymentService } from '@main/core/holds/hold-payment.service';
import { NotificationDispatcher } from '@main/core/notifications/notification-dispatcher';
import { NotificationService } from '@main/core/notifications/notification.service';
import { SmtpEmailNotifier } from '@main/core/notifications/notifiers/email-smtp.notifier';
import { SiteSniperService } from '@main/core/snipes/snipe.service';
import { AutoUpdaterService } from '@main/services/updater/auto-updater.service';
import { ProviderRegistry } from '@main/providers/registry';
import { WatchService } from '@main/core/watches/watch.service';
import { LocationCatalogService } from '@main/core/catalog/location-catalog.service';
import { JobScheduler } from '@main/scheduler/job-scheduler';
import { RendererEvents } from '@main/ipc/events';
import { TrustedWebContents } from '@main/ipc/trusted-web-contents';
import { BUILT_IN_PROVIDERS } from '@main/providers';
import { parkstayFactory } from '@main/providers/parkstay';
import {
  createProviderContext,
  type ProviderContextDeps,
  type ProviderFactory,
} from '@main/providers/sdk';
import { SecretVault } from '@main/security/secret-vault';
import { TEST_LOGS_DIR } from '@tests/utils/ipc-harness';
import { containerSecrets, FakeSafeStorage, removeUserData } from '@tests/utils/fake-safe-storage';
import { createFakeProvider, testManifest } from '@tests/utils/fake-provider';
import { SnipeReleaseMode, SnipeStatus } from '@shared/types/common.types';
import { createMockSiteSnipeInput } from '@tests/fixtures/site-sniper';
import { createMockWatchInput } from '@tests/fixtures/watches';

jest.mock('electron', () => ({
  app: { getAppPath: () => '/app', getPath: () => '/tmp', isPackaged: false },
  Notification: jest.fn(),
  shell: { openExternal: jest.fn(), openPath: jest.fn() },
  powerMonitor: { on: jest.fn(), removeListener: jest.fn() },
  session: {
    fromPartition: jest.fn(() => jest.requireActual('@tests/utils/electron-mocks').fakeSession()),
  },
}));
jest.mock('electron-updater', () => {
  const { EventEmitter } = jest.requireActual('events');
  return { autoUpdater: new EventEmitter() };
});
jest.mock('node-machine-id', () => ({ machineIdSync: jest.fn(() => 'test-machine-id') }));

/**
 * Replaces each exported class of a module with a jest.fn that constructs the real class,
 * so the test can count constructions and see the arguments, and still gets real instances.
 */
function mockCountedModule(modulePath: string): Record<string, unknown> {
  const actual = jest.requireActual(modulePath) as Record<string, unknown>;
  const counted: Record<string, unknown> = { ...actual };
  for (const [name, value] of Object.entries(actual)) {
    if (typeof value === 'function' && /^[A-Z]/.test(name) && value.prototype) {
      const Real = value as new (...args: unknown[]) => unknown;
      counted[name] = jest.fn((...args: unknown[]) => new Real(...args));
    }
  }
  return counted;
}

jest.mock('@main/database/repositories', () => mockCountedModule('@main/database/repositories'));
jest.mock('@main/core/accounts/provider-account.service', () =>
  mockCountedModule('@main/core/accounts/provider-account.service')
);
jest.mock('@main/app/provider-windows', () => mockCountedModule('@main/app/provider-windows'));
jest.mock('@main/core/bookings/booking.service', () =>
  mockCountedModule('@main/core/bookings/booking.service')
);
jest.mock('@main/core/holds/hold-payment.service', () =>
  mockCountedModule('@main/core/holds/hold-payment.service')
);
jest.mock('@main/core/notifications/notification-dispatcher', () =>
  mockCountedModule('@main/core/notifications/notification-dispatcher')
);
jest.mock('@main/core/notifications/notification.service', () =>
  mockCountedModule('@main/core/notifications/notification.service')
);
jest.mock('@main/core/notifications/notifiers/email-smtp.notifier', () =>
  mockCountedModule('@main/core/notifications/notifiers/email-smtp.notifier')
);
jest.mock('@main/core/snipes/snipe.service', () =>
  mockCountedModule('@main/core/snipes/snipe.service')
);
jest.mock('@main/services/updater/auto-updater.service', () =>
  mockCountedModule('@main/services/updater/auto-updater.service')
);
jest.mock('@main/core/watches/watch.service', () =>
  mockCountedModule('@main/core/watches/watch.service')
);
jest.mock('@main/scheduler/job-scheduler', () =>
  mockCountedModule('@main/scheduler/job-scheduler')
);
jest.mock('@main/core/catalog/location-catalog.service', () =>
  mockCountedModule('@main/core/catalog/location-catalog.service')
);
jest.mock('@main/ipc/events', () => mockCountedModule('@main/ipc/events'));
jest.mock('@main/ipc/trusted-web-contents', () =>
  mockCountedModule('@main/ipc/trusted-web-contents')
);
jest.mock('@main/providers/registry', () => mockCountedModule('@main/providers/registry'));
jest.mock('@main/security/secret-vault', () => mockCountedModule('@main/security/secret-vault'));
// createProviderContext is recorded, so a test can see the deps each provider got
jest.mock('@main/providers/sdk', () => {
  const actual = jest.requireActual('@main/providers/sdk');
  return { ...actual, createProviderContext: jest.fn(actual.createProviderContext) };
});

const CONSTRUCTED_ONCE = {
  UserRepository: repositories.UserRepository,
  BookingRepository: repositories.BookingRepository,
  SettingsRepository: repositories.SettingsRepository,
  NotifierRepository: repositories.NotifierRepository,
  NotificationRepository: repositories.NotificationRepository,
  WatchRepository: repositories.WatchRepository,
  SiteSniperRepository: repositories.SiteSniperRepository,
  ProviderStateRepository: repositories.ProviderStateRepository,
  ProviderAccountRepository: repositories.ProviderAccountRepository,
  LocationRepository: repositories.LocationRepository,
  // One per provider; `build` registers ParkStay alone unless told otherwise
  SqliteKeyValueStore: repositories.SqliteKeyValueStore,
  ProviderAccountService,
  ProviderWindows,
  HoldPaymentService,
  BookingService,
  NotificationDispatcher,
  NotificationService,
  SmtpEmailNotifier,
  SiteSniperService,
  AutoUpdaterService,
  WatchService,
  LocationCatalogService,
  JobScheduler,
  RendererEvents,
  TrustedWebContents,
  ProviderRegistry,
  SecretVault,
};

describe('createContainer', () => {
  const opened: AppContainer[] = [];
  const userDataDirs: string[] = [];

  /** A container with ParkStay alone, unless `providers` says otherwise ('built-in': the default). */
  function build(
    safeStorage: FakeSafeStorage = new FakeSafeStorage(),
    providers: readonly ProviderFactory[] | 'built-in' = [parkstayFactory]
  ): {
    container: AppContainer;
    db: Database.Database;
    userDataDir: string;
  } {
    const db = openDatabase(':memory:');
    const secrets = containerSecrets(safeStorage);
    userDataDirs.push(secrets.userDataDir);
    const container = createContainer({
      db,
      logsDir: TEST_LOGS_DIR,
      ...secrets,
      ...(providers === 'built-in' ? {} : { providerFactories: providers }),
    });
    opened.push(container);
    return { container, db, userDataDir: secrets.userDataDir };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(opened.splice(0).map((c) => c.dispose()));
    userDataDirs.splice(0).forEach(removeUserData);
  });

  it('builds every repository, service, notifier, dispatcher, scheduler and updater exactly once', () => {
    const { container } = build();

    for (const [name, ctor] of Object.entries(CONSTRUCTED_ONCE)) {
      expect({ name, calls: jest.mocked(ctor).mock.calls.length }).toEqual({ name, calls: 1 });
    }

    // The single instances are the ones injected into their dependants.
    const r = container.repositories;
    // Core services resolve providers through the registry (no provider is wired in).
    expect(WatchService).toHaveBeenCalledWith(
      expect.objectContaining({
        watches: r.watches,
        providers: container.providers,
        notifications: container.notificationService,
        events: container.rendererEvents,
      })
    );
    expect(SiteSniperService).toHaveBeenCalledWith(
      expect.objectContaining({
        snipes: r.snipes,
        providers: container.providers,
        notifications: container.notificationService,
        events: container.rendererEvents,
        // The account gate (only providers whose holds need an account use it)
        accounts: container.accounts,
      })
    );
    // Payment windows open through the one ProviderWindows, and record bookings through the
    // booking service in one database transaction
    expect(HoldPaymentService).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: container.providers,
        snipes: r.snipes,
        watches: r.watches,
        bookings: container.bookingService,
        notifications: container.notificationService,
        windows: container.providerWindows,
        events: container.rendererEvents,
        transaction: expect.any(Function),
        onWindowClosed: expect.any(Function),
      })
    );
    expect(jest.mocked(HoldPaymentService).mock.results[0].value).toBe(container.holdPayments);
    // The watch and snipe services share one night guard
    const [[watchDeps]] = jest.mocked(WatchService).mock.calls;
    const [[snipeDeps]] = jest.mocked(SiteSniperService).mock.calls;
    expect(watchDeps.nightGuard).toBe(snipeDeps.nightGuard);
    expect(BookingService).toHaveBeenCalledWith({
      bookings: r.bookings,
      providers: container.providers,
      events: container.rendererEvents,
    });
    expect(NotificationService).toHaveBeenCalledWith(
      r.notifications,
      container.notifierDispatcher,
      container.rendererEvents,
      { providerName: expect.any(Function), preferences: expect.any(Function) }
    );
    const [, , , notificationOptions] = jest.mocked(NotificationService).mock.calls[0];
    expect(notificationOptions?.providerName?.('parkstay')).toBe('ParkStay');
    // Settings → Notifications, read from the stored settings (defaults while none stored)
    expect(notificationOptions?.preferences?.()).toEqual({ desktop: true, sound: true });
    expect(AutoUpdaterService).toHaveBeenCalledWith(container.rendererEvents);
    // The catalogue reads the registry, caches in locations and provider_state, and announces
    // syncs on the renderer events bus
    expect(LocationCatalogService).toHaveBeenCalledWith(
      expect.objectContaining({
        registry: container.providers,
        locations: r.locations,
        providerState: r.providerState,
        events: container.rendererEvents,
        isReleaseInProgress: expect.any(Function),
      })
    );
    expect(jest.mocked(LocationCatalogService).mock.results[0].value).toBe(
      container.catalogService
    );
    expect(RendererEvents).toHaveBeenCalledWith(container.trustedWebContents);
    // Accounts ask the registry's providers, keep provider_accounts, and open their windows
    // (and clear their sessions) through the one ProviderWindows
    expect(ProviderWindows).toHaveBeenCalledWith({ devTools: true });
    expect(jest.mocked(ProviderWindows).mock.results[0].value).toBe(container.providerWindows);
    expect(ProviderAccountService).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: container.providers,
        accounts: r.providerAccounts,
        windows: container.providerWindows,
        sessions: container.providerWindows,
        events: container.rendererEvents,
        isBusy: expect.any(Function),
      })
    );
    expect(jest.mocked(ProviderAccountService).mock.results[0].value).toBe(container.accounts);
    expect(JobScheduler).toHaveBeenCalledWith({
      watches: container.watchService,
      snipes: container.siteSniperService,
      providers: container.providers,
      power: expect.objectContaining({ on: expect.any(Function) }),
      retention: { notifications: r.notifications, notifiers: r.notifiers, settings: r.settings },
    });
    expect(NotificationDispatcher).toHaveBeenCalledWith(r.notifiers, [
      jest.mocked(SmtpEmailNotifier).mock.results[0].value,
    ]);

    // One vault, shared by every consumer of secrets
    const vault = container.vault;
    expect(jest.mocked(SecretVault).mock.results[0].value).toBe(vault);
    expect(repositories.NotifierRepository).toHaveBeenCalledWith(container.db, vault);
    expect(jest.mocked(createProviderContext).mock.calls[0][1].vault).toBe(vault);
    expect(repositories.SqliteKeyValueStore).toHaveBeenCalledWith(r.providerState, 'parkstay');
  });

  it('builds the vault lazily: a fresh install touches neither safeStorage nor the key file, nor reads the machine id', () => {
    const safeStorage = new FakeSafeStorage();
    const { container, userDataDir } = build(safeStorage);

    expect(safeStorage.calls).toEqual([]);
    expect(machineIdSync).not.toHaveBeenCalled(); // only needed for a legacy value
    expect(fs.existsSync(path.join(userDataDir, 'secret-vault.key'))).toBe(false);
    expect(container.vault.status()).toEqual({ backend: 'os' }); // first use
  });

  it("gives each provider a ScopedSecretVault on the app's vault, namespaced per provider", async () => {
    const { container } = build();
    const parkstay = jest.mocked(createProviderContext).mock.results[0].value;
    expect(parkstay.id).toBe('parkstay');

    await parkstay.secrets.set('token', 'parkstay-token-value');
    const stored = await parkstay.state.get<string>('secret:token');
    expect(stored).toMatch(/^vault:v1:os:/);
    expect(stored).not.toContain('parkstay-token-value');
    expect(container.vault.decrypt(stored as string)).toContain('parkstay-token-value');
    await expect(parkstay.secrets.get('token')).resolves.toBe('parkstay-token-value');

    // Another provider built with the same deps has its own store, and the ParkStay
    // ciphertext copied into it does not read as its secret
    const deps = jest.mocked(createProviderContext).mock.calls[0][1] as ProviderContextDeps;
    const other = createProviderContext(testManifest('fake2'), deps);
    await expect(other.secrets.get('token')).resolves.toBeUndefined();
    await other.state.set('secret:token', stored);
    await expect(other.secrets.get('token')).rejects.toThrow(
      'Secret "token" was not written by fake2'
    );
  });

  it('gives each provider its state on provider_state, scoped to it and persistent', async () => {
    const { db } = build();
    const state = jest.mocked(repositories.SqliteKeyValueStore).mock.results[0]
      .value as repositories.SqliteKeyValueStore;

    await state.set('release.cache', { opensAt: '2026-12-13' });

    expect(db.prepare('SELECT provider_id, key, value FROM provider_state').all()).toEqual([
      { provider_id: 'parkstay', key: 'release.cache', value: '{"opensAt":"2026-12-13"}' },
    ]);
  });

  it('has no singletons: a second container shares no instance with the first', () => {
    const first = build().container;
    const second = build().container;

    expect(second.notificationService).not.toBe(first.notificationService);
    expect(second.scheduler).not.toBe(first.scheduler);
    expect(second.repositories.users).not.toBe(first.repositories.users);
    expect(
      'getInstance' in
        jest.requireActual('@main/core/notifications/notification.service').NotificationService
    ).toBe(false);
  });

  it('registers every built-in provider by default, each on its own session partition', () => {
    const { container } = build(undefined, 'built-in');
    const { session } = jest.requireMock('electron') as { session: { fromPartition: jest.Mock } };
    const ids = BUILT_IN_PROVIDERS.map((factory) => factory.id);

    expect(ids).toContain('parkstay');
    expect(
      container.providers
        .list()
        .map((m) => m.id)
        .sort()
    ).toEqual([...ids].sort());
    for (const id of ids) {
      expect(session.fromPartition).toHaveBeenCalledWith(`persist:provider-${id}`);
    }
  });

  it('registers only the providerFactories it is given, each on its own context and partition', () => {
    const fake = createFakeProvider({ id: 'fake2' });
    const { container } = build(undefined, [fake.factory]);
    const { session } = jest.requireMock('electron') as { session: { fromPartition: jest.Mock } };

    expect(container.providers.list().map((m) => m.id)).toEqual(['fake2']);
    expect(container.providers.tryGet('parkstay')).toBeUndefined();
    expect(container.providers.get('fake2').holds).toBe(fake.holds);
    expect(fake.ctx?.id).toBe('fake2');
    expect(repositories.SqliteKeyValueStore).toHaveBeenCalledTimes(1);
    expect(repositories.SqliteKeyValueStore).toHaveBeenCalledWith(
      container.repositories.providerState,
      'fake2'
    );
    expect(session.fromPartition).toHaveBeenCalledWith('persist:provider-fake2');
    expect(session.fromPartition).not.toHaveBeenCalledWith('persist:provider-parkstay');
  });

  describe('development hooks only from source (architecture-notes §12.34)', () => {
    const electronApp = (jest.requireMock('electron') as { app: Record<string, unknown> }).app;
    const original = { ...electronApp };
    const browserPath = () =>
      (jest.mocked(createProviderContext).mock.calls[0][1] as ProviderContextDeps)
        .browserExecutablePath;

    beforeEach(() => {
      process.env.WA_STAY_BROWSER_PATH = '/opt/chromium/chrome';
    });

    afterEach(() => {
      Object.assign(electronApp, original);
      delete process.env.WA_STAY_BROWSER_PATH;
    });

    it('from source: WA_STAY_BROWSER_PATH reaches the providers and provider windows allow devTools', () => {
      build();
      expect(browserPath()).toBe('/opt/chromium/chrome');
      expect(ProviderWindows).toHaveBeenCalledWith({ devTools: true });
    });

    it('a packaged build renamed to `electron` (unpackaged, loaded from app.asar) gets neither', () => {
      Object.assign(electronApp, {
        isPackaged: false,
        getAppPath: () => '/opt/WA Stay/resources/app.asar',
      });
      build();
      expect(browserPath()).toBeUndefined();
      expect(ProviderWindows).toHaveBeenCalledWith({ devTools: false });
    });

    it('a packaged build gets neither', () => {
      Object.assign(electronApp, {
        isPackaged: true,
        getAppPath: () => '/opt/WA Stay/resources/app.asar',
      });
      // The packaged email logo is read from `resources`
      const proc = process as { resourcesPath?: string };
      const resourcesPath = proc.resourcesPath;
      proc.resourcesPath = '/opt/WA Stay/resources';
      try {
        build();
      } finally {
        proc.resourcesPath = resourcesPath;
      }
      expect(browserPath()).toBeUndefined();
      expect(ProviderWindows).toHaveBeenCalledWith({ devTools: false });
    });
  });

  it("gives the email notifier the providers' names and the small WA Stay email logo", () => {
    build();

    const [options] = jest.mocked(SmtpEmailNotifier).mock.calls[0];
    expect(options?.logoPath).toBe(path.join('/app', 'resources', 'icons', 'email-logo.png'));
    expect(options?.providerName?.('parkstay')).toBe('ParkStay');
    expect(options?.providerName?.('not-a-provider')).toBeUndefined();
  });

  it('the catalogue waits for its automatic sync while a snipe of that provider is queueing or sniping', () => {
    const { container } = build();
    const userId = container.profile.ensureLocalProfile();
    const [{ isReleaseInProgress }] = jest.mocked(LocationCatalogService).mock.calls[0];
    const snipes = container.repositories.snipes;
    const snipe = snipes.create(userId, createMockSiteSnipeInput({ providerId: 'parkstay' }));

    expect(isReleaseInProgress?.('parkstay')).toBe(false);
    snipes.updateStatus(snipe.id, SnipeStatus.QUEUEING);
    expect(isReleaseInProgress?.('parkstay')).toBe(true);
    expect(isReleaseInProgress?.('other')).toBe(false);
    snipes.updateStatus(snipe.id, SnipeStatus.SNIPING);
    expect(isReleaseInProgress?.('parkstay')).toBe(true);
    snipes.updateStatus(snipe.id, SnipeStatus.HELD);
    expect(isReleaseInProgress?.('parkstay')).toBe(false);
    // Waiting for its release (queue held open) counts too
    snipes.updateStatus(snipe.id, SnipeStatus.WAITING_RELEASE);
    expect(isReleaseInProgress?.('parkstay')).toBe(true);
  });

  it('a cancellation snipe, which polls for weeks, does not hold the catalogue sync back', () => {
    const { container } = build();
    const userId = container.profile.ensureLocalProfile();
    const [{ isReleaseInProgress }] = jest.mocked(LocationCatalogService).mock.calls[0];
    const snipes = container.repositories.snipes;
    const snipe = snipes.create(
      userId,
      createMockSiteSnipeInput({
        providerId: 'parkstay',
        releaseMode: SnipeReleaseMode.CANCELLATION,
      })
    );

    snipes.updateStatus(snipe.id, SnipeStatus.SNIPING);
    expect(isReleaseInProgress?.('parkstay')).toBe(false);
  });

  it('a provider account is busy while a snipe queues, snipes or holds, or a watch hold is unexpired', () => {
    const { container, db } = build();
    const userId = container.profile.ensureLocalProfile();
    const [{ isBusy }] = jest.mocked(ProviderAccountService).mock.calls[0];
    const snipes = container.repositories.snipes;
    const snipe = snipes.create(userId, createMockSiteSnipeInput({ providerId: 'parkstay' }));
    // The account service passes its own clock
    const now = new Date();
    const busy = (providerId: string, at: Date = now) => isBusy(providerId, at);

    expect(busy('parkstay')).toBe(false);
    for (const status of [SnipeStatus.QUEUEING, SnipeStatus.SNIPING, SnipeStatus.HELD]) {
      snipes.updateStatus(snipe.id, status);
      expect([status, busy('parkstay'), busy('other')]).toEqual([status, true, false]);
    }
    for (const status of [SnipeStatus.ARMED, SnipeStatus.WAITING_RELEASE, SnipeStatus.BOOKED]) {
      snipes.updateStatus(snipe.id, status);
      expect([status, busy('parkstay')]).toEqual([status, false]);
    }

    // A watch's hold (migration v9 columns) counts until it expires
    const watch = container.repositories.watches.create(
      userId,
      createMockWatchInput({ providerId: 'parkstay' })
    );
    const holdUntil = (expiresAt: Date) =>
      db
        .prepare(
          "UPDATE watches SET last_result = 'held', hold_reference = '41', hold_expires_at = ? WHERE id = ?"
        )
        .run(expiresAt.toISOString(), watch.id);
    holdUntil(new Date(now.getTime() + 10 * 60_000));
    expect(busy('parkstay')).toBe(true);
    // At the clock it is given, not the wall clock
    expect(busy('parkstay', new Date(now.getTime() + 11 * 60_000))).toBe(false);
    holdUntil(new Date(now.getTime() - 60_000));
    expect(busy('parkstay')).toBe(false);
  });

  it('a closed payment window checks the provider account once; transactions are real', () => {
    const { container, db } = build();
    const [[deps]] = jest.mocked(HoldPaymentService).mock.calls;
    const recheck = jest.spyOn(container.accounts, 'recheck').mockResolvedValue(undefined);

    deps.onWindowClosed?.('parkstay');
    expect(recheck).toHaveBeenCalledWith('parkstay');

    // A throw inside rolls every write back
    const before = db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number };
    expect(() =>
      deps.transaction(() => {
        db.prepare(
          "INSERT INTO settings (key, value, value_type, category) VALUES ('t', 'x', 'string', 't')"
        ).run();
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(db.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual(before);
  });

  it('dispose disposes the providers before the database closes', async () => {
    const { container, db } = build();
    const disposeAll = jest.spyOn(container.providers, 'disposeAll');
    const close = jest.spyOn(db, 'close');

    const first = container.dispose();
    expect(container.dispose()).toBe(first);
    await first;

    expect(disposeAll).toHaveBeenCalledTimes(1);
    expect(disposeAll.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
    expect(container.providers.list()).toEqual([]);
  });

  it("dispose cuts the renderer off, stops the accounts and closes their windows, stops the scheduler, disposes ParkStay's queue gate, then closes the database, once", async () => {
    const { container, db } = build();
    const revoke = jest.spyOn(container.trustedWebContents, 'revokeAll');
    const stopAccounts = jest.spyOn(container.accounts, 'dispose');
    const stopPayments = jest.spyOn(container.holdPayments, 'dispose');
    const closeWindows = jest.spyOn(container.providerWindows, 'closeAll');
    const stop = jest.spyOn(container.scheduler, 'stop');
    const stopCatalog = jest.spyOn(container.catalogService, 'stop');
    const gate = container.providers.get('parkstay').access!;
    const disposeGate = jest.spyOn(gate, 'dispose');
    const close = jest.spyOn(db, 'close');

    const disposing = container.dispose();
    void container.dispose();
    // The database closes only once the scheduler's jobs have settled
    expect(close).not.toHaveBeenCalled();
    await disposing;

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(disposeGate).toHaveBeenCalled();
    expect(revoke.mock.invocationCallOrder[0]).toBeLessThan(stop.mock.invocationCallOrder[0]);
    // Accounts stop first (pending sign-ins settle, nothing writes), then the windows close
    expect(stopAccounts).toHaveBeenCalledTimes(1);
    expect(closeWindows).toHaveBeenCalledTimes(1);
    expect(revoke.mock.invocationCallOrder[0]).toBeLessThan(
      stopAccounts.mock.invocationCallOrder[0]
    );
    expect(stopAccounts.mock.invocationCallOrder[0]).toBeLessThan(
      closeWindows.mock.invocationCallOrder[0]
    );
    // A payment window's last pages record nothing once the windows are closing
    expect(stopPayments).toHaveBeenCalledTimes(1);
    expect(stopPayments.mock.invocationCallOrder[0]).toBeLessThan(
      closeWindows.mock.invocationCallOrder[0]
    );
    expect(closeWindows.mock.invocationCallOrder[0]).toBeLessThan(
      close.mock.invocationCallOrder[0]
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(disposeGate.mock.invocationCallOrder[0]);
    // A catalogue sync in flight is aborted before the database closes
    expect(stopCatalog).toHaveBeenCalledTimes(1);
    expect(stopCatalog.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
    expect(disposeGate.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[0]);
    expect(db.open).toBe(false);
  });
});
