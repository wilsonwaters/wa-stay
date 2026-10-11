/**
 * Example browser provider: the second worked example in docs/providers/adding-a-provider.md.
 *
 * "Example Holiday Parks" is a fictional site with no API: the provider reads its pages in
 * the person's installed Edge or Chrome through `ctx.browser.withPage` (playwright-core), and
 * maps what it reads to the normalised SDK types. A park's availability appears only after its
 * search form runs: the site's script fetches the nights and draws a table. Tests give the
 * provider the fake browser (`tests/utils/fake-browser.ts`), whose pages come from `site.ts`,
 * scripts and all (`tests/unit/docs/example-providers.test.ts`).
 *
 * Each region between `// #region docs:<name>` and `// #endregion` is a code block of the
 * guide, word for word; `tests/unit/docs/docs-sync.test.ts` keeps the two in step.
 */

// #region docs:browser-imports
import type { Page } from 'playwright-core';
import {
  defineProvider,
  ProviderHttpError,
  type ProviderContext,
  type ProviderFactory,
  type ProviderLinks,
} from '@main/providers/sdk';
import type { LocationDetail, LocationSummary } from '@shared/types/catalog.types';
import type {
  LocationAvailability,
  LocationKind,
  NightState,
  NightStatus,
  ProviderManifest,
  UnitAvailability,
} from '@shared/types/provider.types';
import { eachNight } from '@shared/utils/calendar-date';
import { makeLocationKey } from '@shared/utils/location-key';
// #endregion

// #region docs:browser-manifest
export const exampleBrowserManifest: ProviderManifest = {
  id: 'example-browser',
  name: 'Example Holiday Parks',
  shortName: 'Example Holiday',
  description: 'Holiday parks and cabins from the Example Holiday Parks website.',
  website: 'https://www.example-holiday.test',
  integration: 'browser',
  brand: { color: '#7A3B1F', monogram: 'EH' },
  locationKinds: ['holiday-park', 'caravan-park', 'cabin', 'other'],
  timezone: 'Australia/Perth',
  currency: 'AUD',
  capabilities: {
    catalog: true,
    catalogMode: 'full',
    availability: true,
    bulkAvailability: false,
    watches: false,
    snipes: false,
    holds: false,
    bookingImport: false,
    accessGate: false,
    account: 'none',
  },
  // A page visit costs the site far more than an API call: one page at a time, and rarely.
  limits: { minWatchIntervalMinutes: 60, maxConcurrentRequests: 1, catalogTtlHours: 72 },
};
// #endregion

// #region docs:browser-read
/** What the park markup holds, read inside the page. */
interface RawPark {
  externalId: string;
  kind: string;
  lat: number;
  lng: number;
  name: string;
  town: string;
}

interface RawUnit {
  unitId: string;
  unitName: string;
  nights: { date: string; status: string; label: string }[];
}

/** The part of a DOM element the page functions read (main's tsconfig has no DOM types). */
interface PageElement {
  getAttribute(name: string): string | null;
  querySelector(selector: string): PageElement | null;
  querySelectorAll(selector: string): ArrayLike<PageElement>;
  readonly textContent: string | null;
}

/**
 * Runs inside the browser: it may use only its argument and browser globals, never a Node
 * variable or import. It reads data attributes and test ids, never CSS class names.
 */
function readParks(elements: PageElement[]): RawPark[] {
  const text = (root: PageElement, testId: string): string =>
    root.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
  return elements.map((el) => ({
    externalId: el.getAttribute('data-park') ?? '',
    kind: el.getAttribute('data-kind') ?? '',
    lat: Number(el.getAttribute('data-lat')),
    lng: Number(el.getAttribute('data-lng')),
    name: text(el, 'name'),
    town: text(el, 'town'),
  }));
}

/** Runs inside the browser, like `readParks`. */
function readUnits(rows: PageElement[]): RawUnit[] {
  return rows.map((row) => ({
    unitId: row.getAttribute('data-unit') ?? '',
    unitName: row.getAttribute('data-unit-name') ?? '',
    nights: Array.from(row.querySelectorAll('[data-night]')).map((cell) => ({
      date: cell.getAttribute('data-night') ?? '',
      status: cell.getAttribute('data-status') ?? '',
      label: cell.textContent?.trim() ?? '',
    })),
  }));
}
// #endregion

// #region docs:browser-mapping
const KINDS: Record<string, LocationKind> = {
  holiday: 'holiday-park',
  caravan: 'caravan-park',
  cabin: 'cabin',
};
const NIGHT_STATES: Record<string, NightState> = {
  vacant: 'available',
  booked: 'booked',
  closed: 'closed',
};

