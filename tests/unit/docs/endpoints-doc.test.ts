/**
 * @jest-environment node
 *
 * docs/providers/parkstay/endpoints.md: every endpoint row has a status from the page's own
 * legend, the endpoints the ParkStay module calls are documented, and no route marked
 * "Not a real route" appears anywhere in the module's code.
 */

import fs from 'fs';
import path from 'path';
import { readDoc, ROOT } from './markdown';

const DOC = 'docs/providers/parkstay/endpoints.md';
const PARKSTAY_DIR = path.join(ROOT, 'src/main/providers/parkstay');
const NOT_REAL = 'Not a real route';

interface Row {
  section: string;
  cells: string[];
}

/** Every data row of every table, with the `##` section it is in. */
function tableRows(text: string): Row[] {
  const rows: Row[] = [];
  let section = '';
  let header: string[] | null = null;
  for (const line of text.split('\n')) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) section = heading[1].trim();
    if (!line.startsWith('|')) {
      header = null;
      continue;
    }
    const cells = line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((cell) => cell.trim());
    if (!header) header = cells;
    else if (!cells.every((cell) => /^:?-+:?$/.test(cell))) rows.push({ section, cells });
  }
  return rows;
}

function parkstaySources(dir = PARKSTAY_DIR): string {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .map((entry) => {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) return parkstaySources(file);
      return entry.name.endsWith('.ts') ? fs.readFileSync(file, 'utf8') : '';
    })
    .join('\n');
}

/** The backticked paths in a cell. */
const pathsIn = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

describe(DOC, () => {
  const rows = tableRows(readDoc(DOC));
  const legend = new Set(rows.filter((r) => r.section === 'Status legend').map((r) => r.cells[0]));
  const endpoints = rows.filter(
    (r) => r.section !== 'Status legend' && r.section !== 'The availability tuple'
  );
  const sources = parkstaySources();

  it('has a legend with the four kinds of status', () => {
    expect([...legend]).toEqual(
      expect.arrayContaining([
        'Verified live 2026-10-02',
        'Verified live 2026-04-06',
        'In DBCA source, not probed',
        NOT_REAL,
      ])
    );
  });

  it('gives every endpoint row a status from the legend', () => {
    const tables = new Set(endpoints.map((r) => r.section));
    expect(tables).toEqual(
      new Set([
        'API endpoints WA Stay calls',
        'Pages WA Stay opens or links to',
        'In the DBCA backend, not used',
        'Not real routes',
      ])
    );
    expect(endpoints.length).toBeGreaterThan(25);
    expect(endpoints.filter((r) => !legend.has(r.cells[2])).map((r) => r.cells)).toEqual([]);
  });

  it('documents every endpoint the ParkStay module requests', () => {
    const called = rows
      .filter((r) => r.section === 'API endpoints WA Stay calls')
      .flatMap((r) => pathsIn(r.cells[1]));
    // The paths the module's code passes to the client (API paths without the `/api` base).
    for (const used of [
      '/campground_map/',
      '/campsite_availablity_view/',
      '/campground_availabilty_view/',
      '/create_booking',
      '/api/check-create-session/',
      '/search-availability/campground/',
    ]) {
      expect(sources).toContain(used);
      expect(called.some((doc) => doc.includes(used))).toBe(true);
    }
    expect(called).toContain('/api/profile');
  });

  it('marks routes "Not a real route" only when the module never names them', () => {
    const fake = endpoints
      .filter((r) => r.cells[2] === NOT_REAL)
      .flatMap((r) => pathsIn(r.cells[1]));
    expect(fake.length).toBeGreaterThanOrEqual(10);
    // A path the code requests starts a string or follows a base URL (`${base}/path`); the
    // client adds `/api` itself. Compare up to the first placeholder.
    const requests = (route: string): boolean => {
      const named = route.replace(/^\/api(?=\/)/, '').split('{')[0];
      const escaped = named.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(['"\`]|\\})${escaped}`).test(sources);
    };
    expect(requests('/api/campground_map/')).toBe(true);
    expect(requests('/api/campsite_availablity_view/{id}/')).toBe(true);
    for (const route of fake) expect([route, requests(route)]).toEqual([route, false]);
  });
});
