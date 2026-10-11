/**
 * Scheduler races found in the V4 review (A1–A12), with Jest's modern fake timers,
 * FakeProvider and a real in-memory database:
 *
 * - a re-arm (edit, activate, unlock) while an attempt is in flight never leaves the new run
 *   joined to the old run's aborted attempt: the snipe keeps polling, one check at a time,
 *   even when the transport ignores the abort or settles it late;
 * - a conflict with a hold that is only in flight is transient: the other snipe tries again;
 * - nothing is armed after `stop()`, not even the expiry of a hold that succeeded meanwhile;
 * - resume and unlock re-time a run without re-taking the access gate;
 * - a hold placed for a snipe or watch deleted meanwhile is still notified.
 */

import type { HoldResult } from '@main/providers/sdk';
import type { AccessGate } from '@main/providers/sdk/provider';
import { SnipeReleaseMode, SnipeStatus } from '@shared/types/common.types';
import { createCoreHarness, settle, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider, type FakeProvider } from '@tests/utils/fake-provider';

const NOW = new Date('2026-10-04T02:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('scheduler races (V4 review)', () => {
  let h: CoreHarness;
  let closeDb = true;

  afterEach(async () => {
    const stopping = h.scheduler.stop();
    await jest.advanceTimersByTimeAsync(10 * SECOND);
    await stopping;
    if (closeDb) h.db.close();
    closeDb = true;
    jest.useRealTimers();
  });

  function setUp(provider: FakeProvider = createFakeProvider(), stopGraceMs?: number): void {
    jest.useFakeTimers({ now: NOW });
    h = createCoreHarness({ providers: [provider], random: () => 0, stopGraceMs });
  }

  const status = (id: number) => h.snipeRepo.findById(id)?.status;
  const holds = () => h.fake.calls.filter((c) => c.module === 'holds');
  const raw = () => h.fake.calls.filter((c) => c.method === 'check-raw');

  async function scheduledSnipe(releaseAt: Date, extra: Record<string, unknown> = {}) {
    return settle(
      h.snipes.create(
        h.userId,
        h.snipeInput({
          releaseMode: SnipeReleaseMode.SCHEDULED,
          releaseAt,
          leadTimeSeconds: 0,
          pollIntervalMs: 1500,
          windowDurationMs: 15 * MINUTE,
          ...extra,
        })
      )
    );
  }

  /** A check that ignores its abort signal and takes `ms`; tracks how many run at once. */
  function checkIgnoringAbort(ms: number): () => number {
    const check = h.fake.availability!.check.bind(h.fake.availability);
    let active = 0;
    let peak = 0;
    h.fake.availability!.check = async (id, stay, options = {}) => {
      h.fake.calls.push({
        module: 'availability',
        method: 'check-raw',
        args: [],
        signal: options.signal,
      });
      peak = Math.max(peak, ++active);
      try {
        await sleep(ms);
        return await check(id, stay, { ...options, signal: undefined });
      } finally {
        active--;
      }
    };
    return () => peak;
  }

  /** A check whose abort settles 10 ms after the signal fires (as a real HTTP abort does). */
  function checkWithLateAbort(ms: number): void {
    const check = h.fake.availability!.check.bind(h.fake.availability);
    h.fake.availability!.check = (id, stay, options = {}) =>
      new Promise((resolve, reject) => {
        h.fake.calls.push({
          module: 'availability',
          method: 'check-raw',
          args: [],
          signal: options.signal,
        });
        const timer = setTimeout(
          () => resolve(check(id, stay, { ...options, signal: undefined })),
          ms
        );
        options.signal?.addEventListener('abort', () => {
          setTimeout(() => {
            clearTimeout(timer);
            reject(new DOMException('The operation was aborted', 'AbortError'));
          }, 10);
        });
      });
  }

  describe('a re-arm while an attempt is in flight (A1–A3)', () => {
    it('A1: an edit during a check that ignores the abort keeps the snipe polling, one check at a time', async () => {
      setUp(createFakeProvider({ availability: { '1': { u1: 'booked' } } }));
      const peak = checkIgnoringAbort(5 * SECOND);
      const snipe = await scheduledSnipe(NOW);
      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(SECOND);
      expect(raw()).toHaveLength(1);

      h.scheduler.rescheduleSnipe(snipe.id);
      await jest.advanceTimersByTimeAsync(30 * SECOND);

      expect(h.scheduler.snipeRunner.isScheduled(snipe.id)).toBe(true);
      expect(status(snipe.id)).toBe(SnipeStatus.SNIPING);
      expect(raw().length).toBeGreaterThan(3);
      expect(peak()).toBe(1);
    });

    it('A2: an edit during a check whose abort settles 10 ms later keeps the snipe polling', async () => {
      setUp(createFakeProvider({ availability: { '1': { u1: 'booked' } } }));
      checkWithLateAbort(5 * SECOND);
      const snipe = await scheduledSnipe(NOW);
      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(SECOND);
      const [first] = raw();

      h.scheduler.rescheduleSnipe(snipe.id);
      await jest.advanceTimersByTimeAsync(30 * SECOND);

      expect(first.signal?.aborted).toBe(true);
      expect(h.scheduler.snipeRunner.isScheduled(snipe.id)).toBe(true);
      expect(status(snipe.id)).toBe(SnipeStatus.SNIPING);
      expect(raw().length).toBeGreaterThan(3);
    });

    it('A3: an unlock during a manual run-now between polls keeps the snipe polling', async () => {
      setUp(createFakeProvider({ availability: { '1': { u1: 'booked' } } }));
      const snipe = await scheduledSnipe(NOW, { pollIntervalMs: 20 * SECOND });
      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(SECOND); // first poll done; the next in 20 s
      checkWithLateAbort(5 * SECOND);
      const manual = h.scheduler.runSnipeNow(snipe.id);
      await jest.advanceTimersByTimeAsync(SECOND);

      h.power.emit('unlock-screen');
      await jest.advanceTimersByTimeAsync(60 * SECOND);

      await expect(manual).resolves.toMatchObject({ snipeId: snipe.id });
      expect(h.scheduler.snipeRunner.isScheduled(snipe.id)).toBe(true);
      expect(status(snipe.id)).toBe(SnipeStatus.SNIPING);
      expect(raw().length).toBeGreaterThan(2);
    });

    it('a re-arm during a manual attempt joins nothing stale: the new run waits for it, then polls', async () => {
      setUp(createFakeProvider({ availability: { '1': { u1: 'booked' } } }));
      const peak = checkIgnoringAbort(5 * SECOND);
      const snipe = await scheduledSnipe(NOW, { pollIntervalMs: 20 * SECOND });
      h.scheduler.start();
      await jest.advanceTimersByTimeAsync(6 * SECOND);
      const manual = h.scheduler.runSnipeNow(snipe.id);
      await jest.advanceTimersByTimeAsync(SECOND);

      h.scheduler.rescheduleSnipe(snipe.id);
      await jest.advanceTimersByTimeAsync(60 * SECOND);

      await manual;
      expect(peak()).toBe(1);
      expect(h.scheduler.snipeRunner.isScheduled(snipe.id)).toBe(true);
      expect(status(snipe.id)).toBe(SnipeStatus.SNIPING);
    });
  });

  it('A12: a conflict with a hold still in flight is transient; when that hold fails, the other snipe can hold', async () => {
    setUp(createFakeProvider({ delays: { holds: 2 * SECOND } }));
    const a = await settle(h.snipes.create(h.userId, h.snipeInput({ pollIntervalMs: 3000 })));
    const b = await settle(
      h.snipes.create(
        h.userId,
        h.snipeInput({
          pollIntervalMs: 3000,
          location: { externalId: '2', name: 'Karri Grove' },
          stay: { arrival: '2026-12-02', departure: '2026-12-04', adults: 2 },
        })
      )
    );
    // A's hold is lost (someone else took the site)
    h.fake.scriptHold({ ok: false, reason: 'taken', message: 'Gone' });
    h.scheduler.snipeRunner.arm(a.id);
    h.scheduler.snipeRunner.arm(b.id);
    await jest.advanceTimersByTimeAsync(SECOND);
    // B found the nights taken by A's hold in flight: not counted, not failed
    expect(h.snipeRepo.findById(b.id)).toMatchObject({
      status: SnipeStatus.SNIPING,
      attemptsCount: 0,
      lastError: expect.stringContaining('being placed'),
    });
    h.fake.setAvailability('1', { u1: 'booked' });

    await jest.advanceTimersByTimeAsync(30 * SECOND);

    expect(status(b.id)).toBe(SnipeStatus.HELD);
    expect(status(a.id)).toBe(SnipeStatus.SNIPING);
    // A held B's nights? No: B holds them, and A is now blocked for good when it next finds a unit
    expect(holds()).toHaveLength(2);
  });

  it('A4: a hold that succeeds after stop() is recorded, and leaves no timer to fire on the closed database', async () => {
    setUp(createFakeProvider(), 3 * SECOND);
    const create = h.fake.holds!.create.bind(h.fake.holds);
    // A transport that ignores the abort
    h.fake.holds!.create = async (request): Promise<HoldResult> => {
      await sleep(2 * SECOND);
      return create(request, undefined);
    };
    const snipe = await settle(h.snipes.create(h.userId, h.snipeInput()));
    h.scheduler.start();
    await jest.advanceTimersByTimeAsync(100);

    const stopping = h.scheduler.stop();
    await jest.advanceTimersByTimeAsync(5 * SECOND);
    await stopping;

    expect(status(snipe.id)).toBe(SnipeStatus.HELD);
    expect(jest.getTimerCount()).toBe(0);
    h.db.close(); // as dispose() does next
    closeDb = false;
    await expect(jest.advanceTimersByTimeAsync(31 * MINUTE)).resolves.toBeUndefined();
  });

  it('A7: three unlocks while waiting for the release re-time the run without re-taking the access gate', async () => {
    setUp(createFakeProvider({ availability: { '1': { u1: 'booked' } } }));
    const gate = h.fake.access as AccessGate;
    const holdOpen = gate.holdOpen.bind(gate);
    let opened = 0;
    let released = 0;
    gate.holdOpen = () => {
      opened++;
      const release = holdOpen();
      return () => {
        released++;
        release();
      };
    };
    const snipe = await scheduledSnipe(new Date(NOW.getTime() + 5 * MINUTE), {
      accessGateEnabled: true,
      leadTimeSeconds: 120,
    });
    h.scheduler.start();
    // 3 min after NOW: warmed up, waiting for the release
    await jest.advanceTimersByTimeAsync(3 * MINUTE + SECOND);
    expect(status(snipe.id)).toBe(SnipeStatus.WAITING_RELEASE);
    const ensures = () => h.fake.calls.filter((c) => c.module === 'access').length;
    expect(ensures()).toBe(1);

    for (let i = 0; i < 3; i++) {
      h.power.emit('unlock-screen');
      await jest.advanceTimersByTimeAsync(10 * SECOND);
    }

    expect(opened).toBe(1);
    expect(ensures()).toBe(1);
    expect(status(snipe.id)).toBe(SnipeStatus.WAITING_RELEASE);
    // The release still fires on time: 5 min after NOW
    await jest.advanceTimersByTimeAsync(MINUTE + 28 * SECOND); // 4:59
    expect(status(snipe.id)).toBe(SnipeStatus.WAITING_RELEASE);
    await jest.advanceTimersByTimeAsync(2 * SECOND);
    expect(status(snipe.id)).toBe(SnipeStatus.SNIPING);

    h.fake.setAvailability('1', { u1: 'available' });
    await jest.advanceTimersByTimeAsync(5 * SECOND);
    expect(status(snipe.id)).toBe(SnipeStatus.HELD);
    expect(released).toBe(opened);
    expect(h.fake.holdCount).toBe(0);
  });

  it('a snipe deleted while its hold is placed: the person is still told about the hold', async () => {
    setUp(createFakeProvider({ delays: { holds: 2 * SECOND } }));
    const snipe = await settle(h.snipes.create(h.userId, h.snipeInput()));
    const create = h.fake.holds!.create.bind(h.fake.holds);
    h.fake.holds!.create = (request) => create(request, undefined); // ignores the abort
    h.scheduler.start();
    await jest.advanceTimersByTimeAsync(500);

    h.scheduler.unscheduleSnipe(snipe.id);
    await h.snipes.delete(snipe.id);
    await jest.advanceTimersByTimeAsync(5 * SECOND);

    expect(h.notifications.notifySnipeHeld).toHaveBeenCalledWith(
      expect.objectContaining({
        id: snipe.id,
        status: SnipeStatus.HELD,
        holdReference: 'FAKE-1',
        holdExpiresAt: expect.any(Date),
        paymentUrl: 'https://fake.example/pay/FAKE-1',
      })
    );
    expect(h.snipeRepo.findById(snipe.id)).toBeNull();
  });

  it('A11: a watch deleted while its auto-hold is placed: the hold is still notified, nothing throws', async () => {
    setUp(createFakeProvider({ delays: { holds: 2 * SECOND } }));
    const create = h.fake.holds!.create.bind(h.fake.holds);
    h.fake.holds!.create = (request) => create(request, undefined); // ignores the abort
    const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));
    h.scheduler.start();
    await jest.advanceTimersByTimeAsync(500);

    const run = h.scheduler.runWatchNow(watch.id); // joins the check in flight
    h.scheduler.cancelWatch(watch.id);
    await h.watches.delete(watch.id);
    await jest.advanceTimersByTimeAsync(5 * SECOND);

    await expect(run).resolves.toMatchObject({
      hold: expect.objectContaining({ reference: 'FAKE-1' }),
    });
    expect(h.notifications.notifyWatchHeld).toHaveBeenCalledTimes(1);
  });
});
