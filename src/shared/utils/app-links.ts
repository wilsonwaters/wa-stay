/**
 * The in-app addresses a notification may open (U5; architecture-notes §12.6). Main checks a
 * path against them before it sends `app:navigate`, and the renderer checks again before it
 * follows one, so a stored `actionUrl` can never take the app to another site or to an
 * arbitrary route. Pure: both processes use it. The paths match the renderer's `ROUTES`
 * (`watchDetail`, `snipeDetail`, `bookingDetail`, `settings`); a renderer test holds them to it.
 */
import { RelatedType } from '../types/common.types';
import type { Notification } from '../types/notification.types';

/** The fields a link is read from, as a stored row may hold them (null where none). */
export type NotificationLinkFields = {
  [K in 'actionUrl' | 'relatedType' | 'relatedId']?: Notification[K] | null;
};

/** A row id: a positive integer, as SQLite hands them out. */
const ID = String.raw`[1-9]\d{0,15}`;

const APP_LINK_PATTERNS: readonly RegExp[] = [
  new RegExp(`^/watches/${ID}$`),
  new RegExp(`^/site-sniper/${ID}$`),
  new RegExp(`^/bookings/${ID}$`),
  /^\/settings\/[a-z][a-z-]{0,31}$/,
];

/**
 * True for `/watches/:id`, `/site-sniper/:id`, `/bookings/:id` and `/settings/:section`
 * exactly: no query, no hash, no scheme or host.
 */
export function isAppLinkPath(path: unknown): path is string {
  return typeof path === 'string' && APP_LINK_PATTERNS.some((pattern) => pattern.test(path));
}

/** The page of a watch, snipe or booking. */
const RELATED_PREFIX: Record<RelatedType, string> = {
  [RelatedType.WATCH]: '/watches',
  [RelatedType.SNIPE]: '/site-sniper',
  [RelatedType.BOOKING]: '/bookings',
};

/** `/watches/12`, `/site-sniper/7`, `/bookings/3`. */
export function relatedPath(type: RelatedType, id: number): string {
  return `${RELATED_PREFIX[type]}/${id}`;
}

/**
 * Where a notification leads inside WA Stay: its `actionUrl` when that is an allowed in-app
 * page, otherwise the page of its watch, snipe or booking, otherwise nowhere (null). Never an
 * external address. Database rows may hold null where the type says optional.
 */
export function notificationLinkPath(notification: NotificationLinkFields): string | null {
  const { actionUrl, relatedType, relatedId } = notification;
  if (isAppLinkPath(actionUrl)) return actionUrl;
  if (typeof relatedId !== 'number' || !Number.isInteger(relatedId) || relatedId < 1) return null;
  if (
    typeof relatedType !== 'string' ||
    !Object.prototype.hasOwnProperty.call(RELATED_PREFIX, relatedType)
  )
    return null;
  return relatedPath(relatedType as RelatedType, relatedId);
}
