/**
 * The per-snipe state machine (tech-review #2, #11):
 *
 *   arm ─► EXPIRED (window closed, or the arrival date has passed)
 *    ├─► ARMED ─(warm-up: releaseAt − lead)─► QUEUEING* ─► WAITING_RELEASE ─(release)─► SNIPING
 *    └─► SNIPING (continuous polling, or the release has already come within the window)
 *   SNIPING ─poll─► HELD | FAILED | EXPIRED, or the provider's queue ─► QUEUEING* ─► SNIPING
 *   (* only when the snipe uses the provider's access gate)
 *
 * Correctness rules:
 * - **One chain per snipe.** Each `arm` starts a new run with a new generation token and its
 *   own `AbortController`; the previous run is aborted. Every timer callback, and every step
 *   after each `await`, checks that its run is still the current one before it writes,
 *   arms a timer or takes the gate, so a stale continuation does nothing.
 * - **One timer per run**, replaced at each step; nothing repeats on its own. The next poll is armed
 *   only after the previous attempt settles, so at most one check is in flight per snipe.
 *   "Run now" joins the attempt in flight.
 * - **Fresh state.** Each step re-reads the snipe by id.
 * - **The access gate** is joined with `ensure({ signal })` and kept open with one
 *   `holdOpen()` per run, released exactly once when the run ends or is unscheduled.
 * - **Long releases.** A warm-up more than ~23 days away is re-armed daily instead of with
 *   one timer (Node fires a longer one at once).
 * - **Holds lapse.** A HELD snipe becomes EXPIRED at `holdExpiresAt` unless V6 marks it booked.
 */

import type { SiteSnipe, SnipeExecutionResult } from '@shared/types';
import { SnipeReleaseMode, SnipeStatus } from '@shared/types/common.types';
import {
  TERMINAL_SNIPE_STATUSES,
  type SiteSniperService,
  type SnipeOutcome,
  type SnipePlan,
} from '../core/snipes/snipe.service';
import { toApiError } from '../providers/sdk/errors';
import { logger } from '../utils/logger';

const log = logger.child({ module: 'scheduler' });

/** The longest single timer armed (setTimeout's limit is 2^31 − 1 ms, about 24.8 days). */
export const MAX_TIMER_MS = 2_000_000_000;
/** How often a far-off release is re-armed. */
export const REARM_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface SnipeRun {
  /** The generation token: the run is current while the runner's map holds this one. */
  readonly gen: number;
  readonly controller: AbortController;
  /** The one pending timer: re-arm, warm-up, release or poll. */
  timer?: ReturnType<typeof setTimeout>;
  /** When the pending timer is due (wall clock, epoch ms) and what it runs. */
  timerDueAt?: number;
  timerStep?: () => void;
  /** Releases this run's `holdOpen()`; runs once. */
  releaseGate?: () => void;
  /** The step in flight (release-time refresh, queue, attempt). */
  inFlight?: Promise<void>;
}

/** Wraps a release so it runs once, however often it is called. */
function once(release: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    release();
  };
}

export interface SnipeRunnerDeps {
  snipes: SiteSniperService;
  clock?: () => Date;
}

export class SnipeRunner {
  private readonly snipes: SiteSniperService;
  private readonly clock: () => Date;
  private readonly runs = new Map<number, SnipeRun>();
  /**
   * The attempt in flight per snipe, scheduled or manual, with the signal it runs under.
   * "Run now" and the next poll join it, unless it was aborted by a run that has since been
   * replaced: then they wait for it to settle and start a fresh one.
   */
  private readonly attempts = new Map<
    number,
    { promise: Promise<SnipeOutcome>; signal?: AbortSignal }
  >();
  /** Controllers of manual attempts for snipes with no run. */
  private readonly manualControllers = new Set<AbortController>();
  private readonly holdTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private generation = 0;
  /** Set by `stop()`: nothing is armed afterwards, not even a hold's expiry. */
  private stopped = false;

