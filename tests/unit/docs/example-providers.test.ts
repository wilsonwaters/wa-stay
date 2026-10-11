/**
 * @jest-environment node
 *
 * The worked examples of docs/providers/adding-a-provider.md
 * (`tests/fixtures/providers/example-{api,browser}`) are real providers: they compile under the
 * main process's tsconfig, register in a fresh `ProviderRegistry`, pass the provider contract
 * suite, list normalised `LocationSummary`s and answer availability as `NightStatus`es with
 * `YYYY-MM-DD` dates. The API example answers from the recorded responses its `manifest.json`
 * lists (a FixtureHttpClient: nothing is sent), and from loopback servers where a test needs
 * answers of its own; its holds and its sign-in are tested here too. The browser example runs
 * on the fake browser (`tests/utils/fake-browser.ts`) over the example site, whose search form
 * script runs.
 *
 * The regions marked `// #region docs:<name>` are code blocks of the guide
 * (`tests/unit/docs/docs-sync.test.ts`).
 */

import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import ts from 'typescript';
import {
  createLimiter,
  isAbortError,
  NodeHttpClient,
  ProviderHttpError,
  ProviderParseError,
  type HoldsModule,
  type PaymentPage,
} from '@main/providers/sdk';
import { ProviderRegistry, type ProviderWith } from '@main/providers/registry';
import { FixtureHttpClient } from '@main/testing/fixture-http-client';
import {
  isCalendarDate,
  type ProviderManifest,
  type StayQuery,
} from '@shared/types/provider.types';
import { createFakeBrowser } from '@tests/utils/fake-browser';
import { createTestProviderContext } from '@tests/utils/fake-provider';
import { describeProviderContract } from '@tests/utils/provider-contract';
import {
  createExampleApiFactory,
  exampleApiFactory,
  exampleApiManifest,
} from '@tests/fixtures/providers/example-api';
import { createExampleAuth } from '@tests/fixtures/providers/example-api/auth';
import { createExampleHolds } from '@tests/fixtures/providers/example-api/holds';
import {
  createExampleBrowserFactory,
  exampleBrowserFactory,
  exampleBrowserManifest,
} from '@tests/fixtures/providers/example-browser';
import { renderExampleSite } from '@tests/fixtures/providers/example-browser/site';

const ROOT = path.resolve(__dirname, '../../..');
const API_FIXTURES = path.join(ROOT, 'tests/fixtures/providers/example-api/fixtures');
const STAY: StayQuery = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };
const SITE = 'https://www.example-parks.test';
/** Where a FixtureHttpClient logs a request no route answers (it fails, and is never sent). */
const UNEXPECTED_LOG = path.join(os.tmpdir(), `example-api-unexpected-${process.pid}.log`);

afterAll(() => fs.rmSync(UNEXPECTED_LOG, { force: true }));

// #region docs:test-fixtures
/**
 * A test context (in-memory state, a fake vault, a fixed clock) whose HTTP answers from the
 * recorded responses `tests/fixtures/providers/<id>/manifest.json` lists, by method and path.
 * The host is not compared, and a request no route answers fails without being sent.
 */
function fixtureContext(manifest: ProviderManifest) {
  return createTestProviderContext(manifest, {
    http: new FixtureHttpClient({
      providerId: manifest.id,
      fixturesDir: path.join(ROOT, 'tests/fixtures/providers'),
      logFile: UNEXPECTED_LOG,
    }),
  });
}
// #endregion

/** A loopback HTTP server running `handler`. */
async function serve(handler: http.RequestListener): Promise<{
  baseUrl: string;
  close(): Promise<void>;
}> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** A payment window page, as `bookedReference` sees it. */
function paymentPage(url: string, text: string): PaymentPage {
  return { url, hasText: async (wanted) => text.includes(wanted) };
}

// ---------------------------------------------------------------------------------------
// Compiles
// ---------------------------------------------------------------------------------------

