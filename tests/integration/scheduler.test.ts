/**
 * The scheduler end to end (tech-review #2, #11): Jest's modern fake timers, FakeProvider
 * and a real in-memory database (the V2 repositories), through the real core services.
 *
 * Covers: no overlapping snipe checks and a single hold, abort on unschedule, the generation
 * token, access-gate ref counting, the long-timer re-arm, past releases and windows, hold
 * expiry, resume after sleep (snipes re-armed or expired, watches expired), the watch due-loop
 * spacing, the per-provider cap, the startup stagger, legacy intervals, run-now joins,
 * restart after a stop mid-hold, unknown providers, and `*:updated` events.
 *
 * Sleep is simulated with `jest.setSystemTime` alone: fake timers keep their remaining delay,
 * as a monotonic clock does while a computer sleeps, until `powerMonitor` says it resumed.
 */

import { SnipeReleaseMode, SnipeStatus, WatchResult } from '@shared/types/common.types';
import { createCoreHarness, settle, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider, type FakeProvider } from '@tests/utils/fake-provider';
import { MAX_TIMER_MS } from '@main/scheduler/snipe-runner';

// 4 Oct 2026, 10:00 in Perth
const NOW = new Date('2026-10-04T02:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('JobScheduler (fake timers, FakeProvider, real database)', () => {
  let h: CoreHarness;

  afterEach(async () => {
    const closing = h.close();
    await jest.advanceTimersByTimeAsync(10 * SECOND);
    await closing;
    jest.useRealTimers();
  });

  function setUp(provider: FakeProvider = createFakeProvider(), random = 0): void {
    jest.useFakeTimers({ now: NOW });
    h = createCoreHarness({ providers: [provider], random: () => random });
  }

  const checks = () => h.fake.calls.filter((c) => c.module === 'availability');
  const holds = () => h.fake.calls.filter((c) => c.module === 'holds');
  const status = (id: number) => h.snipeRepo.findById(id)?.status;

  /** A scheduled snipe on `fake` location `externalId`, released at `releaseAt`. */
  async function scheduledSnipe(
    releaseAt: Date,
    extra: Partial<Parameters<CoreHarness['snipeInput']>[0]> = {}
  ) {
    return settle(
      h.snipes.create(
        h.userId,
        h.snipeInput({
          releaseMode: SnipeReleaseMode.SCHEDULED,
          releaseAt,
          leadTimeSeconds: 0,
          pollIntervalMs: 1500,
          windowDurationMs: 20 * SECOND,
          ...extra,
        })
      )
    );
  }

  describe('snipes', () => {
    it('never overlaps snipe checks: a 5 s check with a 1.5 s poll over a 20 s window', async () => {
      setUp(
        createFakeProvider({
          delays: { availability: 5 * SECOND },
          availability: { '1': { u1: 'booked' } },
        })
      );
      const snipe = await scheduledSnipe(NOW);
      h.scheduler.snipeRunner.arm(snipe.id);

      await jest.advanceTimersByTimeAsync(20 * SECOND + 1);

      expect(h.fake.peakInFlight('availability')).toBe(1);
      // Checks start 0, 6.5, 13 and 19.5 s: each 1.5 s after the last one ended
      expect(checks()).toHaveLength(4);
      // The window closed during the last check: it expires when that check settles
      await jest.advanceTimersByTimeAsync(5 * SECOND);
      expect(checks()).toHaveLength(4);
      expect(h.fake.peakInFlight('availability')).toBe(1);
      expect(status(snipe.id)).toBe(SnipeStatus.EXPIRED);
      expect(h.scheduler.snipeRunner.isScheduled(snipe.id)).toBe(false);
    });

    it('places at most one hold after the first success', async () => {
      setUp(
        createFakeProvider({
          delays: { availability: 5 * SECOND },
          availability: { '1': { u1: 'booked' } },
        })
      );
      const snipe = await scheduledSnipe(NOW);
      h.scheduler.snipeRunner.arm(snipe.id);
      await jest.advanceTimersByTimeAsync(8 * SECOND);
      h.fake.setAvailability('1', { u1: 'available' });

      await jest.advanceTimersByTimeAsync(30 * SECOND);

      expect(holds()).toHaveLength(1);
      expect(status(snipe.id)).toBe(SnipeStatus.HELD);
      expect(h.fake.peakInFlight('availability')).toBe(1);
    });

    it('unschedule aborts the in-flight check and leaves no timers', async () => {
      setUp(createFakeProvider({ delays: { availability: 5 * SECOND } }));
      const snipe = await scheduledSnipe(NOW);
      h.scheduler.snipeRunner.arm(snipe.id);
      await jest.advanceTimersByTimeAsync(SECOND);
      const [inFlight] = checks();
      expect(inFlight.signal?.aborted).toBe(false);

      h.scheduler.unscheduleSnipe(snipe.id);
      await jest.advanceTimersByTimeAsync(0);

      expect(inFlight.signal?.aborted).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
      expect(holds()).toHaveLength(0);
      // Nothing was written by the aborted attempt
      expect(h.snipeRepo.findById(snipe.id)?.attemptsCount).toBe(0);
    });

    it('rescheduling during the warm-up await leaves exactly one live timer chain', async () => {
      setUp(
        createFakeProvider({
          delays: { access: 5 * SECOND },
          availability: { '1': { u1: 'booked' } },
        })
      );
      const snipe = await scheduledSnipe(new Date(NOW.getTime() + MINUTE), {
        accessGateEnabled: true,
        leadTimeSeconds: 120,
        windowDurationMs: 15 * MINUTE,
      });
      h.scheduler.snipeRunner.arm(snipe.id);
      await jest.advanceTimersByTimeAsync(SECOND);
      expect(status(snipe.id)).toBe(SnipeStatus.QUEUEING);

      // Re-armed while the warm-up waits in the queue
      h.scheduler.rescheduleSnipe(snipe.id); // not running: a no-op…
      h.scheduler.snipeRunner.arm(snipe.id); // …the runner re-arms it
      await jest.advanceTimersByTimeAsync(MINUTE);

      expect(h.fake.holdCount).toBe(1);
      expect(status(snipe.id)).toBe(SnipeStatus.SNIPING);
      // Polls continue at one per 1.5 s: one chain, one pending timer between polls
      const before = checks().length;
      await jest.advanceTimersByTimeAsync(15 * SECOND);
      expect(checks().length - before).toBe(10);
      expect(jest.getTimerCount()).toBe(1);
    });

    it('two gated snipes share the gate: the first to finish drops the ref count 2 → 1, the second keeps it open', async () => {
      setUp(createFakeProvider({ availability: { '1': { u1: 'booked' }, '2': { u1: 'booked' } } }));
      const release = new Date(NOW.getTime() + MINUTE);
      const options = {
        accessGateEnabled: true,
        leadTimeSeconds: 120,
        windowDurationMs: 15 * MINUTE,
      };
      const first = await scheduledSnipe(release, options);
      const second = await scheduledSnipe(release, {
        ...options,
        location: { externalId: '2', name: 'Karri Grove' },
      });
      h.scheduler.snipeRunner.arm(first.id);
      h.scheduler.snipeRunner.arm(second.id);
      await jest.advanceTimersByTimeAsync(2 * MINUTE);
      expect(h.fake.holdCount).toBe(2);

      // The first gets its site
      h.fake.setAvailability('1', { u1: 'available' });
      await jest.advanceTimersByTimeAsync(5 * SECOND);

      expect(status(first.id)).toBe(SnipeStatus.HELD);
      expect(h.fake.holdCount).toBe(1);
      expect(h.scheduler.snipeRunner.isScheduled(second.id)).toBe(true);
      expect(status(second.id)).toBe(SnipeStatus.SNIPING);
    });

    it('re-arms a release more than 24.8 days away daily, then warms up on time', async () => {
      setUp();
      const release = new Date(NOW.getTime() + 40 * DAY);
      const snipe = await scheduledSnipe(release, { leadTimeSeconds: 120 });
      h.scheduler.snipeRunner.arm(snipe.id);
      await jest.advanceTimersByTimeAsync(0);

      expect(status(snipe.id)).toBe(SnipeStatus.ARMED);
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(20 * DAY);
      expect(status(snipe.id)).toBe(SnipeStatus.ARMED);

      // 40 days less the 2-minute lead
      await jest.advanceTimersByTimeAsync(20 * DAY - 2 * MINUTE - SECOND);
      expect(status(snipe.id)).toBe(SnipeStatus.ARMED);
      await jest.advanceTimersByTimeAsync(2 * SECOND);
      expect(status(snipe.id)).toBe(SnipeStatus.WAITING_RELEASE);
      expect(MAX_TIMER_MS).toBeLessThan(2 ** 31);
    });

    it('a release already past snipes at once; a window already past expires', async () => {
      setUp(createFakeProvider({ availability: { '1': { u1: 'booked' } } }));
      const recent = await scheduledSnipe(new Date(NOW.getTime() - 5 * SECOND));
      const missed = await scheduledSnipe(new Date(NOW.getTime() - 5 * MINUTE));
      h.scheduler.snipeRunner.arm(recent.id);
      h.scheduler.snipeRunner.arm(missed.id);
      await jest.advanceTimersByTimeAsync(0);

      expect(status(recent.id)).toBe(SnipeStatus.SNIPING);
      expect(checks().length).toBeGreaterThan(0);
      expect(h.snipeRepo.findById(missed.id)).toMatchObject({
        status: SnipeStatus.EXPIRED,
        isActive: false,
      });
    });

    it('a cancellation snipe expires once its arrival date has passed in the provider calendar', async () => {
      setUp(createFakeProvider({ availability: { '1': { u1: 'booked' } } }));
      const snipe = await settle(
        h.snipes.create(
          h.userId,
          h.snipeInput({
            stay: { arrival: '2026-10-04', departure: '2026-10-06', adults: 2 },
            pollIntervalMs: MINUTE,
          })
        )
      );
      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(SECOND);
      expect(status(snipe.id)).toBe(SnipeStatus.SNIPING);

      // Past midnight on 5 Oct in Perth (still 4 Oct in UTC)
      await jest.advanceTimersByTimeAsync(14 * HOUR + MINUTE);
      expect(h.snipeRepo.findById(snipe.id)).toMatchObject({
        status: SnipeStatus.EXPIRED,
        isActive: false,
      });
    });

    it('a HELD snipe whose hold lapses unpaid becomes EXPIRED and stops blocking its nights', async () => {
      setUp();
      const snipe = await settle(h.snipes.create(h.userId, h.snipeInput()));
      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(SECOND);
      expect(status(snipe.id)).toBe(SnipeStatus.HELD);

      await jest.advanceTimersByTimeAsync(30 * MINUTE);
      expect(status(snipe.id)).toBe(SnipeStatus.EXPIRED);
      const free = h.nightGuard.tryReserve({
        providerId: 'fake',
        userId: h.userId,
        arrival: '2026-12-01',
        departure: '2026-12-03',
        owner: { kind: 'snipe', id: 999 },
      });
      expect(free.ok).toBe(true);
    });

    it('run-now joins the snipe attempt in flight', async () => {
      setUp(
        createFakeProvider({
          delays: { availability: 5 * SECOND },
          availability: { '1': { u1: 'booked' } },
        })
      );
      const snipe = await scheduledSnipe(NOW, { windowDurationMs: 15 * MINUTE });
      h.scheduler.snipeRunner.arm(snipe.id);
      await jest.advanceTimersByTimeAsync(SECOND);

      const now = h.scheduler.runSnipeNow(snipe.id);
      await jest.advanceTimersByTimeAsync(5 * SECOND);

      await expect(now).resolves.toMatchObject({ snipeId: snipe.id });
      expect(checks()).toHaveLength(1);
    });

    it('after a stop mid-hold, a restart re-reads the status: a HELD snipe is never held again', async () => {
      setUp(createFakeProvider({ delays: { holds: 5 * SECOND } }));
      const snipe = await settle(h.snipes.create(h.userId, h.snipeInput()));
      const other = await settle(
        h.snipes.create(
          h.userId,
          h.snipeInput({ stay: { arrival: '2026-12-10', departure: '2026-12-12', adults: 2 } })
        )
      );
      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(SECOND);
      expect(holds()).toHaveLength(2);

      // Quit mid-hold: aborted, nothing recorded
      const stopping = h.scheduler.stop();
      await jest.advanceTimersByTimeAsync(0);
      await stopping;
      expect(holds().every((call) => call.signal?.aborted)).toBe(true);
      expect(status(snipe.id)).toBe(SnipeStatus.SNIPING);

      // One of them was held after all (say, before the quit)
      h.snipeRepo.markHeld(snipe.id, 'FAKE-0', new Date(NOW.getTime() + 30 * MINUTE));
      h.fake.calls.length = 0;
      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(6 * SECOND);

      expect(
        holds().map((call) => (call.args[0] as { stay: { arrival: string } }).stay.arrival)
      ).toEqual(['2026-12-10']);
      expect(status(other.id)).toBe(SnipeStatus.HELD);
    });

    it('emits snipe:updated as the snipe moves through its states', async () => {
      setUp();
      const snipe = await settle(h.snipes.create(h.userId, h.snipeInput()));
      h.events.emit.mockClear();
      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(SECOND);

      const statuses = h.events.emit.mock.calls
        .filter(([name]) => name === 'snipe:updated')
        .map(([, payload]) => payload.status);
      expect(statuses).toContain(SnipeStatus.SNIPING);
      expect(statuses[statuses.length - 1]).toBe(SnipeStatus.HELD);
      expect(h.snipeRepo.findById(snipe.id)?.status).toBe(SnipeStatus.HELD);
    });
  });

  describe('resume after sleep', () => {
    it('re-arms snipe timers to the right remaining delay, and expires a snipe whose window passed', async () => {
      setUp(createFakeProvider({ availability: { '1': { u1: 'booked' } } }));
      const later = await scheduledSnipe(new Date(NOW.getTime() + 5 * HOUR), {
        leadTimeSeconds: 120,
        windowDurationMs: 15 * MINUTE,
      });
      const missed = await scheduledSnipe(new Date(NOW.getTime() + HOUR), {
        windowDurationMs: 15 * MINUTE,
      });
      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(0);
      expect(status(later.id)).toBe(SnipeStatus.ARMED);

      // Three hours asleep: the wall clock moves, the timers do not
      jest.setSystemTime(new Date(NOW.getTime() + 3 * HOUR));
      h.power.emit('resume');
      await jest.advanceTimersByTimeAsync(0);

      expect(h.snipeRepo.findById(missed.id)).toMatchObject({
        status: SnipeStatus.EXPIRED,
        isActive: false,
      });
      // The warm-up is due 5 h − 2 min after NOW: 1 h 58 min from the new now
      await jest.advanceTimersByTimeAsync(118 * MINUTE - SECOND);
      expect(status(later.id)).toBe(SnipeStatus.ARMED);
      await jest.advanceTimersByTimeAsync(2 * SECOND);
      expect(status(later.id)).toBe(SnipeStatus.WAITING_RELEASE);
    });

    it('runs overdue watches at once, expiring one whose arrival passed during the sleep', async () => {
      setUp();
      // 23:00 on 4 Oct in Perth
      jest.setSystemTime(new Date('2026-10-04T15:00:00.000Z'));
      const tonight = await h.watches.create(
        h.userId,
        h.watchInput({ stay: { arrival: '2026-10-04', departure: '2026-10-06', adults: 1 } })
      );
      const soon = await h.watches.create(h.userId, h.watchInput({ notifyOnly: false }));
      h.fake.setAvailability('1', { u1: 'booked' });
      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(SECOND);
      const before = checks().length;

      // Asleep past midnight in Perth
      jest.setSystemTime(new Date('2026-10-04T18:00:00.000Z'));
      h.power.emit('unlock-screen');
      await jest.advanceTimersByTimeAsync(SECOND);

      expect(h.watchRepo.findById(tonight.id)?.isActive).toBe(false);
      expect(checks().length).toBe(before + 1); // the other watch ran, the expired one did not
      expect(h.watchRepo.findById(soon.id)?.lastCheckedAt).toEqual(
        new Date('2026-10-04T18:00:00.000Z')
      );
    });
  });

  describe('watches', () => {
    it('runs a 15-minute watch 8±1 times in 2 hours (cron ran it twice) and persists next_check_at after each run', async () => {
      setUp(createFakeProvider({ availability: { '1': { u1: 'booked' } } }), 0.5);
      const watch = await h.watches.create(h.userId, h.watchInput({ checkIntervalMinutes: 15 }));
      const recordRun = jest.spyOn(h.watchRepo, 'recordRun');
      h.scheduler.start();

      await jest.advanceTimersByTimeAsync(2 * HOUR);

      expect(checks().length).toBeGreaterThanOrEqual(7);
      expect(checks().length).toBeLessThanOrEqual(9);
      expect(recordRun).toHaveBeenCalledTimes(checks().length);
      for (const [, run] of recordRun.mock.calls) {
        // 15 minutes plus 5 % jitter after each check
        expect(run.nextCheckAt.getTime() - run.checkedAt.getTime()).toBe(15.75 * MINUTE);
      }
      const last = recordRun.mock.calls[recordRun.mock.calls.length - 1][1];
      expect(h.watchRepo.findById(watch.id)?.nextCheckAt).toEqual(last.nextCheckAt);
    });

    it('a legacy 5-minute watch runs every 15 minutes and keeps its stored value', async () => {
      setUp(createFakeProvider({ availability: { '1': { u1: 'booked' } } }));
      const watch = await h.watches.create(h.userId, h.watchInput());
      h.db.prepare('UPDATE watches SET check_interval_minutes = 5 WHERE id = ?').run(watch.id);
      h.scheduler.start();

      await jest.advanceTimersByTimeAsync(HOUR - SECOND);

      expect(checks()).toHaveLength(4); // 0, 15, 30, 45 min
      expect(h.watchRepo.findById(watch.id)?.checkIntervalMinutes).toBe(5);
    });

    it('spreads watches that fell due while the app was closed over the first two minutes', async () => {
      setUp(createFakeProvider({ availability: { '1': { u1: 'booked' } } }));
      const created = [];
      for (let i = 0; i < 6; i++) created.push(await h.watches.create(h.userId, h.watchInput()));
      for (const watch of created)
        h.watchRepo.setNextCheckAt(watch.id, new Date(NOW.getTime() - HOUR));

      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(0);

      const due = created.map(
        (w) => h.watchRepo.findById(w.id)!.nextCheckAt!.getTime() - NOW.getTime()
      );
      expect(due.slice(1)).toEqual([20, 40, 60, 80, 100].map((s) => s * SECOND));
      expect(checks()).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(2 * MINUTE);
      expect(checks()).toHaveLength(6);
    });

    it('runs at most 2 checks at once per provider, and a due watch already queued is not started twice', async () => {
      setUp(
        createFakeProvider({
          delays: { availability: 40 * SECOND },
          availability: { '1': { u1: 'booked' } },
        })
      );
      for (let i = 0; i < 5; i++) await h.watches.create(h.userId, h.watchInput());
      h.scheduler.start();
      // Everything due at once (as after a resume)
      h.scheduler.rescheduleAll();
      await jest.advanceTimersByTimeAsync(3 * MINUTE);

      expect(h.fake.peakInFlight('availability')).toBe(2);
      expect(checks()).toHaveLength(5);
    });

    it('run-now joins the watch check in flight', async () => {
      setUp(createFakeProvider({ delays: { availability: 5 * SECOND } }));
      const watch = await h.watches.create(h.userId, h.watchInput());
      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(SECOND);

      const first = h.scheduler.runWatchNow(watch.id);
      const second = h.scheduler.runWatchNow(watch.id);
      await jest.advanceTimersByTimeAsync(5 * SECOND);

      expect(await first).toBe(await second);
      expect(checks()).toHaveLength(1);
    });

    it('emits watch:updated after each run', async () => {
      setUp(createFakeProvider({ availability: { '1': { u1: 'booked' } } }));
      const watch = await h.watches.create(h.userId, h.watchInput());
      h.events.emit.mockClear();
      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(SECOND);

      expect(h.events.emit).toHaveBeenCalledWith(
        'watch:updated',
        expect.objectContaining({ id: watch.id, lastResult: WatchResult.NOT_FOUND })
      );
    });
  });

  it('skips rows of an unknown provider, marked in error, and keeps running the rest', async () => {
    setUp(createFakeProvider({ availability: { '1': { u1: 'booked' } } }));
    const orphanWatch = await h.watches.create(h.userId, h.watchInput());
    const orphanSnipe = await settle(h.snipes.create(h.userId, h.snipeInput()));
    const watch = await h.watches.create(h.userId, h.watchInput());
    h.db.prepare("UPDATE watches SET provider_id = 'gone' WHERE id = ?").run(orphanWatch.id);
    h.db.prepare("UPDATE site_snipes SET provider_id = 'gone' WHERE id = ?").run(orphanSnipe.id);

    h.scheduler.start();
    await jest.advanceTimersByTimeAsync(2 * MINUTE);

    expect(h.watchRepo.findById(orphanWatch.id)).toMatchObject({
      lastResult: WatchResult.ERROR,
      lastCheckedAt: undefined,
    });
    expect(h.snipeRepo.findById(orphanSnipe.id)?.lastError).toMatch(/^UNKNOWN_PROVIDER/);
    expect(h.scheduler.snipeRunner.isScheduled(orphanSnipe.id)).toBe(false);
    expect(h.watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.NOT_FOUND);
  });
});
