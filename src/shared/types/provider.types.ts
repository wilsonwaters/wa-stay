/**
 * Provider types shared by main and renderer (architecture-notes §3 and §12).
 *
 * Everything here is serialisable and crosses IPC. The zod schemas next to the types are
 * what main validates with: the registry checks every manifest against
 * `ProviderManifestSchema`, and the IPC contracts build their request schemas from
 * `ProviderIdSchema`, `CalendarDateSchema` and `StayQuerySchema`.
 *
 * No node or electron imports: the renderer compiles this file too.
 */

import { z } from 'zod';
import { isCalendarDate } from '../utils/calendar-date';
import { assertTypeEquals } from '../utils/type-equality';

export { isCalendarDate };

/** A provider id such as `parkstay`. Validated against the registry, never a hard-coded union. */
export type ProviderId = string;

/** Lower-case letter first, then 1–31 lower-case letters, digits or hyphens. */
export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

export const ProviderIdSchema = z
  .string()
  .regex(PROVIDER_ID_PATTERN, 'Provider ids are 2–32 lower-case letters, digits or hyphens');

export type LocationKind =
  | 'campground'
  | 'caravan-park'
  | 'holiday-park'
  | 'cabin'
  | 'hut'
  | 'glamping'
  | 'farm-stay'
  | 'home'
  | 'other';

export const LOCATION_KINDS = [
  'campground',
  'caravan-park',
  'holiday-park',
  'cabin',
  'hut',
  'glamping',
  'farm-stay',
  'home',
  'other',
] as const satisfies readonly LocationKind[];

export const LocationKindSchema = z.enum(LOCATION_KINDS);

export type BookingMode = 'online' | 'offline' | 'external' | 'application';

export const BOOKING_MODES = [
  'online',
  'offline',
  'external',
  'application',
] as const satisfies readonly BookingMode[];

export const BookingModeSchema = z.enum(BOOKING_MODES);

export type AccountRequirement = 'none' | 'optional' | 'required-for-holds' | 'required';

/**
 * How a catalogue provider's locations are found (§12.30):
 * - `full`: the provider can list every location (`catalog.listLocations`), which the app
 *   syncs and searches offline (ParkStay);
 * - `search`: the provider can only search a map area, a page at a time
 *   (`catalog.searchArea`), as large marketplaces do.
 */
export type CatalogMode = 'full' | 'search';

export interface ProviderCapabilities {
  /** `catalog`: the provider's locations show on the Explore map. */
  catalog: boolean;
  /** How the catalogue is read; see `CatalogMode`. Ignored when `catalog` is off. */
  catalogMode: CatalogMode;
  /** `availability.check` for one location and stay. */
  availability: boolean;
  /** `availability.search`: availability for many locations in one call (map pins). */
  bulkAvailability: boolean;
  /** Usable in Watches. */
  watches: boolean;
  /** Usable in Site Sniper (needs availability, holds and a release policy). */
  snipes: boolean;
  holds: boolean;
  bookingImport: boolean;
  /** The provider has a waiting room or queue (ParkStay: the DBCA queue). §12.2 */
  accessGate: boolean;
  account: AccountRequirement;
}

/** The capability flags that are booleans: what `registry.require` and `withCapability` take. */
export type BooleanCapability = Exclude<keyof ProviderCapabilities, 'account' | 'catalogMode'>;

/**
 * How hard the app may use a provider (§12.30). Core services read them from the provider
 * context or the manifest; a manifest without `limits` gets `DEFAULT_PROVIDER_LIMITS`.
 */
export interface ProviderLimits {
  /** The shortest interval a watch on this provider may be checked at. */
  minWatchIntervalMinutes: number;
  /** The most requests the app has in flight to this provider at once. */
  maxConcurrentRequests: number;
  /** How long a synced catalogue stays fresh. */
  catalogTtlHours: number;
}

export const DEFAULT_PROVIDER_LIMITS: Readonly<ProviderLimits> = Object.freeze({
  minWatchIntervalMinutes: 15,
  maxConcurrentRequests: 4,
  catalogTtlHours: 24,
});

/** The provider's limits, or the defaults when its manifest sets none. */
export function providerLimits(manifest: Pick<ProviderManifest, 'limits'>): ProviderLimits {
  return { ...DEFAULT_PROVIDER_LIMITS, ...manifest.limits };
}

/**
 * How a person signs in to a provider (§12.30):
 * - `browser-session`: on the provider's own pages, in an app window on its partition;
 * - `credentials`: the app asks for the fields in `AccountFieldDescriptor`s and keeps the
 *   secret ones in the provider's scoped secret vault;
 * - `automation`: browser automation signs in for the person.
 *
 * Only `browser-session` is implemented (V6); the others are declared and validated.
 */
export type ProviderAuthKind = 'browser-session' | 'credentials' | 'automation';