  constructor(deps: SnipeRunnerDeps) {
    this.snipes = deps.snipes;
    this.clock = deps.clock ?? (() => new Date());
  }

  /** Arms every active snipe and every held snipe's hold expiry. */
  start(): void {
    this.stopped = false;
    for (const snipe of this.snipes.getActive()) this.arm(snipe.id);
    this.armHoldExpiries();
  }

  /**
   * After a resume or unlock: timers do not count the time the computer slept, so each one is
   * recomputed from the wall clock. A run keeps its generation, its gate hold and any step in
   * flight (which reads the clock when it continues):
   * - an armed run (no gate taken yet) is prepared again, which also asks the provider for a
   *   daily rollover's release time;
   * - a run waiting for its release or sniping has its pending timer re-set to the time left,
   *   or expires when its window has passed;
   * - an active snipe with no run is armed.
   * Hold expiries are re-armed too.
   */
  rescheduleAll(): void {
    if (this.stopped) return;
    for (const snipe of this.snipes.getActive()) {
      const run = this.runs.get(snipe.id);
      if (!run) {
        this.arm(snipe.id);
        continue;
      }
      if (run.inFlight) continue;
      if (snipe.status === SnipeStatus.ARMED) {
        this.track(snipe.id, run, this.prepare(snipe.id, run));
        continue;
      }
      this.retime(snipe.id, run);
    }
    this.armHoldExpiries();
  }

  /** Starts (or restarts) the snipe's chain with a new generation. */
  arm(id: number): void {
    if (this.stopped) return;
    this.unschedule(id);
    const run: SnipeRun = { gen: ++this.generation, controller: new AbortController() };
    this.runs.set(id, run);
    this.track(id, run, this.prepare(id, run));
  }

  /**
   * Stops the snipe's chain: clears its timer, aborts its step in flight (HTTP included) and
   * lets go of the access gate. Returns the step in flight, if any.
   */
  unschedule(id: number): Promise<void> | undefined {
    const run = this.runs.get(id);
    if (!run) return undefined;
    this.runs.delete(id);
    if (run.timer !== undefined) clearTimeout(run.timer);
    run.timer = undefined;
    run.controller.abort();
    run.releaseGate?.();
    log.info(`Unscheduled snipe ${id} (gen ${run.gen})`);
    return run.inFlight;
  }

  /** One attempt now, or the attempt in flight. */
  async runNow(id: number): Promise<SnipeExecutionResult> {
    const run = this.runs.get(id);
    let controller: AbortController | undefined;
    if (!run) {
      controller = new AbortController();
      this.manualControllers.add(controller);
    }
    const signal = run?.controller.signal ?? controller?.signal;
    try {
      return (await this.attempt(id, signal, true)).result;
    } finally {
      if (controller) this.manualControllers.delete(controller);
    }
  }

  /** Stops everything; returns what is in flight, to be awaited. */
  stop(): Promise<unknown>[] {
    this.stopped = true;
    const pending: Promise<unknown>[] = [];
    for (const id of [...this.runs.keys()]) {
      const inFlight = this.unschedule(id);
      if (inFlight) pending.push(inFlight);
    }
    for (const controller of this.manualControllers) controller.abort();
    pending.push(...[...this.attempts.values()].map((attempt) => attempt.promise));
    for (const timer of this.holdTimers.values()) clearTimeout(timer);
    this.holdTimers.clear();
    return pending;
  }

  /** Whether the snipe has a live chain (for diagnostics and tests). */
  isScheduled(id: number): boolean {
    return this.runs.has(id);
  }

  // ---- steps ---------------------------------------------------------------------

  private isCurrent(id: number, run: SnipeRun): boolean {
    return this.runs.get(id)?.gen === run.gen && !run.controller.signal.aborted;
  }

