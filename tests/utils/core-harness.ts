/**
 * The core services and the scheduler on a real in-memory database (every migration, the
 * seeded local profile row) and a registry holding only FakeProviders, for V4's tests:
 *
 *   const h = createCoreHarness();                 // FakeProvider `fake`, every capability
 *   const watch = await h.watches.create(h.userId, h.watchInput());
 *   ...
 *   await h.close();
 *
 * Clocks are `new Date()`, so Jest's modern fake timers drive them. Notifications go to a
 * recording stub unless a test passes its own; `events` records every renderer event.
 */

import { EventEmitter } from 'events';
import type Database from 'better-sqlite3';
import { openDatabase } from '@main/database/connection';
import {
  NotificationRepository,
  ProviderAccountRepository,
  SiteSniperRepository,
  WatchRepository,
} from '@main/database/repositories';
import type { AccountGate } from '@main/core/accounts/ports';
import { NightGuard } from '@main/core/holds/night-guard';
import { SiteSniperService, type SnipeNotifications } from '@main/core/snipes/snipe.service';
import { WatchService, type WatchNotifications } from '@main/core/watches/watch.service';
import { ProviderRegistry } from '@main/providers/registry';
import { JobScheduler } from '@main/scheduler/job-scheduler';
import type { AccountStatus } from '@shared/types/provider.types';
import type { SiteSnipeInput, WatchInput } from '@shared/types';
import { SnipeReleaseMode } from '@shared/types/common.types';
import { createFakeProvider, createTestProviderContext, type FakeProvider } from './fake-provider';

export type RecordingNotifications = WatchNotifications &
  SnipeNotifications & { [K in keyof (WatchNotifications & SnipeNotifications)]: jest.Mock };

export interface CoreHarnessOptions {
  /** The providers to register (default: one FakeProvider `fake` with every capability). */
  providers?: FakeProvider[];
  /** For the watch jitter (default 0: no jitter). */
  random?: () => number;
  accountState?: (providerId: string) => AccountStatus['state'];
  /** The snipe service's account gate (default: none). */
  accounts?: AccountGate;
  notifications?: WatchNotifications & SnipeNotifications;
  stopGraceMs?: number;
}

export interface CoreHarness {
  db: Database.Database;
  registry: ProviderRegistry;
  /** The first provider. */
  fake: FakeProvider;
  userId: number;
  watchRepo: WatchRepository;
  snipeRepo: SiteSniperRepository;
  notificationRepo: NotificationRepository;
  accounts: ProviderAccountRepository;
  nightGuard: NightGuard;
  watches: WatchService;
  snipes: SiteSniperService;
  scheduler: JobScheduler;
  /** Stands in for Electron's powerMonitor. */
  power: EventEmitter;
  events: { emit: jest.Mock };
  notifications: RecordingNotifications;
  /** A creatable watch on `fake` location 1, 3 nights from 2026-12-01. */
  watchInput(overrides?: Partial<WatchInput>): WatchInput;
  /** A creatable snipe on `fake` location 1, 2 nights from 2026-12-01. */
  snipeInput(overrides?: Partial<SiteSnipeInput>): SiteSnipeInput;
  /** Stops the scheduler and closes the database. */
  close(): Promise<void>;
}

export function recordingNotifications(): RecordingNotifications {
  return {
    notifyWatchFound: jest.fn().mockResolvedValue(undefined),
    notifyWatchPartialFound: jest.fn().mockResolvedValue(undefined),
    notifyWatchHeld: jest.fn().mockResolvedValue(undefined),
    notifySnipeHeld: jest.fn().mockResolvedValue(undefined),
  };
}

export function createCoreHarness(options: CoreHarnessOptions = {}): CoreHarness {
  const db = openDatabase(':memory:');
  const registry = new ProviderRegistry();
  const providers = options.providers ?? [createFakeProvider()];
  for (const provider of providers) {
    registry.register(
      provider.factory,
      createTestProviderContext(provider.manifest, { clock: () => new Date() })
    );
  }

  const watchRepo = new WatchRepository(db);
  const snipeRepo = new SiteSniperRepository(db);
  const notificationRepo = new NotificationRepository(db);
  const accounts = new ProviderAccountRepository(db);
  const nightGuard = new NightGuard(snipeRepo, watchRepo);
  const events = { emit: jest.fn() };
  const notifications = (options.notifications ??
    recordingNotifications()) as RecordingNotifications;
  const watches = new WatchService({
    watches: watchRepo,
    providers: registry,
    notifications,
    nightGuard,
    events,
    accountState: options.accountState,
    random: options.random ?? (() => 0),
  });
  const snipes = new SiteSniperService({
    snipes: snipeRepo,
    providers: registry,
    notifications,
    nightGuard,
    events,
    accounts: options.accounts,
  });
  const power = new EventEmitter();
  const scheduler = new JobScheduler({
    watches,
    snipes,
    providers: registry,
    power,
    stopGraceMs: options.stopGraceMs,
  });
  // v8 seeds the local profile, id 1
  const userId = 1;

  return {
    db,
    registry,
    fake: providers[0],
    userId,
    watchRepo,
    snipeRepo,
    notificationRepo,
    accounts,
    nightGuard,
    watches,
    snipes,
    scheduler,
    power,
    events,
    notifications,
    watchInput: (overrides = {}) => ({
      providerId: providers[0].manifest.id,
      name: 'Banksia watch',
      location: { externalId: '1', name: 'Banksia Camp' },
      stay: { arrival: '2026-12-01', departure: '2026-12-04', adults: 2 },
      checkIntervalMinutes: 60,
      ...overrides,
    }),
    snipeInput: (overrides = {}) => ({
      providerId: providers[0].manifest.id,
      name: 'Banksia snipe',
      location: { externalId: '1', name: 'Banksia Camp' },
      stay: { arrival: '2026-12-01', departure: '2026-12-03', adults: 2 },
      releaseMode: SnipeReleaseMode.CANCELLATION,
      ...overrides,
    }),
    async close() {
      await scheduler.stop();
      db.close();
    },
  };
}

/** Timer functions left real by `fakeDateOnly`. */
const REAL_TIMERS = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

/** Fakes only `Date` (at `now`): timers stay real, so awaiting a provider call just works. */
export function fakeDateOnly(now: Date): void {
  jest.useFakeTimers({ now, doNotFake: [...REAL_TIMERS] });
}

/**
 * Awaits `promise` under Jest's fake timers, running the timers that are due now (a
 * FakeProvider call always waits on a 0 ms timer) until it settles.
 */
export async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true)
  );
  for (let i = 0; i < 1000 && !done; i++) await jest.advanceTimersByTimeAsync(0);
  return promise;
}
