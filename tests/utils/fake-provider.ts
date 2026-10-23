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
 * - `pauseNext(module)`: the next call into that module waits, after its delay, until the
 *   returned `resume()` is called (abortable), so a test can act while it is in flight
 *   whatever the machine's speed;
 * - `delayMs`: every async call waits this long first (abortable); `delays` per module;
 * - `limits`: replaces parts of the manifest's limits;
 * - `calls`: every call, in order, with its `signal` and the ambient request priority it was
 *   made at (`currentRequestPriority()`, what a paced `ctx.http` would send it with);
 * - `peakInFlight(module)`: the most calls into the module at once;
 * - `accessStates`: the states the access gate steps through on `ensure()`;
 * - `availability`: a state per unit for every night, or a list of nights (state, price and
 *   the stay rules: `reason`, `minNights`, `noArrival`, `noDeparture`); `setAvailability`
 *   changes it later; `unitKinds`: what each unit id is (none by default); `unitMinNights`:
 *   each unit's minimum stay (`UnitAvailability.minNights`): a shorter stay is refused, its
 *   nights with room answered `min-stay` and never `fullyAvailable`;
 * - `scriptHold(...results)`: the next `holds.create` calls answer these;
 * - `holdRelease`: `holds.release` (R18) and the manifest's `holdRelease`; each call answers
 *   the next `scriptRelease(...)` outcome, else `released` (`failNext('holds', …)` rejects it,
 *   a `delays.holds` delays it); `onPaymentClose` also sets `releaseOnPaymentClose`. Without
 *   it the fake, like ParkStay, cannot let a hold go;
 * - `maxWindowMinutes`: every release mode's window limit;
 * - `stayFields`: stay fields after its own `gearType` (for availability, watches and snipes);
 * - `account` / `setAccount(state)`: what `auth.isSignedIn` answers; `auth` replaces its
 *   sign-in URL, origins or completion pages;
 * - `experiments`: declared in the manifest, with the capabilities they turn on off there; the
 *   modules of those capabilities (built as `capabilities` says) reach the registry only when
 *   `ctx.manifest` has them on, as a provider's factory does (`withExperiments` applies them);
 * - `credentials`: a `credentials` sign-in instead of `browser-session` (R15), with
 *   `FAKE_CREDENTIAL_FIELDS` (a copyable member number and a password that is not) and one
 *   statement, `FAKE_CONFIRMATIONS`, unless given; `signIn` answers `signed-in` unless
 *   scripted. Its calls are recorded with the keys only, never a value.
 *
 * Every async method honours its `AbortSignal` and rejects with an `AbortError`.
 */

import os from 'os';
import path from 'path';
import {
  AccessGateError,
  createAbortError,
  currentRequestPriority,
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
  type CredentialsAuth,
  type CredentialsSignInResult,
  type ExternalBooking,
  type HttpClient,
  type HoldReleaseOutcome,
  type HoldResult,
  type HoldSuccess,
  type HoldToRelease,
  type PaymentPage,
  type ProviderContext,
  type ProviderFactory,
  type ProviderLogger,
  type ProviderModules,
  type RequestPriority,
} from '@main/providers/sdk';
import type {
  AccessState,
  AccessStatus,
  AccountConfirmation,
  AccountFieldDescriptor,
  AccountRequirement,
  AccountStatus,
  BooleanCapability,
  LocationAvailability,
  NightState,
  NightStatus,
  ProviderCapabilities,
  ProviderExperiment,
  ProviderLimits,
  ProviderManifest,
  StayFieldDescriptor,
  StayQuery,
  UnitKind,
  UnitSplitStay,
} from '@shared/types/provider.types';
import { minimumNights } from '@main/core/watches/matching';
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
  /** The ambient request priority when it was called (the fake's own modules record it). */
  priority?: RequestPriority;
}

/**
 * One night of a unit: its state, and its price (`FAKE_PRICE` when available unless given;
 * `null` for no price), with the stay rules passed through as given.
 */
export interface FakeNight extends Partial<
  Pick<NightStatus, 'reason' | 'minNights' | 'noArrival' | 'noDeparture'>
