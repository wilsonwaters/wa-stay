/**
 * Data retention (P7): `RetentionJob` on a real database deletes notifications and delivery
 * logs older than their periods, whatever the `created_at` text format, in bounded batches,
 * and stops between batches; `JobScheduler` runs it 5 minutes after `start()` and then daily
 * at 02:00 Perth time, re-arms it after a resume and waits for it on `stop()`.
 */

import type Database from 'better-sqlite3';
import { openDatabase } from '@main/database/connection';
import {
  NotificationRepository,
  NotifierRepository,
  SettingsRepository,
} from '@main/database/repositories';
import { JobScheduler, SCHEDULER_STOP_GRACE_MS } from '@main/scheduler/job-scheduler';
import {
  nextDailyRetentionRun,
  RETENTION_BATCH_SIZE,
  RETENTION_FIRST_RUN_DELAY_MS,
  RetentionJob,
  type RetentionJobDeps,
} from '@main/scheduler/retention-job';
import { logger } from '@main/utils/logger';
import { SETTING_KEYS } from '@shared/contracts/settings';
import { SettingCategory, SettingValueType } from '@shared/types';
import { createCoreHarness, type CoreHarness } from '@tests/utils/core-harness';
import { testVault } from '@tests/utils/fake-safe-storage';

const DAY = 86_400_000;
/** 10:00 in Perth (02:00 UTC). */
const NOW = new Date('2026-10-10T02:00:00.000Z');

/** `at` as SQLite's `CURRENT_TIMESTAMP` writes it: `YYYY-MM-DD HH:MM:SS`, UTC. */
const sqliteText = (at: Date) => at.toISOString().slice(0, 19).replace('T', ' ');
/** `at` as JavaScript writes it: `…T…Z`. */
const isoText = (at: Date) => at.toISOString();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

type Stores = Pick<RetentionJobDeps, 'notifications' | 'notifiers'> & {
  settings: SettingsRepository;
};

function storesOf(db: Database.Database): Stores {
  return {
    notifications: new NotificationRepository(db),
    notifiers: new NotifierRepository(db, testVault().vault),
    settings: new SettingsRepository(db),
  };
}