  private track(id: number, run: SnipeRun, step: Promise<void>): void {
    const tracked: Promise<void> = step
      .catch((error: unknown) => {
        log.error(`Snipe ${id} step failed (gen ${run.gen}): ${toApiError(error).message}`);
        if (this.isCurrent(id, run)) this.finish(id, run);
      })
      .finally(() => {
        if (run.inFlight === tracked) run.inFlight = undefined;
      });
    run.inFlight = tracked;
  }

  private setTimer(id: number, run: SnipeRun, delayMs: number, step: () => void): void {
    if (run.timer !== undefined) clearTimeout(run.timer);
    run.timer = undefined;
    if (this.stopped) return;
    const delay = Math.min(Math.max(0, delayMs), MAX_TIMER_MS);
    run.timerDueAt = this.clock().getTime() + delay;
    run.timerStep = step;
    run.timer = setTimeout(() => {
      run.timer = undefined;
      if (this.isCurrent(id, run)) step();
    }, delay);
  }

  /**
   * Re-sets the run's pending timer to the time left by the wall clock, keeping the run as it
   * is; expires it instead when its window has passed or its arrival date has come.
   */
  private retime(id: number, run: SnipeRun): void {
    const snipe = this.live(id);
    if (!snipe) return this.finish(id, run);
    if (!this.planFor(id, run, snipe)) return;
    if (run.timer === undefined || run.timerDueAt === undefined || !run.timerStep) return;
    this.setTimer(id, run, run.timerDueAt - this.clock().getTime(), run.timerStep);
  }

  /** The run ends on its own (held, failed, expired, stopped): its gate is released once. */
  private finish(id: number, run: SnipeRun): void {
    if (this.runs.get(id)?.gen !== run.gen) return;
    this.runs.delete(id);
    if (run.timer !== undefined) clearTimeout(run.timer);
    run.timer = undefined;
    run.releaseGate?.();
  }

  private setStatus(snipe: SiteSnipe, status: SnipeStatus): void {
    if (snipe.status !== status) this.snipes.setStatus(snipe.id, status);
  }

  /** The snipe as stored, if it is still active and not terminal. */
  private live(id: number): SiteSnipe | undefined {
    const snipe = this.snipes.find(id);
    if (!snipe || !snipe.isActive || TERMINAL_SNIPE_STATUSES.has(snipe.status)) return undefined;
    return snipe;
  }

  /**
   * The plan, after the expiry checks; undefined (and the run finished) when there is none.
   * With `window: false` the window is not checked: the stored release instant may be about to
   * move (a daily rollover is asked again), and the window moves with it.
   */
  private planFor(
    id: number,
    run: SnipeRun,
    snipe: SiteSnipe,
    { window = true }: { window?: boolean } = {}
  ): SnipePlan | undefined {
    const plan = this.snipes.plan(snipe);
    if (!plan) {
      log.warn(`Snipe ${id}: UNKNOWN_PROVIDER "${snipe.providerId}"; skipped`);
      this.snipes.markUnknownProvider(id, snipe.providerId);
      this.finish(id, run);
      return undefined;
    }
    const now = this.clock();
    if (this.snipes.arrivalPassed(snipe, plan.timeZone, now)) {
      this.snipes.expire(id, 'The arrival date has passed');
      this.finish(id, run);
      return undefined;
    }
    if (window && plan.windowEnd && now.getTime() >= plan.windowEnd.getTime()) {
      this.snipes.expire(id, 'The snipe window closed without a hold');
      this.finish(id, run);
      return undefined;
    }
    return plan;
  }

