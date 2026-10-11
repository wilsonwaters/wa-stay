/**
 * The browser-driven FakeProvider (V7) through the provider conformance suite, on the fake
 * browser (`tests/utils/fake-browser.ts`) whose pages render the fake holiday-park site in
 * jsdom. Proves the `ProviderContext.browser` contract end to end: the provider's own DOM code
 * runs, results map to the normalised types, calls run one page at a time, and no call leaves
 * a page open. The same provider on `PlaywrightBrowserAutomation` itself (one persistent
 * context, the no-browser error) is in `tests/unit/providers/browser-automation.test.ts`.
 */

import { ProviderRegistry } from '@main/providers/registry';
import { FAKE_SITE_PARKS, renderFakeSite } from '@tests/fixtures/fake-browser-site';
import { createFakeBrowser } from '@tests/utils/fake-browser';
import {
  createFakeBrowserProviderFactory,
  FAKE_BROWSER_BASE_URL,
} from '@tests/utils/fake-browser-provider';
import { createTestProviderContext, FIXED_NOW } from '@tests/utils/fake-provider';
import { describeProviderContract } from '@tests/utils/provider-contract';

const STAY = { arrival: '2026-11-13', departure: '2026-11-16', adults: 2 };

describeProviderContract('fake-browser', () => {
  const fake = createFakeBrowser(renderFakeSite);
  const factory = createFakeBrowserProviderFactory();
  return {
    provider: factory(createTestProviderContext(factory.manifest, { browser: fake })),
    sample: { externalId: 'swan-valley', stay: STAY },
    openPages: fake.openPages,
  };
});

describe('FakeBrowserProvider', () => {
  const fake = createFakeBrowser(renderFakeSite);
  const factory = createFakeBrowserProviderFactory();
  const registry = new ProviderRegistry();
  const provider = registry.register(factory, (manifest) =>
    createTestProviderContext(manifest, { browser: fake })
  );

  afterAll(() => registry.disposeAll());

  it('lists the parks read from the page, mapped to LocationSummary', async () => {
    const locations = await provider.catalog!.listLocations!();

    expect(locations).toHaveLength(FAKE_SITE_PARKS.length);
    expect(locations[0]).toEqual({
      key: 'fake-browser:swan-valley',
      providerId: 'fake-browser',
      externalId: 'swan-valley',
      name: 'Swan Valley Holiday Park',
      kind: 'holiday-park',
      bookingMode: 'online',
      lat: -31.8481,
      lng: 116.0049,
      area: { name: 'Swan Valley', region: 'Perth' },
      summary: 'Cabins and powered sites among the vineyards.',
      imageUrls: [],
      amenities: [],
      infoUrl: `${FAKE_BROWSER_BASE_URL}/parks/swan-valley`,
      bookingUrl: `${FAKE_BROWSER_BASE_URL}/parks/swan-valley`,
    });
    expect(locations[1].kind).toBe('caravan-park');
  });

  it('reads a park and its units', async () => {
    const detail = await provider.catalog!.getLocation('swan-valley');
    expect(detail.units).toEqual([
      { unitId: 'c1', unitName: 'Cabin 1', unitType: 'Cabin', maxPeople: 4 },
      { unitId: 'p7', unitName: 'Powered site 7', unitType: 'Powered site', maxPeople: 6 },
    ]);
    expect(detail.unitCount).toBe(2);
    expect(detail.fetchedAt).toBe(FIXED_NOW.toISOString());
  });

  it("maps the site's night cells to NightStatus, with prices and totals", async () => {
    const result = await provider.availability!.check('swan-valley', STAY);

    expect(result.key).toBe('fake-browser:swan-valley');
    expect(result.bookingUrl).toBe(
      `${FAKE_BROWSER_BASE_URL}/parks/swan-valley/availability?arrival=2026-11-13&departure=2026-11-16`
    );
    const [cabin, site] = result.units;
    expect(cabin).toMatchObject({ unitId: 'c1', fullyAvailable: true, total: 435 });
    expect(cabin.nights.map((n) => [n.date, n.state, n.price])).toEqual([
      ['2026-11-13', 'available', 145],
      ['2026-11-14', 'available', 145],
      ['2026-11-15', 'available', 145],
    ]);
    // 13th odd → vacant, 14th a multiple of 7 → closed, 15th odd → vacant.
    expect(site.nights.map((n) => [n.state, n.label])).toEqual([
      ['available', '$48.50'],
      ['closed', 'Closed'],
      ['available', '$48.50'],
    ]);
    expect(site).toMatchObject({ fullyAvailable: false, total: undefined });

    const onlySite = await provider.availability!.check('swan-valley', STAY, { unitIds: ['p7'] });
    expect(onlySite.units.map((u) => u.unitId)).toEqual(['p7']);
  });

  it('reads one page at a time, visits only the pages it needs, and closes every page', async () => {
    const before = fake.visits.length;
    const results = await Promise.all([
      provider.catalog!.listLocations!(),
      provider.catalog!.getLocation('busselton-jetty'),
      provider.availability!.check('busselton-jetty', STAY),
    ]);
    expect(results).toHaveLength(3);

    expect(fake.peakOpenPages).toBe(1);
    expect(fake.openPages()).toBe(0);
    expect(fake.visits.slice(before)).toEqual([
      `${FAKE_BROWSER_BASE_URL}/parks`,
      `${FAKE_BROWSER_BASE_URL}/parks/busselton-jetty`,
      `${FAKE_BROWSER_BASE_URL}/parks/busselton-jetty/availability?arrival=2026-11-13&departure=2026-11-16`,
    ]);
  });

  it('reports an unknown park as a 404 ProviderHttpError', async () => {
    await expect(provider.catalog!.getLocation('nowhere')).rejects.toMatchObject({
      name: 'ProviderHttpError',
      status: 404,
      url: `${FAKE_BROWSER_BASE_URL}/parks/nowhere`,
    });
  });
});
