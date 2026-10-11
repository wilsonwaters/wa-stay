/**
 * Example API provider: the worked example in docs/providers/adding-a-provider.md.
 *
 * "Example Parks" is a fictional JSON booking API. The provider reads it through `ctx.http`
 * and maps what it gets to the normalised SDK types; it places holds (`holds.ts`) and has an
 * optional account with a `browser-session` sign-in (`auth.ts`). Tests answer its requests from
 * the recorded responses `manifest.json` lists (a FixtureHttpClient), or from a loopback server
 * (`tests/unit/docs/example-providers.test.ts`).
 *
 * Each region between `// #region docs:<name>` and `// #endregion` is a code block of the
 * guide, word for word; `tests/unit/docs/docs-sync.test.ts` keeps the two in step.
 */

// #region docs:api-imports
import { z } from 'zod';
import {
  createLimiter,
  defineProvider,
  ProviderParseError,
  type ProviderContext,
  type ProviderFactory,
  type ProviderLinks,
} from '@main/providers/sdk';
import type { LocationDetail, LocationSummary } from '@shared/types/catalog.types';
import type {
  BulkAvailabilityEntry,
  LocationAvailability,
  LocationKind,
  NightState,
  NightStatus,
  ProviderManifest,
  StayQuery,
  UnitAvailability,
} from '@shared/types/provider.types';
import { eachNight } from '@shared/utils/calendar-date';
import { makeLocationKey } from '@shared/utils/location-key';
import { createExampleAuth } from './auth';
import { createExampleHolds } from './holds';
// #endregion

// #region docs:api-manifest
export const exampleApiManifest: ProviderManifest = {
  id: 'example-api',
  name: 'Example Parks WA',
  shortName: 'Example Parks',
  description: 'Campgrounds and cabins from the Example Parks booking API.',
  website: 'https://www.example-parks.test',
  integration: 'api',
  // A coloured monogram badge: never a third-party logo. White text on it must pass AA.
  brand: { color: '#1F5A7A', monogram: 'EP' },
  locationKinds: ['campground', 'cabin', 'other'],
  timezone: 'Australia/Perth',
  currency: 'AUD',
  capabilities: {
    catalog: true,
    catalogMode: 'full',
    availability: true,
    bulkAvailability: true,
    watches: true,
    snipes: false,
    // Holds (holds.ts), and an account that helps but is never needed (auth.ts).
    holds: true,
    bookingImport: false,
    accessGate: false,
    account: 'optional',
  },
  limits: { minWatchIntervalMinutes: 30, maxConcurrentRequests: 2, catalogTtlHours: 24 },
  stayFields: [
    {
      key: 'siteType',
      label: 'Site type',
      type: 'select',
      options: [
        { value: 'any', label: 'Any' },
        { value: 'powered', label: 'Powered' },
        { value: 'unpowered', label: 'Unpowered' },
      ],
      default: 'any',
      appliesTo: ['availability', 'watch'],
    },
  ],
  // The bulk endpoint reads only the dates: a change of party or site type reuses its answer.
  bulkAvailabilityStayFields: ['arrival', 'departure'],
};
// #endregion

// #region docs:api-raw
/** What the API returns. Validated: a provider's JSON is not a contract. */
const RawPark = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  type: z.string(),
  lat: z.number(),
  lng: z.number(),
  town: z.string(),
  region: z.string().optional(),
  photos: z.array(z.string()),
  facilities: z.array(z.string()),
  siteCount: z.number().int().optional(),
});
const RawParkList = z.object({ parks: z.array(RawPark) });
const RawParkDetail = RawPark.extend({
  description: z.string().optional(),
  sites: z.array(
    z.object({ id: z.string(), name: z.string(), type: z.string(), sleeps: z.number() })
  ),
});
const RawAvailability = z.object({
  sites: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      nights: z.array(z.object({ date: z.string(), status: z.string(), price: z.number() })),
    })
  ),
});
const RawBulk = z.object({
  parks: z.array(z.object({ id: z.number().int(), free: z.number().int(), total: z.number() })),
});
type RawPark = z.infer<typeof RawPark>;
// #endregion

// #region docs:api-mapping
/** The API's words, mapped explicitly. An unknown word gets the neutral value. */
const KINDS: Record<string, LocationKind> = { campground: 'campground', cabin: 'cabin' };
const NIGHT_STATES: Record<string, NightState> = {
  open: 'available',
  booked: 'booked',
  closed: 'closed',
  'not-yet-open': 'not-released',
};

/** Only the stay's own nights, each `YYYY-MM-DD`; a night the API left out is `unknown`. */
function toNights(stay: StayQuery, raw: { date: string; status: string; price: number }[]) {
  const byDate = new Map(raw.map((night) => [night.date, night]));
  return eachNight(stay.arrival, stay.departure).map((date): NightStatus => {
    const night = byDate.get(date);
    const state = (night && NIGHT_STATES[night.status]) ?? 'unknown';
    return state === 'available' ? { date, state, price: night!.price } : { date, state };
  });
}
// #endregion

export interface ExampleApiOptions {
  /** Where the API is. Tests pass a fixture host or their loopback server. */
  baseUrl?: string;
}

