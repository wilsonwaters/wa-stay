import {
  Notification,
  NotificationInput,
  Watch,
  type ProviderId,
  SiteSnipe,
  type Booking,
  type UnitKind,
  type WatchHold,
  type WatchMatch,
} from '@shared/types';
import { NotificationType, RelatedType } from '@shared/types/common.types';
import { isAppLinkPath, notificationLinkPath, relatedPath } from '@shared/utils/app-links';
import { isCalendarDate, nightsBetween } from '@shared/utils/calendar-date';
import {
  capitalise,
  kindsOfUnits,
  unitCountLabel,
  unitNounFrom,
  type UnitNoun,
} from '@shared/utils/unit-noun';
import { NotificationRepository } from '../../database/repositories';
import { NotificationDispatcher } from './notification-dispatcher';
import type { EventSink } from '@shared/contracts/events';
import { Notification as ElectronNotification } from 'electron';
import { getBrandIconPath } from '../../app/paths';
import { describeUrl } from '../../providers/sdk/url-patterns';
import { logger } from '../../utils/logger';
import { firstBookingLink, type BookingLinkManifest } from '../booking-link';
import { longestRun } from '../watches/matching';

const log = logger.child({ module: 'notifications' });

/**
 * A calendar date `YYYY-MM-DD` in the host's date format, as the day it names (formatted in
 * UTC from UTC midnight, so the host time zone cannot shift it). Anything else is shown as is.
 */
function formatCalendarDate(date: string): string {
  if (!isCalendarDate(date)) return date;
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, { timeZone: 'UTC' });
}

/** What an alert carries beyond what is stored: for email, and for a desktop click. */
interface DispatchMeta {
  locationName?: string;
  /**
   * The provider's public booking page for what the alert found (`booking-link.ts`): the
   * email's "Book on {shortName}" link, and a desktop click opens it in the browser. It must
   * be a booking link of the notification's provider (`isProviderBookingLink`: https on its
   * own site); `notify` checks it against the provider's manifest again and drops it
   * otherwise. Never stored, in `notifications` or in the delivery log.
   */
  bookingUrl?: string;
  /**
   * The alert is about a hold WA Stay placed: a desktop click opens only the in-app page (the
   * person pays there), and the email says where the hold is. Never stored.
   */
  heldInApp?: boolean;
}

/** What a general notification (`notifyWarning`) is about: a watch, snipe or booking. */
export interface NotificationSubject {
  providerId: ProviderId;
  relatedType: RelatedType;
  relatedId: number;
  /** The place, for email. */
  locationName?: string;
}

/** A provider's short name (`ParkStay`), or undefined for an unknown provider. */
export type ProviderNameResolver = (providerId: string) => string | undefined;

/** A provider's manifest (its id and website), or undefined for an unknown provider. */
export type ProviderManifestResolver = (providerId: string) => BookingLinkManifest | undefined;

/**
 * A provider's default unit kinds (`providerUnitKinds`: its first location kind's), or none
 * for an unknown provider.
 */
