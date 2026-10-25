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
  AccountConfirmation,
  AccountFieldDescriptor,
  AccountStatus,
  BulkAvailabilityEntry,
  LocationAvailability,
  ProviderAuthKind,
  ProviderId,
  ProviderManifest,
  StayParams,
  StayQuery,
  StayRulesVerdict,
  UnitKind,
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
  /**
   * The snipe's unit choice (§12.35): the units it names, or else its stay types (none: any).
   * A policy may time a unit or category differently (a category left out of a pre-sale).
   */
  unitIds?: string[];
  unitKinds?: UnitKind[];
  /**
   * How long the snipe keeps trying after its release, in ms: its own window, clamped to the
   * mode's `maxWindowMinutes` (§12.35). A policy that refuses a release whose window has
   * already passed measures it with this. None (an availability check): the policy's own.
   */
  windowMs?: number;
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
  /**
   * `expiresAt` is the provider's guess, not a time its answer gave (a cart that shows no
   * countdown): the app says "about" before it ("Held until about 10:42 am", "within about 10
   * minutes"). The night guard and `HOLD_EXPIRED` use the guess as it is.
   */
  expiresAtEstimated?: boolean;
  unitId?: string;
}

export interface HoldFailure {
  ok: false;
  reason: HoldFailureReason;
  message: string;
}

export type HoldResult = HoldSuccess | HoldFailure;

/** A hold the core asks the provider to let go: as the core recorded it when it was placed. */
export interface HoldToRelease {
  reference: string;
  unitId?: string;
  expiresAt: Date;
}

/**
 * What a release found:
 * - `released`: the provider held it, and has let it go;
 * - `gone`: the provider no longer held it (paid, expired, or removed on its own page), so
 *   nothing was let go. Never touch a booking to answer this.
 */
export type HoldReleaseOutcome = 'released' | 'gone';

export interface HoldReleaseResult {
  outcome: HoldReleaseOutcome;
}

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
  /**
   * Lets the hold go before it runs out: when the person declines it ("Let it go"), deletes
   * its watch or snipe, or (with `releaseOnPaymentClose`) closes the payment window without a
   * confirmed payment. **The provider decides**: the core never takes a closed window as
   * unpaid, so look at your own side first, and answer `gone` when the hold is no longer there
   * (the person may have paid). Reject only when the provider could not be asked (a failed
   * request, a block, an abort): the hold then stays until it runs out, and nothing retries.
   * The core calls it at interactive priority, at most once at a time per hold. Needs the
   * manifest's `holdRelease`.
   */
  release?(hold: HoldToRelease, signal?: AbortSignal): Promise<HoldReleaseResult>;
  /**
   * Call `release` when the payment window closes with no confirmed payment (a provider with
   * no confirmation page the app can read, whose hold must not outlive the person's visit).
   * Not when the window's first page failed, nor on quit. Needs `release`.
   */
  readonly releaseOnPaymentClose?: boolean;
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
 * Sign-in with details the app asks for (§12.30, §12.35): Settings → Accounts shows `fields`
 * and `confirmations`, and `accounts.saveCredentials` stores the values once `signIn` accepts
 * them. The core keeps every value in the provider's scoped secret vault as `account.<key>`
 * (`ctx.secrets.get('account.<key>')` reads it), never in plain state, never in a log and never
 * back to the renderer. The status is worked out from what is stored: `isSignedIn` is not
 * called.
 */
export interface CredentialsAuth extends AuthBase {
  kind: 'credentials';
  /** At least one, with unique keys. */
  fields: readonly AccountFieldDescriptor[];
  /** Statements the person must tick to save, with unique keys. */
  confirmations?: readonly AccountConfirmation[];
  /**
   * Checks the values (trimmed, every declared field, none empty) before they are stored,
   * within 15 s: `signed-in` stores them, `signed-out` refuses them ("{shortName} didn't accept
   * these details", or the answer's own `message`), and `unknown` or a rejection stores nothing
   * ("Couldn't check these details"). A `signed-in` answer may carry `values` to store instead,
   * in the provider's own form (see `CredentialsSignInResult`). Never put a value in an error
   * message, a refusal's `message` or a log line.
   */
  signIn(
    values: Readonly<Record<string, string>>,
    http: HttpClient,
    signal?: AbortSignal
  ): Promise<CredentialsSignInResult>;
}

