import {
  Notification,
  NotificationInput,
  Watch,
  SiteSnipe,
  type Booking,
  type WatchHold,
  type WatchMatch,
} from '@shared/types';
import { NotificationType, RelatedType } from '@shared/types/common.types';
import { isAppLinkPath, notificationLinkPath, relatedPath } from '@shared/utils/app-links';
import { isCalendarDate, nightsBetween } from '@shared/utils/calendar-date';
import { NotificationRepository } from '../../database/repositories';
import { NotificationDispatcher } from './notification-dispatcher';
import type { EventSink } from '@shared/contracts/events';
import { Notification as ElectronNotification } from 'electron';
import { getBrandIconPath } from '../../app/paths';
import { logger } from '../../utils/logger';

const log = logger.child({ module: 'notifications' });

/**
 * A calendar date `YYYY-MM-DD` in the host's date format, as the day it names (formatted in
 * UTC from UTC midnight, so the host time zone cannot shift it). Anything else is shown as is.
 */
function formatCalendarDate(date: string): string {
  if (!isCalendarDate(date)) return date;
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, { timeZone: 'UTC' });
}

/** What an email says a notification is about, beyond what is stored. */
interface DispatchMeta {
  locationName?: string;
}

/** A provider's short name (`ParkStay`), or undefined for an unknown provider. */
export type ProviderNameResolver = (providerId: string) => string | undefined;

/** The person's notification preferences (Settings → Notifications). */
export interface NotificationPreferences {
  /** Show an OS (desktop) notification. The in-app list, events and email are not affected. */
  desktop: boolean;
  /** Let the OS notification play its sound (its `silent` flag). */
  sound: boolean;
}

/** Desktop notifications with sound: what a fresh install has. */
export const DEFAULT_NOTIFICATION_PREFERENCES: Readonly<NotificationPreferences> = Object.freeze({
  desktop: true,
  sound: true,
});

export interface NotificationServiceOptions {
  /** Resolves a provider's short name through the registry, for desktop titles. */
  providerName?: ProviderNameResolver;
  /**
   * The current preferences, read on every notification, so a change in Settings applies to
   * the next one with nothing to push. The container reads the stored settings.
   */
  preferences?: () => NotificationPreferences;
  /** For the minutes a hold has left. */
  clock?: () => Date;
  /**
   * Restores, shows and focuses the main window when a desktop notification is clicked.
   * Returns false when there is no window or the app is quitting: the click is then ignored.
   */
  showMainWindow?: () => boolean;
}

/**
 * Desktop notifications kept alive until they are clicked or closed: one that is garbage
 * collected first never reports its click (Windows). Only the newest are kept.
 */
const MAX_LIVE_DESKTOP_NOTIFICATIONS = 20;

/**
 * The title of the OS (desktop) notification: `ParkStay · Site held` when the notification
 * belongs to a provider the registry knows, otherwise the stored title. The stored and
 * in-app title has no prefix; `providerId` carries the provider (architecture-notes §12.31).
 */
export function desktopTitle(
  notification: Pick<Notification, 'title' | 'providerId'>,
  providerName: ProviderNameResolver
): string {
  const shortName = notification.providerId ? providerName(notification.providerId) : undefined;
  return shortName ? `${shortName} · ${notification.title}` : notification.title;
}

/**
 * Notification Service
 * Handles user notifications (desktop and in-app)
 */
export class NotificationService {
  private notificationRepo: NotificationRepository;
  private dispatcher: NotificationDispatcher | null = null;
  private events: EventSink | null = null;
  private readonly providerName: ProviderNameResolver;
  private readonly clock: () => Date;
  private readonly showMainWindow: () => boolean;
  private readonly liveDesktop = new Set<ElectronNotification>();
  private readonly preferences: () => NotificationPreferences;

  /** `events` delivers `notification:created` to trusted renderers. */
  constructor(
    notificationRepo: NotificationRepository,
    dispatcher?: NotificationDispatcher,
    events?: EventSink,
    options: NotificationServiceOptions = {}
  ) {
    this.notificationRepo = notificationRepo;
    this.dispatcher = dispatcher || null;
    this.events = events || null;
    this.providerName = options.providerName ?? (() => undefined);
    this.clock = options.clock ?? (() => new Date());
    this.showMainWindow = options.showMainWindow ?? (() => false);
    this.preferences = options.preferences ?? (() => DEFAULT_NOTIFICATION_PREFERENCES);
  }

  /**
   * Create a notification
   * @param input - Notification data to store (its title without a provider prefix)
   * @param dispatchMeta - The location, for external notifiers (email, etc.)
   */
  async notify(input: NotificationInput, dispatchMeta?: DispatchMeta): Promise<Notification> {
    // Store notification in database
    const notification = this.notificationRepo.create(input);

    // The OS notification, if the person wants them; its sound is the OS's own (`silent`)
    const { desktop, sound } = this.preferences();
    if (desktop) {
      await this.showDesktopNotification(notification, { silent: !sound });
    }

    // Tell the renderer about the stored notification
    this.events?.emit('notification:created', notification);

    // Dispatch to all enabled external providers (email, etc.)
    if (this.dispatcher) {
      try {
        await this.dispatcher.dispatch({
          title: notification.title,
          message: notification.message,
          actionUrl: notification.actionUrl,
          type: notification.type,
          providerId: notification.providerId,
          locationName: dispatchMeta?.locationName,
        });
      } catch (error) {
        log.error('Error dispatching notification to providers:', error);
        // Don't throw - we don't want provider failures to break the main notification flow
      }
    }

    return notification;
  }

