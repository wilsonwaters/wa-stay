/**
 * RAC's cart guard (terms rule 8: payment and acceptance are the person's own steps). The RAC
 * client (`client.ts`) asks it about every request, and about every redirect it would follow,
 * before anything is sent. A refused request is a `ProviderError`, and nothing reaches RAC.
 *
 * It allows what the module sends, and nothing more:
 * - **GET** of a page on RAC's own host, except NewBook's proxy;
 * - **POST** of RAC's availability form (`availability-ajax.php`, with no query) only, and, while
 *   the cart is enabled (the `autoCart` experiment, R19), NewBook's proxy for a park
 *   (`/<slug>/wp-content/themes/parks-and-resorts/inc/newbook/api/<file>.php`) with exactly
 *   `newbook_api_action=data` and `query=remove_item_from_cart`, and a form of exactly
 *   `item_offset` and `cart_type`;
 * - **a cart address** (a query with `cart` or `rest_api_data_id`) only while the cart is
 *   enabled, only as a GET of a park's booking engine (`/<slug>/booking/`), with exactly one
 *   empty `cart` and at most one `rest_api_data_id`, written as such.
 *
 * Always refused, whatever is on: any other host (NewBook's card store is on one), any other
 * method, a request naming a word on the deny list below in its address or its form (the card
 * store and its fields, checkout's form and its post, extending a hold, a membership check,
 * changing a booking's guests, RAC's own cart-address endpoint), and a `query` field in any
 * form. Paths are compared as a server would read them: decoded (twice-encoded too), in lower
 * case, with `.` and `..` segments resolved, repeated slashes collapsed, and no trailing slash or
 * `index.php`, so `/Busselton/Booking`, `//busselton/booking/`, `/busselton/booking/index.php`
 * and `/busselton%2Fbooking/` are all the booking engine. Query and form names are read the way
 * PHP reads them (`phpKey`): `.`, a space and `[` become `_`, and `cart[]` is `cart`.
 *
 * Logged by path only: a cart address's query carries a token (`rest_api_data_id`).
 */

import type { HttpMethod } from '../sdk/http';
import { RAC_SITE_URL } from './client';

/**
 * RAC's availability endpoint, at the site's root (the park is the form's `blog_id`): the one
 * form the module posts outside the cart (`availability.ts` sends it).
 */
export const RAC_AVAILABILITY_PATH =
  '/wp-content/themes/parks-and-resorts/template-parts/components/booking-engine/availability-ajax.php';

/** A request as the client is about to send it: its full address (query included) and form. */
export interface CartGuardRequest {
  method: HttpMethod;
  url: string;
  body?: string;
}

/**
 * Never sent, in an address or a form, whatever is on (rule 8). Compared without case. The no
 * checkout test (`tests/unit/providers/rac/no-checkout.test.ts`) allows these names here only.
 */
const DENY_LIST: readonly string[] = [
  'cc_secure',
  'secure_store_id',
  'card_number',
  'card_expiry',
  'card_cvv',
  'card_name',
  'online_cart_id',
  'newbook_online_main_form',
  'cart=Booking',
  'extend_multiple_holds',
  'online_checkout_membership_fields',
  'membership_number',
  'modify_booking_guests',
  'get-online-cart-url-ajax.php',
];

/** A park's booking engine (normalised): its cart page, and where checkout posts. */
const BOOKING_PAGE = /^\/[a-z0-9-]+\/booking$/;
/** NewBook's proxy, anywhere in a (normalised) path. */
const NEWBOOK_PROXY = /\/inc\/newbook\/api\//;
/** A park's NewBook proxy file (normalised). */
const PARK_PROXY =
  /^\/[a-z0-9-]+\/wp-content\/themes\/parks-and-resorts\/inc\/newbook\/api\/[a-z0-9-]+\.php$/;
/** The one proxy query a cart may send: taking an item out of the cart. */
export const RAC_CART_REMOVAL_QUERY = 'remove_item_from_cart';
/** The removal's query and form, exactly. */
const REMOVAL_QUERY = ['newbook_api_action', 'query'];
const REMOVAL_FORM = ['cart_type', 'item_offset'];

