/**
 * `HttpClient`: how provider code talks to the network (architecture-notes §3).
 *
 * Two implementations share `BaseHttpClient`:
 * - `ElectronSessionHttpClient` (`http-electron.ts`, production): Chromium's network stack on
 *   the provider's session partition `persist:provider-<id>`, so cookies are shared with the
 *   provider's sign-in and payment windows.
 * - `NodeHttpClient` (`http-node.ts`, tests): Node's `fetch` with an in-memory cookie jar.
 *
 * Provider code never imports `electron` or an HTTP library; it only sees this interface.
 *
 * Both transports only send single hops; `BaseHttpClient` owns everything else, so the two
 * behave the same (architecture-notes §12.30):
 * - **Cookies** come only from `cookies`, the client's cookie store, and are stored and sent
 *   on every hop. A `Cookie` header the caller sets is ignored, as Chromium ignores it.
 * - **Redirects.** `follow` (the default) follows at most `MAX_REDIRECTS` hops and reports
 *   the final URL; a 303, or a 301/302 after a POST, becomes a GET without a body; an
 *   `Authorization` header the caller set is dropped once a hop changes origin. `manual`
 *   returns the 3xx itself, with an empty body. `error` rejects on any redirect.
 * - **URLs.** Only `https:` is allowed, plus `http:` to a loopback host (`127.0.0.1`,
 *   `localhost`, `::1`) for tests. Anything else, on the first hop or a redirect, is a
 *   non-retryable `ProviderHttpError` (`reason: 'blocked'`) and is never sent.
 * - **Timeouts and aborts.** Every request has a timeout (default 30 s) and honours the
 *   caller's `AbortSignal`; whichever fires first wins, and the timer is always cleared. A
 *   timeout rejects with `ProviderTimeoutError`, a caller abort with an `AbortError`. The
 *   body is read before the request settles, so the timeout covers it too.
 * - **Failures.** No response at all is a `ProviderHttpError` with status 0, classified by
 *   the transport's error code (`net-errors.ts`): only genuine network failures retry.
 */

import type { ProviderId } from '@shared/types/provider.types';
import {
  createAbortError,
  ProviderError,
  ProviderHttpError,
  ProviderParseError,
  ProviderTimeoutError,
} from './errors';
import { classifyTransportError } from './net-errors';

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type QueryValue = string | number | boolean | null | undefined;

export interface HttpRequestOptions {
  /** Appended to the URL's search params; `null`/`undefined` values are skipped. */
  query?: Record<string, QueryValue>;
  /** A `Cookie` header is ignored: set cookies through `HttpClient.cookies`. */
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  /** Default 30 000. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Default `follow` (at most `MAX_REDIRECTS` hops). `manual` returns a 3xx with an empty body. */
  redirect?: 'follow' | 'manual' | 'error';
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  /** The final URL, after any redirects. */
  url: string;
  headers: Headers;
  text(): Promise<string>;
  /** Parses the body; a body that is not JSON rejects with `ProviderParseError`. */
  json<T = unknown>(): Promise<T>;
}

export type FormFields = Record<string, QueryValue> | URLSearchParams;

export interface HttpCookie {
  name: string;
  value: string;
  /** Without a leading dot. */
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** True when the cookie is sent to `domain` only, not its subdomains. */
  hostOnly: boolean;
  /** Epoch milliseconds; undefined for a session cookie. */
  expires?: number;
  sameSite?: 'strict' | 'lax' | 'none';
}

export interface CookieInit {
  /** The URL the cookie belongs to. Without `domain`, the cookie is host-only for its host. */
  url: string;
  name: string;
  value: string;
  /** Makes it a domain cookie, also sent to subdomains (`dbca.wa.gov.au`). */
  domain?: string;
  /** Default `/`. */
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  /** Epoch milliseconds; omit for a session cookie. */
  expires?: number;
  sameSite?: 'strict' | 'lax' | 'none';
}

export interface CookieStore {
  get(url: string, name: string): Promise<HttpCookie | undefined>;
  /** The cookies a request to `url` would send. */
  getAll(url: string): Promise<HttpCookie[]>;
  set(cookie: CookieInit): Promise<void>;
  /** Removes every cookie in the store. */
  clear(): Promise<void>;
}

