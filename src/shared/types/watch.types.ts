import type { ApiErrorCode } from './api.types';
import { WatchResult } from './common.types';
import type { ProviderId, StayParams, UnitAvailability } from './provider.types';
import type { LocationRef, Stay, StayInput } from './stay.types';

/**
 * A recurring availability check for a stay at one location of one provider.
 * Instants (`lastCheckedAt`, `nextCheckAt`, timestamps) are `Date`s; stay dates are
 * calendar dates `YYYY-MM-DD`.
 */
export interface Watch {
  id: number;
  userId: number;
  providerId: ProviderId;
  /** `${providerId}:${location.externalId}` */
  locationKey: string;
  location: LocationRef;
  name: string;
  stay: Stay;
  /** Preferred units (ParkStay: site ids or names). Empty means any unit. */
  unitIds: string[];
  /** The provider's own stay fields (ParkStay: `parkId`, `gearType`). */
  stayParams: StayParams;
  checkIntervalMinutes: number;
  isActive: boolean;
  lastCheckedAt?: Date;
  nextCheckAt?: Date;
  lastResult?: WatchResult;
  /** The wanted units from the last check, night by night (with prices when the provider has them). */
  lastAvailability?: UnitAvailability[];
  foundCount: number;
  /** Hold a unit automatically when the whole stay is found (needs `capabilities.holds`). */
  autoHold: boolean;
  notifyOnly: boolean;
  allowPartialMatch: boolean;
  maxPrice?: number;
  notes?: string;
  /** The hold its auto-hold placed (`lastResult` held, or booked once paid for). */
  hold?: WatchHoldState;
  /** Why the last run did not do what it should (a failed check or automatic hold). */
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** A watch's auto-hold as stored: pay for it with `watches.openPayment` until `expiresAt`. */
export interface WatchHoldState {
  reference: string;
  expiresAt: Date;
  unitId?: string;
  paymentUrl?: string;
}

/** A watch as create requests send it. Main resolves the user. */
export interface WatchInput {
  providerId: ProviderId;
  name: string;
  location: LocationRef;
  stay: StayInput;
  unitIds?: string[];
  stayParams?: StayParams;
  /** One of `WATCH_INTERVAL_OPTIONS`. */
  checkIntervalMinutes?: number;
  autoHold?: boolean;
  notifyOnly?: boolean;
  allowPartialMatch?: boolean;
  maxPrice?: number;
  notes?: string;
}

/** The fields an update may change. A watch never moves to another provider. */
export type WatchUpdate = Partial<Omit<WatchInput, 'providerId'>>;

/** `watches.list` filter. Main resolves the user. */
export interface WatchListFilter {
  providerId?: ProviderId;
  status?: 'active' | 'inactive';
}

/** The hold an auto-hold watch placed. Payment stays a human step on the provider's site. */
export interface WatchHold {
  reference: string;
  /** ISO instant. */
  expiresAt: string;
  unitId: string;
  paymentUrl: string;
}

/** The result of one watch check. */
export interface WatchExecutionResult {
  watchId: number;
  success: boolean;
  found: boolean;
  /** Full matches, or (when there are none and the watch allows it) partial runs. */
  matches: WatchMatch[];
  /** Present when an auto-hold was placed. */
  hold?: WatchHold;
  error?: string;
  errorCode?: ApiErrorCode;
  /** True when the watch's arrival date has passed and it was deactivated. */
  expired?: boolean;
  checkedAt: Date;
}

/**
 * A stay a watch found on one unit: the whole stay, or (partial) a run of consecutive
 * available nights from the same check. Calendar dates `YYYY-MM-DD`.
 */
export interface WatchMatch {
  unitId: string;
  unitName: string;
  unitType?: string;
  arrival: string;
  departure: string;
  partial: boolean;
  /** Whether every night of the match has a price; `maxPrice` applies only then. */
  priceKnown: boolean;
  /** The sum of the nightly prices, when every night has one. */
  total?: number;
}
