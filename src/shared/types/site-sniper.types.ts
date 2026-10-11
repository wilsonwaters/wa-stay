import { SnipeResult, SnipeReleaseMode, SnipeStatus } from './common.types';
import type { ProviderId, StayParams } from './provider.types';
import type { LocationRef, Stay, StayInput } from './stay.types';

/**
 * A Site Snipe: an automated attempt to hold a high-demand unit at the earliest legal
 * moment it becomes available (daily rollover, scheduled release, or continuous
 * cancellation watch). Stops at placing the provider's temporary hold; payment stays a
 * human step. Instants are `Date`s; stay dates are calendar dates `YYYY-MM-DD`.
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
  /** The provider's own stay fields (ParkStay: `gearType`, `numVehicles`, `postcode`). */
  stayParams: StayParams;
  releaseMode: SnipeReleaseMode;
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
  /** The unit the hold is on. */
  holdUnitId?: string;
  paymentUrl?: string;
  bookedReference?: string;
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
  stayParams?: StayParams;
  releaseMode: SnipeReleaseMode;
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
