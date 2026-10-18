/**
 * RAC Parks & Resorts (`src/main/providers/rac/`): the provider contract suite (availability and
 * watches on), the catalogue (the seed, sent nothing), a park's detail from its trimmed
 * book-now page in `tests/fixtures/providers/rac/` (a native park's from one availability
 * POST, cached by the core for 6 h), and the terms rules a request can break: RAC's host only
 * (rule 1), one request at a time 10 s apart (rules 2 and 4), the block cool-down on the
 * synthetic 403, 429 and challenge pages (rule 5). RAC's bulk availability (Explore's free
 * counts, `bulk.ts`): its counts agree with `check` on every recorded answer, its
 * interactive pace through the core on Jest's fake timers, its deadlines with a place page or a
 * date change in the middle, and its failures (a park that fails, a block, an abort, a newer
 * search). A FixtureHttpClient or a recording client answers every request, so nothing is sent
 * anywhere. Availability itself is `rac-availability.test.ts`.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createProviderContext,
  FakeSecretVault,
  InMemoryKeyValueStore,
  isAbortError,
  ProviderError,
  ProviderHttpError,
  ProviderParseError,
  type HopRequest,
  type ProviderContext,
} from '@main/providers/sdk';
import { INTERACTIVE_REQUEST_GAP_MS, currentRequestPriority } from '@main/providers/sdk/pacing';
import { DEFAULT_CATALOG_TIMINGS } from '@main/core/catalog/location-catalog.service';
import { pacedDeadlineMs } from '@main/core/catalog/catalog-helpers';
import { ProviderRegistry } from '@main/providers/registry';
import { LocationCatalogService } from '@main/core/catalog/location-catalog.service';
import { openDatabase } from '@main/database/connection';
import { LocationRepository, ProviderStateRepository } from '@main/database/repositories';
import { withExperiments } from '@main/providers/experiments';
import { RAC_AUTO_CART_EXPERIMENT, RAC_PARKS, racFactory, racManifest } from '@main/providers/rac';
import { racPark, type RacPark } from '@main/providers/rac/parks';
import { RAC_AVAILABILITY_PATH } from '@main/providers/rac/availability';
import { RAC_BLOCK_STATE_KEY, RacClient } from '@main/providers/rac/client';
import { FixtureHttpClient } from '@main/testing/fixture-http-client';
import type {
  BulkAvailabilityEntry,
  StayQuery,
  UnitAvailability,
  UnitKind,
} from '@shared/types/provider.types';
import { UNIT_KINDS } from '@shared/types/provider.types';
import { addDays } from '@shared/utils/calendar-date';
import {
  createMemoryLogger,
  createTestProviderContext,
  TEST_PROVIDERS_DIR,
} from '@tests/utils/fake-provider';
import {
  pacedContext,
  RecordingHttpClient,
  type HopAnswer,
} from '@tests/utils/fake-paced-provider';
import { describeProviderContract } from '@tests/utils/provider-contract';
import { fakeDateOnly } from '@tests/utils/core-harness';

/** Holds `rac/manifest.json`, which lists the recorded pages by request path. */
const FIXTURES_DIR = path.join(__dirname, '../fixtures/providers');
const RAC_FIXTURES = path.join(FIXTURES_DIR, 'rac');
/** Where a FixtureHttpClient logs a request that no fixture answers (it fails, unsent). */
const UNEXPECTED_LOG = path.join(os.tmpdir(), `rac-unexpected-${process.pid}.log`);
const RAC = 'https://parksandresorts.rac.com.au';
/** The day after the pages were recorded, 10 am in Perth. */
const NOW = new Date('2026-10-17T02:00:00.000Z');
const STAY: StayQuery = { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 };
/** A park's release info: its release policy's `describe()`, with the park's own hour. */
const releaseInfo = (hour: number) =>
  'New dates open daily at midnight AWST, 364 days ahead. School holidays open on ' +
  `RAC's release days at ${hour} am AWST, 48 hours earlier for members.`;
const placeholder = (n: number) =>
  `https://driveau.newbook.cloud/crop_800_450/instances_00000000000000000000000000000000_${n}.jpg`;

/** A test context (in-memory state, a fixed clock) whose HTTP answers from the fixtures. */
function fixtureContext(overrides: Partial<Omit<ProviderContext, 'id'>> = {}): ProviderContext {
  return createTestProviderContext(racManifest, {
    http: new FixtureHttpClient({
      providerId: 'rac',
      fixturesDir: FIXTURES_DIR,
      logFile: UNEXPECTED_LOG,
    }),
    clock: () => NOW,
    ...overrides,
  });
}

/** A fixture context that also records each request it answers (method, URL and body). */
function sendingContext(overrides: Partial<Omit<ProviderContext, 'id'>> = {}) {
  const http = new FixtureHttpClient({
    providerId: 'rac',
    fixturesDir: FIXTURES_DIR,
    logFile: UNEXPECTED_LOG,
  });
  const sent: Array<{ method: string; url: string; body?: string }> = [];
  const request = http.request.bind(http);
  http.request = (method, url, options) => {
    sent.push({ method, url, body: typeof options?.body === 'string' ? options.body : undefined });
    return request(method, url, options);
  };
  return { ctx: fixtureContext({ http, ...overrides }), sent };
}

/** A test context whose HTTP only records: every request answers `body`. */
function recordingContext(body = '<html></html>') {
  const http = new RecordingHttpClient({ providerId: 'rac', respond: () => ({ body }) });
  return { http, ctx: createTestProviderContext(racManifest, { http, clock: () => NOW }) };
}

const page = (name: string) => fs.readFileSync(path.join(RAC_FIXTURES, name), 'utf8');

afterAll(() => fs.rmSync(UNEXPECTED_LOG, { force: true }));

/**
 * The contract suite asks for each release mode's instant at the time it runs. RAC refuses a
 * `daily_rollover` stay that is already open (a watch suits it), so the suite runs at NOW, on a
 * stay whose release is still ahead then: the window edge, whose last night (18 Oct 2027) opens
 * at midnight on 19 Oct 2026, Perth time.
 */
const UNRELEASED_STAY: StayQuery = { arrival: '2027-10-13', departure: '2027-10-19', adults: 2 };

describe('at NOW', () => {
  beforeAll(() => fakeDateOnly(NOW));
  afterAll(() => jest.useRealTimers());

  describeProviderContract('rac', () => ({
    provider: racFactory(fixtureContext()),
    sample: { externalId: 'busselton', stay: UNRELEASED_STAY },
    unknownExternalId: 'ningaloo',
  }));
});

// Auto-cart on (R19): the same suite with RAC's holds, abort included. No cart is opened: the
// suite's holds check aborts before the cart page is asked.
describe('at NOW, with auto-cart on', () => {
  beforeAll(() => fakeDateOnly(NOW));
  afterAll(() => jest.useRealTimers());

  const autoCart = withExperiments(racFactory, [RAC_AUTO_CART_EXPERIMENT]);
  describeProviderContract('rac (autoCart)', () => {
    const provider = autoCart(
      createTestProviderContext(autoCart.manifest, {
        http: new FixtureHttpClient({
          providerId: 'rac',
          fixturesDir: FIXTURES_DIR,
          logFile: UNEXPECTED_LOG,
        }),
        clock: () => NOW,
      })
    );
    expect(provider.holds).toBeDefined();
    return {
      provider,
      sample: { externalId: 'busselton', stay: UNRELEASED_STAY },
      unknownExternalId: 'ningaloo',
    };
  });
});

