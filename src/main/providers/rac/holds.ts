/**
 * RAC's holds (R19, decision R2): a stay put in the person's RAC cart. RAC's only hold is its
 * cart: opening a tariff's cart address (`online_cart_url` in RAC's availability answer) adds
 * the stay to a NewBook cart on the session that opened it, `persist:provider-rac`, which the
 * payment window shares. Built only while RAC's `autoCart` experiment is on (`index.ts`), and
 * written from RAC's page code alone: no cart was ever opened live (architecture-notes §12.33).
 * Every request goes through the RAC client (`client.ts`): RAC's host only, the cart guard, the
 * block cool-down, and the core's pacing, one at a time; the core sets the priority
 * (interactive, R18), nothing here does.
 *
 * **One at a time** (one cart): `create` and `release` run one after the other inside the module,
 * never together. `create` never waits: while another `create` or a `release` is in progress (or
 * waiting), it answers `in-progress` ("Your RAC cart already holds a stay…") at once and sends
 * nothing, decided before its first await, so two holds placed together (a watch's "Check now"
 * and a snipe's release) cannot both see an empty cart. `release` waits its turn instead (the
 * person asked to let a hold go): it starts once the operation before it has ended, and an
 * abort while it waits rejects at once and sends nothing.
 *
 * **`create`** (terms rules 8, 13, 15 and 16):
 * 1. One cart at a time: while the module's record (`ctx.state` `cart.current`) has not run out,
 *    `in-progress` ("Your RAC cart already holds a stay…"), with no request.
 * 2. A site needs the person's equipment (the hold-only stay fields `equipmentType`,
 *    `equipmentLength` and `equipmentWidth`, metres): without all three, `invalid`, with no
 *    request. A category is known to be a site from the checks this run (`RacCategoryMemo`);
 *    one never seen is known from the availability answer, before any cart address is opened.
 * 3. The park's cart page, `/<slug>/booking/`: a cart already holding nights is `in-progress`.
 * 4. One availability POST (the check's form) for the category (`category_id`), with a site's
 *    equipment (`equipment_type_ids`, `equipment_length`, `equipment_width`, in metres).
 * 5. The tariff the check prices the stay with (`priceTariffOf`: a members' tariff only with a
 *    member number saved, rule 14). A stay that is not bookable, or a tariff with no cart
 *    address, is `taken`. A cart address that is not RAC's `/<slug>/booking/` with `cart` and a
 *    `rest_api_data_id` is a `ProviderParseError`, and nothing is sent.
 * 6. **One GET of that cart address**, and nothing else (rule 8: no checkout, no payment, no
 *    terms box). The page it ends on must show this stay (as many booking nights as the stay,
 *    and an amount above 0), else `taken`.
 * 7. Its expiry: `cartExpiry` (the page's own countdown, else 10 minutes, flagged
 *    `expiresAtEstimated`).
 * 8. The record (park, dates, category, reference, expiry) goes in `ctx.state`, and the answer
 *    is the hold, with an opaque reference `rac-cart:<slug>:<arrival>:<random>`.
 *
 * **The token stays private.** The cart address and its `rest_api_data_id` live only in
 * `create`'s memory: never stored, returned, logged, or put in an error (an error from that GET
 * is rebuilt without them), a notification or an email.
 *
 * **An abort** before the cart address is sent leaves nothing behind; one after it clears the
 * partition's cookies (so the cart, whatever it held, is no longer this session's), then rejects.
 *
 * **`paymentUrl`** is the park's cart page, `https://parksandresorts.rac.com.au/<slug>/booking/`,
 * never the cart address (opening it again would add the stay twice). The payment window may
 * show RAC's origin only (RS4). There is no `bookedReference` (RS5): an RAC hold is never marked
 * booked or "secured"; the person looks for RAC's confirmation email.
 *
 * **`release`** (R18, also when the payment window closes: `releaseOnPaymentClose`). RAC
 * decides, as the core never takes a closed window as unpaid: one GET of the cart page; while it
 * holds this stay (its dates and category, from the record), one POST of
 * `remove_item_from_cart` (`item_offset`, `cart_type=booking`) to the page's NewBook proxy (only
 * on RAC's host, under the park's `/wp-content/themes/parks-and-resorts/inc/newbook/api/`), and
 * `released`; a cart that no longer holds it (paid, run out, removed in the window) is left as it
 * is, `gone`, so a release never touches a booking (rule 10). Both clear the record. A cart whose
 * items cannot be told apart (two of this stay, one that cannot be read, or one with this stay's
 * dates in another category, which may be this stay renamed) is left alone, and the release
 * rejects: the hold stays until it runs out. So does a block, a failed request, an abort
 * or a proxy off RAC's path; the record and the cookies stay, so the hold stays payable. At most
 * two requests, which fit a paced release's deadline (R18: 30 s and two interactive gaps).
 */

