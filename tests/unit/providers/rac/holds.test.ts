/**
 * RAC's auto-cart (`src/main/providers/rac/holds.ts`, R19) on the synthetic cart fixtures
 * (`tests/fixtures/providers/rac/cart/`, written from RAC's NewBook scripts, never recorded),
 * answered by a `FixtureHttpClient` from a temp folder of routes, with a fixed clock. No cart is
 * ever opened: every cart address in these tests carries the made-up token of 32 zeros, and
 * nothing leaves the fixtures.
 *
 * - `create`: exactly three requests (the cart page, one availability POST, one GET of the cart
 *   address) and the expiry from the page's countdown, its minutes, or a flagged 10-minute
 *   estimate; one cart at a time (`in-progress` with no request, or after the cart page); a site
 *   needs its equipment (`invalid` before any request); `taken` for no bookable tariff and for a
 *   cart RAC refused; a site's form and the member's tariff; blocks (403, 429, a challenge) and
 *   the cool-down; aborts before, between and after the cart address (cookies cleared after);
 *   the cart address and its token in no result, state, log line or error.
 * - One at a time (R19 review): two creates together, or one during another's requests, place
 *   one hold (three requests) and the other answers `in-progress` and sends nothing; a create
 *   during a release does the same; a release during a create waits its turn, and one called
 *   off while it waits sends nothing and passes its turn on.
 * - `paymentUrl`: every park's cart page, never a cart address.
 * - `release`: one GET and one POST of `remove_item_from_cart` (`item_offset`, `cart_type`) to
 *   the page's proxy while the cart holds the stay (`released`); the GET only for an emptied cart
 *   (`gone`); a proxy off RAC's path, a cart it can't tell apart, a block or no answer: rejected,
 *   the record and the cookies kept.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyExperiments } from '@main/providers/experiments';
import { RAC_PARKS, racManifest } from '@main/providers/rac';
import { RAC_AVAILABILITY_PATH } from '@main/providers/rac/availability';
import { RAC_BLOCK_COOLDOWN_MS, RAC_BLOCK_STATE_KEY, RacClient } from '@main/providers/rac/client';
import {
  createRacHolds,
  equipmentOf,
  RAC_CART_OCCUPIED_MESSAGE,
  RAC_CART_STATE_KEY,
  RAC_CHOOSE_CATEGORY_MESSAGE,
  RAC_EQUIPMENT_MESSAGE,
  RAC_NOT_ADDED_MESSAGE,
  RAC_ONE_CART_MESSAGE,
  RAC_TAKEN_MESSAGE,
  racCartPage,
  slugOfReference,
  type RacCartRecord,
  type RacHolds,
} from '@main/providers/rac/holds';
import { createMembership } from '@main/providers/rac/membership';
import { createCategoryMemo, createKindResolver } from '@main/providers/rac/unit-kinds';
import {
  InMemoryKeyValueStore,
  isAbortError,
  ProviderError,
  ProviderHttpError,
  ProviderParseError,
  type HttpMethod,
  type HttpRequestOptions,
  type HttpResponse,
  type ProviderContext,
} from '@main/providers/sdk';
import {
  FixtureHttpClient,
  UnexpectedNetworkRequestError,
  type FixtureRoute,
} from '@main/testing/fixture-http-client';
import type { StayQuery } from '@shared/types/provider.types';
import {
  createMemoryLogger,
  createTestProviderContext,
  type MemoryLogger,
} from '@tests/utils/fake-provider';

const RAC = 'https://parksandresorts.rac.com.au';
const CART_FIXTURES = path.join(__dirname, '../../../fixtures/providers/rac/cart');
const RAC_FIXTURES = path.join(__dirname, '../../../fixtures/providers/rac');
const ZERO_TOKEN = '0'.repeat(32);
/** 10 am in Perth, 17 Oct 2026. */
const NOW = new Date('2026-10-17T02:00:00.000Z');
const MINUTE = 60_000;
const PROXY_PATH =
  '/busselton/wp-content/themes/parks-and-resorts/inc/newbook/api/rac-busselton-holiday-park.php';
const CART_PAGE = `${RAC}/busselton/booking/`;
const cartAddress = (rand: number) =>
  `${CART_PAGE}?cart&rest_api_data_id=${ZERO_TOKEN}&rand=${rand}`;
/** The person's equipment: a caravan with an awning, 6.5 by 2.5 metres. */
const EQUIPMENT = { equipmentType: '1', equipmentLength: '6.5', equipmentWidth: '2.5' };
const STAY: StayQuery = {
  arrival: '2026-11-06',
  departure: '2026-11-08',
  adults: 2,
  params: { pets: 0, ...EQUIPMENT },
};
const POWERED: Parameters<RacHolds['create']>[0] = {
  externalId: 'busselton',
  unitId: 'cat:4',
  stay: STAY,
};
const RECORD: RacCartRecord = {
  reference: 'rac-cart:busselton:2026-11-06:0a1b2c3d4e5f',
  slug: 'busselton',
  arrival: '2026-11-06',
  departure: '2026-11-08',
  categoryId: '4',
  categoryName: 'Powered Site',
  expiresAt: new Date(NOW.getTime() + 15 * MINUTE).toISOString(),
};
const HOLD = {
  reference: RECORD.reference,
  unitId: 'cat:4',
  expiresAt: new Date(RECORD.expiresAt),
};