function decoded(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

/**
 * `pathname` as a server reads it: decoded until it no longer changes (at most three times), in
 * lower case, back slashes as slashes, `.` and `..` resolved, empty segments dropped, and a last
 * `index.php` dropped; always `/` and the segments, with no trailing slash.
 */
export function normalisedPath(pathname: string): string {
  let path = pathname;
  for (let times = 0; times < 3; times++) {
    let next: string;
    try {
      next = decodeURIComponent(path);
    } catch {
      break;
    }
    if (next === path) break;
    path = next;
  }
  const segments: string[] = [];
  for (const segment of path.toLowerCase().replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  if (segments[segments.length - 1] === 'index.php') segments.pop();
  return `/${segments.join('/')}`;
}

/**
 * A query or form name as PHP reads it: cut at its first NUL (`cart%00x` is `cart`), its leading
 * spaces dropped (`%20cart` and `+cart` are `cart`), `cart[]` (or `cart[x]`) is `cart`, and `.`,
 * a space and an unclosed `[` become `_`; in lower case, so no spelling of a name escapes the
 * rules.
 */
export function phpKey(name: string): string {
  const trimmed = name.split('\0')[0].replace(/^ +/, '');
  const bracket = trimmed.indexOf('[');
  const base =
    bracket > 0 && trimmed.indexOf(']', bracket) > bracket ? trimmed.slice(0, bracket) : trimmed;
  return base.replace(/[. []/g, '_').toLowerCase();
}

/** Whether `params` has exactly `names` (sorted, as written), each once. */
function exactly(params: URLSearchParams, names: readonly string[]): boolean {
  const written = [...params.keys()];
  return (
    written.length === names.length &&
    [...written].sort().every((name, at) => name === names[at]) &&
    names.every((name) => params.getAll(name).length === 1)
  );
}

/**
 * Why `request` must not be sent, in a few words, or undefined when it may be. `cartEnabled`:
 * the cart is on (RAC's `autoCart` experiment).
 */
export function cartGuardRefusal(
  request: CartGuardRequest,
  cartEnabled: boolean
): string | undefined {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return 'not an address';
  }
  if (url.protocol !== 'https:' || url.origin !== new URL(RAC_SITE_URL).origin) {
    return "not RAC's own host";
  }
  const body = request.body ?? '';
  const named = `${decoded(url.pathname + url.search)}\n${decoded(body)}`.toLowerCase();
  if (DENY_LIST.some((word) => named.includes(word.toLowerCase()))) {
    return 'checkout, payment or a NewBook call';
  }

  const path = normalisedPath(url.pathname);
  const query = url.searchParams;
  const queryNames = [...query.keys()].map(phpKey);
  const form = new URLSearchParams(body);
  const proxy = NEWBOOK_PROXY.test(`${path}/`);
  const booking = BOOKING_PAGE.test(path);

  if (request.method === 'POST') {
    if ([...form.keys()].map(phpKey).includes('query')) return 'a NewBook call';
    if (proxy) {
      const removal =
        PARK_PROXY.test(path) &&
        exactly(query, REMOVAL_QUERY) &&
        query.get('newbook_api_action') === 'data' &&
        query.get('query') === RAC_CART_REMOVAL_QUERY &&
        exactly(form, REMOVAL_FORM);
      if (!removal) return 'a NewBook call';
      return cartEnabled ? undefined : 'the cart is off';
    }
    if (path === normalisedPath(RAC_AVAILABILITY_PATH) && queryNames.length === 0) {
      return undefined;
    }
    return booking ? 'checkout' : 'not a request WA Stay sends';
  }
  if (request.method !== 'GET') return 'not a request WA Stay sends';
  if (proxy) return 'a NewBook call';

  const cartNames = [...query.keys()].filter((name) =>
    ['cart', 'rest_api_data_id'].includes(phpKey(name))
  );
  if (cartNames.length > 0) {
    if (!cartEnabled) return 'the cart is off';
    const written =
      booking &&
      cartNames.every((name) => name === 'cart' || name === 'rest_api_data_id') &&
      query.getAll('cart').length === 1 &&
      query.getAll('rest_api_data_id').length <= 1;
    if (!written) return 'not a cart address';
    // `?cart` adds to the cart and shows it; any other value is a checkout step
    if (query.get('cart') !== '') return 'checkout';
  }
  return undefined;
}

/** The path a log may name: never the query, which can carry the cart's token. */
export function loggablePath(address: string): string {
  try {
    return new URL(address).pathname;
  } catch {
    return '(not an address)';
  }
}
