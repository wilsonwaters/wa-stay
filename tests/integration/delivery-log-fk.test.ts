/**
 * Regression test for the migration-006 foreign-key bug (tech-review finding 1).
 *
 * v6 renamed `notifications` to `notifications_old` and dropped it. SQLite (>= 3.26)
 * rewrites the FK in `notification_delivery_logs` during the rename, so every later insert
 * into the log fails with "no such table: main.notifications_old", even with a NULL
 * notification_id. Migration v7 rebuilds the log table with an FK to `notifications`.
 */

import Database from 'better-sqlite3';
import { TestDatabaseHelper } from '@tests/utils/database-helper';
import { NotifierRepository } from '@main/database/repositories/notifier.repository';
import { NotifierChannel } from '@shared/types';
import { testVault } from '@tests/utils/fake-safe-storage';

describe('notification delivery log on a freshly migrated database', () => {
  let dbHelper: TestDatabaseHelper;
  let db: Database.Database;
  let repo: NotifierRepository;

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('delivery-log-fk');
    db = await dbHelper.setup();
    repo = new NotifierRepository(db, testVault().vault);
  });

  afterEach(async () => {
    await dbHelper.teardown();
  });

  test('accepts a delivery log without a notification_id', () => {
    const log = repo.logDelivery({
      notifierChannel: NotifierChannel.EMAIL_SMTP,
      status: 'failed',
      errorMessage: 'Invalid login',
    });

    expect(log.notificationId).toBeUndefined();
    expect(log.status).toBe('failed');
  });

  test('accepts a delivery log linked to a notification', () => {
    // The local profile (users id 1) exists from migration v8.
    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, message)
       VALUES (1, 1, 'info', 'Title', 'Message')`
    ).run();

    const log = repo.logDelivery({
      notificationId: 1,
      notifierChannel: NotifierChannel.EMAIL_SMTP,
      status: 'sent',
      sentAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(log.notificationId).toBe(1);
    expect(repo.getDeliveryLogsForNotification(1)).toHaveLength(1);
  });
});
