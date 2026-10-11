/**
 * FakeProvider: an in-memory `AccommodationProvider` with every module, for tests of the
 * registry, IPC and (later) the core services.
 *
 *   const fake = createFakeProvider();                       // id 'fake', every capability
 *   const fake2 = createFakeProvider({ id: 'fake2' });       // a second provider
 *   registry.register(fake.factory, createTestProviderContext(fake.manifest));
 *
 * `capabilities: { catalogMode: 'search' }` gives it `catalog.searchArea` (the locations inside
 * the box, `searchPageSize` (2) a page) instead of `catalog.listLocations`, and `textSearch`
 * adds `catalog.searchText` (names containing the text). `createFakeSearchProvider`
 * (fake-search-provider.ts) is one with places spread across WA.
 *
 * Knobs:
 * - `failNext(module, error)`: the next call into that module rejects with `error`;
 * - `delayMs`: every async call waits this long first (abortable); `delays` per module;
 * - `calls`: every call, in order, with its `signal`;
 * - `peakInFlight(module)`: the most calls into the module at once;
 * - `accessStates`: the states the access gate steps through on `ensure()`;
 * - `availability`: a state per unit for every night, or a list of nights (state and price);
 *   `setAvailability` changes it later;
 * - `scriptHold(...results)`: the next `holds.create` calls answer these;
 * - `account` / `setAccount(state)`: what `auth.isSignedIn` answers; `auth` replaces its
 *   sign-in URL, origins or completion pages.
 *
 * Every async method honours its `AbortSignal` and rejects with an `AbortError`.
 */

import os from 'os';
import path from 'path';
import {
  AccessGateError,
  createAbortError,
  defineProvider,
  FakeSecretVault,
  InMemoryKeyValueStore,
  NodeHttpClient,
  ProviderError,
  ProviderHttpError,
  createProviderContext,
  type AccessGate,
  type AccommodationProvider,
  type BrowserAutomation,
  type BrowserSessionAuth,
  type CatalogModule,
  type ExternalBooking,
  type HoldResult,
  type HoldSuccess,
  type PaymentPage,
  type ProviderContext,
  type ProviderFactory,
  type ProviderLogger,
} from '@main/providers/sdk';
import type {
  AccessState,
  AccessStatus,
  AccountRequirement,
  AccountStatus,
  LocationAvailability,
  NightState,
  NightStatus,
  ProviderCapabilities,
  ProviderManifest,
  StayQuery,
} from '@shared/types/provider.types';
import type { LocationDetail, LocationSummary } from '@shared/types/catalog.types';
import { SnipeReleaseMode } from '@shared/types/common.types';
import { makeLocationKey } from '@shared/utils/location-key';

export type FakeModule =
  'catalog' | 'availability' | 'access' | 'release' | 'holds' | 'bookings' | 'auth';

export interface FakeCall {
  module: FakeModule;
  method: string;
  args: unknown[];
  signal?: AbortSignal;
}

/**
 * One night of a unit: its state, and its price (`FAKE_PRICE` when available unless given;
 * `null` for no price).
 */
export interface FakeNight {
  state: NightState;
  price?: number | null;
}

/** A unit's nights: the same state every night, or night by night (missing nights are booked). */
export type FakeUnitNights = NightState | FakeNight[];

export interface FakeLocationSeed {
  externalId: string;
  name: string;
  /** Where it is; by default a step of 0.1° per location from (-34, 116). */
  lat?: number;
  lng?: number;
}

export interface FakeProviderOptions {
  id?: string;
  name?: string;
  shortName?: string;
  /** Turned-off capabilities also leave out the modules only they need. */
  capabilities?: Partial<ProviderCapabilities>;
  locations?: FakeLocationSeed[];
  /**
   * Nights by `externalId` → unit id → a state for every night, or night by night. Units
   * default to `u1` (available) and `u2` (booked).
   */
  availability?: Record<string, Record<string, FakeUnitNights>>;
  /** The signed-in state `auth.isSignedIn` reports (`setAccount` changes it). */
  account?: AccountStatus['state'];
  /** Replaces parts of the `browser-session` auth (sign-in URL, origins, completion pages). */
  auth?: Partial<
    Pick<BrowserSessionAuth, 'signInUrl' | 'allowedOrigins' | 'completionUrlPatterns'>
  >;
  accessStates?: AccessState[];
  bookings?: ExternalBooking[];
  delayMs?: number;
  /** Per-module delays, instead of `delayMs`. */
  delays?: Partial<Record<FakeModule, number>>;
  /** The manifest's `bulkAvailabilityStayFields` (every stay field when absent). */
  bulkAvailabilityStayFields?: ProviderManifest['bulkAvailabilityStayFields'];
  /** A search-mode catalogue's `searchArea` page size (default 2). */
  searchPageSize?: number;
  /** A search-mode catalogue also has `catalog.searchText`. */
  textSearch?: boolean;
}

