/**
 * A tiny holiday-park website with no API, for the browser-driven FakeProvider (V7). The
 * same pages are rendered into jsdom by the fake `playwright-core` (unit and contract tests)
 * and served over loopback HTTP to a real browser (the opt-in smoke test).
 *
 * - `/parks`: every park, one `[data-location]` element each;
 * - `/parks/<id>`: one park, with its units (`[data-unit]`);
 * - `/parks/<id>/availability?arrival=YYYY-MM-DD&departure=YYYY-MM-DD`: a row per unit
 *   (`[data-unit]`) with a cell per night (`[data-night]`). Cells use the site's own words
 *   (`data-status` vacant / booked / closed) and show the price as text, so the provider has
 *   something to map.
 *
 * Anything else is a 404 page.
 */

import { serveFakeSite, type FakeSiteServer } from '../utils/fake-site';

export interface FakeSiteUnit {
  id: string;
  name: string;
  type: string;
  sleeps: number;
  nightlyPrice: number;
}

export interface FakeSitePark {
  id: string;
  name: string;
  /** The site's own word for the kind of park. */
  kind: 'holiday' | 'caravan';
  lat: number;
  lng: number;
  town: string;
  region: string;
  summary: string;
  units: FakeSiteUnit[];
}

export const FAKE_SITE_PARKS: readonly FakeSitePark[] = [
  {
    id: 'swan-valley',
    name: 'Swan Valley Holiday Park',
    kind: 'holiday',
    lat: -31.8481,
    lng: 116.0049,
    town: 'Swan Valley',
    region: 'Perth',
    summary: 'Cabins and powered sites among the vineyards.',
    units: [
      { id: 'c1', name: 'Cabin 1', type: 'Cabin', sleeps: 4, nightlyPrice: 145 },
      { id: 'p7', name: 'Powered site 7', type: 'Powered site', sleeps: 6, nightlyPrice: 48.5 },
    ],
  },
  {
    id: 'busselton-jetty',
    name: 'Busselton Jetty Caravan Park',
    kind: 'caravan',
    lat: -33.6445,
    lng: 115.3459,
    town: 'Busselton',
    region: 'South West',
    summary: 'Beachfront sites a short walk from the jetty.',
    units: [{ id: 's12', name: 'Site 12', type: 'Unpowered site', sleeps: 4, nightlyPrice: 36 }],
  },
];

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(
    title
  )}</title></head><body>${body}</body></html>`;

const NOT_FOUND = { status: 404, html: page('Not found', '<h1>Page not found</h1>') };

/** Nights from `arrival` up to (not including) `departure`, at most 31. */
function nights(arrival: string, departure: string): string[] {
  const dates: string[] = [];
  const end = Date.parse(`${departure}T00:00:00Z`);
  for (let t = Date.parse(`${arrival}T00:00:00Z`); t < end && dates.length < 31; t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Deterministic: the first unit is vacant every night; the others are closed on days that are
 * a multiple of 7, booked on other even days, and vacant on odd days.
 */
export function fakeSiteStatus(unitIndex: number, date: string): 'vacant' | 'booked' | 'closed' {
  if (unitIndex === 0) return 'vacant';
  const day = Number(date.slice(8, 10));
  if (day % 7 === 0) return 'closed';
  return day % 2 === 0 ? 'booked' : 'vacant';
}

const CELL_TEXT = { booked: 'Booked', closed: 'Closed' } as const;

function listPage(): string {
  const items = FAKE_SITE_PARKS.map(
    (park) =>
      `<li data-location="${park.id}" data-kind="${park.kind}" data-lat="${park.lat}" data-lng="${park.lng}">
        <a href="/parks/${park.id}" data-testid="park-name">${escapeHtml(park.name)}</a>
        <span data-testid="park-town">${escapeHtml(park.town)}</span>,
        <span data-testid="park-region">${escapeHtml(park.region)}</span>
        <p data-testid="park-summary">${escapeHtml(park.summary)}</p>
      </li>`
  ).join('');
  return page('Fake Holiday Parks: all parks', `<h1>Our parks</h1><ul>${items}</ul>`);
}

function parkPage(park: FakeSitePark): string {
  const units = park.units
    .map(
      (unit) =>
        `<li data-unit="${unit.id}" data-unit-type="${escapeHtml(unit.type)}" data-sleeps="${unit.sleeps}">${escapeHtml(unit.name)}</li>`
    )
    .join('');
  return page(
    `${park.name} | Fake Holiday Parks`,
    `<main data-location="${park.id}" data-kind="${park.kind}" data-lat="${park.lat}" data-lng="${park.lng}">
      <h1 data-testid="park-name">${escapeHtml(park.name)}</h1>
      <span data-testid="park-town">${escapeHtml(park.town)}</span>,
      <span data-testid="park-region">${escapeHtml(park.region)}</span>
      <p data-testid="park-summary">${escapeHtml(park.summary)}</p>
      <ul aria-label="Accommodation">${units}</ul>
    </main>`
  );
}

function availabilityPage(park: FakeSitePark, arrival: string, departure: string): string {
  const dates = nights(arrival, departure);
  const rows = park.units
    .map((unit, index) => {
      const cells = dates
        .map((date) => {
          const status = fakeSiteStatus(index, date);
          const text = status === 'vacant' ? `$${unit.nightlyPrice.toFixed(2)}` : CELL_TEXT[status];
          return `<td data-night="${date}" data-status="${status}">${text}</td>`;
        })
        .join('');
      return `<tr data-unit="${unit.id}" data-unit-type="${escapeHtml(unit.type)}"><th scope="row">${escapeHtml(unit.name)}</th>${cells}</tr>`;
    })
    .join('');
  return page(
    `Availability: ${park.name}`,
    `<table aria-label="Availability"><tbody>${rows}</tbody></table>`
  );
}

/** The page for `url` on the fake site. */
export function renderFakeSite(url: URL): { status: number; html: string } {
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 1 && parts[0] === 'parks') return { status: 200, html: listPage() };
  if (parts[0] !== 'parks' || parts.length < 2 || parts.length > 3) return NOT_FOUND;
  const park = FAKE_SITE_PARKS.find((p) => p.id === decodeURIComponent(parts[1]));
  if (!park) return NOT_FOUND;
  if (parts.length === 2) return { status: 200, html: parkPage(park) };
  if (parts[2] !== 'availability') return NOT_FOUND;
  const arrival = url.searchParams.get('arrival') ?? '';
  const departure = url.searchParams.get('departure') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arrival) || !/^\d{4}-\d{2}-\d{2}$/.test(departure)) {
    return { status: 400, html: page('Bad request', '<h1>Choose your dates</h1>') };
  }
  return { status: 200, html: availabilityPage(park, arrival, departure) };
}

/** Serves the fake site on a loopback port (for a real browser). */
export function startFakeSiteServer(): Promise<FakeSiteServer> {
  return serveFakeSite(renderFakeSite);
}
