/**
 * @jest-environment node
 *
 * Every instant SQLite writes itself (`DEFAULT CURRENT_TIMESTAMP`, `SET x = CURRENT_TIMESTAMP`:
 * "2026-10-09 07:15:00", UTC with no zone) reads back as that UTC instant, not as the host's
 * local time: 8 hours off in Perth, so a new notification said "8 h ago" (`readInstant`).
 *
 * `npm test` runs this in the host's own zone. `npm run test:tz` (and CI) runs it with the host
 * in Perth: TZ is set before Jest starts its workers, because Jest cannot change the zone of a
 * test that is already running.
 */
import type Database from 'better-sqlite3';
import { openDatabase } from '@main/database/connection';
import {
  BookingRepository,
  NotificationRepository,
  NotifierRepository,
  ProviderAccountRepository,
  SettingsRepository,
  SiteSniperRepository,
  UserRepository,
  WatchRepository,
} from '@main/database/repositories';
import { NotificationType } from '@shared/types/common.types';
import { NotifierChannel, SettingCategory, SettingValueType, SMTPPreset } from '@shared/types';
import { mockBookingInput } from '@tests/fixtures/bookings';
import { createMockSiteSnipeInput } from '@tests/fixtures/site-sniper';
import { createMockWatchInput } from '@tests/fixtures/watches';
import { removeUserData, testVault, type TestVault } from '@tests/utils/fake-safe-storage';

const PERTH_OFFSET_MINUTES = -480;
const userId = 1;