> {
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
  /** What each unit is, by unit id, at every location (`unitKind`). Units left out have none. */
  unitKinds?: Record<string, UnitKind>;
  /**
   * Each unit's minimum stay, by unit id, at every location (`UnitAvailability.minNights`): a
   * shorter stay (by the core's `minimumNights`) is refused, so its nights with room are
   * `min-stay` and it is never `fullyAvailable`. Units left out have none.
   */
  unitMinNights?: Record<string, number>;
  /**
   * Each unit of a check carries its own booking link (`UnitAvailability.bookingUrl`):
   * `https://book.<id>.example/<externalId>/<unitId>?arrival=…&departure=…`, on a subdomain of
   * the fake's website. Units have none by default.
   */
  unitBookingUrls?: boolean;
  /**
   * What each unit reports as a split stay (`UnitAvailability.splitStay`), by unit id, at every
   * location, passed through as given (a test may give an invalid one). Units left out report
   * none.
   */
  splitStays?: Record<string, UnitSplitStay>;
  /** `links.contact`: `https://<id>.example/locations/<externalId>/contact`. None by default. */
  contactLinks?: boolean;
  /** The signed-in state `auth.isSignedIn` reports (`setAccount` changes it). */
  account?: AccountStatus['state'];
  /** Replaces parts of the `browser-session` auth (sign-in URL, origins, completion pages). */
  auth?: Partial<
    Pick<BrowserSessionAuth, 'signInUrl' | 'allowedOrigins' | 'completionUrlPatterns'>
  >;
  /** A `credentials` sign-in instead of `browser-session` (see `FakeCredentialsOptions`). */
  credentials?: FakeCredentialsOptions;
  accessStates?: AccessState[];
  bookings?: ExternalBooking[];
  delayMs?: number;
  /** Per-module delays, instead of `delayMs`. */
  delays?: Partial<Record<FakeModule, number>>;
  /** Replaces parts of the manifest's limits (5 min watches, 2 at once, a 1 h catalogue). */
  limits?: Partial<ProviderLimits>;
  /** The manifest's `bulkAvailabilityStayFields` (every stay field when absent). */
  bulkAvailabilityStayFields?: ProviderManifest['bulkAvailabilityStayFields'];
  /** A search-mode catalogue's `searchArea` page size (default 2). */
  searchPageSize?: number;
  /** A search-mode catalogue also has `catalog.searchText`. */
  textSearch?: boolean;
  /**
   * Declared in the manifest, where the capabilities they turn on are off. Their modules are
   * built as `capabilities` says, and given to the registry only when `ctx.manifest` has them on.
   */
  experiments?: ProviderExperiment[];
  /** Every release mode's `maxWindowMinutes` (none by default). */
  maxWindowMinutes?: number;
  /** Stay fields after the fake's own `gearType` (none by default). */
  stayFields?: StayFieldDescriptor[];
  /**
   * `holds.release` and the manifest's `holdRelease` (R18); `onPaymentClose` also sets
   * `holds.releaseOnPaymentClose`. None by default: the fake cannot let a hold go.
   */
  holdRelease?: { onPaymentClose?: boolean };
}

/** A `credentials` sign-in for the fake. Values here are made up; never a real number. */
export interface FakeCredentialsOptions {
  /** Default `FAKE_CREDENTIAL_FIELDS`. */
  fields?: AccountFieldDescriptor[];
  /** Default `FAKE_CONFIRMATIONS`; `[]` for none. */
  confirmations?: AccountConfirmation[];
  /**
   * What `signIn` answers: a state, or a function of the trimmed values and the HTTP client
   * the core passes (it may reject, or return normalised `values`). Default `signed-in`.
   */
  signIn?:
    | AccountStatus['state']
    | ((
        values: Readonly<Record<string, string>>,
        http: HttpClient,
        signal?: AbortSignal
      ) => CredentialsSignInResult | Promise<CredentialsSignInResult>);
}

/** The fake's default `credentials` fields: a copyable member number, and a password that is not. */
export const FAKE_CREDENTIAL_FIELDS: AccountFieldDescriptor[] = [
  {
    key: 'memberNumber',
    label: 'Member number',
    help: 'The 13 digits on your card.',
    secret: true,
    copyable: true,
  },
  { key: 'password', label: 'Password', secret: true },
];

export const FAKE_CONFIRMATIONS: AccountConfirmation[] = [
  { key: 'own', label: 'This is my own membership.' },
];