export type ProviderUnitKindsResolver = (providerId: string) => readonly UnitKind[];

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
   * Resolves a provider's manifest through the registry, to check an alert's booking link
   * against its website. Without it (or for an unknown provider) alerts carry no link.
   */
  providerManifest?: ProviderManifestResolver;
  /**
   * Resolves a provider's default unit kinds through the registry: what alerts call its units
   * when neither the units found nor the watch or snipe say (ParkStay's: sites). Without it (or
   * for an unknown provider) such units are "spots".
   */
  providerUnitKinds?: ProviderUnitKindsResolver;
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
  /**
   * Opens a booking page in the system browser (`shell.openExternal`), after a click on an
   * alert that carries one has opened its page in the app.
   */
  openExternal?: (url: string) => Promise<void>;
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
  private readonly providerManifest: ProviderManifestResolver;
  private readonly providerUnitKinds: ProviderUnitKindsResolver;
  private readonly clock: () => Date;
  private readonly showMainWindow: () => boolean;
  private readonly openExternal: (url: string) => Promise<void>;
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
    this.providerManifest = options.providerManifest ?? (() => undefined);
    this.providerUnitKinds = options.providerUnitKinds ?? (() => []);
    this.clock = options.clock ?? (() => new Date());
    this.showMainWindow = options.showMainWindow ?? (() => false);
    this.openExternal = options.openExternal ?? (() => Promise.resolve());
    this.preferences = options.preferences ?? (() => DEFAULT_NOTIFICATION_PREFERENCES);
  }

  /**
   * Create a notification
   * @param input - Notification data to store (its title without a provider prefix)
   * @param dispatchMeta - The location for external notifiers (email, etc.), and an alert's
   *   booking page and whether it is about a hold in the app; none of it is stored
   */
  async notify(input: NotificationInput, dispatchMeta?: DispatchMeta): Promise<Notification> {
    // Store notification in database
    const notification = this.notificationRepo.create(input);
    const bookingUrl = this.checkedBookingLink(input, dispatchMeta?.bookingUrl);
    const heldInApp = dispatchMeta?.heldInApp === true;

    // The OS notification, if the person wants them; its sound is the OS's own (`silent`). A
    // click on an alert about a hold opens only the app, where the person pays.
    const { desktop, sound } = this.preferences();
    if (desktop) {
      await this.showDesktopNotification(notification, {
        silent: !sound,
        bookingUrl: heldInApp ? undefined : bookingUrl,
      });
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
          ...(bookingUrl ? { bookingUrl } : {}),
          ...(heldInApp ? { heldInApp } : {}),
        });
      } catch (error) {
        log.error('Error dispatching notification to providers:', error);
        // Don't throw - we don't want provider failures to break the main notification flow
      }
    }

    return notification;
  }

  /**
   * An alert's booking link, when it is one of the notification's provider (https on its own
   * site, checked against its manifest), normalised; otherwise none (a refused one is logged by
   * origin only).
   */
  private checkedBookingLink(
    input: NotificationInput,
    bookingUrl: string | undefined
  ): string | undefined {
    if (!bookingUrl || !input.providerId) return undefined;
    const manifest = this.providerManifest(input.providerId);
    return manifest ? firstBookingLink(manifest, [bookingUrl]) : undefined;
  }

  /**
   * What an alert calls its units (`unitNounFrom`): the kinds of the units it is about (those
   * found, or the one held), else the watch's or snipe's stay types, else its provider's.
   */
  private nounFor(
    subject: { providerId: string; unitKinds?: readonly UnitKind[] },
    units: readonly { unitKind?: unknown }[]
  ): UnitNoun {
    return unitNounFrom(
      kindsOfUnits(units),
      subject.unitKinds,
      this.providerUnitKinds(subject.providerId)
    );
  }

  /**
   * Notify when a watch finds the whole stay. `note` is a sentence added to the message, such
   * as why no automatic hold was placed. `bookingUrl` is the provider's booking page for the
   * stay found (`matchedStayLink`): a desktop click opens it, and the email links it.
   */
  async notifyWatchFound(
    watch: Watch,
    matches: WatchMatch[],
    note?: string,
    bookingUrl?: string
  ): Promise<void> {
    const noun = this.nounFor(watch, matches);
    const message =
      `Found ${unitCountLabel(matches.length, noun)} available at ${watch.location.name} for ${formatCalendarDate(watch.stay.arrival)} - ${formatCalendarDate(watch.stay.departure)}` +
      (note ? `. ${note}` : '');

    await this.notify(
      {
        userId: watch.userId,
        providerId: watch.providerId,
        type: NotificationType.WATCH_FOUND,
        title: `${capitalise(noun.many)} available at ${watch.location.name}`,
        message,
        relatedId: watch.id,
        relatedType: RelatedType.WATCH,
        actionUrl: relatedPath(RelatedType.WATCH, watch.id),
      },
      { locationName: watch.location.name, bookingUrl }
    );
  }

  /**
   * Notify when watch finds partial (consecutive subset) availability. The message names the
   * longest run (`longestRun`), the run `bookingUrl` is for.
   */
  async notifyWatchPartialFound(
    watch: Watch,
    partialResults: WatchMatch[],
    bookingUrl?: string
  ): Promise<void> {
    const longestBlock = longestRun(partialResults);
    if (!longestBlock) return;

    const nights = nightsBetween(longestBlock.arrival, longestBlock.departure);
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
      { locationName: watch.location.name, bookingUrl }
    );
  }

  /**
   * Notify when a watch's automatic hold was placed (payment still required), like a snipe's,
   * on `unit` (the match it held: its name, and its kind for the title): "Complete payment
   * within N minutes", "within about N minutes" when the expiry is the provider's guess
   * (`expiresEstimated`). A desktop click opens only the watch, where the person pays; the
   * email says the hold is in WA Stay and gives `bookingUrl`, the public booking page, for
   * booking away from it.
   */
  async notifyWatchHeld(
    watch: Watch,
    hold: WatchHold,
    unit: Pick<WatchMatch, 'unitName' | 'unitKind'>,
    bookingUrl?: string
  ): Promise<void> {
    const arrival = formatCalendarDate(watch.stay.arrival);
    const departure = formatCalendarDate(watch.stay.departure);
    const minutesLeft = Math.max(
      1,
      Math.round((Date.parse(hold.expiresAt) - this.clock().getTime()) / 60_000)
    );
    // A guessed expiry (`expiresEstimated`) is "about" (R18)
    const about = hold.expiresEstimated ? 'about ' : '';
    const message = `${unit.unitName} held at ${watch.location.name} for ${arrival}–${departure}. Complete payment within ${about}${minutesLeft} minutes.`;
    const noun = this.nounFor(watch, [unit]);

    await this.notify(
      {
        userId: watch.userId,
        providerId: watch.providerId,
        type: NotificationType.SNIPE_HELD,
        title: `${capitalise(noun.one)} held at ${watch.location.name}`,
        message,
        relatedId: watch.id,
        relatedType: RelatedType.WATCH,
        actionUrl: relatedPath(RelatedType.WATCH, watch.id),
      },
      { locationName: watch.location.name, bookingUrl, heldInApp: true }
    );
  }

  /**
   * Notify when a Site Snipe places a temporary hold (payment still required): "within N
   * minutes", "within about N minutes" when the expiry is the provider's guess
   * (`holdExpiresEstimated`). `unitKind` is the held unit's kind, when the provider gave one:
   * what the alert calls it. A desktop click opens only the snipe, where the person pays; the
   * email says the hold is in WA Stay and gives `bookingUrl`, the public booking page, for
   * booking away from it (brief R7).
   */
  async notifySnipeHeld(snipe: SiteSnipe, unitKind?: UnitKind, bookingUrl?: string): Promise<void> {
    const arrival = formatCalendarDate(snipe.stay.arrival);
    const departure = formatCalendarDate(snipe.stay.departure);
    const where = snipe.location.name || snipe.location.externalId;
    // The provider sets how long a hold lasts (ParkStay: 30 minutes).
    const minutesLeft = snipe.holdExpiresAt
      ? Math.max(1, Math.round((snipe.holdExpiresAt.getTime() - this.clock().getTime()) / 60_000))
      : undefined;
    // A guessed expiry (`holdExpiresEstimated`) is "about" (R18)
    const about = snipe.holdExpiresEstimated ? 'about ' : '';
    const deadline = minutesLeft
      ? ` within ${about}${minutesLeft} minutes`
      : ' before the hold expires';
    const held = capitalise(this.nounFor(snipe, [{ unitKind }]).one);
    const message = `${held} held at ${where} for ${arrival}–${departure}. Complete payment${deadline}.`;

    await this.notify(
      {
        userId: snipe.userId,
        providerId: snipe.providerId,
        type: NotificationType.SNIPE_HELD,
        title: `${held} held at ${where}`,
        message,
        relatedId: snipe.id,
        relatedType: RelatedType.SNIPE,
        actionUrl: relatedPath(RelatedType.SNIPE, snipe.id),
      },
      { locationName: snipe.location.name || undefined, bookingUrl, heldInApp: true }
    );
  }

  /**
   * Notify when a Site Snipe found the dates free and alerts instead of holding (its `alert`:
   * the unit, the note and the booking page). `unitKind` is the free unit's kind, when the
   * provider gave one: what the alert calls it ("A cabin is free at …"; "A spot is free at …"
   * when no kind is known). A desktop click opens the booking page in the browser and the
   * snipe in the app; the email has "Book on {shortName}". Nothing is held, and the copy never
   * says so.
   */
  async notifySnipeAlert(snipe: SiteSnipe, unitKind?: UnitKind): Promise<void> {
    const arrival = formatCalendarDate(snipe.stay.arrival);
    const departure = formatCalendarDate(snipe.stay.departure);
    const where = snipe.location.name || snipe.location.externalId;
    const noun = this.nounFor(snipe, [{ unitKind }]);
    const unit = snipe.alert?.unitName || `A ${noun.one}`;
    const note = snipe.alert?.note ? ` ${snipe.alert.note}` : '';
    const message = `${unit} is free at ${where} for ${arrival}–${departure}.${note}`;

    await this.notify(
      {
        userId: snipe.userId,
        providerId: snipe.providerId,
        type: NotificationType.SNIPE_ALERT,
        title: `A ${noun.one} is free at ${where}`,
        message,
        relatedId: snipe.id,
        relatedType: RelatedType.SNIPE,
        actionUrl: relatedPath(RelatedType.SNIPE, snipe.id),
      },
      { locationName: snipe.location.name || undefined, bookingUrl: snipe.alert?.bookingUrl }
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
   * Notify warning. `about`, when the warning is about a watch, snipe or booking: its provider
   * and its page (the notification links there), and its place for email.
   */
  async notifyWarning(
    userId: number,
    title: string,
    message: string,
    about?: NotificationSubject
  ): Promise<void> {
    await this.notify(
      {
        userId,
        type: NotificationType.WARNING,
        title,
        message,
        ...(about
          ? {
              providerId: about.providerId,
              relatedId: about.relatedId,
              relatedType: about.relatedType,
              actionUrl: relatedPath(about.relatedType, about.relatedId),
            }
          : {}),
      },
      about?.locationName ? { locationName: about.locationName } : undefined
    );
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
   * notification's page, then `bookingUrl` (an alert's booking page) in the browser.
   */
  private async showDesktopNotification(
    notification: Notification,
    { silent, bookingUrl }: { silent: boolean; bookingUrl?: string }
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
        this.openFromDesktop(notification, bookingUrl);
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
   * to open the notification's page, then open the alert's booking page (if it has one) in the
   * browser. Ignored while the app is quitting (no window to show): nothing opens.
   */
  private openFromDesktop(notification: Notification, bookingUrl?: string): void {
    if (!this.showMainWindow()) {
      log.info('Ignored a desktop notification click: no window to show');
      return;
    }
    if (notification.actionUrl && !isAppLinkPath(notification.actionUrl)) {
      log.warn(`Notification ${notification.id} links outside the allowed in-app pages; ignored`);
    }
    const path = notificationLinkPath(notification);
    if (path) this.events?.emit('app:navigate', { path });
    if (bookingUrl) this.openBookingPage(notification, bookingUrl);
  }

  /**
   * Opens an alert's booking page in the system browser. A failure (no default browser) is
   * logged by origin only, never the page's path or query; the app page is already open.
   */
  private openBookingPage(notification: Notification, url: string): void {
    Promise.resolve()
      .then(() => this.openExternal(url))
      .catch((error: unknown) => {
        const kind = error instanceof Error ? error.name : typeof error;
        log.warn(
          `Notification ${notification.id}: could not open ${describeUrl(url)} in the browser (${kind})`
        );
      });
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