/** One input of a `credentials` sign-in, rendered generically by the renderer. */
export interface AccountFieldDescriptor {
  /** e.g. `email`, `password`. */
  key: string;
  label: string;
  help?: string;
  /** Stored only in the scoped secret vault and never sent back to the renderer. */
  secret: boolean;
}

/** Where a stay field is used. §12.1, §12.18 (`appliesTo` is canonical). */
export type StayFieldUse = 'availability' | 'watch' | 'snipe' | 'hold';

/**
 * A provider-specific stay input, such as gear type, vehicles, postcode or concessions,
 * rendered generically by the renderer (§12.1). Values travel in `StayQuery.params` and are
 * stored in `stay_params`.
 */
export interface StayFieldDescriptor {
  /** The key in `StayQuery.params`, e.g. `gearType`. */
  key: string;
  label: string;
  help?: string;
  type: 'select' | 'number' | 'text' | 'boolean';
  /** For `select`. */
  options?: { value: string; label: string }[];
  /** For `number`. */
  min?: number;
  max?: number;
  /** For `text`: a regular expression the whole value must match, e.g. `^\d{4}$`. */
  pattern?: string;
  default?: string | number | boolean;
  appliesTo: StayFieldUse[];
  required?: boolean;
}

/**
 * A snipe release mode the provider supports (§12.3). ParkStay's ids are the generic
 * `SnipeReleaseMode` values (`daily_rollover`, `scheduled`, `cancellation`).
 */
export interface ReleaseModeDescriptor {
  id: string;
  label: string;
  description: string;
  /** Whether a snipe in this mode waits in the provider's access gate. */
  usesAccessGate: boolean;
  /** Extra inputs this mode needs. */
  fields?: StayFieldDescriptor[];
}

/**
 * The stay fields an availability answer can depend on, for cache keys. `params.<key>` names
 * one of the provider's own stay fields (§12.1).
 */
export const STAY_KEY_FIELDS = [
  'arrival',
  'departure',
  'adults',
  'children',
  'infants',
  'concessions',
  'equipment',
] as const;
export type StayKeyField = (typeof STAY_KEY_FIELDS)[number] | `params.${string}`;

export interface ProviderManifest {
  /** `parkstay` */
  id: ProviderId;
  /** `ParkStay WA` */
  name: string;
  /** `ParkStay` */
  shortName: string;
  /** One line, shown in provider pickers. */
  description: string;
  /** `https://parkstay.dbca.wa.gov.au` */
  website: string;
  integration: 'api' | 'browser' | 'hybrid';
  /** ProviderBadge: a coloured monogram (no third-party logos). */
  brand: { color: string; monogram: string };
  locationKinds: LocationKind[];
  /** IANA zone, e.g. `Australia/Perth`. */
  timezone: string;
  /** ISO 4217 code the provider's prices are in, e.g. `AUD`. */
  currency: string;
  capabilities: ProviderCapabilities;
  /** Usage limits; `DEFAULT_PROVIDER_LIMITS` when absent. */
  limits?: ProviderLimits;
  /** §12.1 */
  stayFields?: StayFieldDescriptor[];
  /** §12.3, present when `capabilities.snipes`. */
  releaseModes?: ReleaseModeDescriptor[];
  /**
   * The stay fields the provider's bulk availability depends on (E3), always with both dates.
   * Bulk answers are cached by these alone, so a change to anything else (the party, for a
   * provider that ignores it) reuses the answer instead of asking again. Every field when
   * absent.
   */
  bulkAvailabilityStayFields?: StayKeyField[];
}

/** Values for a provider's `stayFields`, keyed by `StayFieldDescriptor.key`. */
export type StayParams = Record<string, string | number | boolean>;

export interface StayQuery {
  /** Calendar date `YYYY-MM-DD`. */
  arrival: string;
  /** Calendar date `YYYY-MM-DD`, after `arrival`. */
  departure: string;
  adults: number;
  children?: number;
  infants?: number;
  concessions?: number;
  equipment?: string;
  /** Provider-specific stay fields (§12.1). */
  params?: StayParams;
}

export type NightState = 'available' | 'booked' | 'closed' | 'not-released' | 'unknown';

/**
 * Why a night is not `available` although the provider reported room: `split`, free, but not
 * on the same unit as the available nights next to it (a unit that stands for several, such
 * as a class of sites booked whole stays on one site). Matching treats it as not available.
 */
export type NightReason = 'split';

export interface NightStatus {
  /** Calendar date `YYYY-MM-DD`. */
  date: string;
  state: NightState;
  price?: number;
  /** The provider's own wording, e.g. `Booked` or `$30.00`. */
  label?: string;
  reason?: NightReason;
}

