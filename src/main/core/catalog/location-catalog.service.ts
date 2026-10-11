/**
 * `LocationCatalogService`: one fast, offline-capable catalogue of every location from every
 * provider (architecture-notes §1, §4, §5), behind the `catalog.*` IPC namespace.
 *
 * - **Sync.** Each provider with `capabilities.catalog` and `catalogMode: 'full'` has its
 *   `catalog.listLocations` copied into `locations` (one transaction), at most once per
 *   `limits.catalogTtlHours` (24 h) unless forced. Syncs are single-flight per provider and
 *   run in parallel, so one provider's failure never blocks another's; a failed or empty
 *   sync keeps the cached rows and records `lastError`. The outcome is kept in
 *   `provider_state` as `('<providerId>', 'core.catalog.sync')` and announced as
 *   `catalog:updated`.
 * - **Search** runs on the cache (FTS5, filters, facets): `LocationRepository.search`.
 * - **Detail** is cached for 6 h; when the provider fails, the cached copy (or the summary)
 *   comes back marked `stale`. A detail's documents (ParkStay's campground map) are cached
 *   with their address, which never leaves main: `get` returns them without it, and
 *   `resolveDocument` reads it back from the cache for `catalog.openDocument`.
 * - **Availability** fans out to every `bulkAvailability` provider (5 min cache) and reports
 *   each provider's failure separately. It never waits in a provider's queue: a gated
 *   provider answers with an `access-gate` error entry at once, and that error (or a
 *   `timeout`) is reused for 60 s per stay, so map pans during a queue ask nothing.
 * - **Automatic sync** (`start`) begins 5 s after the window is up and re-checks hourly,
 *   only for stale providers, and never while one of the provider's snipes is queueing or
 *   sniping (a 1.2 MB fetch must not compete with a release). While a provider has no cached
 *   locations at all (a first launch offline), a failed automatic sync is retried after
 *   1, 2 and 5 minutes before the hourly schedule takes over. Manual refresh always runs.
 * - **Freshness.** A timestamp in the future (the clock was set back) counts as stale.
 *
 * - **Search-mode catalogues** (`catalogMode: 'search'`, §12.30) cannot list every location,
 *   so they are never synced. A `search` with a map area (`bbox`) asks each of them in scope
 *   for that area (`catalog.searchArea`), and one with text asks those that have
 *   `catalog.searchText`; the answer comes from the stored catalogue at once, with those
 *   providers in `pending`. What a search finds is added to `locations` (`mergeMany`), so FTS
 *   search, filters, facets, the detail cache, availability and watches treat it as a synced
 *   place, and `catalog:updated` announces places not stored before. Bounded and polite:
 *   - the area is the box snapped outwards to a grid (`catalogSearchArea`), so small pans
 *     reuse a search, and an area inside one already searched in full is not asked again;
 *   - one search per area or text at a time (single flight), not repeated for the provider's
 *     `catalogTtlHours` (24 h by default; kept for this launch), and after a failure not
 *     for `searchErrorTtlMs` (60 s); an area inside one being searched waits for that search;
 *   - an area search follows `nextCursor` for at most `AREA_SEARCH_MAX_PAGES` (5) pages, and
 *     a text search stores at most `TEXT_SEARCH_MAX_ITEMS` (100) places;
 *   - an area the map has left is not finished: before each page after the first, a search
 *     that is no longer one of the provider's `AREA_SEARCHES_KEPT` (2) newest stops, keeps
 *     what it found, and is not repeated for `searchErrorTtlMs`; a page that fails after the
 *     first keeps the pages before it too;
 *   - at most `maxConcurrentRequests` of the provider's search calls run at once, each with a
 *     `searchTimeoutMs` (20 s) deadline, and `stop()` aborts them all.
 *
 *   Places found by a search are never removed: nothing lists the whole catalogue to tell
 *   what disappeared, and watches, snipes, bookings and links refer to them. A search that
 *   finds a place again refreshes its row; a place the provider no longer has keeps its row,
 *   and its page falls back to the stored copy marked `stale`. The last search and its error
 *   are kept in `provider_state` as `('<providerId>', 'core.catalog.search')`; `refresh()`
 *   forgets which areas and texts were searched, so the next search asks again.
 */

import {
  CATALOG_MAX_LIMIT,
  type BoundingBox,
  type CatalogAvailabilityResult,
  type CatalogProviderStatus,
  type CatalogQuery,
  type CatalogSearchResult,
  type CatalogStatus,
  type LocationDetail,
  type LocationDocument,
  type LocationNotice,
  type LocationSection,
  type LocationSummary,
} from '@shared/types/catalog.types';
import {
  providerLimits,
  type BulkAvailabilityEntry,
  type LocationAvailability,
  type ProviderId,
  type StayQuery,
} from '@shared/types/provider.types';
import type { EventSink } from '@shared/contracts/events';
import { bboxContains, catalogSearchArea } from '@shared/utils/catalog-area';
import { makeLocationKey, parseLocationKey } from '@shared/utils/location-key';
import { stayKeyFor } from '@shared/utils/stay-key';
import {
  searchWords,
  type LocationRepository,
} from '../../database/repositories/location.repository';
import type { ProviderStateRepository } from '../../database/repositories/provider-state.repository';
import type { ProviderRegistry } from '../../providers/registry';
import type { ProviderLogger } from '../../providers/sdk/context';
import { createLimiter, type Limiter } from '../../providers/sdk/concurrency';
import { sanitizeProviderHtml } from '../../providers/sdk/html';
import type {
  AccommodationProvider,
  FullCatalogModule,
  ProviderLocationDetail,
  ProviderLocationDocument,
  SearchCatalogModule,
} from '../../providers/sdk/provider';
import { AppError } from '../../utils/app-error';
import {
  catalogErrorCode,
  errorMessage,
  stayCacheKey,
  summaryFromHtml,
  withDeadline,
} from './catalog-helpers';

/** The `provider_state` key of a provider's last sync. */
export const CATALOG_SYNC_STATE_KEY = 'core.catalog.sync';