import { randomBytes } from 'crypto';
import { z } from 'zod';
import type { StayQuery } from '@shared/types/provider.types';
import { eachNight, isCalendarDate } from '@shared/utils/calendar-date';
import type { ProviderContext } from '../sdk/context';
import {
  createAbortError,
  isAbortError,
  ProviderError,
  ProviderHttpError,
  ProviderParseError,
  ProviderTimeoutError,
  throwIfAborted,
} from '../sdk/errors';
import type {
  HoldFailure,
  HoldReleaseResult,
  HoldRequest,
  HoldResult,
  HoldsModule,
  HoldSuccess,
  HoldToRelease,
} from '../sdk/provider';
import {
  availabilityForm,
  RAC_AVAILABILITY_PATH,
  stayRefusal,
  type CategoryKindOf,
} from './availability';
import { phpKey, RAC_CART_REMOVAL_QUERY } from './cart-guard';
import { cartExpiry, readCartPage, type RacCartItem } from './cart-page';
import { RAC_SITE_URL, type RacClient } from './client';
import { categoryIdOf } from './links';
import { RAC_EQUIPMENT_METRES_PATTERN, RAC_EQUIPMENT_TYPES } from './manifest';
import { categoryAvailability, petsOf, priceTariffOf, readAvailability } from './mapping';
import type { RacMembership } from './membership';
import { racPark, type RacPark } from './parks';
import type { RacCategoryMemo } from './unit-kinds';

/** Where the module keeps the cart it placed, in `ctx.state`. */
export const RAC_CART_STATE_KEY = 'cart.current';

export const RAC_ONE_CART_MESSAGE =
  'Your RAC cart already holds a stay. Pay for it or let it go first.';
export const RAC_CART_OCCUPIED_MESSAGE =
  "Your RAC cart already holds a stay, so WA Stay can't add another until RAC lets it go.";
export const RAC_EQUIPMENT_MESSAGE =
  'Add your equipment (type, length and width) to hold a site at RAC';
export const RAC_CHOOSE_CATEGORY_MESSAGE =
  'Choose what to hold at RAC: one of its categories, such as a powered site';
export const RAC_TAKEN_MESSAGE = 'RAC no longer has this stay free';
export const RAC_NOT_ADDED_MESSAGE = "RAC didn't put the stay in the cart";

const RAC_ORIGIN = new URL(RAC_SITE_URL).origin;
const REFERENCE = /^rac-cart:([a-z0-9-]+):(\d{4}-\d{2}-\d{2}):[0-9a-f]+$/;
const EQUIPMENT_TYPE_IDS = new Set(RAC_EQUIPMENT_TYPES.map((type) => type.value));
const METRES = new RegExp(`^(?:${RAC_EQUIPMENT_METRES_PATTERN})$`);
/** A cart address's token: 32 hexadecimal characters. */
const CART_TOKEN = /^[0-9a-f]{32}$/i;
/** What a park's NewBook proxy is called, under its `inc/newbook/api/`. */
const PROXY_FILE = /^[a-z0-9-]+\.php$/;