interface Sent {
  method: HttpMethod;
  url: string;
  body?: string;
}

/**
 * A FixtureHttpClient that records each request and can abort a controller once a request to
 * an address matching `abortAfter` has been answered.
 */
class RecordingFixtureClient extends FixtureHttpClient {
  readonly sent: Sent[] = [];
  abortAfter?: { match: RegExp; controller: AbortController };
  /** Requests to a matching address fail as fixture mode fails one: naming the address. */
  refuse?: RegExp;
  /** Called as each request is sent, before it is answered. */
  onRequest?: (url: string) => void;

  override async request(
    method: HttpMethod,
    url: string,
    options: HttpRequestOptions = {}
  ): Promise<HttpResponse> {
    this.sent.push({
      method,
      url,
      ...(options.body === undefined ? {} : { body: String(options.body) }),
    });
    this.onRequest?.(url);
    if (this.refuse?.test(url)) {
      throw new UnexpectedNetworkRequestError({
        providerId: 'rac',
        method,
        url,
        manifest: 'rac/manifest.json',
      });
    }
    const response = await super.request(method, url, options);
    if (this.abortAfter?.match.test(url)) this.abortAfter.controller.abort();
    return response;
  }
}

let dir: string;
let http: RecordingFixtureClient;
let state: InMemoryKeyValueStore;
let logger: MemoryLogger;
let ctx: ProviderContext;
let holds: RacHolds;
let member: boolean;
let now: Date;

/** Copies a cart fixture into the temp folder, changed by `edit`; returns its name there. */
function fixture(file: string, edit: (text: string) => string = (text) => text, as = file): string {
  const from = fs.existsSync(path.join(CART_FIXTURES, file))
    ? path.join(CART_FIXTURES, file)
    : path.join(RAC_FIXTURES, file);
  fs.writeFileSync(path.join(dir, 'rac', as), edit(fs.readFileSync(from, 'utf8')));
  return as;
}

interface Answers {
  /** The cart page before (GET /busselton/booking/ with no query). */
  cartPage?: Partial<FixtureRoute>;
  /** The availability POST. */
  availability?: Partial<FixtureRoute>;
  /** The cart address of each tariff, by its `rand`. */
  cartAddress?: Partial<FixtureRoute>;
  /** The proxy's removal. */
  removal?: Partial<FixtureRoute>;
}

/** The routes: the cart address first (a route with no query matches any). */
function answer(answers: Answers = {}): void {
  const routes: FixtureRoute[] = [];
  for (const rand of ['1001', '1002', '1003']) {
    routes.push({
      method: 'GET',
      path: '/busselton/booking/',
      query: { rand },
      file: fixture('cart-page-one-stay.html'),
      ...answers.cartAddress,
    });
  }
  routes.push(
    {
      method: 'GET',
      path: '/busselton/booking/',
      file: fixture('cart-page-empty.html'),
      ...answers.cartPage,
    },
    {
      method: 'POST',
      path: RAC_AVAILABILITY_PATH,
      form: { blog_id: '6', available_from: '6 Nov 2026' },
      file: fixture('availability-busselton-2026-11-06-2n.json'),
      ...answers.availability,
    },
    {
      method: 'POST',
      path: PROXY_PATH,
      query: { newbook_api_action: 'data', query: 'remove_item_from_cart' },
      file: fixture('remove-item-from-cart.json'),
      ...answers.removal,
    }
  );
  fs.writeFileSync(path.join(dir, 'rac', 'manifest.json'), JSON.stringify({ routes }));
}

/** The holds module (auto-cart on), with Busselton's powered site and cabin seen in a check. */
function setUp(answers: Answers = {}): void {
  answer(answers);
  http = new RecordingFixtureClient({
    providerId: 'rac',
    fixturesDir: dir,
    logFile: path.join(dir, 'unexpected.log'),
  });
  state = new InMemoryKeyValueStore();
  logger = createMemoryLogger();
  const manifest = applyExperiments(racManifest, ['autoCart']);
  ctx = createTestProviderContext(manifest, { http, state, logger, clock: () => now });
  const client = new RacClient({
    providerId: 'rac',
    providerName: manifest.name,
    http,
    state,
    logger,
    clock: () => now,
    timezone: 'Australia/Perth',
    maxConcurrent: 1,
    cartEnabled: true,
  });
  const categories = createCategoryMemo();
  categories.remember('busselton', '4', { name: 'Powered Site', kind: 'campsite' });
  categories.remember('busselton', '7', { name: 'Ensuite Site', kind: 'campsite' });
  categories.remember('busselton', '9', { name: 'Two Bedroom Cabin (Sleeps 4)', kind: 'cabin' });
  holds = createRacHolds({
    ctx,
    client,
    membership: createMembership(async () => member),
    categories,
    kindOf: createKindResolver(() => undefined),
    random: () => '0a1b2c3d4e5f',
  });
}

