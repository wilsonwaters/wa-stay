/**
 * SnipeRunner's generation token and access-gate lifecycle with a hand-made gate whose
 * `ensure` ignores its signal: a continuation that resumes after the snipe was re-armed or
 * unscheduled must take no gate hold and arm no timer (the old `startWarmup` race), and a
 * run releases its one `holdOpen()` exactly once.
 *
 * Release-alert snipes (R12) on the real core with fake timers: a provider's 403 or 429 ends
 * the snipe FAILED and no further check is made; an ALERTED snipe is never armed, at start or
 * after a resume; an alert snipe released at midnight in Perth polls at its cadence until its
 * window (clamped to the mode's limit) closes.
 */

import { SnipeRunner } from '@main/scheduler/snipe-runner';
import type { SiteSniperService, SnipePlan } from '@main/core/snipes/snipe.service';
import { ProviderHttpError } from '@main/providers/sdk/errors';
import type { AccessGate } from '@main/providers/sdk/provider';
import type { SiteSnipe } from '@shared/types';
import { SnipeReleaseMode, SnipeResult, SnipeStatus } from '@shared/types/common.types';
import { createMockSiteSnipe } from '@tests/fixtures/site-sniper';
import { createCoreHarness, settle, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider, type FakeProviderOptions } from '@tests/utils/fake-provider';

const NOW = new Date('2026-10-04T02:00:00.000Z');

