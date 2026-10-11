import { useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import type { Notification } from '../../../shared/types/notification.types';
import {
  useApiEvent,
  useClearNotifications,
  useNotificationUpdates,
  useProviders,
  useUnreadNotificationCount,
} from '../../api';
import { ConfirmDialog, IconButton, Popover, useAnnounce } from '../../components/ui';
import { badgeText, bellLabel } from './bellLabel';
import { NotificationList } from './NotificationList';

/**
 * The header's bell (docs/design/shell.md): named "Notifications, N unread" from main's unread
 * count, with a decorative badge (99+ at most). It opens a popover with the list; Escape or a
 * click outside closes it and returns focus to the bell. New notifications update the count
 * as they arrive and are announced politely.
 */
export interface NotificationBellProps {
  /** The list opened or closed (the shell sets the tray aside while it is open). */
  onOpenChange?: (open: boolean) => void;
}

export function NotificationBell({ onOpenChange }: NotificationBellProps = {}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [confirmingClear, setConfirmingClear] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { data: unread = 0 } = useUnreadNotificationCount();
  const providers = useProviders();
  const clearAll = useClearNotifications();
  const announce = useAnnounce();
  useNotificationUpdates();

  useApiEvent('notification:created', (notification: Notification) => {
    const provider = providers.data?.find((p) => p.id === notification.providerId);
    announce(
      provider
        ? `New ${provider.shortName} notification: ${notification.title}`
        : `New notification: ${notification.title}`
    );
  });

  const badge = badgeText(unread);
  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        label="Notifications"
        align="end"
        padding="none"
        initialFocusRef={headingRef}
        trigger={
          <IconButton
            label={bellLabel(unread)}
            className="relative"
            icon={
              <>
                <Bell />
                {/* The count is in the name, so the badge is decorative. */}
                {badge && (
                  <span
                    aria-hidden="true"
                    data-testid="notification-badge"
                    className="pointer-events-none absolute right-0 top-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent px-1 text-[0.6875rem] font-semibold leading-none tabular-nums text-accent-fg ring-2 ring-surface"
                  >
                    {badge}
                  </span>
                )}
              </>
            }
          />
        }
      >
        {({ close }) => (
          <NotificationList
            headingRef={headingRef}
            onNavigate={close}
            onClearAll={() => {
              close();
              setConfirmingClear(true);
            }}
          />
        )}
      </Popover>
      <ConfirmDialog
        open={confirmingClear}
        title="Clear all notifications?"
        message="This deletes every notification in WA Stay. It can't be undone."
        confirmLabel="Clear all"
        onConfirm={() => clearAll.mutateAsync().then(() => setConfirmingClear(false))}
        onCancel={() => setConfirmingClear(false)}
      />
    </>
  );
}

export default NotificationBell;
