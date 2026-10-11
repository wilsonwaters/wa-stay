/**
 * The fictional Example Holiday Parks website the example browser provider reads
 * (`tests/fixtures/providers/example-browser/index.ts`), for the fake browser
 * (`tests/utils/fake-browser.ts`). `renderExampleSite(url)` answers each request with a status
 * and a body, using the attributes and words a real site would: the park list, each park's page
 * with its availability search form, and the JSON that form's script fetches before it draws
 * the availability table.
 */

export interface ExampleSitePage {
  status: number;
  /** The body: a page's HTML, or JSON for the form's script. */
  html: string;
  headers?: Record<string, string>;
}

interface Park {
  id: string;
  kind: string;
  name: string;
  town: string;
  lat: number;
  lng: number;
  cabins: { id: string; name: string; nights: Record<string, [status: string, label: string]> }[];
}

const PARKS: Park[] = [
  {
    id: 'sunset-bay',
    kind: 'holiday',
    name: 'Sunset Bay Holiday Park',
    town: 'Busselton',
    lat: -33.6455,
    lng: 115.3459,
    cabins: [
      {
        id: 'c1',
        name: 'Beach Cabin 1',
        nights: {
          '2026-11-09': ['vacant', '$150.00'],
          '2026-11-10': ['vacant', '$145.00'],
          '2026-11-11': ['vacant', '$155.00'],
        },
      },
      {
        id: 'c2',
        name: 'Garden Cabin 2',
        nights: { '2026-11-10': ['booked', 'Booked'], '2026-11-11': ['vacant', '$120.00'] },
      },
    ],
  },
  {
    id: 'river-gums',
    kind: 'caravan',
    name: 'River Gums Caravan Park',
    town: 'Northam',
    lat: -31.6531,
    lng: 116.6675,
    cabins: [],
  },
];

const page = (body: string, status = 200): ExampleSitePage => ({
  status,
  html: `<!doctype html><html><head><title>Example Holiday Parks</title></head><body>${body}</body></html>`,
});

function parkAttributes(park: Park): string {
  return `data-park="${park.id}" data-kind="${park.kind}" data-lat="${park.lat}" data-lng="${park.lng}"`;
}

function parkHeading(park: Park): string {
  return `<h2 data-testid="name">${park.name}</h2><span data-testid="town">${park.town}</span>`;
}

/** The park page's script: on submit it fetches the stay's nights and draws the table. */
const SEARCH_SCRIPT = `
  const form = document.querySelector('form[data-search]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = new URLSearchParams(new FormData(form));
    const { cabins } = await (await fetch('/api/availability?' + query)).json();
    const table = document.querySelector('table[data-results]');
    table.tBodies[0].innerHTML = cabins
      .map((cabin) =>
        '<tr data-unit="' + cabin.id + '" data-unit-name="' + cabin.name + '">' +
        cabin.nights
          .map((n) => '<td data-night="' + n.date + '" data-status="' + n.status + '">' + n.label + '</td>')
          .join('') +
        '</tr>'
      )
      .join('');
    table.hidden = false;
  });
`;

function searchForm(park: Park): string {
  return `<form data-search>
    <input type="hidden" name="park" value="${park.id}">
    <label>Arrival <input type="date" name="arrival" required></label>
    <label>Departure <input type="date" name="departure" required></label>
    <label>Guests <input type="number" name="guests" min="1" value="2"></label>
    <button type="submit">Check availability</button>
  </form>
  <table data-results aria-label="Availability" hidden><tbody></tbody></table>
  <script>${SEARCH_SCRIPT}</script>`;
}

/** What the search form's script fetches: the whole week, whatever the stay. */
function availability(parkId: string | null): ExampleSitePage {
  const park = PARKS.find((p) => p.id === parkId);
  const json = (status: number, body: unknown): ExampleSitePage => ({
    status,
    html: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
  if (!park) return json(404, { error: 'no such park' });
  const cabins = park.cabins.map((cabin) => ({
    id: cabin.id,
    name: cabin.name,
    nights: Object.entries(cabin.nights).map(([date, [status, label]]) => ({
      date,
      status,
      label,
    })),
  }));
  return json(200, { cabins });
}

export function renderExampleSite(url: URL): ExampleSitePage {
  if (url.pathname === '/parks') {
    const items = PARKS.map((park) => `<li ${parkAttributes(park)}>${parkHeading(park)}</li>`);
    return page(`<ul class="css-1x2y3z">${items.join('')}</ul>`);
  }
  if (url.pathname === '/api/availability') return availability(url.searchParams.get('park'));
  const match = /^\/parks\/([^/]+)$/.exec(url.pathname);
  const park = match && PARKS.find((p) => p.id === decodeURIComponent(match[1]));
  if (!park) return page('<h1>Page not found</h1>', 404);

  const units = park.cabins.map((cabin) => `<li data-unit="${cabin.id}">${cabin.name}</li>`);
  return page(
    `<main ${parkAttributes(park)}>${parkHeading(park)}<ul>${units.join('')}</ul>${searchForm(park)}</main>`
  );
}
