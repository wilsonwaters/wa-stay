/**
 * Database Integration Tests
 * Tests database connection, repositories, and data persistence
 */

import { insertUser, TestDatabaseHelper } from '@tests/utils/database-helper';
import { UserRepository } from '@main/database/repositories/user.repository';
import { BookingRepository } from '@main/database/repositories/booking.repository';
import { WatchRepository } from '@main/database/repositories';
import { SiteSniperRepository } from '@main/database/repositories';
import { NotificationRepository } from '@main/database/repositories';
import { mockUserInput } from '@tests/fixtures/users';
import { createMockBookingInput } from '@tests/fixtures/bookings';
import { createMockWatchInput } from '@tests/fixtures/watches';
import { createMockSiteSnipeInput } from '@tests/fixtures/site-sniper';
import { SnipeStatus } from '@shared/types/common.types';
import { NotificationType } from '@shared/types/common.types';

describe('Database Integration', () => {
  let dbHelper: TestDatabaseHelper;

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('database-integration');
    await dbHelper.setup();
  });

  afterEach(async () => {
    await dbHelper.teardown();
  });

  describe('Schema and Tables', () => {
    it('should have all required tables', () => {
      const db = dbHelper.getDb();
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];

      const tableNames = tables.map((t) => t.name);

      expect(tableNames).toContain('users');
      expect(tableNames).toContain('bookings');
      expect(tableNames).toContain('watches');
      expect(tableNames).toContain('notifiers');
      expect(tableNames).toContain('notification_delivery_logs');
      // v8: queue_session moved into provider_state
      expect(tableNames).not.toContain('queue_session');
      expect(tableNames).toContain('provider_state');
      expect(tableNames).toContain('provider_accounts');
      expect(tableNames).toContain('locations');
      expect(tableNames).toContain('locations_fts');
      expect(tableNames).not.toContain('skip_the_queue_entries');
      expect(tableNames).toContain('site_snipes');
      expect(tableNames).toContain('notifications');
      expect(tableNames).toContain('settings');
      // v10: the never-written job_logs is gone
      expect(tableNames).not.toContain('job_logs');
      expect(tableNames).toContain('migrations');
    });

    it('should have foreign keys enabled', () => {
      const db = dbHelper.getDb();
      const result = db.pragma('foreign_keys', { simple: true });
      expect(result).toBe(1);
    });

    it('should use WAL journal mode', () => {
      const db = dbHelper.getDb();
      const result = db.pragma('journal_mode', { simple: true });
      expect(result).toBe('wal');
    });
  });

  describe('Cross-Repository Operations', () => {
    it('should maintain referential integrity', async () => {
      const db = dbHelper.getDb();
      const userRepo = new UserRepository(db);
      const bookingRepo = new BookingRepository(db);

      // Create user and booking
      const user = insertUser(db, mockUserInput.email);
      const bookingInput = createMockBookingInput();
      const booking = bookingRepo.create(user.id, bookingInput);

      expect(booking.userId).toBe(user.id);

      // Verify booking exists
      const retrieved = bookingRepo.findById(booking.id);
      expect(retrieved).toBeDefined();

      // Delete user (should cascade delete booking due to FK constraint)
      userRepo.deleteById(user.id);

      // Booking should be deleted
      const bookingAfterDelete = bookingRepo.findById(booking.id);
      expect(bookingAfterDelete).toBeNull();
    });

    it('should handle complex watch-booking-notification flow', async () => {
      const db = dbHelper.getDb();
      const bookingRepo = new BookingRepository(db);
      const watchRepo = new WatchRepository(db);
      const notifRepo = new NotificationRepository(db);

      // Create user
      const user = insertUser(db, mockUserInput.email);

      // Create booking
      const bookingInput = createMockBookingInput();
      const booking = bookingRepo.create(user.id, bookingInput);

      // Create watch for same location
      const watchInput = createMockWatchInput({
        campgroundId: bookingInput.campgroundName,
      });
      const watch = watchRepo.create(user.id, watchInput);

      // Create notification about watch finding availability
      const notification = notifRepo.create({
        userId: user.id,
        type: NotificationType.WATCH_FOUND,
        title: 'Availability Found',
        message: 'Found availability for your watch',
        relatedId: watch.id,
        relatedType: 'watch',
      });

      // Verify everything is connected
      expect(watch.userId).toBe(user.id);
      expect(booking.userId).toBe(user.id);
      expect(notification.userId).toBe(user.id);
      expect(notification.relatedId).toBe(watch.id);
    });

    it('should handle Site Sniper workflow', async () => {
      const db = dbHelper.getDb();
      const snipeRepo = new SiteSniperRepository(db);

      // Create user
      const user = insertUser(db, mockUserInput.email);

      // Create site snipe
      const snipeInput = createMockSiteSnipeInput();
      const snipe = snipeRepo.create(user.id, snipeInput);

      expect(snipe.userId).toBe(user.id);
      expect(snipe.status).toBe(SnipeStatus.ARMED);
      expect(snipe.unitIds).toEqual(snipeInput.unitIds);

      // Simulate a successful hold
      const heldExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
      snipeRepo.setHeld(snipe.id, '987654', heldExpiresAt, 'https://parkstay/booking/', '136');

      const updated = snipeRepo.findById(snipe.id);
      expect(updated?.status).toBe(SnipeStatus.HELD);
      expect(updated?.holdReference).toBe('987654');
      expect(updated?.holdUnitId).toBe('136');
      expect(updated?.holdExpiresAt).toBeDefined();
    });
  });

  describe('Transactions', () => {
    it('should rollback on error', async () => {
      const db = dbHelper.getDb();
      const userRepo = new UserRepository(db);

      const user = insertUser(db, mockUserInput.email);

      // Attempt transaction that should fail
      try {
        db.transaction(() => {
          insertUser(db, mockUserInput.email); // Duplicate email
        })();
      } catch {
        // Expected to fail
      }

      // Original user should still exist
      const retrievedUser = userRepo.findById(user.id);
      expect(retrievedUser).toBeDefined();
    });
  });

  describe('Indexes', () => {
    it('should have indexes on key columns', () => {
      const db = dbHelper.getDb();
      const indexes = db
        .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index'")
        .all() as { name: string; tbl_name: string }[];

      const indexNames = indexes.map((i) => i.name);

      // Check critical indexes exist
      expect(indexNames).toContain('idx_users_email');
      expect(indexNames).toContain('idx_bookings_reference');
      expect(indexNames).toContain('idx_bookings_user_id');
      expect(indexNames).toContain('idx_watches_user_id');
      expect(indexNames).toContain('idx_watches_active');
      expect(indexNames).toContain('idx_delivery_logs_notification_id');
      expect(indexNames).toContain('idx_notifiers_channel');
      expect(indexNames).toContain('idx_notifications_user_id');
    });
  });

  describe('Performance', () => {
    it('should handle bulk inserts efficiently', async () => {
      const db = dbHelper.getDb();
      const bookingRepo = new BookingRepository(db);

      const user = insertUser(db, mockUserInput.email);

      const startTime = Date.now();
      const count = 100;

      for (let i = 0; i < count; i++) {
        const input = createMockBookingInput({
          bookingReference: `BK${100000 + i}`,
        });
        bookingRepo.create(user.id, input);
      }

      const duration = Date.now() - startTime;

      // Should complete bulk insert in reasonable time (< 1 second)
      expect(duration).toBeLessThan(1000);

      const bookings = bookingRepo.findByUserId(user.id);
      expect(bookings).toHaveLength(count);
    });

    it('should handle bulk reads efficiently', async () => {
      const db = dbHelper.getDb();
      const bookingRepo = new BookingRepository(db);

      const user = insertUser(db, mockUserInput.email);

      // Create 100 bookings
      for (let i = 0; i < 100; i++) {
        const input = createMockBookingInput({
          bookingReference: `BK${100000 + i}`,
        });
        bookingRepo.create(user.id, input);
      }

      const startTime = Date.now();

      // Read all bookings multiple times
      for (let i = 0; i < 10; i++) {
        bookingRepo.findByUserId(user.id);
      }

      const duration = Date.now() - startTime;

      // Should complete 10 reads of 100 bookings in reasonable time (< 500ms)
      expect(duration).toBeLessThan(500);
    });
  });
});
