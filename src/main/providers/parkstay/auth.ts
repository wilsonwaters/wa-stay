/**
 * ParkStay sign-in (brief D5, architecture-notes §12.32): a `browser-session` definition.
 *
 * The person signs in on ParkStay's own pages in the app's sign-in window, which runs on the
 * provider partition, so the session cookies it gets are the ones API calls, holds and the
 * payment window use. The flow goes `/ssologin` (`templates/ps/base.html:69`) → the DBCA SSO
 * gateway (`auth2.dbca.wa.gov.au`) → Azure AD B2C (`dbcab2c.b2clogin.com`, sometimes
 * `login.microsoftonline.com`) → back to `/login-success/` (`urls.py:107`). The DBCA queue
 * (`queue.dbca.wa.gov.au`) can step in on the ParkStay pages.
 *
 * ParkStay accounts are `optional`: `create_booking` needs no sign-in (`api.py:2938-2947`) and
 * a ParkStay session lasts an hour (`SESSION_COOKIE_AGE = 3600`), so holds never wait on it.
 * The person signs in inside the payment window, or beforehand.
 *
 * `isSignedIn` asks `GET /api/profile` (no trailing slash, `urls.py:58`; `IsAuthenticated`,
 * `api.py:4720-4731`), with the partition's cookies:
 * - 200 JSON with an `email` → signed in, named `first_name last_name`. Only the email and the
 *   two names are read; the profile's address and phone numbers are never touched.
 * - 401 or 403 (`{"detail":"Authentication credentials were not provided."}`) → signed out.
 * - The DBCA queue (its redirect page, or a redirect to the waiting room), any other status,
 *   a body that is not a profile, a timeout or no response → `unknown`, with a reason. The
 *   account service keeps the last definite answer then.
 */

import type { AccountStatus } from '@shared/types/provider.types';
import { isAbortError, ProviderHttpError, ProviderTimeoutError } from '../sdk/errors';
import type { HttpClient } from '../sdk/http';
import type { BrowserSessionAuth } from '../sdk/provider';
import { isQueueInterstitial, PARKSTAY_ENDPOINTS, type ParkStayEndpoints } from './client';
import { PARKSTAY_BASE_URL, QUEUE_API_BASE_URL } from './constants';
import { parkstayApiHeaders } from './headers';

export const PARKSTAY_SIGN_IN_URL = `${PARKSTAY_BASE_URL}/ssologin`;

/** Every top-level origin the sign-in flow visits. */
export const PARKSTAY_SIGN_IN_ORIGINS: readonly string[] = [
  PARKSTAY_BASE_URL,
  'https://auth2.dbca.wa.gov.au',
  'https://dbcab2c.b2clogin.com',
  'https://login.microsoftonline.com',
  QUEUE_API_BASE_URL,
];

/** Where the flow lands once signed in (the page also says "Session Expired" when not). */
export const PARKSTAY_SIGN_IN_COMPLETE: readonly string[] = [
  `${PARKSTAY_BASE_URL}/login-success/*`,
];

/** How long a signed-in check may take. */
export const PROFILE_TIMEOUT_MS = 15_000;

export interface ProfileResponse {
  status: number;
  /** The final URL, after redirects. */
  url: string;
  contentType: string | null;
  body: string;
}

const unknown = (reason: string): AccountStatus => ({ state: 'unknown', reason });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function profileUrlOf(endpoints: ParkStayEndpoints): string {
  return `${endpoints.apiBaseUrl.replace(/\/+$/, '')}/profile`;
}

function withoutQuery(url: string): string {
  const at = url.search(/[?#]/);
  return at < 0 ? url : url.slice(0, at);
}

/** True when a redirect took the request to the queue site or its waiting room. */
function onQueuePage(url: string, endpoints: ParkStayEndpoints): boolean {
  if (!url || withoutQuery(url) === profileUrlOf(endpoints)) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === new URL(endpoints.queueBaseUrl).origin ||
      parsed.pathname.startsWith('/site-queue/')
    );
  } catch {
    return false;
  }
}

/** What a `/api/profile` answer says about the session. Pure; see the module comment. */
export function classifyProfileResponse(
  response: ProfileResponse,
  endpoints: ParkStayEndpoints = PARKSTAY_ENDPOINTS
): AccountStatus {
  const { status, url, contentType, body } = response;
  if (onQueuePage(url, endpoints) || isQueueInterstitial(contentType, body)) {
    return unknown('queue');
  }
  if (status === 401 || status === 403) return { state: 'signed-out' };
  if (status !== 200) return unknown(`http ${status}`);

  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return unknown('parse');
  }
  if (!isRecord(data)) return unknown('parse');
  const email = trimmed(data.email);
  if (!email) return unknown('parse');
  const displayName = [trimmed(data.first_name), trimmed(data.last_name)].filter(Boolean).join(' ');
  return { state: 'signed-in', email, ...(displayName ? { displayName } : {}) };
}

/** ParkStay's sign-in definition, asking `endpoints` (a local fixture server in tests). */
export function createParkStayAuth(
  endpoints: ParkStayEndpoints = PARKSTAY_ENDPOINTS
): BrowserSessionAuth {
  const profileUrl = profileUrlOf(endpoints);

  return {
    kind: 'browser-session',
    signInUrl: PARKSTAY_SIGN_IN_URL,
    allowedOrigins: PARKSTAY_SIGN_IN_ORIGINS,
    completionUrlPatterns: PARKSTAY_SIGN_IN_COMPLETE,

    async isSignedIn(http: HttpClient, signal?: AbortSignal): Promise<AccountStatus> {
      try {
        const response = await http.request('GET', profileUrl, {
          headers: parkstayApiHeaders('GET'),
          timeoutMs: PROFILE_TIMEOUT_MS,
          signal,
        });
        return classifyProfileResponse(
          {
            status: response.status,
            url: response.url,
            contentType: response.headers.get('content-type'),
            body: await response.text(),
          },
          endpoints
        );
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof ProviderTimeoutError) return unknown('timeout');
        if (error instanceof ProviderHttpError) {
          return unknown(error.status === 0 ? 'network' : `http ${error.status}`);
        }
        return unknown('error');
      }
    },
  };
}
