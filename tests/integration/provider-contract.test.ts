/**
 * The provider conformance suite (`describeProviderContract`) against FakeProvider on its
 * own, and against `fake` and `fake2` side by side in one registry.
 */

import { ProviderRegistry } from '@main/providers/registry';
import type { CatalogModule } from '@main/providers/sdk';
import type { BoundingBox, LocationSummary } from '@shared/types/catalog.types';
import { createFakeProvider, createTestProviderContext } from '@tests/utils/fake-provider';
import { createFakeSearchProvider } from '@tests/utils/fake-search-provider';
import {
  abortViolation,
  defaultSearchText,
  describeProviderContract,
  searchAreaViolations,
  searchTextViolations,
} from '@tests/utils/provider-contract';

/** Perth to Albany: 6 of FakeSearchProvider's 12 places. */
const SOUTH_WEST: BoundingBox = [114.5, -35.5, 118.5, -31.5];

describeProviderContract('FakeProvider', () => ({ provider: createFakeProvider() }));

describeProviderContract('FakeProvider with a slow network (delayMs 20)', () => ({
  provider: createFakeProvider({ delayMs: 20 }),
}));

describeProviderContract('FakeProvider with only catalogue and availability', () => ({
  provider: createFakeProvider({
    capabilities: {
      bulkAvailability: false,
      watches: false,
      snipes: false,
      holds: false,
      bookingImport: false,
      accessGate: false,
      account: 'none',
    },
  }),
}));

describeProviderContract('FakeProvider with a search-mode catalogue', () => ({
  provider: createFakeProvider({ capabilities: { catalogMode: 'search' } }),
}));

describeProviderContract('FakeSearchProvider (search mode, with text search)', () => ({
  provider: createFakeSearchProvider({ textSearch: true }),
  searchBbox: SOUTH_WEST,
  searchText: 'karri',
}));

describeProviderContract('FakeSearchProvider without text search, over the whole world', () => ({
  provider: createFakeSearchProvider({ searchPageSize: 5 }),
}));

describe('the search-mode checks of the contract suite', () => {
  const place = (externalId: string, lng: number, lat: number): LocationSummary => ({
    key: `bad:${externalId}`,
    providerId: 'bad',
    externalId,
    name: `Place ${externalId}`,
    kind: 'campground',
    bookingMode: 'online',
    lat,
    lng,
    imageUrls: [],
    amenities: [],
  });
  const catalogOf = (searchArea: CatalogModule['searchArea']): CatalogModule => ({
    searchArea,
    getLocation: () => Promise.reject(new Error('unused')),
  });

  it('give searchText by default the first word of 3 or more characters, as the app asks', () => {
    expect(defaultSearchText('Karri Loft')).toBe('Karri');
    expect(defaultSearchText('St. Jo’s Bay Hut')).toBe('Bay');
    expect(defaultSearchText('A1 Ox Inn')).toBe('Inn');
    expect(defaultSearchText(' Ox ')).toBe('Ox');
  });

  it('pass a well-behaved search provider', async () => {
    const good = createFakeSearchProvider({ textSearch: true });
    expect(await searchAreaViolations(good.catalog!, SOUTH_WEST)).toEqual([]);
    expect(await searchTextViolations(good.catalog!, 'search', 'Bungalow')).toEqual([]);
    expect(
      await abortViolation((signal) => good.catalog!.searchArea!({ bbox: SOUTH_WEST }, signal))
    ).toBeUndefined();
  });

  it('name an item outside the box, beyond the tolerance', async () => {
    const catalog = catalogOf(async () => ({
      items: [place('in', 116, -32), place('edge', 118.505, -32), place('out', 122.2, -17.9)],
    }));
    expect(await searchAreaViolations(catalog, SOUTH_WEST)).toEqual([
      'page 1: bad:out at (122.2, -17.9) is outside [114.5, -35.5, 118.5, -31.5]',
    ]);
  });

  it('stop a cursor that never ends, or comes back unchanged', async () => {
    let n = 0;
    const endless = catalogOf(async () => ({ items: [], nextCursor: String(++n) }));
    expect(await searchAreaViolations(endless, SOUTH_WEST, 5)).toEqual([
      'searchArea still had a nextCursor after 5 pages',
    ]);
    const stuck = catalogOf(async () => ({ items: [], nextCursor: 'same' }));
    expect(await searchAreaViolations(stuck, SOUTH_WEST)).toEqual([
      'page 2: nextCursor "same" repeats the cursor it was given',
    ]);
  });

  it('reject a page without items, or with an empty cursor', async () => {
    const bare = catalogOf(async () => ({}) as never);
    expect(await searchAreaViolations(bare, SOUTH_WEST)).toEqual(['page 1 has no items array']);
    const blank = catalogOf(async () => ({ items: [], nextCursor: '' }));
    expect(await searchAreaViolations(blank, SOUTH_WEST)).toEqual([
      'page 1: nextCursor must be a non-empty string or absent',
    ]);
    expect(await searchAreaViolations({ getLocation: jest.fn() }, SOUTH_WEST)).toEqual([
      'catalog.searchArea is missing',
    ]);
  });

  it('say how a call ignores its signal', async () => {
    expect(await abortViolation(async () => [])).toBe(
      'resolved although its signal was aborted before the call'
    );
    const late = (signal: AbortSignal) =>
      signal.aborted ? Promise.reject(signal.reason) : new Promise((r) => setTimeout(r, 5));
    expect(await abortViolation(late)).toBe(
      'resolved although its signal was aborted during the call'
    );
    expect(await abortViolation(() => Promise.reject(new Error('boom')))).toBe(
      'rejected with Error: boom although its signal was aborted before the call'
    );
  });

  it("name a text search that finds nothing, or returns another provider's places", async () => {
    const quiet: CatalogModule = { searchText: async () => [], getLocation: jest.fn() };
    expect(await searchTextViolations(quiet, 'bad', 'bay')).toEqual([
      'searchText("bay") found nothing',
    ]);
    const foreign: CatalogModule = {
      searchText: async () => [{ ...place('1', 116, -32), key: 'other:1' }],
      getLocation: jest.fn(),
    };
    expect(await searchTextViolations(foreign, 'bad', 'bay')).toEqual([
      'searchText("bay"): other:1 is not a location of bad',
    ]);
  });
});

