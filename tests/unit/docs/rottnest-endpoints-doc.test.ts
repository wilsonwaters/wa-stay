/**
 * @jest-environment node
 *
 * docs/providers/rottnest/endpoints.md stays true to the Stay Rottnest module
 * (`src/main/providers/rottnest/`):
 * - every row of its endpoint tables has a status from the page's own legend;
 * - the one path the client requests is its first table's, "Requests WA Stay sends", and nothing
 *   but the client sends a request;
 * - every page `links.ts` gives is in "Pages WA Stay links to";
 * - a path it lists as "Known, never used" is named nowhere in the module's code, comments left
 *   out.
 */

import fs from 'fs';
import path from 'path';
import { stripComments } from '../../utils/strip-comments';
import { pathsIn, readDoc, ROOT, tableRows } from './markdown';

const DOC = 'docs/providers/rottnest/endpoints.md';
const MODULE_DIR = 'src/main/providers/rottnest';
const FIRST_TABLE = 'Requests WA Stay sends';
const LINKS_TABLE = 'Pages WA Stay links to';
const NEVER_USED = 'Known, never used';
const NOT_ENDPOINTS = new Set(['Status legend']);
/** What names each never-used path in code. */
const NEVER_USED_NAMES = [
  '/details/',
  'hotel-occupancys',
  '/offers',
  'challenge-platform',
  'cms/stayrottnest/pdfs',
];

/** The module's TypeScript files, by name, with their comments blanked out. */
function moduleSources(): Map<string, string> {
  const dir = path.join(ROOT, MODULE_DIR);
  return new Map(
    fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => [name, stripComments(fs.readFileSync(path.join(dir, name), 'utf8'))])
  );
}

/** Whether `code` sends a request itself: any call on an `http` object, or any `.request(…)`. */
function sendsOwnRequest(code: string): boolean {
  return /\bhttp\.\w+\s*\(/.test(code) || /\.request\s*\(/.test(code);
}

/** A documented path without its query, as code names it. */
const withoutQuery = (documented: string): string => documented.split('?')[0];

describe(DOC, () => {
  const rows = tableRows(readDoc(DOC));
  const legend = new Set(rows.filter((r) => r.section === 'Status legend').map((r) => r.cells[0]));
  const endpoints = rows.filter((r) => !NOT_ENDPOINTS.has(r.section));
  const sources = moduleSources();
  const client = sources.get('client.ts') ?? '';
  const links = sources.get('links.ts') ?? '';
  const documented = (table: string) =>
    rows.filter((r) => r.section === table).flatMap((r) => pathsIn(r.cells[1]).map(withoutQuery));

  it('has a legend with its three kinds of status', () => {
    expect([...legend]).toEqual([
      'From a browser capture, 2026-10-18',
      'Linked, not requested',
      NEVER_USED,
    ]);
  });

  it('gives every row of its endpoint tables a status from the legend', () => {
    expect(new Set(endpoints.map((r) => r.section))).toEqual(
      new Set([FIRST_TABLE, LINKS_TABLE, NEVER_USED])
    );
    expect(endpoints.filter((r) => !legend.has(r.cells[2])).map((r) => r.cells)).toEqual([]);
    expect(
      endpoints.filter((r) => (r.section === NEVER_USED) !== (r.cells[2] === NEVER_USED))
    ).toEqual([]);
  });

  it('documents the one path the client requests, and nothing else sends a request', () => {
    const resultsPath = /export const ROTTNEST_RESULTS_PATH = '([^']+)'/.exec(links)?.[1];
    expect(resultsPath).toBe('/rates-room1');
    expect(documented(FIRST_TABLE)).toEqual([resultsPath]);
    // The client's one call that sends: a GET of the results path, and nothing else
    expect([...client.matchAll(/this\.get\(\s*([^,)]*)/g)].map((m) => m[1].trim())).toEqual([
      'ROTTNEST_RESULTS_PATH',
    ]);
    expect([...client.matchAll(/http\.request\(\s*'(\w+)'/g)].map((m) => m[1])).toEqual(['GET']);
    for (const [name, code] of sources) {
      if (name !== 'client.ts') expect([name, sendsOwnRequest(code)]).toEqual([name, false]);
    }
  });

  it('lists every page the module links to', () => {
    const linked = documented(LINKS_TABLE);
    const paths = [...links.matchAll(/\$\{ROTTNEST_(?:BOOKINGS|SITE)_URL\}(\/[\w-]+)/g)].map(
      (m) => m[1]
    );
    expect(paths).toEqual(expect.arrayContaining(['/search-rates', '/login']));
    for (const linkPath of paths) {
      expect([linkPath, linked.some((doc) => doc.endsWith(linkPath))]).toEqual([linkPath, true]);
    }
    expect(linked).toContain('/rates-room1');
  });

  it('names no never-used path in the module’s code', () => {
    const never = rows.filter((r) => r.section === NEVER_USED);
    expect(never).toHaveLength(NEVER_USED_NAMES.length + 1);
    const named = [...sources].flatMap(([name, code]) =>
      NEVER_USED_NAMES.filter((part) => code.includes(part)).map((part) => `${name}: ${part}`)
    );
    expect(named).toEqual([]);
    // Each name stands for a row of the table
    for (const part of NEVER_USED_NAMES) {
      expect([part, never.some((r) => r.cells[1].includes(part))]).toEqual([part, true]);
    }
  });

  it('tells a request sent around the client from a call to it', () => {
    expect(sendsOwnRequest('await ctx.http.getJson(url, { signal })')).toBe(true);
    expect(sendsOwnRequest("this.deps.http.request('GET', url, {})")).toBe(true);
    expect(sendsOwnRequest('client.search(stay, { signal })')).toBe(false);
  });
});
