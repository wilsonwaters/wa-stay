/**
 * When a watch is next checked (PQ6, tech-review #11). Pure, so the maths is tested alone.
 *
 * - The effective interval is the watch's own, but never below 15 minutes and never below the
 *   provider's `limits.minWatchIntervalMinutes`. A legacy row saying 5 is run every 15 and
 *   keeps its stored value.
 * - Each check adds 0–10 % jitter, so watches created together drift apart instead of
 *   hitting the provider in step.
 * - On startup, watches that fell due while the app was closed are spread over two minutes.
 */

import { MIN_WATCH_INTERVAL_MINUTES } from '@shared/constants';
import { providerLimits, type ProviderManifest } from '@shared/types/provider.types';

const MINUTE_MS = 60_000;

/** The most jitter added to an interval: 10 %. */
export const MAX_JITTER_FRACTION = 0.1;

/** Overdue watches found at startup are spread over this long. */
export const STARTUP_STAGGER_MS = 120_000;

/** The interval a watch actually runs at, in minutes. */
export function effectiveIntervalMinutes(
  checkIntervalMinutes: number,
  manifest: Pick<ProviderManifest, 'limits'>
): number {
  return Math.max(
    checkIntervalMinutes,
    MIN_WATCH_INTERVAL_MINUTES,
    providerLimits(manifest).minWatchIntervalMinutes
  );
}

/** `checkedAt` plus the interval and 0–10 % jitter (`random` returns [0, 1)). */
export function nextCheckAt(
  checkedAt: Date,
  intervalMinutes: number,
  random: () => number = Math.random
): Date {
  const jitter = Math.min(Math.max(random(), 0), 1) * MAX_JITTER_FRACTION;
  return new Date(checkedAt.getTime() + Math.round(intervalMinutes * MINUTE_MS * (1 + jitter)));
}

/** Startup offsets (ms from now) for `count` overdue watches, evenly over two minutes. */
export function staggerOffsets(count: number, spanMs: number = STARTUP_STAGGER_MS): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((i * spanMs) / count));
}
