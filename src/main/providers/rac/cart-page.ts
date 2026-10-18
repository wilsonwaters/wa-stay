/**
 * RAC's cart page, `GET /<slug>/booking/` with no query: NewBook's online engine rendered by
 * WordPress, showing the session's cart (`page_action = 'cart'`). Read from RAC's NewBook scripts
 * (`ai-state/research/rac-booking-flow.md` §6; `process.min.js`, `nb_common.min.js`) and the
 * empty cart page seen during research; a cart holding a stay was never opened live, so the
 * fixtures that show one are synthetic.
 *
 * - **`cart_breakdown`**, a script variable (JSON): one entry per cart step. Its booking nights
 *   are the sum of the entries' `totalBookingNights`, and its amount the sum of their `amount`,
 *   as NewBook's `fetchCartBreakdown` adds them.
 * - **The hold fields**, hidden inputs NewBook's hold timer reads: `hold_ids[]` (one per held
 *   item), `earliest_hold_expires_when` (seconds left) and `default_hold_duration` (minutes).
 * - **`newbook_api_path`**, a script variable: the park's NewBook proxy, which RAC's own removal
 *   posts to (`newbook_api_path + 'newbook_api_action=data&query=remove_item_from_cart'`).
 * - **The items**, from the cart's sidebar: each removal link (`.remove_booking_from_cart`) has
 *   its item offset as `rel`, and the item's category name, arrival and departure are in
 *   `.booking_<offset>_category .sidebar_category_name`, `.booking_<offset>_arrival` and
 *   `.booking_<offset>_departure` (what RAC's own "Remove booking" dialog reads).
 *
 * A page with no `cart_breakdown` (a redesign, an error page) is no cart page: `undefined`.
 */

import { findAll, hasClass, parseHtml, textOf, type HtmlElement } from './book-now';

/** One item in the cart, as its sidebar shows it. Dates are calendar dates `YYYY-MM-DD`. */
export interface RacCartItem {
  /** NewBook's item offset, which a removal sends as `item_offset`. */
  offset: string;
  /** The category's name, as RAC names it ("Powered Site"); undefined when the page has none. */
  category?: string;
  arrival?: string;
  departure?: string;
}

export interface RacCartPage {
  /** The cart's booking nights (`cart_breakdown`): 0 for an empty cart. */
  bookingNights: number;
  /** The cart's amount, in dollars (`cart_breakdown`). */
  amount: number;
  /** NewBook's held items (`hold_ids[]`). */
  holdIds: string[];
  /** Seconds until the first hold runs out (`earliest_hold_expires_when`), when given. */
  earliestHoldExpiresWhen?: number;
  /** How long a hold lasts, in minutes (`default_hold_duration`), when given. */
  defaultHoldDuration?: number;
  /** The park's NewBook proxy, as the page gives it (`newbook_api_path`), unchecked. */
  newbookApiPath?: string;
  items: RacCartItem[];
}

/** What a hold lasts when the cart page shows no countdown: a guess (RS5). */
export const RAC_ESTIMATED_HOLD_MS = 10 * 60_000;
/** The longest a cart page's own expiry may be: a day. Anything longer is no answer. */
const MAX_HOLD_SECONDS = 24 * 60 * 60;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * A date as the cart shows it ("Fri 6 Nov 2026", "6 November 2026", "06/11/2026" or
 * "2026-11-06") as a calendar date, or undefined.
 */
export function cartDate(text: string): string | undefined {
  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  const named = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})\b/.exec(text);
  const slashed = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(text);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (named) {
    const at = MONTHS.indexOf(named[2].toLowerCase());
    if (at >= 0) [year, month, day] = [Number(named[3]), at + 1, Number(named[1])];
  } else if (slashed) {
    [year, month, day] = [Number(slashed[3]), Number(slashed[2]), Number(slashed[1])];
  }
  if (year === undefined || month === undefined || day === undefined) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** A number from an input or a variable: a finite number, else undefined. */
function numberOf(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(value)) return Number(value);
  return undefined;
}

/** `cart_breakdown`'s nights and amount, or undefined when the page has none. */
function readBreakdown(html: string): { nights: number; amount: number } | undefined {
  const match = /\bcart_breakdown\s*=\s*(\{.*\})\s*;?\s*$/m.exec(html);
  if (!match) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  let nights = 0;
  let amount = 0;
  for (const entry of Object.values(parsed)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { totalBookingNights, amount: entryAmount } = entry as Record<string, unknown>;
    nights += Math.trunc(numberOf(totalBookingNights) ?? 0);
    amount += numberOf(entryAmount) ?? 0;
  }
  return { nights, amount };
}

