/**
 * Composition root.
 *
 * Builds every repository, service, notifier, dispatcher, scheduler and updater exactly once
 * and wires them together by constructor injection. This is the only
 * place in `src/main` that constructs them: anything else receives what it needs from the
 * container. Main → renderer events go through `rendererEvents`, which reaches only the
 * webContents registered in `trustedWebContents` (the main window registers itself).
 *
 * Secrets: the SecretVault is built first, then `migrateLegacySecrets` turns any v1.x
 * ciphertexts into vault envelopes before anything reads a secret (the dispatcher loads
 * notifier configs as it is built). That is the vault's first use, so `createContainer`
 * must run after `ready` and after the final userData path is set (architecture-notes
 * §12.23; see `security/secret-vault.ts`).
 */

import path from 'path';
import type Database from 'better-sqlite3';
import { app, powerMonitor } from 'electron';
import { SnipeReleaseMode, SnipeStatus } from '@shared/types/common.types';
import { ProviderAccountService } from '../core/accounts/provider-account.service';
import { LocationCatalogService } from '../core/catalog/location-catalog.service';
import { closeDatabase } from '../database/connection';
import {
  BookingRepository,
  LocationRepository,
  NotifierRepository,
  NotificationRepository,
  ProviderAccountRepository,
  ProviderStateRepository,
  SettingsRepository,
  SiteSniperRepository,
  SqliteKeyValueStore,
  UserRepository,
  WatchRepository,
} from '../database/repositories';
import { BookingService } from '../core/bookings/booking.service';
import { HoldPaymentService } from '../core/holds/hold-payment.service';
import { NightGuard } from '../core/holds/night-guard';
import { NotificationDispatcher } from '../core/notifications/notification-dispatcher';
import {
  NotificationService,
  type NotificationPreferences,
} from '../core/notifications/notification.service';
import { SmtpEmailNotifier } from '../core/notifications/notifiers/email-smtp.notifier';
import { SiteSniperService } from '../core/snipes/snipe.service';
import { WatchService } from '../core/watches/watch.service';
import { AutoUpdaterService } from '../services/updater/auto-updater.service';
import { JobScheduler } from '../scheduler/job-scheduler';
import { RendererEvents } from '../ipc/events';
import { TrustedWebContents } from '../ipc/trusted-web-contents';
import { BUILT_IN_PROVIDERS, registerBuiltInProviders } from '../providers';
import { ProviderRegistry } from '../providers/registry';
import {
  createProviderContext,
  type ProviderContextDeps,
  type ProviderFactory,
} from '../providers/sdk';
import { ElectronSessionHttpClient } from '../providers/sdk/http-electron';
import { legacyMachineId } from '../security/legacy-decryptors';
import { migrateLegacySecrets, removeRetiredGmailStore } from '../security/legacy-migration';
import { FileLocalKeyStore, SecretVault, type SafeStorageLike } from '../security/secret-vault';
import { FixtureHttpClient, serveDocumentFixtures, type FixtureModeOptions } from '../testing';
import { logger } from '../utils/logger';
import { runsFromSource } from './app-source';
import { getEmailLogoPath } from './paths';
import { DocumentWindows } from './document-windows';
import { createLocalProfile, LocalProfile } from './profile';
import { ProviderWindows } from './provider-windows';
import { readSetting } from './settings-values';

/** A timed snipe in these statuses is in its release: the catalogue sync waits for it. */
const RELEASE_STATUSES: ReadonlySet<SnipeStatus> = new Set([
  SnipeStatus.QUEUEING,
  SnipeStatus.WAITING_RELEASE,
  SnipeStatus.SNIPING,
]);

export interface AppRepositories {
  readonly users: UserRepository;
  readonly bookings: BookingRepository;
  readonly settings: SettingsRepository;
  readonly notifiers: NotifierRepository;
  readonly notifications: NotificationRepository;
  readonly watches: WatchRepository;
  readonly snipes: SiteSniperRepository;
  /** Each provider's key-value state (`provider_state`). */
  readonly providerState: ProviderStateRepository;
  readonly providerAccounts: ProviderAccountRepository;
  /** The cached location catalogue (`locations` + FTS). */
  readonly locations: LocationRepository;
}

