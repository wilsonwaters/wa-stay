/**
 * @jest-environment node
 *
 * docs/providers/rac/endpoints.md stays true to the RAC module (`src/main/providers/rac/`):
 * - every row of its endpoint tables has a status from the page's own legend;
 * - every path the module requests (through `RacClient`, the only code that sends one) is in
 *   its first table, "Requests WA Stay sends";
 * - the auto-cart's requests (the cart page, the cart address and the cart removal) are there,
 *   sent by the cart's code only, and marked "From RAC's page code, not exercised": no cart was
 *   ever opened live;
 * - a path it lists as "Known, never used" is named nowhere in the module's code, comments left
 *   out, except in the cart guard (`cart-guard.ts`), whose job is to refuse such paths.
 *
 * The checks that read code are functions, also run over a bad sample, so a check that can no
 * longer fail is caught too.
 */

import fs from 'fs';
import path from 'path';
import { stripComments } from '../../utils/strip-comments';
import { pathsIn, readDoc, ROOT, tableRows } from './markdown';

const DOC = 'docs/providers/rac/endpoints.md';
const RAC_DIR = 'src/main/providers/rac';
const FIRST_TABLE = 'Requests WA Stay sends';
const NEVER_USED = 'Known, never used';
/** The one file that may name a never-used path: it is there to refuse them. */
const CART_GUARD = 'cart-guard.ts';
/** Tables on the page that are not endpoints. */
const NOT_ENDPOINTS = new Set(['Status legend', "RAC's codes"]);
const FROM_PAGE_CODE = "From RAC's page code, not exercised";
/** The auto-cart's code: the one file that sends requests whose address it is given. */
const CART_CODE = 'holds.ts';
/**
 * The cart's requests whose address is a variable in `holds.ts`, by its name: the documented
 * path each stands for (the tariff's cart address, and the cart page's proxy for a removal).
 */
const CART_ADDRESSES: ReadonlyMap<string, string> = new Map([
  ['address', '/<slug>/booking/?cart&rest_api_data_id=…'],
  [
    'removal',
    '/<slug>/wp-content/themes/parks-and-resorts/inc/newbook/api/<file>.php?newbook_api_action=data&query=remove_item_from_cart',
  ],
]);
/** Whether a documented path is one of the cart's: its page, its address or its removal. */
const isCartPath = (documented: string): boolean =>
  documented === '/<slug>/booking/' ||
  documented.includes('?cart&') ||
  documented.includes('remove_item_from_cart');

/**
 * What names each never-used path in code: the part of it no request WA Stay sends shares. Each
 * row of the "Known, never used" table holds exactly one.
 */
const NEVER_USED_NAMES = [
  '/locations/',
  'wp-json',
  'get-online-cart-url-ajax.php',
  '?login',
  '?cart=Booking',
  'extend_multiple_holds',
  'cc_secure',
];

/** The module's TypeScript files, by name, with their comments blanked out. */
function moduleSources(): Map<string, string> {
  const dir = path.join(ROOT, RAC_DIR);
  return new Map(
    fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => [name, stripComments(fs.readFileSync(path.join(dir, name), 'utf8'))])
  );
}