/** The `provider_state` key of a search-mode provider's last area or text search. */
export const CATALOG_SEARCH_STATE_KEY = 'core.catalog.search';

/** The most `catalog.searchArea` pages one area search follows. */
export const AREA_SEARCH_MAX_PAGES = 5;
/** The most places one `catalog.searchText` answer stores. */
export const TEXT_SEARCH_MAX_ITEMS = 100;
/** The shortest text (its words, joined by spaces) a provider is asked to search by name. */
export const TEXT_SEARCH_MIN_CHARS = 3;
/** The most area and text searches remembered at once; the oldest are forgotten first. */
export const SEARCH_MEMORY_SIZE = 500;
/**
 * How many of a provider's newest area searches go on to their next page: an older one is
 * an area the map has left.
 */
export const AREA_SEARCHES_KEPT = 2;
/** What `callForSearch` answers instead of calling the provider when told to skip. */
const SKIPPED: unique symbol = Symbol('skipped');

/** What `provider_state` keeps about a search-mode provider's searches. */
export interface CatalogSearchState {
  /** ISO timestamp of the last area or text search that answered. */
  searchedAt?: string;
  /** Why the latest search failed; absent after a success. */
  lastError?: string;
}

/** A finished area or text search, remembered so it is not repeated too soon. */
interface SearchRecord {
  providerId: ProviderId;
  /** Epoch ms it finished. */
  at: number;
  /** It failed, or stopped early (the map moved on): remembered for `searchErrorTtlMs`. */
  failed: boolean;
  /** An area search: the area searched, and whether every page of it was read. */
  area?: { bbox: BoundingBox; complete: boolean };
}

/** What a search found, before it is stored. */
interface SearchFind {
  items: LocationSummary[];
  /** An area search: true when the provider had no more pages. */
  complete: boolean;
  /** It stopped before the end: the map moved on (`superseded`) or a later page failed. */
  stopped?: { superseded: true } | { error: unknown };
}

/** An area search in flight. */
interface AreaRun {
  providerId: ProviderId;
  bbox: BoundingBox;
  /** Its place among the provider's area searches (`areaGenerations`). */
  generation: number;
}

/** What `provider_state` keeps about a provider's catalogue sync. */
export interface CatalogSyncState {
  /** ISO timestamp of the last successful sync. */
  syncedAt?: string;
  /** Locations stored by that sync. */
  count?: number;
  /** Why the latest attempt failed; absent after a success. */
  lastError?: string;
}

export interface CatalogTimings {
  /** After `start()`, before the first automatic sync. */
  startDelayMs: number;
  /** Between automatic re-checks. */
  recheckMs: number;
  /** `catalog.listLocations`. */
  syncTimeoutMs: number;
  /** `catalog.getLocation`. */
  detailTimeoutMs: number;
  /** `availability.search` and `availability.check`. */
  availabilityTimeoutMs: number;
  /** How long a cached detail is served without asking the provider. */
  detailTtlMs: number;
  /** How long a provider's bulk availability for a stay is reused. */
  bulkTtlMs: number;
  /** How long a provider's `access-gate` or `timeout` error for a stay is reused. */
  bulkErrorTtlMs: number;
  /** How long a location's availability for a stay is reused. */
  checkTtlMs: number;
  /** One `catalog.searchArea` page or `catalog.searchText` call (search-mode catalogues). */
  searchTimeoutMs: number;
  /** How long a failed area or text search is not repeated for the same area or text. */
  searchErrorTtlMs: number;
  /**
   * While a provider has no cached locations, the waits before retrying a failed automatic
   * sync, one after another; then only the hourly re-check.
   */
  emptyRetryMs: readonly number[];
}

export const DEFAULT_CATALOG_TIMINGS: Readonly<CatalogTimings> = Object.freeze({
  startDelayMs: 5_000,
  recheckMs: 3_600_000,
  syncTimeoutMs: 60_000,
  detailTimeoutMs: 20_000,
  availabilityTimeoutMs: 20_000,
  detailTtlMs: 6 * 3_600_000,
  bulkTtlMs: 5 * 60_000,
  bulkErrorTtlMs: 60_000,
  checkTtlMs: 60_000,
  searchTimeoutMs: 20_000,
  searchErrorTtlMs: 60_000,
  emptyRetryMs: Object.freeze([60_000, 2 * 60_000, 5 * 60_000]),
});

/**
 * A location's document with its address, resolved in main from the cached detail for
 * `catalog.openDocument`. Never sent to the renderer.
 */
export interface ResolvedLocationDocument extends LocationDocument {
  /** `${locationKey}#${id}`: one document window per document. */
  key: string;
  providerId: ProviderId;
  /** The provider's short name ("ParkStay"), for messages. */
  providerName: string;
  /** The location's name, for the window title. */
  locationName: string;
  /** Absolute https. */
  url: string;
}

export interface SyncOptions {
  /** Sync even when the last success is still fresh. */
  force?: boolean;
}

export interface CatalogAvailabilityFilter {
  providerIds?: ProviderId[];
  bbox?: CatalogQuery['bbox'];
}

export type CatalogLogger = Pick<ProviderLogger, 'debug' | 'info' | 'warn' | 'error'>;

export interface LocationCatalogServiceDeps {
  registry: ProviderRegistry;
  locations: LocationRepository;
  providerState: ProviderStateRepository;
  /** Where `catalog:updated` goes (the renderer events bus). */
  events: EventSink;
  logger: CatalogLogger;
  clock?: () => Date;
  /**
   * True while one of the provider's snipes is queueing or sniping. Automatic sync waits for
   * it; a manual refresh does not.
   */
  isReleaseInProgress?: (providerId: ProviderId) => boolean;
  timings?: Partial<CatalogTimings>;
}

interface Cached<T> {
  at: number;
  value: T;
}

export class LocationCatalogService {
  private readonly registry: ProviderRegistry;
  private readonly locations: LocationRepository;
  private readonly providerState: ProviderStateRepository;
  private readonly events: EventSink;
  private readonly logger: CatalogLogger;
  private readonly clock: () => Date;
  private readonly isReleaseInProgress: (providerId: ProviderId) => boolean;
  private readonly timings: CatalogTimings;

