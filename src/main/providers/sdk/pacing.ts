/**
 * Polite request pacing: the core's wrapper around a provider's `ctx.http` when its manifest
 * sets `limits.minRequestIntervalMs`, for sites whose terms ask for a gap between automated
 * requests. `createProviderContext` applies it; providers never build one.
 *
 * - **One in flight.** The provider's requests go one at a time, through one queue: the
 *   clients `withDefaults` returns share it, and `registry.httpOf` hands out the same client,
 *   so the account check waits its turn too.
 * - **Gaps.** A request starts only once the gap since the previous request ended has
 *   passed: `intervalMs` for a background request, `INTERACTIVE_REQUEST_GAP_MS` (never more
 *   than `intervalMs`) for an interactive one. A request ends when its response has been read
 *   or it failed (no response, an HTTP error, a timeout, an abort); a redirect chain is one
 *   request. The gap is measured on a monotonic clock (`performance.now()`), never `Date`, so
 *   a clock set back cannot shorten it, and after a sleep it may be longer, never shorter.
 * - **Order.** Interactive requests start before waiting background ones, and each class
 *   keeps the order it was asked in. Steady interactive traffic therefore delays background
 *   work.
 * - **Waiting.** A request's `timeoutMs` counts from when it is sent, not while it waits. A
 *   caller's abort takes a waiting request out of the queue at once, with an `AbortError`,
 *   and uses no turn.
 * - **Priority.** The request's `priority` option, else the ambient priority when `request`,
 *   `getJson` or `postForm` is called: `withRequestPriority(priority, fn)` sets it for `fn`
 *   and everything `fn` starts, and `currentRequestPriority()` reads it (`background`
 *   outside any scope). The core sets it where it knows the person is waiting (a place page,
 *   Explore's dates, "Check now"), so a provider needs no change to its modules. Like any
 *   async context, it carries into the timers and promises a call starts, so work a module
 *   starts during a call and keeps running (a keep-alive) asks at that call's priority unless
 *   it passes `priority` itself.
 *
 * Nothing here retries or reads a provider's answers. Fixture mode is never paced.
 */

import { AsyncLocalStorage } from 'async_hooks';
import type { ProviderId } from '@shared/types/provider.types';
import { createAbortError } from './errors';
import type {
  FormFields,
  HttpClient,
  HttpMethod,
  HttpRequestOptions,
  HttpResponse,
  RequestPriority,
} from './http';

/** The gap before an interactive request on a paced client (at most the provider's own). */
export const INTERACTIVE_REQUEST_GAP_MS = 1_000;

/** The gap before a request at `priority` on a client paced at `intervalMs`. */
export function pacedGapMs(intervalMs: number, priority: RequestPriority): number {
  return priority === 'interactive' ? Math.min(INTERACTIVE_REQUEST_GAP_MS, intervalMs) : intervalMs;
}

const ambientPriority = new AsyncLocalStorage<RequestPriority>();

/**
 * Runs `fn` with `priority` as the ambient request priority, for `fn` and everything it
 * starts (its awaits, promises and timers). An inner scope wins over an outer one.
 */
export function withRequestPriority<T>(priority: RequestPriority, fn: () => T): T {
  return ambientPriority.run(priority, fn);
}

/** The ambient request priority: the innermost `withRequestPriority`, else `background`. */
export function currentRequestPriority(): RequestPriority {
  return ambientPriority.getStore() ?? 'background';
}

export interface PacedHttpClientOptions {
  /** The background gap in ms, from the end of one request to the start of the next; above 0. */
  intervalMs: number;
}

/** The monotonic clock gaps are measured on (ms), so a wall clock set back cannot shorten one. */
const monotonicNow = (): number => performance.now();

interface Waiting {
  readonly priority: RequestPriority;
  start(): void;
}