describe('a two-provider registry (fake, fake2)', () => {
  const registry = new ProviderRegistry();
  const fake = createFakeProvider({ id: 'fake', name: 'Fake One' });
  const fake2 = createFakeProvider({
    id: 'fake2',
    name: 'Fake Two',
    locations: [{ externalId: '1', name: 'Same id, other provider' }],
  });
  registry.register(fake.factory, createTestProviderContext);
  registry.register(fake2.factory, createTestProviderContext);

  describeProviderContract('fake in the registry', () => ({ provider: registry.get('fake') }));
  describeProviderContract('fake2 in the registry', () => ({ provider: registry.get('fake2') }));

  it('lists both and keeps their locations apart by key', async () => {
    expect(registry.list().map((m) => m.id)).toEqual(['fake', 'fake2']);
    const keys = [
      ...(await registry.require('fake', 'catalog').catalog.listLocations!()),
      ...(await registry.require('fake2', 'catalog').catalog.listLocations!()),
    ].map((l) => l.key);
    expect(keys).toEqual(['fake:1', 'fake:2', 'fake:area:3', 'fake2:1']);
  });

  it('gives each provider its own context, built from its manifest', () => {
    expect(fake.ctx?.id).toBe('fake');
    expect(fake2.ctx?.id).toBe('fake2');
    expect(fake.ctx?.state).not.toBe(fake2.ctx?.state);
    expect(fake.ctx?.manifest).toEqual(fake.manifest);
    expect(fake.ctx).toMatchObject({
      timezone: 'Australia/Perth',
      limits: { minWatchIntervalMinutes: 5, maxConcurrentRequests: 2, catalogTtlHours: 1 },
    });
  });

  it('a search-mode catalogue pages through searchArea, over the places inside the box', async () => {
    const search = createFakeProvider({ id: 'search', capabilities: { catalogMode: 'search' } });
    expect(search.catalog?.listLocations).toBeUndefined();
    const first = await search.catalog!.searchArea!({ bbox: [110, -40, 130, -10] });
    expect(first).toEqual({ items: [expect.anything(), expect.anything()], nextCursor: '2' });
    const last = await search.catalog!.searchArea!({ bbox: [110, -40, 130, -10], cursor: '2' });
    expect(last.items.map((l) => l.key)).toEqual(['search:area:3']);
    expect(last.nextCursor).toBeUndefined();
    // Banksia Camp is at (116, -34); the others are 0.1° and 0.2° north-east of it
    const corner = await search.catalog!.searchArea!({ bbox: [115.95, -34.05, 116.05, -33.95] });
    expect(corner).toEqual({ items: [expect.objectContaining({ key: 'search:1' })] });
  });
});

