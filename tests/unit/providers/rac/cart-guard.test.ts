/**
 * RAC's cart guard (`src/main/providers/rac/cart-guard.ts`, terms rule 8) on its own and in the
 * RAC client, on a recording HTTP client that never sends anything:
 *
 * - every always-refused request (NewBook's card store, checkout's post, RAC's cart-address
 *   endpoint, NewBook proxy queries but the removal, card and membership fields) is refused
 *   with the cart on;
 * - a cart address and the proxy's removal are refused with the cart off, and allowed with it on;
 * - a refusal is a `ProviderError`, nothing reaches the transport, a redirect is guarded too, and
 *   the log names the path only, never the query (the cart's token);
 * - the R19 review's probes: the booking engine and NewBook's proxy however their paths are
 *   spelled (case, repeated slashes, no trailing slash, `index.php`, encoded slashes), `cart` and
 *   `query` once only, names as PHP reads them (`cart[]`, `rest.api.data.id`), no `query` field
 *   in a form, POST only to the availability form and (cart on) the exact removal;
 * - built through `racFactory` with auto-cart off, RAC redirecting a request to a cart address
 *   stops after one request.
 */

import {
  cartGuardRefusal,
  loggablePath,
  normalisedPath,
  phpKey,
  RAC_AVAILABILITY_PATH,
} from '@main/providers/rac/cart-guard';
import { racFactory, racManifest } from '@main/providers/rac';
import { RacClient } from '@main/providers/rac/client';
import {
  InMemoryKeyValueStore,
  ProviderError,
  ProviderHttpError,
  type HttpMethod,
  type HopRequest,
} from '@main/providers/sdk';
import {
  createMemoryLogger,
  createTestProviderContext,
  type MemoryLogger,
} from '@tests/utils/fake-provider';
import { RecordingHttpClient, type HopAnswer } from '@tests/utils/fake-paced-provider';

const RAC = 'https://parksandresorts.rac.com.au';
const ZERO_TOKEN = '0'.repeat(32);
const CART_ADDRESS = `${RAC}/busselton/booking/?cart&rest_api_data_id=${ZERO_TOKEN}&rand=1001`;
const PROXY = `${RAC}/busselton/wp-content/themes/parks-and-resorts/inc/newbook/api/rac-busselton-holiday-park.php`;
const REMOVAL = `${PROXY}?newbook_api_action=data&query=remove_item_from_cart`;
const PAGE = '<html><body>cart</body></html>';
const AVAILABILITY = `${RAC}${RAC_AVAILABILITY_PATH}`;
const REMOVAL_FORM = 'item_offset=0&cart_type=booking';
/** The booking engine, spelled every way the review found that a server reads the same. */
const BOOKING_SPELLINGS = [
  `${RAC}/Busselton/Booking/`,
  `${RAC}//busselton/booking/`,
  `${RAC}/busselton/booking`,
  `${RAC}/busselton/booking/index.php`,
  `${RAC}/busselton%2Fbooking/`,
  `${RAC}/busselton%252Fbooking/`,
  `${RAC}/busselton/./booking/`,
];
/** NewBook's proxy, spelled other ways. */
const PROXY_SPELLINGS = [
  `${RAC}/busselton/wp-content/themes/parks-and-resorts/INC/newbook/api/rac-busselton-holiday-park.php`,
  `${RAC}/busselton/wp-content/themes/parks-and-resorts/inc%2Fnewbook%2Fapi/rac-busselton-holiday-park.php`,
  `${RAC}/busselton//wp-content/themes/parks-and-resorts/inc/NewBook/api/rac-busselton-holiday-park.php`,
];

