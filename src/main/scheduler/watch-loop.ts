/**
 * The watch due-loop (tech-review #11): one chained `setTimeout` every 30 s runs the watches
 * whose `next_check_at` has come. Each check persists the next one (`WatchService.execute`),
 * so any interval is honoured and a restart picks up where it left off.
 *
 * - **In flight.** A watch is checked once at a time: a due watch already running (or queued
 *   for its provider) is not started again, and "check now" joins the run in flight.
 * - **Per provider.** At most `min(2, limits.maxConcurrentRequests)` checks run at once for a
 *   provider; the rest wait their turn in its limiter.
 * - **Startup.** Watches that fell due while the app was closed are spread over two minutes.
 * - **Unknown provider.** A watch whose provider is not registered is marked in error once
 *   and never selected, so the loop does not spin on it.
 */

import type { WatchExecutionResult } from '@shared/types';
import { providerLimits } from '@shared/types/provider.types';
import type { WatchService } from '../core/watches/watch.service';
import { staggerOffsets } from '../core/watches/next-check';
import type { ProviderRegistry } from '../providers/registry';
import { createLimiter, type Limiter } from '../providers/sdk/concurrency';
import { AppError } from '../utils/app-error';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'scheduler' });

/** How often the loop looks for due watches. */
export const WATCH_TICK_MS = 30_000;

/** The most checks run at once for one provider. */
export const WATCH_CONCURRENCY_PER_PROVIDER = 2;

interface WatchRun {
  promise: Promise<WatchExecutionResult>;
  controller: AbortController;
}

export interface WatchLoopDeps {
  watches: WatchService;
  providers: ProviderRegistry;
  clock?: () => Date;
}

export class WatchLoop {
  private readonly watches: WatchService;
  private readonly providers: ProviderRegistry;
  private readonly clock: () => Date;
  private readonly inFlight = new Map<number, WatchRun>();
  private readonly limiters = new Map<string, Limiter>();
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;

  constructor(deps: WatchLoopDeps) {
    this.watches = deps.watches;
    this.providers = deps.providers;
    this.clock = deps.clock ?? (() => new Date());
  }

  /** Marks unknown-provider watches, spreads the overdue ones, and ticks now. */
  start(): void {
    if (this.running) return;
    this.running = true;
    try {
      this.markUnknownProviders();
      this.staggerOverdue();
    } catch (error) {
      log.error('Watch loop could not prepare the overdue watches:', error);
    }
    this.tick();
  }

  /** Ticks now (after a resume): overdue watches run straight away. */
  kick(): void {
    if (!this.running) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.tick();
  }

  /**
   * Checks the watch now, or joins the check in flight. Runs even when the watch is inactive
   * (a person asked). Rejects with `NOT_FOUND` for an unknown watch.
   */
  async runNow(id: number): Promise<WatchExecutionResult> {
    const current = this.inFlight.get(id);
    if (current) return current.promise;
    const watch = await this.watches.get(id);
    if (!watch) throw new AppError('NOT_FOUND', 'Watch not found');
    return this.launch(id, watch.providerId, true);
  }

  /** Stops the watch's check in flight, if any (deactivated or deleted). */
  cancel(id: number): void {
    this.inFlight.get(id)?.controller.abort();
  }

  /** Stops ticking and aborts every check; returns them, to be awaited. */
  stop(): Promise<unknown>[] {
    this.running = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const pending: Promise<unknown>[] = [];
    for (const run of this.inFlight.values()) {
      run.controller.abort();
      pending.push(run.promise);
    }
    return pending;
  }

  /** The watch ids being checked or queued (for diagnostics and tests). */
  get inFlightIds(): number[] {
    return [...this.inFlight.keys()];
  }

  private tick(): void {
    this.timer = undefined;
    if (!this.running) return;
    try {
      for (const watch of this.watches.findDue(this.clock(), this.providerIds())) {
        if (!this.inFlight.has(watch.id)) void this.launch(watch.id, watch.providerId, false);
      }
    } catch (error) {
      log.error('Watch loop tick failed:', error);
    }
    this.timer = setTimeout(() => this.tick(), WATCH_TICK_MS);
  }

  private launch(id: number, providerId: string, manual: boolean): Promise<WatchExecutionResult> {
    const controller = new AbortController();
    const promise = this.limiterFor(providerId)(() => {
      log.info(`Executing watch ${id}${manual ? ' (now)' : ''}`);
      return this.watches.execute(id, { signal: controller.signal, manual });
    });
    const run: WatchRun = { promise, controller };
    this.inFlight.set(id, run);
    promise
      .catch((error: unknown) => {
        if (!manual) log.error(`Watch ${id} check failed:`, error);
      })
      .finally(() => {
        if (this.inFlight.get(id) === run) this.inFlight.delete(id);
      });
    return promise;
  }

  private limiterFor(providerId: string): Limiter {
    let limiter = this.limiters.get(providerId);
    if (!limiter) {
      const manifest = this.providers.tryGet(providerId)?.manifest;
      const cap = manifest
        ? Math.min(WATCH_CONCURRENCY_PER_PROVIDER, providerLimits(manifest).maxConcurrentRequests)
        : 1;
      limiter = createLimiter(cap);
      this.limiters.set(providerId, limiter);
    }
    return limiter;
  }

  private providerIds(): string[] {
    return this.providers.withCapability('watches').map((provider) => provider.manifest.id);
  }

  private markUnknownProviders(): void {
    for (const watch of this.watches.getActiveWatches()) {
      if (this.providers.tryGet(watch.providerId)) continue;
      log.warn(`Watch ${watch.id}: UNKNOWN_PROVIDER "${watch.providerId}"; skipped`);
      this.watches.markUnknownProvider(watch.id);
    }
  }

  /** Overdue watches are due again over the first two minutes, the longest overdue first. */
  private staggerOverdue(): void {
    const now = this.clock();
    const due = this.watches.findDue(now, this.providerIds());
    const offsets = staggerOffsets(due.length);
    due.forEach((watch, i) => {
      this.watches.deferTo(watch.id, new Date(now.getTime() + offsets[i]));
    });
    if (due.length > 0) log.info(`Spreading ${due.length} overdue watch(es) over two minutes`);
  }
}
