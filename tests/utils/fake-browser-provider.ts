/**
 * FakeBrowserProvider: a test-only provider with no API (V7). It reads the fake holiday-park
 * site (`tests/fixtures/fake-browser-site.ts`) through `ctx.browser.withPage`, the way a real
 * browser-driven provider (RAC, Airbnb, …) would, and maps what it reads to the normalised
 * `LocationSummary`, `LocationDetail` and `LocationAvailability`. It is the worked example for
 * `docs/providers/browser-providers.md`.
 *
 *   const factory = createFakeBrowserProviderFactory();                   // https://fake-browser.example
 *   const factory = createFakeBrowserProviderFactory({ baseUrl: server }); // a real browser on loopback
 *   const provider = factory(createTestProviderContext(factory.manifest));
 *
 * The page functions passed to `$$eval` run inside the browser, so they only use their
 * arguments: no closures over Node variables.
 */

import {
  defineProvider,
  ProviderHttpError,
  type ProviderContext,
  type ProviderFactory,
} from '@main/providers/sdk';
import type { LocationDetail, LocationSummary } from '@shared/types/catalog.types';
import type {
  LocationAvailability,
  LocationKind,
  NightState,
  NightStatus,
  ProviderManifest,
  StayQuery,
  UnitAvailability,
} from '@shared/types/provider.types';
import { makeLocationKey } from '@shared/utils/location-key';
import type { Page } from 'playwright-core';

export const FAKE_BROWSER_BASE_URL = 'https://fake-browser.example';

export interface FakeBrowserProviderOptions {
  id?: string;
  /** Where the site is. Default `https://fake-browser.example` (the mocked pages). */
  baseUrl?: string;
}

export function fakeBrowserManifest(id = 'fake-browser'): ProviderManifest {
  return {
    id,
    name: 'Fake Holiday Parks',
    shortName: 'Fake Parks',
    description: 'A browser-driven provider for tests.',
    website: FAKE_BROWSER_BASE_URL,
    integration: 'browser',
    brand: { color: '#2F5D50', monogram: 'FP' },
    locationKinds: ['holiday-park', 'caravan-park', 'other'],
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
    // A browser is slow and visible to the site: keep it polite.
    limits: { minWatchIntervalMinutes: 30, maxConcurrentRequests: 1, catalogTtlHours: 24 },
  };
}

/** What the site's park markup holds, read in the page. */
interface RawPark {
  externalId: string;
  kind: string;
  lat: number;
  lng: number;
  name: string;
  town: string;
  region: string;
  summary: string;
}

/** The site's words for kinds of park → normalised `LocationKind`. */
const KINDS: Record<string, LocationKind> = { holiday: 'holiday-park', caravan: 'caravan-park' };

/** The site's words for a night → normalised `NightState`. */
const NIGHT_STATES: Record<string, NightState> = {
  vacant: 'available',
  booked: 'booked',
  closed: 'closed',
};

/** `$145.00` → 145; anything without a number → undefined. */
function parsePrice(text: string): number | undefined {
  const match = /\$\s*([\d,]+(?:\.\d+)?)/.exec(text);
  return match ? Number(match[1].replace(/,/g, '')) : undefined;
}

/** Runs in the page: reads every `[data-location]` element. Uses only its argument. */
function readParks(elements: Element[]): RawPark[] {
  const text = (root: Element, testId: string): string =>
    root.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
  return elements.map((el) => ({
    externalId: el.getAttribute('data-location') ?? '',
    kind: el.getAttribute('data-kind') ?? '',
    lat: Number(el.getAttribute('data-lat')),
    lng: Number(el.getAttribute('data-lng')),
    name: text(el, 'park-name'),
    town: text(el, 'park-town'),
    region: text(el, 'park-region'),
    summary: text(el, 'park-summary'),
  }));
}