describe('RAC Parks & Resorts', () => {
  // Registered in a fresh registry, as the app registers it.
  const registry = new ProviderRegistry();
  registry.register(racFactory, () => fixtureContext());
  const provider = registry.require('rac', 'catalog');

  describe('listLocations', () => {
    it('lists the eight parks from the seed: keys, coordinates, areas and unit kinds', async () => {
      const parks = await provider.catalog.listLocations!();
      expect(parks).toHaveLength(8);
      expect(parks.map((p) => [p.key, p.name, p.area, p.unitKinds])).toEqual([
        [
          'rac:busselton',
          'RAC Busselton Holiday Park',
          { name: 'Busselton', region: 'South West' },
          ['campsite', 'cabin'],
        ],
        [
          'rac:cable-beach',
          'RAC Cable Beach Holiday Park',
          { name: 'Broome', region: 'Kimberley' },
          ['campsite', 'cabin'],
        ],
        [
          'rac:cervantes',
          'RAC Cervantes Holiday Park',
          { name: 'Cervantes', region: 'Midwest' },
          ['campsite', 'cabin'],
        ],
        [
          'rac:esperance',
          'RAC Esperance Holiday Park',
          { name: 'Esperance', region: 'South Coast' },
          ['campsite', 'cabin'],
        ],
        [
          'rac:margaret-river',
          'RAC Margaret River Nature Park',
          { name: 'Margaret River', region: 'South West' },
          ['campsite', 'cabin', 'dorm', 'glamping'],
        ],
        [
          'rac:exmouth',
          'RAC Exmouth Cape Holiday Park',
          { name: 'Exmouth', region: 'Pilbara' },
          ['campsite', 'cabin', 'room'],
        ],
        [
          'rac:karri-valley',
          'RAC Karri Valley Resort',
          { name: 'Pemberton', region: 'Warren' },
          ['campsite', 'cabin', 'room'],
        ],
        [
          'rac:monkey-mia',
          'RAC Monkey Mia Dolphin Resort',
          { name: 'Shark Bay', region: 'Midwest' },
          ['campsite', 'cabin', 'room', 'dorm'],
        ],
      ]);
      expect(parks[0]).toEqual({
        key: 'rac:busselton',
        providerId: 'rac',
        externalId: 'busselton',
        name: 'RAC Busselton Holiday Park',
        kind: 'holiday-park',
        bookingMode: 'online',
        lat: -33.6611769,
        lng: 115.2487607,
        area: { name: 'Busselton', region: 'South West' },
        imageUrls: [],
        amenities: [],
        unitKinds: ['campsite', 'cabin'],
        infoUrl: `${RAC}/busselton/`,
        bookingUrl: `${RAC}/busselton/book-now/`,
      });
      for (const park of parks) {
        expect(park).not.toHaveProperty('summary');
        expect(park.lat).toBeLessThan(-13);
        expect(park.lat).toBeGreaterThan(-36);
        expect(park.lng).toBeGreaterThan(112);
        expect(park.lng).toBeLessThan(129);
      }
    });

    it('sends nothing (terms rule 2: no request per sync)', async () => {
      const { http, ctx } = recordingContext();
      await racFactory(ctx).catalog!.listLocations!();
      expect(http.requests).toHaveLength(0);
    });
  });

  describe('getLocation', () => {
    it("gives Busselton's categories as cat:<id> units: kind, type, guests, equipment, pets and photos", async () => {
      const detail = await provider.catalog.getLocation('busselton');
      expect(detail.key).toBe('rac:busselton');
      expect(detail.units.map((u) => [u.unitId, u.unitName, u.unitKind, u.unitType])).toEqual([
        ['cat:9', 'Two Bedroom Cabin (Sleeps 4)', 'cabin', 'Cabins'],
        ['cat:3', 'Studio Room', 'cabin', 'Cabins'],
        ['cat:7', 'Ensuite Site', 'campsite', 'Sites'],
        ['cat:20', 'Powered Big Rig Site', 'campsite', 'Sites'],
        ['cat:4', 'Powered Site', 'campsite', 'Sites'],
        ['cat:5', 'Unpowered Site', 'campsite', 'Sites'],
      ]);
      expect(detail.units[4]).toEqual({
        unitId: 'cat:4',
        unitName: 'Powered Site',
        unitType: 'Sites',
        unitKind: 'campsite',
        maxPeople: 6,
        equipment: [
          'Caravan Without Awning',
          'Caravan with Awning',
          'Caravan with Slideout',
          'Rooftop Tent',
          'Camper Trailer 6+ berth (Large)',
          'Camper Trailer 4 berth (Medium)',
          'Camper Trailer 2 berth (Small)',
          'Motorhome',
          'Campervan',
          'Car & Swag (NO trailer)',
          'Car & Swag (with trailer)',
          'Car and Single Room Tent (Small)',
          'Car and Multiroom Tent (large)',
          'Bus',
        ],
        amenities: ['Max. 6 guests', 'Power', 'Water', 'Pet-friendly', 'Pets allowed (up to 2)'],
        description: 'Placeholder description.',
      });
      // A cabin takes no equipment and no pets
      expect(detail.units[0]).toMatchObject({ maxPeople: 4 });
      expect(detail.units[0].equipment).toBeUndefined();
      expect(detail.units[0].amenities).not.toContain('Pets allowed (up to 2)');
      // The gallery's photos, fetched live, the placeholders here
      expect(detail.imageUrls).toEqual(Array.from({ length: 12 }, (_, i) => placeholder(i + 1)));
      expect(detail.releaseInfo).toBe(releaseInfo(8));
      expect(detail.fetchedAt).toBe(NOW.toISOString());
      // Each unit is a category of sites or cabins, so the place page lists types, not a count
      expect(detail.unitsAreTypes).toBe(true);
    });

    it('gives Margaret River its dorms and its safari tent', async () => {
      const detail = await provider.catalog.getLocation('margaret-river');
      expect(detail.units.map((u) => [u.unitName, u.unitKind, u.unitType])).toEqual([
        ['4 Bedroom Eco Lodge', 'cabin', 'Cabins'],
        ['Modern Safari Tent', 'glamping', 'Glamping'],
        ['Dorm Room - Sleeps 26', 'dorm', 'Dorms'],
        ['Dorm Room - Sleeps 5', 'dorm', 'Dorms'],
        ['Powered Site', 'campsite', 'Sites'],
      ]);
      expect(detail.units[2].maxPeople).toBe(26);
    });

    it.each(['busselton', 'margaret-river'])(
      "%s's seeded unit kinds are its book-now page's kinds",
      async (slug) => {
        const detail = await provider.catalog.getLocation(slug);
        const kinds = new Set(detail.units.map((unit) => unit.unitKind));
        expect(RAC_PARKS.find((park) => park.slug === slug)!.unitKinds).toEqual(
          UNIT_KINDS.filter((kind) => kinds.has(kind))
        );
      }
    );

    it("shows the page's notices that have not ended, as info, in the page's order", async () => {
      const busselton = await provider.catalog.getLocation('busselton');
      // The September 2026 notice ended on 10 Oct
      expect(busselton.notices?.map((n) => [n.level, n.text.slice(0, 60)])).toEqual([
        ['info', 'School Holiday Bookings: For the summer school holiday perio'],
        ['info', 'School holiday bookings: For the 2027 September school holid'],
      ]);
      const margaretRiver = await provider.catalog.getLocation('margaret-river');
      expect(margaretRiver.notices?.map((n) => n.text)).toEqual([
        expect.stringMatching(/^School Holiday Bookings: For the 2027 Easter long weekend/),
        // An untitled notice is its text alone
        expect.stringMatching(/^Please note, the 2026 Cape to Cape MTB Event/),
      ]);
    });

    it.each<[string, number, number, string[], number]>([
      ['exmouth', 3, 17, ['campsite', 'cabin', 'room'], 9],
      ['karri-valley', 7, 12, ['campsite', 'cabin', 'room'], 8],
      ['monkey-mia', 2, 16, ['campsite', 'cabin', 'room', 'dorm'], 8],
    ])(
      'gives the native park %s its categories from one availability POST for a near stay (blog %d, %d units)',
      async (slug, blogId, count, kinds, hour) => {
        const { ctx, sent } = sendingContext();
        const detail = await racFactory(ctx).catalog!.getLocation(slug);
        expect(detail).toMatchObject({
          key: `rac:${slug}`,
          imageUrls: [],
          releaseInfo: releaseInfo(hour),
          infoUrl: `${RAC}/${slug}/`,
        });
        expect(detail.units).toHaveLength(count);
        expect(new Set(detail.units.map((u) => u.unitId)).size).toBe(count);
        for (const unit of detail.units) {
          expect(unit.unitId).toMatch(/^cat:\d+$/);
          expect(Object.keys(unit).sort()).toEqual(['unitId', 'unitKind', 'unitName', 'unitType']);
        }
        // Every kind the seed has is listed, and nothing else
        const listed = new Set(detail.units.map((u) => u.unitKind));
        expect(UNIT_KINDS.filter((kind) => listed.has(kind))).toEqual(kinds);
        expect(RAC_PARKS.find((park) => park.slug === slug)!.unitKinds).toEqual(kinds);
        // One POST: 1 night, 14 days after today in Perth (17 Oct), for 2 adults
        expect(sent).toHaveLength(1);
        expect(sent[0].url).toBe(`${RAC}${RAC_AVAILABILITY_PATH}`);
        expect(Object.fromEntries(new URLSearchParams(sent[0].body))).toMatchObject({
          blog_id: String(blogId),
          available_from: '31 Oct 2026',
          available_to: '1 Nov 2026',
          adults: '2',
          children: '0',
          infants: '0',
          animals: '0',
        });
      }
    );

    it("lists Exmouth's categories in RAC's order, with their kinds and types, and no prices", async () => {
      const detail = await provider.catalog.getLocation('exmouth');
      // A park on NewBook's own engine lists types too
      expect(detail.unitsAreTypes).toBe(true);
      expect(detail.units.slice(0, 6)).toEqual([
        { unitId: 'cat:25', unitName: 'Blue Reef Motel', unitType: 'Rooms', unitKind: 'room' },
        { unitId: 'cat:35', unitName: 'Blue Reef Queen', unitType: 'Rooms', unitKind: 'room' },
        { unitId: 'cat:44', unitName: 'Blue Reef Studio', unitType: 'Cabins', unitKind: 'cabin' },
        {
          unitId: 'cat:46',
          unitName: 'Ensuite Site - Natural Ground - No Pets',
          unitType: 'Sites',
          unitKind: 'campsite',
        },
        {
          unitId: 'cat:15',
          unitName: 'Ensuite Site - Slab - No Pets',
          unitType: 'Sites',
          unitKind: 'campsite',
        },
        { unitId: 'cat:27', unitName: 'One Bedroom Cabin', unitType: 'Cabins', unitKind: 'cabin' },
      ]);
      expect(JSON.stringify(detail)).not.toMatch(/price|total|available|cart|<redacted>/i);
    });

    it("a native park's detail is fetched once: a second open within 6 h sends none (the core's cache)", async () => {
      let now = NOW;
      const { ctx, sent } = sendingContext({ clock: () => now });
      const posts = () => sent.filter((request) => request.method === 'POST').length;
      const registry = new ProviderRegistry();
      registry.register(racFactory, () => ctx);
      const db = openDatabase(':memory:');
      const catalog = new LocationCatalogService({
        registry,
        locations: new LocationRepository(db),
        providerState: new ProviderStateRepository(db),
        events: { emit: () => undefined },
        logger: createMemoryLogger(),
        clock: () => now,
      });
      try {
        await catalog.sync('rac');
        // Syncing the seed sends nothing
        expect(sent).toHaveLength(0);
        const first = await catalog.get('rac:karri-valley');
        expect(first.units).toHaveLength(12);
        expect(posts()).toBe(1);
        now = new Date(NOW.getTime() + 5 * 3_600_000);
        const again = await catalog.get('rac:karri-valley');
        expect(again.units).toEqual(first.units);
        expect(sent).toHaveLength(1);
      } finally {
        catalog.stop();
        db.close();
      }
    });

    it('a native park whose answer lists no category is a ProviderParseError (the core serves the summary, stale)', async () => {
      const { ctx } = recordingContext('{"success":"true","data":[]}');
      await expect(racFactory(ctx).catalog!.getLocation('monkey-mia')).rejects.toBeInstanceOf(
        ProviderParseError
      );
    });

    it('says Cable Beach opens its dry-season dates on set days, not on school-holiday days', async () => {
      const { ctx } = recordingContext(page('book-now-busselton.html'));
      const detail = await racFactory(ctx).catalog!.getLocation('cable-beach');
      expect(detail.releaseInfo).toBe(
        'New dates open daily at midnight AWST, 364 days ahead. Dry-season dates, 15 May to ' +
          '15 October, open on set days: choose a time you set.'
      );
    });

    it("gives Esperance and Margaret River their 7 am release hour, from the release policy's describe()", async () => {
      const { ctx } = recordingContext(page('book-now-margaret-river.html'));
      const provider = racFactory(ctx);
      expect((await provider.catalog!.getLocation('margaret-river')).releaseInfo).toBe(
        releaseInfo(7)
      );
      expect(await provider.release!.describe('margaret-river')).toBe(releaseInfo(7));
    });

    it.each<[string, string, string[]]>([
      ['accessible, not listed', 'data-accessible="true"', ['Power', 'Wheelchair accessible']],
      ['accessible, already listed', 'data-accessible="true"', ['Power', 'Wheelchair-Accessible']],
      ['not accessible', 'data-accessible="false"', ['Power']],
    ])(
      'adds "Wheelchair accessible" to a category that is (%s) once',
      async (_, attribute, amenities) => {
        const listed = amenities.includes('Wheelchair-Accessible');
        const html =
          `<div class="accommodation-item" data-cat-id="11" data-cat-type-id="5" ${attribute} ` +
          'data-title="Accessible Cabin" data-max-animals="0"><h2 class="accommodation-item__title">' +
          'Accessible Cabin</h2><ul><li class="accommodation-item__features__item">Power</li>' +
          (listed
            ? '<li class="accommodation-item__features__item">Wheelchair-Accessible</li>'
            : '') +
          '</ul></div>';
        const { ctx } = recordingContext(html);
        const detail = await racFactory(ctx).catalog!.getLocation('busselton');
        expect(detail.units[0].amenities).toEqual(amenities);
      }
    );

    it("asks only the park's book-now page on RAC, for HTML", async () => {
      const { http, ctx } = recordingContext(page('book-now-busselton.html'));
      await racFactory(ctx).catalog!.getLocation('busselton');
      expect(http.requests.map((r) => [r.method, r.url, r.headers])).toEqual([
        ['GET', `${RAC}/busselton/book-now/`, { accept: 'text/html' }],
      ]);
    });

    it('rejects a page with no category (a redesign) with a ProviderParseError', async () => {
      const { ctx } = recordingContext('<html><body><h1>Book now</h1></body></html>');
      await expect(racFactory(ctx).catalog!.getLocation('busselton')).rejects.toBeInstanceOf(
        ProviderParseError
      );
    });

    it('rejects Ningaloo, or any park the seed lacks, with a ProviderError, sending nothing', async () => {
      const { http, ctx } = recordingContext();
      for (const id of ['ningaloo', 'rose-gardens', '6']) {
        await expect(racFactory(ctx).catalog!.getLocation(id)).rejects.toBeInstanceOf(
          ProviderError
        );
      }
      expect(http.requests).toHaveLength(0);
    });

    it('logs a category whose kind is unknown once, as other', async () => {
      const logger = createMemoryLogger();
      const html =
        '<div class="accommodation-item" data-cat-id="8" data-cat-type-id="9" ' +
        'data-title="The Pavilion"></div>';
      const { ctx } = recordingContext(html);
      const catalog = racFactory({ ...ctx, logger }).catalog!;
      const first = await catalog.getLocation('busselton');
      await catalog.getLocation('busselton');
      expect(first.units[0].unitKind).toBe('other');
      expect(logger.lines.filter((line) => line.level === 'warn')).toHaveLength(1);
    });
  });
});