  private async prepare(id: number, run: SnipeRun): Promise<void> {
    let snipe = this.live(id);
    if (!snipe) return this.finish(id, run);

    // V3 stored the release instant at save time: a daily rollover asks the provider again
    // (a v8-migrated row still carries the old midnight instant). A snipe that is over whatever
    // the release time (its provider gone, its arrival passed) ends first, without asking: a
    // stale snipe at start-up costs the provider no request (m1). The window is checked after
    // the refresh, as the release (and so the window) can move later.
    if (snipe.releaseMode === SnipeReleaseMode.DAILY_ROLLOVER) {
      if (!this.planFor(id, run, snipe, { window: false })) return;
      await this.snipes.refreshReleaseAt(snipe, run.controller.signal);
      if (!this.isCurrent(id, run)) return;
      snipe = this.live(id);
      if (!snipe) return this.finish(id, run);
    }

    const plan = this.planFor(id, run, snipe);
    if (!plan) return;
    const now = this.clock().getTime();

    if (!plan.releaseAt || now >= plan.releaseAt.getTime()) {
      // Continuous polling, or the release has already come: poll now.
      this.setStatus(snipe, SnipeStatus.SNIPING);
      this.setTimer(id, run, 0, () => this.poll(id, run));
      return;
    }

    this.setStatus(snipe, SnipeStatus.ARMED);
    const delay = (plan.warmupAt ?? plan.releaseAt).getTime() - now;
    if (delay > MAX_TIMER_MS) {
      log.info(`Snipe ${id}: release far ahead; re-arming in ${REARM_INTERVAL_MS} ms`);
      this.setTimer(id, run, REARM_INTERVAL_MS, () => this.arm(id));
      return;
    }
    log.info(
      `Snipe ${id} armed (gen ${run.gen}): warm-up in ${Math.max(0, delay)} ms, release ${plan.releaseAt.toISOString()}`
    );
    this.setTimer(id, run, delay, () => this.warmUp(id, run));
  }

  private warmUp(id: number, run: SnipeRun): void {
    const snipe = this.live(id);
    if (!snipe) return this.finish(id, run);
    const plan = this.planFor(id, run, snipe);
    if (!plan) return;
    if (!plan.gate) return this.awaitRelease(id, run, snipe, plan);

    this.setStatus(snipe, SnipeStatus.QUEUEING);
    this.track(
      id,
      run,
      this.queue(id, run, plan).then(() => {
        if (!this.isCurrent(id, run)) return;
        const current = this.live(id);
        if (!current) return this.finish(id, run);
        this.awaitRelease(id, run, current, plan);
      })
    );
  }

  /**
   * Waits in the provider's queue until it lets the snipe through (bounded by the window),
   * then holds the gate open for this run. A failure is recorded and the snipe carries on:
   * its polls tell whether the queue is in the way.
   */
  private async queue(id: number, run: SnipeRun, plan: SnipePlan): Promise<void> {
    const gate = plan.gate;
    if (!gate) return;
    const maxWaitMs = plan.windowEnd
      ? Math.max(plan.windowEnd.getTime() - this.clock().getTime(), 0)
      : undefined;
    try {
      await gate.ensure({ signal: run.controller.signal, maxWaitMs });
    } catch (error) {
      if (!this.isCurrent(id, run)) return;
      const { message } = toApiError(error);
      log.warn(`Snipe ${id} queue warm-up failed: ${message}`);
      this.snipes.recordGateFailure(id, message);
      return;
    }
    // Checked after the await, and the gate taken with no await in between.
    if (!this.isCurrent(id, run)) return;
    run.releaseGate ??= once(gate.holdOpen());
  }

  private awaitRelease(id: number, run: SnipeRun, snipe: SiteSnipe, plan: SnipePlan): void {
    const untilRelease = (plan.releaseAt?.getTime() ?? 0) - this.clock().getTime();
    if (untilRelease <= 0) return this.startSniping(id, run, snipe);
    this.setStatus(snipe, SnipeStatus.WAITING_RELEASE);
    this.setTimer(id, run, untilRelease, () => {
      const current = this.live(id);
      if (!current) return this.finish(id, run);
      this.startSniping(id, run, current);
    });
  }

  private startSniping(id: number, run: SnipeRun, snipe: SiteSnipe): void {
    this.setStatus(snipe, SnipeStatus.SNIPING);
    log.info(`Snipe ${id} sniping (gen ${run.gen})`);
    this.poll(id, run);
  }

