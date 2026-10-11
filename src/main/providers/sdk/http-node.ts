/**
 * `NodeHttpClient`: the test transport. Node's global `fetch`, one hop at a time with
 * `redirect: 'manual'`: `BaseHttpClient` follows redirects, and this client applies and
 * captures cookies on every hop with an in-memory `CookieJar`. Like the production client it
 * sends the desktop Chrome user agent unless a request sets its own.
 *
 * `CookieJar` follows RFC 6265 closely enough for provider tests: the value is everything
 * after the **first** `=`; `Domain`, `Path`, `Expires`, `Max-Age` and `Secure` are honoured;
 * a domain cookie for `dbca.wa.gov.au` is sent to its subdomains, a host-only cookie is not.
 * Unlike a browser it accepts `SameSite=None` without `Secure`, and it has no public-suffix
 * list.
 */

import { isIP } from 'net';
import type { ProviderId } from '@shared/types/provider.types';
import {
  BaseHttpClient,
  type CookieInit,
  type CookieStore,
  type HopRequest,
  type HopResponse,
  type HttpCookie,
} from './http';
import { CHROME_USER_AGENT } from './user-agent';

function hostOf(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

/** RFC 6265 §5.1.3. */
function domainMatches(host: string, domain: string): boolean {
  if (host === domain) return true;
  return !isIP(host) && host.endsWith(`.${domain}`);
}

/** RFC 6265 §5.1.4. */
function defaultPath(url: URL): string {
  const path = url.pathname;
  if (!path.startsWith('/')) return '/';
  const last = path.lastIndexOf('/');
  return last <= 0 ? '/' : path.slice(0, last);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/';
}

function parseSameSite(value: string): HttpCookie['sameSite'] {
  const lower = value.toLowerCase();
  return lower === 'strict' || lower === 'lax' || lower === 'none' ? lower : undefined;
}

export class CookieJar implements CookieStore {
  /** In creation order, which `sort` (stable) keeps for cookies with equal paths. */
  private cookies: HttpCookie[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  /** Stores one `Set-Cookie` header received from `requestUrl`. Invalid cookies are ignored. */
  setCookie(header: string, requestUrl: string): void {
    const url = new URL(requestUrl);
    const [pair, ...attributes] = header.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0) return;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) return;

    const host = hostOf(url);
    let domain: string | undefined;
    let path: string | undefined;
    let expires: number | undefined;
    let maxAge: number | undefined;
    let secure = false;
    let httpOnly = false;
    let sameSite: HttpCookie['sameSite'];

    for (const attribute of attributes) {
      const at = attribute.indexOf('=');
      const key = (at < 0 ? attribute : attribute.slice(0, at)).trim().toLowerCase();
      const raw = at < 0 ? '' : attribute.slice(at + 1).trim();
      switch (key) {
        case 'domain':
          if (raw) domain = raw.replace(/^\./, '').toLowerCase();
          break;
        case 'path':
          path = raw.startsWith('/') ? raw : undefined;
          break;
        case 'expires': {
          const time = Date.parse(raw);
          if (!Number.isNaN(time)) expires = time;
          break;
        }
        case 'max-age':
          if (/^-?\d+$/.test(raw)) maxAge = Number(raw);
          break;
        case 'secure':
          secure = true;
          break;
        case 'httponly':
          httpOnly = true;
          break;
        case 'samesite':
          sameSite = parseSameSite(raw);
          break;
      }
    }

    // A Domain attribute must cover the host that set it.
    if (domain !== undefined && !domainMatches(host, domain)) return;

    const now = this.now();
    // Max-Age wins over Expires; zero or less means "delete now".
    const expiry = maxAge !== undefined ? (maxAge <= 0 ? -Infinity : now + maxAge * 1000) : expires;

    this.store({
      name,
      value,
      domain: domain ?? host,
      hostOnly: domain === undefined,
      path: path ?? defaultPath(url),
      secure,
      httpOnly,
      expires: expiry,
      sameSite,
    });
  }

  /** The cookies a request to `url` sends, longest path first, then oldest first. */
  cookiesFor(url: string): HttpCookie[] {
    const target = new URL(url);
    const host = hostOf(target);
    const now = this.now();
    this.cookies = this.cookies.filter((c) => c.expires === undefined || c.expires > now);
    return this.cookies
      .filter((c) => (c.hostOnly ? host === c.domain : domainMatches(host, c.domain)))
      .filter((c) => pathMatches(target.pathname || '/', c.path))
      .filter((c) => !c.secure || target.protocol === 'https:')
      .sort((a, b) => b.path.length - a.path.length)
      .map((cookie) => ({ ...cookie }));
  }

  /** The `Cookie` header value for `url`, or `''`. */
  cookieHeader(url: string): string {
    return this.cookiesFor(url)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  async get(url: string, name: string): Promise<HttpCookie | undefined> {
    return this.cookiesFor(url).find((c) => c.name === name);
  }

  async getAll(url: string): Promise<HttpCookie[]> {
    return this.cookiesFor(url);
  }

  async set(cookie: CookieInit): Promise<void> {
    const url = new URL(cookie.url);
    const domain = cookie.domain?.replace(/^\./, '').toLowerCase();
    this.store({
      name: cookie.name,
      value: cookie.value,
      domain: domain ?? hostOf(url),
      hostOnly: domain === undefined,
      path: cookie.path ?? '/',
      secure: cookie.secure ?? false,
      httpOnly: cookie.httpOnly ?? false,
      expires: cookie.expires,
      sameSite: cookie.sameSite,
    });
  }

  async clear(): Promise<void> {
    this.cookies = [];
  }

  private store(cookie: HttpCookie): void {
    const index = this.cookies.findIndex(
      (c) => c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path
    );
    const expired = cookie.expires !== undefined && cookie.expires <= this.now();
    if (index < 0) {
      if (!expired) this.cookies.push(cookie);
    } else if (expired) {
      this.cookies.splice(index, 1);
    } else {
      // Replaced in place: it keeps its creation order (RFC 6265 §5.3 step 11.3).
      this.cookies[index] = cookie;
    }
  }
}

export interface NodeHttpClientOptions {
  providerId: ProviderId;
  jar?: CookieJar;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Defaults to the desktop Chrome user agent, as in production. */
  userAgent?: string;
}

export class NodeHttpClient extends BaseHttpClient {
  readonly providerId: ProviderId;
  readonly cookies: CookieJar;
  private readonly fetchImpl: typeof fetch;

  constructor({
    providerId,
    jar = new CookieJar(),
    fetch: fetchImpl,
    userAgent = CHROME_USER_AGENT,
  }: NodeHttpClientOptions) {
    super();
    this.providerId = providerId;
    this.cookies = jar;
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
    this.defaultHeaders = { 'User-Agent': userAgent };
  }

  protected async send(hop: HopRequest): Promise<HopResponse> {
    const headers = new Headers(hop.headers);
    const cookie = this.cookies.cookieHeader(hop.url);
    if (cookie) headers.set('cookie', cookie);
    else headers.delete('cookie');

    const response = await this.fetchImpl(hop.url, {
      method: hop.method,
      headers,
      body: hop.body,
      redirect: 'manual',
      signal: hop.signal,
    });
    for (const header of response.headers.getSetCookie()) this.cookies.setCookie(header, hop.url);

    return {
      status: response.status,
      headers: response.headers,
      text: () => response.text(),
      discard: () => {
        response.body?.cancel().catch(() => undefined);
      },
    };
  }
}