/** Requests no switch lets through (rule 8). */
const ALWAYS_REFUSED: Array<[string, HttpMethod, string, string?]> = [
  [
    "NewBook's card store",
    'POST',
    'https://apiau.newbook.cloud/cc_secure/1230',
    'online_cart_id=1&card_number=4111111111111111&card_cvv=123',
  ],
  ['the card store on any host', 'GET', `${RAC}/cc_secure/1230`],
  ['checkout (?cart=Booking)', 'POST', `${RAC}/busselton/booking/?cart=Booking`, 'a=1'],
  ['checkout by GET (?cart=Booking)', 'GET', `${RAC}/busselton/booking/?cart=Booking`],
  ['a post to the booking engine', 'POST', `${RAC}/busselton/booking/`, 'newbook_api_action=cart'],
  ["checkout's form", 'POST', `${RAC}/busselton/booking/?login`, 'form=newbook_online_main_form'],
  [
    "RAC's cart-address endpoint",
    'POST',
    `${RAC}/wp-content/themes/parks-and-resorts/template-parts/components/booking-engine/get-online-cart-url-ajax.php`,
    'blog_id=6&category_id=4',
  ],
  [
    'extending a hold',
    'POST',
    `${PROXY}?newbook_api_action=data`,
    'query=extend_multiple_holds&hold_ids=1',
  ],
  [
    'extending a hold, by query',
    'POST',
    `${PROXY}?newbook_api_action=data&query=extend_multiple_holds`,
  ],
  [
    'the membership check',
    'POST',
    `${PROXY}?newbook_api_action=data&query=online_checkout_membership_fields`,
  ],
  [
    "changing a booking's guests",
    'GET',
    `${PROXY}?newbook_api_action=data&query=modify_booking_guests&booking_offset=0`,
  ],
  ['another proxy query', 'POST', `${PROXY}?newbook_api_action=data&query=state`],
  ['the removal by GET', 'GET', REMOVAL],
  ['the removal with more in its query', 'POST', `${REMOVAL}&extra=1`],
  ['a member number in a form', 'POST', `${RAC}/busselton/booking/?x`, 'membership_number=1234'],
  ['card fields in any form', 'POST', `${RAC}/x/`, 'card_number=1'],
  ['a cart address by POST', 'POST', CART_ADDRESS, 'a=1'],
  [
    'a cart address off the booking page',
    'GET',
    `${RAC}/busselton/?cart&rest_api_data_id=${ZERO_TOKEN}`,
  ],
  ['plain http', 'GET', 'http://parksandresorts.rac.com.au/busselton/booking/'],
  // The review's probes: checkout however the booking engine is spelled
  ...BOOKING_SPELLINGS.map((url): [string, HttpMethod, string, string?] => [
    `a post to ${url}`,
    'POST',
    url,
    'a=1',
  ]),
  // NewBook's proxy however it is spelled, for anything but the exact removal
  ...PROXY_SPELLINGS.flatMap((proxy): Array<[string, HttpMethod, string, string?]> => [
    [`a GET of ${proxy}`, 'GET', `${proxy}?newbook_api_action=data&query=state`],
    [`a post of state to ${proxy}`, 'POST', `${proxy}?newbook_api_action=data&query=state`, 'a=1'],
  ]),
  // The removal, but not exactly
  [
    'the removal with a second query',
    'POST',
    `${REMOVAL}&query=remove_item_from_cart`,
    REMOVAL_FORM,
  ],
  [
    'the removal with another query too',
    'POST',
    `${PROXY}?newbook_api_action=data&query=remove_item_from_cart&query=state`,
    REMOVAL_FORM,
  ],
  ['the removal with more in its form', 'POST', REMOVAL, `${REMOVAL_FORM}&extra=1`],
  ['the removal with a form field twice', 'POST', REMOVAL, `${REMOVAL_FORM}&item_offset=1`],
  ['the removal with a query field in its form', 'POST', REMOVAL, `${REMOVAL_FORM}&query=state`],
  [
    'the removal with a field spelled the PHP way',
    'POST',
    REMOVAL,
    'item.offset=0&cart_type=booking',
  ],
  [
    'the removal off a park',
    'POST',
    `${RAC}/wp-content/themes/parks-and-resorts/inc/newbook/api/rac.php?newbook_api_action=data&query=remove_item_from_cart`,
    REMOVAL_FORM,
  ],
  // POST only to the availability form, as it is sent
  ['a query field in the availability form', 'POST', AVAILABILITY, 'blog_id=6&query=state'],
  ['a query field spelled the PHP way', 'POST', AVAILABILITY, 'blog_id=6&query[]=state'],
  ['the availability form with a query string', 'POST', `${AVAILABILITY}?x=1`, 'blog_id=6'],
  ['a post to a page', 'POST', `${RAC}/busselton/book-now/`, 'blog_id=6'],
  ['another method', 'DELETE', `${RAC}/busselton/booking/`],
];