export interface AppContainer {
  readonly db: Database.Database;
  /** Where the log files are (`initFileLogging`); the `app` handlers open it. */
  readonly logsDir: string;
  readonly repositories: AppRepositories;
  /** Encrypts every stored secret (`safeStorage`, or the local key file as a fallback). */
  readonly vault: SecretVault;
  /** The webContents allowed to call IPC and to receive events. */
  readonly trustedWebContents: TrustedWebContents;
  readonly rendererEvents: RendererEvents;
  readonly profile: LocalProfile;
  /** The accommodation providers: `providerFactories`, by default the built-in ones. */
  readonly providers: ProviderRegistry;
  /** Every provider's locations: sync, search, detail and availability (`catalog.*`). */
  readonly catalogService: LocationCatalogService;
  readonly notifierDispatcher: NotificationDispatcher;
  /** Provider sign-in and payment windows, and their session partitions. */
  readonly providerWindows: ProviderWindows;
  /** A location's documents (ParkStay's campground map), in windows of their own. */
  readonly documentWindows: DocumentWindows;
  /** The person's account with each provider: status, in-app sign-in, sign-out. */
  readonly accounts: ProviderAccountService;
  /** Paying for a snipe's or watch's hold in a payment window (`*.openPayment`). */
  readonly holdPayments: HoldPaymentService;
  readonly bookingService: BookingService;
  readonly notificationService: NotificationService;
  readonly watchService: WatchService;
  readonly siteSniperService: SiteSniperService;
  readonly autoUpdater: AutoUpdaterService;
  readonly scheduler: JobScheduler;
  /**
   * Cuts the renderer off (no webContents is trusted any more, so no invoke reaches a
   * handler and no event is sent), stops the account and payment services and closes the
   * provider windows, stops the scheduler (aborting every check, attempt and retention run
   * in flight) and the catalogue service (aborting any sync in flight), and starts disposing
   * the providers (and with them ParkStay's queue gate), all before it returns. The
   * database closes once the scheduler's jobs have settled (at most
   * `SCHEDULER_STOP_GRACE_MS`), so no job writes to a closed database. The promise resolves
   * once the database is closed and every provider is disposed and its browser closed (each
   * browser gets at most 5 s, then is killed); it never rejects. Safe to call twice.
   */
  dispose(): Promise<void>;
}

export interface ContainerOptions {
  /** An open, migrated database (`openDatabase`). The container owns it from here: `dispose` closes it. */
  readonly db: Database.Database;
  /** The log folder returned by `initFileLogging` (`<userData>/logs`). */
  readonly logsDir: string;
  /**
   * The final userData folder: the vault's `secret-vault.key` lives here. B3 sets the path
   * before `ready`; it must not change afterwards.
   */
  readonly userDataDir: string;
  /** Electron's `safeStorage` (a fake in tests). Used lazily, never before `isReady()`. */
  readonly safeStorage: SafeStorageLike;
  /** `app.isReady()`. */
  readonly isReady: () => boolean;
  /**
   * Test-only (`startFixtureMode`, never when packaged): every provider gets a
   * `FixtureHttpClient` instead of its session partition.
   */
  readonly fixtureMode?: FixtureModeOptions;
  /**
   * The providers to register, each on its own context. Default: every built-in provider
   * (`BUILT_IN_PROVIDERS`). The app passes a subset only for the test-only `WA_STAY_PROVIDERS`
   * hook; tests pass the providers they are about.
   */
  readonly providerFactories?: readonly ProviderFactory[];
  /**
   * Brings the main window forward (restored, shown, focused) for a click on a desktop
   * notification; false when there is no window or the app is quitting.
   */
  readonly showMainWindow?: () => boolean;
}