  /** Aborted by `stop()`: every provider call in flight is cancelled with it. */
  private readonly lifetime = new AbortController();
  private started = false;
  private startTimer?: ReturnType<typeof setTimeout>;
  private recheckTimer?: ReturnType<typeof setInterval>;
  /** Pending empty-cache retries, at most one per provider. */
  private readonly retryTimers = new Map<ProviderId, ReturnType<typeof setTimeout>>();
  /** Empty-cache retries used per provider; never reset, so they run once per launch. */
  private readonly retriesUsed = new Map<ProviderId, number>();

  private readonly syncs = new Map<ProviderId, Promise<void>>();
  private readonly details = new Map<string, Promise<ProviderLocationDetail>>();
  private readonly bulk = new Map<string, Promise<BulkAvailabilityEntry[]>>();
  private readonly bulkCache = new Map<string, Cached<BulkAvailabilityEntry[]>>();
  /** `access-gate` and `timeout` failures of bulk availability, by provider and stay. */
  private readonly bulkErrorCache = new Map<string, Cached<unknown>>();
  private readonly checks = new Map<string, Promise<LocationAvailability>>();
  private readonly checkCache = new Map<string, Cached<LocationAvailability>>();
  /** Area and text searches in flight, by `searchKey`. */
  private readonly searchRuns = new Map<string, Promise<void>>();
  /** Finished area and text searches, by `searchKey`, oldest first. */
  private readonly searchMemory = new Map<string, SearchRecord>();
  /** Each search-mode provider's cap on its search calls in flight. */
  private readonly searchLimiters = new Map<ProviderId, Limiter>();
  /** Area searches in flight, by `searchKey`. */
  private readonly areaRuns = new Map<string, AreaRun>();
  /** How many area searches each provider has started. */
  private readonly areaGenerations = new Map<ProviderId, number>();
  /** Whether a search has already warned that it matched more than a search returns. */
  private warnedSearchCap = false;

  constructor(deps: LocationCatalogServiceDeps) {
    this.registry = deps.registry;
    this.locations = deps.locations;
    this.providerState = deps.providerState;
    this.events = deps.events;
    this.logger = deps.logger;
    this.clock = deps.clock ?? (() => new Date());
    this.isReleaseInProgress = deps.isReleaseInProgress ?? (() => false);
    this.timings = { ...DEFAULT_CATALOG_TIMINGS, ...deps.timings };
  }

  // -------------------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------------------