export interface UnitAvailability {
  unitId: string;
  unitName: string;
  unitType?: string;
  /**
   * Unit ids the caller asked about (`unitIds`, `knownUnitIds`) that name this unit by an id
   * the provider used for it before, e.g. a site of a class the provider now lists as one unit.
   */
  aliases?: string[];
  nights: NightStatus[];
  /** Every night of the stay is available. */
  fullyAvailable: boolean;
  /** Price for the whole stay, when known. */
  total?: number;
}

export interface LocationAvailability {
  /** Location key `${providerId}:${externalId}`. */
  key: string;
  /** ISO timestamp. */
  checkedAt: string;
  units: UnitAvailability[];
  release?: { opensAt?: string; open: boolean };
  /** A stay-specific deep link (§12.17). Prefer it over `LocationDetail.bookingUrl`. */
  bookingUrl?: string;
}

/**
 * One place's availability for a stay, from a provider's bulk `availability.search`: counts of
 * units, not nights. Explore shows "2 of 5 sites available" (`availableUnits` above 0), "No site
 * free every night" (none free, some bookable) or "No sites open for these dates" (none
 * bookable). A place the provider has no answer for gets no entry, and reads as unknown.
 */
export interface BulkAvailabilityEntry {
  /** The place's location key, `makeLocationKey(providerId, externalId)`. */
  key: string;
  /**
   * How many units are free on every night of the stay: the smaller number. A unit free on
   * some nights only does not count.
   */
  availableUnits: number;
  /**
   * How many units can be booked online for the stay's dates at all, free or not: the place's
   * total, or 0 when none can be (not released yet, closed, or past the booking window).
   */
  bookableUnits: number;
}

/** The state of a provider's waiting room or queue. */
export type AccessState = 'unsupported' | 'idle' | 'waiting' | 'active' | 'expired' | 'error';

export interface AccessStatus {
  providerId: ProviderId;
  state: AccessState;
  /** Place in the queue while `waiting`. */
  position?: number;
  etaSeconds?: number;
  /** ISO timestamp the active session ends. */
  expiresAt?: string;
  message?: string;
  /** ISO timestamp. */
  updatedAt: string;
}

/** The result of a provider's signed-in check (`ProviderAuth.isSignedIn`). */
export interface AccountStatus {
  state: 'signed-in' | 'signed-out' | 'unknown';
  email?: string;
  displayName?: string;
  /** Why the state is `unknown`, e.g. `queue`, `http 503` or `network`. */
  reason?: string;
}

export interface ProviderAccount {
  providerId: ProviderId;
  requirement: AccountRequirement;
  status: AccountStatus['state'];
  displayName?: string;
  email?: string;
  /** ISO timestamp. */
  lastSignedInAt?: string;
  /** ISO timestamp. */
  lastCheckedAt?: string;
}

// ---------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------

export const CalendarDateSchema = z
  .string()
  .refine(isCalendarDate, 'Expected a real calendar date written YYYY-MM-DD');

const count = z.number().int().nonnegative();

export const StayParamsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()])
);

export const StayQuerySchema = z
  .object({
    arrival: CalendarDateSchema,
    departure: CalendarDateSchema,
    adults: z.number().int().min(1),
    children: count.optional(),
    infants: count.optional(),
    concessions: count.optional(),
    equipment: z.string().optional(),
    params: StayParamsSchema.optional(),
  })
  // Same-format calendar dates compare correctly as strings.
  .refine((stay) => stay.departure > stay.arrival, {
    error: 'Departure must be after arrival',
    path: ['departure'],
  });
assertTypeEquals<z.input<typeof StayQuerySchema>, StayQuery>(true);
assertTypeEquals<z.output<typeof StayQuerySchema>, StayQuery>(true);

const nonEmpty = z.string().trim().min(1);

function isValidPattern(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const DEFAULT_TYPE: Record<StayFieldDescriptor['type'], string> = {
  select: 'string',
  text: 'string',
  number: 'number',
  boolean: 'boolean',
};

export const StayFieldDescriptorSchema = z
  .object({
    key: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/, 'Stay field keys are alphanumeric'),
    label: nonEmpty,
    help: z.string().optional(),
    type: z.enum(['select', 'number', 'text', 'boolean']),
    options: z.array(z.object({ value: z.string(), label: nonEmpty })).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().refine(isValidPattern, 'Not a valid regular expression').optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    appliesTo: z.array(z.enum(['availability', 'watch', 'snipe', 'hold'])).min(1),
    required: z.boolean().optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === 'select' && !field.options?.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'A select needs options' });
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      ctx.addIssue({ code: 'custom', path: ['min'], message: 'min is greater than max' });
    }
    if (field.default !== undefined && typeof field.default !== DEFAULT_TYPE[field.type]) {
      ctx.addIssue({ code: 'custom', path: ['default'], message: `Not a ${field.type} value` });
    }
  });
