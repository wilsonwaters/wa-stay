/**
 * The provider conformance suite (`describeProviderContract`) against FakeProvider on its
 * own, and against `fake` and `fake2` side by side in one registry.
 */

import { ProviderRegistry } from '@main/providers/registry';
import type { CatalogModule } from '@main/providers/sdk';
import type { BoundingBox, LocationSummary } from '@shared/types/catalog.types';
import { createFakeProvider, createTestProviderContext } from '@tests/utils/fake-provider';
import { createFakeSearchProvider } from '@tests/utils/fake-search-provider';
import type {
  BulkAvailabilityEntry,
  NightStatus,
  UnitAvailability,
} from '@shared/types/provider.types';
import {
  abortViolation,
  bookingLinkViolations,
  bulkSplitViolations,
  defaultSearchText,
  describeProviderContract,
  freeCountViolations,
  searchAreaViolations,
  searchTextViolations,
  splitStayViolations,
  stayRuleViolations,
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

describeProviderContract('FakeProvider with unit booking links', () => ({
  provider: createFakeProvider({ unitBookingUrls: true }),
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

describe('the booking-link check of the contract suite', () => {
  const stay = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };
  const unit = (unitId: string, bookingUrl?: string) => ({
    unitId,
    unitName: `Site ${unitId}`,
    nights: [],
    fullyAvailable: false,
    ...(bookingUrl ? { bookingUrl } : {}),
  });

  it("passes links on the provider's site: its website's host and a subdomain of it", async () => {
    const fake = createFakeProvider({ unitBookingUrls: true });
    const result = await fake.availability!.check('1', stay);
    expect(result.bookingUrl).toMatch(/^https:\/\/fake\.example\//);
    expect(result.units[0].bookingUrl).toMatch(/^https:\/\/book\.fake\.example\//);
    expect(bookingLinkViolations(fake.manifest, result)).toEqual([]);
    expect(bookingLinkViolations(fake.manifest, { units: [unit('u1')] })).toEqual([]);
  });

  it('fails a provider whose check returns an off-site link, for the location or a unit', async () => {
    // A provider whose booking links are on another site: its check returns them as they are
    const offSite = createFakeProvider();
    offSite.links.booking = () => 'https://cart.elsewhere.test/add?campground=1';
    const result = await offSite.availability!.check('1', stay);
    expect(result.bookingUrl).toBe('https://cart.elsewhere.test/add?campground=1');
    expect(bookingLinkViolations(offSite.manifest, result)).toEqual([
      "the location's bookingUrl https://cart.elsewhere.test/add?campground=1 is not on https://fake.example",
    ]);

    // A look-alike host on a unit
    const lookAlike = {
      ...result,
      bookingUrl: undefined,
      units: [
        result.units[0],
        { ...result.units[1], bookingUrl: 'https://fake.example.evil.test/u2' },
      ],
    };
    expect(bookingLinkViolations(offSite.manifest, lookAlike)).toEqual([
      "unit u2's bookingUrl https://fake.example.evil.test/u2 is not on https://fake.example",
    ]);
  });

  it('fails an http link, credentials and a non-URL', () => {
    expect(
      bookingLinkViolations(
        { website: 'https://fake.example' },
        {
          units: [
            unit('a', 'http://fake.example/book'),
            unit('b', 'https://me:pw@fake.example/book'),
            unit('c', 'javascript:alert(1)'),
          ],
        }
      ).map((violation) => violation.split("'")[0])
    ).toEqual(['unit a', 'unit b', 'unit c']);
  });
});

/**
 * A provider with stay rules: u1 needs 3 nights (a shorter stay's nights are answered
 * `min-stay`), u2's nights are refused under its rules.
 */
const withStayRules = () =>
  createFakeProvider({
    availability: {
      '1': {
        u1: 'available',
        u2: [
          { state: 'unknown', reason: 'min-stay', minNights: 3, noArrival: true },
          { state: 'unknown', reason: 'min-stay', minNights: 3, noDeparture: true },
        ],
      },
    },
    unitMinNights: { u1: 3 },
  });

describeProviderContract('FakeProvider with stay rules', () => ({
  provider: withStayRules(),
  sample: { externalId: '1', stay: { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 } },
}));

describe('the stay-rule checks of the contract suite', () => {
  const stay = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };

  it('pass a provider that refuses a stay under its minimum and words its refused nights unknown', async () => {
    const fake = withStayRules();
    const result = await fake.availability!.check('1', stay);
    expect(result.units.map((u) => [u.unitId, u.fullyAvailable, u.minNights])).toEqual([
      ['u1', false, 3],
      ['u2', false, undefined],
    ]);
    // u1 has room both nights, but the 2-night stay is under its minimum: refused, not free
    expect(result.units[0].nights.map((n) => [n.state, n.reason])).toEqual([
      ['unknown', 'min-stay'],
      ['unknown', 'min-stay'],
    ]);
    expect(stayRuleViolations(stay, result)).toEqual([]);
    // A 3-night stay meets u1's minimum
    const longer = { ...stay, departure: '2026-11-13' };
    const three = await fake.availability!.check('1', longer, { unitIds: ['u1'] });
    expect(three.units[0].fullyAvailable).toBe(true);
    expect(three.units[0].nights.every((n) => n.state === 'available' && !n.reason)).toBe(true);
    expect(stayRuleViolations(longer, three)).toEqual([]);
  });

  it('fail a unit that is fullyAvailable for a stay shorter than its minNights', async () => {
    const result = await createFakeProvider().availability!.check('1', stay);
    const mistaken = {
      units: result.units.map((u) => (u.unitId === 'u1' ? { ...u, minNights: 3 } : u)),
    };
    expect(mistaken.units[0].fullyAvailable).toBe(true);
    expect(stayRuleViolations(stay, mistaken)).toEqual([
      'unit u1 is fullyAvailable for 2 nights, under its minNights 3',
      "unit u1's nights 2026-11-10, 2026-11-11 are available with no reason, under its 3-night minimum for 2 nights (they are min-stay)",
    ]);
    // A minimum the stay meets, or one that is no rule, is fine
    for (const minNights of [2, 1, 0, 2.5]) {
      const fine = { units: [{ ...result.units[0], minNights }] };
      expect(stayRuleViolations(stay, fine)).toEqual([]);
    }
  });

  it('fail a stay under the minimum (the arrival night’s, else the unit’s) whose nights are available with no reason', () => {
    const unit = (nights: object[], extra: object = {}) => ({
      unitId: 'u1',
      unitName: 'Site u1',
      fullyAvailable: false,
      nights: nights as never,
      ...extra,
    });
    const free = (date: string, extra: object = {}) => ({ date, state: 'available', ...extra });
    const refused = (date: string) => ({ date, state: 'unknown', reason: 'min-stay' });
    const message = (dates: string, minimum: number) =>
      `unit u1's nights ${dates} are available with no reason, under its ${minimum}-night minimum for 2 nights (they are min-stay)`;

    // The unit's minimum
    expect(
      stayRuleViolations(stay, {
        units: [unit([free('2026-11-10'), refused('2026-11-11')], { minNights: 3 })],
      })
    ).toEqual([message('2026-11-10', 3)]);
    // The arrival night's minimum, which comes before the unit's (here 1, no rule)
    expect(
      stayRuleViolations(stay, {
        units: [unit([free('2026-11-10', { minNights: 4 }), free('2026-11-11')], { minNights: 1 })],
      })
    ).toEqual([message('2026-11-10, 2026-11-11', 4)]);
    // A night's 0 or fraction is no rule: the unit's applies
    expect(
      stayRuleViolations(stay, {
        units: [
          unit([free('2026-11-10', { minNights: 0.5 }), free('2026-11-11')], { minNights: 3 }),
        ],
      })
    ).toEqual([message('2026-11-10, 2026-11-11', 3)]);
    // The arrival night's 2 lets the stay through, whatever the unit says; booked nights are fine
    expect(
      stayRuleViolations(stay, {
        units: [unit([free('2026-11-10', { minNights: 2 }), free('2026-11-11')], { minNights: 5 })],
      })
    ).toEqual([]);
    expect(
      stayRuleViolations(stay, {
        units: [
          unit([refused('2026-11-10'), { date: '2026-11-11', state: 'booked' }], { minNights: 3 }),
        ],
      })
    ).toEqual([]);
  });

  it('fail a min-stay night that is available', () => {
    const unit = {
      unitId: 'u1',
      unitName: 'Site u1',
      fullyAvailable: false,
      nights: [
        { date: '2026-11-10', state: 'available' as const, reason: 'min-stay' as const },
        { date: '2026-11-11', state: 'unknown' as const, reason: 'min-stay' as const },
      ],
    };
    expect(stayRuleViolations(stay, { units: [unit] })).toEqual([
      "unit u1's night 2026-11-10 is min-stay but available",
    ]);
  });
});

describe('the free-count checks of the contract suite', () => {
  const stay = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };
  const unit = (unitId: string, fullyAvailable: boolean, freeCount?: unknown) => ({
    unitId,
    unitName: `Category ${unitId}`,
    fullyAvailable,
    nights: [],
    ...(freeCount !== undefined ? { freeCount: freeCount as number } : {}),
  });

  it('pass a provider that counts no units (each unit is one), as FakeProvider does', async () => {
    const result = await createFakeProvider().availability!.check('1', stay);
    expect(result.units.some((u) => u.freeCount !== undefined)).toBe(false);
    expect(freeCountViolations(result)).toEqual([]);
  });

  it('pass whole counts on every unit: 1 or more when free for the whole stay, else 0', () => {
    expect(
      freeCountViolations({
        units: [unit('c1', true, 51), unit('c2', false, 0), unit('c3', true, 1)],
      })
    ).toEqual([]);
  });

  it('fail a count that is not a whole number, or that disagrees with fullyAvailable', () => {
    expect(
      freeCountViolations({
        units: [
          unit('c1', true, 2.5),
          unit('c2', true, -1),
          unit('c3', true, '4'),
          unit('c4', true, 0),
          unit('c5', false, 3),
        ],
      })
    ).toEqual([
      "unit c1's freeCount 2.5 is not a whole number",
      "unit c2's freeCount -1 is not a whole number",
      "unit c3's freeCount 4 is not a whole number",
      'unit c4 is fullyAvailable with freeCount 0',
      'unit c5 is not fullyAvailable, but its freeCount is 3',
    ]);
  });

  it('fail counts on some units only: a count of what is free could not tell if there is a total', () => {
    expect(
      freeCountViolations({ units: [unit('c1', true, 51), unit('c2', false), unit('c3', true)] })
    ).toEqual(['units c2, c3 have no freeCount, but others do']);
  });
});

/**
 * A provider whose units stand for several places, at 10–12 Nov 2026: u1 is booked, u2 is free
 * every night only by moving (booked through the place), u3 likewise in two parts (booked part
 * by part).
 */
const SPLIT_STAY = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };
const withSplitStays = () =>
  createFakeProvider({
    availability: {
      '1': {
        u1: 'booked',
        u2: [{ state: 'unknown', reason: 'split', price: 40 }, { state: 'available' }],
        u3: [{ state: 'available' }, { state: 'unknown', reason: 'split' }],
      },
    },
    splitStays: {
      u2: { booking: 'contact' },
      u3: {
        booking: 'separate',
        units: 2,
        parts: [
          { arrival: '2026-11-10', departure: '2026-11-11' },
          { arrival: '2026-11-11', departure: '2026-11-12' },
        ],
      },
    },
    contactLinks: true,
  });

describeProviderContract('FakeProvider with split stays', () => ({
  provider: withSplitStays(),
  sample: { externalId: '1', stay: SPLIT_STAY },
}));

describe('the split-stay checks of the contract suite', () => {
  const stay = SPLIT_STAY;
  const fake = withSplitStays();
  const night = (date: string, extra: Partial<NightStatus> = {}): NightStatus => ({
    date,
    state: 'unknown',
    reason: 'split',
    ...extra,
  });
  /** A unit that reports a valid split stay booked through the place, changed by `extra`. */
  const unit = (extra: Partial<UnitAvailability> = {}): UnitAvailability => ({
    unitId: 'c1',
    unitName: 'Powered Site',
    nights: [night('2026-11-10'), night('2026-11-11')],
    fullyAvailable: false,
    freeCount: 0,
    splitStay: { booking: 'contact' },
    ...extra,
  });
  const check = (units: UnitAvailability[], provider = fake) =>
    splitStayViolations(provider.manifest, provider, stay, { key: 'fake:1', units });
  const parts = (...dates: Array<[string, string]>) =>
    dates.map(([arrival, departure]) => ({ arrival, departure }));

  it('pass the split stays a provider reports as the SDK asks, and a check with none', async () => {
    const result = await fake.availability!.check('1', stay);
    expect(result.units.filter((u) => u.splitStay).map((u) => u.unitId)).toEqual(['u2', 'u3']);
    expect(check(result.units)).toEqual([]);
    expect(check([unit()])).toEqual([]);
    expect(
      check([
        unit({
          freeCount: undefined,
          nights: [
            night('2026-11-10', { state: 'available', reason: undefined }),
            night('2026-11-11'),
          ],
          splitStay: {
            booking: 'separate',
            parts: parts(['2026-11-10', '2026-11-11'], ['2026-11-11', '2026-11-12']),
          },
        }),
      ])
    ).toEqual([]);
    const plain = await createFakeProvider().availability!.check('1', stay);
    expect(check(plain.units, createFakeProvider())).toEqual([]);
  });

  it.each<[string, Partial<UnitAvailability>, string]>([
    [
      'a unit that is fullyAvailable',
      { fullyAvailable: true },
      "unit c1's split stay: the unit is fullyAvailable",
    ],
    [
      'a unit that counts free units',
      { freeCount: 3 },
      "unit c1's split stay: the unit counts 3 free",
    ],
    [
      'a missing night',
      { nights: [night('2026-11-10')] },
      "unit c1's split stay: no night for 2026-11-11",
    ],
    [
      'a booked night',
      {
        nights: [night('2026-11-10'), night('2026-11-11', { state: 'booked', reason: undefined })],
      },
      "unit c1's split stay: 2026-11-11 is booked, neither free nor split",
    ],
    [
      'a min-stay night',
      { nights: [night('2026-11-10'), night('2026-11-11', { reason: 'min-stay' })] },
      "unit c1's split stay: 2026-11-11 is unknown (min-stay), neither free nor split",
    ],
    [
      'a booked night marked split',
      { nights: [night('2026-11-10'), night('2026-11-11', { state: 'booked' })] },
      "unit c1's split stay: 2026-11-11 is split but booked, with no room",
    ],
    [
      'no split night',
      {
        nights: [
          night('2026-11-10', { state: 'available', reason: undefined }),
          night('2026-11-11', { state: 'available', reason: undefined }),
        ],
      },
      "unit c1's split stay: no night is split",
    ],
    [
      'an unknown way to book',
      { splitStay: { booking: 'phone' as never } },
      'unit c1\'s split stay: booking "phone" is neither contact nor separate',
    ],
    [
      'a count of 1',
      { splitStay: { booking: 'contact', units: 1 } },
      "unit c1's split stay: units 1 is not a whole number of at least 2",
    ],
    [
      'a count that is a fraction',
      { splitStay: { booking: 'contact', units: 2.5 } },
      "unit c1's split stay: units 2.5 is not a whole number of at least 2",
    ],
    [
      'more units than parts',
      {
        splitStay: {
          booking: 'separate',
          units: 3,
          parts: parts(['2026-11-10', '2026-11-11'], ['2026-11-11', '2026-11-12']),
        },
      },
      "unit c1's split stay: units 3 is more than its 2 parts",
    ],
    [
      'one part',
      { splitStay: { booking: 'separate', parts: parts(['2026-11-10', '2026-11-12']) } },
      "unit c1's split stay: its parts are 1, not 2 or more",
    ],
    [
      'parts with a gap',
      {
        splitStay: {
          booking: 'separate',
          parts: parts(['2026-11-10', '2026-11-11'], ['2026-11-12', '2026-11-13']),
        },
      },
      "unit c1's split stay: its parts have part 2 arriving 2026-11-12, not 2026-11-11",
    ],
    [
      'parts that overlap',
      {
        splitStay: {
          booking: 'separate',
          parts: parts(['2026-11-10', '2026-11-12'], ['2026-11-11', '2026-11-12']),
        },
      },
      "unit c1's split stay: its parts have part 2 arriving 2026-11-11, not 2026-11-12",
    ],
    [
      'parts that stop short of the departure',
      {
        splitStay: {
          booking: 'separate',
          parts: parts(['2026-11-10', '2026-11-11'], ['2026-11-11', '2026-11-11']),
        },
      },
      "unit c1's split stay: its parts have part 2 of no night (2026-11-11 to 2026-11-11)",
    ],
    [
      'parts that end after the departure',
      {
        splitStay: {
          booking: 'separate',
          parts: parts(['2026-11-10', '2026-11-11'], ['2026-11-11', '2026-11-13']),
        },
      },
      "unit c1's split stay: its parts end on 2026-11-13, not the stay's departure 2026-11-12",
    ],
    [
      'a part without dates',
      {
        splitStay: {
          booking: 'separate',
          parts: [
            { arrival: '2026-11-10', departure: '11 Nov' },
            ...parts(['2026-11-11', '2026-11-12']),
          ],
        },
      },
      "unit c1's split stay: its parts have part 1 without two calendar dates",
    ],
  ])('fail %s', (_name, extra, message) => {
    expect(check([unit(extra)])).toEqual([message]);
  });

  it('fail a split stay booked through the place with no contact page on the provider’s own site', () => {
    const without = createFakeProvider();
    expect(check([unit()], without)).toEqual([
      "unit c1's split stay is booked through the place, but the provider has no links.contact",
    ]);
    const offSite = withSplitStays();
    offSite.links.contact = () => 'https://contact.elsewhere.test/1';
    expect(check([unit()], offSite)).toEqual([
      'unit c1\'s split stay is booked through the place, but links.contact("1") gives https://contact.elsewhere.test/1, not a page on https://fake.example',
    ]);
    const http = withSplitStays();
    http.links.contact = () => 'http://fake.example/1/contact';
    expect(check([unit()], http)[0]).toContain(
      'gives http://fake.example/1/contact, not a page on'
    );
    const none = withSplitStays();
    none.links.contact = () => null;
    expect(check([unit(), unit({ unitId: 'c2' })], none)).toEqual([
      'unit c1\'s split stay is booked through the place, but links.contact("1") gives none',
      'unit c2\'s split stay is booked through the place, but links.contact("1") gives none',
    ]);
    // Booked part by part, it needs no contact page
    expect(check([unit({ splitStay: { booking: 'separate' } })], without)).toEqual([]);
  });

  describe('bulk', () => {
    const entry = (extra: Partial<BulkAvailabilityEntry> = {}): BulkAvailabilityEntry => ({
      key: 'fake:1',
      availableUnits: 0,
      splitStay: true,
      byKind: { campsite: { availableUnits: 0, splitStay: true }, cabin: { availableUnits: 2 } },
      ...extra,
    });

    it('pass a split stay flagged where nothing is free, for the place or a kind', async () => {
      expect(bulkSplitViolations([entry(), { key: 'fake:2', availableUnits: 4 }])).toEqual([]);
      expect(bulkSplitViolations([entry({ availableUnits: 2, splitStay: undefined })])).toEqual([]);
      expect(bulkSplitViolations(await createFakeProvider().availability!.search!(stay))).toEqual(
        []
      );
    });

    it('fail a split stay flagged where something is free, or flagged as anything but true', () => {
      expect(bulkSplitViolations([entry({ availableUnits: 3 })])).toEqual([
        'fake:1 flags a split stay with 3 available units',
      ]);
      expect(
        bulkSplitViolations([entry({ byKind: { cabin: { availableUnits: 1, splitStay: true } } })])
      ).toEqual(['fake:1 (cabin) flags a split stay with 1 available units']);
      expect(bulkSplitViolations([entry({ splitStay: 'yes' as never })])).toEqual([
        "fake:1's splitStay is yes, not true",
      ]);
    });
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