  /**
   * Notify when a watch finds the whole stay. `note` is a sentence added to the message, such
   * as why no automatic hold was placed.
   */
  async notifyWatchFound(watch: Watch, matches: WatchMatch[], note?: string): Promise<void> {
    const sitesText = matches.length === 1 ? '1 site' : `${matches.length} sites`;
    const message =
      `Found ${sitesText} available at ${watch.location.name} for ${formatCalendarDate(watch.stay.arrival)} - ${formatCalendarDate(watch.stay.departure)}` +
      (note ? `. ${note}` : '');

    await this.notify(
      {
        userId: watch.userId,
        providerId: watch.providerId,
        type: NotificationType.WATCH_FOUND,
        title: `Sites available at ${watch.location.name}`,
        message,
        relatedId: watch.id,
        relatedType: RelatedType.WATCH,
        actionUrl: relatedPath(RelatedType.WATCH, watch.id),
      },
      { locationName: watch.location.name }
    );
  }

  /**
   * Notify when watch finds partial (consecutive subset) availability
   */
  async notifyWatchPartialFound(watch: Watch, partialResults: WatchMatch[]): Promise<void> {
    // Highlight the longest consecutive block
    const nightsOf = (r: WatchMatch): number => nightsBetween(r.arrival, r.departure);
    const longestBlock = partialResults.reduce((best, r) =>
      nightsOf(r) > nightsOf(best) ? r : best
    );

    const nights = nightsOf(longestBlock);
    const nightsText = nights === 1 ? '1 night' : `${nights} consecutive nights`;
    const message = `Partial availability at ${watch.location.name}: ${nightsText} available from ${formatCalendarDate(longestBlock.arrival)} - ${formatCalendarDate(longestBlock.departure)}`;

    await this.notify(
      {
        userId: watch.userId,
        providerId: watch.providerId,
        type: NotificationType.WATCH_FOUND,
        title: `Some nights available at ${watch.location.name}`,
        message,
        relatedId: watch.id,
        relatedType: RelatedType.WATCH,
        actionUrl: relatedPath(RelatedType.WATCH, watch.id),
      },
      { locationName: watch.location.name }
    );
  }

  /**
   * Notify when a watch's automatic hold was placed (payment still required), like a snipe's.
   */
  async notifyWatchHeld(watch: Watch, hold: WatchHold, unitName: string): Promise<void> {
    const arrival = formatCalendarDate(watch.stay.arrival);
    const departure = formatCalendarDate(watch.stay.departure);
    const minutesLeft = Math.max(
      1,
      Math.round((Date.parse(hold.expiresAt) - this.clock().getTime()) / 60_000)
    );
    const message = `${unitName} held at ${watch.location.name} for ${arrival}–${departure}. Complete payment within ${minutesLeft} minutes.`;

    await this.notify(
      {
        userId: watch.userId,
        providerId: watch.providerId,
        type: NotificationType.SNIPE_HELD,
        title: `Site held at ${watch.location.name}`,
        message,
        relatedId: watch.id,
        relatedType: RelatedType.WATCH,
        actionUrl: relatedPath(RelatedType.WATCH, watch.id),
      },
      { locationName: watch.location.name }
    );
  }

  /**
   * Notify when a Site Snipe places a temporary hold (payment still required).
   */
  async notifySnipeHeld(snipe: SiteSnipe): Promise<void> {
    const arrival = formatCalendarDate(snipe.stay.arrival);
    const departure = formatCalendarDate(snipe.stay.departure);
    const where = snipe.location.name || snipe.location.externalId;
    // The provider sets how long a hold lasts (ParkStay: 30 minutes).
    const minutesLeft = snipe.holdExpiresAt
      ? Math.max(1, Math.round((snipe.holdExpiresAt.getTime() - this.clock().getTime()) / 60_000))
      : undefined;
    const deadline = minutesLeft ? ` within ${minutesLeft} minutes` : ' before the hold expires';
    const message = `Site held at ${where} for ${arrival}–${departure}. Complete payment${deadline}.`;

    await this.notify(
      {
        userId: snipe.userId,
        providerId: snipe.providerId,
        type: NotificationType.SNIPE_HELD,
        title: `Site held at ${where}`,
        message,
        relatedId: snipe.id,
        relatedType: RelatedType.SNIPE,
        actionUrl: relatedPath(RelatedType.SNIPE, snipe.id),
      },
      { locationName: snipe.location.name || undefined }
    );
  }