  /**
   * Starts automatic sync: stale providers sync `startDelayMs` (5 s) from now, then every
   * `recheckMs` (hourly). A provider still without any cached location after an automatic
   * attempt is retried after each of `emptyRetryMs` (1, 2, 5 min) in turn. Call it once the
   * main window is up. Safe to call twice.
   */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.startTimer = setTimeout(() => {
      this.startTimer = undefined;
      this.autoSync();
      this.recheckTimer = setInterval(() => this.autoSync(), this.timings.recheckMs);
    }, this.timings.startDelayMs);
  }

  /**
   * Stops for good (on quit): no more automatic syncs, and every provider call in flight is
   * aborted, so nothing is written after the database closes.
   */
  stop(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.recheckTimer) clearInterval(this.recheckTimer);
    this.startTimer = undefined;
    this.recheckTimer = undefined;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.lifetime.abort();
  }

  private get stopped(): boolean {
    return this.lifetime.signal.aborted;
  }

  // -------------------------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------------------------

  /**
   * Syncs one catalogue provider, or every one. A provider whose last success is under its
   * `catalogTtlHours` old is skipped unless `force`. Never rejects for a provider's failure:
   * that is recorded and shows in `status()`. Throws `UnknownProviderError` or
   * `ProviderCapabilityError` for a `providerId` that cannot be synced.
   */
  async sync(providerId?: ProviderId, options: SyncOptions = {}): Promise<void> {
    const providers = providerId
      ? [this.registry.require(providerId, 'catalog')]
      : this.catalogProviders();
    await Promise.allSettled(providers.map((p) => this.syncProvider(p, options.force === true)));
  }

  /**
   * `sync(providerId, { force: true })`, then the status. For search-mode catalogues it
   * forgets which areas and texts were searched (and which failed), so the next search with
   * an area or text asks the provider again.
   */
  async refresh(providerId?: ProviderId): Promise<CatalogStatus> {
    for (const [key, record] of this.searchMemory) {
      if (!providerId || record.providerId === providerId) this.searchMemory.delete(key);
    }
    await this.sync(providerId, { force: true });
    return this.status();
  }

  /**
   * Each catalogue provider's cache: count, last success, staleness, syncing, last error. A
   * search-mode catalogue is never stale; `syncing` means a search is in flight, `lastError`
   * is its last search's failure, and `search` says whether it searches by name and when it
   * last answered.
   */
  status(): CatalogStatus {
    const counts = this.locations.countByProvider();
    const providers = this.catalogProviders().map((provider): CatalogProviderStatus => {
      const id = provider.manifest.id;
      if (!this.syncableMode(provider)) {
        const searched = this.searchState(id);
        return {
          providerId: id,
          count: counts[id] ?? 0,
          stale: false,
          syncing: this.isSearching(id),
          ...(searched?.lastError ? { lastError: searched.lastError } : {}),
          search: {
            textSearch: typeof provider.catalog?.searchText === 'function',
            ...(searched?.searchedAt ? { searchedAt: searched.searchedAt } : {}),
          },
        };
      }
      const state = this.syncState(id);
      return {
        providerId: id,
        count: counts[id] ?? 0,
        ...(state?.syncedAt ? { syncedAt: state.syncedAt } : {}),
        stale: !this.isFresh(provider, state),
        syncing: this.syncs.has(id),
        ...(state?.lastError ? { lastError: state.lastError } : {}),
      };
    });
    return { providers };
  }

  /**
   * The automatic sync: stale providers only (or just `only`), and none that is mid-release.
   * Each attempt, made or waiting, is followed by `retryWhileEmpty`.
   */
  private autoSync(only?: AccommodationProvider): void {
    if (this.stopped) return;
    const stale = (only ? [only] : this.catalogProviders()).filter(
      (provider) =>
        this.syncableMode(provider) && !this.isFresh(provider, this.syncState(provider.manifest.id))
    );
    for (const provider of stale) {
      const id = provider.manifest.id;
      if (this.isReleaseInProgress(id)) {
        this.logger.info(`Catalogue sync for ${id} waits: one of its snipes is in a release`);
        this.retryWhileEmpty(provider);
        continue;
      }
      void this.syncProvider(provider, false).then(() => this.retryWhileEmpty(provider));
    }
  }

  /**
   * After an automatic attempt: while the provider has no cached location and is still not
   * fresh (a first launch offline), schedules the next of `emptyRetryMs`. Bounded, one timer
   * per provider, and a no-op once rows exist, so it can never become a request loop.
   */
  private retryWhileEmpty(provider: AccommodationProvider): void {
    const id = provider.manifest.id;
    if (this.stopped || this.retryTimers.has(id) || this.hasRows(id)) return;
    if (this.isFresh(provider, this.syncState(id))) return;
    const used = this.retriesUsed.get(id) ?? 0;
    const delay = this.timings.emptyRetryMs[used];
    if (delay === undefined) return;
    this.retriesUsed.set(id, used + 1);
    this.logger.info(`Catalogue of ${id} is empty; retrying in ${Math.round(delay / 1000)} s`);
    this.retryTimers.set(
      id,
      setTimeout(() => {
        this.retryTimers.delete(id);
        if (!this.hasRows(id)) this.autoSync(provider);
      }, delay)
    );
  }

  private hasRows(id: ProviderId): boolean {
    return (this.locations.countByProvider()[id] ?? 0) > 0;
  }

  private syncProvider(provider: AccommodationProvider, force: boolean): Promise<void> {
    const id = provider.manifest.id;
    const running = this.syncs.get(id);
    if (running) return running;
    if (this.stopped || !this.syncableMode(provider)) return Promise.resolve();
    if (!force && this.isFresh(provider, this.syncState(id))) return Promise.resolve();

    const run = this.runSync(id, provider.catalog as FullCatalogModule).finally(() => {
      this.syncs.delete(id);
    });
    this.syncs.set(id, run);
    return run;
  }

  /** One sync. Resolves either way; a failure is recorded, never thrown. */
  private async runSync(id: ProviderId, catalog: FullCatalogModule): Promise<void> {
    try {
      const listed = await withDeadline(id, this.timings.syncTimeoutMs, this.lifetime.signal, (s) =>
        catalog.listLocations(s)
      );
      if (this.stopped) return;
      if (!Array.isArray(listed)) throw new Error(`${id} did not list its locations`);
      const cached = this.locations.countByProvider()[id] ?? 0;
      if (listed.length === 0 && cached > 0) {
        throw new Error(`${id} listed no locations; the ${cached} cached ones are kept`);
      }
      const at = this.clock();
      this.locations.upsertMany(id, listed, at);
      const syncedAt = at.toISOString();
      this.writeSyncState(id, { syncedAt, count: listed.length }, at);
      this.logger.info(`Catalogue of ${id} synced: ${listed.length} locations`);
      this.events.emit('catalog:updated', { providerId: id, count: listed.length, syncedAt });
    } catch (error) {
      // Quitting (stop aborted the call): the database is closing, so nothing is written.
      if (this.stopped) return;
      const lastError = errorMessage(error);
      this.logger.warn(`Catalogue sync for ${id} failed; the cached locations are kept`, error);
      const previous = this.syncState(id);
      this.writeSyncState(id, { ...previous, lastError }, this.clock());
    }
  }

  private catalogProviders(): AccommodationProvider[] {
    return this.registry.withCapability('catalog');
  }

  /** Whether the provider's catalogue is synced here (`full`) or searched live (`search`). */
  private syncableMode(provider: AccommodationProvider): boolean {
    return provider.manifest.capabilities.catalogMode === 'full';
  }

  private isFresh(provider: AccommodationProvider, state: CatalogSyncState | undefined): boolean {
    const syncedAt = state?.syncedAt ? Date.parse(state.syncedAt) : NaN;
    const ttlMs = providerLimits(provider.manifest).catalogTtlHours * 3_600_000;
    return this.within(syncedAt, ttlMs);
  }

  /**
   * Whether something from `at` (epoch ms) is under `ttlMs` old. A time in the future (the
   * clock was set back) or an invalid one is not.
   */
  private within(at: number, ttlMs: number): boolean {
    if (!Number.isFinite(at)) return false;
    const age = this.clock().getTime() - at;
    return age >= 0 && age < ttlMs;
  }

  private syncState(id: ProviderId): CatalogSyncState | undefined {
    return this.providerState.get<CatalogSyncState>(id, CATALOG_SYNC_STATE_KEY);
  }

  private writeSyncState(id: ProviderId, state: CatalogSyncState, at: Date): void {
    this.providerState.set(id, CATALOG_SYNC_STATE_KEY, state, at);
  }

  // -------------------------------------------------------------------------------------
  // Search-mode catalogues
  // -------------------------------------------------------------------------------------

  /**
   * Starts (or joins) an area search for `query.bbox` and a text search for `query.text` in
   * each search-mode catalogue the query covers. Returns the ids of those with a search in
   * flight for it. Never throws and never waits.
   */
  private searchProviders(
    providers: readonly AccommodationProvider[],
    query: CatalogQuery
  ): ProviderId[] {
    if (this.stopped || (!query.bbox && !query.text)) return [];
    const wanted = query.providerIds?.length ? new Set(query.providerIds) : undefined;
    const area = query.bbox ? catalogSearchArea(query.bbox) : undefined;
    const text = searchWords(query.text).join(' ');
    const pending: ProviderId[] = [];
    for (const provider of providers) {
      const id = provider.manifest.id;
      if (this.syncableMode(provider) || (wanted && !wanted.has(id))) continue;
      const catalog = provider.catalog as SearchCatalogModule;
      const asked = [
        area ? this.searchArea(provider, catalog, area.key, area.bbox) : false,
        text.length >= TEXT_SEARCH_MIN_CHARS && typeof catalog.searchText === 'function'
          ? this.searchText(provider, catalog, text)
          : false,
      ];
      if (asked.includes(true)) pending.push(id);
    }
    return pending;
  }

  /**
   * One area of a search-mode catalogue: up to `AREA_SEARCH_MAX_PAGES` pages of
   * `catalog.searchArea` over the snapped area, stopping early once the map has moved on.
   * True when a search for it (or for an area containing it) is in flight.
   */
  private searchArea(
    provider: AccommodationProvider,
    catalog: SearchCatalogModule,
    areaKey: string,
    bbox: BoundingBox
  ): boolean {
    const id = provider.manifest.id;
    const key = searchKey(id, 'area', areaKey);
    if (this.searchRuns.has(key) || this.searchingAround(id, bbox)) return true;
    if (this.searchedRecently(provider, key) || this.searchedInFull(provider, bbox)) return false;
    const generation = (this.areaGenerations.get(id) ?? 0) + 1;
    this.areaGenerations.set(id, generation);
    this.areaRuns.set(key, { providerId: id, bbox, generation });
    // Not one of the provider's newest area searches: the map has moved on.
    const superseded = (): boolean =>
      (this.areaGenerations.get(id) ?? 0) - generation >= AREA_SEARCHES_KEPT;
    void this.runSearch(provider, key, bbox, async () => {
      const items: LocationSummary[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < AREA_SEARCH_MAX_PAGES; page++) {
        let result: Awaited<ReturnType<SearchCatalogModule['searchArea']>> | typeof SKIPPED;
        try {
          result = await this.callForSearch(
            provider,
            (signal) =>
              catalog.searchArea({ bbox, ...(cursor === undefined ? {} : { cursor }) }, signal),
            page > 0 ? superseded : undefined
          );
        } catch (error) {
          // The pages before a failing one are kept (not when quitting: nothing is written).
          if (page === 0 || this.stopped) throw error;
          return { items, complete: false, stopped: { error } };
        }
        if (result === SKIPPED) return { items, complete: false, stopped: { superseded: true } };
        if (!Array.isArray(result?.items)) throw new Error(`${id} did not answer an area search`);
        items.push(...result.items);
        const next = result.nextCursor;
        if (typeof next !== 'string' || next === '') return { items, complete: true };
        // A cursor that comes back unchanged would ask for the same page again.
        if (next === cursor) break;
        cursor = next;
      }
      return { items, complete: false };
    }).finally(() => this.areaRuns.delete(key));
    return true;
  }

  /** Whether an area search in flight for the provider covers `bbox`. */
  private searchingAround(id: ProviderId, bbox: BoundingBox): boolean {
    for (const run of this.areaRuns.values()) {
      if (run.providerId === id && bboxContains(run.bbox, bbox)) return true;
    }
    return false;
  }

  /** One text for a catalogue with `catalog.searchText`. True when a search for it is in flight. */
  private searchText(
    provider: AccommodationProvider,
    catalog: SearchCatalogModule,
    text: string
  ): boolean {
    const id = provider.manifest.id;
    const key = searchKey(id, 'text', text.toLocaleLowerCase('en-AU'));
    if (this.searchRuns.has(key)) return true;
    if (this.searchedRecently(provider, key)) return false;
    void this.runSearch(provider, key, undefined, async () => {
      const items = await this.callForSearch(provider, (signal) =>
        catalog.searchText!(text, signal)
      );
      if (items === SKIPPED || !Array.isArray(items)) {
        throw new Error(`${id} did not answer a text search`);
      }
      return { items: items.slice(0, TEXT_SEARCH_MAX_ITEMS), complete: true };
    });
    return true;
  }

  /**
   * Runs one search in the background, single flight under `key`: stores what it finds,
   * remembers the outcome, records the provider's search state, and announces places that
   * were not stored before. A failure is recorded, never thrown (the promise always
   * resolves); after `stop()` nothing is written. A search that stopped early stores what it
   * found and is remembered for `searchErrorTtlMs` only, so the area is asked again later.
   */
  private runSearch(
    provider: AccommodationProvider,
    key: string,
    bbox: BoundingBox | undefined,
    find: () => Promise<SearchFind>
  ): Promise<void> {
    const id = provider.manifest.id;
    const run = (async (): Promise<void> => {
      try {
        const { items, complete, stopped } = await find();
        if (this.stopped) return;
        const at = this.clock();
        const { stored, added } = this.locations.mergeMany(id, items, at);
        const searchedAt = at.toISOString();
        this.rememberSearch(key, {
          providerId: id,
          at: at.getTime(),
          failed: stopped !== undefined,
          ...(bbox ? { area: { bbox, complete } } : {}),
        });
        if (stopped && 'error' in stopped) {
          this.recordSearchFailure(id, stopped.error, at);
        } else {
          this.providerState.set(id, CATALOG_SEARCH_STATE_KEY, { searchedAt }, at);
        }
        this.logger.info(
          `Catalogue search of ${id} stored ${stored} locations (${added} new)` +
            (stopped && 'superseded' in stopped ? '; stopped early, the map moved on' : '')
        );
        if (added > 0) {
          this.events.emit('catalog:updated', {
            providerId: id,
            count: stored,
            syncedAt: searchedAt,
          });
        }
      } catch (error) {
        // Quitting (stop aborted the call): the database is closing, so nothing is written.
        if (this.stopped) return;
        const at = this.clock();
        this.rememberSearch(key, { providerId: id, at: at.getTime(), failed: true });
        this.recordSearchFailure(id, error, at);
      }
    })().finally(() => this.searchRuns.delete(key));
    this.searchRuns.set(key, run);
    return run;
  }

  private recordSearchFailure(id: ProviderId, error: unknown, at: Date): void {
    this.logger.warn(`Catalogue search of ${id} failed`, error);
    this.providerState.set(
      id,
      CATALOG_SEARCH_STATE_KEY,
      { ...this.searchState(id), lastError: errorMessage(error) },
      at
    );
  }

  /**
   * A provider call for a search: within the provider's concurrency cap, with a deadline.
   * When its turn comes, `skip()` true answers `SKIPPED` without calling the provider.
   */
  private callForSearch<T>(
    provider: AccommodationProvider,
    task: (signal: AbortSignal) => Promise<T>,
    skip?: () => boolean
  ): Promise<T | typeof SKIPPED> {
    const id = provider.manifest.id;
    let limiter = this.searchLimiters.get(id);
    if (!limiter) {
      limiter = createLimiter(providerLimits(provider.manifest).maxConcurrentRequests);
      this.searchLimiters.set(id, limiter);
    }
    return limiter<T | typeof SKIPPED>(() =>
      skip?.()
        ? Promise.resolve(SKIPPED)
        : withDeadline(id, this.timings.searchTimeoutMs, this.lifetime.signal, task)
    );
  }

  /**
   * Whether `key` was searched within the provider's `catalogTtlHours`, or failed within
   * `searchErrorTtlMs`.
   */
  private searchedRecently(provider: AccommodationProvider, key: string): boolean {
    const record = this.searchMemory.get(key);
    return Boolean(record && this.within(record.at, this.searchTtlMs(provider, record)));
  }

  /** Whether an area containing `bbox` was searched in full (every page) within its TTL. */
  private searchedInFull(provider: AccommodationProvider, bbox: BoundingBox): boolean {
    const id = provider.manifest.id;
    for (const record of this.searchMemory.values()) {
      if (
        record.providerId === id &&
        record.area?.complete &&
        bboxContains(record.area.bbox, bbox) &&
        this.within(record.at, this.searchTtlMs(provider, record))
      ) {
        return true;
      }
    }
    return false;
  }

  private searchTtlMs(provider: AccommodationProvider, record: SearchRecord): number {
    return record.failed
      ? this.timings.searchErrorTtlMs
      : providerLimits(provider.manifest).catalogTtlHours * 3_600_000;
  }

  /** Remembers a finished search as the newest, forgetting the oldest beyond the limit. */
  private rememberSearch(key: string, record: SearchRecord): void {
    this.searchMemory.delete(key);
    this.searchMemory.set(key, record);
    for (const oldest of this.searchMemory.keys()) {
      if (this.searchMemory.size <= SEARCH_MEMORY_SIZE) break;
      this.searchMemory.delete(oldest);
    }
  }

  private isSearching(id: ProviderId): boolean {
    for (const key of this.searchRuns.keys()) if (key.startsWith(`${id}|`)) return true;
    return false;
  }

  private searchState(id: ProviderId): CatalogSearchState | undefined {
    return this.providerState.get<CatalogSearchState>(id, CATALOG_SEARCH_STATE_KEY);
  }

  // -------------------------------------------------------------------------------------
  // Search and detail
  // -------------------------------------------------------------------------------------

  /**
   * Searches the stored catalogues of the registered catalogue providers, at once. With an
   * area (`bbox`) or text, it first asks the search-mode catalogues in scope about it in the
   * background (see the header); those with a search in flight for it are listed in
   * `pending`, and the places they add arrive with `catalog:updated`.
   */
  search(query: CatalogQuery): CatalogSearchResult {
    const providers = this.catalogProviders();
    const pending = this.searchProviders(providers, query);
    const result = this.locations.search(
      query,
      providers.map((p) => p.manifest.id)
    );
    this.warnIfCapped(query, result);
    return pending.length ? { ...result, pending } : result;
  }

  /**
   * Warns once per launch when a search for everything (`limit` 5000, Explore's) matched more
   * locations than it returns: Explore then leaves places out. Search-mode places are kept for
   * good, so a busy search-mode provider can get there.
   */
  private warnIfCapped(query: CatalogQuery, result: CatalogSearchResult): void {
    if (this.warnedSearchCap || query.offset) return;
    if ((query.limit ?? CATALOG_MAX_LIMIT) < CATALOG_MAX_LIMIT) return;
    if (result.total <= result.items.length) return;
    this.warnedSearchCap = true;
    this.logger.warn(
      `A catalogue search matched ${result.total} locations, more than the ` +
        `${CATALOG_MAX_LIMIT} a search returns: Explore leaves some places out`
    );
  }

  /**
   * A location's detail: the cached copy while it is under 6 h old, otherwise fresh from the
   * provider (sanitised again here, for every provider) and cached. When the provider fails,
   * the cached copy, or else the summary with no units, comes back with `stale: true`.
   * Throws `AppError('NOT_FOUND')` for a key that is not in a registered catalogue.
   */
  async get(key: string): Promise<LocationDetail> {
    const { providerId, externalId } = parseLocationKey(key);
    const provider = this.registry.tryGet(providerId);
    const summary = provider?.manifest.capabilities.catalog
      ? this.locations.get(providerId, externalId)
      : null;
    if (!provider?.catalog || !summary) {
      throw new AppError('NOT_FOUND', `There is no location ${key}`);
    }

    const cached = this.locations.getDetail(providerId, externalId);
    if (cached && this.within(cached.fetchedAt.getTime(), this.timings.detailTtlMs)) {
      return publicDetail({ ...cached.detail, fetchedAt: cached.fetchedAt.toISOString() });
    }

    const cacheKey = makeLocationKey(providerId, externalId);
    let pending = this.details.get(cacheKey);
    if (!pending) {
      pending = this.fetchDetail(provider, summary, cached?.detail).finally(() =>
        this.details.delete(cacheKey)
      );
      this.details.set(cacheKey, pending);
    }
    try {
      return publicDetail(await pending);
    } catch (error) {
      if (this.stopped) throw error;
      this.logger.warn(`Detail of ${cacheKey} could not be fetched; serving the cache`, error);
      if (cached) {
        return publicDetail({
          ...cached.detail,
          fetchedAt: cached.fetchedAt.toISOString(),
          stale: true,
        });
      }
      return { ...summary, units: [], stale: true };
    }
  }

  /**
   * A location's document, with its address, from the cached detail (fetched first when none
   * is cached). The renderer names the document by the location's key and the document's id;
   * the address only ever comes from here. `NOT_FOUND` for an unknown location or document,
   * or one whose address is not https.
   */
  async resolveDocument(key: string, documentId: string): Promise<ResolvedLocationDocument> {
    const { providerId, externalId } = parseLocationKey(key);
    let cached = this.locations.getDetail(providerId, externalId);
    if (!cached) {
      // Throws NOT_FOUND for a location that is not in a registered catalogue
      await this.get(key);
      cached = this.locations.getDetail(providerId, externalId);
    }
    const provider = this.registry.tryGet(providerId);
    if (!provider?.catalog || !cached) {
      throw new AppError('NOT_FOUND', `There is no location ${key}`);
    }
    const document = cleanDocuments(cached.detail.documents).find((d) => d.id === documentId);
    if (!document) {
      throw new AppError('NOT_FOUND', `${key} has no document ${documentId}`);
    }
    return {
      ...document,
      key: `${makeLocationKey(providerId, externalId)}#${document.id}`,
      providerId,
      providerName: provider.manifest.shortName,
      locationName: cached.detail.name,
    };
  }

  private async fetchDetail(
    provider: AccommodationProvider,
    summary: LocationSummary,
    previous: ProviderLocationDetail | undefined
  ): Promise<ProviderLocationDetail> {
    const { providerId, externalId } = summary;
    const fetched = await withDeadline(
      providerId,
      this.timings.detailTimeoutMs,
      this.lifetime.signal,
      (signal) =>
        provider.catalog!.getLocation(externalId, signal, {
          summary,
          ...(previous ? { previous } : {}),
        })
    );
    const at = this.clock();
    // Defence in depth: whatever the provider did, main sanitises before IPC.
    // The place's photos are its gallery; the description does not repeat them.
    const dropImages = Array.isArray(fetched.imageUrls) ? fetched.imageUrls : [];
    const descriptionHtml = fetched.descriptionHtml
      ? sanitizeProviderHtml(fetched.descriptionHtml, provider.manifest.website, { dropImages })
      : undefined;
    const sections = cleanSections(fetched.sections, provider.manifest.website, dropImages);
    const notices = cleanNotices(fetched.notices);
    const documents = cleanDocuments(fetched.documents);
    const detail: ProviderLocationDetail = {
      ...fetched,
      key: summary.key,
      providerId,
      externalId,
      units: Array.isArray(fetched.units) ? fetched.units : [],
      fetchedAt: at.toISOString(),
      documents,
    };
    if (descriptionHtml) detail.descriptionHtml = descriptionHtml;
    else delete detail.descriptionHtml;
    if (sections.length > 0) detail.sections = sections;
    else delete detail.sections;
    if (notices.length > 0) detail.notices = notices;
    else delete detail.notices;
    if (documents.length > 0) detail.documents = documents;
    else delete detail.documents;
    delete detail.stale;

    if (this.stopped) return detail;
    this.locations.setDetail(providerId, externalId, detail, at);
    // The first section is the intro when a provider gives its description in sections.
    const derived = summary.summary
      ? undefined
      : summaryFromHtml(descriptionHtml ?? sections[0]?.html);
    if (derived) this.locations.setSummaryIfEmpty(providerId, externalId, derived);
    return detail;
  }

  // -------------------------------------------------------------------------------------
  // Availability
  // -------------------------------------------------------------------------------------

  /**
   * Bulk availability for `stay` from every `bulkAvailability` provider (or those in
   * `providerIds`; unknown ids are ignored), in parallel. Entries are limited to locations in
   * the catalogue, and to `bbox` when given. A provider that fails is listed in `errors`
   * while the others still answer. Each provider's answer is reused for 5 minutes per stay
   * (keyed by the stay fields its manifest says the answer depends on), and its `access-gate`
   * or `timeout` error for 60 s.
   */
  async availability(
    stay: StayQuery,
    filter: CatalogAvailabilityFilter = {}
  ): Promise<CatalogAvailabilityResult> {
    const wanted = filter.providerIds?.length ? new Set(filter.providerIds) : undefined;
    const providers = this.registry
      .withCapability('bulkAvailability')
      .filter((p) => !wanted || wanted.has(p.manifest.id));
    // Each provider's answer is keyed by the stay fields it reads, so a change it ignores (the
    // party, for ParkStay) reuses the answer.
    const settled = await Promise.allSettled(
      providers.map((p) =>
        this.bulkFor(
          p.manifest.id,
          (signal) => p.availability.search(stay, signal),
          stayKeyFor(stay, p.manifest.bulkAvailabilityStayFields)
        )
      )
    );

    const result: CatalogAvailabilityResult = { entries: [], errors: [] };
    settled.forEach((outcome, i) => {
      const providerId = providers[i].manifest.id;
      if (outcome.status === 'rejected') {
        result.errors.push({
          providerId,
          code: catalogErrorCode(outcome.reason),
          message: errorMessage(outcome.reason),
        });
        return;
      }
      const known = this.locations.externalIds(providerId, filter.bbox);
      for (const entry of outcome.value) {
        const parts = safeParseKey(entry.key);
        if (parts?.providerId === providerId && known.has(parts.externalId)) {
          result.entries.push(entry);
        }
      }
    });
    return result;
  }

  /**
   * One provider's bulk availability for a stay: cached, single-flight, with a deadline. An
   * `access-gate` or `timeout` failure is cached too (for `bulkErrorTtlMs`), so while a
   * queue is up the provider is not asked again for every map pan.
   */
  private bulkFor(
    providerId: ProviderId,
    search: (signal: AbortSignal) => Promise<BulkAvailabilityEntry[]>,
    stayKey: string
  ): Promise<BulkAvailabilityEntry[]> {
    const key = `${providerId}|${stayKey}`;
    const hit = this.bulkCache.get(key);
    if (hit && this.within(hit.at, this.timings.bulkTtlMs)) return Promise.resolve(hit.value);
    const failed = this.bulkErrorCache.get(key);
    if (failed && this.within(failed.at, this.timings.bulkErrorTtlMs)) {
      return Promise.reject(failed.value);
    }
    const running = this.bulk.get(key);
    if (running) return running;

    const run = withDeadline(
      providerId,
      this.timings.availabilityTimeoutMs,
      this.lifetime.signal,
      search
    )
      .then(
        (entries) => {
          // Keyed by the stay it answers, so a stay that changed meanwhile is never filled.
          this.bulkErrorCache.delete(key);
          this.remember(this.bulkCache, key, entries, this.timings.bulkTtlMs);
          return entries;
        },
        (error: unknown) => {
          const code = catalogErrorCode(error);
          if (!this.stopped && (code === 'access-gate' || code === 'timeout')) {
            this.remember(this.bulkErrorCache, key, error, this.timings.bulkErrorTtlMs);
          }
          throw error;
        }
      )
      .finally(() => this.bulk.delete(key));
    this.bulk.set(key, run);
    return run;
  }

  /**
   * One location's availability for `stay`, unit by unit and night by night. Reused for
   * 60 s per location and stay. Throws `UnknownProviderError`, `ProviderCapabilityError` or
   * the provider's error.
   */
  checkLocation(key: string, stay: StayQuery): Promise<LocationAvailability> {
    const { providerId, externalId } = parseLocationKey(key);
    const provider = this.registry.require(providerId, 'availability');
    const cacheKey = `${makeLocationKey(providerId, externalId)}|${stayCacheKey(stay)}`;
    const hit = this.checkCache.get(cacheKey);
    if (hit && this.within(hit.at, this.timings.checkTtlMs)) return Promise.resolve(hit.value);
    const running = this.checks.get(cacheKey);
    if (running) return running;

    const run = withDeadline(
      providerId,
      this.timings.availabilityTimeoutMs,
      this.lifetime.signal,
      (signal) => provider.availability.check(externalId, stay, { signal })
    )
      .then((availability) => {
        this.remember(this.checkCache, cacheKey, availability, this.timings.checkTtlMs);
        return availability;
      })
      .finally(() => this.checks.delete(cacheKey));
    this.checks.set(cacheKey, run);
    return run;
  }

  /** Caches `value` and drops entries that have expired, so the caches stay small. */
  private remember<T>(cache: Map<string, Cached<T>>, key: string, value: T, ttlMs: number): void {
    for (const [k, entry] of cache) if (!this.within(entry.at, ttlMs)) cache.delete(k);
    cache.set(key, { at: this.clock().getTime(), value });
  }
}