const paths = () => http.sent.map((r) => `${r.method} ${r.url.replace(RAC, '')}`);
const cartAddresses = () => http.sent.filter((r) => /rest_api_data_id/.test(r.url));
const logText = () => JSON.stringify(logger.lines);
/** What `pending` rejected with. */
async function rejection(pending: Promise<unknown>): Promise<unknown> {
  return pending.then(
    () => 'resolved',
    (error: unknown) => error
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-holds-'));
  fs.mkdirSync(path.join(dir, 'rac'));
  member = false;
  now = NOW;
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('create: the cart', () => {
  it('sends exactly three requests (the cart page, one availability POST, one GET of the cart address) and holds until the countdown ends', async () => {
    setUp();

    const hold = await holds.create(POWERED);

    expect(paths()).toEqual([
      'GET /busselton/booking/',
      `POST ${RAC_AVAILABILITY_PATH}`,
      `GET /busselton/booking/?cart&rest_api_data_id=${ZERO_TOKEN}&rand=1001`,
    ]);
    // `earliest_hold_expires_when` 900 s left
    expect(hold).toEqual({
      ok: true,
      reference: 'rac-cart:busselton:2026-11-06:0a1b2c3d4e5f',
      expiresAt: new Date(NOW.getTime() + 15 * MINUTE),
      unitId: 'cat:4',
    });
    expect(await state.get(RAC_CART_STATE_KEY)).toEqual(RECORD);
  });

  it("falls back to the cart's hold length in minutes when it gives no seconds left", async () => {
    setUp({
      cartAddress: {
        file: fixture(
          'cart-page-one-stay.html',
          (page) => page.replace(/<input[^>]*earliest_hold_expires_when[^>]*>\n/, ''),
          'minutes.html'
        ),
      },
    });
    const hold = await holds.create(POWERED);
    expect(hold).toEqual(
      expect.objectContaining({ ok: true, expiresAt: new Date(NOW.getTime() + 20 * MINUTE) })
    );
    expect(hold).not.toHaveProperty('expiresAtEstimated');
  });

  it('with no hold fields, guesses 10 minutes and says so (expiresAtEstimated)', async () => {
    setUp({ cartAddress: { file: fixture('cart-page-no-hold-fields.html') } });
    const hold = await holds.create(POWERED);
    expect(hold).toEqual(
      expect.objectContaining({
        ok: true,
        expiresAt: new Date(NOW.getTime() + 10 * MINUTE),
        expiresAtEstimated: true,
      })
    );
    expect((await state.get<RacCartRecord>(RAC_CART_STATE_KEY))?.expiresAt).toBe(
      new Date(NOW.getTime() + 10 * MINUTE).toISOString()
    );
  });

  it.each([
    ['no hold ids', (page: string) => page.replace(/<input[^>]*hold_ids[^>]*>\n/, '')],
    ['0 seconds left', (page: string) => page.replace('value="900"', 'value="0"')],
    ['a negative time left', (page: string) => page.replace('value="900"', 'value="-30"')],
    ['more than a day left', (page: string) => page.replace('value="900"', 'value="86401"')],
  ])('odd hold fields (%s): the 10-minute estimate', async (_odd, edit) => {
    setUp({ cartAddress: { file: fixture('cart-page-one-stay.html', edit, 'odd.html') } });
    const hold = await holds.create(POWERED);
    expect(hold).toEqual(
      expect.objectContaining({
        ok: true,
        expiresAt: new Date(NOW.getTime() + 10 * MINUTE),
        expiresAtEstimated: true,
      })
    );
  });

  it("holds a cabin with no equipment, sending none (RAC's 'all')", async () => {
    setUp({ cartAddress: { file: fixture('cart-page-one-stay.html') } });
    const hold = await holds.create({
      externalId: 'busselton',
      unitId: 'cat:9',
      stay: { ...STAY, params: { pets: 0 } },
    });
    // The page shows 2 nights: this synthetic answer is the powered site's, which is fine here
    expect(hold.ok).toBe(true);
    const form = new URLSearchParams(http.sent[1].body);
    expect(form.get('category_id')).toBe('9');
    expect(form.get('equipment_type_ids')).toBe('all');
    expect(http.sent[2].url).toBe(cartAddress(1003));
  });
});

describe('create: a cabin', () => {
  it('needs no equipment: what the stay has, even half of it, is not sent', async () => {
    setUp();
    const hold = await holds.create({
      externalId: 'busselton',
      unitId: 'cat:9',
      stay: { ...STAY, params: { pets: 0, equipmentType: '1' } },
    });
    expect(hold.ok).toBe(true);
    expect(new URLSearchParams(http.sent[1].body).get('equipment_type_ids')).toBe('all');
  });
});

describe('create: refusals', () => {
  it('a second create while the cart holds a stay: in-progress, with no request', async () => {
    setUp();
    expect((await holds.create(POWERED)).ok).toBe(true);
    http.sent.length = 0;

    expect(await holds.create({ ...POWERED, unitId: 'cat:9' })).toEqual({
      ok: false,
      reason: 'in-progress',
      message: RAC_ONE_CART_MESSAGE,
    });
    expect(http.sent).toEqual([]);

    // Once its hold has run out, the module asks again (and the cart page decides)
    now = new Date(NOW.getTime() + 16 * MINUTE);
    expect((await holds.create(POWERED)).ok).toBe(true);
  });

  it("RAC's cart already holds a stay (the record ran out, RAC's hasn't): in-progress after one request", async () => {
    setUp({ cartPage: { file: fixture('cart-page-one-stay.html') } });
    await state.set(RAC_CART_STATE_KEY, {
      ...RECORD,
      expiresAt: new Date(NOW.getTime() - MINUTE).toISOString(),
    });
    expect(await holds.create(POWERED)).toEqual({
      ok: false,
      reason: 'in-progress',
      message: RAC_CART_OCCUPIED_MESSAGE,
    });
    expect(paths()).toEqual(['GET /busselton/booking/']);
  });

  it.each([
    ['no equipment', { pets: 0 }],
    ['no length', { pets: 0, equipmentType: '1', equipmentWidth: '2.5' }],
    ['a type RAC has not', { ...EQUIPMENT, equipmentType: '99' }],
    ['a width that is not metres', { ...EQUIPMENT, equipmentWidth: 'wide' }],
    ['a length of 0', { ...EQUIPMENT, equipmentLength: '0' }],
  ])('a site with %s: invalid, with no request', async (_case, params) => {
    setUp();
    expect(await holds.create({ ...POWERED, stay: { ...STAY, params } })).toEqual({
      ok: false,
      reason: 'invalid',
      message: RAC_EQUIPMENT_MESSAGE,
    });
    expect(http.sent).toEqual([]);
  });

  it('a site no check has seen yet, with no equipment: invalid once the answer shows it is a site, before any cart address', async () => {
    setUp();
    // A module whose checks have seen nothing
    holds = createRacHolds({
      ctx,
      client: new RacClient({
        providerId: 'rac',
        providerName: ctx.manifest.name,
        http,
        state,
        logger,
        clock: () => now,
        timezone: 'Australia/Perth',
        maxConcurrent: 1,
        cartEnabled: true,
      }),
      membership: createMembership(async () => member),
      categories: createCategoryMemo(),
      kindOf: createKindResolver(() => undefined),
    });
    expect(await holds.create({ ...POWERED, stay: { ...STAY, params: { pets: 0 } } })).toEqual({
      ok: false,
      reason: 'invalid',
      message: RAC_EQUIPMENT_MESSAGE,
    });
    expect(paths()).toEqual(['GET /busselton/booking/', `POST ${RAC_AVAILABILITY_PATH}`]);
  });

  it('no category, or no park: invalid, with no request', async () => {
    setUp();
    expect(await holds.create({ externalId: 'busselton', stay: STAY })).toEqual({
      ok: false,
      reason: 'invalid',
      message: RAC_CHOOSE_CATEGORY_MESSAGE,
    });
    expect(await holds.create({ ...POWERED, externalId: 'ningaloo' })).toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid' })
    );
    expect(await holds.create({ ...POWERED, stay: { ...STAY, departure: STAY.arrival } })).toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid' })
    );
    expect(http.sent).toEqual([]);
  });

  it('no bookable tariff (the sold-out ensuite site): taken, and no cart address is opened', async () => {
    setUp();
    expect(await holds.create({ ...POWERED, unitId: 'cat:7' })).toEqual({
      ok: false,
      reason: 'taken',
      message: RAC_TAKEN_MESSAGE,
    });
    expect(paths()).toEqual(['GET /busselton/booking/', `POST ${RAC_AVAILABILITY_PATH}`]);
  });

  it('a bookable tariff with no cart address: taken', async () => {
    setUp({
      availability: {
        file: fixture(
          'availability-busselton-2026-11-06-2n.json',
          (text) => text.replace(/,\s*"online_cart_url": "[^"]*"/g, ''),
          'no-cart.json'
        ),
      },
    });
    expect(await holds.create(POWERED)).toEqual(
      expect.objectContaining({ ok: false, reason: 'taken' })
    );
    expect(http.sent).toHaveLength(2);
  });

  it('a cart showing other nights than the stay (3 nights, $150, for a 2-night stay): taken', async () => {
    setUp({
      cartAddress: {
        file: fixture(
          'cart-page-one-stay.html',
          (page) => page.replace('"totalBookingNights":2', '"totalBookingNights":3'),
          'three-nights.html'
        ),
      },
    });
    expect(await holds.create(POWERED)).toEqual({
      ok: false,
      reason: 'taken',
      message: RAC_NOT_ADDED_MESSAGE,
    });
    expect(await state.get(RAC_CART_STATE_KEY)).toBeUndefined();
  });

  it('a cart RAC refused (no nights in it): taken', async () => {
    setUp({ cartAddress: { file: fixture('cart-page-refused.html') } });
    expect(await holds.create(POWERED)).toEqual({
      ok: false,
      reason: 'taken',
      message: RAC_NOT_ADDED_MESSAGE,
    });
    expect(http.sent).toHaveLength(3);
    expect(await state.get(RAC_CART_STATE_KEY)).toBeUndefined();
  });

  it.each([
    ['another host', (url: string) => url.replace(RAC, 'https://example.com')],
    ['another path', (url: string) => url.replace('/busselton/booking/', '/busselton/checkout/')],
    ['another park', (url: string) => url.replace('/busselton/', '/esperance/')],
    ['no token', (url: string) => url.replace(`rest_api_data_id=${ZERO_TOKEN}`, 'x=1')],
    ['a checkout step', (url: string) => url.replace('?cart&', '?cart=Booking&')],
    ['a second cart value', (url: string) => url.replace('?cart&', '?cart&cart=Pay&')],
    ['cart[]', (url: string) => url.replace('?cart&', '?cart[]&')],
    ['rest.api.data.id', (url: string) => url.replace('rest_api_data_id', 'rest.api.data.id')],
    [
      'a second token',
      (url: string) => url.replace('&rand=', `&rest_api_data_id=${ZERO_TOKEN}&rand=`),
    ],
  ])('a cart address on %s: a parse error, and nothing is sent to it', async (_case, edit) => {
    setUp({
      availability: {
        file: fixture(
          'availability-busselton-2026-11-06-2n.json',
          (text) => text.replace(cartAddress(1001), edit(cartAddress(1001))),
          'odd-cart.json'
        ),
      },
    });
    const error = await rejection(holds.create(POWERED));
    expect(error).toBeInstanceOf(ProviderParseError);
    expect(String((error as Error).message)).not.toMatch(/rest_api_data_id|0{32}|\?cart/);
    expect(http.sent).toHaveLength(2);
  });
});

