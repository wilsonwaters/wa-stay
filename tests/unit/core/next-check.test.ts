/**
 * Watch interval maths (`core/watches/next-check.ts`, PQ6): the 15-minute floor, the
 * provider's own minimum, 0–10 % jitter, and the startup stagger.
 */

import {
  effectiveIntervalMinutes,
  nextCheckAt,
  STARTUP_STAGGER_MS,
  staggerOffsets,
} from '@main/core/watches/next-check';
import { testManifest } from '@tests/utils/fake-provider';

const AT = new Date('2026-10-04T00:00:00.000Z');
const MINUTE = 60_000;

describe('watch interval maths', () => {
  it('runs a legacy 5-minute interval at 15 minutes', () => {
    expect(effectiveIntervalMinutes(5, testManifest('p'))).toBe(15);
  });

  it('keeps an interval above the floor, and never goes below the provider minimum', () => {
    expect(effectiveIntervalMinutes(60, testManifest('p'))).toBe(60);
    const slow = testManifest('slow', {
      limits: { minWatchIntervalMinutes: 30, maxConcurrentRequests: 2, catalogTtlHours: 24 },
    });
    expect(effectiveIntervalMinutes(15, slow)).toBe(30);
    // A provider asking for less than 15 still gets 15
    const eager = testManifest('eager', {
      limits: { minWatchIntervalMinutes: 5, maxConcurrentRequests: 2, catalogTtlHours: 24 },
    });
    expect(effectiveIntervalMinutes(5, eager)).toBe(15);
  });

  it('adds no jitter at random 0 and just under 10 % at random → 1', () => {
    expect(nextCheckAt(AT, 15, () => 0).getTime() - AT.getTime()).toBe(15 * MINUTE);
    const late = nextCheckAt(AT, 60, () => 0.999999).getTime() - AT.getTime();
    expect(late).toBeGreaterThan(65.9 * MINUTE);
    expect(late).toBeLessThanOrEqual(66 * MINUTE);
  });

  it('keeps the jitter within 0–10 % for any random value', () => {
    for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
      const delta = nextCheckAt(AT, 30, () => r).getTime() - AT.getTime();
      expect(delta).toBeGreaterThanOrEqual(30 * MINUTE);
      expect(delta).toBeLessThanOrEqual(33 * MINUTE);
    }
  });

  it('spreads overdue watches evenly over two minutes, the first at once', () => {
    expect(staggerOffsets(4)).toEqual([0, 30_000, 60_000, 90_000]);
    expect(staggerOffsets(0)).toEqual([]);
    expect(Math.max(...staggerOffsets(7))).toBeLessThan(STARTUP_STAGGER_MS);
  });
});