  private poll(id: number, run: SnipeRun): void {
    const snipe = this.live(id);
    if (!snipe) return this.finish(id, run);
    const plan = this.planFor(id, run, snipe);
    if (!plan) return;
    this.setStatus(snipe, SnipeStatus.SNIPING);
    this.track(id, run, this.tick(id, run, plan));
  }

  /** One attempt, then what comes next: the next poll, the queue, or the end. */
  private async tick(id: number, run: SnipeRun, plan: SnipePlan): Promise<void> {
    const started = Date.now();
    log.info(`snipe tick start: snipe ${id} gen ${run.gen}`);
    const outcome = await this.attempt(id, run.controller.signal, false);
    log.info(
      `snipe tick end: snipe ${id} gen ${run.gen} ${outcome.result.result} in ${Date.now() - started} ms`
    );
    if (!this.isCurrent(id, run)) return;

    if (outcome.next === 'done') return this.finish(id, run);
    if (outcome.next === 'access-gate' && plan.gate) {
      const snipe = this.live(id);
      if (!snipe) return this.finish(id, run);
      this.setStatus(snipe, SnipeStatus.QUEUEING);
      await this.queue(id, run, plan);
      if (!this.isCurrent(id, run)) return;
      this.setTimer(id, run, 0, () => this.poll(id, run));
      return;
    }
    const untilWindowEnd = plan.windowEnd
      ? plan.windowEnd.getTime() - this.clock().getTime()
      : Infinity;
    this.setTimer(id, run, Math.min(plan.pollIntervalMs, untilWindowEnd), () => this.poll(id, run));
  }

  /**
   * The attempt in flight for the snipe, or a new one; at most one is ever in flight. An
   * attempt aborted by a run that has since been replaced is not joined (it would only say
   * "stopped"): the caller waits for it to settle, then starts a fresh one. A hold arms its
   * expiry.
   */
  private async attempt(
    id: number,
    signal: AbortSignal | undefined,
    manual: boolean
  ): Promise<SnipeOutcome> {
    for (;;) {
      const inFlight = this.attempts.get(id);
      if (!inFlight) break;
      if (!inFlight.signal?.aborted || inFlight.signal === signal) return inFlight.promise;
      await inFlight.promise.catch(() => undefined);
    }
    const promise: Promise<SnipeOutcome> = this.snipes
      .execute(id, { signal, manual })
      .then((outcome) => {
        if (outcome.result.held) this.armHoldExpiry(this.snipes.find(id));
        return outcome;
      })
      .finally(() => {
        if (this.attempts.get(id)?.promise === promise) this.attempts.delete(id);
      });
    this.attempts.set(id, { promise, signal });
    return promise;
  }

  // ---- hold expiry ----------------------------------------------------------------

  private armHoldExpiries(): void {
    for (const snipe of this.snipes.getHeld()) this.armHoldExpiry(snipe);
  }

  /** At `holdExpiresAt` a still-HELD snipe becomes EXPIRED. */
  private armHoldExpiry(snipe: SiteSnipe | null): void {
    if (this.stopped) return;
    if (!snipe || snipe.status !== SnipeStatus.HELD || !snipe.holdExpiresAt) return;
    const existing = this.holdTimers.get(snipe.id);
    if (existing !== undefined) clearTimeout(existing);
    const id = snipe.id;
    const delay = snipe.holdExpiresAt.getTime() - this.clock().getTime();
    if (delay <= 0) {
      this.holdTimers.delete(id);
      this.snipes.expireHold(id);
      return;
    }
    this.holdTimers.set(
      id,
      setTimeout(
        () => {
          this.holdTimers.delete(id);
          const current = this.snipes.find(id);
          if (!current) return;
          if (current.holdExpiresAt && current.holdExpiresAt.getTime() > this.clock().getTime()) {
            this.armHoldExpiry(current);
            return;
          }
          this.snipes.expireHold(id);
        },
        Math.min(delay, MAX_TIMER_MS)
      )
    );
  }
}