/** One provider's queue: one request in flight, each after its gap. */
class PacingQueue {
  private busy = false;
  /** When the last request ended (`monotonicNow()`); undefined before the first. */
  private lastEnd?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly waiting: Record<RequestPriority, Waiting[]> = {
    interactive: [],
    background: [],
  };

  constructor(private readonly intervalMs: number) {}

  /** Runs `send` on its turn. Rejects with an `AbortError` if `signal` fires while waiting. */
  run<T>(
    priority: RequestPriority,
    signal: AbortSignal | undefined,
    send: () => Promise<T>
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(createAbortError(signal));
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        const queue = this.waiting[priority];
        const at = queue.indexOf(entry);
        if (at >= 0) queue.splice(at, 1);
        reject(createAbortError(signal));
        this.pump();
      };
      const entry: Waiting = {
        priority,
        start: () => {
          signal?.removeEventListener('abort', onAbort);
          this.busy = true;
          let sent: Promise<T>;
          try {
            sent = send();
          } catch (error) {
            sent = Promise.reject(error);
          }
          sent.then(
            (value) => {
              this.finish();
              resolve(value);
            },
            (error: unknown) => {
              this.finish();
              reject(error);
            }
          );
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting[priority].push(entry);
      this.pump();
    });
  }

  /** The request in flight ended, however it ended: its gap starts now. */
  private finish(): void {
    this.busy = false;
    this.lastEnd = monotonicNow();
    this.pump();
  }

  /** Starts the next request if its gap has passed, or waits for it. */
  private pump(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.busy) return;
    const next = this.waiting.interactive[0] ?? this.waiting.background[0];
    if (!next) return;
    const wait =
      this.lastEnd === undefined
        ? 0
        : this.lastEnd + pacedGapMs(this.intervalMs, next.priority) - monotonicNow();
    if (wait > 0) {
      this.timer = setTimeout(() => this.pump(), Math.ceil(wait));
      return;
    }
    this.waiting[next.priority].shift();
    next.start();
  }
}

/** `inner`, one request at a time through `queue`. */
class PacedHttpClient implements HttpClient {
  constructor(
    private readonly inner: HttpClient,
    private readonly queue: PacingQueue
  ) {}

  get providerId(): ProviderId {
    return this.inner.providerId;
  }

  get cookies(): HttpClient['cookies'] {
    return this.inner.cookies;
  }

  request(
    method: HttpMethod,
    url: string,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse> {
    const priority = options.priority ?? currentRequestPriority();
    return this.queue.run(priority, options.signal, () =>
      this.inner.request(method, url, { ...options, priority })
    );
  }

  getJson<T = unknown>(url: string, options: Omit<HttpRequestOptions, 'body'> = {}): Promise<T> {
    const priority = options.priority ?? currentRequestPriority();
    return this.queue.run(priority, options.signal, () =>
      this.inner.getJson<T>(url, { ...options, priority })
    );
  }

  postForm<T = unknown>(
    url: string,
    form: FormFields,
    options: Omit<HttpRequestOptions, 'body'> = {}
  ): Promise<T> {
    const priority = options.priority ?? currentRequestPriority();
    return this.queue.run(priority, options.signal, () =>
      this.inner.postForm<T>(url, form, { ...options, priority })
    );
  }

  withDefaults(defaults: { headers?: Record<string, string> }): HttpClient {
    return new PacedHttpClient(this.inner.withDefaults(defaults), this.queue);
  }
}

/**
 * `inner` paced: one request in flight, each starting `intervalMs` (background) or
 * `INTERACTIVE_REQUEST_GAP_MS` (interactive) after the previous one ended. Its `cookies` are
 * the inner client's, and every client its `withDefaults` returns shares its queue.
 */
export function createPacedHttpClient(
  inner: HttpClient,
  { intervalMs }: PacedHttpClientOptions
): HttpClient {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError(`A paced client needs an interval above 0 ms, got ${intervalMs}`);
  }
  return new PacedHttpClient(inner, new PacingQueue(intervalMs));
}