const NOTICE_LEVELS: ReadonlySet<string> = new Set(['warning', 'caution', 'info']);

/** Whether an HTML fragment has any text once its tags are left out. */
const hasText = (html: string): boolean => /\S/.test(html.replace(/<[^>]*>/g, ''));

/**
 * A provider's sections, sanitised (their headings under the section's `h3` title) and kept
 * only with a title and some text or an image.
 */
function cleanSections(
  sections: unknown,
  website: string,
  dropImages: readonly string[]
): LocationSection[] {
  if (!Array.isArray(sections)) return [];
  const clean: LocationSection[] = [];
  for (const section of sections as Array<Partial<LocationSection> | null>) {
    const title = typeof section?.title === 'string' ? section.title.trim() : '';
    if (!title || typeof section?.html !== 'string') continue;
    const html = sanitizeProviderHtml(section.html, website, { dropImages, topHeading: 4 });
    if (hasText(html) || /<img\b/.test(html)) clean.push({ title, html });
  }
  return clean;
}

/** A provider's notices with a known level and some text, trimmed. */
function cleanNotices(notices: unknown): LocationNotice[] {
  if (!Array.isArray(notices)) return [];
  const clean: LocationNotice[] = [];
  for (const notice of notices as Array<Partial<LocationNotice> | null>) {
    const text = typeof notice?.text === 'string' ? notice.text.trim() : '';
    if (text && typeof notice?.level === 'string' && NOTICE_LEVELS.has(notice.level)) {
      clean.push({ level: notice.level, text });
    }
  }
  return clean;
}