export interface FakeProvider extends AccommodationProvider {
  readonly factory: ProviderFactory;
  readonly calls: FakeCall[];
  delayMs: number;
  /** The context the factory was called with. */
  ctx?: ProviderContext;
  failNext(module: FakeModule, error: Error): void;
  /** The next call into `module` waits (after its delay) until `resume()`; abortable. */
  pauseNext(module: FakeModule): () => void;
  /** Replaces a location's units from now on. */
  setAvailability(externalId: string, units: Record<string, FakeUnitNights>): void;
  /** The next `holds.create` calls answer these, in order. */
  scriptHold(...results: HoldResult[]): void;
  /** The next `holds.release` calls answer these outcomes, in order (then `released`). */
  scriptRelease(...outcomes: HoldReleaseOutcome[]): void;
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

/** The module a capability an experiment turns on brings, when it has one of its own. */
const EXPERIMENT_MODULES: Partial<Record<BooleanCapability, keyof ProviderModules>> = {
  catalog: 'catalog',
  accessGate: 'access',
  snipes: 'release',
  holds: 'holds',
  bookingImport: 'bookings',
};

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

/** Resolves when `paused` does, or rejects when `signal` aborts first. */
function untilResumed(paused: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return paused;
  if (signal.aborted) return Promise.reject(createAbortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(createAbortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void paused.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
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
  const scriptedReleases: HoldReleaseOutcome[] = [];
  const pauses = new Map<FakeModule, Promise<void>[]>();
  const active = new Map<FakeModule, number>();
  const peaks = new Map<FakeModule, number>();
  let holdCount = 0;
  let holdSequence = 0;
  let disposed = false;
  const experimental = [...new Set(options.experiments?.flatMap((e) => e.turnsOn) ?? [])];
  const experimentalOff = Object.fromEntries(experimental.map((c) => [c, false]));

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
    capabilities: { ...capabilities, ...experimentalOff },
    ...(options.experiments ? { experiments: options.experiments } : {}),
    ...(options.holdRelease ? { holdRelease: true } : {}),
    limits: {
      minWatchIntervalMinutes: 5,
      maxConcurrentRequests: 2,
      catalogTtlHours: 1,
      ...options.limits,
    },
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
      ...(options.stayFields ?? []),
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
        ].map((mode) =>
          options.maxWindowMinutes === undefined
            ? mode
            : { ...mode, maxWindowMinutes: options.maxWindowMinutes }
        )
      : undefined,
  };

  function credentialsAuth(credentials: FakeCredentialsOptions): CredentialsAuth {
    const answer = credentials.signIn ?? 'signed-in';
    return {
      kind: 'credentials',
      fields: credentials.fields ?? FAKE_CREDENTIAL_FIELDS,
      confirmations: credentials.confirmations ?? FAKE_CONFIRMATIONS,
      async signIn(values, http, signal) {
        // The keys only: a test may print its calls
        await enter('auth', 'signIn', [Object.keys(values)], signal);
        return typeof answer === 'function' ? answer(values, http, signal) : { state: answer };
      },
      async isSignedIn(_http, signal) {
        await enter('auth', 'isSignedIn', [], signal);
        return { state: accountState };
      },
    };
  }

  /** The fake's modules, without those of experimental capabilities `on` has off. */
  function modulesFor(on: ProviderCapabilities): ProviderModules {
    const { links, catalog, availability, access, release, holds, bookings, auth } = fake;
    const modules: ProviderModules = {
      links,
      catalog,
      availability,
      access,
      release,
      holds,
      bookings,
      auth,
      async dispose() {
        await fake.dispose?.();
      },
    };
    for (const capability of experimental) {
      const module = EXPERIMENT_MODULES[capability];
      if (module && !on[capability]) delete modules[module];
    }
    return modules;
  }

  /** Records the call, honours the signal and the delay, and fires a scripted failure. */
  async function enter(
    module: FakeModule,
    method: string,
    args: unknown[],
    signal?: AbortSignal
  ): Promise<void> {
    calls.push({ module, method, args, signal, priority: currentRequestPriority() });
    const now = (active.get(module) ?? 0) + 1;
    active.set(module, now);
    peaks.set(module, Math.max(peaks.get(module) ?? 0, now));
    try {
      // Always yields to a timer, so an abort right after the call still lands.
      await wait(options.delays?.[module] ?? fake.delayMs, signal);
      const pause = pauses.get(module)?.shift();
      if (pause) await untilResumed(pause, signal);
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
      const { reason, minNights, noArrival, noDeparture } = night;
      return {
        date,
        state: night.state,
        ...(price !== undefined ? { price } : {}),
        ...(reason ? { reason } : {}),
        ...(minNights !== undefined ? { minNights } : {}),
        ...(noArrival ? { noArrival } : {}),
        ...(noDeparture ? { noDeparture } : {}),
      };
    });
  }

