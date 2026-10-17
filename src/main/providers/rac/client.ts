/**
 * `RacClient`: every request the RAC module sends goes through here, on the provider's
 * `ctx.http` (the `persist:provider-rac` session in the app, paced by the core: one request at
 * a time, 10 s apart in the background).
 *
 * - **One host.** Only `https://parksandresorts.rac.com.au` is asked. Redirects are followed
 *   here, by hand, on that host only, at most `RAC_MAX_REDIRECTS`. Any other address, first or
 *   by redirect, is a `ProviderHttpError` (`blocked`) and is never sent (terms rule 1). NewBook's
 *   hosts are never asked, and the NewBook key RAC's answers echo is never used.
 * - **One at a time.** A request, redirects included, waits for the one before it to end
 *   (`limits.maxConcurrentRequests`, 1; terms rule 4).
 * - **Headers.** A page asks for `text/html`. `postAjax` (for the availability endpoint) sends
 *   what RAC's own page sends: `X-Requested-With: XMLHttpRequest`, `Origin` and the park's
 *   book-now page as `Referer`. The User-Agent is never set or changed (terms rule 5).
 * - **A block** is a 403 or a 429, a `cf-mitigated: challenge` header, or a 503 or 200 page
 *   with Cloudflare's challenge in it ("Just a moment…" as its title, or `cf_chl_opt`). The bot
 *   detection script ordinary pages load (`/cdn-cgi/challenge-platform/scripts/jsd/main.js`) is
 *   not one. A block rejects with a non-retryable `ProviderHttpError` whose status is 429 for a
 *   429 and 403 for anything else, with a plain message ("RAC Parks & Resorts turned the request
 *   away (HTTP 429). WA Stay won't ask again until 3:45 pm."), and logs one warning with the
 *   status only. For the cool-down after it, every request rejects at once with the same error
 *   and sends nothing. Nothing is retried, and no challenge is ever answered (terms rule 5).
 * - **The cool-down** is `RAC_BLOCK_COOLDOWN_MS` (30 minutes) after a first block, and doubles
 *   with each block that follows it with no successful answer between them (1 hour, 2 hours…),
 *   up to `RAC_MAX_BLOCK_COOLDOWN_MS` (a day), so a block that persists costs a few requests a
 *   day, not one every 30 minutes. A `Retry-After` asking for longer is honoured, up to a day.
 *   A 2xx answer ends the run of blocks, and so does a day with no block. The cool-down is kept
 *   in the provider's state, so a restart honours it; an end further ahead than its own length
 *   (the clock was set back) counts as that length from now. A message whose end is on another
 *   day in Perth names the day ("until 9:15 am on Sun 18 Oct").
 * - **Other failures.** Any other non-2xx answer is a `ProviderHttpError` with its status:
 *   retryable for a 5xx (a 520 included), with no cool-down. The core never retries in a loop.
 */

import type { ProviderId } from '@shared/types/provider.types';
import { createLimiter, type Limiter } from '../sdk/concurrency';
import type { ProviderLogger } from '../sdk/context';
import { createAbortError, ProviderHttpError, throwIfAborted } from '../sdk/errors';
import type { FormFields, HttpClient, HttpMethod, HttpResponse, QueryValue } from '../sdk/http';
import type { KeyValueStore } from '../sdk/kv-store';

/** RAC Parks & Resorts' site: the only host the module asks. */
export const RAC_SITE_URL = 'https://parksandresorts.rac.com.au';

/** The most redirects one request follows. */
export const RAC_MAX_REDIRECTS = 3;

/** How long every request is refused after a first block. */
export const RAC_BLOCK_COOLDOWN_MS = 30 * 60_000;

/** The longest cool-down: for blocks in a row, or a `Retry-After` asking for longer. A day. */
export const RAC_MAX_BLOCK_COOLDOWN_MS = 24 * 60 * 60_000;

/** Where the end of a cool-down is kept in the provider's state. */
export const RAC_BLOCK_STATE_KEY = 'client.blockedUntil';

