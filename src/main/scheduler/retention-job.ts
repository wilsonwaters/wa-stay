/**
 * Data retention (tech-review "Dead/duplicate code": the old cleanup cron deleted nothing):
 * notifications and notifier delivery logs older than their retention periods are deleted,
 * so neither table grows without bound.
 *
 * - **When.** Once `RETENTION_FIRST_RUN_DELAY_MS` (5 min) after `start()`, because the computer
 *   may be off at night, then every day at 02:00 Perth time. Chained `setTimeout`s. `rearm()`
 *   (after a resume) recomputes the wait from the wall clock: a run that fell due while the
 *   computer slept runs at once.
 * - **Periods.** The main-owned settings `retention.notificationDays` and
 *   `retention.deliveryLogDays` (`SETTING_KEYS`, 30 days unless set). A stored value that is not
 *   a whole number of days from 1 to 3650 is ignored for the default, with a warning.
 * - **What.** Rows whose `created_at` is older than the period, compared as instants
 *   (`julianday`), so `CURRENT_TIMESTAMP` text (`YYYY-MM-DD HH:MM:SS`, UTC) and ISO strings
 *   (`…T…Z`) both count. Unread notifications go too: by then their hold and payment links
 *   have long expired. A notification's delivery logs go with it (ON DELETE CASCADE).
 * - **How.** At most `RETENTION_BATCH_SIZE` rows per statement, yielding to the event loop
 *   between batches, so a large backlog never blocks the main process or holds the database
 *   for long.
 * - **Stop.** `stop()` clears the timer and aborts a run in flight between batches; the
 *   scheduler waits for that run before the database closes. A generation counter keeps a run
 *   from before a `stop()` from re-arming after a later `start()`.
 * - **Errors** (a busy database): logged, and the next run tries again. Nothing is thrown into
 *   a timer.
 */

import { SETTING_KEYS, settingDefault } from '@shared/contracts/settings';
import { addDays, todayIn, zonedInstant } from '@shared/utils/calendar-date';
import type {
  NotificationRepository,
  NotifierRepository,
  SettingsRepository,
} from '../database/repositories';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'retention' });

/** The first run, after the app starts. */
export const RETENTION_FIRST_RUN_DELAY_MS = 5 * 60_000;
/** Then daily at this hour (02:00) in `RETENTION_TIME_ZONE`. */
export const RETENTION_HOUR = 2;
export const RETENTION_TIME_ZONE = 'Australia/Perth';
/** The most rows one delete statement removes. */
export const RETENTION_BATCH_SIZE = 500;

const DAY_MS = 24 * 60 * 60 * 1000;

type RetentionSettingKey = 'retention.notificationDays' | 'retention.deliveryLogDays';

export interface RetentionJobDeps {
  notifications: Pick<NotificationRepository, 'deleteCreatedBefore'>;
  notifiers: Pick<NotifierRepository, 'deleteDeliveryLogsCreatedBefore'>;
  settings: Pick<SettingsRepository, 'getValue'>;
  clock?: () => Date;
  batchSize?: number;
}

export interface RetentionResult {
  /** Notifications deleted (their delivery logs went with them). */
  notifications: number;
  /** Delivery logs deleted on their own age. */
  deliveryLogs: number;
  /** False when the run was stopped or failed part-way. */
  complete: boolean;
}

/** The next 02:00 Perth time strictly after `now`. */
export function nextDailyRetentionRun(now: Date): Date {
  const time = { hour: RETENTION_HOUR, minute: 0 };
  const today = todayIn(RETENTION_TIME_ZONE, now);
  const atToday = zonedInstant(today, time, RETENTION_TIME_ZONE);
  return atToday.getTime() > now.getTime()
    ? atToday
    : zonedInstant(addDays(today, 1), time, RETENTION_TIME_ZONE);
}