export interface HttpClient {
  readonly providerId: ProviderId;
  readonly cookies: CookieStore;
  request(method: HttpMethod, url: string, options?: HttpRequestOptions): Promise<HttpResponse>;
  /** GET, expecting 2xx JSON: `ProviderHttpError` otherwise, `ProviderParseError` for a non-JSON body. */
  getJson<T = unknown>(url: string, options?: Omit<HttpRequestOptions, 'body'>): Promise<T>;
  /** POST `application/x-www-form-urlencoded`, expecting 2xx JSON, with the same errors as `getJson`. */
  postForm<T = unknown>(
    url: string,
    form: FormFields,
    options?: Omit<HttpRequestOptions, 'body'>
  ): Promise<T>;
  /** A client on the same transport and cookies that adds `headers` to every request. */
  withDefaults(defaults: { headers?: Record<string, string> }): HttpClient;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

/** The most redirects a request follows; one more is a `ProviderHttpError` (`redirect-limit`). */
export const MAX_REDIRECTS = 5;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** `https:` anywhere, or `http:` to a loopback host (tests). */
export function isAllowedRequestUrl(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

/** One hop as a transport sends it. Transports never follow redirects themselves. */
export interface HopRequest {
  method: HttpMethod;
  /** Absolute, and allowed by `isAllowedRequestUrl`. */
  url: string;
  headers: Headers;
  body?: string;
  /** Fires on the caller's abort or the timeout; the transport must stop and reject. */
  signal: AbortSignal;
}

/** One hop's response, as soon as its headers arrive. */
export interface HopResponse {
  status: number;
  headers: Headers;
  /** Reads the rest of the body as text. Rejects if the signal fires first. */
  text(): Promise<string>;
  /** Drops the body unread (a redirect's). */
  discard(): void;
}

/** What `request` hands the redirect loop: the URL with the query applied, merged headers. */
interface TransportRequest {
  method: HttpMethod;
  url: string;
  headers: Headers;
  body?: string;
  signal: AbortSignal;
  redirect: 'follow' | 'manual' | 'error';
}

/** Header names are case-insensitive; later sources win. */
export function mergeHeaders(...sources: Array<Record<string, string> | undefined>): Headers {
  const headers = new Headers();
  for (const source of sources) {
    if (!source) continue;
    for (const [name, value] of Object.entries(source)) headers.set(name, value);
  }
  return headers;
}

export function buildUrl(url: string, query?: Record<string, QueryValue>): string {
  if (!query) return url;
  const target = new URL(url);
  for (const [name, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    target.searchParams.append(name, String(value));
  }
  return target.href;
}

function formBody(form: FormFields): string {
  if (form instanceof URLSearchParams) return form.toString();
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(form)) {
    if (value === null || value === undefined) continue;
    params.append(name, String(value));
  }
  return params.toString();
}

/** A response whose body has already been read. */
export function bufferedResponse(init: {
  providerId: ProviderId;
  status: number;
  url: string;
  headers: Headers;
  body: string;
}): HttpResponse {
  const { providerId, status, url, headers, body } = init;
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    headers,
    text: () => Promise.resolve(body),
    json: <T>() => {
      try {
        return Promise.resolve(JSON.parse(body) as T);
      } catch (error) {
        const type = headers.get('content-type') ?? 'no content type';
        return Promise.reject(
          new ProviderParseError({
            providerId,
            url,
            message: `${providerId}: expected JSON but got ${type}`,
            cause: error,
          })
        );
      }
    },
  };
}

export abstract class BaseHttpClient implements HttpClient {
  abstract readonly providerId: ProviderId;
  abstract readonly cookies: CookieStore;

  /**
   * Sends one hop and resolves when its headers arrive, applying and storing cookies. It
   * never follows a redirect. A failure to get a response rejects with the transport's own
   * error; the base class classifies it.
   */
  protected abstract send(hop: HopRequest): Promise<HopResponse>;

  /** Headers every request from this client carries (see `withDefaults`). */
  protected defaultHeaders: Record<string, string> = {};