/** `$145.00` → 145; text without a price → undefined. Plain Node code, easy to unit test. */
function parsePrice(label: string): number | undefined {
  const match = /\$\s*([\d,]+(?:\.\d+)?)/.exec(label);
  return match ? Number(match[1].replace(/,/g, '')) : undefined;
}
// #endregion

export interface ExampleBrowserOptions {
  /** Where the site is. */
  baseUrl?: string;
}

// #region docs:browser-factory
export function createExampleBrowserFactory({
  baseUrl = 'https://www.example-holiday.test',
}: ExampleBrowserOptions = {}): ProviderFactory {
  return defineProvider(exampleBrowserManifest, (ctx: ProviderContext) => {
    const url = (path: string): string => new URL(path, baseUrl).href;
    const parkPath = (externalId: string): string => `/parks/${encodeURIComponent(externalId)}`;

    const links: ProviderLinks = {
      location: (externalId) => url(parkPath(externalId)),
      booking: (externalId) => url(`${parkPath(externalId)}/book`),
    };

    /** Navigates, and turns an error page into an error: a page without data is not empty. */
    async function open(page: Page, path: string): Promise<void> {
      const response = await page.goto(url(path), { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;
      if (status < 200 || status >= 300) {
        throw new ProviderHttpError({ providerId: ctx.id, status, url: url(path) });
      }
    }

    function toSummary(raw: RawPark): LocationSummary {
      return {
        key: makeLocationKey(ctx.id, raw.externalId),
        providerId: ctx.id,
        externalId: raw.externalId,
        name: raw.name,
        kind: KINDS[raw.kind] ?? 'other',
        bookingMode: 'online',
        lat: raw.lat,
        lng: raw.lng,
        area: { name: raw.town },
        imageUrls: [],
        amenities: [],
        infoUrl: links.location(raw.externalId) ?? undefined,
      };
    }

    return {
      links,
      catalog: {
        // One unit of work per withPage call; the signal closes the page when it aborts.
        listLocations: (signal) =>
          ctx.browser.withPage(
            async (page) => {
              await open(page, '/parks');
              return (await page.$$eval('[data-park]', readParks)).map(toSummary);
            },
            { signal }
          ),
        getLocation: (externalId, signal) =>
          ctx.browser.withPage(
            async (page): Promise<LocationDetail> => {
              await open(page, parkPath(externalId));
              const [park] = await page.$$eval('main[data-park]', readParks);
              const units = await page.$$eval('li[data-unit]', (items) =>
                items.map((item) => ({
                  unitId: item.getAttribute('data-unit') ?? '',
                  unitName: item.textContent?.trim() ?? '',
                }))
              );
              return { ...toSummary(park), units, fetchedAt: ctx.clock().toISOString() };
            },
            { signal }
          ),
      },
      availability: {
        check: (externalId, stay, options = {}) =>
          ctx.browser.withPage(
            async (page): Promise<LocationAvailability> => {
              await open(page, parkPath(externalId));
              // The park page's own search form: the site's script fetches the nights and
              // draws the table. Locators wait for each field; wait for the table, not a time.
              await page.getByLabel('Arrival').fill(stay.arrival);
              await page.getByLabel('Departure').fill(stay.departure);
              await page.getByLabel('Guests').fill(String(stay.adults + (stay.children ?? 0)));
              await page.getByRole('button', { name: 'Check availability' }).click();
              await page.getByRole('table', { name: 'Availability' }).waitFor();
              const rows = await page.$$eval('tr[data-unit]', readUnits);
              const wanted = options.unitIds?.length ? new Set(options.unitIds) : undefined;
              const units = rows
                .filter((row) => !wanted || wanted.has(row.unitId))
                .map((row): UnitAvailability => {
                  const byDate = new Map(row.nights.map((night) => [night.date, night]));
                  // Only the stay's nights, whatever else the page shows.
                  const nights = eachNight(stay.arrival, stay.departure).map(
                    (date): NightStatus => {
                      const night = byDate.get(date);
                      const state = (night && NIGHT_STATES[night.status]) ?? 'unknown';
                      const price = state === 'available' ? parsePrice(night!.label) : undefined;
                      return { date, state, ...(price !== undefined ? { price } : {}) };
                    }
                  );
                  const fullyAvailable = nights.every((night) => night.state === 'available');
                  return { unitId: row.unitId, unitName: row.unitName, nights, fullyAvailable };
                });
              return {
                key: makeLocationKey(ctx.id, externalId),
                checkedAt: ctx.clock().toISOString(),
                units,
              };
            },
            { signal: options.signal }
          ),
      },
    };
  });
}
// #endregion

export const exampleBrowserFactory = createExampleBrowserFactory();
