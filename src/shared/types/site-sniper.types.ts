import { SnipeResult, SnipeReleaseMode, SnipeStatus } from './common.types';
import type { ProviderId, StayParams, UnitKind } from './provider.types';
import type { LocationRef, Stay, StayInput } from './stay.types';

/**
 * What a snipe does when the dates are free (architecture-notes §12.35):
 * - `hold`: places the provider's temporary hold (needs `capabilities.holds`); the person pays;
 * - `alert`: a desktop alert and email with the provider's booking page; nothing is held;
 * - `remind` (§12.38): an Open Day plan, in a release mode that only reminds (`remindOnly`):
 *   the mode's reminders before the release, and nothing checked, held or reserved.
 */
export type SnipeAction = 'alert' | 'hold' | 'remind';

/** Every `SnipeAction`, for validation. */
export const SNIPE_ACTIONS = ['alert', 'hold', 'remind'] as const satisfies readonly SnipeAction[];

/**
 * What an ALERTED snipe found: what was free, when, and where to book it. Stored with the
 * snipe, so its page can show it long after the alert.
 */
export interface SnipeAlert {
  /** When the dates were found free. */
  at: Date;
  /** The free unit the alert names. */
  unitId: string;
  unitName?: string;
  /**
   * The provider's public booking page for the stay (https on its own site, never a cart);
   * absent when the provider gave none that passed the check.
   */
  bookingUrl?: string;
  /** Why it alerted although it was asked to hold, when it was. */
  note?: string;
}

/**
 * A Site Snipe: an automated attempt to catch a high-demand unit at the earliest legal moment
 * it becomes available (daily rollover, scheduled release, or continuous cancellation watch).
 * A `hold` snipe stops at placing the provider's temporary hold, and payment stays a human
 * step; an `alert` snipe alerts with the booking page and holds nothing. Instants are `Date`s;
 * stay dates are calendar dates `YYYY-MM-DD`.
 */
export interface SiteSnipe {
  id: number;
  userId: number;
  providerId: ProviderId;
  /** `${providerId}:${location.externalId}` */
  locationKey: string;
  /** `name` is empty when the location's name was never stored. */
  location: LocationRef;
  name: string;
  stay: Stay;
  /** Preferred units (ParkStay: site ids). Empty means any unit at the location. */
  unitIds: string[];
  /**
   * The stay types to hold (`UnitKind`s, no duplicates): without `unitIds`, only units of
   * these kinds are candidates, a unit with no kind counting as `other`. Empty means any kind.
   */
  unitKinds: UnitKind[];
  /** The provider's own stay fields (ParkStay: `gearType`, `numVehicles`, `postcode`). */
  stayParams: StayParams;
  releaseMode: SnipeReleaseMode;
  /** What it does when the dates are free (stored rows from before v12 read `hold`). */
  action: SnipeAction;
  // exact release instant (UTC). Required for SCHEDULED; computed for
  // DAILY_ROLLOVER; null for CANCELLATION
  releaseAt?: Date;
  /** Wait in the provider's access gate before release (ParkStay: the DBCA queue, Ningaloo). */
  accessGateEnabled: boolean;
  leadTimeSeconds: number; // start warm-up/queue this many seconds before releaseAt
  pollIntervalMs: number; // tight-poll cadence during the snipe window
  windowDurationMs: number; // how long to keep sniping after release before giving up
  status: SnipeStatus;
  isActive: boolean;
  attemptsCount: number;
  maxAttempts: number; // 0 = unlimited within window
  lastCheckedAt?: Date;
  nextCheckAt?: Date;
  lastResult?: SnipeResult;
  lastError?: string;
  /** The provider's reference for the hold (ParkStay: the booking pk from create_booking). */
  holdReference?: string;
  holdExpiresAt?: Date;
  /** `holdExpiresAt` is the provider's guess (`HoldSuccess.expiresAtEstimated`): "about". */
  holdExpiresEstimated?: boolean;
  /** The unit the hold is on. */
  holdUnitId?: string;
  paymentUrl?: string;
  bookedReference?: string;
  /** What an ALERTED snipe found (cleared when it is armed again). */
  alert?: SnipeAlert;
  /**
   * An Open Day plan's reminders sent (or passed while WA Stay was closed), by when each was
   * due (cleared when it is armed again).
   */
  remindersSent?: Date[];
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input shape used to create a Site Snipe. Main resolves the user.
 */
export interface SiteSnipeInput {
  providerId: ProviderId;
  name: string;
  location: LocationRef;
  stay: StayInput;
  unitIds?: string[];
  /** Stay types (`SiteSnipe.unitKinds`); none or empty means any kind. Duplicates are dropped. */
  unitKinds?: UnitKind[];
  stayParams?: StayParams;
  releaseMode: SnipeReleaseMode;
  /** Default: `hold` when the provider has holds, otherwise `alert`. */
  action?: SnipeAction;
  releaseAt?: Date;
  accessGateEnabled?: boolean;
  leadTimeSeconds?: number;
  pollIntervalMs?: number;
  windowDurationMs?: number;
  maxAttempts?: number;
  notes?: string;
}

/** The fields an update may change. A snipe never moves to another provider. */
export type SiteSnipeUpdate = Partial<Omit<SiteSnipeInput, 'providerId'>>;

/** `snipes.list` filter. Main resolves the user. */
export interface SnipeListFilter {
  providerId?: ProviderId;
  status?: SnipeStatus;
}

/**
 * Result of a single snipe execution attempt.
 */
export interface SnipeExecutionResult {
  snipeId: number;
  success: boolean; // the attempt ran without a thrown error
  result: SnipeResult; // outcome classification
  held: boolean;
  holdReference?: string;
  paymentUrl?: string;
  matchedSiteId?: string;
  error?: string;
  checkedAt: Date;
}