/** The value of a hidden input named exactly `name`, if any. */
function inputValue(inputs: readonly HtmlElement[], name: string): string | undefined {
  return inputs.find((input) => input.attribs.name === name)?.attribs.value;
}

/** The cart's items, from its sidebar's removal links and their category and dates. */
function readItems(root: HtmlElement): RacCartItem[] {
  const offsets: string[] = [];
  for (const link of findAll(root, hasClass('remove_booking_from_cart'))) {
    const offset = link.attribs.rel?.trim();
    if (offset !== undefined && /^\d+$/.test(offset) && !offsets.includes(offset)) {
      offsets.push(offset);
    }
  }
  return offsets.map((offset) => {
    const item: RacCartItem = { offset };
    const [categoryBox] = findAll(root, hasClass(`booking_${offset}_category`));
    const [name] = categoryBox ? findAll(categoryBox, hasClass('sidebar_category_name')) : [];
    const category = name ? textOf(name) : '';
    if (category) item.category = category;
    const [arrival] = findAll(root, hasClass(`booking_${offset}_arrival`));
    const [departure] = findAll(root, hasClass(`booking_${offset}_departure`));
    const arrivalDate = arrival ? cartDate(textOf(arrival)) : undefined;
    const departureDate = departure ? cartDate(textOf(departure)) : undefined;
    if (arrivalDate) item.arrival = arrivalDate;
    if (departureDate) item.departure = departureDate;
    return item;
  });
}

/** The cart page's cart, or undefined when `html` is no cart page (no `cart_breakdown`). */
export function readCartPage(html: string): RacCartPage | undefined {
  const breakdown = readBreakdown(html);
  if (!breakdown) return undefined;
  const root = parseHtml(html);
  const inputs = findAll(root, (element) => element.tag === 'input');
  const holdIds = inputs
    .filter((input) => (input.attribs.name ?? '').includes('hold_ids'))
    .map((input) => (input.attribs.value ?? '').trim())
    .filter(Boolean);
  const page: RacCartPage = {
    bookingNights: breakdown.nights,
    amount: breakdown.amount,
    holdIds,
    items: readItems(root),
  };
  const earliest = numberOf(inputValue(inputs, 'earliest_hold_expires_when'));
  if (earliest !== undefined) page.earliestHoldExpiresWhen = earliest;
  const duration = numberOf(inputValue(inputs, 'default_hold_duration'));
  if (duration !== undefined) page.defaultHoldDuration = duration;
  const apiPath = /\bnewbook_api_path\s*=\s*(['"])([^'"]*)\1/.exec(html)?.[2];
  if (apiPath) page.newbookApiPath = apiPath;
  return page;
}

/** A number of seconds a hold can last: more than 0, at most a day. */
const isHoldSeconds = (seconds: number): boolean => seconds >= 1 && seconds <= MAX_HOLD_SECONDS;

/**
 * When the cart's hold runs out, from the page the cart address ended on:
 * - the page holds items (`hold_ids`) and says how long the first has left
 *   (`earliest_hold_expires_when`, seconds): then;
 * - the page holds items but gives no seconds left: `default_hold_duration` minutes from now;
 * - otherwise (no held item, which NewBook shows no timer for, or a time outside 1 s to a day):
 *   `RAC_ESTIMATED_HOLD_MS` from now, flagged as an estimate.
 */
export function cartExpiry(
  page: Pick<RacCartPage, 'holdIds' | 'earliestHoldExpiresWhen' | 'defaultHoldDuration'>,
  now: Date
): { expiresAt: Date; estimated: boolean } {
  const estimate = { expiresAt: new Date(now.getTime() + RAC_ESTIMATED_HOLD_MS), estimated: true };
  if (page.holdIds.length === 0) return estimate;
  const { earliestHoldExpiresWhen: seconds, defaultHoldDuration: minutes } = page;
  if (seconds !== undefined) {
    return isHoldSeconds(seconds)
      ? { expiresAt: new Date(now.getTime() + seconds * 1_000), estimated: false }
      : estimate;
  }
  if (minutes !== undefined && isHoldSeconds(minutes * 60)) {
    return { expiresAt: new Date(now.getTime() + minutes * 60_000), estimated: false };
  }
  return estimate;
}