export function createContainer({
  db,
  logsDir,
  userDataDir,
  safeStorage,
  isReady,
  fixtureMode,
  providerFactories = BUILT_IN_PROVIDERS,
  showMainWindow,
}: ContainerOptions): AppContainer {
  // Lazy: no safeStorage call and no key file until the first secret is read or written
  const vault = new SecretVault({
    safeStorage,
    platform: process.platform,
    localKey: new FileLocalKeyStore(path.join(userDataDir, 'secret-vault.key')),
    logger,
    isReady,
  });
  const providerState = new ProviderStateRepository(db);
  const repositories: AppRepositories = {
    users: new UserRepository(db),
    bookings: new BookingRepository(db),
    settings: new SettingsRepository(db),
    notifiers: new NotifierRepository(db, vault),
    notifications: new NotificationRepository(db),
    watches: new WatchRepository(db),
    snipes: new SiteSniperRepository(db),
    providerState,
    providerAccounts: new ProviderAccountRepository(db),
    locations: new LocationRepository(db),
  };

  // v1.x ciphertexts become vault envelopes before any secret is read (first vault use).
  // The machine id is read only if a machine-bound legacy value is found.
  migrateLegacySecrets({ db, vault, machineId: legacyMachineId });
  // The retired Gmail OTP sign-in (its OAuth client secret and inbox token) is deleted, not kept
  removeRetiredGmailStore(userDataDir);

  const profile = createLocalProfile(repositories.users);

  const trustedWebContents = new TrustedWebContents();
  const rendererEvents = new RendererEvents(trustedWebContents);

  // Development hooks (a browser override, DevTools in provider windows) only from source
  const fromSource = runsFromSource({ isPackaged: app.isPackaged, appPath: app.getAppPath() });

  // Each provider gets its own session partition, state, secrets and child logger.
  const providerDeps: ProviderContextDeps = {
    createHttp: (providerId) =>
      fixtureMode
        ? new FixtureHttpClient({ providerId, ...fixtureMode })
        : new ElectronSessionHttpClient({ providerId }),
    // `provider_state`, scoped to the provider; its scoped secrets live there too.
    createState: (providerId) => new SqliteKeyValueStore(providerState, providerId),
    // Each provider's ScopedSecretVault: envelopes from this vault, in the provider's own state
    vault,
    logger,
    // Each provider's browser profile is <userData>/providers/<id>/browser.
    providersDir: path.join(app.getPath('userData'), 'providers'),
    // Development only (§12.34): a packaged build always detects Edge or Chrome itself.
    browserExecutablePath: fromSource ? process.env.WA_STAY_BROWSER_PATH : undefined,
  };
  const providers = new ProviderRegistry({ logger });
  registerBuiltInProviders(providers, (manifest) => createProviderContext(manifest, providerDeps), {
    factories: providerFactories,
    logger,
  });

  const catalogService = new LocationCatalogService({
    registry: providers,
    locations: repositories.locations,
    providerState,
    events: rendererEvents,
    logger,
    // A catalogue fetch must not compete with a release in progress: a timed snipe from its
    // queue warm-up to the end of its window. A cancellation snipe polls for weeks, so it does
    // not hold the catalogue back.
    isReleaseInProgress: (providerId) =>
      repositories.snipes
        .findActive()
        .some(
          (snipe) =>
            snipe.providerId === providerId &&
            snipe.releaseMode !== SnipeReleaseMode.CANCELLATION &&
            RELEASE_STATUSES.has(snipe.status)
        ),
  });

  // Sign-in and payment windows share each provider's session partition with its HTTP client.
  const providerWindows = new ProviderWindows({ devTools: fromSource });
  // A location's documents, each on an in-memory partition of its provider's documents; in
  // fixture mode (from source only) those partitions answer from the fixtures
  const documentWindows = new DocumentWindows({
    devTools: fromSource,
    ...(fixtureMode
      ? {
          prepareSession: (ses, providerId) => serveDocumentFixtures(ses, providerId, fixtureMode),
        }
      : {}),
  });
  const accounts = new ProviderAccountService({
    providers,
    accounts: repositories.providerAccounts,
    windows: providerWindows,
    sessions: providerWindows,
    events: rendererEvents,
    // Signing out would lose a queue place, a hold being placed, or a hold awaiting payment.
    isBusy: (providerId, now) =>
      repositories.snipes.countByStatus(providerId, [
        SnipeStatus.QUEUEING,
        SnipeStatus.SNIPING,
        SnipeStatus.HELD,
      ]) > 0 || repositories.watches.countUnexpiredHolds(providerId, now) > 0,
    logger,
  });

  // A provider's short name (`ParkStay`), for emails and desktop notification titles
  const providerName = (id: string): string | undefined => providers.tryGet(id)?.manifest.shortName;
  const notifierDispatcher = new NotificationDispatcher(repositories.notifiers, [
    new SmtpEmailNotifier({ providerName, logoPath: getEmailLogoPath() }),
  ]);
  // Settings → Notifications, read on every notification (a change applies to the next one)
  const notificationPreferences = (): NotificationPreferences => ({
    desktop: readSetting(repositories.settings, 'notifications.desktop'),
    sound: readSetting(repositories.settings, 'notifications.sound'),
  });
  const notificationService = new NotificationService(
    repositories.notifications,
    notifierDispatcher,
    rendererEvents,
    { providerName, showMainWindow, preferences: notificationPreferences }
  );
  // Core services resolve every provider through the registry and its capabilities.
  const nightGuard = new NightGuard(repositories.snipes, repositories.watches);
  const bookingService = new BookingService({
    bookings: repositories.bookings,
    providers,
    events: rendererEvents,
  });
  const watchService = new WatchService({
    watches: repositories.watches,
    providers,
    notifications: notificationService,
    nightGuard,
    events: rendererEvents,
    // The stored (last definite) sign-in state; no network on the hold path
    accountState: (providerId) => accounts.storedState(providerId),
  });
  const siteSniperService = new SiteSniperService({
    snipes: repositories.snipes,
    providers,
    notifications: notificationService,
    nightGuard,
    events: rendererEvents,
    // Only for providers whose holds need an account (ParkStay's is optional)
    accounts,
  });
  const holdPayments = new HoldPaymentService({
    providers,
    snipes: repositories.snipes,
    watches: repositories.watches,
    bookings: bookingService,
    notifications: notificationService,
    windows: providerWindows,
    events: rendererEvents,
    transaction: (fn) => db.transaction(fn)(),
    // The person may have signed in on the payment page: check the account once
    onWindowClosed: (providerId) => void accounts.recheck(providerId),
    locations: repositories.locations,
    logger,
  });
  const autoUpdater = new AutoUpdaterService(rendererEvents);
  const scheduler = new JobScheduler({
    watches: watchService,
    snipes: siteSniperService,
    providers,
    power: powerMonitor,
    // Old notifications and delivery logs, 5 min after start, then daily
    retention: {
      notifications: repositories.notifications,
      notifiers: repositories.notifiers,
      settings: repositories.settings,
    },
  });

  let disposed: Promise<void> | null = null;
  const dispose = (): Promise<void> => {
    if (disposed) return disposed;
    // Nothing from the renderer may reach the database once it closes below.
    trustedWebContents.revokeAll();
    // No more account checks or writes, pending sign-ins settle, a payment window's pages
    // record nothing; then the windows go.
    accounts.dispose();
    holdPayments.dispose();
    providerWindows.closeAll();
    documentWindows.closeAll();
    // Aborts every job in flight at once; resolves when they settle (bounded).
    const stopping = scheduler.stop();
    // Aborts a catalogue sync in flight, so it writes nothing once the database closes.
    catalogService.stop();
    // Never rejects; each provider's dispose (its queue gate, its browser) starts now, in
    // parallel with the jobs settling, so both fit the quit hold.
    const providersClosing = providers.disposeAll();
    disposed = stopping
      .then(() => closeDatabase(db))
      .catch((error: unknown) => logger.error('Closing the database failed:', error))
      .then(() => providersClosing);
    return disposed;
  };

  return {
    db,
    logsDir,
    repositories,
    vault,
    trustedWebContents,
    rendererEvents,
    profile,
    providers,
    catalogService,
    notifierDispatcher,
    providerWindows,
    documentWindows,
    accounts,
    holdPayments,
    bookingService,
    notificationService,
    watchService,
    siteSniperService,
    autoUpdater,
    scheduler,
    dispose,
  };
}