const RAC_ORIGIN = new URL(RAC_SITE_URL).origin;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** A page (or an AJAX answer) as it came back, after any redirects. */
export interface RacPage {
  status: number;
  /** The final URL, after any redirects. */
  url: string;
  contentType: string | null;
  body: string;
}

export interface RacRequestOptions {
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

export interface RacAjaxOptions {
  /** The park's book-now page, sent as the `Referer`, as RAC's own page does. */
  referer: string;
  signal?: AbortSignal;
  /** Called once the POST is sent (`HttpRequestOptions.onSend`), not while it waits its turn. */
  onSend?: () => void;
}

export interface RacClientDeps {
  providerId: ProviderId;
  /** For messages: "RAC Parks & Resorts turned the request away…". */
  providerName: string;
  http: HttpClient;
  state: KeyValueStore;
  logger: ProviderLogger;
  clock: () => Date;
  /** The time zone the block message gives its time in (Perth). */
  timezone: string;
  /** `limits.maxConcurrentRequests`. */
  maxConcurrent: number;
}

/** What turned a request away: a status (403, 429) or Cloudflare's challenge. */
type BlockCause = 'status' | 'challenge';

/** A cool-down, as kept in the provider's state. */
interface StoredBlock {
  /** ISO timestamp. */
  until: string;
  status: 403 | 429;
  cause: BlockCause;
  /** How long the cool-down is, in ms. Absent (a block kept before it was stored): 30 minutes. */
  durationMs?: number;
  /** Blocks in a row, this one included, with no successful answer between. Absent: 1. */
  strikes?: number;
}

function isStoredBlock(value: unknown): value is StoredBlock {
  if (typeof value !== 'object' || value === null) return false;
  const { until, status, cause, durationMs, strikes } = value as Partial<StoredBlock>;
  return (
    typeof until === 'string' &&
    !Number.isNaN(Date.parse(until)) &&
    (status === 403 || status === 429) &&
    (cause === 'status' || cause === 'challenge') &&
    (durationMs === undefined ||
      (Number.isFinite(durationMs) && durationMs > 0 && durationMs <= RAC_MAX_BLOCK_COOLDOWN_MS)) &&
    (strikes === undefined || (Number.isInteger(strikes) && strikes >= 1))
  );
}

/**
 * How long a `Retry-After` header asks to wait, in ms: its seconds, or the time to its date.
 * Undefined when there is none or it cannot be read.
 */
export function retryAfterMs(value: string | null, now: number): number | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (/^\d+$/.test(text)) return Number(text) * 1_000;
  // An HTTP date names its day and month ("Sat, 17 Oct 2026 07:45:00 GMT")
  const at = /[a-z]/i.test(text) ? Date.parse(text) : Number.NaN;
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** "30 minutes", "1 hour", "24 hours", for the log. */
function describeDuration(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 120 && minutes % 60 !== 0) return `${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

function withoutQuery(url: string): string {
  const at = url.search(/[?#]/);
  return at < 0 ? url : url.slice(0, at);
}

/**
 * Settles with `pending`, or rejects with an AbortError as soon as `signal` aborts (`pending`
 * still settles, handled, and sends nothing once it sees the abort).
 */
function raceAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(createAbortError(signal));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

/** Cloudflare's challenge page: "Just a moment…" as its title, or its `cf_chl_opt` settings. */
export function isChallengePage(body: string): boolean {
  return /<title>\s*Just a moment/i.test(body) || body.includes('cf_chl_opt');
}

export class RacClient {
  private readonly limit: Limiter;
  private readonly timeFormat: Intl.DateTimeFormat;
  private readonly dayFormat: Intl.DateTimeFormat;

  constructor(private readonly deps: RacClientDeps) {
    this.limit = createLimiter(deps.maxConcurrent);
    this.timeFormat = new Intl.DateTimeFormat('en-AU', {
      timeZone: deps.timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    this.dayFormat = new Intl.DateTimeFormat('en-AU', {
      timeZone: deps.timezone,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  /** GET a page of RAC's site (`/busselton/book-now/`), expecting 2xx HTML. */
  getPage(path: string, options: RacRequestOptions = {}): Promise<RacPage> {
    return this.send('GET', path, {
      query: options.query,
      signal: options.signal,
      headers: { Accept: 'text/html' },
    });
  }

  /**
   * POST a form to one of RAC's AJAX endpoints (the availability endpoint) as RAC's own page
   * does, expecting a 2xx answer.
   */
  postAjax(path: string, form: FormFields, options: RacAjaxOptions): Promise<RacPage> {
    const body =
      form instanceof URLSearchParams
        ? form
        : new URLSearchParams(
            Object.entries(form)
              .filter(([, value]) => value !== null && value !== undefined)
              .map(([name, value]): [string, string] => [name, String(value)])
          );
    return this.send('POST', path, {
      signal: options.signal,
      onSend: options.onSend,
      body: body.toString(),
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: RAC_ORIGIN,
        Referer: options.referer,
      },
    });
  }

  private async send(
    method: HttpMethod,
    path: string,
    request: {
      query?: Record<string, QueryValue>;
      signal?: AbortSignal;
      /** Called when the first hop is sent; a redirect is the same request. */
      onSend?: () => void;
      headers: Record<string, string>;
      body?: string;
    }
  ): Promise<RacPage> {
    const { signal } = request;
    throwIfAborted(signal);
    const url = this.racUrl(path);
    const queued = this.limit(async () => {
      throwIfAborted(signal);
      const block = await this.currentBlock();
      if (block) throw this.blockError(url, block);
      throwIfAborted(signal);

      let target = url;
      let currentMethod = method;
      let body = request.body;
      let headers = request.headers;
      let query = request.query;
      for (let hop = 0; ; hop++) {
        const response = await this.deps.http.request(currentMethod, target, {
          query,
          headers,
          body,
          signal,
          redirect: 'manual',
          ...(hop === 0 && request.onSend ? { onSend: request.onSend } : {}),
        });
        const location = response.headers.get('location');
        if (!REDIRECT_STATUSES.has(response.status) || location === null) {
          return this.read(response);
        }
        if (hop >= RAC_MAX_REDIRECTS) {
          throw new ProviderHttpError({
            providerId: this.deps.providerId,
            status: response.status,
            url: withoutQuery(response.url),
            reason: 'redirect-limit',
            message: `${this.deps.providerName}: more than ${RAC_MAX_REDIRECTS} redirects`,
          });
        }
        target = this.racUrl(location, response.url);
        // The query is in the URL the redirect gives.
        query = undefined;
        if (
          (response.status === 303 && currentMethod !== 'HEAD') ||
          (response.status <= 302 && currentMethod === 'POST')
        ) {
          currentMethod = 'GET';
          body = undefined;
          headers = Object.fromEntries(
            Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'content-type')
          );
        }
      }
    });
    // A caller that gives up while its request waits for the one before it hears so at once.
    return raceAbort(queued, signal);
  }

  /** `path` (or a redirect's `Location`) as an absolute URL on RAC's host, or a blocked error. */
  private racUrl(path: string, base = RAC_SITE_URL): string {
    let url: URL | undefined;
    try {
      url = new URL(path, base);
    } catch {
      url = undefined;
    }
    if (!url || url.protocol !== 'https:' || url.origin !== RAC_ORIGIN) {
      const where = url ? `${url.protocol}//${url.host}` : 'an address that is not a URL';
      throw new ProviderHttpError({
        providerId: this.deps.providerId,
        status: 0,
        url: url ? withoutQuery(url.href) : '',
        reason: 'blocked',
        message: `${this.deps.providerName}: WA Stay asks only ${RAC_ORIGIN}, not ${where}`,
      });
    }
    return url.href;
  }

  /** The final answer: a page, a block (which starts the cool-down) or a status error. */
  private async read(response: HttpResponse): Promise<RacPage> {
    const body = await response.text();
    const contentType = response.headers.get('content-type');
    const challenged =
      response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge' ||
      ((response.status === 200 || response.status === 503) && isChallengePage(body));
    if (challenged || response.status === 403 || response.status === 429) {
      const block = await this.startBlock(
        response.status === 429 ? 429 : 403,
        challenged ? 'challenge' : 'status',
        retryAfterMs(response.headers.get('retry-after'), this.deps.clock().getTime())
      );
      throw this.blockError(response.url, block);
    }
    // An answer: the run of blocks, if any, is over.
    if (response.ok && (await this.deps.state.get(RAC_BLOCK_STATE_KEY)) !== undefined) {
      await this.deps.state.delete(RAC_BLOCK_STATE_KEY);
    }
    if (!response.ok) {
      throw new ProviderHttpError({
        providerId: this.deps.providerId,
        status: response.status,
        url: withoutQuery(response.url),
      });
    }
    return { status: response.status, url: response.url, contentType, body };
  }

  /**
   * The cool-down in force now, if any. One that ends further from now than its own length (the
   * clock was set back) is cut to that length from now, and kept so.
   */
  private async currentBlock(): Promise<StoredBlock | undefined> {
    const stored = await this.deps.state.get<unknown>(RAC_BLOCK_STATE_KEY);
    if (!isStoredBlock(stored)) return undefined;
    const now = this.deps.clock().getTime();
    const until = Date.parse(stored.until);
    if (until <= now) return undefined;
    const length = stored.durationMs ?? RAC_BLOCK_COOLDOWN_MS;
    if (until <= now + length) return stored;
    const cut: StoredBlock = { ...stored, until: new Date(now + length).toISOString() };
    await this.deps.state.set(RAC_BLOCK_STATE_KEY, cut);
    return cut;
  }

  /**
   * Starts a cool-down: 30 minutes, doubled for each block before it in a row (one whose
   * cool-down ended less than a day ago, with no successful answer since), or what
   * `Retry-After` asked when that is longer; never more than a day.
   */
  private async startBlock(
    status: 403 | 429,
    cause: BlockCause,
    retryAfter: number | undefined
  ): Promise<StoredBlock> {
    const now = this.deps.clock().getTime();
    const previous = await this.deps.state.get<unknown>(RAC_BLOCK_STATE_KEY);
    const inARow =
      isStoredBlock(previous) && Date.parse(previous.until) > now - RAC_MAX_BLOCK_COOLDOWN_MS;
    const strikes = inARow ? (previous.strikes ?? 1) + 1 : 1;
    const doubled = RAC_BLOCK_COOLDOWN_MS * 2 ** Math.min(strikes - 1, 16);
    const durationMs = Math.min(Math.max(doubled, retryAfter ?? 0), RAC_MAX_BLOCK_COOLDOWN_MS);
    const block: StoredBlock = {
      until: new Date(now + durationMs).toISOString(),
      status,
      cause,
      durationMs,
      strikes,
    };
    await this.deps.state.set(RAC_BLOCK_STATE_KEY, block);
    // The status only: never the address's query or the answer.
    const pause = describeDuration(durationMs);
    this.deps.logger.warn(
      cause === 'challenge'
        ? `Turned away by a security check (HTTP ${status}); no requests for ${pause}`
        : `Turned away (HTTP ${status}); no requests for ${pause}`
    );
    return block;
  }

  /** "3:45 pm", or "9:15 am on Sun 18 Oct" for a longer cool-down ending on another day. */
  private endOf(block: StoredBlock): string {
    const end = new Date(block.until);
    const time = this.timeFormat.format(end);
    const longer = (block.durationMs ?? RAC_BLOCK_COOLDOWN_MS) > RAC_BLOCK_COOLDOWN_MS;
    const day = this.dayFormat.format(end);
    if (!longer || day === this.dayFormat.format(this.deps.clock())) return time;
    return `${time} on ${day.replace(',', '')}`;
  }

  private blockError(url: string, block: StoredBlock): ProviderHttpError {
    const why = block.cause === 'challenge' ? 'a security check' : `HTTP ${block.status}`;
    const until = this.endOf(block);
    return new ProviderHttpError({
      providerId: this.deps.providerId,
      status: block.status,
      url: withoutQuery(url),
      reason: 'status',
      retryable: false,
      message:
        `${this.deps.providerName} turned the request away (${why}). ` +
        `WA Stay won't ask again until ${until}.`,
    });
  }
}