export interface FakeProvider extends AccommodationProvider {
  readonly factory: ProviderFactory;
  readonly calls: FakeCall[];
  delayMs: number;
  /** The context the factory was called with. */
  ctx?: ProviderContext;
  failNext(module: FakeModule, error: Error): void;
  /** Replaces a location's units from now on. */
  setAvailability(externalId: string, units: Record<string, FakeUnitNights>): void;
  /** The next `holds.create` calls answer these, in order. */
  scriptHold(...results: HoldResult[]): void;
  /** The most calls into `module` in flight at once. */
  peakInFlight(module: FakeModule): number;
  /** How many `holdOpen()` releases are outstanding. */
  readonly holdCount: number;
  /** What `auth.isSignedIn` reports from now on. */
  setAccount(state: AccountStatus['state']): void;
  readonly disposed: boolean;
}

export const FAKE_PRICE = 30;

/** The generic snipe release modes, which the fake (like ParkStay) describes and supports. */
const RELEASE_MODES: readonly string[] = Object.values(SnipeReleaseMode);

const DEFAULT_LOCATIONS: FakeLocationSeed[] = [
  { externalId: '1', name: 'Banksia Camp' },
  { externalId: '2', name: 'Karri Grove' },
  // An external id containing ":" must survive the location key round trip.
  { externalId: 'area:3', name: 'Tingle Hut' },
];

const ALL_ON: ProviderCapabilities = {
  catalog: true,
  catalogMode: 'full',
  availability: true,
  bulkAvailability: true,
  watches: true,
  snipes: true,
  holds: true,
  bookingImport: true,
  accessGate: true,
  account: 'optional',
};