describe('the guide examples compile under the main tsconfig', () => {
  it('has no type errors in either example provider, its holds or its sign-in', () => {
    const tsconfig = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
    const { options } = ts.parseJsonConfigFileContent(tsconfig.config, ts.sys, ROOT);
    const files = [
      'example-api/index.ts',
      'example-api/holds.ts',
      'example-api/auth.ts',
      'example-browser/index.ts',
    ].map((file) => path.join(ROOT, 'tests/fixtures/providers', file));
    const program = ts.createProgram(files, { ...options, noEmit: true, types: ['node'] });
    const errors = ts
      .getPreEmitDiagnostics(program)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------
// The API example
// ---------------------------------------------------------------------------------------

describe('example API provider', () => {
  let provider: ProviderWith<'bulkAvailability'>;

  beforeAll(() => {
    // #region docs:test-api
    // A fresh registry, as the app has, and the provider on recorded responses: any https
    // host does, because a FixtureHttpClient answers by path and never sends a request.
    const registry = new ProviderRegistry();
    const factory = createExampleApiFactory({ baseUrl: 'https://api.example-parks.test' });
    registry.register(factory, fixtureContext);
    provider = registry.require('example-api', 'bulkAvailability');
    // #endregion
  });

  it('registers under its id with its manifest, and is the factory the guide registers', () => {
    const registry = new ProviderRegistry();
    registry.register(exampleApiFactory, (manifest) => createTestProviderContext(manifest));
    expect(registry.list().map((m) => m.id)).toEqual(['example-api']);
    expect(registry.get('example-api').manifest).toEqual(exampleApiManifest);
    expect(registry.withCapability('watches').map((p) => p.manifest.id)).toEqual(['example-api']);
    expect(registry.withCapability('holds').map((p) => p.manifest.id)).toEqual(['example-api']);
  });

  it('lists normalised LocationSummary[]: keys, kinds, https-only photos, area', async () => {
    const locations = await provider.catalog!.listLocations!();
    expect(locations).toEqual([
      expect.objectContaining({
        key: 'example-api:101',
        providerId: 'example-api',
        externalId: '101',
        name: 'Granite Bay Campground',
        kind: 'campground',
        bookingMode: 'online',
        lat: -34.3321,
        lng: 115.1593,
        area: { name: 'Augusta', region: 'South West' },
        imageUrls: ['https://images.example-parks.test/101/main.jpg'],
        amenities: ['Toilets', 'Fire pits'],
        unitCount: 3,
        infoUrl: 'https://www.example-parks.test/parks/101',
      }),
      // An http photo is dropped: images must be https.
      expect.objectContaining({ key: 'example-api:102', kind: 'cabin', imageUrls: [] }),
      // A kind the provider does not map is `other`.
      expect.objectContaining({ key: 'example-api:103', kind: 'other' }),
    ]);
  });

  it('builds a detail with units and the raw description for main to sanitise', async () => {
    const detail = await provider.catalog!.getLocation('101');
    expect(detail).toMatchObject({
      key: 'example-api:101',
      descriptionHtml: '<p>Sheltered sites behind the dunes.</p>',
      units: [
        { unitId: 's1', unitName: 'Site 1', unitType: 'Powered', maxPeople: 6 },
        { unitId: 's2', unitName: 'Site 2', unitType: 'Unpowered', maxPeople: 4 },
        { unitId: 's3', unitName: 'Site 3', unitType: 'Unpowered', maxPeople: 4 },
      ],
    });
  });

  it('answers availability as NightStatus with YYYY-MM-DD dates, only the stay nights', async () => {
    // The fixture route answers only this query: the provider sent the stay and its site type.
    const result = await provider.availability.check('101', {
      ...STAY,
      params: { siteType: 'powered' },
    });
    expect(result.key).toBe('example-api:101');
    expect(result.bookingUrl).toBe(
      'https://www.example-parks.test/book/101?from=2026-11-10&to=2026-11-12'
    );
    expect(result.units).toEqual([
      {
        unitId: 's1',
        unitName: 'Site 1',
        nights: [
          { date: '2026-11-10', state: 'available', price: 40 },
          { date: '2026-11-11', state: 'available', price: 45 },
        ],
        fullyAvailable: true,
        total: 85,
      },
      {
        unitId: 's2',
        unitName: 'Site 2',
        nights: [
          { date: '2026-11-10', state: 'available', price: 30 },
          { date: '2026-11-11', state: 'booked' },
        ],
        fullyAvailable: false,
        total: undefined,
      },
      {
        // An unknown word is `unknown`, and a missing night too: never `available`.
        unitId: 's3',
        unitName: 'Site 3',
        nights: [
          { date: '2026-11-10', state: 'unknown' },
          { date: '2026-11-11', state: 'unknown' },
        ],
        fullyAvailable: false,
        total: undefined,
      },
    ]);
    for (const night of result.units.flatMap((u) => u.nights)) {
      expect(isCalendarDate(night.date)).toBe(true);
    }
  });

  it("falls back to a stay field's default when the stay has none, and keeps the units asked for", async () => {
    // No params, as the place page sends: siteType=any (the fixture route answers only that).
    const result = await provider.availability.check('101', STAY, { unitIds: ['s2'] });
    expect(result.units.map((u) => u.unitId)).toEqual(['s2']);
  });

  it('answers bulk availability under location keys', async () => {
    await expect(provider.availability.search(STAY)).resolves.toEqual([
      { key: 'example-api:101', availableUnits: 1, bookableUnits: 3 },
      { key: 'example-api:102', availableUnits: 0, bookableUnits: 2 },
    ]);
  });

  it('turns a 404 into a ProviderHttpError and a wrong shape into a ProviderParseError', async () => {
    await expect(provider.catalog!.getLocation('999')).rejects.toBeInstanceOf(ProviderHttpError);
    // A server that answers every path with JSON of the wrong shape.
    const wrong = await serve((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"parks":[{"id":"not a number"}]}');
    });
    try {
      const registry = new ProviderRegistry();
      registry.register(createExampleApiFactory({ baseUrl: wrong.baseUrl }), (manifest) =>
        createTestProviderContext(manifest)
      );
      await expect(registry.get('example-api').catalog!.listLocations!()).rejects.toBeInstanceOf(
        ProviderParseError
      );
    } finally {
      await wrong.close();
    }
  });

  it('keeps no more than limits.maxConcurrentRequests requests in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const slow = await serve((_request, response) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      setTimeout(() => {
        inFlight--;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(fs.readFileSync(path.join(API_FIXTURES, 'bulk.json')));
      }, 30);
    });
    try {
      const registry = new ProviderRegistry();
      registry.register(createExampleApiFactory({ baseUrl: slow.baseUrl }), (manifest) =>
        createTestProviderContext(manifest)
      );
      const search = registry.require('example-api', 'bulkAvailability').availability.search;
      await Promise.all(Array.from({ length: 6 }, () => search(STAY)));
      expect(peak).toBe(exampleApiManifest.limits!.maxConcurrentRequests);
    } finally {
      await slow.close();
    }
  });

  it('sends holds and the sign-in check through the same limiter as everything else', async () => {
    const seen: string[] = [];
    let inFlight = 0;
    let peak = 0;
    const answers: Record<string, [status: number, file: string]> = {
      '/api/availability': [200, 'bulk.json'],
      '/api/holds': [201, 'hold-created.json'],
    };
    const slow = await serve((request, response) => {
      const route = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      seen.push(route);
      inFlight++;
      peak = Math.max(peak, inFlight);
      request.resume();
      setTimeout(() => {
        inFlight--;
        const [status, file] = answers[route] ?? [401, 'not-found.json'];
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(fs.readFileSync(path.join(API_FIXTURES, file)));
      }, 30);
    });
    try {
      const registry = new ProviderRegistry();
      const http = new NodeHttpClient({ providerId: 'example-api' });
      registry.register(createExampleApiFactory({ baseUrl: slow.baseUrl }), (manifest) =>
        createTestProviderContext(manifest, { http })
      );
      const provider = registry.require('example-api', 'holds');
      await Promise.all([
        ...Array.from({ length: 3 }, () => provider.availability!.search!(STAY)),
        ...Array.from({ length: 3 }, () =>
          provider.holds.create({ externalId: '101', unitId: 's1', stay: STAY })
        ),
        ...Array.from({ length: 3 }, () => provider.auth!.isSignedIn(http)),
      ]);
      expect([...new Set(seen)].sort()).toEqual(['/api/availability', '/api/holds', '/api/me']);
      expect(seen).toHaveLength(9);
      expect(peak).toBe(exampleApiManifest.limits!.maxConcurrentRequests);
    } finally {
      await slow.close();
    }
  });
});