const DOCUMENT_KINDS: ReadonlySet<string> = new Set(['map', 'document']);

/**
 * A provider's documents with an id (unique), a known kind, a title, a media type and an
 * absolute https address with no user name or password; the others are dropped.
 */
function cleanDocuments(documents: unknown): ProviderLocationDocument[] {
  if (!Array.isArray(documents)) return [];
  const clean: ProviderLocationDocument[] = [];
  for (const document of documents as Array<Partial<ProviderLocationDocument> | null>) {
    const id = typeof document?.id === 'string' ? document.id.trim() : '';
    const title = typeof document?.title === 'string' ? document.title.trim() : '';
    const mediaType = typeof document?.mediaType === 'string' ? document.mediaType.trim() : '';
    const kind = document?.kind;
    const url = httpsUrl(document?.url);
    if (!id || !title || !mediaType || !url || clean.some((d) => d.id === id)) continue;
    if (typeof kind !== 'string' || !DOCUMENT_KINDS.has(kind)) continue;
    clean.push({ id, kind, title, mediaType, url });
  }
  return clean;
}

/** `value` as an absolute https URL without credentials, or undefined. */
function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The detail as it crosses IPC: its documents without their address (or no `documents` when
 * none is left).
 */
function publicDetail(detail: ProviderLocationDetail): LocationDetail {
  const { documents, ...rest } = detail;
  const listed: LocationDocument[] = cleanDocuments(documents).map(
    ({ id, kind, title, mediaType }) => ({ id, kind, title, mediaType })
  );
  return listed.length > 0 ? { ...rest, documents: listed } : rest;
}

function safeParseKey(key: unknown): ReturnType<typeof parseLocationKey> | undefined {
  if (typeof key !== 'string') return undefined;
  try {
    return parseLocationKey(key);
  } catch {
    return undefined;
  }
}

/** The single-flight and memory key of an area or text search. */
function searchKey(providerId: ProviderId, kind: 'area' | 'text', what: string): string {
  return `${providerId}|${kind}|${what}`;
}
