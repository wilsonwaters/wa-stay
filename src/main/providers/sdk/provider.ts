/**
 * `AccommodationProvider`: what a provider module implements (architecture-notes §3, §12).
 * Main-process only; the serialisable types it returns live in `shared/types`.
 *
 * A provider is a manifest plus optional modules. Core services resolve a provider through
 * the registry and check `manifest.capabilities` (or `registry.require`) before using a
 * module; the registry rejects a manifest that claims a capability without its module.
 *
 * Adding a provider: create `src/main/providers/<id>/`, export a `ProviderFactory` made with
 * `defineProvider(manifest, create)`, and add it to `BUILT_IN_PROVIDERS` in
 * `providers/index.ts`. The manifest comes first so the registry can validate it and build
 * the provider's context (time zone, limits) before `create` runs.
 */

import type {
  AccessStatus,
  AccountFieldDescriptor,
  AccountStatus,
  BulkAvailabilityEntry,
  LocationAvailability,
  ProviderAuthKind,
  ProviderId,
  ProviderManifest,
  StayParams,
  StayQuery,
} from '@shared/types/provider.types';
import type {
  BoundingBox,
  LocationDetail,
  LocationDocument,
  LocationSummary,
} from '@shared/types/catalog.types';
import type { SnipeReleaseMode } from '@shared/types/common.types';
import type { BrowserAutomation } from './browser';
import type { ProviderContext } from './context';
import type { HttpClient } from './http';

/** A `catalog.searchArea` request: one page of the locations in a map area. */
export interface CatalogAreaQuery {
  bbox: BoundingBox;
  /** Narrows to locations bookable for the stay, when the provider can. */
  stay?: StayQuery;
  /** `nextCursor` from the previous page; omit for the first page. */
  cursor?: string;
}

export interface CatalogAreaPage {
  items: LocationSummary[];
  /** Present when there are more pages. */
  nextCursor?: string;
}

/**
 * A document as the provider gives it: what the place page sees, plus its address. The core
 * keeps `url` main-side, with the cached detail, and opens it in a document window; it never
 * crosses IPC. It must be an absolute https URL on the provider's own site (ParkStay refuses
 * any other); the core drops a document without one.
 */
export interface ProviderLocationDocument extends LocationDocument {
  url: string;
}

/**
 * `catalog.getLocation`'s answer with documents: a `LocationDetail` whose documents carry their
 * address. A plain `LocationDetail` is accepted too; documents without an address are dropped.
 */
export interface ProviderLocationDetail extends Omit<LocationDetail, 'documents'> {
  documents?: ProviderLocationDocument[];
}

/** What the caller already knows about a location it asks the detail of. */
export interface GetLocationOptions {
  /**
   * The location's summary from the stored catalogue. A provider may build the detail on it
   * instead of listing its catalogue again (ParkStay: no 1.2 MB map download).
   */
  summary?: LocationSummary;
  /**
   * The detail the core last stored for the location, however old. A provider may reuse part
   * of it when one of its sources fails (ParkStay keeps its campground page's sections).
   */
  previous?: ProviderLocationDetail;
}

/**
 * The provider's locations. Which listing method it has follows
 * `manifest.capabilities.catalogMode` (the registry checks it).
 */
export interface CatalogModule {
  /** Every location (`catalogMode: 'full'`). */
  listLocations?(signal?: AbortSignal): Promise<LocationSummary[]>;
  /**
   * The locations in a map area, a page at a time (`catalogMode: 'search'`). The core asks for
   * the area Explore's map shows (snapped outwards to a grid), follows `nextCursor` for at most
   * a few pages, and stores what it gets, so the places work everywhere a synced one does.
   */
  searchArea?(query: CatalogAreaQuery, signal?: AbortSignal): Promise<CatalogAreaPage>;
  /**
   * Optional, for `catalogMode: 'search'`: the provider's best matches for a place name, area
   * or town a person typed (`text`, trimmed, at least 3 characters), in one request: a few
   * dozen at most, best first. The core asks it when a search of the stored catalogue has
   * that text (the watch flow's location step, Explore's "Where") and stores the matches as
   * it stores area results. Without it, a name finds only the places already seen on the map.
   * Ignored for `catalogMode: 'full'`, whose whole catalogue is searched offline.
   */
  searchText?(text: string, signal?: AbortSignal): Promise<LocationSummary[]>;
  getLocation(
    externalId: string,
    signal?: AbortSignal,
    options?: GetLocationOptions
  ): Promise<ProviderLocationDetail | LocationDetail>;
}

/** A catalogue a `full` provider has: `listLocations` is there. */
export type FullCatalogModule = CatalogModule & Required<Pick<CatalogModule, 'listLocations'>>;

/** A catalogue a `search` provider has: `searchArea` is there. */
export type SearchCatalogModule = CatalogModule & Required<Pick<CatalogModule, 'searchArea'>>;