describe("example API provider's holds", () => {
  /** A loopback API whose `POST /api/holds` answers `status`; it records each body. */
  async function holdsApi(status: number, body = '{}') {
    const bodies: unknown[] = [];
    const server = await serve((request, response) => {
      let text = '';
      request.on('data', (chunk) => (text += chunk));
      request.on('end', () => {
        bodies.push(JSON.parse(text || 'null'));
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(body);
      });
    });
    const holds: HoldsModule = createExampleHolds({
      providerId: 'example-api',
      http: new NodeHttpClient({ providerId: 'example-api' }),
      limit: createLimiter(1),
      apiUrl: server.baseUrl,
      siteUrl: SITE,
    });
    return { holds, bodies, close: server.close };
  }

  it('places a hold: its reference, expiry and site, from the recorded 201', async () => {
    const provider = createExampleApiFactory()(fixtureContext(exampleApiManifest));
    await expect(
      provider.holds!.create({ externalId: '101', unitId: 's1', stay: STAY })
    ).resolves.toEqual({
      ok: true,
      reference: 'EP-H4821',
      expiresAt: new Date('2026-11-01T02:20:00.000Z'),
      unitId: 's1',
    });
  });

  it('sends the park, the site (or none, for any free one) and the stay', async () => {
    const api = await holdsApi(
      201,
      fs.readFileSync(path.join(API_FIXTURES, 'hold-created.json'), 'utf8')
    );
    try {
      await api.holds.create({ externalId: '101', unitId: 's1', stay: STAY });
      await api.holds.create({ externalId: '101', stay: { ...STAY, children: 1 } });
      expect(api.bodies).toEqual([
        { parkId: '101', siteId: 's1', arrival: '2026-11-10', departure: '2026-11-12', guests: 2 },
        { parkId: '101', siteId: null, arrival: '2026-11-10', departure: '2026-11-12', guests: 3 },
      ]);
    } finally {
      await api.close();
    }
  });

  it.each([
    [409, 'taken'],
    [401, 'auth-required'],
    [403, 'auth-required'],
    [422, 'invalid'],
    [423, 'in-progress'],
    [503, 'error'],
  ] as const)(
    'turns a %i refusal into a HoldFailure (%s), not a rejection',
    async (status, reason) => {
      const api = await holdsApi(status);
      try {
        await expect(api.holds.create({ externalId: '101', stay: STAY })).resolves.toEqual({
          ok: false,
          reason,
          message: `Example Parks did not hold the site (HTTP ${status})`,
        });
      } finally {
        await api.close();
      }
    }
  );

  it('rejects an answer of the wrong shape with a ProviderParseError', async () => {
    const api = await holdsApi(201, '{"hold":{"reference":""}}');
    try {
      await expect(api.holds.create({ externalId: '101', stay: STAY })).rejects.toBeInstanceOf(
        ProviderParseError
      );
    } finally {
      await api.close();
    }
  });

  it('pays on its checkout page, and only that hold’s confirmation page means it is paid', async () => {
    const provider = createExampleApiFactory()(fixtureContext(exampleApiManifest));
    const holds = provider.holds!;
    const hold = { reference: 'EP-H4821' };
    expect(holds.paymentUrl({ ok: true, ...hold, expiresAt: new Date() })).toBe(
      `${SITE}/checkout/EP-H4821`
    );
    const confirmed = `${SITE}/checkout/EP-H4821/confirmed`;
    const shown = 'Booking EP-H4821 confirmed. Thank you!';
    await expect(
      holds.bookedReference!(hold, paymentPage(`${confirmed}?ref=1`, shown))
    ).resolves.toBe('EP-H4821');
    // Another hold's page, the checkout itself, or the page without the reference: not paid.
    await expect(
      holds.bookedReference!(hold, paymentPage(`${SITE}/checkout/EP-H9999/confirmed`, shown))
    ).resolves.toBeNull();
    await expect(
      holds.bookedReference!(hold, paymentPage(`${SITE}/checkout/EP-H4821`, shown))
    ).resolves.toBeNull();
    await expect(
      holds.bookedReference!(hold, paymentPage(confirmed, 'Payment failed'))
    ).resolves.toBeNull();
  });
});