/** Every `export const NAME = '…'` (or a template with no expression) in the sources. */
function stringConstants(sources: Map<string, string>): Map<string, string> {
  const constants = new Map<string, string>();
  for (const code of sources.values()) {
    for (const match of code.matchAll(/export const ([A-Z][A-Z0-9_]*)\s*=\s*(['`])([^'`$]*)\2/g)) {
      constants.set(match[1], match[3]);
    }
  }
  return constants;
}

/**
 * The paths `code` passes to the RAC client (`getPage`, `postAjax`), as the doc writes them: a
 * park's slug is `<slug>`. A variable named in `addresses` is the documented path it stands
 * for, whole, as `exact: <path>`. Any other call whose path cannot be read comes back as
 * `unreadable: <the call>`, so a new kind of request is never missed.
 */
function requestedPaths(
  code: string,
  constants: ReadonlyMap<string, string>,
  addresses: ReadonlyMap<string, string> = new Map()
): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(/\.(getPage|postAjax)\(\s*([^,)]*)/g)) {
    const [call, , argument] = match;
    const text = argument.trim();
    const literal = /^(['`])(.*)\1$/s.exec(text)?.[2];
    if (literal !== undefined) {
      found.push(literal.replace(/\$\{[^}]*\bslug\}/g, '<slug>'));
    } else if (constants.has(text)) {
      found.push(constants.get(text) as string);
    } else if (addresses.has(text)) {
      found.push(`exact: ${addresses.get(text) as string}`);
    } else {
      found.push(`unreadable: ${call.trim()}`);
    }
  }
  return found;
}

/**
 * Whether `code` sends a request itself rather than through the RAC client: any call on an
 * `http` object (`ctx.http.getJson(…)`, `deps.http.postForm(…)`) or any `.request(…)`.
 */
function sendsOwnRequest(code: string): boolean {
  return /\bhttp\.\w+\s*\(/.test(code) || /\.request\s*\(/.test(code);
}

/** The never-used names `code` contains. */
function namesNeverUsed(code: string): string[] {
  return NEVER_USED_NAMES.filter((name) => code.includes(name));
}

/** A documented path without its query: what a request's path is compared with. */
const withoutQuery = (documented: string): string => documented.split('?')[0];

describe(DOC, () => {
  const rows = tableRows(readDoc(DOC));
  const legend = new Set(rows.filter((r) => r.section === 'Status legend').map((r) => r.cells[0]));
  const endpoints = rows.filter((r) => !NOT_ENDPOINTS.has(r.section));
  const sources = moduleSources();
  // The client defines `getPage` and `postAjax`; every other file calls them
  const callers = new Map([...sources].filter(([name]) => name !== 'client.ts'));

  it('has a legend with its three kinds of status', () => {
    expect([...legend]).toEqual(
      expect.arrayContaining([
        'Verified live 2026-10-16',
        "From RAC's page code, not exercised",
        NEVER_USED,
      ])
    );
  });

  it('gives every row of its endpoint tables a status from the legend', () => {
    expect(new Set(endpoints.map((r) => r.section))).toEqual(
      new Set([FIRST_TABLE, 'Pages WA Stay opens or links to', NEVER_USED])
    );
    expect(endpoints.length).toBeGreaterThanOrEqual(12);
    expect(endpoints.filter((r) => !legend.has(r.cells[2])).map((r) => r.cells)).toEqual([]);
    // The never-used table holds only never-used paths, and only it does
    expect(
      endpoints.filter((r) => (r.section === NEVER_USED) !== (r.cells[2] === NEVER_USED))
    ).toEqual([]);
  });

  it('documents in its first table every path the module requests', () => {
    const documented = rows
      .filter((r) => r.section === FIRST_TABLE)
      .flatMap((r) => pathsIn(r.cells[1]));
    const constants = stringConstants(sources);
    // Only the cart's code sends a request to an address it is given
    const requested = [...callers].flatMap(([name, code]) =>
      requestedPaths(code, constants, name === CART_CODE ? CART_ADDRESSES : undefined)
    );
    // The availability endpoint, the book-now page, and the cart's page, address and removal
    expect(new Set(requested).size).toBeGreaterThanOrEqual(5);
    expect(requested.filter((used) => used.startsWith('exact: '))).toHaveLength(
      CART_ADDRESSES.size
    );
    const undocumented = requested.filter((used) =>
      used.startsWith('exact: ')
        ? !documented.includes(used.slice('exact: '.length))
        : !documented.map(withoutQuery).includes(used)
    );
    expect(undocumented).toEqual([]);
    // Nothing sends a request but the client
    for (const [name, code] of callers) {
      expect([name, sendsOwnRequest(code)]).toEqual([name, false]);
    }
  });

  it('tells a request sent around the client from a call to it', () => {
    expect(sendsOwnRequest('await ctx.http.getJson(url, { signal })')).toBe(true);
    expect(sendsOwnRequest('deps.http.postForm(url, form)')).toBe(true);
    expect(sendsOwnRequest("http.request('GET', url, {})")).toBe(true);
    expect(sendsOwnRequest('await transport.request(url)')).toBe(true);
    expect(sendsOwnRequest('client.getPage(`/${park.slug}/book-now/`, { signal })')).toBe(false);
    expect(sendsOwnRequest('async signIn(values, _http, signal) {')).toBe(false);
  });

  it('reads the paths of a request in code, and flags one it cannot read', () => {
    const constants = new Map([['SOME_PATH', '/a/b.php']]);
    const code =
      'client.getPage(`/${park.slug}/book-now/`); client.postAjax(SOME_PATH, form, o); ' +
      'client.getPage(address, { signal })';
    expect(requestedPaths(code, constants)).toEqual([
      '/<slug>/book-now/',
      '/a/b.php',
      'unreadable: .getPage(address',
    ]);
    expect(requestedPaths(code, constants, new Map([['address', '/x/?cart']]))).toEqual([
      '/<slug>/book-now/',
      '/a/b.php',
      'exact: /x/?cart',
    ]);
  });

  it("marks the cart's requests as RAC's page code, sent by the cart's code with the experiment on", () => {
    const first = rows.filter((r) => r.section === FIRST_TABLE);
    const cart = first.filter((r) => pathsIn(r.cells[1]).some(isCartPath));
    expect(cart.map((r) => pathsIn(r.cells[1])[0])).toEqual([
      '/<slug>/booking/',
      ...CART_ADDRESSES.values(),
    ]);
    for (const row of cart) {
      expect([row.cells[1], row.cells[2]]).toEqual([row.cells[1], FROM_PAGE_CODE]);
      expect(row.cells[3]).toContain(`\`${CART_CODE}\``);
      expect(row.cells[3]).toContain('auto-cart experiment on only');
    }
    // Nothing outside the cart is unverified
    expect(first.filter((r) => r.cells[2] === FROM_PAGE_CODE && !cart.includes(r))).toEqual([]);
    expect(isCartPath('/<slug>/book-now/')).toBe(false);
  });

  it('lists each never-used path by a name the module never uses outside the cart guard', () => {
    const neverUsed = rows.filter((r) => r.section === NEVER_USED);
    // Each row is one name, and each name a row: the doc and this test agree
    expect(neverUsed.map((r) => namesNeverUsed(pathsIn(r.cells[1]).join(' ')).length)).toEqual(
      neverUsed.map(() => 1)
    );
    expect(neverUsed.flatMap((r) => namesNeverUsed(r.cells[1])).sort()).toEqual(
      [...NEVER_USED_NAMES].sort()
    );
    const named = [...sources]
      .filter(([name]) => name !== CART_GUARD)
      .flatMap(([name, code]) => namesNeverUsed(code).map((found) => `${name}: ${found}`));
    expect(named).toEqual([]);
  });

  it('finds a never-used name in code, and none in a path WA Stay requests or links to', () => {
    expect(namesNeverUsed('const login = `${base}/busselton/booking/?login`;')).toEqual(['?login']);
    expect(namesNeverUsed("post('/x/wp-json/wp/v2/accommodation')")).toEqual(['wp-json']);
    const used = rows
      .filter((r) => r.section === FIRST_TABLE || r.section === 'Pages WA Stay opens or links to')
      .flatMap((r) => pathsIn(r.cells[1]));
    expect(used.length).toBeGreaterThanOrEqual(5);
    expect(namesNeverUsed(used.join('\n'))).toEqual([]);
  });
});
