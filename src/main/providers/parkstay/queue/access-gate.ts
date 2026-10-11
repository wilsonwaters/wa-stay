/**
 * `ParkStayAccessGate`: the DBCA virtual queue in front of ParkStay, as an SDK `AccessGate`.
 *
 * - **Session key.** The `sitequeuesession` cookie on `dbca.wa.gov.au` in the provider's
 *   session partition (every `/api/` answer sets it while the queue is on). Without one, the
 *   key of an unexpired session saved in the provider state is reused (so a restart keeps
 *   the queue position), else a new key is made; either way the cookie is set, so API calls
 *   and the queue agree.
 * - **`ensure()`** joins or refreshes the queue and resolves once the session is `active`.
 *   It is single-flight: concurrent callers share one polling loop (every 5 s while
 *   waiting). Each caller has its own `signal` and `maxWaitMs`; the loop stops, with its
 *   timers cleared, when no caller is left. A queue API failure is retried with backoff
 *   (2 s doubling to 30 s) until the caller's `maxWaitMs`, which then rejects with
 *   `AccessGateError` in the gate's state (`error` while the API is down). A session that
 *   ends within 120 s is refreshed rather than trusted.
 * - **`holdOpen()`** is ref-counted. While anything holds the gate open, a keep-alive
 *   refreshes the session every 20 s (the ParkStay page's own cadence while active); the
 *   last release stops it.
 * - **Idle again.** A session that ends while something holds the gate open or an `ensure`
 *   waits is `expired`. One that ends with neither means nothing uses the queue: the gate
 *   goes back to `idle` and tells its listeners, at the release or at the session's end.
 * - **Status** goes to `onStatus` listeners only (no EventEmitter, so no unhandled `error`
 *   event). A listener that throws is logged and the others still run.
 * - The saved session (`queue.session` in the provider state, the shape migration v8
 *   writes) is replaced after every check; an expired one is discarded when read.
 *
 * Nothing here logs the session key or a cookie.
 */

import type { AccessState, AccessStatus, ProviderId } from '@shared/types/provider.types';
import type { ProviderLogger } from '../../sdk/context';
import { AccessGateError, createAbortError, isAbortError, throwIfAborted } from '../../sdk/errors';
import type { CookieStore } from '../../sdk/http';
import type { KeyValueStore } from '../../sdk/kv-store';
import type { AccessGate, AccessGateEnsureOptions } from '../../sdk/provider';
import {
  PARKSTAY_BASE_URL,
  QUEUE_API_BASE_URL,
  QUEUE_COOKIE_DOMAIN,
  QUEUE_COOKIE_NAME,
} from '../constants';
import type { QueueApiResponse } from '../types';
import { generateSessionKey, type QueueApi } from './queue-api';

/** Where the queue session is saved in the provider state (agreed with V2's migration). */
export const QUEUE_SESSION_KEY = 'queue.session';

/** The saved queue session: the JSON migration v8 writes for the old `queue_session` row. */
export interface StoredQueueSession {
  sessionKey: string;
  status: string | null;
  position: number | null;
  estimatedWaitSeconds: number | null;
  expirySeconds: number | null;
  /** ISO instant. */
  expiresAt: string | null;
  /** ISO instant. */
  createdAt: string | null;
}

export interface AccessGateTimings {
  /** Between checks while waiting in the queue. */
  pollIntervalMs: number;
  /** Between keep-alive refreshes while held open. */
  keepAliveMs: number;
  /** A session ending sooner than this is refreshed, not trusted. */
  refreshBeforeExpiryMs: number;
  /** The first retry after a failed check; doubles each time. */
  retryBaseMs: number;
  retryMaxMs: number;
}

export const DEFAULT_ACCESS_GATE_TIMINGS: Readonly<AccessGateTimings> = Object.freeze({
  pollIntervalMs: 5_000,
  keepAliveMs: 20_000,
  refreshBeforeExpiryMs: 120_000,
  retryBaseMs: 2_000,
  retryMaxMs: 30_000,
});

export interface AccessGateDeps {
  providerId: ProviderId;
  api: QueueApi;
  /** The provider partition's cookies. */
  cookies: CookieStore;
  state: KeyValueStore;
  logger: ProviderLogger;
  clock: () => Date;
  timings?: Partial<AccessGateTimings>;
}