describe('one at a time (one cart)', () => {
  const CABIN = { ...POWERED, unitId: 'cat:9' };
  const IN_PROGRESS = { ok: false, reason: 'in-progress', message: RAC_ONE_CART_MESSAGE };

  it('two creates at once: one hold, exactly three requests; the other is in-progress and sends nothing', async () => {
    setUp();
    const [first, second] = await Promise.all([holds.create(POWERED), holds.create(CABIN)]);
    expect(first).toEqual(expect.objectContaining({ ok: true, unitId: 'cat:4' }));
    expect(second).toEqual(IN_PROGRESS);
    expect(paths()).toEqual([
      'GET /busselton/booking/',
      `POST ${RAC_AVAILABILITY_PATH}`,
      `GET /busselton/booking/?cart&rest_api_data_id=${ZERO_TOKEN}&rand=1001`,
    ]);
  });

  it("a create during another's availability POST is in-progress and sends nothing", async () => {
    setUp();
    let second: Promise<unknown> | undefined;
    http.onRequest = (url) => {
      if (!second && url.endsWith('availability-ajax.php')) second = holds.create(CABIN);
    };
    expect((await holds.create(POWERED)).ok).toBe(true);
    expect(await second).toEqual(IN_PROGRESS);
    expect(http.sent).toHaveLength(3);
    expect(cartAddresses()).toHaveLength(1);
  });

  it('a create during a release is in-progress and sends nothing', async () => {
    setUp({ cartPage: { file: fixture('cart-page-one-stay.html') } });
    await state.set(RAC_CART_STATE_KEY, {
      ...RECORD,
      expiresAt: new Date(NOW.getTime() - MINUTE).toISOString(),
    });
    const releasing = holds.release(HOLD);
    expect(await holds.create(POWERED)).toEqual(IN_PROGRESS);
    expect(await releasing).toEqual({ outcome: 'released' });
    expect(paths()).toEqual([
      'GET /busselton/booking/',
      `POST ${PROXY_PATH}?newbook_api_action=data&query=remove_item_from_cart`,
    ]);
  });

  it('a release during a create waits its turn: its request comes after the hold is placed', async () => {
    setUp();
    const placing = holds.create(POWERED);
    const releasing = holds.release(HOLD);
    expect((await placing).ok).toBe(true);
    // The cart page answers empty now: the hold it lets go is no longer in the cart
    expect(await releasing).toEqual({ outcome: 'gone' });
    expect(paths()).toEqual([
      'GET /busselton/booking/',
      `POST ${RAC_AVAILABILITY_PATH}`,
      `GET /busselton/booking/?cart&rest_api_data_id=${ZERO_TOKEN}&rand=1001`,
      'GET /busselton/booking/',
    ]);
  });

  it('a release called off while it waits rejects at once, sends nothing, and passes its turn on', async () => {
    setUp();
    const controller = new AbortController();
    const placing = holds.create(POWERED);
    const releasing = holds.release(HOLD, controller.signal);
    controller.abort();
    expect(isAbortError(await rejection(releasing))).toBe(true);
    expect((await placing).ok).toBe(true);
    expect(http.sent).toHaveLength(3);
    // The next one runs
    expect(await holds.release(HOLD)).toEqual({ outcome: 'gone' });
    expect(http.sent).toHaveLength(4);
  });
});