describe('FakeProvider knobs', () => {
  const stay = { arrival: '2026-11-10', departure: '2026-11-13', adults: 2 };

  it('failNext makes the next call into a module reject, then recovers; calls are logged', async () => {
    const fake = createFakeProvider();
    const boom = new Error('HTTP 500');
    fake.failNext('availability', boom);

    await expect(fake.availability!.check('1', stay)).rejects.toBe(boom);
    const result = await fake.availability!.check('1', stay, { unitIds: ['u1'] });

    expect(result.units.map((u) => [u.unitId, u.fullyAvailable, u.total])).toEqual([
      ['u1', true, 90],
    ]);
    expect(result.units[0].nights.map((n) => n.date)).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
    ]);
    expect(fake.calls.map((c) => `${c.module}.${c.method}`)).toEqual([
      'availability.check',
      'availability.check',
    ]);
  });

  it('delayMs is abortable mid-wait', async () => {
    const fake = createFakeProvider({ delayMs: 10_000 });
    const controller = new AbortController();
    const pending = fake.catalog!.listLocations!(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('the access gate steps through scripted states, and an unfinished script is an AccessGateError', async () => {
    const fake = createFakeProvider({ accessStates: ['waiting', 'waiting', 'active'] });
    const seen: string[] = [];
    fake.access!.onStatus((s) => seen.push(s.state));
    await expect(fake.access!.ensure()).resolves.toMatchObject({ state: 'active' });
    expect(seen).toEqual(['waiting', 'waiting', 'active']);

    const stuck = createFakeProvider({ accessStates: ['waiting', 'expired'] });
    await expect(stuck.access!.ensure()).rejects.toMatchObject({
      name: 'AccessGateError',
      state: 'expired',
    });
  });

  it('holdOpen is ref-counted and each release counts once', () => {
    const fake = createFakeProvider();
    const a = fake.access!.holdOpen();
    const b = fake.access!.holdOpen();
    expect(fake.holdCount).toBe(2);
    a();
    a();
    expect(fake.holdCount).toBe(1);
    b();
    expect(fake.holdCount).toBe(0);
  });

  it('holds: success, taken, and auth-required when signed out', async () => {
    const fake = createFakeProvider({ availability: { '1': { u1: 'available', u2: 'booked' } } });
    const held = await fake.holds!.create({ externalId: '1', stay });
    expect(held).toMatchObject({ ok: true, reference: 'FAKE-1', unitId: 'u1' });
    expect(fake.holds!.paymentUrl(held as Extract<typeof held, { ok: true }>)).toBe(
      'https://fake.example/pay/FAKE-1'
    );
    expect(await fake.holds!.create({ externalId: '1', unitId: 'u2', stay })).toMatchObject({
      ok: false,
      reason: 'taken',
    });

    const signedOut = createFakeProvider({
      account: 'signed-out',
      capabilities: { account: 'required-for-holds' },
    });
    expect(await signedOut.holds!.create({ externalId: '1', stay })).toMatchObject({
      ok: false,
      reason: 'auth-required',
    });
  });

  it('release policy: rollover, scheduled needs a time, cancellation is continuous', async () => {
    const release = createFakeProvider().release!;
    const now = new Date();
    expect(release.supports('daily_rollover')).toBe(true);
    expect(release.supports('ningaloo')).toBe(false);
    expect(
      await release.computeReleaseAt({ mode: 'cancellation', externalId: '1', stay, now })
    ).toBeNull();
    await expect(
      release.computeReleaseAt({ mode: 'scheduled', externalId: '1', stay, now })
    ).rejects.toThrow('A scheduled release needs a time');
    expect(
      (
        await release.computeReleaseAt({ mode: 'daily_rollover', externalId: '1', stay, now })
      )?.toISOString()
    ).toBe('2026-05-14T00:00:00.000Z');
  });
});