  async request(
    method: HttpMethod,
    url: string,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse> {
    const { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    if (signal?.aborted) throw createAbortError(signal);
    const target = this.checkedUrl(url, options.query);

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    const headers = mergeHeaders(this.defaultHeaders, options.headers);
    // Cookies come from the cookie store only, in both transports.
    headers.delete('cookie');

    try {
      return await this.transport({
        method,
        url: target,
        headers,
        body: options.body === undefined ? undefined : String(options.body),
        signal: controller.signal,
        redirect: options.redirect ?? 'follow',
      });
    } catch (error) {
      if (signal?.aborted) throw createAbortError(signal);
      if (timedOut) {
        throw new ProviderTimeoutError({
          providerId: this.providerId,
          url: target,
          timeoutMs,
          cause: error,
        });
      }
      if (error instanceof ProviderError) throw error;
      const failure = classifyTransportError(error);
      throw new ProviderHttpError({
        providerId: this.providerId,
        status: 0,
        url: target,
        ...failure,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Sends the request, following redirects as `request.redirect` says. */
  private async transport(request: TransportRequest): Promise<HttpResponse> {
    let { method, url, body } = request;
    const headers = new Headers(request.headers);

    for (let hop = 0; ; hop++) {
      const response = await this.send({ method, url, headers, body, signal: request.signal });
      const location = response.headers.get('location');

      if (!REDIRECT_STATUSES.has(response.status) || location === null) {
        return bufferedResponse({
          providerId: this.providerId,
          status: response.status,
          url,
          headers: response.headers,
          body: await response.text(),
        });
      }

      response.discard();
      if (request.redirect === 'manual') {
        return bufferedResponse({
          providerId: this.providerId,
          status: response.status,
          url,
          headers: response.headers,
          body: '',
        });
      }
      if (request.redirect === 'error' || hop >= MAX_REDIRECTS) {
        const unexpected = request.redirect === 'error';
        throw new ProviderHttpError({
          providerId: this.providerId,
          status: response.status,
          url,
          reason: unexpected ? 'redirect' : 'redirect-limit',
          message: unexpected
            ? `${this.providerId}: unexpected redirect (HTTP ${response.status})`
            : `${this.providerId}: more than ${MAX_REDIRECTS} redirects`,
        });
      }

      const next = this.checkedUrl(location, undefined, url);
      if (new URL(next).origin !== new URL(url).origin) {
        // Credentials the caller set were meant for the first origin only.
        headers.delete('authorization');
      }
      if (
        (response.status === 303 && method !== 'HEAD') ||
        (response.status <= 302 && method === 'POST')
      ) {
        method = 'GET';
        body = undefined;
        headers.delete('content-type');
      }
      url = next;
    }
  }

  /** The absolute URL to send to, or a non-retryable `ProviderHttpError` (`blocked`). */
  private checkedUrl(url: string, query?: Record<string, QueryValue>, base?: string): string {
    let target: URL;
    try {
      target = new URL(buildUrl(new URL(url, base).href, query));
    } catch (error) {
      throw new ProviderHttpError({
        providerId: this.providerId,
        status: 0,
        url,
        reason: 'blocked',
        message: `${this.providerId}: not a valid URL`,
        cause: error,
      });
    }
    if (!isAllowedRequestUrl(target)) {
      throw new ProviderHttpError({
        providerId: this.providerId,
        status: 0,
        url: target.href,
        reason: 'blocked',
        message: `${this.providerId}: only https URLs are allowed, not ${target.protocol}//${target.host}`,
      });
    }
    return target.href;
  }

  getJson<T = unknown>(url: string, options: Omit<HttpRequestOptions, 'body'> = {}): Promise<T> {
    return this.expectJson<T>(
      this.request('GET', url, {
        ...options,
        headers: { Accept: 'application/json, text/plain, */*', ...options.headers },
      })
    );
  }

  postForm<T = unknown>(
    url: string,
    form: FormFields,
    options: Omit<HttpRequestOptions, 'body'> = {}
  ): Promise<T> {
    return this.expectJson<T>(
      this.request('POST', url, {
        ...options,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          ...options.headers,
        },
        body: formBody(form),
      })
    );
  }

  withDefaults(defaults: { headers?: Record<string, string> }): HttpClient {
    const headers = Object.fromEntries(
      mergeHeaders(this.defaultHeaders, defaults.headers).entries()
    );
    return new DefaultsHttpClient(this.providerId, this.cookies, headers, (hop) => this.send(hop));
  }

  private async expectJson<T>(pending: Promise<HttpResponse>): Promise<T> {
    const response = await pending;
    if (!response.ok) {
      throw new ProviderHttpError({
        providerId: this.providerId,
        status: response.status,
        url: response.url,
      });
    }
    if (response.status === 204) return undefined as T;
    return response.json<T>();
  }
}

/** `withDefaults`: the parent's transport and cookies, plus extra default headers. */
class DefaultsHttpClient extends BaseHttpClient {
  constructor(
    readonly providerId: ProviderId,
    readonly cookies: CookieStore,
    headers: Record<string, string>,
    private readonly sendHop: (hop: HopRequest) => Promise<HopResponse>
  ) {
    super();
    this.defaultHeaders = headers;
  }

  protected send(hop: HopRequest): Promise<HopResponse> {
    return this.sendHop(hop);
  }
}