describe('create: what is sent', () => {
  it("a site's form carries the category, the equipment's type, length and width, in metres", async () => {
    setUp();
    await holds.create(POWERED);
    const form = new URLSearchParams(http.sent[1].body);
    expect(Object.fromEntries(form)).toEqual({
      blog_id: '6',
      available_from: '6 Nov 2026',
      available_to: '8 Nov 2026',
      adults: '2',
      children: '0',
      infants: '0',
      animals: '0',
      category_id: '4',
      equipment_type_ids: '1',
      equipment_measurement_unit: 'm',
      equipment_length: '6.5',
      equipment_width: '2.5',
    });
  });

  it("with no member number, never a members' tariff's cart address; with one, the member rate's", async () => {
    setUp();
    await holds.create(POWERED);
    expect(http.sent[2].url).toBe(cartAddress(1001));

    member = true;
    setUp();
    await holds.create(POWERED);
    expect(http.sent[2].url).toBe(cartAddress(1002));
  });

  it('never sends a checkout, a payment or a NewBook call, and nothing but the three requests', async () => {
    setUp();
    await holds.create(POWERED);
    for (const request of http.sent) {
      expect(request.url).not.toMatch(/newbook\.cloud|cart=Booking|inc\/newbook\/api/);
      expect(request.body ?? '').not.toMatch(/card_|membership_number|cart=Booking/);
    }
    expect(http.sent.filter((r) => /rest_api_data_id/.test(r.url))).toHaveLength(1);
  });
});

