import { Link } from 'react-router';
import {
  BellRing,
  CalendarCheck,
  Check,
  CircleAlert,
  Info,
  Timer,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { NotificationType } from '../../../shared/types/common.types';
import type { Notification } from '../../../shared/types/notification.types';
import { Logo } from '../../components/brand/Logo';
import { relativeTime } from '../../components/timeFormat';
import { Badge, IconButton, ProviderBadge } from '../../components/ui';
import { notificationLink } from './deepLink';

/** One lucide icon per kind of notification (design-language.md, "Availability and states"). */
const TYPE_ICONS: Record<NotificationType, LucideIcon> = {
  [NotificationType.WATCH_FOUND]: BellRing,
  [NotificationType.SNIPE_HELD]: Timer,
  [NotificationType.SNIPE_BOOKED]: CalendarCheck,
  [NotificationType.BOOKING_CONFIRMED]: CalendarCheck,
  [NotificationType.ERROR]: CircleAlert,
  [NotificationType.WARNING]: TriangleAlert,
  [NotificationType.INFO]: Info,
};

/** App-wide notifications (no provider) carry the WA Stay mark instead of a provider badge. */
function WaStayGlyph() {
  return (
    <span
      role="img"
      aria-label="WA Stay"
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
    >
      <Logo variant="mark" decorative className="h-5 w-5" />
      <span className="text-xs font-semibold text-fg">WA Stay</span>
    </span>
  );
}

export interface NotificationItemProps {
  notification: Notification;
  now: Date;
  /** Its link was followed: mark it read and close the list. */
  onOpen: (notification: Notification) => void;
  onMarkRead: (notification: Notification) => void;
  onDelete: (notification: Notification) => void;
}

/**
 * One notification: whose it is (provider badge, or WA Stay), a type icon, title, message,
 * when, and "Unread" in words. The title links to its page when it has an allowed in-app one;
 * the whole row is the link's hit area, under its own buttons.
 */
export function NotificationItem({
  notification,
  now,
  onOpen,
  onMarkRead,
  onDelete,
}: NotificationItemProps) {
  const { title, message, providerId, isRead } = notification;
  const link = notificationLink(notification);
  const TypeIcon = TYPE_ICONS[notification.type] ?? Info;
  const createdAt = new Date(notification.createdAt);

  return (
    <li className="relative flex gap-3 px-4 py-3 hover:bg-surface-subtle">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-fg-secondary"
      >
        <TypeIcon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">
          {link ? (
            <Link
              to={link}
              onClick={() => onOpen(notification)}
              className="rounded-sm after:absolute after:inset-0 hover:underline"
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </p>
        <p className="mt-0.5 text-sm text-fg-secondary">{message}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
          {providerId ? <ProviderBadge providerId={providerId} size="sm" /> : <WaStayGlyph />}
          <time dateTime={createdAt.toISOString()}>{relativeTime(createdAt, now)}</time>
          {!isRead && <Badge tone="brand">Unread</Badge>}
        </div>
      </div>
      {/* Above the stretched link, so they stay clickable. */}
      <div className="relative z-10 -mr-1 flex shrink-0 items-start gap-0.5">
        {!isRead && (
          <IconButton
            size="sm"
            label={`Mark as read: ${title}`}
            icon={<Check size={16} />}
            onClick={() => onMarkRead(notification)}
          />
        )}
        <IconButton
          size="sm"
          label={`Delete notification: ${title}`}
          icon={<Trash2 size={16} />}
          onClick={() => onDelete(notification)}
        />
      </div>
    </li>
  );
}

export default NotificationItem;