interface Session {
  key: string;
  expiresAt: number;
  createdAt: number;
}

interface Participant {
  resolve(status: AccessStatus): void;
  reject(error: unknown): void;
}

/** One shared polling loop and the callers waiting on it. */
interface Flight {
  controller: AbortController;
  participants: Set<Participant>;
}

const COOKIE_URL = `${PARKSTAY_BASE_URL}/`;

/** Epoch ms of an ISO instant, or of SQLite's `YYYY-MM-DD HH:MM:SS` (UTC); NaN otherwise. */
function parseInstant(value: string | null): number {
  if (!value) return NaN;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? Date.parse(`${value.replace(' ', 'T')}Z`)
    : Date.parse(value);
}

export class ParkStayAccessGate implements AccessGate {
  /** The DBCA waiting room's pages (`/site-queue/waiting-room/…`). */
  readonly waitingRoomOrigins: readonly string[] = [QUEUE_API_BASE_URL];
  private readonly timings: AccessGateTimings;
  private readonly listeners = new Set<(status: AccessStatus) => void>();
  private current: AccessStatus;
  private session?: Session;
  private flight?: Flight;
  private holds = 0;
  private keepAliveTimer?: ReturnType<typeof setTimeout>;
  private keepAliveRunning = false;
  /** While nothing uses the gate: fires when the active session ends, to go idle. */
  private idleTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(private readonly deps: AccessGateDeps) {
    this.timings = { ...DEFAULT_ACCESS_GATE_TIMINGS, ...deps.timings };
    this.current = this.make('idle');
  }

  status(): AccessStatus {
    const now = this.deps.clock().getTime();
    if (this.current.state === 'active' && this.session && this.session.expiresAt <= now) {
      if (this.isUnused()) return this.make('idle');
      return { ...this.current, state: 'expired', updatedAt: new Date(now).toISOString() };
    }
    return { ...this.current };
  }

  onStatus(listener: (status: AccessStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async ensure({ signal, maxWaitMs }: AccessGateEnsureOptions = {}): Promise<AccessStatus> {
    throwIfAborted(signal);
    if (this.disposed) throw new AccessGateError(this.deps.providerId, 'error', 'closing');
    if (this.isFresh()) return this.status();
    return this.join(this.flight ?? this.startFlight(), signal, maxWaitMs);
  }

  holdOpen(): () => void {
    this.holds++;
    if (this.holds === 1) {
      this.scheduleKeepAlive();
      this.watchForIdle();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds--;
      if (this.holds === 0) {
        this.stopKeepAlive();
        this.watchForIdle();
      }
    };
  }

  /** How many holders keep the gate open (for tests and diagnostics). */
  get holdCount(): number {
    return this.holds;
  }

  dispose(): void {
    this.disposed = true;
    this.holds = 0;
    this.stopKeepAlive();
    this.stopIdleTimer();
    const flight = this.flight;
    this.flight = undefined;
    if (flight) {
      const closing = new AccessGateError(this.deps.providerId, 'error', 'closing');
      for (const participant of flight.participants) participant.reject(closing);
      flight.participants.clear();
      flight.controller.abort();
    }
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------------------
  // ensure
  // -------------------------------------------------------------------------------------

  private isFresh(): boolean {
    return (
      this.current.state === 'active' &&
      this.session !== undefined &&
      this.session.expiresAt - this.deps.clock().getTime() > this.timings.refreshBeforeExpiryMs
    );
  }

  private startFlight(): Flight {
    const flight: Flight = { controller: new AbortController(), participants: new Set() };
    this.flight = flight;
    this.watchForIdle();
    this.run(flight.controller.signal).then(
      (status) => this.land(flight, (p) => p.resolve(status)),
      (error: unknown) => this.land(flight, (p) => p.reject(error))
    );
    return flight;
  }

  private land(flight: Flight, settle: (participant: Participant) => void): void {
    if (this.flight === flight) this.flight = undefined;
    this.watchForIdle();
    for (const participant of [...flight.participants]) settle(participant);
    flight.participants.clear();
  }

  /** Waits on `flight` until it lands, the caller aborts, or the caller's `maxWaitMs` passes. */
  private join(flight: Flight, signal?: AbortSignal, maxWaitMs?: number): Promise<AccessStatus> {
    return new Promise<AccessStatus>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const leave = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        flight.participants.delete(participant);
      };
      // The last caller to give up stops the loop and its timers.
      const giveUp = (error: unknown): void => {
        leave();
        if (flight.participants.size === 0 && this.flight === flight) {
          this.flight = undefined;
          flight.controller.abort();
          this.watchForIdle();
        }
        reject(error);
      };
      const participant: Participant = {
        resolve: (status) => {
          leave();
          resolve(status);
        },
        reject: (error) => {
          leave();
          reject(error);
        },
      };
      const onAbort = (): void => giveUp(createAbortError(signal));

      flight.participants.add(participant);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (maxWaitMs !== undefined) {
        timer = setTimeout(() => {
          const state: AccessState = this.current.state === 'waiting' ? 'waiting' : 'error';
          giveUp(
            new AccessGateError(
              this.deps.providerId,
              state,
              `${this.deps.providerId}: no access through the DBCA queue within ${Math.round(maxWaitMs / 1000)} s` +
                (this.current.message ? ` (${this.current.message})` : '')
            )
          );
        }, maxWaitMs);
      }
    });
  }

