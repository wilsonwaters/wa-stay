/**
 * `notifications` handlers. Notifications belong to the local profile; the renderer never
 * sends a user id.
 */

import { contract } from '@shared/contracts';
import type { AppContainer } from '../../app/container';
import { AppError } from '../../utils/app-error';
import type { Handle } from '../handle';

export function registerNotificationsHandlers(handle: Handle, c: AppContainer): void {
  const { notifications } = contract;

  handle(notifications.list, ({ limit }) =>
    c.notificationService.getNotifications(c.profile.requireUserId(), limit)
  );

  handle(notifications.markRead, ({ id }) => c.notificationService.markAsRead(id));

  handle(notifications.markAllRead, () =>
    c.notificationService.markAllAsRead(c.profile.requireUserId())
  );

  handle(notifications.unreadCount, () =>
    c.notificationService.getUnreadCount(c.profile.requireUserId())
  );

  handle(notifications.delete, async ({ id }) => {
    if (!(await c.notificationService.delete(id))) {
      throw new AppError('NOT_FOUND', 'Notification not found');
    }
    return true;
  });

  handle(notifications.clearAll, () => c.notificationService.deleteAll(c.profile.requireUserId()));
}
