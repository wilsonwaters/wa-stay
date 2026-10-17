/**
 * RAC Parks & Resorts (`src/main/providers/rac/`): the provider contract suite, the catalogue
 * (the seed, sent nothing), a park's detail from its trimmed book-now page in
 * `tests/fixtures/providers/rac/`, and the terms rules a request can break: RAC's host only
 * (rule 1), one request at a time 10 s apart (rules 2 and 4), the block cool-down on the
 * synthetic 403, 429 and challenge pages (rule 5). A FixtureHttpClient or a recording client
 * answers every request, so nothing is sent anywhere.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createProviderContext,
  FakeSecretVault,
  InMemoryKeyValueStore,
  ProviderError,
  ProviderHttpError,
  ProviderParseError,
  type ProviderContext,
} from '@main/providers/sdk';
import { ProviderRegistry } from '@main/providers/registry';
import { RAC_PARKS, racFactory, racManifest } from '@main/providers/rac';
import { RAC_RELEASE_INFO, RAC_ROLLING_RELEASE_INFO } from '@main/providers/rac/catalog';
import { RAC_BLOCK_STATE_KEY, RacClient } from '@main/providers/rac/client';
import { FixtureHttpClient } from '@main/testing/fixture-http-client';
import type { StayQuery } from '@shared/types/provider.types';
import { UNIT_KINDS } from '@shared/types/provider.types';
import {
  createMemoryLogger,
  createTestProviderContext,
  TEST_PROVIDERS_DIR,
} from '@tests/utils/fake-provider';
import { RecordingHttpClient } from '@tests/utils/fake-paced-provider';
import { describeProviderContract } from '@tests/utils/provider-contract';

/** Holds `rac/manifest.json`, which lists the recorded pages by request path. */
const FIXTURES_DIR = path.join(__dirname, '../fixtures/providers');
const RAC_FIXTURES = path.join(FIXTURES_DIR, 'rac');
/** Where a FixtureHttpClient logs a request that no fixture answers (it fails, unsent). */
const UNEXPECTED_LOG = path.join(os.tmpdir(), `rac-unexpected-${process.pid}.log`);
const RAC = 'https://parksandresorts.rac.com.au';
/** The day after the pages were recorded, 10 am in Perth. */
const NOW = new Date('2026-10-17T02:00:00.000Z');
const STAY: StayQuery = { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 };
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

/** A test context whose HTTP only records: every request answers `body`. */
function recordingContext(body = '<html></html>') {
  const http = new RecordingHttpClient({ providerId: 'rac', respond: () => ({ body }) });
  return { http, ctx: createTestProviderContext(racManifest, { http, clock: () => NOW }) };
}

const page = (name: string) => fs.readFileSync(path.join(RAC_FIXTURES, name), 'utf8');

afterAll(() => fs.rmSync(UNEXPECTED_LOG, { force: true }));

describeProviderContract('rac', () => ({
  provider: racFactory(fixtureContext()),
  sample: { externalId: 'busselton', stay: STAY },
  unknownExternalId: 'ningaloo',
}));

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
      expect(detail.releaseInfo).toBe(RAC_RELEASE_INFO);
      expect(detail.fetchedAt).toBe(NOW.toISOString());
    });

    it('gives Margaret River its dorms and its safari tent', async () => {
      const detail = await provider.catalog.getLocation('margaret-river');
      expect(detail.units.map((u) => [u.unitName, u.unitKind, u.unitType])).toEqual([
        ['4 Bedroom Eco Lodge', 'cabin', 'Cabins'],
        ['Modern Safari Tent', 'glamping', 'Cabins'],
        ['Dorm Room - Sleeps 26', 'dorm', 'Dorm'],
        ['Dorm Room - Sleeps 5', 'dorm', 'Dorm'],
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

    it.each(['exmouth', 'karri-valley', 'monkey-mia'])(
      'gives the native park %s its seed facts and no units, and sends nothing',
      async (slug) => {
        const { http, ctx } = recordingContext();
        const detail = await racFactory(ctx).catalog!.getLocation(slug);
        expect(detail).toMatchObject({
          key: `rac:${slug}`,
          units: [],
          imageUrls: [],
          releaseInfo: RAC_RELEASE_INFO,
          infoUrl: `${RAC}/${slug}/`,
        });
        expect(http.requests).toHaveLength(0);
      }
    );

    it('says Cable Beach opens month by month, not on school-holiday days', async () => {
      const { ctx } = recordingContext(page('book-now-busselton.html'));
      const detail = await racFactory(ctx).catalog!.getLocation('cable-beach');
      expect(detail.releaseInfo).toBe(RAC_ROLLING_RELEASE_INFO);
    });

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