/** Lets timers, I/O and IPC run between two batches. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export class RetentionJob {
  private readonly deps: RetentionJobDeps;
  private readonly clock: () => Date;
  private readonly batchSize: number;
  private timer?: ReturnType<typeof setTimeout>;
  private nextRunAt?: Date;
  private running = false;
  /** Bumped by `start()` and `stop()`: a run fired before a restart must not re-arm. */
  private generation = 0;
  private inFlight?: { promise: Promise<RetentionResult>; controller: AbortController };

  constructor(deps: RetentionJobDeps) {
    this.deps = deps;
    this.clock = deps.clock ?? (() => new Date());
    this.batchSize = deps.batchSize ?? RETENTION_BATCH_SIZE;
  }

  /** Arms the first run, `RETENTION_FIRST_RUN_DELAY_MS` from now. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation++;
    this.arm(new Date(this.clock().getTime() + RETENTION_FIRST_RUN_DELAY_MS));
  }

  /** Re-arms the timer from the wall clock (after a resume); an overdue run starts now. */
  rearm(): void {
    if (!this.running || this.timer === undefined || !this.nextRunAt) return;
    this.arm(this.nextRunAt);
  }

  /** Runs now, or joins the run in flight. Never rejects. */
  run(): Promise<RetentionResult> {
    if (this.inFlight) return this.inFlight.promise;
    const controller = new AbortController();
    const promise = this.execute(controller.signal).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = undefined;
    });
    this.inFlight = { promise, controller };
    return promise;
  }

  /** Clears the timer and aborts the run in flight; returns it, to be awaited. */
  stop(): Promise<unknown>[] {
    this.running = false;
    this.generation++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.nextRunAt = undefined;
    if (!this.inFlight) return [];
    this.inFlight.controller.abort();
    return [this.inFlight.promise];
  }

  /** When the next scheduled run is due (for diagnostics and tests). */
  get nextRun(): Date | undefined {
    return this.nextRunAt;
  }

  private arm(at: Date): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.nextRunAt = at;
    const delay = Math.max(0, at.getTime() - this.clock().getTime());
    this.timer = setTimeout(() => this.fire(), delay);
  }

  private fire(): void {
    this.timer = undefined;
    const generation = this.generation;
    void this.run().then(() => {
      // Stopped, or stopped and started again (that start armed its own run): nothing to arm
      if (this.running && generation === this.generation) {
        this.arm(nextDailyRetentionRun(this.clock()));
      }
    });
  }

  private async execute(signal: AbortSignal): Promise<RetentionResult> {
    const now = this.clock().getTime();
    const notificationDays = this.period('retention.notificationDays');
    const deliveryLogDays = this.period('retention.deliveryLogDays');
    const notificationCutoff = new Date(now - notificationDays * DAY_MS);
    const deliveryLogCutoff = new Date(now - deliveryLogDays * DAY_MS);
    const result: RetentionResult = { notifications: 0, deliveryLogs: 0, complete: false };

    try {
      await this.inBatches(signal, (limit) => {
        const deleted = this.deps.notifications.deleteCreatedBefore(notificationCutoff, limit);
        result.notifications += deleted;
        return deleted;
      });
      await this.inBatches(signal, (limit) => {
        const deleted = this.deps.notifiers.deleteDeliveryLogsCreatedBefore(
          deliveryLogCutoff,
          limit
        );
        result.deliveryLogs += deleted;
        return deleted;
      });
      result.complete = !signal.aborted;
    } catch (error) {
      log.warn('Retention run failed; the next run tries again:', error);
    }

    log.info(
      `Retention: deleted ${result.notifications} notification(s) older than ${notificationDays} days ` +
        `and ${result.deliveryLogs} delivery log(s) older than ${deliveryLogDays} days` +
        (result.complete ? '' : ' (stopped before the end)')
    );
    return result;
  }

  /** Calls `deleteBatch` until it deletes less than a full batch, or the run is stopped. */
  private async inBatches(
    signal: AbortSignal,
    deleteBatch: (limit: number) => number
  ): Promise<void> {
    while (!signal.aborted) {
      if (deleteBatch(this.batchSize) < this.batchSize) return;
      await yieldToEventLoop();
    }
  }

  /** The stored retention period, or its default when none (or no valid one) is stored. */
  private period(key: RetentionSettingKey): number {
    const fallback = settingDefault(key);
    let stored: unknown;
    try {
      stored = this.deps.settings.getValue<unknown>(key);
    } catch (error) {
      log.warn(`Retention: ${key} could not be read; using ${fallback} days:`, error);
      return fallback;
    }
    if (stored === null || stored === undefined) return fallback;
    const parsed = SETTING_KEYS[key].schema.safeParse(stored);
    if (parsed.success) return parsed.data;
    log.warn(`Retention: ${key} is not a whole number of days from 1 to 3650; using ${fallback}`);
    return fallback;
  }
}