export interface AvailabilityCheckOptions {
  /**
   * Only these units: those with one of these ids, or that one of them names by an id the
   * provider used before (listed in `UnitAvailability.aliases`).
   */
  unitIds?: string[];
  /**
   * Unit ids the caller keeps (a watch's units), to be recognised without filtering: a unit
   * that one of them names by an earlier id lists it in `UnitAvailability.aliases`.
   */
  knownUnitIds?: string[];
  signal?: AbortSignal;
}

export interface AvailabilityModule {
  check(
    externalId: string,
    stay: StayQuery,
    options?: AvailabilityCheckOptions
  ): Promise<LocationAvailability>;
  /** Availability for every location in one call (`capabilities.bulkAvailability`). */
  search?(stay: StayQuery, signal?: AbortSignal): Promise<BulkAvailabilityEntry[]>;
}

export interface AccessGateEnsureOptions {
  signal?: AbortSignal;
  /** Give up with `AccessGateError` after this long. */
  maxWaitMs?: number;
}

/** A waiting room or virtual queue in front of the provider (ParkStay: the DBCA queue). */
export interface AccessGate {
  /**
   * Top-level https origins of the waiting room's own pages (ParkStay:
   * `https://queue.dbca.wa.gov.au`). A provider window that passes through one may land on
   * the provider's home page; knowing them, it goes back to the page it was opened for.
   */
  readonly waitingRoomOrigins?: readonly string[];
  status(): AccessStatus;
  /** Joins or refreshes the queue and resolves once access is `active`. */
  ensure(options?: AccessGateEnsureOptions): Promise<AccessStatus>;
  /** Keeps the session alive until the returned release is called. Ref-counted. */
  holdOpen(): () => void;
  /** Subscribes to status changes; returns the unsubscribe function. */
  onStatus(listener: (status: AccessStatus) => void): () => void;
  /** Stops every timer and drops every listener. */
  dispose(): void;
}

/**
 * A release mode id (`ReleaseModeDescriptor.id`). ParkStay's are the generic
 * `SnipeReleaseMode` values; another provider may describe its own modes (§12.3).
 */
export type ReleaseModeId = `${SnipeReleaseMode}` | (string & Record<never, never>);

export interface ReleaseComputeInput {
  mode: ReleaseModeId;
  externalId: string;
  stay: StayQuery;
  /** Values for the mode's own `fields` (§12.3). */
  params?: StayParams;
  /** The release time a person entered, for modes such as `scheduled`. */
  requestedAt?: Date;
  now: Date;
  signal?: AbortSignal;
}

/** When units for a date become bookable (ParkStay: 180-day rollover, scheduled releases). */
export interface ReleasePolicy {
  supports(mode: ReleaseModeId): boolean;
  /** The instant the stay opens, or `null` when it never "opens" (poll continuously). */
  computeReleaseAt(input: ReleaseComputeInput): Promise<Date | null>;
  /** A sentence such as "Bookings open 180 days ahead at 12:00 am AWST". */
  describe(externalId: string, signal?: AbortSignal): Promise<string | undefined>;
  /** A sensible default for a `scheduled` release, if the provider has one. */
  suggestScheduledAt?(externalId: string, now: Date): Date | null;
  /** The fastest the core may poll: inside a release window, and continuously. */
  readonly pollFloorMs: { window: number; continuous: number };
}

export interface HoldRequest {
  externalId: string;
  unitId?: string;
  /** For providers that hold a class of unit rather than a specific one. */
  unitGroupId?: string;
  stay: StayQuery;
}

export type HoldFailureReason =
  'taken' | 'in-progress' | 'auth-required' | 'closed' | 'invalid' | 'error';

export interface HoldSuccess {
  ok: true;
  reference: string;
  expiresAt: Date;
  unitId?: string;
}

export interface HoldFailure {
  ok: false;
  reason: HoldFailureReason;
  message: string;
}

export type HoldResult = HoldSuccess | HoldFailure;

export interface HoldsModule {
  /** Places a temporary hold. A refusal is a `HoldFailure`, not a rejection. */
  create(request: HoldRequest, signal?: AbortSignal): Promise<HoldResult>;
  /** Where the person completes payment for a hold. */
  paymentUrl(hold: HoldSuccess): string;
  /** Top-level origins the payment window may visit. */
  readonly paymentOrigins?: readonly string[];
  /**
   * The booking reference to record when `page`, a page the payment window loaded, indicates
   * that this hold was paid for, else null. ParkStay: its `/success/` page with the hold's
   * `checkouthash`, showing the hold's booking number. Without it, the app cannot tell when a
   * payment completes.
   */
  bookedReference?(hold: { reference: string }, page: PaymentPage): Promise<string | null>;
}

