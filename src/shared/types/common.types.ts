// Common types used across the application

export enum BookingStatus {
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  PENDING = 'pending',
}

export enum WatchResult {
  FOUND = 'found',
  NOT_FOUND = 'not_found',
  PARTIAL_FOUND = 'partial_found',
  /** An auto-hold placed a hold; the night guard counts it until `hold_expires_at`. */
  HELD = 'held',
  /** The hold was paid for in the payment window: a confirmed booking. */
  BOOKED = 'booked',
  ERROR = 'error',
}

export enum SnipeResult {
  PENDING = 'pending',
  HELD = 'held', // temp hold placed, awaiting payment
  BOOKED = 'booked', // user completed payment (confirmed later)
  UNAVAILABLE = 'unavailable',
  TOO_EARLY = 'too_early', // not open yet (toofar/closed)
  QUEUE_FULL = 'queue_full',
  EXPIRED = 'expired', // window/hold expired
  ERROR = 'error',
}

export enum SnipeReleaseMode {
  DAILY_ROLLOVER = 'daily_rollover', // non-Ningaloo midnight AWST rollover
  SCHEDULED = 'scheduled', // explicit release datetime (Ningaloo 10:00 first Tue)
  CANCELLATION = 'cancellation', // no fixed release; poll for freed site
}

export enum SnipeStatus {
  ARMED = 'armed', // scheduled, waiting for release window
  WAITING_RELEASE = 'waiting_release',
  QUEUEING = 'queueing', // establishing/holding queue session
  SNIPING = 'sniping', // tight-polling availability
  HELD = 'held', // hold placed, awaiting user payment
  BOOKED = 'booked',
  FAILED = 'failed',
  EXPIRED = 'expired',
  DISABLED = 'disabled',
}

export enum NotificationType {
  WATCH_FOUND = 'watch_found',
  SNIPE_HELD = 'snipe_held',
  SNIPE_BOOKED = 'snipe_booked',
  BOOKING_CONFIRMED = 'booking_confirmed',
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
}

export enum RelatedType {
  BOOKING = 'booking',
  WATCH = 'watch',
  SNIPE = 'snipe',
}

export enum SettingValueType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  JSON = 'json',
}

export enum SettingCategory {
  GENERAL = 'general',
  NOTIFICATIONS = 'notifications',
  WATCHES = 'watches',
  SNIPER = 'sniper',
  UI = 'ui',
  ADVANCED = 'advanced',
}

// Base types
/** The local profile (the single `users` row). Its email is a hint, never a sign-in. */
export interface User {
  id: number;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** The profile fields. */
export interface UserInput {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface Setting {
  key: string;
  value: string;
  valueType: SettingValueType;
  category: SettingCategory;
  description?: string;
  updatedAt: Date;
}
