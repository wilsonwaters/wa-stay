/**
 * @jest-environment node
 *
 * docs/providers/rac/endpoints.md stays true to the RAC module (`src/main/providers/rac/`):
 * - every row of its endpoint tables has a status from the page's own legend;
 * - every path the module requests (through `RacClient`, the only code that sends one) is in
 *   its first table, "Requests WA Stay sends";
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
 * park's slug is `<slug>`. A call whose path cannot be read (a variable) comes back as
 * `unreadable: <the call>`, so a new kind of request is never missed.
 */
function requestedPaths(code: string, constants: ReadonlyMap<string, string>): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(/\.(getPage|postAjax)\(\s*([^,)]*)/g)) {
    const [call, , argument] = match;
    const text = argument.trim();
    const literal = /^(['`])(.*)\1$/s.exec(text)?.[2];
    if (literal !== undefined) {
      found.push(literal.replace(/\$\{[^}]*\bslug\}/g, '<slug>'));
    } else if (constants.has(text)) {
      found.push(constants.get(text) as string);
    } else {
      found.push(`unreadable: ${call.trim()}`);
    }
  }
  return found;
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
      .flatMap((r) => pathsIn(r.cells[1]))
      .map(withoutQuery);
    const constants = stringConstants(sources);
    const requested = [...callers.values()].flatMap((code) => requestedPaths(code, constants));
    // The availability endpoint and the book-now page, at least
    expect(requested.length).toBeGreaterThanOrEqual(2);
    expect(requested.filter((used) => !documented.includes(used))).toEqual([]);
    // Nothing sends a request but the client
    for (const [name, code] of callers) {
      expect([name, /\.request\(/.test(code)]).toEqual([name, false]);
    }
  });

  it('reads the paths of a request in code, and flags one it cannot read', () => {
    const constants = new Map([['SOME_PATH', '/a/b.php']]);
    expect(
      requestedPaths(
        'client.getPage(`/${park.slug}/book-now/`); client.postAjax(SOME_PATH, form, o); ' +
          'client.getPage(address, { signal })',
        constants
      )
    ).toEqual(['/<slug>/book-now/', '/a/b.php', 'unreadable: .getPage(address']);
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
