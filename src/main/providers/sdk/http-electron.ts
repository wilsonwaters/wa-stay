/**
 * `ElectronSessionHttpClient`: the production transport. Requests go through Chromium's
 * network stack on the provider's own session partition, `persist:provider-<id>`, with
 * `credentials: 'include'`, so the session's cookie store is used and updated on every hop.
 * The provider's sign-in and payment windows open on the same partition and share those
 * cookies (architecture-notes §3, brief D5).
 *
 * It sends one hop at a time with `net.request({ redirect: 'manual' })` and stops at each
 * redirect, so `BaseHttpClient` applies the same redirect, URL and error rules as
 * `NodeHttpClient` (§12.30). `session.fetch` cannot: in Electron 28 it rejects
 * `redirect: 'manual'` ("Redirect was cancelled") and its `Response.url` is always empty.
 *
 * A request with a `Referer` header is sent with `referrerPolicy: 'unsafe-url'`. Under the
 * default policy Chromium cancels a request whose cross-origin Referer carries a path
 * (`ERR_BLOCKED_BY_CLIENT`).
 *
 * The partition presents the Chrome version Electron really runs (`process.versions.chrome`):
 * its user agent is set once, and every request's `User-Agent` and `sec-ch-ua` headers are
 * rewritten to that version, whatever the provider put there. API calls and the provider's
 * windows therefore present one browser whose user agent agrees with Chromium's own client
 * hints (architecture-notes §12.32).
 *
 * This is the only file under `providers/` that imports `electron`. Build it after the app
 * is ready (`session.fromPartition` needs `ready`).
 */

import { net, session, type Cookie, type IncomingMessage, type Session } from 'electron';
import type { ProviderId } from '@shared/types/provider.types';
import { createAbortError } from './errors';
import {
  BaseHttpClient,
  type CookieInit,
  type CookieStore,
  type HopRequest,
  type HopResponse,
  type HttpCookie,
} from './http';
import { chromeBrands, chromeUserAgent, runtimeChromeMajor } from './user-agent';

export function providerPartition(providerId: ProviderId): string {
  return `persist:provider-${providerId}`;
}

function toHttpCookie(cookie: Cookie): HttpCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: (cookie.domain ?? '').replace(/^\./, ''),
    path: cookie.path ?? '/',
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    hostOnly: cookie.hostOnly ?? false,
    expires:
      cookie.session || cookie.expirationDate === undefined
        ? undefined
        : cookie.expirationDate * 1000,
    sameSite:
      cookie.sameSite === 'strict' || cookie.sameSite === 'lax'
        ? cookie.sameSite
        : cookie.sameSite === 'no_restriction'
          ? 'none'
          : undefined,
  };
}

/** The URL Electron needs to address a stored cookie when removing it. */
function cookieUrl(cookie: Cookie): string {
  const host = (cookie.domain ?? '').replace(/^\./, '');
  return `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path ?? '/'}`;
}

class ElectronCookieStore implements CookieStore {
  constructor(private readonly ses: Session) {}

  async get(url: string, name: string): Promise<HttpCookie | undefined> {
    const [cookie] = await this.ses.cookies.get({ url, name });
    return cookie ? toHttpCookie(cookie) : undefined;
  }

  async getAll(url: string): Promise<HttpCookie[]> {
    return (await this.ses.cookies.get({ url })).map(toHttpCookie);
  }

  async set(cookie: CookieInit): Promise<void> {
    await this.ses.cookies.set({
      url: cookie.url,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path ?? '/',
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expires === undefined ? undefined : cookie.expires / 1000,
      sameSite:
        cookie.sameSite === undefined
          ? undefined
          : cookie.sameSite === 'none'
            ? 'no_restriction'
            : cookie.sameSite,
    });
  }

  async clear(): Promise<void> {
    const all = await this.ses.cookies.get({});
    await Promise.all(all.map((cookie) => this.ses.cookies.remove(cookieUrl(cookie), cookie.name)));
  }
}

export interface ElectronSessionHttpClientOptions {
  providerId: ProviderId;
  /** The Chrome major version to present. Defaults to the one Electron runs. */
  chromeMajor?: string;
}