describe('RAC terms rules', () => {
  afterEach(() => jest.useRealTimers());

  it('rules 2 and 4: a context from createProviderContext sends one request at a time, 10 s apart', async () => {
    jest.useFakeTimers({ now: NOW });
    const inner = new RecordingHttpClient({
      providerId: 'rac',
      delayMs: 4_000,
      respond: (hop) =>
        hop.url.includes('margaret-river')
          ? { body: page('book-now-margaret-river.html') }
          : { body: page('book-now-busselton.html') },
    });
    const ctx = createProviderContext(racManifest, {
      createHttp: () => inner,
      createState: () => new InMemoryKeyValueStore(),
      vault: new FakeSecretVault(),
      logger: createMemoryLogger(),
      providersDir: TEST_PROVIDERS_DIR,
    });
    expect(ctx.limits).toMatchObject({ maxConcurrentRequests: 1, minRequestIntervalMs: 10_000 });
    const catalog = racFactory(ctx).catalog!;
    const both = Promise.all([
      catalog.getLocation('busselton'),
      catalog.getLocation('margaret-river'),
    ]);
    await jest.advanceTimersByTimeAsync(60_000);
    await both;
    expect(inner.requests).toHaveLength(2);
    expect(inner.peakInFlight).toBe(1);
    expect(inner.requests[1].sentAt - inner.requests[0].endedAt!).toBeGreaterThanOrEqual(10_000);
  });

  it('rule 3: watches every 15 minutes at most', () => {
    expect(racManifest.limits?.minWatchIntervalMinutes).toBe(15);
  });

  describe('rule 5: the synthetic block pages stop every request for 30 minutes', () => {
    function fixtureClient(clock: () => Date) {
      const state = new InMemoryKeyValueStore();
      const logger = createMemoryLogger();
      const client = new RacClient({
        providerId: 'rac',
        providerName: racManifest.name,
        http: new FixtureHttpClient({
          providerId: 'rac',
          fixturesDir: FIXTURES_DIR,
          logFile: UNEXPECTED_LOG,
        }),
        state,
        logger,
        clock,
        timezone: 'Australia/Perth',
        maxConcurrent: 1,
      });
      return { client, state, logger };
    }

    it.each([
      ['/blocked/403/', 403],
      ['/blocked/429/', 429],
      ['/blocked/challenge-503/', 403],
      ['/blocked/challenge-200/', 403],
    ])('%s: a typed error with status %d, then nothing for 30 minutes', async (blocked, status) => {
      let now = NOW;
      const { client, state } = fixtureClient(() => now);
      const error = await client.getPage(blocked).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderHttpError);
      expect((error as ProviderHttpError).status).toBe(status);
      expect((error as ProviderHttpError).retryable).toBe(false);
      expect((error as ProviderHttpError).message).toMatch(/won't ask again until 10:30 am\.$/);
      expect(await state.get(RAC_BLOCK_STATE_KEY)).toBeDefined();

      // The Busselton page has a route, but it is not asked within the 30 minutes
      now = new Date(NOW.getTime() + 29 * 60_000);
      await expect(client.getPage('/busselton/book-now/')).rejects.toMatchObject({ status });
      now = new Date(NOW.getTime() + 30 * 60_000);
      await expect(client.getPage('/busselton/book-now/')).resolves.toMatchObject({
        status: 200,
      });
    });
  });
});