  /**
   * The nights as a provider with stay rules answers them: a stay under its minimum (the core's
   * `minimumNights`: the first night's `minNights`, else the unit's) is refused, so each night
   * with room is `unknown` with `reason: 'min-stay'`.
   */
  function underStayRules(nights: NightStatus[], minNights: number | undefined): NightStatus[] {
    if (nights.length >= minimumNights({ minNights }, nights[0])) return nights;
    return nights.map((night) =>
      night.state === 'available' && night.reason === undefined
        ? { ...night, state: 'unknown', reason: 'min-stay' }
        : night
    );
  }

  /** Every night available with no reason, arriving on a day that takes arrivals. */
  function freeForStay(nights: NightStatus[]): boolean {
    if (nights.length === 0) return false;
    if (nights.some((night) => night.state !== 'available' || night.reason)) return false;
    return !nights[0].noArrival;
  }

  function checkNow(externalId: string, stay: StayQuery, unitIds?: string[]): LocationAvailability {
    seedFor(externalId);
    const dates = eachNight(stay);
    const units = Object.entries(unitStates(externalId))
      .filter(([unitId]) => !unitIds || unitIds.includes(unitId))
      .map(([unitId, spec]) => {
        const minNights = options.unitMinNights?.[unitId];
        const nights = underStayRules(nightsOf(spec, dates), minNights);
        const fullyAvailable = freeForStay(nights);
        const priced = nights.every((night) => night.price !== undefined);
        const unitKind = options.unitKinds?.[unitId];
        const splitStay = options.splitStays?.[unitId];
        return {
          unitId,
          unitName: `Site ${unitId}`,
          unitType: 'Tent site',
          ...(unitKind ? { unitKind } : {}),
          nights,
          fullyAvailable,
          ...(minNights !== undefined ? { minNights } : {}),
          total:
            fullyAvailable && priced
              ? nights.reduce((sum, night) => sum + (night.price ?? 0), 0)
              : undefined,
          ...(options.unitBookingUrls
            ? {
                bookingUrl:
                  `https://book.${id}.example/${encodeURIComponent(externalId)}/` +
                  `${encodeURIComponent(unitId)}?arrival=${stay.arrival}&departure=${stay.departure}`,
              }
            : {}),
          ...(splitStay ? { splitStay } : {}),
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
    ...(options.contactLinks
      ? {
          contact: (externalId: string) =>
            `https://${id}.example/locations/${encodeURIComponent(externalId)}/contact`,
        }
      : {}),
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
      return experimental.length ? modulesFor(ctx.manifest.capabilities) : fake;
    }),
    failNext(module, error) {
      failures.set(module, error);
    },
    pauseNext(module) {
      let resume!: () => void;
      const paused = new Promise<void>((resolve) => {
        resume = resolve;
      });
      pauses.set(module, [...(pauses.get(module) ?? []), paused]);
      return () => resume();
    },
    setAvailability(externalId, units) {
      availabilityByLocation[externalId] = units;
    },
    scriptHold(...results) {
      scriptedHolds.push(...results);
    },
    scriptRelease(...outcomes) {
      scriptedReleases.push(...outcomes);
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
          ...(options.holdRelease
            ? {
                async release(hold: HoldToRelease, signal?: AbortSignal) {
                  await enter('holds', 'release', [hold], signal);
                  return { outcome: scriptedReleases.shift() ?? 'released' };
                },
                ...(options.holdRelease.onPaymentClose ? { releaseOnPaymentClose: true } : {}),
              }
            : {}),
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
      capabilities.account !== 'none' && options.credentials
        ? credentialsAuth(options.credentials)
        : capabilities.account !== 'none'
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