  /** Checks the queue until the session is active, retrying failures with backoff. */
  private async run(signal: AbortSignal): Promise<AccessStatus> {
    let failures = 0;
    for (;;) {
      let status: AccessStatus;
      try {
        status = await this.check(signal);
      } catch (error) {
        if (signal.aborted || isAbortError(error)) throw createAbortError(signal);
        failures++;
        this.failed(error, failures);
        await this.sleep(
          Math.min(this.timings.retryBaseMs * 2 ** (failures - 1), this.timings.retryMaxMs),
          signal
        );
        continue;
      }
      failures = 0;
      if (status.state === 'active') return status;
      await this.sleep(this.timings.pollIntervalMs, signal);
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) {
        reject(createAbortError(signal));
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(createAbortError(signal));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private failed(error: unknown, attempt: number): void {
    const reason = error instanceof Error ? error.message : String(error);
    this.deps.logger.warn(`DBCA queue check failed (attempt ${attempt}): ${reason}`);
    this.setStatus(this.make('error', { message: 'The DBCA queue could not be reached' }));
  }

  // -------------------------------------------------------------------------------------
  // keep-alive
  // -------------------------------------------------------------------------------------

  private scheduleKeepAlive(): void {
    if (this.disposed || this.holds === 0 || this.keepAliveTimer !== undefined) return;
    this.keepAliveTimer = setTimeout(() => {
      this.keepAliveTimer = undefined;
      void this.keepAlive();
    }, this.timings.keepAliveMs);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer !== undefined) clearTimeout(this.keepAliveTimer);
    this.keepAliveTimer = undefined;
  }

  /** One refresh, unless an `ensure` loop is already checking; then the next is armed. */
  private async keepAlive(): Promise<void> {
    if (this.holds === 0 || this.disposed) return;
    if (!this.flight && !this.keepAliveRunning) {
      this.keepAliveRunning = true;
      try {
        await this.check();
      } catch (error) {
        if (!isAbortError(error)) this.failed(error, 1);
      } finally {
        this.keepAliveRunning = false;
      }
    }
    this.scheduleKeepAlive();
    // The last hold may have been released while this refresh ran.
    this.watchForIdle();
  }

  // -------------------------------------------------------------------------------------
  // idle
  // -------------------------------------------------------------------------------------

  /** Nothing holds the gate open and no `ensure` is waiting. */
  private isUnused(): boolean {
    return this.holds === 0 && this.flight === undefined;
  }

  /**
   * While the gate is unused with an active session, waits for the session to end, then goes
   * `idle` (telling the listeners); otherwise stops waiting.
   */
  private watchForIdle(): void {
    this.stopIdleTimer();
    if (this.disposed || !this.isUnused() || this.current.state !== 'active' || !this.session) {
      return;
    }
    const left = this.session.expiresAt - this.deps.clock().getTime();
    if (left <= 0) {
      this.setStatus(this.make('idle'));
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      this.watchForIdle();
    }, left);
    // Only an announcement: it does not keep the process alive.
    this.idleTimer.unref?.();
  }