describe('SnipeRunner generation token', () => {
  let snipe: SiteSnipe;
  let resolveEnsure: Array<() => void>;
  let releases: jest.Mock[];
  let gate: AccessGate;
  let service: Record<string, jest.Mock>;
  let runner: SnipeRunner;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    snipe = createMockSiteSnipe({
      id: 1,
      isActive: true,
      status: SnipeStatus.ARMED,
      accessGateEnabled: true,
      releaseMode: SnipeReleaseMode.SCHEDULED,
      // Warm-up (2 minutes ahead) has begun; the release is in a minute
      releaseAt: new Date(NOW.getTime() + 60_000),
      leadTimeSeconds: 120,
      windowDurationMs: 900_000,
    });
    resolveEnsure = [];
    releases = [];
    gate = {
      status: jest.fn(),
      // Ignores its signal: resolves only when the test says so
      ensure: jest.fn(
        () =>
          new Promise((resolve) => {
            resolveEnsure.push(() =>
              resolve({ providerId: 'fake', state: 'active', updatedAt: NOW.toISOString() })
            );
          })
      ),
      holdOpen: jest.fn(() => {
        const release = jest.fn();
        releases.push(release);
        return release;
      }),
      onStatus: jest.fn(() => () => undefined),
      dispose: jest.fn(),
    };
    const plan = (s: SiteSnipe): SnipePlan => ({
      provider: {} as SnipePlan['provider'],
      releaseAt: s.releaseAt,
      warmupAt: new Date(s.releaseAt!.getTime() - s.leadTimeSeconds * 1000),
      windowEnd: new Date(s.releaseAt!.getTime() + s.windowDurationMs),
      gate,
      pollIntervalMs: 1500,
      timeZone: 'Australia/Perth',
    });
    service = {
      find: jest.fn(() => snipe),
      getActive: jest.fn(() => [snipe]),
      getHeld: jest.fn(() => []),
      plan: jest.fn(plan),
      setStatus: jest.fn((_id: number, status: SnipeStatus) => {
        snipe = { ...snipe, status };
      }),
      expire: jest.fn(),
      arrivalPassed: jest.fn(() => false),
      refreshReleaseAt: jest.fn(),
      execute: jest.fn(),
      recordGateFailure: jest.fn(),
      markUnknownProvider: jest.fn(),
      expireHold: jest.fn(),
    };
    runner = new SnipeRunner({ snipes: service as unknown as SiteSniperService });
  });

  afterEach(() => {
    void runner.stop();
    jest.useRealTimers();
  });

  it('a warm-up whose ensure resolves after a re-arm takes no gate hold and arms no timer', async () => {
    runner.arm(1);
    await jest.advanceTimersByTimeAsync(0);
    expect(gate.ensure).toHaveBeenCalledTimes(1);

    // Re-armed while the first warm-up waits in the queue
    runner.arm(1);
    await jest.advanceTimersByTimeAsync(0);
    expect(gate.ensure).toHaveBeenCalledTimes(2);

    // The first (stale) ensure resolves now, after the re-arm
    resolveEnsure[0]();
    await jest.advanceTimersByTimeAsync(0);
    expect(gate.holdOpen).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);

    // The current one resolves: one hold, one release timer
    resolveEnsure[1]();
    await jest.advanceTimersByTimeAsync(0);
    expect(gate.holdOpen).toHaveBeenCalledTimes(1);
    expect(snipe.status).toBe(SnipeStatus.WAITING_RELEASE);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('an ensure resolving after unschedule does nothing, and a run’s hold is released exactly once', async () => {
    runner.arm(1);
    await jest.advanceTimersByTimeAsync(0);
    resolveEnsure[0]();
    await jest.advanceTimersByTimeAsync(0);
    expect(releases).toHaveLength(1);

    runner.unschedule(1);
    runner.unschedule(1);
    await jest.advanceTimersByTimeAsync(0);
    expect(releases[0]).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    // A second chain, unscheduled while its ensure waits
    runner.arm(1);
    await jest.advanceTimersByTimeAsync(0);
    runner.unschedule(1);
    resolveEnsure[1]();
    await jest.advanceTimersByTimeAsync(0);
    expect(gate.holdOpen).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('arms nothing after stop()', async () => {
    void runner.stop();
    runner.arm(1);
    await jest.advanceTimersByTimeAsync(0);

    expect(gate.ensure).not.toHaveBeenCalled();
    expect(runner.isScheduled(1)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a gate that fails is recorded and the snipe carries on to its release without a hold', async () => {
    (gate.ensure as jest.Mock).mockRejectedValueOnce(new Error('queue down'));
    runner.arm(1);
    await jest.advanceTimersByTimeAsync(0);

    expect(service.recordGateFailure).toHaveBeenCalledWith(1, 'queue down');
    expect(gate.holdOpen).not.toHaveBeenCalled();
    expect(snipe.status).toBe(SnipeStatus.WAITING_RELEASE);
  });
});

describe('SnipeRunner daily-rollover start (m1)', () => {
  let snipe: SiteSnipe;
  let service: Record<string, jest.Mock>;
  let runner: SnipeRunner;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    snipe = createMockSiteSnipe({
      id: 1,
      isActive: true,
      status: SnipeStatus.ARMED,
      accessGateEnabled: false,
      releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
      // As migration v8 left it: the old midnight instant, an hour ago, whose 15-minute
      // window has closed
      releaseAt: new Date(NOW.getTime() - 60 * 60_000),
      leadTimeSeconds: 0,
      windowDurationMs: 900_000,
    });
    service = {
      find: jest.fn(() => snipe),
      getActive: jest.fn(() => [snipe]),
      getHeld: jest.fn(() => []),
      plan: jest.fn((s: SiteSnipe): SnipePlan => ({
        provider: {} as SnipePlan['provider'],
        releaseAt: s.releaseAt,
        warmupAt: s.releaseAt,
        windowEnd: new Date(s.releaseAt!.getTime() + s.windowDurationMs),
        pollIntervalMs: 1500,
        timeZone: 'Australia/Perth',
      })),
      setStatus: jest.fn((_id: number, status: SnipeStatus) => {
        snipe = { ...snipe, status };
      }),
      expire: jest.fn(),
      arrivalPassed: jest.fn(() => false),
      // The provider moves the release to the campground's own time, two hours later
      refreshReleaseAt: jest.fn(async () => {
        snipe = { ...snipe, releaseAt: new Date(NOW.getTime() + 60 * 60_000) };
        return snipe.releaseAt;
      }),
      execute: jest.fn(),
      markUnknownProvider: jest.fn(),
    };
    runner = new SnipeRunner({ snipes: service as unknown as SiteSniperService });
  });

  afterEach(() => {
    void runner.stop();
    jest.useRealTimers();
  });

  it('expires a snipe whose arrival has passed without asking the provider for the release', async () => {
    service.arrivalPassed.mockReturnValue(true);
    runner.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(service.refreshReleaseAt).not.toHaveBeenCalled();
    expect(service.expire).toHaveBeenCalledWith(1, 'The arrival date has passed');
    expect(runner.isScheduled(1)).toBe(false);
  });

  it('skips a snipe of an unknown provider without asking for the release', async () => {
    service.plan.mockReturnValue(undefined);
    runner.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(service.refreshReleaseAt).not.toHaveBeenCalled();
    expect(service.markUnknownProvider).toHaveBeenCalledWith(1, snipe.providerId);
    expect(runner.isScheduled(1)).toBe(false);
  });

  it('checks the window after the refresh: a release that moved later keeps the snipe armed', async () => {
    runner.start();
    await jest.advanceTimersByTimeAsync(0);

    expect(service.refreshReleaseAt).toHaveBeenCalledTimes(1);
    expect(service.expire).not.toHaveBeenCalled();
    expect(snipe.status).toBe(SnipeStatus.ARMED);
    expect(runner.isScheduled(1)).toBe(true);
  });
});

