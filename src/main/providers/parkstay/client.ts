/**
 * `ParkStayClient`: every request the ParkStay module sends goes through here, on the
 * provider's `ctx.http` (the `persist:provider-parkstay` session in the app), so the queue
 * cookie and any booking in progress live in that session.
 *
 * - **Concurrency.** At most `maxConcurrent` requests (the manifest's
 *   `limits.maxConcurrentRequests`, 4) are in flight at once, across the API and the queue.
 * - **Headers.** The Chrome user agent and the ParkStay `Referer` (`headers.ts`).
 * - **Dates.** ParkStay reads `YYYY/MM/DD` only (`serialisers.py:56-57`); `YYYY-MM-DD` is
 *   HTTP 500. `toParkStayDate` converts a calendar date.
 * - **The DBCA queue.** While the queue is on, an `/api/` request without an active queue
 *   session is answered with a 200 `text/html` page whose script sends the browser to the
 *   waiting room (`queue_middleware.py:99,116`), or a redirect there. Either one is an
 *   `AccessGateError` with state `waiting`, never a JSON parse error. ParkStay's pages
 *   (`getPage`) are gated the same way; their own scripts call `window.location.replace`
 *   too, so a page is the queue's only when the script goes to the waiting room.
 */

import type { ProviderId } from '@shared/types/provider.types';
import { createLimiter, type Limiter } from '../sdk/concurrency';
import {
  AccessGateError,
  createAbortError,
  ProviderHttpError,
  ProviderParseError,
  throwIfAborted,
} from '../sdk/errors';
import type { FormFields, HttpClient, HttpResponse, QueryValue } from '../sdk/http';
import { PARKSTAY_API_BASE_URL, QUEUE_API_BASE_URL } from './constants';
import { parkstayApiHeaders, parkstayPageHeaders, queueApiHeaders } from './headers';

/** Where the client sends requests. Tests point both at a local fixture server. */
export interface ParkStayEndpoints {
  /** `https://parkstay.dbca.wa.gov.au/api` */
  apiBaseUrl: string;
  /** `https://queue.dbca.wa.gov.au` */
  queueBaseUrl: string;
}

export const PARKSTAY_ENDPOINTS: Readonly<ParkStayEndpoints> = Object.freeze({
  apiBaseUrl: PARKSTAY_API_BASE_URL,
  queueBaseUrl: QUEUE_API_BASE_URL,
});

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `2026-11-10` → `2026/11/10`. A string transform only: no `Date`, so no time-zone shift. */
export function toParkStayDate(date: string): string {
  if (!CALENDAR_DATE.test(date)) {
    throw new RangeError(`Not a calendar date (YYYY-MM-DD): "${date}"`);
  }
  return date.replace(/-/g, '/');
}

/** The queue middleware's redirect page: `<script>window.location.replace('…');</script>`. */
export function isQueueInterstitial(contentType: string | null, body: string): boolean {
  return /text\/html/i.test(contentType ?? '') && body.includes('window.location.replace(');
}