/**
 * What a `credentials` sign-in's `signIn` answers: the status, and with `signed-in` optionally
 * the values to store (and copy) instead of what was typed, normalised the provider's way
 * ("1234 5678 9012" → "123456789012"). Only declared keys, each a string that is not empty and
 * at most 256 characters once trimmed; a declared key left out keeps the typed value. Anything
 * else makes the core ignore `values` (with a warning that names no value) and store what was
 * typed.
 */
export interface CredentialsSignInResult extends AccountStatus {
  values?: Readonly<Record<string, string>>;
  /**
   * With `signed-out` only: why, in the provider's own words, said on the field instead of
   * "{shortName} didn't accept these details" ("That doesn't look like an RAC member number").
   * Plain text, at most `CREDENTIALS_MESSAGE_MAX_LENGTH` characters, quoting nothing the person
   * typed: the core ignores one that is not text, is empty or longer, or contains a value it
   * was given, and says its own words instead.
   */
  message?: string;
}

/** The most characters a `credentials` refusal's `message` may have. */
export const CREDENTIALS_MESSAGE_MAX_LENGTH = 200;

/** Sign-in that browser automation performs (§12.30). Declared and validated only. */
export interface AutomationAuth extends AuthBase {
  kind: 'automation';
  signIn(browser: BrowserAutomation, signal?: AbortSignal): Promise<AccountStatus>;
}

export type ProviderAuth = BrowserSessionAuth | CredentialsAuth | AutomationAuth;

/** What `stayRules.check` is asked about: a stay at one place, for some units or kinds. */
export interface StayRulesInput {
  externalId: string;
  stay: StayQuery;
  /** The units the person chose (a watch's or snipe's), or none for any. */
  unitIds?: string[];
  /** The stay types the person chose, or none for any. */
  unitKinds?: UnitKind[];
  /** When it is asked, for "today" and for what is on sale yet. */
  now: Date;
}

/**
 * A provider's published booking rules (the longest stay, fixed peak dates, days arrivals are
 * refused, how many a unit sleeps, when dates go on sale), worked out without asking it: the
 * core refuses a watch or snipe for a stay the provider would refuse, and the place page says
 * why before anything is checked (`catalog.stayRules`). Optional, and pure: `check` sends
 * nothing, waits for nothing and never throws for a place or stay it doesn't know (it answers
 * `ok` with no notes). Its words are the person's: plain text, each at most 200 characters.
 */
export interface StayRulesModule {
  check(input: StayRulesInput): StayRulesVerdict;
}

export interface ProviderLinks {
  /** The location's page on the provider's site. */
  location(externalId: string): string | null;
  /**
   * A booking deep link, for the stay when given, and for the unit (or category) `unitId`
   * when the provider can prefill one (a provider may ignore it; ParkStay does). With a stay
   * it is a booking link, by the rule on `UnitAvailability.bookingUrl`: https on the
   * provider's own site, a public page that needs no sign-in, works on a phone, and never
   * adds to a cart, holds or books when it is opened.
   */
  booking(externalId: string, stay?: StayQuery, unitId?: string): string | null;
  /** Where the person manages an existing booking (§12.5). */
  manageBooking?(reference: string): string | null;
  /**
   * The place's contact page, where a person asks its staff to book what WA Stay can't (a
   * split stay with `booking: 'contact'`): an absolute https URL on the provider's own site,
   * a public page that needs no sign-in. Needed by a provider that reports `contact` split
   * stays (the contract suite checks); null when the place has none.
   */
  contact?(externalId: string): string | null;
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
  /** Its published booking rules, worked out without asking it (`StayRulesModule`). */
  stayRules?: StayRulesModule;
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
  if (impl.stayRules) provider.stayRules = impl.stayRules;
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
