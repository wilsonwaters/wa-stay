import type { ApiErrorCode } from './api.types';
import { WatchResult } from './common.types';
import type { ProviderId, StayParams, UnitAvailability, UnitKind } from './provider.types';
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
  /**
   * The stay types wanted (`UnitKind`s, no duplicates): only units of these kinds match, a
   * unit with no kind counting as `other`. Empty means any kind. `unitIds`, when set, win.
   */
  unitKinds: UnitKind[];
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
  /**
   * The provider's booking page for what the last check found ("Book on {shortName}"): set
   * only while `lastResult` is found or partly found and the stored nights are the stay's.
   * Main derives it from `lastAvailability` on every read; it is never stored.
   */
  bookingLink?: WatchBookingLink;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A booking link for a stay a watch found: the provider's public booking page, prefilled where
 * it can, and the stay it is for (a partial match's run, or the whole stay). Calendar dates.
 */
export interface WatchBookingLink {
  url: string;
  arrival: string;
  departure: string;
}

/** A watch's auto-hold as stored: pay for it with `watches.openPayment` until `expiresAt`. */
export interface WatchHoldState {
  reference: string;
  expiresAt: Date;
  /** `expiresAt` is the provider's guess (`HoldSuccess.expiresAtEstimated`): "about". */
  expiresEstimated?: boolean;
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
  /** Stay types (`Watch.unitKinds`); none or empty means any kind. Duplicates are dropped. */
  unitKinds?: UnitKind[];
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
  /** `expiresAt` is the provider's guess: the alert says "within about N minutes". */
  expiresEstimated?: boolean;
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
  /** The unit's kind, when the provider gave one: what copy calls it (`nounForKinds`). */
  unitKind?: UnitKind;
  arrival: string;
  departure: string;
  partial: boolean;
  /**
   * For a whole-stay match, how many units its unit stands for (`UnitAvailability.freeCount`),
   * when the provider counts them: the alert and Check now add them up (`freeUnitsOf`). A
   * partial match never has one.
   */
  freeCount?: number;
  /** Whether every night of the match has a price; `maxPrice` applies only then. */
  priceKnown: boolean;
  /** The sum of the nightly prices, when every night has one. */
  total?: number;
}