/** Calendar dates from `arrival` up to (not including) `departure`. */
export function eachNight(stay: Pick<StayQuery, 'arrival' | 'departure'>): string[] {
  const nights: string[] = [];
  const end = Date.parse(`${stay.departure}T00:00:00Z`);
  for (let t = Date.parse(`${stay.arrival}T00:00:00Z`); t < end; t += 86_400_000) {
    nights.push(new Date(t).toISOString().slice(0, 10));
  }
  return nights;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createAbortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(createAbortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function createFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  const id = options.id ?? 'fake';
  const capabilities: ProviderCapabilities = { ...ALL_ON, ...options.capabilities };
  const seeds = options.locations ?? DEFAULT_LOCATIONS;
  let accountState: AccountStatus['state'] = options.account ?? 'signed-in';
  const accessStates = options.accessStates ?? ['waiting', 'active'];
  const bookings = options.bookings ?? [];
  const failures = new Map<FakeModule, Error>();
  const calls: FakeCall[] = [];
  const availabilityByLocation: Record<string, Record<string, FakeUnitNights>> = {
    ...options.availability,
  };
  const scriptedHolds: HoldResult[] = [];
  const active = new Map<FakeModule, number>();
  const peaks = new Map<FakeModule, number>();
  let holdCount = 0;
  let holdSequence = 0;
  let disposed = false;

  const manifest: ProviderManifest = {
    id,
    name: options.name ?? `Fake ${id}`,
    shortName: options.shortName ?? (id === 'fake' ? 'Fake' : id),
    description: 'An in-memory provider for tests.',
    website: `https://${id}.example`,
    integration: 'api',
    brand: { color: '#2F5D50', monogram: 'FK' },
    locationKinds: ['campground', 'cabin'],
    timezone: 'Australia/Perth',
    currency: 'AUD',
    capabilities,
    limits: { minWatchIntervalMinutes: 5, maxConcurrentRequests: 2, catalogTtlHours: 1 },
    ...(options.bulkAvailabilityStayFields
      ? { bulkAvailabilityStayFields: options.bulkAvailabilityStayFields }
      : {}),
    stayFields: [
      {
        key: 'gearType',
        label: 'Gear',
        type: 'select',
        options: [
          { value: 'tent', label: 'Tent' },
          { value: 'caravan', label: 'Caravan' },
        ],
        default: 'tent',
        appliesTo: ['availability', 'watch', 'snipe'],
      },
    ],
    releaseModes: capabilities.snipes
      ? [
          {
            id: SnipeReleaseMode.DAILY_ROLLOVER,
            label: 'Daily rollover',
            description: 'Opens 180 days ahead.',
            usesAccessGate: capabilities.accessGate,
          },
          {
            id: SnipeReleaseMode.SCHEDULED,
            label: 'Scheduled',
            description: 'Opens at a time you set.',
            usesAccessGate: capabilities.accessGate,
          },
          {
            id: SnipeReleaseMode.CANCELLATION,
            label: 'Cancellation',
            description: 'Polls for a freed unit.',
            usesAccessGate: false,
          },
        ]
      : undefined,
  };

  /** Records the call, honours the signal and the delay, and fires a scripted failure. */
  async function enter(
    module: FakeModule,
    method: string,
    args: unknown[],
    signal?: AbortSignal
  ): Promise<void> {
    calls.push({ module, method, args, signal });
    const now = (active.get(module) ?? 0) + 1;
    active.set(module, now);
    peaks.set(module, Math.max(peaks.get(module) ?? 0, now));
    try {
      // Always yields to a timer, so an abort right after the call still lands.
      await wait(options.delays?.[module] ?? fake.delayMs, signal);
    } finally {
      active.set(module, (active.get(module) ?? 1) - 1);
    }
    const failure = failures.get(module);
    if (failure) {
      failures.delete(module);
      throw failure;
    }
  }

  function seedFor(externalId: string): FakeLocationSeed {
    const seed = seeds.find((s) => s.externalId === externalId);
    if (!seed) {
      throw new ProviderHttpError({
        providerId: id,
        status: 404,
        url: `https://${id}.example/locations/${encodeURIComponent(externalId)}`,
      });
    }
    return seed;
  }

  function summary(seed: FakeLocationSeed, index: number): LocationSummary {
    return {
      key: makeLocationKey(id, seed.externalId),
      providerId: id,
      externalId: seed.externalId,
      name: seed.name,
      kind: 'campground',
      bookingMode: 'online',
      lat: seed.lat ?? -34 + index * 0.1,
      lng: seed.lng ?? 116 + index * 0.1,
      area: { name: 'Fake National Park', region: 'South West' },
      imageUrls: [`https://${id}.example/img/${index}.jpg`],
      amenities: ['Toilets'],
      unitCount: 2,
      bookingUrl: links.location(seed.externalId) ?? undefined,
    };
  }

  function unitStates(externalId: string): Record<string, FakeUnitNights> {
    return availabilityByLocation[externalId] ?? { u1: 'available', u2: 'booked' };
  }

  function nightsOf(spec: FakeUnitNights, dates: string[]): NightStatus[] {
    return dates.map((date, i) => {
      const night: FakeNight =
        typeof spec === 'string' ? { state: spec } : (spec[i] ?? { state: 'booked' });
      const price =
        night.price === null
          ? undefined
          : (night.price ?? (night.state === 'available' ? FAKE_PRICE : undefined));
      return { date, state: night.state, ...(price !== undefined ? { price } : {}) };
    });
  }

  function checkNow(externalId: string, stay: StayQuery, unitIds?: string[]): LocationAvailability {
    seedFor(externalId);
    const dates = eachNight(stay);
    const units = Object.entries(unitStates(externalId))
      .filter(([unitId]) => !unitIds || unitIds.includes(unitId))
      .map(([unitId, spec]) => {
        const nights = nightsOf(spec, dates);
        const fullyAvailable =
          nights.length > 0 && nights.every((night) => night.state === 'available');
        const priced = nights.every((night) => night.price !== undefined);
        return {
          unitId,
          unitName: `Site ${unitId}`,
          unitType: 'Tent site',
          nights,
          fullyAvailable,
          total:
            fullyAvailable && priced
              ? nights.reduce((sum, night) => sum + (night.price ?? 0), 0)
              : undefined,
        };
      });
    return {
      key: makeLocationKey(id, externalId),
      checkedAt: clock().toISOString(),
      units,
      release: { open: true },
      bookingUrl: links.booking(externalId, stay) ?? undefined,
    };
  }

  const clock = (): Date => fake.ctx?.clock() ?? new Date();

  const links = {
    location: (externalId: string) =>
      `https://${id}.example/locations/${encodeURIComponent(externalId)}`,
    booking: (externalId: string, stay?: StayQuery) =>
      `https://${id}.example/book/${encodeURIComponent(externalId)}` +
      (stay ? `?arrival=${stay.arrival}&departure=${stay.departure}` : ''),
    manageBooking: (reference: string) =>
      `https://${id}.example/bookings/${encodeURIComponent(reference)}`,
  };

  // ---- access gate: steps through `accessStates` on ensure(), one step per tick ----
  const listeners = new Set<(status: AccessStatus) => void>();
  let accessStatus: AccessStatus = {
    providerId: id,
    state: 'idle',
    updatedAt: new Date().toISOString(),
  };
  const setAccess = (state: AccessState): void => {
    accessStatus = { providerId: id, state, updatedAt: clock().toISOString() };
    listeners.forEach((listener) => listener(accessStatus));
  };
  const access: AccessGate = {
    waitingRoomOrigins: [`https://queue.${id}.example`],
    status: () => accessStatus,
    async ensure({ signal, maxWaitMs } = {}) {
      await enter('access', 'ensure', [{ maxWaitMs }], signal);
      for (const state of accessStates) {
        await wait(0, signal);
        setAccess(state);
        if (state === 'active') return accessStatus;
      }
      throw new AccessGateError(id, accessStatus.state);
    },
    holdOpen() {
      holdCount++;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holdCount--;
      };
    },
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
    },
  };

  function catalogModule(): CatalogModule {
    const catalog: CatalogModule = {
      async getLocation(externalId, signal) {
        await enter('catalog', 'getLocation', [externalId], signal);
        const seed = seedFor(externalId);
        const detail: LocationDetail = {
          ...summary(seed, seeds.indexOf(seed)),
          descriptionHtml: `<p>${seed.name}</p>`,
          units: Object.keys(unitStates(externalId)).map((unitId) => ({
            unitId,
            unitName: `Site ${unitId}`,
            unitType: 'Tent site',
            maxPeople: 6,
            equipment: ['tent'],
          })),
          releaseInfo: 'Bookings open 180 days ahead.',
          fetchedAt: clock().toISOString(),
        };
        return detail;
      },
    };
    if (capabilities.catalogMode === 'search') {
      // The locations inside the box, a page at a time; the cursor is the index of the next.
      const pageSize = options.searchPageSize ?? 2;
      catalog.searchArea = async (query, signal) => {
        await enter('catalog', 'searchArea', [query], signal);
        const [west, south, east, north] = query.bbox;
        const inside = seeds
          .map(summary)
          .filter((l) => l.lng >= west && l.lng <= east && l.lat >= south && l.lat <= north);
        const start = Number(query.cursor ?? 0);
        const items = inside.slice(start, start + pageSize);
        const next = start + items.length;
        return next < inside.length ? { items, nextCursor: String(next) } : { items };
      };
      if (options.textSearch) {
        catalog.searchText = async (text, signal) => {
          await enter('catalog', 'searchText', [text], signal);
          const wanted = text.toLowerCase();
          return seeds.map(summary).filter((l) => l.name.toLowerCase().includes(wanted));
        };
      }
    } else {
      catalog.listLocations = async (signal) => {
        await enter('catalog', 'listLocations', [], signal);
        return seeds.map(summary);
      };
    }
    return catalog;
  }

  const fake: FakeProvider = {
    manifest,
    links,
    calls,
    delayMs: options.delayMs ?? 0,
    factory: defineProvider(manifest, (ctx) => {
      fake.ctx = ctx;
      return fake;
    }),
    failNext(module, error) {
      failures.set(module, error);
    },
    setAvailability(externalId, units) {
      availabilityByLocation[externalId] = units;
    },
    scriptHold(...results) {
      scriptedHolds.push(...results);
    },
    peakInFlight(module) {
      return peaks.get(module) ?? 0;
    },
    get holdCount() {
      return holdCount;
    },
    setAccount(state) {
      accountState = state;
    },
    get disposed() {
      return disposed;
    },

    catalog: capabilities.catalog ? catalogModule() : undefined,

    availability:
      capabilities.availability || capabilities.watches || capabilities.snipes
        ? {
            async check(externalId, stay, { unitIds, signal } = {}) {
              await enter('availability', 'check', [externalId, stay, { unitIds }], signal);
              return checkNow(externalId, stay, unitIds);
            },
            search: capabilities.bulkAvailability
              ? async (stay, signal) => {
                  await enter('availability', 'search', [stay], signal);
                  return seeds.map((seed) => {
                    const states = Object.values(unitStates(seed.externalId));
                    return {
                      key: makeLocationKey(id, seed.externalId),
                      availableUnits: states.filter((s) => s === 'available').length,
                      bookableUnits: states.length,
                    };
                  });
                }
              : undefined,
          }
        : undefined,

    access: capabilities.accessGate ? access : undefined,

    release: capabilities.snipes
      ? {
          supports: (mode) => RELEASE_MODES.includes(mode),
          async computeReleaseAt({ mode, externalId, stay, requestedAt, signal }) {
            await enter('release', 'computeReleaseAt', [{ mode, externalId, stay }], signal);
            if (mode === SnipeReleaseMode.CANCELLATION) return null;
            if (mode === SnipeReleaseMode.SCHEDULED) {
              if (!requestedAt) {
                throw new ProviderError({
                  providerId: id,
                  message: 'A scheduled release needs a time',
                });
              }
              return requestedAt;
            }
            if (mode === SnipeReleaseMode.DAILY_ROLLOVER) {
              return new Date(Date.parse(`${stay.arrival}T00:00:00Z`) - 180 * 86_400_000);
            }
            throw new ProviderError({ providerId: id, message: `Unknown release mode ${mode}` });
          },
          async describe(externalId, signal) {
            await enter('release', 'describe', [externalId], signal);
            return 'Bookings open 180 days ahead.';
          },
          suggestScheduledAt: (_externalId, now) => new Date(now.getTime() + 7 * 86_400_000),
          pollFloorMs: { window: 500, continuous: 3000 },
        }
      : undefined,

    holds: capabilities.holds
      ? {
          async create(request, signal): Promise<HoldResult> {
            await enter('holds', 'create', [request], signal);
            const scripted = scriptedHolds.shift();
            if (scripted) return scripted;
            if (accountState !== 'signed-in' && requiresAccountForHolds(capabilities.account)) {
              return {
                ok: false,
                reason: 'auth-required',
                message: `Sign in to ${manifest.shortName}`,
              };
            }
            const result = checkNow(
              request.externalId,
              request.stay,
              request.unitId ? [request.unitId] : undefined
            );
            const unit = result.units.find((u) => u.fullyAvailable);
            if (!unit)
              return { ok: false, reason: 'taken', message: 'No unit is free for the stay' };
            holdSequence++;
            return {
              ok: true,
              reference: `${id.toUpperCase()}-${holdSequence}`,
              expiresAt: new Date(clock().getTime() + 30 * 60_000),
              unitId: unit.unitId,
            };
          },
          paymentUrl: (hold: HoldSuccess) => `https://${id}.example/pay/${hold.reference}`,
          paymentOrigins: [`https://${id}.example`],
          // Paid: the provider's page `/paid/<reference>` (any query) showing `BK-<reference>`
          bookedReference: async (hold: { reference: string }, page: PaymentPage) => {
            const paid = `https://${id}.example/paid/${hold.reference}`;
            const booked = `BK-${hold.reference}`;
            const onPage = page.url === paid || page.url.startsWith(`${paid}?`);
            return onPage && (await page.hasText(booked)) ? booked : null;
          },
        }
      : undefined,

    bookings: capabilities.bookingImport
      ? {
          async list(signal) {
            await enter('bookings', 'list', [], signal);
            return bookings;
          },
          async get(reference, signal) {
            await enter('bookings', 'get', [reference], signal);
            const booking = bookings.find((b) => b.reference === reference);
            if (!booking) {
              throw new ProviderHttpError({
                providerId: id,
                status: 404,
                url: links.manageBooking(reference),
              });
            }
            return booking;
          },
        }
      : undefined,

    auth:
      capabilities.account !== 'none'
        ? {
            kind: 'browser-session',
            signInUrl: `https://${id}.example/sign-in`,
            allowedOrigins: [`https://${id}.example`],
            completionUrlPatterns: [`https://${id}.example/signed-in*`],
            ...options.auth,
            async isSignedIn(_http, signal) {
              await enter('auth', 'isSignedIn', [], signal);
              return accountState === 'signed-in'
                ? { state: 'signed-in', email: `person@${id}.example`, displayName: 'Pat Person' }
                : { state: accountState };
            },
          }
        : undefined,

    async dispose() {
      disposed = true;
      access.dispose();
    },
  };

  return fake;
}