/** The cart the module placed, as kept in `ctx.state`: never the cart address or its token. */
export interface RacCartRecord {
  reference: string;
  slug: string;
  /** Calendar dates `YYYY-MM-DD`. */
  arrival: string;
  departure: string;
  categoryId: string;
  /** RAC's name for the category, as the cart shows it. */
  categoryName: string;
  /** ISO timestamp. */
  expiresAt: string;
}

const RecordSchema = z.object({
  reference: z.string().regex(REFERENCE),
  slug: z.string().min(1),
  arrival: z.string().refine(isCalendarDate),
  departure: z.string().refine(isCalendarDate),
  categoryId: z.string().regex(/^\d+$/),
  categoryName: z.string(),
  expiresAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
});

/** Just enough of an availability answer to find a tariff's cart address, by position. */
const CartAnswerSchema = z.object({
  data: z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]).nullish(),
});
const CartCategorySchema = z.object({
  category_id: z.union([z.number(), z.string()]),
  tariffs_available: z.array(z.object({ online_cart_url: z.unknown().optional() })).nullish(),
});

/** The person's equipment, as RAC's form takes it. */
interface Equipment {
  typeId: string;
  /** Metres, as typed ("6.5"). */
  length: string;
  width: string;
}

/** The stay's equipment: all three fields, none of them, or something RAC's form can't take. */
export function equipmentOf(stay: Pick<StayQuery, 'params'>): Equipment | 'none' | 'invalid' {
  const params = stay.params ?? {};
  const values = [params.equipmentType, params.equipmentLength, params.equipmentWidth];
  if (values.every((value) => value === undefined || value === '')) return 'none';
  const [typeId, length, width] = values.map((value) =>
    typeof value === 'number' ? String(value) : value
  );
  const metres = (value: unknown): value is string =>
    typeof value === 'string' && METRES.test(value) && Number(value) > 0;
  if (typeof typeId !== 'string' || !EQUIPMENT_TYPE_IDS.has(typeId)) return 'invalid';
  if (!metres(length) || !metres(width)) return 'invalid';
  return { typeId, length, width };
}

/** The park a hold's reference names, if the reference is one of the module's. */
export function slugOfReference(reference: string): string | undefined {
  return REFERENCE.exec(reference)?.[1];
}

/** The park's cart page: where the person pays, and what a release reads. */
export function racCartPage(slug: string): string {
  return `${RAC_SITE_URL}/${slug}/booking/`;
}

/**
 * Settles with `pending`, or rejects with an AbortError as soon as `signal` aborts (`pending`
 * still settles, handled).
 */
function abortable<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(createAbortError(signal));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
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