assertTypeEquals<z.input<typeof StayFieldDescriptorSchema>, StayFieldDescriptor>(true);
assertTypeEquals<z.output<typeof StayFieldDescriptorSchema>, StayFieldDescriptor>(true);

const uniqueBy =
  <T>(key: (item: T) => string) =>
  (items: T[]): boolean =>
    new Set(items.map(key)).size === items.length;

export const ReleaseModeDescriptorSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/, 'Release mode ids are lower-case'),
  label: nonEmpty,
  description: nonEmpty,
  usesAccessGate: z.boolean(),
  fields: z.array(StayFieldDescriptorSchema).optional(),
});
assertTypeEquals<z.input<typeof ReleaseModeDescriptorSchema>, ReleaseModeDescriptor>(true);
assertTypeEquals<z.output<typeof ReleaseModeDescriptorSchema>, ReleaseModeDescriptor>(true);

export const AccountFieldDescriptorSchema = z.object({
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/, 'Account field keys are alphanumeric'),
  label: nonEmpty,
  help: z.string().optional(),
  secret: z.boolean(),
});
assertTypeEquals<z.input<typeof AccountFieldDescriptorSchema>, AccountFieldDescriptor>(true);
assertTypeEquals<z.output<typeof AccountFieldDescriptorSchema>, AccountFieldDescriptor>(true);

/** A `credentials` sign-in's fields: at least one, with unique keys. */
export const AccountFieldsSchema = z
  .array(AccountFieldDescriptorSchema)
  .min(1)
  .refine(
    uniqueBy((f: AccountFieldDescriptor) => f.key),
    'Account field keys must be unique'
  );

export const ProviderLimitsSchema = z.object({
  minWatchIntervalMinutes: z.number().int().min(1).max(1440),
  maxConcurrentRequests: z.number().int().min(1).max(32),
  catalogTtlHours: z
    .number()
    .positive()
    .max(24 * 30),
});
assertTypeEquals<z.input<typeof ProviderLimitsSchema>, ProviderLimits>(true);
assertTypeEquals<z.output<typeof ProviderLimitsSchema>, ProviderLimits>(true);

export const ProviderCapabilitiesSchema = z.object({
  catalog: z.boolean(),
  catalogMode: z.enum(['full', 'search']),
  availability: z.boolean(),
  bulkAvailability: z.boolean(),
  watches: z.boolean(),
  snipes: z.boolean(),
  holds: z.boolean(),
  bookingImport: z.boolean(),
  accessGate: z.boolean(),
  account: z.enum(['none', 'optional', 'required-for-holds', 'required']),
});
assertTypeEquals<z.input<typeof ProviderCapabilitiesSchema>, ProviderCapabilities>(true);
assertTypeEquals<z.output<typeof ProviderCapabilitiesSchema>, ProviderCapabilities>(true);

const StayKeyFieldSchema = z.union([
  z.enum(STAY_KEY_FIELDS),
  z.custom<`params.${string}`>(
    (value) => typeof value === 'string' && /^params\.[A-Za-z][A-Za-z0-9_]*$/.test(value),
    'A stay field is a StayQuery field or params.<key>'
  ),
]);

export const ProviderManifestSchema = z.object({
  id: ProviderIdSchema,
  name: nonEmpty,
  shortName: nonEmpty.max(24),
  description: nonEmpty,
  website: z.url().refine((url) => url.startsWith('https://'), 'The website must be https'),
  integration: z.enum(['api', 'browser', 'hybrid']),
  brand: z.object({
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Brand colour is #RRGGBB'),
    monogram: z.string().regex(/^[A-Z0-9]{1,3}$/, 'Monogram is 1–3 capitals or digits'),
  }),
  locationKinds: z.array(LocationKindSchema).min(1),
  timezone: z.string().refine(isTimeZone, 'Not an IANA time zone'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Currency is an ISO 4217 code such as AUD'),
  capabilities: ProviderCapabilitiesSchema,
  limits: ProviderLimitsSchema.optional(),
  stayFields: z
    .array(StayFieldDescriptorSchema)
    .refine(
      uniqueBy((f: StayFieldDescriptor) => f.key),
      'Stay field keys must be unique'
    )
    .optional(),
  releaseModes: z
    .array(ReleaseModeDescriptorSchema)
    .refine(
      uniqueBy((m: ReleaseModeDescriptor) => m.id),
      'Release mode ids must be unique'
    )
    .optional(),
  bulkAvailabilityStayFields: z
    .array(StayKeyFieldSchema)
    .refine(
      (fields) => fields.includes('arrival') && fields.includes('departure'),
      'Bulk availability always depends on both dates'
    )
    .optional(),
});
assertTypeEquals<z.input<typeof ProviderManifestSchema>, ProviderManifest>(true);
assertTypeEquals<z.output<typeof ProviderManifestSchema>, ProviderManifest>(true);