describe('SnipeRunner with release-alert snipes (R12; fake timers, real core)', () => {
  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  // 5 Oct 2026, 00:00 in Perth: a release at midnight where the provider is
  const MIDNIGHT_PERTH = new Date('2026-10-04T16:00:00.000Z');
  let h: CoreHarness;

  afterEach(async () => {
    const closing = h.close();
    await jest.advanceTimersByTimeAsync(10 * SECOND);
    await closing;
    jest.useRealTimers();
  });

  function setUp(options: FakeProviderOptions = {}): void {
    jest.useFakeTimers({ now: NOW });
    h = createCoreHarness({ providers: [createFakeProvider(options)] });
  }

  const checks = () => h.fake.calls.filter((c) => c.module === 'availability');
  const stored = (id: number) => h.snipeRepo.findById(id)!;

  /** An alert snipe released at `releaseAt`, polling every `pollIntervalMs`. */
  function alertSnipe(releaseAt: Date, extra: Parameters<CoreHarness['snipeInput']>[0] = {}) {
    return settle(
      h.snipes.create(
        h.userId,
        h.snipeInput({
          action: 'alert',
          releaseMode: SnipeReleaseMode.SCHEDULED,
          releaseAt,
          leadTimeSeconds: 0,
          pollIntervalMs: 10 * SECOND,
          ...extra,
        })
      )
    );
  }

  it.each([403, 429])(
    'a %s ends the snipe FAILED with the message, and no further check is made',
    async (status) => {
      setUp({ availability: { '1': { u1: 'booked' } } });
      const snipe = await alertSnipe(NOW);
      h.fake.failNext(
        'availability',
        new ProviderHttpError({ providerId: 'fake', status, url: 'https://fake.example/check' })
      );
      h.scheduler.snipeRunner.arm(snipe.id);
      await jest.advanceTimersByTimeAsync(SECOND);

      expect(checks()).toHaveLength(1);
      expect(stored(snipe.id)).toMatchObject({
        status: SnipeStatus.FAILED,
        lastResult: SnipeResult.ERROR,
        lastError: `Fake refused the check (HTTP ${status}). Site Sniper stopped and won't try again by itself.`,
        isActive: false,
      });
      expect(h.scheduler.snipeRunner.isScheduled(snipe.id)).toBe(false);

      // Nothing tries again: not the window, not a resume, not a restart
      await jest.advanceTimersByTimeAsync(15 * MINUTE);
      h.power.emit('resume');
      h.scheduler.snipeRunner.start();
      await jest.advanceTimersByTimeAsync(MINUTE);
      expect(checks()).toHaveLength(1);
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  it('an ALERTED snipe is not armed by start() or rescheduleAll()', async () => {
    setUp();
    const snipe = await alertSnipe(NOW);
    h.snipeRepo.markAlerted(snipe.id, { at: NOW, unitId: 'u1' });
    // Even a row left active (a crash between writes) is not armed: ALERTED is terminal
    const active = await alertSnipe(NOW);
    h.snipeRepo.markAlerted(active.id, { at: NOW, unitId: 'u1' });
    h.db.prepare('UPDATE site_snipes SET is_active = 1 WHERE id = ?').run(active.id);

    h.scheduler.snipeRunner.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(h.scheduler.snipeRunner.isScheduled(snipe.id)).toBe(false);
    expect(h.scheduler.snipeRunner.isScheduled(active.id)).toBe(false);

    h.power.emit('resume');
    h.scheduler.snipeRunner.rescheduleAll();
    await jest.advanceTimersByTimeAsync(MINUTE);
    expect(h.scheduler.snipeRunner.isScheduled(snipe.id)).toBe(false);
    expect(h.scheduler.snipeRunner.isScheduled(active.id)).toBe(false);
    expect(checks()).toHaveLength(0);
    expect(stored(snipe.id).status).toBe(SnipeStatus.ALERTED);
    expect(stored(active.id).status).toBe(SnipeStatus.ALERTED);
  });

  it('an alert snipe released at midnight in Perth alerts on the first free check and stops', async () => {
    setUp({ availability: { '1': { u1: 'booked' } } });
    const snipe = await alertSnipe(MIDNIGHT_PERTH);
    h.scheduler.snipeRunner.arm(snipe.id);

    // Nothing is asked before the release
    await jest.advanceTimersByTimeAsync(MIDNIGHT_PERTH.getTime() - NOW.getTime() - 1);
    expect(checks()).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(checks()).toHaveLength(1);
    expect(stored(snipe.id).status).toBe(SnipeStatus.SNIPING);

    // Free on the third check, 20 s after midnight (each check takes a tick of the fake clock)
    await jest.advanceTimersByTimeAsync(15 * SECOND);
    h.fake.setAvailability('1', { u1: 'available' });
    await jest.advanceTimersByTimeAsync(6 * SECOND);
    expect(checks()).toHaveLength(3);
    const alerted = stored(snipe.id);
    expect(alerted).toMatchObject({
      status: SnipeStatus.ALERTED,
      isActive: false,
      alert: { unitId: 'u1' },
    });
    const sinceMidnight = alerted.alert!.at.getTime() - MIDNIGHT_PERTH.getTime();
    expect(sinceMidnight).toBeGreaterThanOrEqual(20 * SECOND);
    expect(sinceMidnight).toBeLessThan(21 * SECOND);
    expect(h.notifications.notifySnipeAlert).toHaveBeenCalledTimes(1);
    expect(h.fake.calls.filter((c) => c.module === 'holds')).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(30 * MINUTE);
    expect(checks()).toHaveLength(3);
    expect(h.scheduler.snipeRunner.isScheduled(snipe.id)).toBe(false);
  });

  it('polls no faster than its cadence within the clamped window, then expires as an alert', async () => {
    setUp({ availability: { '1': { u1: 'booked' } }, maxWindowMinutes: 30 });
    const snipe = await alertSnipe(MIDNIGHT_PERTH, { windowDurationMs: 2 * 60 * MINUTE });
    expect(snipe.windowDurationMs).toBe(30 * MINUTE);
    const availability = h.registry.get('fake').availability!;
    const check = availability.check;
    const at: number[] = [];
    jest.spyOn(availability, 'check').mockImplementation((...args) => {
      at.push(Date.now());
      return check(...args);
    });
    h.scheduler.snipeRunner.arm(snipe.id);

    await jest.advanceTimersByTimeAsync(MIDNIGHT_PERTH.getTime() - NOW.getTime() + 2 * 60 * MINUTE);

    // One check every 10 s from 00:00:00 to 00:29:50, then the window closes at 00:30
    expect(checks()).toHaveLength(180);
    expect(at[0]).toBe(MIDNIGHT_PERTH.getTime());
    expect(at[at.length - 1]).toBeLessThan(MIDNIGHT_PERTH.getTime() + 30 * MINUTE);
    for (let i = 1; i < at.length; i++)
      expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(10 * SECOND);
    expect(stored(snipe.id)).toMatchObject({
      status: SnipeStatus.EXPIRED,
      lastResult: SnipeResult.EXPIRED,
      lastError: 'The window closed before the dates were free',
      isActive: false,
    });
    expect(h.notifications.notifySnipeAlert).not.toHaveBeenCalled();
  });
});