describe('instants SQLite writes read as UTC, whatever the host zone', () => {
  let db: Database.Database;
  let t: TestVault;

  /** The column as stored, and the instant it means (UTC). */
  const raw = (sql: string, ...args: unknown[]): { text: string; utc: number } => {
    const text =
      (db
        .prepare(sql)
        .pluck()
        .get(...args) as string) ?? '';
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    return { text, utc: Date.parse(`${text.replace(' ', 'T')}Z`) };
  };
  /** Read back as exactly the stored UTC instant, and so within seconds of now. */
  const readsAsStored = (read: Date | undefined, stored: { utc: number }) => {
    expect(read?.getTime()).toBe(stored.utc);
    expect(Math.abs((read?.getTime() ?? 0) - Date.now())).toBeLessThan(5_000);
  };

  beforeEach(() => {
    db = openDatabase(':memory:');
    t = testVault();
    // v8 seeds the local profile row; fresh timestamps make "within seconds of now" testable
    db.prepare(
      'UPDATE users SET created_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
    ).run();
  });

  afterEach(() => {
    db.close();
    removeUserData(t.userDataDir);
  });

  it('runs in the zone it was started in (npm run test:tz pins Perth)', () => {
    if (process.env.TZ === 'Australia/Perth') {
      expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).toBe(PERTH_OFFSET_MINUTES);
      // A zone-less timestamp would read 8 h off here: what these tests guard against.
      expect(new Date('2026-01-01 00:00:00').getTime()).not.toBe(
        Date.parse('2026-01-01T00:00:00Z')
      );
    }
  });

  it('notifications.created_at', () => {
    const n = new NotificationRepository(db).create({
      userId,
      type: NotificationType.INFO,
      title: 't',
      message: 'm',
    });
    readsAsStored(n.createdAt, raw('SELECT created_at FROM notifications WHERE id = ?', n.id));
  });

  it('retention compares CURRENT_TIMESTAMP text as the UTC instant it is', () => {
    const insert = (title: string, modifier: string) =>
      db
        .prepare(
          `INSERT INTO notifications (user_id, type, title, message, created_at)
           VALUES (?, 'info', ?, 'm', datetime('now', '-30 days', ?))`
        )
        .run(userId, title, modifier);
    // Four hours either side of the cutoff: half of Perth's offset, so a zone mix-up shows
    insert('older', '-4 hours');
    insert('younger', '+4 hours');
    const repo = new NotificationRepository(db);

    expect(repo.deleteCreatedBefore(new Date(Date.now() - 30 * 86_400_000), 10)).toBe(1);
    expect(db.prepare('SELECT title FROM notifications').pluck().all()).toEqual(['younger']);
  });

  it('bookings created_at, updated_at and synced_at', () => {
    const repo = new BookingRepository(db);
    const booking = repo.create(userId, mockBookingInput);
    readsAsStored(
      booking.createdAt,
      raw('SELECT created_at FROM bookings WHERE id = ?', booking.id)
    );
    readsAsStored(
      booking.updatedAt,
      raw('SELECT updated_at FROM bookings WHERE id = ?', booking.id)
    );
    const synced = repo.markSynced(booking.id);
    readsAsStored(synced?.syncedAt, raw('SELECT synced_at FROM bookings WHERE id = ?', booking.id));
  });

  it('watches and snipes created_at and updated_at', () => {
    const watch = new WatchRepository(db).create(userId, createMockWatchInput());
    readsAsStored(watch.createdAt, raw('SELECT created_at FROM watches WHERE id = ?', watch.id));
    readsAsStored(watch.updatedAt, raw('SELECT updated_at FROM watches WHERE id = ?', watch.id));

    const snipe = new SiteSniperRepository(db).create(userId, createMockSiteSnipeInput());
    readsAsStored(
      snipe.createdAt,
      raw('SELECT created_at FROM site_snipes WHERE id = ?', snipe.id)
    );
    readsAsStored(
      snipe.updatedAt,
      raw('SELECT updated_at FROM site_snipes WHERE id = ?', snipe.id)
    );
  });

  it('the local profile, settings and provider accounts', () => {
    const user = new UserRepository(db).findById(userId);
    readsAsStored(user?.createdAt, raw('SELECT created_at FROM users WHERE id = 1'));
    readsAsStored(user?.updatedAt, raw('SELECT updated_at FROM users WHERE id = 1'));

    const setting = new SettingsRepository(db).set(
      'u5.probe',
      true,
      SettingValueType.BOOLEAN,
      SettingCategory.GENERAL
    );
    readsAsStored(setting.updatedAt, raw("SELECT updated_at FROM settings WHERE key = 'u5.probe'"));

    db.prepare(
      "INSERT INTO provider_accounts (provider_id, status) VALUES ('parkstay', 'signed-out')"
    ).run();
    const account = new ProviderAccountRepository(db).get('parkstay');
    readsAsStored(
      account?.createdAt,
      raw("SELECT created_at FROM provider_accounts WHERE provider_id = 'parkstay'")
    );
  });

  it('notifiers created_at, updated_at and last_tested_at, and delivery logs', () => {
    const repo = new NotifierRepository(db, t.vault);
    const notifier = repo.upsert({
      channel: NotifierChannel.EMAIL_SMTP,
      displayName: 'Email',
      enabled: true,
      config: {
        preset: SMTPPreset.GMAIL,
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: { user: 'me@example.com', pass: 'app-password' },
      },
    });
    readsAsStored(
      notifier.createdAt,
      raw('SELECT created_at FROM notifiers WHERE id = ?', notifier.id)
    );
    readsAsStored(
      notifier.updatedAt,
      raw('SELECT updated_at FROM notifiers WHERE id = ?', notifier.id)
    );
    repo.updateLastTested(NotifierChannel.EMAIL_SMTP, true);
    readsAsStored(
      repo.findByChannel(NotifierChannel.EMAIL_SMTP)?.lastTestedAt,
      raw('SELECT last_tested_at FROM notifiers WHERE id = ?', notifier.id)
    );

    const log = repo.logDelivery({ notifierChannel: NotifierChannel.EMAIL_SMTP, status: 'sent' });
    readsAsStored(
      log.createdAt,
      raw('SELECT created_at FROM notification_delivery_logs WHERE id = ?', log.id)
    );
  });
});