describe('create: blocks and aborts', () => {
  it.each([
    ['a 403', { status: 403, file: 'blocked-403.html' }, 403],
    ['a 429', { status: 429, file: 'blocked-429.html' }, 429],
    ['a challenge', { file: 'challenge.html' }, 403],
  ])(
    'the cart page answers %s: a typed error, the cool-down starts, and nothing more is sent',
    async (_case, route, status) => {
      setUp({ cartPage: { ...route, file: fixture(route.file) } });
      const error = await rejection(holds.create(POWERED));
      expect(error).toBeInstanceOf(ProviderHttpError);
      expect((error as ProviderHttpError).status).toBe(status);
      expect(http.sent).toHaveLength(1);
      expect(await state.get(RAC_BLOCK_STATE_KEY)).toEqual(
        expect.objectContaining({
          until: new Date(NOW.getTime() + RAC_BLOCK_COOLDOWN_MS).toISOString(),
        })
      );

      // In the cool-down, a create fails at once with the typed error and sends nothing
      const again = await rejection(holds.create(POWERED));
      expect(again).toBeInstanceOf(ProviderHttpError);
      expect(http.sent).toHaveLength(1);
    }
  );

  it('the cart address answers 429: a typed error with no token in it, the cool-down, no record', async () => {
    setUp({ cartAddress: { status: 429, file: fixture('blocked-429.html') } });
    const error = (await rejection(holds.create(POWERED))) as ProviderHttpError;
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(error.status).toBe(429);
    expect(JSON.stringify([error.message, error.url])).not.toMatch(/rest_api_data_id|0{32}|cart&/);
    expect(http.sent).toHaveLength(3);
    expect(await state.get(RAC_BLOCK_STATE_KEY)).toBeDefined();
    expect(await state.get(RAC_CART_STATE_KEY)).toBeUndefined();
  });

  it('aborted before: rejects with an AbortError and sends nothing', async () => {
    setUp();
    const controller = new AbortController();
    controller.abort();
    expect(isAbortError(await rejection(holds.create(POWERED, controller.signal)))).toBe(true);
    expect(http.sent).toEqual([]);
  });

  it.each([
    ['after the cart page', /\/booking\/$/, 1],
    ['after the availability POST', /availability-ajax\.php$/, 2],
  ])(
    'aborted between requests (%s): an AbortError, nothing more sent, the cookies kept',
    async (_case, match, count) => {
      setUp();
      await http.cookies.set({ url: RAC, name: 'PHPSESSID', value: 'session' });
      const controller = new AbortController();
      http.abortAfter = { match, controller };
      expect(isAbortError(await rejection(holds.create(POWERED, controller.signal)))).toBe(true);
      expect(http.sent).toHaveLength(count);
      expect(await http.cookies.getAll(RAC)).toHaveLength(1);
      expect(await state.get(RAC_CART_STATE_KEY)).toBeUndefined();
    }
  );

  it("aborted after the cart address was sent: the partition's cookies are cleared, then an AbortError", async () => {
    setUp();
    await http.cookies.set({ url: RAC, name: 'PHPSESSID', value: 'session' });
    const controller = new AbortController();
    http.abortAfter = { match: /rest_api_data_id/, controller };
    const error = await rejection(holds.create(POWERED, controller.signal));
    expect(isAbortError(error)).toBe(true);
    expect(http.sent).toHaveLength(3);
    expect(await http.cookies.getAll(RAC)).toEqual([]);
    expect(await state.get(RAC_CART_STATE_KEY)).toBeUndefined();
  });
});

