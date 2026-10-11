import type { RefObject } from 'react';
import { Bell } from 'lucide-react';
import type { Notification } from '../../../shared/types/notification.types';
import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from '../../api';
import { useNow } from '../../hooks/useNow';
import {
  Button,
  EmptyState,
  Notice,
  Skeleton,
  VisuallyHidden,
  useToast,
} from '../../components/ui';
import { NotificationItem } from './NotificationItem';

export interface NotificationListProps {
  /** The list's heading: focused when the list opens, and after its focused control goes. */
  headingRef: RefObject<HTMLHeadingElement | null>;
  /** A notification's link was followed: close the list (it has been marked read). */
  onNavigate: () => void;
  /** "Clear all" was pressed: close the list and confirm. */
  onClearAll: () => void;
}

function LoadingRows() {
  return (
    <div role="status" aria-busy="true" className="space-y-4 px-4 py-4">
      <VisuallyHidden>Loading notifications</VisuallyHidden>
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex gap-3">
          <Skeleton shape="circle" className="h-8 w-8 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton shape="text" className="w-3/4" />
            <Skeleton shape="text" className="w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The bell's list: a header with "Mark all as read" and "Clear all", then the newest
 * notifications, or a loading, failed or empty state. Marking read and deleting happen at once
 * and roll back, with an error toast, if main refuses.
 */
export function NotificationList({ headingRef, onNavigate, onClearAll }: NotificationListProps) {
  const list = useNotifications();
  const { data: unread = 0 } = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const remove = useDeleteNotification();
  const toast = useToast();
  const now = useNow(60_000);
  const notifications = list.data ?? [];

  const focusHeading = () => headingRef.current?.focus();
  const failed = (message: string) => () => toast.error(message);

  const open = (notification: Notification) => {
    if (!notification.isRead) {
      markRead.mutate(notification.id, {
        onError: failed("That notification couldn't be marked as read. Try again."),
      });
    }
    onNavigate();
  };
  const read = (notification: Notification) => {
    focusHeading();
    markRead.mutate(notification.id, {
      onError: failed("That notification couldn't be marked as read. Try again."),
    });
  };
  const del = (notification: Notification) => {
    focusHeading();
    remove.mutate(notification.id, {
      onError: failed("That notification couldn't be deleted. Try again."),
    });
  };
  const readAll = () =>
    markAllRead.mutate(undefined, {
      onError: failed("Your notifications couldn't be marked as read. Try again."),
    });

  return (
    <div className="flex max-h-[min(34rem,calc(100vh-6rem))] w-[24rem] max-w-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 ref={headingRef} tabIndex={-1} className="flex-1 text-base font-semibold text-fg">
          Notifications
        </h2>
        {unread > 0 && (
          <Button variant="ghost" size="sm" onClick={readAll}>
            Mark all as read
          </Button>
        )}
        {notifications.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClearAll}>
            Clear all
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isPending ? (
          <LoadingRows />
        ) : list.isError ? (
          <div className="p-4">
            <Notice
              tone="danger"
              title="Notifications couldn't be loaded"
              actions={
                <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
                  Retry
                </Button>
              }
            >
              {list.error.message}
            </Notice>
          </div>
        ) : notifications.length === 0 ? (
          <EmptyState
            icon={<Bell size={24} />}
            title="You're all caught up"
            description="Alerts about your watches, snipes and bookings show up here."
            size="md"
            headingLevel={3}
            className="py-8"
          />
        ) : (
          <ul className="divide-y divide-border">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                now={now}
                onOpen={open}
                onMarkRead={read}
                onDelete={del}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default NotificationList;