export class ElectronSessionHttpClient extends BaseHttpClient {
  readonly providerId: ProviderId;
  readonly partition: string;
  readonly cookies: CookieStore;
  /** The desktop Chrome user agent this partition presents. */
  readonly userAgent: string;
  private readonly brands: string;
  private readonly ses: Session;

  constructor({
    providerId,
    chromeMajor = runtimeChromeMajor(),
  }: ElectronSessionHttpClientOptions) {
    super();
    this.providerId = providerId;
    this.partition = providerPartition(providerId);
    this.userAgent = chromeUserAgent(chromeMajor);
    this.brands = chromeBrands(chromeMajor);
    this.ses = session.fromPartition(this.partition);
    this.ses.setUserAgent(this.userAgent);
    this.cookies = new ElectronCookieStore(this.ses);
  }

  /** The hop's headers, with the partition's own `User-Agent` and (when sent) `sec-ch-ua`. */
  private identityHeaders(headers: Headers): Record<string, string> {
    const out = Object.fromEntries(headers.entries());
    out['user-agent'] = this.userAgent;
    if ('sec-ch-ua' in out) out['sec-ch-ua'] = this.brands;
    return out;
  }

  protected send(hop: HopRequest): Promise<HopResponse> {
    const { signal } = hop;
    if (signal.aborted) return Promise.reject(createAbortError(signal));

    return new Promise<HopResponse>((resolve, reject) => {
      // Rejects whatever is still pending: the headers, then the body.
      let fail = reject;
      const onAbort = (): void => {
        request.abort();
        fail(createAbortError(signal));
      };
      const done = (): void => signal.removeEventListener('abort', onAbort);

      const request = net.request({
        method: hop.method,
        url: hop.url,
        session: this.ses,
        credentials: 'include',
        redirect: 'manual',
        headers: this.identityHeaders(hop.headers),
        ...(hop.headers.has('referer') ? { referrerPolicy: 'unsafe-url' } : {}),
      });

      request.on('redirect', (status, _method, redirectUrl, responseHeaders) => {
        // Not followed here: BaseHttpClient decides. Aborting inside this handler stops the
        // hop quietly; the session has already stored the redirect's cookies.
        const headers = new Headers();
        for (const [name, values] of Object.entries(responseHeaders)) {
          for (const value of values) appendHeader(headers, name, value);
        }
        if (!headers.has('location')) headers.set('location', redirectUrl);
        request.abort();
        done();
        resolve({ status, headers, text: () => Promise.resolve(''), discard: () => undefined });
      });

      request.on('response', (response) => {
        const body = new Promise<string>((resolveBody, rejectBody) => {
          fail = rejectBody;
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            done();
            resolveBody(Buffer.concat(chunks).toString('utf8'));
          });
          response.on('error', (error: Error) => {
            done();
            rejectBody(error);
          });
          response.on('aborted', () => {
            done();
            rejectBody(createAbortError(signal));
          });
        });
        // Read only by `text()`; a discarded body must not become an unhandled rejection.
        body.catch(() => undefined);
        resolve({
          status: response.statusCode,
          headers: responseHeaders(response),
          text: () => body,
          discard: () => request.abort(),
        });
      });

      // A 401 challenge is answered with no credentials, so the 401 comes back as a response.
      request.on('login', (_authInfo, callback) => callback());

      request.on('error', (error) => {
        done();
        fail(error);
      });

      signal.addEventListener('abort', onAbort, { once: true });
      request.end(hop.body);
    });
  }
}

/** Adds a header, skipping one `Headers` refuses (it must not throw inside an event handler). */
function appendHeader(headers: Headers, name: string, value: string): void {
  try {
    headers.append(name, value);
  } catch {
    // A malformed header from the server is dropped.
  }
}

/** Every response header as received, repeated ones (`Set-Cookie`) kept apart. */
function responseHeaders(response: IncomingMessage): Headers {
  const headers = new Headers();
  const raw = response.rawHeaders;
  if (Array.isArray(raw) && raw.length > 0) {
    for (let i = 0; i + 1 < raw.length; i += 2) appendHeader(headers, raw[i], raw[i + 1]);
    return headers;
  }
  for (const [name, value] of Object.entries(response.headers)) {
    for (const item of Array.isArray(value) ? value : [value]) appendHeader(headers, name, item);
  }
  return headers;
}