export function createFakeBrowserProviderFactory(
  options: FakeBrowserProviderOptions = {}
): ProviderFactory {
  const manifest = fakeBrowserManifest(options.id);
  const base = options.baseUrl ?? FAKE_BROWSER_BASE_URL;

  return defineProvider(manifest, (ctx: ProviderContext) => {
    const id = ctx.id;
    const url = (path: string): string => new URL(path, base).href;
    const parkPath = (externalId: string): string => `/parks/${encodeURIComponent(externalId)}`;

    const links = {
      location: (externalId: string) => url(parkPath(externalId)),
      booking: (externalId: string, stay?: StayQuery) =>
        url(
          stay
            ? `${parkPath(externalId)}/availability?arrival=${stay.arrival}&departure=${stay.departure}`
            : parkPath(externalId)
        ),
    };

    /** Navigates, and turns an error page into a `ProviderHttpError`. */
    async function open(page: Page, path: string): Promise<void> {
      const target = url(path);
      const response = await page.goto(target, { waitUntil: 'domcontentloaded' });
      const status = response?.status() ?? 0;
      if (status < 200 || status >= 300)
        throw new ProviderHttpError({ providerId: id, status, url: target });
    }

    function toSummary(raw: RawPark): LocationSummary {
      return {
        key: makeLocationKey(id, raw.externalId),
        providerId: id,
        externalId: raw.externalId,
        name: raw.name,
        kind: KINDS[raw.kind] ?? 'other',
        bookingMode: 'online',
        lat: raw.lat,
        lng: raw.lng,
        area: { name: raw.town, region: raw.region || undefined },
        summary: raw.summary || undefined,
        imageUrls: [],
        amenities: [],
        infoUrl: links.location(raw.externalId),
        bookingUrl: links.booking(raw.externalId),
      };
    }

    return {
      links,
      catalog: {
        listLocations: (signal) =>
          ctx.browser.withPage(
            async (page) => {
              await open(page, '/parks');
              const parks = await page.$$eval('[data-location]', readParks);
              return parks.map(toSummary);
            },
            { signal }
          ),

        getLocation: (externalId, signal) =>
          ctx.browser.withPage(
            async (page): Promise<LocationDetail> => {
              await open(page, parkPath(externalId));
              const [park] = await page.$$eval('main[data-location]', readParks);
              const units = await page.$$eval('[data-unit]', (elements) =>
                elements.map((el) => ({
                  unitId: el.getAttribute('data-unit') ?? '',
                  unitName: el.textContent?.trim() ?? '',
                  unitType: el.getAttribute('data-unit-type') ?? undefined,
                  maxPeople: Number(el.getAttribute('data-sleeps')) || undefined,
                }))
              );
              return {
                ...toSummary(park),
                unitCount: units.length,
                units,
                fetchedAt: ctx.clock().toISOString(),
              };
            },
            { signal }
          ),
      },

      availability: {
        check: (externalId, stay, { unitIds, signal } = {}) =>
          ctx.browser.withPage(
            async (page): Promise<LocationAvailability> => {
              await open(
                page,
                `${parkPath(externalId)}/availability?arrival=${stay.arrival}&departure=${stay.departure}`
              );
              const rows = await page.$$eval('tr[data-unit]', (elements) =>
                elements.map((row) => ({
                  unitId: row.getAttribute('data-unit') ?? '',
                  unitName: row.querySelector('th')?.textContent?.trim() ?? '',
                  unitType: row.getAttribute('data-unit-type') ?? undefined,
                  nights: Array.from(row.querySelectorAll('[data-night]')).map((cell) => ({
                    date: cell.getAttribute('data-night') ?? '',
                    status: cell.getAttribute('data-status') ?? '',
                    text: cell.textContent?.trim() ?? '',
                  })),
                }))
              );
              const units = rows
                .filter((row) => !unitIds || unitIds.includes(row.unitId))
                .map((row): UnitAvailability => {
                  const nights: NightStatus[] = row.nights
                    // Only the stay's nights, whatever the page shows.
                    .filter((n) => n.date >= stay.arrival && n.date < stay.departure)
                    .map((n) => {
                      const state = NIGHT_STATES[n.status] ?? 'unknown';
                      const price = state === 'available' ? parsePrice(n.text) : undefined;
                      return { date: n.date, state, price, label: n.text };
                    });
                  const fullyAvailable =
                    nights.length > 0 && nights.every((n) => n.state === 'available');
                  const total = fullyAvailable
                    ? nights.reduce((sum, n) => sum + (n.price ?? 0), 0)
                    : undefined;
                  return {
                    unitId: row.unitId,
                    unitName: row.unitName,
                    unitType: row.unitType,
                    nights,
                    fullyAvailable,
                    total,
                  };
                });
              return {
                key: makeLocationKey(id, externalId),
                checkedAt: ctx.clock().toISOString(),
                units,
                bookingUrl: links.booking(externalId, stay),
              };
            },
            { signal }
          ),
      },
    };
  });
}