  /**
   * Notify when a Site Snipe booking is completed (payment confirmed).
   */
  async notifySnipeBooked(snipe: SiteSnipe): Promise<void> {
    const arrival = formatCalendarDate(snipe.stay.arrival);
    const departure = formatCalendarDate(snipe.stay.departure);
    const where = snipe.location.name || snipe.location.externalId;
    const reference = snipe.bookedReference ? ` (ref ${snipe.bookedReference})` : '';
    const message = `Booking confirmed at ${where} for ${arrival}–${departure}${reference}.`;

    await this.notify(
      {
        userId: snipe.userId,
        providerId: snipe.providerId,
        type: NotificationType.SNIPE_BOOKED,
        title: `Booked at ${where}`,
        message,
        relatedId: snipe.id,
        relatedType: RelatedType.SNIPE,
        actionUrl: relatedPath(RelatedType.SNIPE, snipe.id),
      },
      { locationName: snipe.location.name || undefined }
    );
  }

  /**
   * Notify booking confirmation
   */
  async notifyBookingConfirmed(
    booking: Pick<Booking, 'id' | 'userId' | 'providerId' | 'bookingReference' | 'location'>
  ): Promise<void> {
    const where = booking.location.name || booking.location.externalId;
    await this.notify(
      {
        userId: booking.userId,
        providerId: booking.providerId,
        type: NotificationType.BOOKING_CONFIRMED,
        title: where ? `Booking confirmed at ${where}` : 'Booking confirmed',
        message: `Your booking ${booking.bookingReference} has been confirmed.`,
        relatedId: booking.id,
        relatedType: RelatedType.BOOKING,
        actionUrl: relatedPath(RelatedType.BOOKING, booking.id),
      },
      { locationName: booking.location.name || undefined }
    );
  }

  /**
   * Notify error
   */
  async notifyError(userId: number, error: Error, context: string): Promise<void> {
    await this.notify({
      userId,
      type: NotificationType.ERROR,
      title: 'Error',
      message: `${context}: ${error.message}`,
    });
  }

  /**
   * Notify warning
   */
  async notifyWarning(userId: number, title: string, message: string): Promise<void> {
    await this.notify({
      userId,
      type: NotificationType.WARNING,
      title,
      message,
    });
  }

  /**
   * Notify info
   */
  async notifyInfo(userId: number, title: string, message: string): Promise<void> {
    await this.notify({
      userId,
      type: NotificationType.INFO,
      title,
      message,
    });
  }

  /**
   * Show desktop notification. A click brings the main window forward and opens the
   * notification's page.
   */
  private async showDesktopNotification(
    notification: Notification,
    { silent }: { silent: boolean }
  ): Promise<void> {
    try {
      const desktopNotification = new ElectronNotification({
        title: desktopTitle(notification, this.providerName),
        body: notification.message,
        silent,
        icon: getBrandIconPath(),
      });

      this.keepAlive(desktopNotification);
      desktopNotification.on('click', () => {
        this.liveDesktop.delete(desktopNotification);
        this.openFromDesktop(notification);
      });
      desktopNotification.on('close', () => this.liveDesktop.delete(desktopNotification));

      desktopNotification.show();
    } catch (error) {
      log.error('Failed to show desktop notification:', error);
    }
  }

  private keepAlive(desktopNotification: ElectronNotification): void {
    this.liveDesktop.add(desktopNotification);
    if (this.liveDesktop.size > MAX_LIVE_DESKTOP_NOTIFICATIONS) {
      const [oldest] = this.liveDesktop;
      this.liveDesktop.delete(oldest);
    }
  }

  /**
   * A desktop notification was clicked: restore and focus the window, then ask the renderer
   * to open the notification's page. Ignored while the app is quitting (no window to show).
   */
  private openFromDesktop(notification: Notification): void {
    if (!this.showMainWindow()) {
      log.info('Ignored a desktop notification click: no window to show');
      return;
    }
    if (notification.actionUrl && !isAppLinkPath(notification.actionUrl)) {
      log.warn(`Notification ${notification.id} links outside the allowed in-app pages; ignored`);
    }
    const path = notificationLinkPath(notification);
    if (path) this.events?.emit('app:navigate', { path });
  }

  /**
   * Get notifications for user
   */
  async getNotifications(userId: number, limit?: number): Promise<Notification[]> {
    return this.notificationRepo.findByUserId(userId, limit);
  }

  /**
   * Get unread notifications for user
   */
  async getUnreadNotifications(userId: number): Promise<Notification[]> {
    return this.notificationRepo.findUnreadByUserId(userId);
  }

  /**
   * Get unread count
   */
  async getUnreadCount(userId: number): Promise<number> {
    return this.notificationRepo.getUnreadCount(userId);
  }

  /**
   * Mark notification as read
   */
  async markAsRead(id: number): Promise<void> {
    this.notificationRepo.markAsRead(id);
  }

  /**
   * Mark all notifications as read for user
   */
  async markAllAsRead(userId: number): Promise<void> {
    this.notificationRepo.markAllAsRead(userId);
  }

  /**
   * Delete notification
   */
  async delete(id: number): Promise<boolean> {
    return this.notificationRepo.deleteById(id);
  }

  /**
   * Delete all notifications for user
   */
  async deleteAll(userId: number): Promise<number> {
    return this.notificationRepo.deleteAllForUser(userId);
  }
}