describe('create: the cart address stays private', () => {
  it('is in no result, no state, no log line', async () => {
    setUp();
    const hold = await holds.create(POWERED);
    const everything = JSON.stringify([hold, await state.list(), logger.lines]);
    expect(everything).not.toMatch(/rest_api_data_id|0{32}|\?cart|cart&|rand=100/);
    expect(logText()).toContain('busselton');
  });

  it('is in no error message, even an error the HTTP client words with the address', async () => {
    // Fixture mode refuses the cart address, naming it (query and token included)
    setUp();
    http.refuse = /rest_api_data_id/;
    const error = (await rejection(holds.create(POWERED))) as ProviderHttpError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(JSON.stringify([error.message, error.url, String(error)])).not.toMatch(
      /rest_api_data_id|0{32}|cart&/
    );
    expect(logText()).not.toMatch(/rest_api_data_id|0{32}|cart&/);
    expect(JSON.stringify(await state.list())).not.toMatch(/rest_api_data_id|0{32}/);
  });
});

describe('paymentUrl', () => {
  it.each(RAC_PARKS.map((park) => [park.slug]))(
    "%s: the park's cart page, never a cart address",
    (slug) => {
      setUp();
      const url = holds.paymentUrl({
        ok: true,
        reference: `rac-cart:${slug}:2026-11-06:0a1b2c3d4e5f`,
        expiresAt: NOW,
      });
      expect(url).toBe(`${RAC}/${slug}/booking/`);
      expect(url).toBe(racCartPage(slug));
      expect(new URL(url).search).toBe('');
      expect(url).not.toMatch(/cart&|rest_api_data_id/);
    }
  );

  it("RAC's site for a reference that is not the module's, and RAC's origin only in the window", () => {
    setUp();
    expect(holds.paymentUrl({ ok: true, reference: 'PB123', expiresAt: NOW })).toBe(`${RAC}/`);
    expect(holds.paymentOrigins).toEqual([RAC]);
    expect(holds.releaseOnPaymentClose).toBe(true);
    expect(holds).not.toHaveProperty('bookedReference');
    expect(slugOfReference(RECORD.reference)).toBe('busselton');
  });
});