  private stopIdleTimer(): void {
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  // -------------------------------------------------------------------------------------
  // one check
  // -------------------------------------------------------------------------------------

  /** One `check-create-session`: updates the session, cookie, saved session and status. */
  private async check(signal?: AbortSignal): Promise<AccessStatus> {
    const key = await this.sessionKey();
    throwIfAborted(signal);
    const response = await this.deps.api.checkCreateSession(key, signal);
    if (this.disposed) throw createAbortError();
    const now = this.deps.clock().getTime();
    const expiresAt = now + Math.max(0, response.expiry_seconds || 0) * 1000;
    this.session = {
      key: response.session_key,
      expiresAt,
      createdAt: this.session?.key === response.session_key ? this.session.createdAt : now,
    };
    if (response.session_key !== key) await this.setCookie(response.session_key);
    await this.save(response, this.session);
    const status = this.toStatus(response, expiresAt);
    this.setStatus(status);
    if (status.state === 'error') {
      throw new AccessGateError(this.deps.providerId, 'error', status.message);
    }
    return status;
  }

  private toStatus(response: QueueApiResponse, expiresAt: number): AccessStatus {
    if (response.queue_full) {
      return this.make('waiting', {
        message: response.custom_message || 'The ParkStay queue is full',
      });
    }
    if (response.status === 'Active') {
      return this.make('active', { expiresAt: new Date(expiresAt).toISOString() });
    }
    if (response.status === 'Waiting') {
      return this.make('waiting', {
        ...(typeof response.queue_position === 'number'
          ? { position: response.queue_position }
          : {}),
        ...(Number.isFinite(response.wait_time) ? { etaSeconds: response.wait_time } : {}),
      });
    }
    return this.make('error', { message: 'The DBCA queue gave an unexpected status' });
  }

  private make(state: AccessState, extra: Partial<AccessStatus> = {}): AccessStatus {
    return {
      providerId: this.deps.providerId,
      state,
      ...extra,
      updatedAt: this.deps.clock().toISOString(),
    };
  }

  private setStatus(status: AccessStatus): void {
    const changed = status.state !== this.current.state;
    this.current = status;
    if (changed) {
      const where = status.position !== undefined ? ` (position ${status.position})` : '';
      this.deps.logger.info(`DBCA queue: ${status.state}${where}`);
    }
    for (const listener of [...this.listeners]) {
      try {
        listener({ ...status });
      } catch (error) {
        this.deps.logger.warn(
          'A DBCA queue status listener failed',
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  // -------------------------------------------------------------------------------------
  // session key and saved session
  // -------------------------------------------------------------------------------------

  /** The partition's `sitequeuesession`, else the saved session's key, else a new one. */
  private async sessionKey(): Promise<string> {
    const cookie = await this.deps.cookies.get(COOKIE_URL, QUEUE_COOKIE_NAME);
    if (cookie?.value) return cookie.value;
    const key = (await this.loadSaved())?.sessionKey ?? generateSessionKey();
    await this.setCookie(key);
    return key;
  }

  private async setCookie(value: string): Promise<void> {
    await this.deps.cookies.set({
      url: COOKIE_URL,
      name: QUEUE_COOKIE_NAME,
      value,
      domain: QUEUE_COOKIE_DOMAIN,
      path: '/',
    });
  }

  /** The saved session if it has not expired; an expired one is discarded. */
  private async loadSaved(): Promise<StoredQueueSession | undefined> {
    const saved = await this.deps.state.get<StoredQueueSession>(QUEUE_SESSION_KEY);
    if (!saved || typeof saved.sessionKey !== 'string' || !saved.sessionKey) return undefined;
    const expiresAt = parseInstant(saved.expiresAt);
    if (!(expiresAt > this.deps.clock().getTime())) {
      await this.deps.state.delete(QUEUE_SESSION_KEY);
      return undefined;
    }
    return saved;
  }

  private async save(response: QueueApiResponse, session: Session): Promise<void> {
    const saved: StoredQueueSession = {
      sessionKey: session.key,
      status: response.status ?? null,
      position: response.queue_position ?? null,
      estimatedWaitSeconds: Number.isFinite(response.wait_time) ? response.wait_time : null,
      expirySeconds: Number.isFinite(response.expiry_seconds) ? response.expiry_seconds : null,
      expiresAt: new Date(session.expiresAt).toISOString(),
      createdAt: new Date(session.createdAt).toISOString(),
    };
    try {
      await this.deps.state.set(QUEUE_SESSION_KEY, saved);
    } catch (error) {
      this.deps.logger.warn(
        'The DBCA queue session could not be saved',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