function requiresAccountForHolds(requirement: AccountRequirement): boolean {
  return requirement === 'required' || requirement === 'required-for-holds';
}

/** A logger that records every line, for tests that assert on logging. */
export interface MemoryLogger extends ProviderLogger {
  readonly lines: Array<{ level: string; message: string; meta: unknown[]; context: object }>;
}

export function createMemoryLogger(
  context: object = {},
  lines: MemoryLogger['lines'] = []
): MemoryLogger {
  const log =
    (level: string) =>
    (message: string, ...meta: unknown[]): void => {
      lines.push({ level, message, meta, context });
    };
  return {
    lines,
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child: (meta) => createMemoryLogger({ ...context, ...meta }, lines),
  };
}

export const FIXED_NOW = new Date('2026-10-02T02:00:00.000Z');

/**
 * Where Playwright test contexts keep provider browser profiles. Nothing is created there
 * unless a test really launches a browser (the opt-in smoke test uses its own temporary folder).
 */
export const TEST_PROVIDERS_DIR = path.join(os.tmpdir(), 'wa-stay-test', 'providers');

/** A minimal valid manifest for `id`, with every capability off. */
export function testManifest(
  id: string,
  overrides: Partial<ProviderManifest> = {}
): ProviderManifest {
  return {
    id,
    name: `Test ${id}`,
    shortName: id,
    description: 'A provider for tests.',
    website: `https://${id}.example`,
    integration: 'api',
    brand: { color: '#2F5D50', monogram: 'T' },
    locationKinds: ['campground'],
    timezone: 'Australia/Perth',
    currency: 'AUD',
    capabilities: {
      catalog: false,
      catalogMode: 'full',
      availability: false,
      bulkAvailability: false,
      watches: false,
      snipes: false,
      holds: false,
      bookingImport: false,
      accessGate: false,
      account: 'none',
    },
    ...overrides,
  };
}

