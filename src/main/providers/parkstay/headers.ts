/**
 * The browser headers ParkStay requests carry. DBCA's queue middleware answers library
 * user agents (axios, python, curl, java, httpclient…) with its queue redirect page
 * (`queue_middleware.py:16-28`), and `campsite_availablity_view` answers HTTP 500 without a
 * ParkStay `Referer`, so every request presents the desktop Chrome user agent and the
 * ParkStay site as its referrer.
 *
 * No `Sec-Fetch-*` headers: in the app, Chromium's network stack sets them itself (it
 * rewrites `Sec-Fetch-Site` and refuses a request that sets `Sec-Fetch-Mode` with
 * `net::ERR_INVALID_ARGUMENT`; checked in Electron 28).
 */

import { CHROME_MAJOR_VERSION, CHROME_USER_AGENT, chromeBrands } from '../sdk/user-agent';
import { PARKSTAY_BASE_URL } from './constants';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': CHROME_USER_AGENT,
  'Accept-Language': 'en-AU,en;q=0.9,en-US;q=0.8',
  'sec-ch-ua': chromeBrands(CHROME_MAJOR_VERSION),
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
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