/** Cart addresses refused even with the cart on: `cart` once, as written, on the booking page. */
const CART_ADDRESSES_REFUSED: Array<[string, string]> = [
  ['a second cart value', `${RAC}/busselton/booking/?cart&cart=Pay&rest_api_data_id=${ZERO_TOKEN}`],
  ['cart twice', `${RAC}/busselton/booking/?cart&cart&rest_api_data_id=${ZERO_TOKEN}`],
  ['cart[]', `${RAC}/busselton/booking/?cart[]&rest_api_data_id=${ZERO_TOKEN}`],
  ['rest.api.data.id', `${RAC}/busselton/booking/?cart&rest.api.data.id=${ZERO_TOKEN}`],
  ['the token twice', `${RAC}/busselton/booking/?cart&rest_api_data_id=1&rest_api_data_id=2`],
  ['the token only', `${RAC}/esperance/booking/?rest_api_data_id=${ZERO_TOKEN}`],
  ['a booking page below the engine', `${RAC}/busselton/booking/x/?cart&rest_api_data_id=1`],
];

describe('cartGuardRefusal', () => {
  it.each(
    ALWAYS_REFUSED.map(([name, method, url, body]) => [name, method, url, body ?? ''] as const)
  )('refuses %s with the cart on, and off', (_name, method, url, body) => {
    expect(cartGuardRefusal({ method, url, body }, true)).toEqual(expect.any(String));
    expect(cartGuardRefusal({ method, url, body }, false)).toEqual(expect.any(String));
  });

  it.each(CART_ADDRESSES_REFUSED)('refuses a cart address with %s, cart on or off', (_n, url) => {
    expect(cartGuardRefusal({ method: 'GET', url }, true)).toEqual(expect.any(String));
    expect(cartGuardRefusal({ method: 'GET', url }, false)).toBe('the cart is off');
  });

  it.each([
    ['?rest.api.data.id=', `${RAC}/busselton/booking/?rest.api.data.id=${ZERO_TOKEN}`],
    [
      '?cart[]&rest.api.data.id=',
      `${RAC}/busselton/booking/?cart[]&rest.api.data.id=${ZERO_TOKEN}`,
    ],
    ['?cart%5B%5D=', `${RAC}/busselton/booking/?cart%5B%5D=&rand=1`],
    ['?CART', `${RAC}/busselton/booking/?CART`],
    ['?rest api data id=', `${RAC}/busselton/booking/?rest+api+data+id=1`],
    [
      '?%20cart&rest_api_data_id=',
      `${RAC}/busselton/booking/?%20cart&rest_api_data_id=${ZERO_TOKEN}`,
    ],
    [
      '?cart%00x&rest_api_data_id%00y=',
      `${RAC}/busselton/booking/?cart%00x&rest_api_data_id%00y=${ZERO_TOKEN}`,
    ],
    // Each alone, so only PHP's reading of the name makes it the cart's
    ['?%20cart', `${RAC}/busselton/booking/?%20cart`],
    ['?+cart', `${RAC}/busselton/booking/?+cart`],
    ['?cart%00x', `${RAC}/busselton/booking/?cart%00x`],
    ['?rest_api_data_id%00y=', `${RAC}/busselton/booking/?rest_api_data_id%00y=${ZERO_TOKEN}`],
  ])('with the cart off, a cart address spelled %s is refused', (_spelling, url) => {
    expect(cartGuardRefusal({ method: 'GET', url }, false)).toBe('the cart is off');
  });

  it.each([
    ['a cart address', 'GET', CART_ADDRESS],
    ['the cart shown by `?cart`', 'GET', `${RAC}/busselton/booking/?cart`],
    ['the removal', 'POST', REMOVAL],
  ] as Array<[string, HttpMethod, string]>)(
    'refuses %s with the cart off, and lets it through with it on',
    (_name, method, url) => {
      const body = method === 'POST' ? 'item_offset=0&cart_type=booking' : undefined;
      expect(cartGuardRefusal({ method, url, body }, false)).toBe('the cart is off');
      expect(cartGuardRefusal({ method, url, body }, true)).toBeUndefined();
    }
  );

  it.each([
    ['a book-now page', 'GET', `${RAC}/busselton/book-now/`],
    ['the cart page', 'GET', `${RAC}/busselton/booking/`],
    [
      'a booking page with dates (a booking link)',
      'GET',
      `${RAC}/busselton/booking/?available_from=2026-11-06&available_to=2026-11-08&force_category_id=4`,
    ],
    [
      'the availability POST',
      'POST',
      `${RAC}/wp-content/themes/parks-and-resorts/template-parts/components/booking-engine/availability-ajax.php`,
    ],
  ] as Array<[string, HttpMethod, string]>)(
    'lets %s through, cart on or off',
    (_name, method, url) => {
      const body = method === 'POST' ? 'blog_id=6&equipment_type_ids=all' : undefined;
      expect(cartGuardRefusal({ method, url, body }, false)).toBeUndefined();
      expect(cartGuardRefusal({ method, url, body }, true)).toBeUndefined();
    }
  );

  it('reads a path as a server does, and a name as PHP does', () => {
    for (const url of BOOKING_SPELLINGS) {
      expect([url, normalisedPath(new URL(url).pathname)]).toEqual([url, '/busselton/booking']);
    }
    expect(normalisedPath('/a/b/../c/%2e%2e/d')).toBe('/a/d');
    expect(normalisedPath('/')).toBe('/');
    expect(
      ['cart[]', 'cart[x]', 'rest.api.data.id', 'rest api_data[id', 'Query'].map(phpKey)
    ).toEqual(['cart', 'cart', 'rest_api_data_id', 'rest_api_data_id', 'query']);
    expect([' cart', '  cart[]', 'cart\0x', 'rest_api_data_id\0y', '\0cart'].map(phpKey)).toEqual([
      'cart',
      'cart',
      'cart',
      'rest_api_data_id',
      '',
    ]);
  });

  it('names a path for the log, never a query', () => {
    expect(loggablePath(CART_ADDRESS)).toBe('/busselton/booking/');
    expect(loggablePath('not a url')).toBe('(not an address)');
  });
});