describe("example API provider's sign-in", () => {
  let answer: { status: number; body: string };
  let server: Awaited<ReturnType<typeof serve>>;
  const client = new NodeHttpClient({ providerId: 'example-api' });

  beforeAll(async () => {
    server = await serve((request, response) => {
      const found = request.url === '/api/me';
      response.writeHead(found ? answer.status : 404, { 'Content-Type': 'application/json' });
      response.end(found ? answer.body : '{}');
    });
  });
  afterAll(() => server.close());

  const auth = () =>
    createExampleAuth({ apiUrl: server.baseUrl, siteUrl: SITE, limit: createLimiter(1) });

  it('is a browser session on the provider’s own pages, which the registry accepts', () => {
    const provider = createExampleApiFactory()(fixtureContext(exampleApiManifest));
    expect(provider.auth).toMatchObject({
      kind: 'browser-session',
      signInUrl: `${SITE}/account/sign-in`,
      allowedOrigins: [SITE, 'https://login.example-parks.test'],
      completionUrlPatterns: [`${SITE}/account/welcome*`],
    });
  });

  it.each([
    [
      200,
      '{"email":"sam@example.com","name":"Sam Smith"}',
      { state: 'signed-in', email: 'sam@example.com', displayName: 'Sam Smith' },
    ],
    [200, '{"email":"sam@example.com"}', { state: 'signed-in', email: 'sam@example.com' }],
    [401, '{"error":"sign in"}', { state: 'signed-out' }],
    [403, '{}', { state: 'signed-out' }],
    [503, '{}', { state: 'unknown', reason: 'http 503' }],
    [200, '{"name":"no email"}', { state: 'unknown', reason: 'parse' }],
    [200, 'not json', { state: 'unknown', reason: 'parse' }],
  ] as const)('reads a %i %s as %o', async (status, body, expected) => {
    answer = { status, body };
    await expect(auth().isSignedIn(client)).resolves.toEqual(expected);
  });

  it('is unknown, not signed out, when the provider does not answer', async () => {
    const gone = createExampleAuth({
      apiUrl: 'http://127.0.0.1:1',
      siteUrl: SITE,
      limit: createLimiter(1),
    });
    await expect(gone.isSignedIn(client)).resolves.toEqual({ state: 'unknown', reason: 'network' });
  });

  it('rejects with an AbortError when the caller aborts', async () => {
    answer = { status: 200, body: '{"email":"sam@example.com"}' };
    const controller = new AbortController();
    controller.abort();
    const error = await auth()
      .isSignedIn(client, controller.signal)
      .then(
        () => 'resolved',
        (rejection: unknown) => rejection
      );
    expect(isAbortError(error)).toBe(true);
  });
});