/**
 * The browser of a test context that was given none: using it fails the test, so no test
 * quietly drives a real browser. `close()` is harmless (registries close every browser).
 */
export function unsetBrowser(providerId: string): BrowserAutomation {
  const fail = (): Promise<never> =>
    Promise.reject(
      new Error(
        `This test did not set up a browser for "${providerId}": pass ` +
          '{ browser: createFakeBrowser(site) } (tests/utils/fake-browser.ts) to createTestProviderContext'
      )
    );
  return { isAvailable: fail, withPage: fail, close: async () => undefined };
}

/**
 * A provider context built from in-memory parts: Node HTTP, KV store, fake vault and a fixed
 * clock. Its browser is `unsetBrowser` unless `overrides.browser` gives one, usually
 * `createFakeBrowser(site)` (`tests/utils/fake-browser.ts`). Pass the provider's manifest, or
 * an id for a context built from `testManifest(id)`.
 */
export function createTestProviderContext(
  manifestOrId: ProviderManifest | string,
  overrides: Partial<Omit<ProviderContext, 'id'>> = {}
): ProviderContext {
  // createProviderContext also builds a PlaywrightBrowserAutomation; it is idle (it loads and
  // launches nothing until used), and replaced here.
  const context = createPlaywrightTestProviderContext(manifestOrId);
  return { ...context, browser: unsetBrowser(context.id), ...overrides };
}

/**
 * The same context with the real `PlaywrightBrowserAutomation` (its profile under
 * `TEST_PROVIDERS_DIR`), for tests of browser automation itself: mock `playwright-core` with
 * `tests/utils/fake-playwright.ts` first.
 */
export function createPlaywrightTestProviderContext(
  manifestOrId: ProviderManifest | string,
  overrides: Partial<Omit<ProviderContext, 'id'>> = {}
): ProviderContext {
  const manifest = typeof manifestOrId === 'string' ? testManifest(manifestOrId) : manifestOrId;
  const context = createProviderContext(manifest, {
    createHttp: (providerId) => new NodeHttpClient({ providerId }),
    createState: () => new InMemoryKeyValueStore(),
    vault: new FakeSecretVault(),
    logger: createMemoryLogger(),
    providersDir: TEST_PROVIDERS_DIR,
    clock: () => FIXED_NOW,
  });
  return { ...context, ...overrides };
}