describe('the RAC client, guarded', () => {
  let logger: MemoryLogger;
  let http: RecordingHttpClient;

  function client(cartEnabled: boolean, respond?: (hop: HopRequest) => HopAnswer): RacClient {
    http = new RecordingHttpClient({
      providerId: 'rac',
      respond: respond ?? (() => ({ body: PAGE, headers: { 'content-type': 'text/html' } })),
    });
    return new RacClient({
      providerId: 'rac',
      providerName: 'RAC Parks & Resorts',
      http,
      state: new InMemoryKeyValueStore(),
      logger,
      clock: () => new Date('2026-10-17T02:00:00.000Z'),
      timezone: 'Australia/Perth',
      maxConcurrent: 1,
      ...(cartEnabled ? { cartEnabled } : {}),
    });
  }

  beforeEach(() => {
    logger = createMemoryLogger();
  });

  async function refusal(pending: Promise<unknown>): Promise<ProviderError> {
    const error = await pending.then(
      () => undefined,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(ProviderError);
    return error as ProviderError;
  }

  it('with the cart off (the default), a cart address GET is a ProviderError and the transport sees nothing', async () => {
    const error = await refusal(client(false).getPage(CART_ADDRESS));
    expect(error).not.toBeInstanceOf(ProviderHttpError);
    expect(error.message).toBe(
      'RAC Parks & Resorts: WA Stay never sends that request (the cart is off)'
    );
    expect(http.requests).toEqual([]);
    expect(http.hops).toEqual([]);
  });

  it('with the cart off, the removal POST is refused and nothing is sent', async () => {
    await refusal(
      client(false).postAjax(REMOVAL, { item_offset: 0, cart_type: 'booking' }, { referer: RAC })
    );
    expect(http.requests).toEqual([]);
  });

  it('with the cart on, a cart address GET and the removal POST are sent', async () => {
    const racClient = client(true);
    await racClient.getPage(CART_ADDRESS);
    await racClient.postAjax(REMOVAL, { item_offset: 0, cart_type: 'booking' }, { referer: RAC });
    expect(http.requests.map((r) => [r.method, r.url])).toEqual([
      ['GET', CART_ADDRESS],
      ['POST', REMOVAL],
    ]);
  });

  it.each(
    ALWAYS_REFUSED.map(([name, method, url, body]) => [name, method, url, body ?? ''] as const)
  )('with the cart on, refuses %s and sends nothing', async (_name, method, url, body) => {
    const racClient = client(true);
    const pending =
      method === 'GET'
        ? racClient.getPage(url)
        : racClient.postAjax(url, new URLSearchParams(body ?? ''), { referer: RAC });
    await refusal(pending);
    expect(http.requests).toEqual([]);
  });

  it('a query option is guarded with the address', async () => {
    await refusal(
      client(false).getPage('/busselton/booking/', {
        query: { cart: '', rest_api_data_id: ZERO_TOKEN },
      })
    );
    expect(http.requests).toEqual([]);
  });

  it('guards each redirect: a cart address sent to checkout stops after its first hop', async () => {
    const racClient = client(true, (hop) =>
      hop.url === CART_ADDRESS
        ? { status: 302, headers: { location: '/busselton/booking/?cart=Booking' } }
        : { body: PAGE, headers: { 'content-type': 'text/html' } }
    );
    await refusal(racClient.getPage(CART_ADDRESS));
    expect(http.requests.map((r) => r.url)).toEqual([CART_ADDRESS]);
  });

  it('guards each redirect: a page sent to a cart address while the cart is off stops there', async () => {
    const racClient = client(false, (hop) =>
      hop.url.endsWith('/book-now/')
        ? { status: 302, headers: { location: CART_ADDRESS } }
        : { body: PAGE, headers: { 'content-type': 'text/html' } }
    );
    await refusal(racClient.getPage('/busselton/book-now/'));
    expect(http.requests.map((r) => r.url)).toEqual([`${RAC}/busselton/book-now/`]);
  });

  it('logs a refusal by its path, never its query or the token', async () => {
    await refusal(client(false).getPage(CART_ADDRESS));
    await refusal(
      client(true).postAjax(
        `${PROXY}?newbook_api_action=data&query=extend_multiple_holds`,
        {},
        {
          referer: RAC,
        }
      )
    );
    const warnings = logger.lines.filter((line) => line.level === 'warn');
    expect(warnings.map((line) => line.message)).toEqual([
      'Refused GET /busselton/booking/: the cart is off; nothing sent',
      'Refused POST /busselton/wp-content/themes/parks-and-resorts/inc/newbook/api/rac-busselton-holiday-park.php: checkout, payment or a NewBook call; nothing sent',
    ]);
    expect(JSON.stringify(logger.lines)).not.toMatch(/\?|rest_api_data_id|0{32}|extend_multiple/);
  });
});

describe('RAC built with auto-cart off (racFactory)', () => {
  it('stops after one request when RAC redirects it to a cart address: a ProviderError, never followed', async () => {
    const http = new RecordingHttpClient({
      providerId: 'rac',
      // RAC's availability answer sends the request to a cart address instead
      respond: () => ({ status: 302, headers: { location: CART_ADDRESS } }),
    });
    const provider = racFactory(
      createTestProviderContext(racManifest, {
        http,
        clock: () => new Date('2026-10-17T02:00:00Z'),
      })
    );
    expect(provider.holds).toBeUndefined();
    const error = await provider
      .availability!.check('busselton', {
        arrival: '2026-11-06',
        departure: '2026-11-08',
        adults: 2,
      })
      .then(
        () => undefined,
        (e: unknown) => e
      );
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).not.toBeInstanceOf(ProviderHttpError);
    expect((error as Error).message).toMatch(/the cart is off/);
    expect(http.requests.map((r) => [r.method, r.url])).toEqual([['POST', AVAILABILITY]]);
  });
});