/** `url` without its query and fragment. */
function withoutQuery(url: string): string {
  const at = url.search(/[?#]/);
  return at < 0 ? url : url.slice(0, at);
}

/** The same name, ignoring case and runs of white space. */
const sameName = (a: string, b: string): boolean =>
  a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

export interface RacHoldsDeps {
  ctx: Pick<ProviderContext, 'id' | 'manifest' | 'clock' | 'state' | 'logger' | 'http'>;
  client: RacClient;
  membership: Pick<RacMembership, 'read'>;
  /** What each category is, from this run's checks. */
  categories: Pick<RacCategoryMemo, 'recall'>;
  /** A category's kind, from its name and type (`createKindResolver`). */
  kindOf: CategoryKindOf;
  /** The random part of a reference (default: 6 random bytes, as hex). */
  random?: () => string;
}

/** RAC's holds module: `release` always, `bookedReference` never. */
export type RacHolds = HoldsModule & Required<Pick<HoldsModule, 'release'>>;

export function createRacHolds(deps: RacHoldsDeps): RacHolds {
  const { ctx, client, membership, categories, kindOf } = deps;
  const random = deps.random ?? (() => randomBytes(6).toString('hex'));
  const name = ctx.manifest.name;

  const fail = (reason: HoldFailure['reason'], message: string): HoldFailure => ({
    ok: false,
    reason,
    message,
  });
  const refuse = (message: string): ProviderError =>
    new ProviderError({ providerId: ctx.id, message: `${name}: ${message}` });

  async function readRecord(): Promise<RacCartRecord | undefined> {
    const stored = await ctx.state.get<unknown>(RAC_CART_STATE_KEY);
    const parsed = RecordSchema.safeParse(stored);
    return parsed.success ? parsed.data : undefined;
  }

  /** An error from the cart address's GET, or after it, without the address or its token. */
  function privately(error: unknown, address: string): unknown {
    if (isAbortError(error) || !(error instanceof Error)) return error;
    const token = new URL(address).searchParams.get('rest_api_data_id') ?? '';
    const scrub = (text: string): string => {
      let clean = text.split(address).join('<cart address>');
      if (token) clean = clean.split(token).join('<redacted>');
      return clean;
    };
    if (error instanceof ProviderHttpError) {
      return new ProviderHttpError({
        providerId: ctx.id,
        status: error.status,
        url: withoutQuery(error.url),
        reason: error.reason,
        netError: error.netError,
        retryable: error.retryable,
        message: scrub(error.message),
      });
    }
    if (error instanceof ProviderTimeoutError) {
      return new ProviderTimeoutError({
        providerId: ctx.id,
        url: withoutQuery(error.url),
        timeoutMs: error.timeoutMs,
      });
    }
    if (error instanceof ProviderError) {
      return new ProviderError({
        providerId: ctx.id,
        code: error.code,
        retryable: error.retryable,
        message: scrub(error.message),
      });
    }
    return new ProviderError({ providerId: ctx.id, message: scrub(error.message) });
  }

  /** Clears the partition's cookies: a cart this session may hold is no longer reachable. */
  async function dropSession(): Promise<void> {
    try {
      await ctx.http.cookies.clear();
    } catch (error) {
      ctx.logger.warn(
        `Could not clear RAC's cookies after a stopped hold (${error instanceof Error ? error.name : typeof error})`
      );
    }
  }

  /** The cart address of the tariff at `index` of the category in `body`, unchecked. */
  function cartAddressAt(body: string, categoryId: string, index: number): unknown {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return undefined;
    }
    const answer = CartAnswerSchema.safeParse(json);
    if (!answer.success || !answer.data.data) return undefined;
    const data = answer.data.data;
    for (const raw of Array.isArray(data) ? data : Object.values(data)) {
      const category = CartCategorySchema.safeParse(raw);
      if (category.success && String(category.data.category_id) === categoryId) {
        return category.data.tariffs_available?.[index]?.online_cart_url;
      }
    }
    return undefined;
  }

  /** `value` as a cart address of `park` on RAC's host, else undefined (nothing is sent). */
  function checkedCartAddress(value: string, park: RacPark): string | undefined {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return undefined;
    }
    const query = url.searchParams;
    // `cart` and `rest_api_data_id` once each, as written: no `cart[]`, `rest.api.data.id` or a
    // second `cart`, which PHP would read as the same names
    const names = [...query.keys()];
    const cartNames = names.filter((n) => ['cart', 'rest_api_data_id'].includes(phpKey(n)));
    const onRac =
      url.protocol === 'https:' &&
      url.origin === RAC_ORIGIN &&
      !url.username &&
      !url.password &&
      url.pathname === `/${park.slug}/booking/` &&
      cartNames.length === 2 &&
      cartNames.every((n) => n === 'cart' || n === 'rest_api_data_id') &&
      query.getAll('cart').length === 1 &&
      query.get('cart') === '' &&
      query.getAll('rest_api_data_id').length === 1 &&
      CART_TOKEN.test(query.get('rest_api_data_id') ?? '');
    return onRac ? url.href : undefined;
  }

  /** The park's NewBook proxy for a removal, from the cart page, else undefined. */
  function removalAddress(apiPath: string | undefined, park: RacPark): string | undefined {
    if (!apiPath) return undefined;
    let url: URL;
    try {
      url = new URL(apiPath);
    } catch {
      return undefined;
    }
    const folder = `/${park.slug}/wp-content/themes/parks-and-resorts/inc/newbook/api/`;
    const onPath =
      url.protocol === 'https:' &&
      url.origin === RAC_ORIGIN &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith(folder) &&
      PROXY_FILE.test(url.pathname.slice(folder.length)) &&
      url.search === '' &&
      url.hash === '';
    if (!onPath) return undefined;
    url.search = `newbook_api_action=data&query=${RAC_CART_REMOVAL_QUERY}`;
    return url.href;
  }

  // One at a time: the operations in progress or waiting, and the end of the last one's turn
  let busy = 0;
  let tail: Promise<void> = Promise.resolve();

  /**
   * Waits for the operation before this one to end (an abort while waiting rejects at once),
   * and answers the function that ends this one's turn.
   */
  async function turn(signal?: AbortSignal): Promise<() => void> {
    const before = tail;
    let end!: () => void;
    tail = new Promise<void>((resolve) => {
      end = resolve;
    });
    try {
      await abortable(before, signal);
    } catch (error) {
      // Given up while waiting: the turn passes on once the one before has ended
      void before.then(end);
      throw error;
    }
    return end;
  }

  async function create(request: HoldRequest, signal?: AbortSignal): Promise<HoldResult> {
    throwIfAborted(signal);
    // Decided before any await: another create or a release in progress means one cart already
    if (busy > 0) return fail('in-progress', RAC_ONE_CART_MESSAGE);
    busy++;
    try {
      const end = await turn(signal);
      try {
        return await placeHold(request, signal);
      } finally {
        end();
      }
    } finally {
      busy--;
    }
  }

  async function release(hold: HoldToRelease, signal?: AbortSignal): Promise<HoldReleaseResult> {
    throwIfAborted(signal);
    // Counted at once, so a create meanwhile answers in-progress; it waits its own turn
    busy++;
    try {
      const end = await turn(signal);
      try {
        return await letGo(hold, signal);
      } finally {
        end();
      }
    } finally {
      busy--;
    }
  }

  async function placeHold(request: HoldRequest, signal?: AbortSignal): Promise<HoldResult> {
    throwIfAborted(signal);
    const current = await readRecord();
    throwIfAborted(signal);
    const now = ctx.clock();
    // 1. One cart at a time
    if (current && Date.parse(current.expiresAt) > now.getTime()) {
      return fail('in-progress', RAC_ONE_CART_MESSAGE);
    }
    const { externalId, unitId, stay } = request;
    const park = racPark(externalId);
    if (!park) return fail('invalid', `RAC has no park "${externalId}"`);
    const refusal = stayRefusal(stay);
    if (refusal) return fail('invalid', `${name}: ${refusal}`);
    const categoryId = categoryIdOf(unitId);
    if (!categoryId || !unitId) return fail('invalid', RAC_CHOOSE_CATEGORY_MESSAGE);
    // 2. A site needs the equipment, before anything is asked
    // (A cabin's or a room's needs none: whatever equipment the stay has is not sent)
    const equipment = equipmentOf(stay);
    const known = categories.recall(park.slug, categoryId);
    if (known?.kind === 'campsite' && typeof equipment !== 'object') {
      return fail('invalid', RAC_EQUIPMENT_MESSAGE);
    }

    let address: string | undefined;
    let addressSent = false;
    try {
      // 3. The cart page: a cart that holds nights already is someone's
      const cartPage = await client.getPage(`/${park.slug}/booking/`, { signal });
      throwIfAborted(signal);
      const before = readCartPage(cartPage.body);
      if (!before) {
        throw new ProviderParseError({
          providerId: ctx.id,
          url: withoutQuery(cartPage.url),
          message: `${name}: ${park.name}'s booking page shows no cart`,
        });
      }
      if (before.bookingNights > 0 || before.items.length > 0) {
        return fail('in-progress', RAC_CART_OCCUPIED_MESSAGE);
      }

      // 4. One availability POST for the category, with a site's equipment
      // A known site, or a category not seen yet when the person gave equipment
      const fit =
        typeof equipment === 'object' && (!known || known.kind === 'campsite')
          ? equipment
          : undefined;
      const form = {
        ...availabilityForm(park, stay, petsOf(stay) ?? 0),
        category_id: categoryId,
        ...(fit
          ? {
              equipment_type_ids: fit.typeId,
              equipment_measurement_unit: 'm',
              equipment_length: fit.length,
              equipment_width: fit.width,
            }
          : {}),
      };
      const answer = await client.postAjax(RAC_AVAILABILITY_PATH, form, {
        referer: `${ctx.manifest.website}/${park.slug}/book-now/`,
        signal,
      });
      throwIfAborted(signal);
      const reading = readAvailability(answer.body);
      if (!reading.ok) {
        throw new ProviderParseError({
          providerId: ctx.id,
          url: withoutQuery(answer.url),
          message: `${name}: no availability for ${park.name}: ${reading.why}`,
        });
      }
      const category = reading.categories.find((c) => String(c.category_id) === categoryId);
      if (!category) return fail('taken', RAC_TAKEN_MESSAGE);
      const kind =
        known?.kind ??
        kindOf(park, {
          catId: categoryId,
          name: category.category_name,
          typeId: category.category_type_id,
        });
      if (kind === 'campsite' && !fit) return fail('invalid', RAC_EQUIPMENT_MESSAGE);

      // 5. The tariff the check prices it with; a members' one only with a number (rule 14)
      const member = await membership.read();
      throwIfAborted(signal);
      const nights = eachNight(stay.arrival, stay.departure);
      const tariffs = category.tariffs_available ?? [];
      const tariff = priceTariffOf(tariffs, member);
      const bookable = categoryAvailability(category, nights, { member }).fullyAvailable;
      if (!tariff || !bookable) return fail('taken', RAC_TAKEN_MESSAGE);
      const raw = cartAddressAt(answer.body, categoryId, tariffs.indexOf(tariff));
      if (raw === undefined || raw === null || raw === '') return fail('taken', RAC_TAKEN_MESSAGE);
      address = typeof raw === 'string' ? checkedCartAddress(raw, park) : undefined;
      if (!address) {
        throw new ProviderParseError({
          providerId: ctx.id,
          message: `${name}: ${park.name}'s cart address is not RAC's booking page; nothing was sent`,
        });
      }

      // 6. One GET of the cart address, and nothing else
      const added = await client.getPage(address, {
        signal,
        onSend: () => {
          addressSent = true;
        },
      });
      throwIfAborted(signal);
      const after = readCartPage(added.body);
      if (!after || after.bookingNights !== nights.length || !(after.amount > 0)) {
        return fail('taken', RAC_NOT_ADDED_MESSAGE);
      }

      // 7 and 8. Its expiry, and the record
      const { expiresAt, estimated } = cartExpiry(after, ctx.clock());
      const reference = `rac-cart:${park.slug}:${stay.arrival}:${random()}`;
      const record: RacCartRecord = {
        reference,
        slug: park.slug,
        arrival: stay.arrival,
        departure: stay.departure,
        categoryId,
        categoryName: category.category_name,
        expiresAt: expiresAt.toISOString(),
      };
      await ctx.state.set(RAC_CART_STATE_KEY, record);
      ctx.logger.info(
        `Put a stay at ${park.slug} (${stay.arrival} to ${stay.departure}) in the cart, ` +
          `held until ${record.expiresAt}${estimated ? ' (estimated)' : ''}`
      );
      const hold: HoldSuccess = {
        ok: true,
        reference,
        expiresAt,
        ...(estimated ? { expiresAtEstimated: true } : {}),
        unitId,
      };
      return hold;
    } catch (error) {
      if (addressSent && (signal?.aborted || isAbortError(error))) await dropSession();
      throw address ? privately(error, address) : error;
    }
  }

  /** Whether `item` is the stay `record` placed: its dates and its category. */
  const isThisStay = (item: RacCartItem, record: RacCartRecord): boolean =>
    item.arrival === record.arrival &&
    item.departure === record.departure &&
    item.category !== undefined &&
    sameName(item.category, record.categoryName);

  async function letGo(hold: HoldToRelease, signal?: AbortSignal): Promise<HoldReleaseResult> {
    throwIfAborted(signal);
    const stored = await readRecord();
    throwIfAborted(signal);
    const record = stored?.reference === hold.reference ? stored : undefined;
    const slug = record?.slug ?? slugOfReference(hold.reference);
    const park = slug ? racPark(slug) : undefined;
    if (!park) throw refuse("can't tell which park's cart holds this stay");
    const forget = async (): Promise<void> => {
      if (record) await ctx.state.delete(RAC_CART_STATE_KEY);
    };
    try {
      const page = await client.getPage(`/${park.slug}/booking/`, { signal });
      throwIfAborted(signal);
      const cart = readCartPage(page.body);
      if (!cart) {
        throw new ProviderParseError({
          providerId: ctx.id,
          url: withoutQuery(page.url),
          message: `${name}: ${park.name}'s booking page shows no cart`,
        });
      }
      // An empty cart: paid, run out or removed in the window. Nothing to let go.
      if (cart.bookingNights <= 0 && cart.items.length === 0) {
        await forget();
        return { outcome: 'gone' };
      }
      const unreadable = cart.items.length === 0 || cart.items.some((item) => !isReadable(item));
      if (!record || unreadable) {
        throw refuse("can't tell which item in the cart is this stay; it stays until it runs out");
      }
      const mine = cart.items.filter((item) => isThisStay(item, record));
      // An item with this stay's dates in another category may be this stay, renamed: leave it
      const sameDates = cart.items.some(
        (item) => item.arrival === record.arrival && item.departure === record.departure
      );
      if (mine.length === 0 && sameDates) {
        throw refuse("can't tell which item in the cart is this stay; it stays until it runs out");
      }
      if (mine.length === 0) {
        await forget();
        return { outcome: 'gone' };
      }
      if (mine.length > 1) {
        throw refuse("can't tell which item in the cart is this stay; it stays until it runs out");
      }
      const removal = removalAddress(cart.newbookApiPath, park);
      if (!removal) {
        throw refuse(`${park.name}'s cart page points somewhere else to remove a stay`);
      }
      await client.postAjax(
        removal,
        { item_offset: mine[0].offset, cart_type: 'booking' },
        { referer: racCartPage(park.slug), signal }
      );
      await forget();
      ctx.logger.info(`Took the stay at ${park.slug} out of the cart`);
      return { outcome: 'released' };
    } catch (error) {
      if (!signal?.aborted && !isAbortError(error)) {
        const why =
          error instanceof ProviderHttpError && error.status > 0
            ? `HTTP ${error.status}`
            : error instanceof Error
              ? error.name
              : typeof error;
        ctx.logger.warn(
          `The stay at ${park.slug} could not be taken out of the cart (${why}); it stays until it runs out`
        );
      }
      throw error;
    }
  }

  return {
    create,
    paymentUrl: (hold: HoldSuccess) => {
      const slug = slugOfReference(hold.reference);
      return slug && racPark(slug) ? racCartPage(slug) : `${RAC_SITE_URL}/`;
    },
    paymentOrigins: [RAC_ORIGIN],
    release,
    releaseOnPaymentClose: true,
  };
}

/** An item whose dates and category the cart shows. */
const isReadable = (item: RacCartItem): boolean =>
  item.arrival !== undefined && item.departure !== undefined && item.category !== undefined;