/** A page the payment window loaded, as `HoldsModule.bookedReference` may read it. */
export interface PaymentPage {
  /** The page's URL, after redirects. */
  readonly url: string;
  /**
   * Whether the page shows `text` (case-sensitive), as the browser's find-in-page sees it.
   * Read-only: nothing runs in the page.
   */
  hasText(text: string): Promise<boolean>;
}

export interface ExternalBooking {
  reference: string;
  externalId: string;
  locationName: string;
  unitName?: string;
  /** Calendar dates `YYYY-MM-DD`. */
  arrival: string;
  departure: string;
  guests?: number;
  status: 'confirmed' | 'pending' | 'cancelled' | 'unknown';
  totalPrice?: number;
}

export interface BookingsModule {
  list?(signal?: AbortSignal): Promise<ExternalBooking[]>;
  get?(reference: string, signal?: AbortSignal): Promise<ExternalBooking>;
}

interface AuthBase {
  kind: ProviderAuthKind;
  /** Asks the provider, with the partition's cookies, whether the session is signed in. */
  isSignedIn(http: HttpClient, signal?: AbortSignal): Promise<AccountStatus>;
}

/** Sign-in on the provider's own pages, in an app window on the provider's partition (D5). */
export interface BrowserSessionAuth extends AuthBase {
  kind: 'browser-session';
  signInUrl: string;
  /** Top-level https origins the sign-in window may visit. */
  allowedOrigins: readonly string[];
  /** URL patterns (`*` wildcard) that mean sign-in finished. */
  completionUrlPatterns?: readonly string[];
}

/**
 * Sign-in with values the app asks for (§12.30). Declared and validated; the account
 * service does not implement it yet. Secret values are kept in the provider's scoped
 * secret vault, never in plain state.
 */
export interface CredentialsAuth extends AuthBase {
  kind: 'credentials';
  /** At least one, with unique keys. */
  fields: readonly AccountFieldDescriptor[];
  signIn(
    values: Readonly<Record<string, string>>,
    http: HttpClient,
    signal?: AbortSignal
  ): Promise<AccountStatus>;
}

/** Sign-in that browser automation performs (§12.30). Declared and validated only. */
export interface AutomationAuth extends AuthBase {
  kind: 'automation';
  signIn(browser: BrowserAutomation, signal?: AbortSignal): Promise<AccountStatus>;
}

export type ProviderAuth = BrowserSessionAuth | CredentialsAuth | AutomationAuth;

export interface ProviderLinks {
  /** The location's page on the provider's site. */
  location(externalId: string): string | null;
  /** A booking deep link, for the stay when given. */
  booking(externalId: string, stay?: StayQuery): string | null;
  /** Where the person manages an existing booking (§12.5). */
  manageBooking?(reference: string): string | null;
}

export interface AccommodationProvider {
  readonly manifest: ProviderManifest;
  catalog?: CatalogModule;
  availability?: AvailabilityModule;
  access?: AccessGate;
  release?: ReleasePolicy;
  holds?: HoldsModule;
  bookings?: BookingsModule;
  auth?: ProviderAuth;
  links: ProviderLinks;
  dispose?(): Promise<void>;
}

/** What a provider's `create` returns: its modules. The manifest comes from the factory. */
export type ProviderModules = Omit<AccommodationProvider, 'manifest'>;

/**
 * Builds a provider for its context. Carries the provider's manifest, so the registry can
 * validate it and build the context from it (time zone, limits) before the provider exists.
 */
export interface ProviderFactory {
  (ctx: ProviderContext): AccommodationProvider;
  readonly id: ProviderId;
  readonly manifest: ProviderManifest;
}

/**
 * A plain provider object: `manifest` plus the modules `impl` has. Modules are kept by
 * reference and `dispose` stays bound to `impl`, so a class-based implementation works too.
 */
export function assembleProvider(
  manifest: ProviderManifest,
  impl: ProviderModules
): AccommodationProvider {
  const provider: AccommodationProvider = { manifest, links: impl.links };
  if (impl.catalog) provider.catalog = impl.catalog;
  if (impl.availability) provider.availability = impl.availability;
  if (impl.access) provider.access = impl.access;
  if (impl.release) provider.release = impl.release;
  if (impl.holds) provider.holds = impl.holds;
  if (impl.bookings) provider.bookings = impl.bookings;
  if (impl.auth) provider.auth = impl.auth;
  if (typeof impl.dispose === 'function') provider.dispose = impl.dispose.bind(impl);
  return provider;
}

/**
 *   export const parkstayFactory = defineProvider(parkstayManifest, (ctx) => ({
 *     links, catalog: createCatalog(ctx), ...
 *   }));
 */
export function defineProvider(
  manifest: ProviderManifest,
  create: (ctx: ProviderContext) => ProviderModules
): ProviderFactory {
  return Object.assign((ctx: ProviderContext) => assembleProvider(manifest, create(ctx)), {
    id: manifest.id,
    manifest,
  });
}