describe('release', () => {
  async function held(): Promise<void> {
    await state.set(RAC_CART_STATE_KEY, RECORD);
    await http.cookies.set({ url: RAC, name: 'PHPSESSID', value: 'session' });
  }

  it("while the cart holds the stay: one GET, then one POST of remove_item_from_cart (item_offset, cart_type) to the page's proxy; released, and the record cleared", async () => {
    setUp({ cartPage: { file: fixture('cart-page-one-stay.html') } });
    await held();

    expect(await holds.release(HOLD)).toEqual({ outcome: 'released' });

    expect(paths()).toEqual([
      'GET /busselton/booking/',
      `POST ${PROXY_PATH}?newbook_api_action=data&query=remove_item_from_cart`,
    ]);
    expect(Object.fromEntries(new URLSearchParams(http.sent[1].body))).toEqual({
      item_offset: '0',
      cart_type: 'booking',
    });
    expect(await state.get(RAC_CART_STATE_KEY)).toBeUndefined();
  });

  it('takes out only this stay when the person added another in the window', async () => {
    setUp({ cartPage: { file: fixture('cart-page-two-stays.html') } });
    await held();
    expect(await holds.release(HOLD)).toEqual({ outcome: 'released' });
    expect(new URLSearchParams(http.sent[1].body).get('item_offset')).toBe('1');
  });

  it('an emptied cart (paid, run out, removed in the window): the GET only; gone, and the record cleared', async () => {
    setUp({ cartPage: { file: fixture('cart-page-empty.html') } });
    await held();
    expect(await holds.release(HOLD)).toEqual({ outcome: 'gone' });
    expect(paths()).toEqual(['GET /busselton/booking/']);
    expect(await state.get(RAC_CART_STATE_KEY)).toBeUndefined();
  });

  it("an item with this stay's dates in another category: can't tell, rejects, removes nothing, keeps the record and the cookies", async () => {
    setUp({
      cartPage: {
        file: fixture(
          'cart-page-one-stay.html',
          (page) => page.replace('>Powered Site<', '>Ensuite Site<'),
          'renamed.html'
        ),
      },
    });
    await held();
    const error = await rejection(holds.release(HOLD));
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as Error).message).toMatch(/can't tell which item in the cart is this stay/);
    expect(http.sent).toHaveLength(1);
    expect(await state.get(RAC_CART_STATE_KEY)).toEqual(RECORD);
    expect(await http.cookies.getAll(RAC)).toHaveLength(1);
  });

  it("a cart holding someone else's stay only: left alone, gone", async () => {
    setUp({
      cartPage: {
        file: fixture(
          'cart-page-one-stay.html',
          (page) => page.replace('Fri 6 Nov 2026', 'Sat 7 Nov 2026'),
          'other.html'
        ),
      },
    });
    await held();
    expect(await holds.release(HOLD)).toEqual({ outcome: 'gone' });
    expect(http.sent).toHaveLength(1);
  });

  it.each([
    [
      'two of this stay',
      (page: string) => page.replace('Two Bedroom Cabin (Sleeps 4)', 'Powered Site'),
      'cart-page-two-stays.html',
    ],
    [
      'an item it cannot read',
      (page: string) => page.replace('Sun 8 Nov 2026', 'soon'),
      'cart-page-one-stay.html',
    ],
  ])(
    "a cart it can't tell apart (%s): rejects, removes nothing, keeps the record",
    async (_case, edit, from) => {
      setUp({ cartPage: { file: fixture(from, edit, 'unclear.html') } });
      await held();
      expect(await rejection(holds.release(HOLD))).toBeInstanceOf(ProviderError);
      expect(http.sent).toHaveLength(1);
      expect(await state.get(RAC_CART_STATE_KEY)).toEqual(RECORD);
    }
  );

  it.each([
    [
      'another host',
      'https://example.com/busselton/wp-content/themes/parks-and-resorts/inc/newbook/api/rac-busselton-holiday-park.php?',
    ],
    ['another path', `${RAC}/busselton/wp-content/plugins/other/api.php?`],
    [
      'another park',
      `${RAC}/esperance/wp-content/themes/parks-and-resorts/inc/newbook/api/rac-esperance.php?`,
    ],
    ['a query of its own', `${RAC}${PROXY_PATH}?query=extend`],
  ])('a proxy on %s: refused and rejected, with the record kept', async (_case, apiPath) => {
    setUp({
      cartPage: {
        file: fixture(
          'cart-page-one-stay.html',
          (page) => page.replace(/newbook_api_path='[^']*'/, `newbook_api_path='${apiPath}'`),
          'proxy.html'
        ),
      },
    });
    await held();
    expect(await rejection(holds.release(HOLD))).toBeInstanceOf(ProviderError);
    expect(http.sent).toHaveLength(1);
    expect(await state.get(RAC_CART_STATE_KEY)).toEqual(RECORD);
  });

  it.each([
    ['a 403', { status: 403, file: 'blocked-403.html' }, 403],
    ['a 429', { status: 429, file: 'blocked-429.html' }, 429],
    ['a challenge', { file: 'challenge.html' }, 403],
  ])(
    'RAC answers %s: rejects with the typed error, keeps the record and the cookies, and logs no token',
    async (_case, route, status) => {
      setUp({ cartPage: { ...route, file: fixture(route.file) } });
      await held();
      const error = await rejection(holds.release(HOLD));
      expect(error).toBeInstanceOf(ProviderHttpError);
      expect((error as ProviderHttpError).status).toBe(status);
      expect(await state.get(RAC_CART_STATE_KEY)).toEqual(RECORD);
      expect(await http.cookies.getAll(RAC)).toHaveLength(1);
      expect(logText()).toMatch(/could not be taken out of the cart/);
      expect(logText()).not.toMatch(/rest_api_data_id|0{32}|rac-cart:/);

      // In the cool-down: rejects at once, sends nothing
      http.sent.length = 0;
      expect(await rejection(holds.release(HOLD))).toBeInstanceOf(ProviderHttpError);
      expect(http.sent).toEqual([]);
    }
  );

  it('RAC cannot be reached (the removal has no answer): rejects, keeps the record and the cookies', async () => {
    setUp({
      cartPage: { file: fixture('cart-page-one-stay.html') },
      removal: { query: { query: 'never' } },
    });
    await held();
    expect(await rejection(holds.release(HOLD))).toBeInstanceOf(ProviderHttpError);
    expect(http.sent).toHaveLength(2);
    expect(await state.get(RAC_CART_STATE_KEY)).toEqual(RECORD);
    expect(await http.cookies.getAll(RAC)).toHaveLength(1);
  });

  it('aborted before: an AbortError, nothing sent; without its record, an empty cart is gone', async () => {
    setUp({ cartPage: { file: fixture('cart-page-empty.html') } });
    const controller = new AbortController();
    controller.abort();
    expect(isAbortError(await rejection(holds.release(HOLD, controller.signal)))).toBe(true);
    expect(http.sent).toEqual([]);
    // No record (another reference): the cart page decides
    expect(await holds.release(HOLD)).toEqual({ outcome: 'gone' });
  });

  it("without its record, a cart that holds something can't be told apart: rejects", async () => {
    setUp({ cartPage: { file: fixture('cart-page-one-stay.html') } });
    expect(await rejection(holds.release(HOLD))).toBeInstanceOf(ProviderError);
    expect(http.sent).toHaveLength(1);
  });
});

describe('equipmentOf', () => {
  it('reads all three fields, none, or something RAC cannot take', () => {
    expect(equipmentOf({ params: EQUIPMENT })).toEqual({
      typeId: '1',
      length: '6.5',
      width: '2.5',
    });
    expect(equipmentOf({ params: { pets: 1 } })).toBe('none');
    expect(equipmentOf({ params: { equipmentType: '' } })).toBe('none');
    expect(equipmentOf({ params: { ...EQUIPMENT, equipmentLength: '123' } })).toBe('invalid');
    expect(equipmentOf({ params: { ...EQUIPMENT, equipmentWidth: undefined as never } })).toBe(
      'invalid'
    );
  });
});
