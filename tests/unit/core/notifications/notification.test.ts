/**
 * NotificationService Unit Tests
 */

import { NotificationService } from '@main/core/notifications/notification.service';
import { insertUser, TestDatabaseHelper } from '@tests/utils/database-helper';
import { NotificationRepository } from '@main/database/repositories';
import { mockUserInput } from '@tests/fixtures/users';
import { mockWatch } from '@tests/fixtures/watches';
import { mockSiteSnipe } from '@tests/fixtures/site-sniper';
import { NotificationType } from '@shared/types/common.types';

describe('NotificationService', () => {
  let dbHelper: TestDatabaseHelper;
  let notificationService: NotificationService;
  let testUserId: number;

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('notification-service');
    await dbHelper.setup();

    const user = insertUser(dbHelper.getDb(), mockUserInput.email);
    testUserId = user.id;

    notificationService = new NotificationService(new NotificationRepository(dbHelper.getDb()));
  });

  afterEach(async () => {
    await dbHelper.teardown();
  });

  describe('notify', () => {
    it('should create a notification', async () => {
      const notification = await notificationService.notify({
        userId: testUserId,
        type: NotificationType.INFO,
        title: 'Test Notification',
        message: 'This is a test',
      });

      expect(notification).toBeDefined();
      // App-wide notifications have no provider
      expect(notification.providerId).toBeUndefined();
      expect(notification.id).toBeDefined();
      expect(notification.userId).toBe(testUserId);
      expect(notification.title).toBe('Test Notification');
      expect(notification.isRead).toBe(false);
    });
  });

  describe('notification:created', () => {
    it('notify emits notification:created with the stored notification', async () => {
      const events = { emit: jest.fn() };
      const repository = new NotificationRepository(dbHelper.getDb());
      const service = new NotificationService(repository, undefined, events);

      const notification = await service.notify({
        userId: testUserId,
        type: NotificationType.INFO,
        title: 'Emitted',
        message: 'Sent to the renderer',
      });

      expect(events.emit).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith('notification:created', notification);
      expect(events.emit.mock.calls[0][1]).toEqual(repository.findById(notification.id));
    });
  });

  describe('notifyWatchFound', () => {
    it('should create watch found notification', async () => {
      const watch = { ...mockWatch, userId: testUserId };
      await notificationService.notifyWatchFound(watch, [
        {
          unitId: 'S1',
          unitName: 'Site 1',
          unitType: 'Unpowered',
          arrival: '2024-07-01',
          departure: '2024-07-05',
          partial: false,
          priceKnown: false,
        },
      ]);

      const notifications = await notificationService.getNotifications(testUserId);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe(NotificationType.WATCH_FOUND);
      // Labelled with the watch's provider, and worded from its location and calendar dates
      expect(notifications[0].providerId).toBe('parkstay');
      expect(notifications[0].message).toContain('Dales Campground');
      expect(notifications[0].message).toContain(
        new Date('2024-07-01T00:00:00Z').toLocaleDateString(undefined, { timeZone: 'UTC' })
      );
    });
  });

  describe('notifyWatchPartialFound', () => {
    it('words the longest block from its calendar dates', async () => {
      const watch = { ...mockWatch, userId: testUserId };
      await notificationService.notifyWatchPartialFound(watch, [
        {
          unitId: 'S1',
          unitName: 'Site 1',
          unitType: 'Unpowered',
          arrival: '2024-07-01',
          departure: '2024-07-02',
          partial: true,
          priceKnown: true,
          total: 20,
        },
        {
          unitId: 'S2',
          unitName: 'Site 2',
          unitType: 'Unpowered',
          arrival: '2024-07-02',
          departure: '2024-07-05',
          partial: true,
          priceKnown: true,
          total: 60,
        },
      ]);

      const [notification] = await notificationService.getNotifications(testUserId);
      expect(notification.providerId).toBe('parkstay');
      expect(notification.message).toContain('3 consecutive nights');
    });
  });

  describe('notifySnipeHeld', () => {
    it('should create snipe held notification', async () => {
      const snipe = { ...mockSiteSnipe, userId: testUserId };
      await notificationService.notifySnipeHeld(snipe);

      const notifications = await notificationService.getNotifications(testUserId);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe(NotificationType.SNIPE_HELD);
      expect(notifications[0].actionUrl).toBe(`/site-sniper/${snipe.id}`);
      expect(notifications[0].providerId).toBe('parkstay');
      expect(notifications[0].message).toContain('Osprey Bay');
    });
  });

  describe('notifySnipeBooked', () => {
    it('should create snipe booked notification', async () => {
      const snipe = { ...mockSiteSnipe, userId: testUserId, bookedReference: 'PS0098765' };
      await notificationService.notifySnipeBooked(snipe);

      const notifications = await notificationService.getNotifications(testUserId);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe(NotificationType.SNIPE_BOOKED);
      expect(notifications[0].providerId).toBe('parkstay');
    });
  });

  describe('getUnreadNotifications', () => {
    it('should return only unread notifications', async () => {
      const notif1 = await notificationService.notify({
        userId: testUserId,
        type: NotificationType.INFO,
        title: 'Notification 1',
        message: 'Message 1',
      });

      await notificationService.notify({
        userId: testUserId,
        type: NotificationType.INFO,
        title: 'Notification 2',
        message: 'Message 2',
      });

      await notificationService.markAsRead(notif1.id);

      const unread = await notificationService.getUnreadNotifications(testUserId);
      expect(unread).toHaveLength(1);
      expect(unread[0].title).toBe('Notification 2');
    });
  });

  describe('getUnreadCount', () => {
    it('should return correct unread count', async () => {
      await notificationService.notify({
        userId: testUserId,
        type: NotificationType.INFO,
        title: 'N1',
        message: 'M1',
      });

      await notificationService.notify({
        userId: testUserId,
        type: NotificationType.INFO,
        title: 'N2',
        message: 'M2',
      });

      const count = await notificationService.getUnreadCount(testUserId);
      expect(count).toBe(2);
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all notifications as read', async () => {
      await notificationService.notify({
        userId: testUserId,
        type: NotificationType.INFO,
        title: 'N1',
        message: 'M1',
      });

      await notificationService.notify({
        userId: testUserId,
        type: NotificationType.INFO,
        title: 'N2',
        message: 'M2',
      });

      await notificationService.markAllAsRead(testUserId);

      const unreadCount = await notificationService.getUnreadCount(testUserId);
      expect(unreadCount).toBe(0);
    });
  });
});
