/**
 * The browser headers ParkStay requests carry. DBCA's queue middleware answers library
 * user agents (axios, python, curl, java, httpclient…) with its queue redirect page
 * (`queue_middleware.py:16-28`), and `campsite_availablity_view` answers HTTP 500 without a
 * ParkStay `Referer`, so every request presents a desktop Chrome user agent, with the client
 * hints and languages that go with it, and the ParkStay site as its referrer.
 *
 * The user agent, client hints and languages are the SDK's browser identity
 * (`browserIdentity`): in the app, the same ones ParkStay's sign-in and payment windows send
 * (the client rewrites them to the partition's anyway).
 *
 * No `Sec-Fetch-*` headers: in the app, Chromium's network stack sets them itself (it
 * rewrites `Sec-Fetch-Site` and refuses a request that sets `Sec-Fetch-Mode` with
 * `net::ERR_INVALID_ARGUMENT`; checked in Electron 28).
 */

import { browserIdentity } from '../sdk/user-agent';
import { PARKSTAY_BASE_URL } from './constants';

const IDENTITY = browserIdentity();

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': IDENTITY.userAgent,
  'Accept-Language': IDENTITY.acceptLanguage,
  'sec-ch-ua': IDENTITY.brands,
  'sec-ch-ua-mobile': IDENTITY.mobile,
  'sec-ch-ua-platform': IDENTITY.platform,
  Accept: 'application/json, text/plain, */*',
  Referer: `${PARKSTAY_BASE_URL}/`,
};

/**
 * Headers for a request to the ParkStay API (same origin as the site). Chrome adds `Origin`
 * to a same-origin request only when it changes state, so a POST gets one.
 */
export function parkstayApiHeaders(method: 'GET' | 'POST' = 'GET'): Record<string, string> {
  return method === 'POST'
    ? { ...BROWSER_HEADERS, Origin: PARKSTAY_BASE_URL }
    : { ...BROWSER_HEADERS };
}

/**
 * Headers for a ParkStay page (the campground page), as a browser sends them for a page:
 * HTML first. The campground page refuses a request without a ParkStay `Referer`.
 */
export function parkstayPageHeaders(): Record<string, string> {
  return {
    ...BROWSER_HEADERS,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
}

/** Headers for a request to the queue API, which the ParkStay site calls cross-site. */
export function queueApiHeaders(): Record<string, string> {
  return { ...BROWSER_HEADERS, Origin: PARKSTAY_BASE_URL };
}
