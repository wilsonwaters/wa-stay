import type { Notification } from '../../../shared/types/notification.types';
import { notificationLinkPath } from '../../../shared/utils/app-links';

/**
 * Where a notification leads inside WA Stay: its `actionUrl` when that is an allowed in-app
 * page (`/watches/:id`, `/site-sniper/:id`, `/bookings/:id`, `/settings/:section`), otherwise
 * the page of its watch, snipe or booking, otherwise nowhere. Never an external address. The
 * one mapping is shared with main (`shared/utils/app-links.ts`); `deepLink.test.ts` holds it to
 * `ROUTES`.
 */
export function notificationLink(
  notification: Pick<Notification, 'actionUrl' | 'relatedType' | 'relatedId'>
): string | null {
  return notificationLinkPath(notification);
}