// #region docs:test-contract
describeProviderContract('example-api', () => {
  const factory = createExampleApiFactory({ baseUrl: 'https://api.example-parks.test' });
  return {
    provider: factory(fixtureContext(factory.manifest)),
    sample: { externalId: '101', stay: STAY },
    unknownExternalId: '999',
  };
});
// #endregion

// ---------------------------------------------------------------------------------------
// The browser example
// ---------------------------------------------------------------------------------------

describe('example browser provider', () => {
  const fake = createFakeBrowser(renderExampleSite);
  let provider: ProviderWith<'availability'>;

  beforeAll(() => {
    const registry = new ProviderRegistry();
    registry.register(createExampleBrowserFactory(), (manifest) =>
      createTestProviderContext(manifest, { browser: fake })
    );
    provider = registry.require('example-browser', 'availability');
  });

  it('registers under its id with its polite limits', () => {
    const registry = new ProviderRegistry();
    registry.register(exampleBrowserFactory, (manifest) => createTestProviderContext(manifest));
    expect(registry.get('example-browser').manifest).toEqual(exampleBrowserManifest);
    expect(exampleBrowserManifest.limits).toMatchObject({ maxConcurrentRequests: 1 });
  });

  it('lists normalised LocationSummary[] read from the pages', async () => {
    await expect(provider.catalog!.listLocations!()).resolves.toEqual([
      {
        key: 'example-browser:sunset-bay',
        providerId: 'example-browser',
        externalId: 'sunset-bay',
        name: 'Sunset Bay Holiday Park',
        kind: 'holiday-park',
        bookingMode: 'online',
        lat: -33.6455,
        lng: 115.3459,
        area: { name: 'Busselton' },
        imageUrls: [],
        amenities: [],
        infoUrl: 'https://www.example-holiday.test/parks/sunset-bay',
      },
      expect.objectContaining({ key: 'example-browser:river-gums', kind: 'caravan-park' }),
    ]);
    expect(fake.openPages()).toBe(0);
    expect(fake.visits).toContain('https://www.example-holiday.test/parks');
  });

  it("answers availability through the park page's search form, only the stay nights", async () => {
    const result = await provider.availability.check('sunset-bay', STAY);
    expect(result.key).toBe('example-browser:sunset-bay');
    expect(result.units).toEqual([
      {
        unitId: 'c1',
        unitName: 'Beach Cabin 1',
        nights: [
          { date: '2026-11-10', state: 'available', price: 145 },
          { date: '2026-11-11', state: 'available', price: 155 },
        ],
        fullyAvailable: true,
      },
      {
        unitId: 'c2',
        unitName: 'Garden Cabin 2',
        nights: [
          { date: '2026-11-10', state: 'booked' },
          { date: '2026-11-11', state: 'available', price: 120 },
        ],
        fullyAvailable: false,
      },
    ]);
    for (const night of result.units.flatMap((u) => u.nights)) {
      expect(isCalendarDate(night.date)).toBe(true);
    }
    // The form's own script fetched the stay: the site's code ran in the page.
    expect(fake.requests).toContainEqual(
      expect.objectContaining({
        resourceType: 'fetch',
        url: 'https://www.example-holiday.test/api/availability?park=sunset-bay&arrival=2026-11-10&departure=2026-11-12&guests=2',
        status: 200,
      })
    );
    expect(fake.pageErrors).toEqual([]);
  });

  it('turns a missing page into a ProviderHttpError and closes it', async () => {
    await expect(provider.catalog!.getLocation('nowhere')).rejects.toBeInstanceOf(
      ProviderHttpError
    );
    expect(fake.openPages()).toBe(0);
  });

  it('rejects with an AbortError when the caller aborts mid-call', async () => {
    const controller = new AbortController();
    const pending = provider.catalog!.listLocations!(controller.signal);
    controller.abort();
    const error = await pending.then(
      () => 'resolved',
      (rejection: unknown) => rejection
    );
    expect(isAbortError(error)).toBe(true);
  });
});

// #region docs:test-fake-browser
describeProviderContract('example-browser', () => {
  // Pages come from the example site, in jsdom, its scripts running: the provider's own
  // page code runs against them.
  const fake = createFakeBrowser(renderExampleSite);
  const factory = createExampleBrowserFactory();
  return {
    provider: factory(createTestProviderContext(factory.manifest, { browser: fake })),
    sample: { externalId: 'sunset-bay', stay: STAY },
    unknownExternalId: 'nowhere',
    openPages: fake.openPages,
  };
});
// #endregion
