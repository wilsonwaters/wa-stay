/**
 * SnipeRunner's generation token and access-gate lifecycle with a hand-made gate whose
 * `ensure` ignores its signal: a continuation that resumes after the snipe was re-armed or
 * unscheduled must take no gate hold and arm no timer (the old `startWarmup` race), and a
 * run releases its one `holdOpen()` exactly once.
 */

import { SnipeRunner } from '@main/scheduler/snipe-runner';
import type { SiteSniperService, SnipePlan } from '@main/core/snipes/snipe.service';
import type { AccessGate } from '@main/providers/sdk/provider';
import type { SiteSnipe } from '@shared/types';
import { SnipeReleaseMode, SnipeStatus } from '@shared/types/common.types';
import { createMockSiteSnipe } from '@tests/fixtures/site-sniper';

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