describe('RAC bulk availability', () => {
  const SECOND = 1_000;
  /** The park each availability POST is for, by its form's `blog_id`. */
  const parkOf = (body: string | undefined) => {
    const blogId = new URLSearchParams(body).get('blog_id');
    return RAC_PARKS.find((park) => String(park.blogId) === blogId);
  };
  /** Each park's recorded answer for 6–8 Nov 2026. */
  const ANSWER_FILES: Readonly<Record<string, string>> = Object.fromEntries(
    RAC_PARKS.map((park) => [park.slug, `availability-${park.slug}-2026-11-06-2n.json`])
  );
  /** Answers a POST with its park's answer, and a book-now GET with Busselton's page. */
  const byPark = (hop: HopRequest): HopAnswer => {
    if (hop.method === 'GET') return { body: page('book-now-busselton.html') };
    const park = parkOf(hop.body);
    return park ? { body: page(ANSWER_FILES[park.slug]) } : { status: 404, body: '' };
  };
  /** The provider on an unpaced recording client, with a log to read. */
  function recordingBulk(
    respond: (hop: HopRequest) => HopAnswer = byPark,
    delayMs = 0,
    clock: Date = NOW
  ) {
    const http = new RecordingHttpClient({ providerId: 'rac', respond, delayMs });
    const logger = createMemoryLogger();
    const provider = racFactory(
      createTestProviderContext(racManifest, { http, logger, clock: () => clock })
    );
    const search = (stay: StayQuery, signal?: AbortSignal) =>
      provider.availability!.search!(stay, signal);
    const posts = () => http.requests.filter((request) => request.method === 'POST');
    return { http, logger, provider, search, posts };
  }
  const slugsOf = (requests: Array<{ body?: string }>) =>
    requests.map((request) => parkOf(request.body)?.slug);
  const SEED = RAC_PARKS.map((park) => park.slug);

  afterEach(() => jest.useRealTimers());

  describe('counts', () => {
    it('counts every park for 6–8 Nov 2026 from the recorded answers, in the seed order, with no total', async () => {
      const entries = await racFactory(fixtureContext()).availability!.search!(STAY);
      const none = { availableUnits: 0, bookableUnits: 0 };
      const free = (availableUnits: number) => ({ availableUnits });
      expect(entries).toStrictEqual<BulkAvailabilityEntry[]>([
        {
          key: 'rac:busselton',
          availableUnits: 51,
          byKind: { campsite: free(51), cabin: none },
        },
        {
          key: 'rac:cable-beach',
          availableUnits: 35,
          byKind: { campsite: free(31), cabin: free(4) },
        },
        {
          // Its villas are booked out: none free, but bookable
          key: 'rac:cervantes',
          availableUnits: 57,
          byKind: { campsite: free(57), cabin: free(0) },
        },
        {
          // A studio free the first night only adds nothing
          key: 'rac:esperance',
          availableUnits: 75,
          byKind: { campsite: free(69), cabin: free(6) },
        },
        {
          key: 'rac:margaret-river',
          availableUnits: 2,
          byKind: { campsite: free(0), cabin: free(0), dorm: free(1), glamping: free(1) },
        },
        {
          key: 'rac:exmouth',
          availableUnits: 110,
          byKind: { campsite: free(110), cabin: free(0), room: free(0) },
        },
        {
          key: 'rac:karri-valley',
          availableUnits: 5,
          byKind: { campsite: free(5), cabin: free(0), room: free(0) },
        },
        {
          key: 'rac:monkey-mia',
          availableUnits: 75,
          byKind: { campsite: free(57), cabin: free(0), room: free(14), dorm: free(4) },
        },
      ]);
    });

    it('Busselton 6–8 Nov 2026: the powered site adds its whole-stay 51, the sold-out ensuite site nothing, and there is no total', async () => {
      const { search } = recordingBulk((hop) =>
        parkOf(hop.body)?.slug === 'busselton' ? byPark(hop) : { status: 503, body: '' }
      );
      const [entry] = await search(STAY);
      expect(entry).toStrictEqual({
        key: 'rac:busselton',
        availableUnits: 51,
        byKind: {
          campsite: { availableUnits: 51 },
          cabin: { availableUnits: 0, bookableUnits: 0 },
        },
      });
      // 53 and 55 free on the nights, 51 for the whole stay: the stay's count
      const raw = JSON.parse(page(ANSWER_FILES.busselton)) as {
        data: Record<string, { stay_through_sites_available: number; sites_available: object }>;
      };
      expect(raw.data['4'].sites_available).toEqual({ '2026-11-06': 53, '2026-11-07': 55 });
      expect(raw.data['4'].stay_through_sites_available).toBe(51);
      expect(entry).not.toHaveProperty('bookableUnits');
    });

    /** One park's answer, `body`, for `stay` (the other parks fail). */
    async function entryFor(slug: string, body: string, stay: StayQuery, clock: Date = NOW) {
      const { search } = recordingBulk(
        (hop) => (parkOf(hop.body)?.slug === slug ? { body } : { status: 503, body: '' }),
        0,
        clock
      );
      const entries = await search(stay);
      expect(entries).toHaveLength(1);
      return entries[0];
    }

    it("Exmouth's closed category (stay-through code 2, stop sold) adds nothing and makes nothing bookable", async () => {
      const entry = await entryFor(
        'exmouth',
        page('availability-exmouth-closed-2027-10-13-7n.json'),
        {
          arrival: '2027-10-13',
          departure: '2027-10-20',
          adults: 2,
        }
      );
      const none = { availableUnits: 0, bookableUnits: 0 };
      expect(entry).toStrictEqual({
        key: 'rac:exmouth',
        ...none,
        byKind: { campsite: none, cabin: none, room: none },
      });
    });

    it('a category closed for the stay (stop sold) adds nothing and makes nothing bookable, beside a free one', async () => {
      // Exmouth's family cabin (stay-through code 2, every tariff stop sold) and its powered sites
      const json = JSON.parse(page(ANSWER_FILES.exmouth)) as { data: Record<string, unknown> };
      json.data = { '4': json.data['4'], '43': json.data['43'] };
      const entry = await entryFor('exmouth', JSON.stringify(json), STAY);
      expect(entry).toStrictEqual({
        key: 'rac:exmouth',
        availableUnits: 110,
        byKind: {
          campsite: { availableUnits: 110 },
          cabin: { availableUnits: 0, bookableUnits: 0 },
          room: { availableUnits: 0, bookableUnits: 0 },
        },
      });
    });

    it('a stay beyond the 364-day window (code 9, a special date) counts 0 of 0: "Not open"', async () => {
      const leavers = await entryFor(
        'busselton',
        page('availability-busselton-leavers-2027-11-20-1n.json'),
        { arrival: '2027-11-20', departure: '2027-11-21', adults: 2 }
      );
      expect(leavers).toMatchObject({ availableUnits: 0, bookableUnits: 0 });
      // Partly inside the window: the nights inside it can be booked, but none is free all stay
      const edge = await entryFor(
        'busselton',
        page('availability-busselton-window-edge-2027-10-13-6n.json'),
        { arrival: '2027-10-13', departure: '2027-10-19', adults: 2 }
      );
      expect(edge.availableUnits).toBe(0);
      expect(edge).not.toHaveProperty('bookableUnits');
    });

    it('a minimum stay on every tariff (code 6) is not free but bookable: "None free", never "Not open"', async () => {
      const entry = await entryFor(
        'busselton',
        page('availability-busselton-school-holidays-2027-09-25-2n.json'),
        { arrival: '2027-09-25', departure: '2027-09-27', adults: 2 }
      );
      expect(entry.availableUnits).toBe(0);
      expect(entry).not.toHaveProperty('bookableUnits');
      expect(entry.byKind?.campsite).toStrictEqual({ availableUnits: 0 });
    });

    it('too many guests on every tariff (code 3): check reads the nights closed, so bulk reads "Not open" too', async () => {
      const json = JSON.parse(page(ANSWER_FILES.busselton)) as {
        data: Record<string, { tariffs_available: Array<Record<string, unknown>> }>;
      };
      delete json.data['7'];
      for (const tariff of json.data['4'].tariffs_available) {
        Object.assign(tariff, {
          tariff_success: 'false',
          tariff_code: 3,
          tariff_message: 'Maximum occupants exceeded',
        });
      }
      const body = JSON.stringify(json);
      const { provider } = recordingBulk(() => ({ body }));
      const check = await provider.availability!.check('busselton', STAY);
      expect(check.units[0].nights.map((night) => night.state)).toEqual(['closed', 'closed']);
      // Explore agrees with the place page: nothing open
      const entry = await entryFor('busselton', body, STAY);
      const none = { availableUnits: 0, bookableUnits: 0 };
      expect(entry).toStrictEqual({
        key: 'rac:busselton',
        ...none,
        byKind: { campsite: none, cabin: none },
      });
    });

    it('a night missing from the answer is not free, but the category stays bookable', async () => {
      // A one-night answer for a two-night stay: 7 Nov is unknown
      const entry = await entryFor(
        'monkey-mia',
        page('availability-monkey-mia-2026-10-31-1n.json'),
        {
          arrival: '2026-10-31',
          departure: '2026-11-02',
          adults: 2,
        }
      );
      expect(entry.availableUnits).toBe(0);
      expect(entry).not.toHaveProperty('bookableUnits');
    });

    /** Every recorded answer, with its park and its stay (from its nights). */
    const ANSWERS = fs
      .readdirSync(RAC_FIXTURES)
      .filter((file) => /^availability-.+\.json$/.test(file))
      .map((file) => {
        const json = JSON.parse(page(file)) as { data: object };
        const categories = Object.values(json.data) as Array<{
          category_id: number;
          sites_code: Record<string, number>;
          stay_through_sites_available: number;
        }>;
        const nights = [...new Set(categories.flatMap((c) => Object.keys(c.sites_code)))].sort();
        const park = RAC_PARKS.find((p) => file.startsWith(`availability-${p.slug}-`))!;
        const stay: StayQuery = {
          arrival: nights[0],
          departure: addDays(nights[nights.length - 1], 1),
          adults: 2,
        };
        return { file, park, stay, categories };
      });

    it('has a recorded answer for every park', () => {
      expect(new Set(ANSWERS.map((answer) => answer.park.slug))).toEqual(new Set(SEED));
      expect(ANSWERS.length).toBeGreaterThanOrEqual(16);
    });

    /** Busselton's answer moved to two nights from `arrival`, its powered site taken or free. */
    function moved(arrival: string, poweredFree: boolean): string {
      const [first, second, departure] = [arrival, addDays(arrival, 1), addDays(arrival, 2)];
      const json = JSON.parse(
        page(ANSWER_FILES.busselton)
          .replaceAll('2026-11-06', first)
          .replaceAll('2026-11-07', second)
          .replaceAll('2026-11-08', departure)
      ) as { data: Record<string, Record<string, unknown>> };
      if (!poweredFree) {
        Object.assign(json.data['4'], {
          sites_available: { [first]: 0, [second]: 0 },
          sites_code: { [first]: 3, [second]: 3 },
          stay_through_sites_available: 0,
          stay_through_sites_code: 3,
        });
      }
      return JSON.stringify(json);
    }

    /** 20 Jan 2027: 20–21 Dec 2027 are in the 364-day window, held back until 5 Feb 2027. */
    const BEFORE_HOLIDAY_RELEASE = new Date('2027-01-20T02:00:00.000Z');
    const HELD_BACK: Array<{
      name: string;
      park: RacPark;
      stay: StayQuery;
      body: string;
      clock: Date;
    }> = [
      {
        name: 'Busselton, 20–21 Dec 2027 before its release, all taken',
        park: racPark('busselton')!,
        stay: { arrival: '2027-12-20', departure: '2027-12-22', adults: 2 },
        body: moved('2027-12-20', false),
        clock: BEFORE_HOLIDAY_RELEASE,
      },
      {
        name: 'Busselton, 20–21 Dec 2027 before its release, the powered site free',
        park: racPark('busselton')!,
        stay: { arrival: '2027-12-20', departure: '2027-12-22', adults: 2 },
        body: moved('2027-12-20', true),
        clock: BEFORE_HOLIDAY_RELEASE,
      },
      {
        name: 'Cable Beach, 1–2 Aug 2027 (dry season), all taken',
        park: racPark('cable-beach')!,
        stay: { arrival: '2027-08-01', departure: '2027-08-03', adults: 2 },
        body: moved('2027-08-01', false),
        clock: NOW,
      },
    ];

    it('reads a stay whose nights a holiday release holds back as "Not open", as check does', async () => {
      const [taken] = HELD_BACK;
      const entry = await entryFor(taken.park.slug, taken.body, taken.stay, taken.clock);
      const none = { availableUnits: 0, bookableUnits: 0 };
      expect(entry).toStrictEqual({
        key: 'rac:busselton',
        ...none,
        byKind: { campsite: none, cabin: none },
      });
      const { provider } = recordingBulk(() => ({ body: taken.body }), 0, taken.clock);
      const check = await provider.availability!.check('busselton', taken.stay);
      expect(check.units.flatMap((unit) => unit.nights.map((night) => night.state))).toEqual(
        Array(4).fill('not-released')
      );
    });

    it.each(
      [
        ...ANSWERS.map(({ file, park, stay }) => ({
          name: file,
          park,
          stay,
          body: page(file),
          clock: NOW,
        })),
        ...HELD_BACK,
      ].map((answer) => [answer.name, answer] as const)
    )('bulk agrees with check: %s', async (_, { park, stay, body, clock }) => {
      const categories = Object.values((JSON.parse(body) as { data: object }).data) as Array<{
        category_id: number;
        stay_through_sites_available: number;
      }>;
      const entry = await entryFor(park.slug, body, stay, clock);
      const { provider } = recordingBulk(() => ({ body }), 0, clock);
      const { units } = await provider.availability!.check(park.slug, stay);
      const whole = new Map(
        categories.map((c) => [`cat:${c.category_id}`, c.stay_through_sites_available])
      );
      // The units `check` marks free for the whole stay, by their whole-stay count
      const free = (list: UnitAvailability[]) =>
        list.filter((u) => u.fullyAvailable).reduce((sum, u) => sum + whole.get(u.unitId)!, 0);
      // A category can be booked when one of its nights is neither closed nor not released
      const counts = (list: UnitAvailability[]) =>
        list.some((u) => u.nights.some((n) => n.state !== 'closed' && n.state !== 'not-released'))
          ? { availableUnits: free(list) }
          : { availableUnits: free(list), bookableUnits: 0 };

      expect(entry).toStrictEqual({
        key: `rac:${park.slug}`,
        ...counts(units),
        byKind: expect.any(Object),
      });
      const kinds = UNIT_KINDS.filter(
        (kind) => park.unitKinds.includes(kind) || units.some((u) => u.unitKind === kind)
      );
      expect(Object.keys(entry.byKind!)).toEqual(kinds);
      for (const kind of kinds) {
        expect([kind, entry.byKind![kind]]).toStrictEqual([
          kind,
          counts(units.filter((u) => u.unitKind === (kind as UnitKind))),
        ]);
      }
    });
  });

  describe('failures', () => {
    it('one park that fails (a 503) gets no entry: seven entries, and one warning naming the park and the status', async () => {
      const { search, logger, posts } = recordingBulk((hop) =>
        parkOf(hop.body)?.slug === 'cervantes' ? { status: 503, body: 'down' } : byPark(hop)
      );
      const entries = await search(STAY);
      expect(entries.map((entry) => entry.key)).toEqual(
        SEED.filter((slug) => slug !== 'cervantes').map((slug) => `rac:${slug}`)
      );
      expect(slugsOf(posts())).toEqual(SEED);
      const warnings = logger.lines.filter((line) => line.level === 'warn');
      expect(warnings.map((line) => line.message)).toEqual([
        'Bulk availability: no answer for cervantes (HTTP 503); it reads as unknown',
      ]);
    });

    it.each<[string, HopAnswer, string]>([
      ['a 520', { status: 520, body: '' }, 'HTTP 520'],
      [
        "RAC's guard text",
        { body: page('availability-no-direct-file-access.txt') },
        'an answer it could not read',
      ],
      [
        'success "false"',
        { body: '{"success":"false","message":"<b>Error</b>","data":[]}' },
        'an answer it could not read',
      ],
      [
        'no response',
        { fail: new ProviderHttpError({ providerId: 'rac', status: 0, url: `${RAC}/x` }) },
        'no response',
      ],
    ])(
      'a park whose request fails with %s reads as unknown, and the next is asked',
      async (_, answer, why) => {
        const { search, logger, posts } = recordingBulk((hop) =>
          parkOf(hop.body)?.slug === 'esperance' ? answer : byPark(hop)
        );
        const entries = await search(STAY);
        expect(entries).toHaveLength(7);
        expect(entries.find((entry) => entry.key === 'rac:esperance')).toBeUndefined();
        expect(posts()).toHaveLength(8);
        expect(logger.lines.filter((line) => line.level === 'warn').map((l) => l.message)).toEqual([
          `Bulk availability: no answer for esperance (${why}); it reads as unknown`,
        ]);
      }
    );

    it('a 503 for every park rejects with the last error, after asking each once', async () => {
      const { search, posts } = recordingBulk(() => ({ status: 503, body: '' }));
      const error = await search(STAY).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderHttpError);
      expect(error).toMatchObject({ status: 503, retryable: true });
      expect(slugsOf(posts())).toEqual(SEED);
    });

    it('block stops the search: a 403 on the third park rejects with the typed error after exactly three POSTs, and a second search within the cool-down sends nothing', async () => {
      const { search, posts, provider } = recordingBulk((hop) =>
        parkOf(hop.body)?.slug === 'cervantes'
          ? { status: 403, body: page('blocked-403.html') }
          : byPark(hop)
      );
      const error = await search(STAY).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderHttpError);
      expect(error).toMatchObject({ status: 403, retryable: false });
      expect((error as Error).message).toMatch(
        /turned the request away \(HTTP 403\)\. WA Stay won't ask again until/
      );
      expect(slugsOf(posts())).toEqual(['busselton', 'cable-beach', 'cervantes']);

      // Retry during the cool-down fails at once and sends nothing (terms rule 5)
      await expect(search({ ...STAY, adults: 3 })).rejects.toMatchObject({ status: 403 });
      expect(posts()).toHaveLength(3);
      // Nor does a place page's check
      await expect(provider.availability!.check('busselton', STAY)).rejects.toMatchObject({
        status: 403,
      });
      expect(posts()).toHaveLength(3);
    });

    it.each<[string, HopAnswer]>([
      ['a 429', { status: 429, body: page('blocked-429.html') }],
      ['a challenge', { body: page('challenge.html') }],
    ])('%s stops the search too', async (_, answer) => {
      const { search, posts } = recordingBulk((hop) =>
        parkOf(hop.body)?.slug === 'busselton' ? answer : byPark(hop)
      );
      await expect(search(STAY)).rejects.toBeInstanceOf(ProviderHttpError);
      expect(posts()).toHaveLength(1);
    });

    it('an abort after two POSTs sends no third one, and rejects with an AbortError', async () => {
      const controller = new AbortController();
      const { search, posts } = recordingBulk((hop) => {
        if (parkOf(hop.body)?.slug === 'cable-beach') controller.abort();
        return byPark(hop);
      });
      const error = await search(STAY, controller.signal).catch((e: unknown) => e);
      expect(isAbortError(error)).toBe(true);
      expect(slugsOf(posts())).toEqual(['busselton', 'cable-beach']);
    });

    it('an aborted signal sends nothing', async () => {
      const controller = new AbortController();
      controller.abort();
      const { search, posts } = recordingBulk();
      const error = await search(STAY, controller.signal).catch((e: unknown) => e);
      expect(isAbortError(error)).toBe(true);
      expect(posts()).toHaveLength(0);
    });

    it('refuses a stay RAC cannot take with a ProviderError, sending nothing', async () => {
      const { search, posts } = recordingBulk();
      for (const stay of [
        { ...STAY, params: { pets: 3 } },
        { ...STAY, departure: STAY.arrival },
        { ...STAY, arrival: '6 Nov 2026' },
      ]) {
        await expect(search(stay)).rejects.toBeInstanceOf(ProviderError);
      }
      expect(posts()).toHaveLength(0);
    });

    const NEXT_WEEK: StayQuery = { arrival: '2026-11-13', departure: '2026-11-15', adults: 2 };
    const stayOf = (body?: string) => new URLSearchParams(body).get('available_from');

    it('a superseded search sends nothing more and resolves with what it has; its POST already sent finishes first', async () => {
      jest.useFakeTimers({ now: NOW });
      const { search, http, posts } = recordingBulk(byPark, 5 * SECOND);
      let older: BulkAvailabilityEntry[] | undefined;
      void search(STAY).then((entries) => (older = entries));
      // Busselton answered; Cable Beach is on the wire when the dates change
      await jest.advanceTimersByTimeAsync(7 * SECOND);
      expect(posts()).toHaveLength(2);
      let newer: BulkAvailabilityEntry[] | undefined;
      void search(NEXT_WEEK).then((entries) => (newer = entries));
      await jest.advanceTimersByTimeAsync(SECOND);
      // Cable Beach is still RAC's to answer: nothing else is sent meanwhile
      expect(posts()).toHaveLength(2);
      expect(older).toBeUndefined();
      await jest.advanceTimersByTimeAsync(2 * SECOND);
      expect(older?.map((entry) => entry.key)).toEqual(['rac:busselton', 'rac:cable-beach']);
      await jest.advanceTimersByTimeAsync(60 * SECOND);
      expect(newer).toHaveLength(8);

      const [, cableBeach, firstNewer] = posts();
      // Not called off: it took its whole 5 s, and the newer search's first POST went after it
      expect(cableBeach.endedAt! - cableBeach.sentAt).toBe(5 * SECOND);
      expect(firstNewer.sentAt).toBeGreaterThanOrEqual(cableBeach.endedAt!);
      expect(posts().filter((r) => stayOf(r.body) === '6 Nov 2026')).toHaveLength(2);
      expect(slugsOf(posts().filter((r) => stayOf(r.body) === '13 Nov 2026'))).toEqual(SEED);
      expect(http.peakInFlight).toBe(1);
    });

    it('a superseded search calls off its POST still waiting for its turn: it is never sent', async () => {
      jest.useFakeTimers({ now: NOW });
      const { search, http, posts, provider } = recordingBulk(byPark, 5 * SECOND);
      // A place page's check is on the wire; the search's first POST waits behind it
      void provider.availability!.check('exmouth', STAY);
      await jest.advanceTimersByTimeAsync(SECOND);
      let older: BulkAvailabilityEntry[] | undefined;
      void search(STAY).then((entries) => (older = entries));
      await jest.advanceTimersByTimeAsync(SECOND);
      expect(http.requests).toHaveLength(1);
      let newer: BulkAvailabilityEntry[] | undefined;
      void search(NEXT_WEEK).then((entries) => (newer = entries));
      await jest.advanceTimersByTimeAsync(SECOND);
      expect(older).toEqual([]);
      await jest.advanceTimersByTimeAsync(60 * SECOND);
      expect(newer).toHaveLength(8);
      // The check, then only the newer search's POSTs: the older one's Busselton never went
      const searches = posts().slice(1);
      expect(searches.every((r) => stayOf(r.body) === '13 Nov 2026')).toBe(true);
      expect(slugsOf(searches)).toEqual(SEED);
      expect(http.peakInFlight).toBe(1);
    });
  });

  it('logs no request body, cart address or NewBook key', async () => {
    const logger = createMemoryLogger();
    const answers = new Map<string, HopAnswer>([
      ['cable-beach', { status: 503, body: page(ANSWER_FILES.busselton) }],
      ['cervantes', { body: page('availability-no-direct-file-access.txt') }],
      ['esperance', { body: '{"success":"false","message":"api_key instances_x","data":[]}' }],
    ]);
    const http = new RecordingHttpClient({
      providerId: 'rac',
      respond: (hop) => answers.get(parkOf(hop.body)?.slug ?? '') ?? byPark(hop),
    });
    const provider = racFactory(
      createTestProviderContext(racManifest, { http, logger, clock: () => NOW })
    );
    await provider.availability!.search!({ ...STAY, children: 1, params: { pets: 1 } });
    // Then a block, which logs its status only
    const blocked = new RecordingHttpClient({
      providerId: 'rac',
      respond: () => ({ status: 429, body: page('blocked-429.html') }),
    });
    await racFactory(
      createTestProviderContext(racManifest, { http: blocked, logger, clock: () => NOW })
    ).availability!.search!(STAY).catch(() => undefined);

    const logged = JSON.stringify(logger.lines);
    expect(logger.lines.length).toBeGreaterThanOrEqual(4);
    for (const leak of [
      'blog_id',
      'available_from',
      '6 Nov 2026',
      'animals',
      'api_key',
      'instances_',
      '<redacted>',
      'cart',
      'online_booking_url',
      '/booking/',
      'availability-ajax',
      'Powered Site',
    ]) {
      expect([leak, logged.includes(leak)]).toEqual([leak, false]);
    }
  });

  describe('pace and deadlines, through the core (R2, brief R8)', () => {
    let db: ReturnType<typeof openDatabase> | undefined;
    let catalog: LocationCatalogService | undefined;
    let registry: ProviderRegistry | undefined;

    afterEach(async () => {
      catalog?.stop();
      await registry?.disposeAll();
      db?.close();
      db = undefined;
      catalog = undefined;
      registry = undefined;
    });

    /** RAC through the core, paced as in the app, on a recording client whose hops take `delayMs`. */
    async function pacedRac(delayMs: number) {
      jest.useFakeTimers({ now: NOW });
      const priorities: string[] = [];
      const inner = new RecordingHttpClient({ providerId: 'rac', delayMs, respond: byPark });
      registry = new ProviderRegistry();
      registry.register(racFactory, (manifest) => {
        const ctx = pacedContext(manifest, inner);
        // The ambient priority when the RAC module asks its (paced) client to send
        const request = ctx.http.request.bind(ctx.http);
        ctx.http.request = (...args) => {
          priorities.push(currentRequestPriority());
          return request(...args);
        };
        return ctx;
      });
      db = openDatabase(':memory:');
      catalog = new LocationCatalogService({
        registry,
        locations: new LocationRepository(db),
        providerState: new ProviderStateRepository(db),
        events: { emit: () => undefined },
        logger: createMemoryLogger(),
      });
      await catalog.sync('rac');
      // The seed: nothing sent
      expect(inner.requests).toHaveLength(0);
      return { inner, catalog, priorities };
    }

    interface Tracked<T> {
      value?: T;
      error?: unknown;
      /** How long it took, once settled. */
      ms?: number;
    }

    /** Follows `promise`: what it gave, and how long it took on the fake clock. */
    function track<T>(promise: Promise<T>): Tracked<T> {
      const start = performance.now();
      const tracked: Tracked<T> = {};
      promise.then(
        (value) => Object.assign(tracked, { value, ms: performance.now() - start }),
        (error: unknown) => Object.assign(tracked, { error, ms: performance.now() - start })
      );
      return tracked;
    }

    /** Runs fake time, 100 ms at a time, until every one has settled (5 minutes at most). */
    async function settle(...all: Tracked<unknown>[]): Promise<void> {
      for (let waited = 0; waited < 5 * 60 * SECOND; waited += 100) {
        if (all.every((t) => t.ms !== undefined)) return;
        await jest.advanceTimersByTimeAsync(100);
      }
    }

    /** Runs fake time until `promise` settles; how long it took, and what it gave. */
    async function timed<T>(promise: Promise<T>): Promise<Tracked<T> & { ms: number }> {
      const tracked = track(promise);
      await settle(tracked);
      return tracked as Tracked<T> & { ms: number };
    }

    const limits = racManifest.limits!;
    const BULK_DEADLINE_MS = pacedDeadlineMs(
      DEFAULT_CATALOG_TIMINGS.availabilityTimeoutMs,
      limits,
      {
        requests: RAC_PARKS.length,
        priority: 'interactive',
      }
    );
    const CHECK_DEADLINE_MS = pacedDeadlineMs(
      DEFAULT_CATALOG_TIMINGS.availabilityTimeoutMs,
      limits,
      {
        requests: 2,
        priority: 'interactive',
      }
    );
    const DETAIL_DEADLINE_MS = pacedDeadlineMs(DEFAULT_CATALOG_TIMINGS.detailTimeoutMs, limits, {
      requests: 2,
      priority: 'interactive',
    });

    it('interactive pacing: eight POSTs, never two in flight, each 1 s after the last ended, all interactive, done within 60 s', async () => {
      const { inner, catalog, priorities } = await pacedRac(5 * SECOND);
      const { value, ms } = await timed(catalog.availability(STAY));

      expect(value?.errors).toEqual([]);
      expect(value?.entries.map((entry) => entry.key)).toEqual(SEED.map((slug) => `rac:${slug}`));
      expect(slugsOf(inner.requests)).toEqual(SEED);
      expect(inner.peakInFlight).toBe(1);
      for (let i = 1; i < inner.requests.length; i++) {
        const gap = inner.requests[i].sentAt - inner.requests[i - 1].endedAt!;
        expect(gap).toBeGreaterThanOrEqual(INTERACTIVE_REQUEST_GAP_MS);
      }
      expect(inner.requests.map((request) => request.priority)).toEqual(
        Array(8).fill('interactive')
      );
      expect(priorities).toEqual(Array(8).fill('interactive'));
      // 8 × 5 s and 7 gaps of 1 s
      expect(Math.round(ms)).toBe(47 * SECOND);
      expect(ms).toBeLessThanOrEqual(60 * SECOND);
    });

    it("the core's deadline covers eight POSTs at the slowest latency seen live (8 s)", async () => {
      const { catalog } = await pacedRac(8 * SECOND);
      const { value, ms } = await timed(catalog.availability(STAY));
      expect(value?.errors).toEqual([]);
      expect(value?.entries).toHaveLength(8);
      // 8 × 8 s and 7 gaps of 1 s, inside 20 s + 8 × 11 s
      expect(Math.round(ms)).toBe(71 * SECOND);
      expect(BULK_DEADLINE_MS).toBe(108 * SECOND);
    });

    it("a place page opened during Explore's search waits for one POST, not the search: its detail and check meet their deadlines, and so does the search", async () => {
      const { inner, catalog } = await pacedRac(8 * SECOND);
      const explored = track(catalog.availability(STAY));
      // Busselton and Cable Beach answered; Cervantes is on the wire
      await jest.advanceTimersByTimeAsync(20 * SECOND);
      expect(inner.requests).toHaveLength(3);
      const opened = track(catalog.get('rac:busselton'));
      const checked = track(catalog.checkLocation('rac:busselton', STAY));
      await settle(explored, opened, checked);

      // Cervantes ends at 26 s; the detail goes 1 s later (35 s), then the check (44 s)
      expect(opened.error).toBeUndefined();
      expect(opened.value?.units.length).toBeGreaterThan(0);
      expect(Math.round(opened.ms!)).toBe(15 * SECOND);
      expect(opened.ms).toBeLessThan(DETAIL_DEADLINE_MS);
      expect(checked.error).toBeUndefined();
      expect(checked.value?.units.length).toBeGreaterThan(0);
      expect(Math.round(checked.ms!)).toBe(24 * SECOND);
      expect(checked.ms).toBeLessThan(CHECK_DEADLINE_MS);
      // The search's own POSTs resume after them: 10 requests of 8 s and 9 gaps
      expect(explored.value?.errors).toEqual([]);
      expect(explored.value?.entries).toHaveLength(8);
      expect(Math.round(explored.ms!)).toBe(89 * SECOND);
      expect(explored.ms).toBeLessThan(BULK_DEADLINE_MS);
      expect(inner.requests.map((r) => r.method)).toEqual([
        'POST',
        'POST',
        'POST',
        'GET',
        'POST',
        'POST',
        'POST',
        'POST',
        'POST',
        'POST',
      ]);
      expect(inner.peakInFlight).toBe(1);
    });

    it('a date change during a search stops the older one, so the newer one meets its deadline', async () => {
      const { inner, catalog } = await pacedRac(8 * SECOND);
      const NEXT_WEEK: StayQuery = { arrival: '2026-11-13', departure: '2026-11-15', adults: 2 };
      const older = track(catalog.availability(STAY));
      await jest.advanceTimersByTimeAsync(20 * SECOND);
      const newer = track(catalog.availability(NEXT_WEEK));
      await settle(older, newer);

      // The older one lets Cervantes, already sent, finish, keeps the parks it had, with no
      // error, and sends nothing after it
      expect(older.value?.errors).toEqual([]);
      expect(older.value?.entries.map((entry) => entry.key)).toEqual([
        'rac:busselton',
        'rac:cable-beach',
        'rac:cervantes',
      ]);
      const olderPosts = inner.requests.filter(
        (r) => new URLSearchParams(r.body).get('available_from') === '6 Nov 2026'
      );
      expect(olderPosts).toHaveLength(3);
      expect(olderPosts[2].endedAt! - olderPosts[2].sentAt).toBe(8 * SECOND);
      // The newer one waits for Cervantes (6 s more) and its gap: 6 s + 8 × 8 s + 8 gaps
      expect(newer.value?.errors).toEqual([]);
      expect(newer.value?.entries).toHaveLength(8);
      expect(Math.round(newer.ms!)).toBe(78 * SECOND);
      expect(newer.ms).toBeLessThan(BULK_DEADLINE_MS);
      expect(inner.peakInFlight).toBe(1);
    });

    it('a date change while a POST waits for its 1 s gap calls that POST off: it is never sent', async () => {
      const { inner, catalog } = await pacedRac(8 * SECOND);
      const NEXT_WEEK: StayQuery = { arrival: '2026-11-13', departure: '2026-11-15', adults: 2 };
      const older = track(catalog.availability(STAY));
      // Busselton ended at 8 s; Cable Beach waits for its turn at 9 s
      await jest.advanceTimersByTimeAsync(8.5 * SECOND);
      expect(inner.requests).toHaveLength(1);
      const newer = track(catalog.availability(NEXT_WEEK));
      await settle(older, newer);

      expect(older.value?.entries.map((entry) => entry.key)).toEqual(['rac:busselton']);
      const stays = inner.requests.map((r) => new URLSearchParams(r.body).get('available_from'));
      expect(stays).toEqual(['6 Nov 2026', ...Array(8).fill('13 Nov 2026')]);
      // The newer one's first POST takes Cable Beach's turn, at 9 s
      expect(inner.requests[1].sentAt - inner.requests[0].endedAt!).toBe(SECOND);
      expect(newer.value?.entries).toHaveLength(8);
      expect(newer.ms).toBeLessThan(BULK_DEADLINE_MS);
      expect(inner.peakInFlight).toBe(1);
    });
  });
});