/** Example Parks' website: its pages, sign-in and checkout. */
const SITE = 'https://www.example-parks.test';

// #region docs:api-factory
export function createExampleApiFactory({
  baseUrl = 'https://api.example-parks.test',
}: ExampleApiOptions = {}): ProviderFactory {
  return defineProvider(exampleApiManifest, (ctx: ProviderContext) => {
    // Every request: JSON, and no more in flight than the manifest's limit.
    const http = ctx.http.withDefaults({ headers: { Accept: 'application/json' } });
    const limit = createLimiter(ctx.limits.maxConcurrentRequests);

    async function get<T>(
      path: string,
      schema: z.ZodType<T>,
      { query, signal }: { query?: Record<string, string | number>; signal?: AbortSignal } = {}
    ): Promise<T> {
      const url = new URL(path, baseUrl).href;
      // `query` is encoded for you. A non-2xx answer is a ProviderHttpError, a body that is
      // not JSON a ProviderParseError.
      const body = await limit(() => http.getJson<unknown>(url, { query, signal }));
      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new ProviderParseError({ providerId: ctx.id, url, message: `Unexpected ${path}` });
      }
      return parsed.data;
    }

    const links: ProviderLinks = {
      location: (externalId) => `${SITE}/parks/${encodeURIComponent(externalId)}`,
      booking: (externalId, stay) => {
        const page = `${SITE}/book/${encodeURIComponent(externalId)}`;
        return stay
          ? `${page}?${new URLSearchParams({ from: stay.arrival, to: stay.departure })}`
          : page;
      },
    };

    function toSummary(raw: RawPark): LocationSummary {
      const externalId = String(raw.id);
      return {
        key: makeLocationKey(ctx.id, externalId),
        providerId: ctx.id,
        externalId,
        name: raw.name,
        kind: KINDS[raw.type] ?? 'other',
        bookingMode: 'online',
        lat: raw.lat,
        lng: raw.lng,
        area: { name: raw.town, region: raw.region },
        imageUrls: raw.photos.filter((url) => url.startsWith('https://')),
        amenities: raw.facilities,
        unitCount: raw.siteCount,
        infoUrl: links.location(externalId) ?? undefined,
        bookingUrl: links.booking(externalId) ?? undefined,
      };
    }

    return {
      links,
      catalog: {
        async listLocations(signal) {
          const { parks } = await get('/api/parks', RawParkList, { signal });
          return parks.map(toSummary);
        },
        async getLocation(externalId, signal): Promise<LocationDetail> {
          const park = await get(`/api/parks/${encodeURIComponent(externalId)}`, RawParkDetail, {
            signal,
          });
          return {
            ...toSummary(park),
            // Raw provider HTML: main sanitises it before it crosses IPC.
            descriptionHtml: park.description,
            units: park.sites.map((site) => ({
              unitId: site.id,
              unitName: site.name,
              unitType: site.type,
              maxPeople: site.sleeps,
            })),
            fetchedAt: ctx.clock().toISOString(),
          };
        },
      },
      availability: {
        async check(externalId, stay, options = {}): Promise<LocationAvailability> {
          // A stay field the person did not set (or a caller that sends none, such as the
          // place page) falls back to the field's default.
          const siteType = stay.params?.siteType ?? 'any';
          const query = {
            arrival: stay.arrival,
            departure: stay.departure,
            guests: stay.adults + (stay.children ?? 0),
            siteType: String(siteType),
          };
          const path = `/api/parks/${encodeURIComponent(externalId)}/availability`;
          const { sites } = await get(path, RawAvailability, { query, signal: options.signal });
          const wanted = options.unitIds?.length ? new Set(options.unitIds) : undefined;
          const units = sites
            .filter((site) => !wanted || wanted.has(site.id))
            .map((site): UnitAvailability => {
              const nights = toNights(stay, site.nights);
              const fullyAvailable = nights.every((night) => night.state === 'available');
              const total = fullyAvailable
                ? nights.reduce((sum, night) => sum + (night.price ?? 0), 0)
                : undefined;
              return { unitId: site.id, unitName: site.name, nights, fullyAvailable, total };
            });
          return {
            key: makeLocationKey(ctx.id, externalId),
            checkedAt: ctx.clock().toISOString(),
            units,
            bookingUrl: links.booking(externalId, stay) ?? undefined,
          };
        },
        async search(stay, signal): Promise<BulkAvailabilityEntry[]> {
          const query = { arrival: stay.arrival, departure: stay.departure };
          const { parks } = await get('/api/availability', RawBulk, { query, signal });
          return parks.map((park) => ({
            key: makeLocationKey(ctx.id, String(park.id)),
            availableUnits: park.free,
            bookableUnits: park.total,
          }));
        },
      },
      // Holds and the sign-in check take their turn with every other request.
      holds: createExampleHolds({
        providerId: ctx.id,
        http,
        limit,
        apiUrl: baseUrl,
        siteUrl: SITE,
      }),
      auth: createExampleAuth({ apiUrl: baseUrl, siteUrl: SITE, limit }),
    };
  });
}
// #endregion

// #region docs:api-register
/** What `src/main/providers/index.ts` would list: `[parkstayFactory, exampleApiFactory]`. */
export const exampleApiFactory = createExampleApiFactory();
// #endregion