describe('RetentionJob on a real database', () => {
  let db: Database.Database;
  let stores: Stores;

  /** A notification created at `createdAt` (stored as given); returns its id. */
  const notification = (createdAt: string, title: string, read = false): number =>
    Number(
      db
        .prepare(
          `INSERT INTO notifications (user_id, type, title, message, is_read, created_at)
           VALUES (1, 'info', ?, 'm', ?, ?)`
        )
        .run(title, read ? 1 : 0, createdAt).lastInsertRowid
    );
  /** A delivery log created at `createdAt`, for `notificationId` (or none); returns its id. */
  const deliveryLog = (createdAt: string, notificationId: number | null): number =>
    Number(
      db
        .prepare(
          `INSERT INTO notification_delivery_logs (notification_id, notifier_channel, status, created_at)
           VALUES (?, 'email_smtp', 'sent', ?)`
        )
        .run(notificationId, createdAt).lastInsertRowid
    );
  const titles = () =>
    (db.prepare('SELECT title FROM notifications ORDER BY id').pluck().all() as string[]).sort();
  const logIds = () =>
    db.prepare('SELECT id FROM notification_delivery_logs ORDER BY id').pluck().all() as number[];
  const job = (deps: Partial<RetentionJobDeps> = {}) =>
    new RetentionJob({ ...stores, clock: () => NOW, ...deps });

  beforeEach(() => {
    db = openDatabase(':memory:');
    stores = storesOf(db);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    db.close();
  });

  it('deletes notifications older than 30 days, read or not, in either timestamp format', async () => {
    notification(sqliteText(daysAgo(31)), 'old, sqlite text');
    notification(isoText(daysAgo(31)), 'old, iso', true);
    notification(sqliteText(daysAgo(29)), 'young, sqlite text');
    notification(isoText(daysAgo(29)), 'young, iso', true);
    // Just past the cutoff in the other format: an hour either side of 30 days
    notification(sqliteText(new Date(daysAgo(30).getTime() - 3_600_000)), 'just old');
    notification(isoText(new Date(daysAgo(30).getTime() + 3_600_000)), 'just young');
    // A value SQLite cannot read is kept, never guessed at
    notification('not a date', 'unreadable');

    const result = await job().run();

    expect(result).toEqual({ notifications: 3, deliveryLogs: 0, complete: true });
    expect(titles()).toEqual(
      ['young, sqlite text', 'young, iso', 'just young', 'unreadable'].sort()
    );
  });

  it("deletes delivery logs older than 30 days; an old notification's logs go with it", async () => {
    const oldNotification = notification(sqliteText(daysAgo(31)), 'old');
    const youngNotification = notification(isoText(daysAgo(29)), 'young');
    // Cascade: young logs of an old notification go with it
    deliveryLog(isoText(daysAgo(29)), oldNotification);
    // Their own age: old logs go, young ones stay, linked or not, in either format
    deliveryLog(sqliteText(daysAgo(31)), null);
    deliveryLog(isoText(daysAgo(31)), null);
    const keptOrphan = deliveryLog(sqliteText(daysAgo(29)), null);
    const keptIso = deliveryLog(isoText(daysAgo(29)), null);
    const keptLinked = deliveryLog(sqliteText(daysAgo(29)), youngNotification);

    const result = await job().run();

    expect(result).toEqual({ notifications: 1, deliveryLogs: 2, complete: true });
    expect(titles()).toEqual(['young']);
    expect(logIds()).toEqual([keptOrphan, keptIso, keptLinked]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('deletes at most one batch per statement and yields between batches', async () => {
    for (let i = 0; i < 5; i++) notification(isoText(daysAgo(40 + i)), `old ${i}`);
    notification(isoText(daysAgo(1)), 'young');
    const deleteCreatedBefore = jest.spyOn(stores.notifications, 'deleteCreatedBefore');
    const immediate = jest.spyOn(global, 'setImmediate');

    const result = await job({ batchSize: 2 }).run();

    expect(result.notifications).toBe(5);
    expect(deleteCreatedBefore.mock.calls.map(([, limit]) => limit)).toEqual([2, 2, 2]);
    expect(deleteCreatedBefore.mock.results.map((r) => r.value)).toEqual([2, 2, 1]);
    // A yield after each full batch
    expect(immediate).toHaveBeenCalledTimes(2);
    expect(titles()).toEqual(['young']);
    expect(RETENTION_BATCH_SIZE).toBeLessThanOrEqual(1000);
  });

  it('stop() aborts a run between batches: it settles at once and deletes no more', async () => {
    for (let i = 0; i < 6; i++) notification(isoText(daysAgo(40 + i)), `old ${i}`);
    const retention = job({ batchSize: 2 });

    const running = retention.run();
    // The first batch ran synchronously; the run now waits for its yield
    expect(titles()).toHaveLength(4);
    const pending = retention.stop();
    expect(pending).toEqual([running]);

    await expect(running).resolves.toEqual({
      notifications: 2,
      deliveryLogs: 0,
      complete: false,
    });
    expect(titles()).toHaveLength(4);
  });

  it('joins the run in flight instead of starting a second one', async () => {
    notification(isoText(daysAgo(40)), 'old');
    const retention = job();
    const first = retention.run();
    expect(retention.run()).toBe(first);
    await first;
    expect(retention.run()).not.toBe(first);
  });

  it('reads its periods from the main-owned settings keys, and ignores an invalid one', async () => {
    const set = (key: keyof typeof SETTING_KEYS, value: unknown) =>
      stores.settings.set(key, value, SettingValueType.NUMBER, SettingCategory.NOTIFICATIONS);
    expect(SETTING_KEYS['retention.notificationDays']).toMatchObject({
      default: 30,
      rendererWritable: false,
    });
    expect(SETTING_KEYS['retention.deliveryLogDays']).toMatchObject({
      default: 30,
      rendererWritable: false,
    });
    notification(isoText(daysAgo(8)), '8 days');
    notification(isoText(daysAgo(6)), '6 days');
    deliveryLog(isoText(daysAgo(3)), null);
    const keptLog = deliveryLog(isoText(daysAgo(1)), null);
    set('retention.notificationDays', 7);
    set('retention.deliveryLogDays', 2);

    await expect(job().run()).resolves.toEqual({
      notifications: 1,
      deliveryLogs: 1,
      complete: true,
    });
    expect(titles()).toEqual(['6 days']);
    expect(logIds()).toEqual([keptLog]);

    // Zero would delete everything: an invalid period falls back to 30 days, with a warning
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    set('retention.notificationDays', 0);
    notification(isoText(daysAgo(40)), '40 days');
    await job().run();
    expect(titles()).toEqual(['6 days']);
    expect(warn).toHaveBeenCalledWith(
      'Retention: retention.notificationDays is not a whole number of days from 1 to 3650; using 30'
    );
    warn.mockRestore();
  });

  it('a busy database is logged and never thrown; the run reports it incomplete', async () => {
    const busy = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    jest.spyOn(stores.notifications, 'deleteCreatedBefore').mockImplementation(() => {
      throw busy;
    });
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => logger);

    await expect(job().run()).resolves.toEqual({
      notifications: 0,
      deliveryLogs: 0,
      complete: false,
    });
    expect(warn).toHaveBeenCalledWith('Retention run failed; the next run tries again:', busy);
    warn.mockRestore();
  });
});

describe('RetentionJob restarted while a run is in flight', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('stop() then start() during a run: the old run never re-arms, the start-up run stands', async () => {
    jest.useFakeTimers({ now: NOW });
    // Always a full batch: a run ends only when it is stopped
    const deleteCreatedBefore = jest.fn(() => RETENTION_BATCH_SIZE);
    const retention = new RetentionJob({
      notifications: { deleteCreatedBefore },
      notifiers: { deleteDeliveryLogsCreatedBefore: jest.fn(() => 0) },
      settings: { getValue: jest.fn(() => null) },
    });
    const runs = jest.spyOn(retention, 'run');
    retention.start();
    await jest.advanceTimersByTimeAsync(RETENTION_FIRST_RUN_DELAY_MS);
    expect(runs).toHaveBeenCalledTimes(1);

    // Restarted while the first run waits for its yield
    const pending = retention.stop();
    retention.start();
    const restartedAt = Date.now();
    // The aborted run settles
    await jest.advanceTimersByTimeAsync(1);
    await Promise.all(pending);

    expect(retention.nextRun).toEqual(new Date(restartedAt + RETENTION_FIRST_RUN_DELAY_MS));
    await jest.advanceTimersByTimeAsync(restartedAt + RETENTION_FIRST_RUN_DELAY_MS - Date.now());
    expect(runs).toHaveBeenCalledTimes(2);

    const last = retention.stop();
    await jest.advanceTimersByTimeAsync(1);
    await Promise.all(last);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('nextDailyRetentionRun', () => {
  it('is the next 02:00 in Perth (18:00 UTC), strictly after now', () => {
    expect(nextDailyRetentionRun(new Date('2026-10-10T02:00:00Z'))).toEqual(
      new Date('2026-10-10T18:00:00Z')
    );
    // 01:59 in Perth: today's 02:00 is still ahead
    expect(nextDailyRetentionRun(new Date('2026-10-10T17:59:00Z'))).toEqual(
      new Date('2026-10-10T18:00:00Z')
    );
    // Exactly 02:00 in Perth: tomorrow's
    expect(nextDailyRetentionRun(new Date('2026-10-10T18:00:00Z'))).toEqual(
      new Date('2026-10-11T18:00:00Z')
    );
  });
});

describe('JobScheduler runs the retention job', () => {
  let h: CoreHarness;
  let scheduler: JobScheduler;
  let runs: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    h = createCoreHarness();
    scheduler = new JobScheduler({
      watches: h.watches,
      snipes: h.snipes,
      providers: h.registry,
      power: h.power,
      retention: storesOf(h.db),
    });
    runs = jest.spyOn(scheduler.retention!, 'run');
  });

  afterEach(async () => {
    const stopping = scheduler.stop();
    await jest.advanceTimersByTimeAsync(SCHEDULER_STOP_GRACE_MS);
    await stopping;
    await h.close();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('once 5 minutes after start(), then daily at 02:00 Australia/Perth', async () => {
    scheduler.start();
    await jest.advanceTimersByTimeAsync(RETENTION_FIRST_RUN_DELAY_MS - 1);
    expect(runs).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(runs).toHaveBeenCalledTimes(1);

    // 02:00 in Perth is 18:00 UTC
    expect(scheduler.retention!.nextRun).toEqual(new Date('2026-10-10T18:00:00Z'));
    await jest.advanceTimersByTimeAsync(
      new Date('2026-10-10T18:00:00Z').getTime() - Date.now() - 1
    );
    expect(runs).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(runs).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(DAY);
    expect(runs).toHaveBeenCalledTimes(3);
    expect(scheduler.retention!.nextRun).toEqual(new Date('2026-10-12T18:00:00Z'));
  });

  it('started at 01:58 in Perth: the start-up run at 02:03, then 02:00 the next day', async () => {
    jest.setSystemTime(new Date('2026-10-10T17:58:00Z'));
    scheduler.start();
    await jest.advanceTimersByTimeAsync(RETENTION_FIRST_RUN_DELAY_MS);
    expect(runs).toHaveBeenCalledTimes(1);
    expect(Date.now()).toBe(new Date('2026-10-10T18:03:00Z').getTime());
    expect(scheduler.retention!.nextRun).toEqual(new Date('2026-10-11T18:00:00Z'));
  });

  it('a run that fails (a busy database) is tried again at the next 02:00', async () => {
    const notifications = scheduler.retention!['deps'].notifications as NotificationRepository;
    const busy = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    const deletes = jest.spyOn(notifications, 'deleteCreatedBefore').mockImplementationOnce(() => {
      throw busy;
    });
    jest.spyOn(logger, 'warn').mockImplementation(() => logger);
    scheduler.start();
    await jest.advanceTimersByTimeAsync(RETENTION_FIRST_RUN_DELAY_MS);
    await expect(runs.mock.results[0].value).resolves.toMatchObject({ complete: false });

    await jest.advanceTimersByTimeAsync(new Date('2026-10-10T18:00:00Z').getTime() - Date.now());
    expect(runs).toHaveBeenCalledTimes(2);
    await expect(runs.mock.results[1].value).resolves.toMatchObject({ complete: true });
    expect(deletes).toHaveBeenCalledTimes(2);
  });

  it('runCleanup() runs it now, outside the schedule', async () => {
    h.db
      .prepare(
        `INSERT INTO notifications (user_id, type, title, message, created_at)
         VALUES (1, 'info', 'old', 'm', ?)`
      )
      .run(sqliteText(daysAgo(31)));
    await expect(scheduler.runCleanup()).resolves.toEqual({
      notifications: 1,
      deliveryLogs: 0,
      complete: true,
    });
  });

  it('after a sleep past 02:00, a resume runs the overdue cleanup at once', async () => {
    scheduler.start();
    await jest.advanceTimersByTimeAsync(RETENTION_FIRST_RUN_DELAY_MS);
    expect(runs).toHaveBeenCalledTimes(1);

    // Asleep from 10:05 to 04:00 the next day: the wall clock jumps, the timer does not
    jest.setSystemTime(new Date('2026-10-10T20:00:00Z'));
    h.power.emit('resume');
    await jest.advanceTimersByTimeAsync(0);
    expect(runs).toHaveBeenCalledTimes(2);
    expect(scheduler.retention!.nextRun).toEqual(new Date('2026-10-11T18:00:00Z'));
  });

  it('stop() clears the timer, aborts a run in flight and waits for it', async () => {
    const notifications = scheduler.retention!['deps'].notifications as NotificationRepository;
    // Always a full batch: the run never ends by itself
    const deletes = jest
      .spyOn(notifications, 'deleteCreatedBefore')
      .mockReturnValue(RETENTION_BATCH_SIZE);
    scheduler.start();
    await jest.advanceTimersByTimeAsync(RETENTION_FIRST_RUN_DELAY_MS);
    expect(runs).toHaveBeenCalledTimes(1);
    // The first batch is done; the run waits for its yield
    expect(deletes).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    // The yield comes round: the run sees the abort and settles, and the stop with it, long
    // before the stop's bound
    await jest.advanceTimersByTimeAsync(1);
    expect(stopped).toBe(true);
    await stopping;
    await expect(runs.mock.results[0].value).resolves.toEqual({
      notifications: RETENTION_BATCH_SIZE,
      deliveryLogs: 0,
      complete: false,
    });

    await jest.advanceTimersByTimeAsync(2 * DAY);
    expect(deletes).toHaveBeenCalledTimes(1);
    expect(runs).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('a scheduler without retention stores', () => {
  it('has no retention job, and runCleanup() deletes nothing', async () => {
    const h = createCoreHarness();
    try {
      expect(h.scheduler.retention).toBeUndefined();
      await expect(h.scheduler.runCleanup()).resolves.toEqual({
        notifications: 0,
        deliveryLogs: 0,
        complete: true,
      });
    } finally {
      await h.close();
    }
  });
});