/** The queue's redirect page for a ParkStay page: its script goes to the waiting room. */
export function isWaitingRoomPage(contentType: string | null, body: string): boolean {
  return (
    /text\/html/i.test(contentType ?? '') &&
    /window\.location\.replace\(\s*(['"`])[^'"`]*waiting-room/i.test(body)
  );
}

/** A ParkStay page as it came back, after any redirects. */
export interface PageResponse {
  status: number;
  /** The final URL, after any redirects. */
  url: string;
  contentType: string | null;
  body: string;
}

export interface ParkStayRequestOptions {
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

export interface FormResponse {
  status: number;
  /** The parsed JSON body (2xx or 4xx). */
  body: unknown;
}

/** Settles with `pending`, or rejects with an AbortError as soon as `signal` aborts. */
function raceAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(createAbortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(createAbortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
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

function withoutQuery(url: string): string {
  const at = url.search(/[?#]/);
  return at < 0 ? url : url.slice(0, at);
}

export class ParkStayClient {
  private readonly limit: Limiter;
  private readonly apiBase: string;
  private readonly siteOrigin: string;
  private readonly queueOrigin: string;

  constructor(
    private readonly http: HttpClient,
    private readonly providerId: ProviderId,
    endpoints: ParkStayEndpoints = PARKSTAY_ENDPOINTS,
    maxConcurrent = 4
  ) {
    this.limit = createLimiter(maxConcurrent);
    this.apiBase = endpoints.apiBaseUrl.replace(/\/+$/, '');
    // The site and its API share an origin (`https://parkstay.dbca.wa.gov.au`).
    this.siteOrigin = new URL(this.apiBase).origin;
    this.queueOrigin = new URL(endpoints.queueBaseUrl).origin;
  }

  /** Requests running now (at most `maxConcurrent`). */
  get activeCount(): number {
    return this.limit.activeCount;
  }

  /** Requests waiting for a slot. */
  get pendingCount(): number {
    return this.limit.pendingCount;
  }

  /** GET an API path (`/campground_map/`), expecting 2xx JSON. */
  async getApi<T>(path: string, options: ParkStayRequestOptions = {}): Promise<T> {
    const url = `${this.apiBase}${path}`;
    const response = await this.send(options.signal, () =>
      this.http.request('GET', url, {
        query: options.query,
        headers: parkstayApiHeaders('GET'),
        signal: options.signal,
      })
    );
    const body = await this.readApiBody(url, response);
    if (!response.ok) throw this.statusError(response);
    return this.parseJson<T>(response, body);
  }

  /**
   * POSTs a form to an API path. Resolves with the JSON body of a 2xx or 4xx answer
   * (`create_booking` explains a refusal in a 400 JSON body); anything else rejects, and so
   * do 408 and 429 (a timeout or a rate limit is not a refusal, whatever the body says).
   */
  async postApiForm(
    path: string,
    form: FormFields,
    options: ParkStayRequestOptions = {}
  ): Promise<FormResponse> {
    const url = `${this.apiBase}${path}`;
    const response = await this.send(options.signal, () =>
      this.http.request('POST', url, {
        headers: {
          ...parkstayApiHeaders('POST'),
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: form instanceof URLSearchParams ? form : formBody(form),
        signal: options.signal,
      })
    );
    const body = await this.readApiBody(url, response);
    const refusal = response.status >= 400 && response.status < 500;
    if (refusal && response.status !== 408 && response.status !== 429) {
      try {
        return { status: response.status, body: JSON.parse(body) as unknown };
      } catch {
        throw this.statusError(response);
      }
    }
    if (!response.ok) throw this.statusError(response);
    return { status: response.status, body: await this.parseJson(response, body) };
  }

  /**
   * GET a ParkStay page (`/search-availability/campground/`) with the ParkStay `Referer`,
   * following redirects. Rejects with an `AccessGateError` when the DBCA queue answers
   * instead, and a `ProviderHttpError` for a status that is not 2xx.
   */
  async getPage(path: string, options: ParkStayRequestOptions = {}): Promise<PageResponse> {
    const url = `${this.siteOrigin}${path}`;
    const response = await this.send(options.signal, () =>
      this.http.request('GET', url, {
        query: options.query,
        headers: parkstayPageHeaders(),
        signal: options.signal,
      })
    );
    if (this.isQueueUrl(response.url, url)) {
      throw new AccessGateError(
        this.providerId,
        'waiting',
        `${this.providerId}: ParkStay sent the page request to the DBCA queue`
      );
    }
    const body = await response.text();
    const contentType = response.headers.get('content-type');
    if (isWaitingRoomPage(contentType, body)) {
      throw new AccessGateError(
        this.providerId,
        'waiting',
        `${this.providerId}: ParkStay answered the page request with the DBCA queue page`
      );
    }
    if (!response.ok) throw this.statusError(response);
    return { status: response.status, url: response.url, contentType, body };
  }

  /** GET a queue API path (`/api/check-create-session/`), expecting 2xx JSON. */
  async getQueue<T>(path: string, options: ParkStayRequestOptions = {}): Promise<T> {
    const url = `${this.queueOrigin}${path}`;
    const response = await this.send(options.signal, () =>
      this.http.request('GET', url, {
        query: options.query,
        headers: queueApiHeaders(),
        signal: options.signal,
      })
    );
    const body = await response.text();
    if (!response.ok) throw this.statusError(response);
    return this.parseJson<T>(response, body);
  }

  /** Runs `request` in a free slot. A caller that aborts while waiting for one is released at once. */
  private send(
    signal: AbortSignal | undefined,
    request: () => Promise<HttpResponse>
  ): Promise<HttpResponse> {
    throwIfAborted(signal);
    return raceAbort(
      this.limit(() => {
        throwIfAborted(signal);
        return request();
      }),
      signal
    );
  }

  /** The body of an API response, unless the DBCA queue answered instead. */
  private async readApiBody(requestUrl: string, response: HttpResponse): Promise<string> {
    if (this.isQueueUrl(response.url, requestUrl)) {
      throw new AccessGateError(
        this.providerId,
        'waiting',
        `${this.providerId}: ParkStay sent the request to the DBCA queue`
      );
    }
    const body = await response.text();
    if (isQueueInterstitial(response.headers.get('content-type'), body)) {
      throw new AccessGateError(
        this.providerId,
        'waiting',
        `${this.providerId}: ParkStay answered with the DBCA queue page`
      );
    }
    return body;
  }

  /** True when a redirect took the request to the queue site or its waiting room. */
  private isQueueUrl(finalUrl: string, requestUrl: string): boolean {
    if (!finalUrl || withoutQuery(finalUrl) === withoutQuery(requestUrl)) return false;
    try {
      const url = new URL(finalUrl);
      // The queue's own origin counts only when it is not the site's (tests serve both).
      const queueSite = url.origin === this.queueOrigin && this.queueOrigin !== this.siteOrigin;
      return queueSite || url.pathname.startsWith('/site-queue/');
    } catch {
      return false;
    }
  }

  private statusError(response: HttpResponse): ProviderHttpError {
    const hint =
      response.status === 500
        ? ' (ParkStay rejected the request: it needs dates as YYYY/MM/DD and the ParkStay Referer)'
        : '';
    return new ProviderHttpError({
      providerId: this.providerId,
      status: response.status,
      url: response.url,
      message: `${this.providerId}: HTTP ${response.status} from ${withoutQuery(response.url)}${hint}`,
    });
  }

  private parseJson<T>(response: HttpResponse, body: string): T {
    try {
      return JSON.parse(body) as T;
    } catch (error) {
      const type = response.headers.get('content-type') ?? 'no content type';
      throw new ProviderParseError({
        providerId: this.providerId,
        url: withoutQuery(response.url),
        message: `${this.providerId}: expected JSON from ${withoutQuery(response.url)} but got ${type}`,
        cause: error,
      });
    }
  }
}

function formBody(form: Record<string, QueryValue>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(form)) {
    if (value === null || value === undefined) continue;
    params.append(name, String(value));
  }
  return params;
}
