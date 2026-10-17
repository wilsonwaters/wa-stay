/**
 * RAC's cart guard (terms rule 8: payment and acceptance are the person's own steps). The RAC
 * client (`client.ts`) asks it about every request, and about every redirect it would follow,
 * before anything is sent. A refused request is a `ProviderError`, and nothing reaches RAC.
 *
 * - **Always refused**, whatever the person turned on:
 *   - an address off RAC's own host (NewBook's card store is on another host);
 *   - a request that names a word on the deny list below, in its address or its form: the card
 *     store and its fields, checkout's form and its post, extending a hold, a membership check,
 *     changing a booking's guests, and RAC's own cart-address endpoint (unused by its page);
 *   - anything but a GET of a park's booking engine, `/<slug>/booking/` (checkout posts there);
 *   - NewBook's proxy (`/<slug>/wp-content/themes/parks-and-resorts/inc/newbook/api/…`) for
 *     anything but a POST that removes an item from the cart.
 * - **Refused unless the cart is enabled** (the `autoCart` experiment, R19): a cart address (a
 *   query with `cart` or `rest_api_data_id`: a tariff's cart address, or a redirect it gives),
 *   and the proxy's `remove_item_from_cart`.
 * - **Logged by path only:** a cart address's query carries a token (`rest_api_data_id`).
 */

import type { HttpMethod } from '../sdk/http';
import { RAC_SITE_URL } from './client';

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

/** A park's booking engine: its cart page, and where checkout posts. */
const BOOKING_PAGE = /^\/[a-z0-9-]+\/booking\/$/;
/** NewBook's proxy, under a park (and anywhere else it might be put). */
const NEWBOOK_PROXY = /\/inc\/newbook\/api\//;
/** The one proxy query a cart may send: taking an item out of the cart. */
export const RAC_CART_REMOVAL_QUERY = 'remove_item_from_cart';

function decoded(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
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
  const named = `${decoded(url.pathname + url.search)}\n${decoded(request.body ?? '')}`;
  const lower = named.toLowerCase();
  if (DENY_LIST.some((word) => lower.includes(word.toLowerCase()))) {
    return 'checkout, payment or a NewBook call';
  }

  const query = url.searchParams;
  if (NEWBOOK_PROXY.test(url.pathname)) {
    const names = [...new Set(query.keys())];
    const removal =
      request.method === 'POST' &&
      query.get('newbook_api_action') === 'data' &&
      query.get('query') === RAC_CART_REMOVAL_QUERY &&
      names.every((name) => name === 'newbook_api_action' || name === 'query');
    if (!removal) return 'a NewBook call';
    return cartEnabled ? undefined : 'the cart is off';
  }
  if (BOOKING_PAGE.test(url.pathname) && request.method !== 'GET') return 'checkout';

  if (query.has('cart') || query.has('rest_api_data_id')) {
    if (!cartEnabled) return 'the cart is off';
    if (request.method !== 'GET' || !BOOKING_PAGE.test(url.pathname)) return 'not a cart address';
    // `?cart` (or none) adds to the cart and shows it; any other value is a checkout step
    if ((query.get('cart') ?? '') !== '') return 'checkout';
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
