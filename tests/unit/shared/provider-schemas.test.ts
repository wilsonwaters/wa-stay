/**
 * The shared provider and catalogue schemas: provider ids, calendar dates, stays, catalogue
 * queries and manifests.
 */

import {
  AccountFieldsSchema,
  CalendarDateSchema,
  DEFAULT_PROVIDER_LIMITS,
  isCalendarDate,
  ProviderIdSchema,
  providerLimits,
  ProviderManifestSchema,
  StayQuerySchema,
  type ProviderManifest,
} from '@shared/types/provider.types';
import { CATALOG_MAX_LIMIT, CatalogQuerySchema } from '@shared/types/catalog.types';
import { testManifest } from '@tests/utils/fake-provider';

const issuesAt = (result: { success: boolean; error?: { issues: { path: unknown[] }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((i) => i.path.join('.'));

describe('ProviderIdSchema', () => {
  it.each(['parkstay', 'rac', 'big-4', 'a1', 'x'.repeat(32)])('accepts %s', (id) => {
    expect(ProviderIdSchema.safeParse(id).success).toBe(true);
  });

  it.each(['ParkStay', 'p', '9lives', '-rac', 'rac_parks', 'rac:parks', '', 'x'.repeat(33)])(
    'rejects "%s"',
    (id) => {
      expect(ProviderIdSchema.safeParse(id).success).toBe(false);
    }
  );
});

describe('CalendarDateSchema', () => {
  it.each(['2026-10-02', '2028-02-29', '2026-12-31'])('accepts %s', (date) => {
    expect(CalendarDateSchema.safeParse(date).success).toBe(true);
  });

  it.each(['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-1-2', '2026/10/02', ''])(
    'rejects "%s"',
    (date) => {
      expect(isCalendarDate(date)).toBe(false);
      expect(CalendarDateSchema.safeParse(date).success).toBe(false);
    }
  );
});

describe('StayQuerySchema', () => {
  const stay = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };

  it('accepts a stay, with optional party and provider params', () => {
    const parsed = StayQuerySchema.parse({
      ...stay,
      children: 1,
      infants: 0,
      concessions: 1,
      equipment: 'tent',
      params: { gearType: 'tent', numVehicles: 1, ensuite: false },
    });
    expect(parsed.params).toEqual({ gearType: 'tent', numVehicles: 1, ensuite: false });
  });

  it('rejects a departure on or before the arrival', () => {
    const same = StayQuerySchema.safeParse({ ...stay, departure: stay.arrival });
    const before = StayQuerySchema.safeParse({ ...stay, departure: '2026-11-09' });
    expect(issuesAt(same)).toEqual(['departure']);
    expect(issuesAt(before)).toEqual(['departure']);
  });

  it('rejects a date that does not exist', () => {
    expect(issuesAt(StayQuerySchema.safeParse({ ...stay, arrival: '2026-02-30' }))).toContain(
      'arrival'
    );
  });

  it('needs at least one adult and whole, non-negative counts', () => {
    expect(issuesAt(StayQuerySchema.safeParse({ ...stay, adults: 0 }))).toEqual(['adults']);
    expect(issuesAt(StayQuerySchema.safeParse({ ...stay, children: -1 }))).toEqual(['children']);
    expect(issuesAt(StayQuerySchema.safeParse({ ...stay, adults: 1.5 }))).toEqual(['adults']);
  });

  it('only takes string, number or boolean params', () => {
    expect(
      issuesAt(StayQuerySchema.safeParse({ ...stay, params: { gear: { nested: true } } }))
    ).toEqual(['params.gear']);
  });
});

describe('CatalogQuerySchema', () => {
  it('defaults limit to everything (5000) and accepts an empty query', () => {
    expect(CatalogQuerySchema.parse({})).toEqual({ limit: CATALOG_MAX_LIMIT });
    expect(CATALOG_MAX_LIMIT).toBe(5000);
  });

  it.each([0, 5001, 1.5, -1])('rejects limit %s', (limit) => {
    expect(issuesAt(CatalogQuerySchema.safeParse({ limit }))).toEqual(['limit']);
  });

  it.each([1, 50, 5000])('accepts limit %s', (limit) => {
    expect(CatalogQuerySchema.parse({ limit }).limit).toBe(limit);
  });

  it('accepts every filter, with text (not q)', () => {
    const query = {
      text: 'karri',
      providerIds: ['parkstay'],
      kinds: ['campground', 'hut'],
      regions: ['South West'],
      amenities: ['Toilets'],
      bookingModes: ['online'],
      bbox: [115, -35, 117, -33],
      limit: 50,
      offset: 50,
      sort: 'name',
    };
    expect(CatalogQuerySchema.parse(query)).toEqual(query);
  });

  it.each([
    ['NaN', [Number.NaN, -35, 117, -33]],
    ['Infinity', [115, -35, Number.POSITIVE_INFINITY, -33]],
    ['-Infinity', [115, Number.NEGATIVE_INFINITY, 117, -33]],
  ])('rejects a bbox with a %s value', (_label, bbox) => {
    expect(CatalogQuerySchema.safeParse({ bbox }).success).toBe(false);
  });

  it('rejects a bbox out of range, upside down or of the wrong length', () => {
    expect(CatalogQuerySchema.safeParse({ bbox: [115, -95, 117, -33] }).success).toBe(false);
    expect(CatalogQuerySchema.safeParse({ bbox: [115, -33, 117, -35] }).success).toBe(false);
    expect(CatalogQuerySchema.safeParse({ bbox: [115, -35, 117] }).success).toBe(false);
  });

  it('rejects unknown kinds, booking modes and provider ids', () => {
    expect(CatalogQuerySchema.safeParse({ kinds: ['castle'] }).success).toBe(false);
    expect(CatalogQuerySchema.safeParse({ bookingModes: ['phone'] }).success).toBe(false);
    expect(CatalogQuerySchema.safeParse({ providerIds: ['ParkStay'] }).success).toBe(false);
  });
});

describe('ProviderManifestSchema', () => {
  const manifest: ProviderManifest = {
    id: 'parkstay',
    name: 'ParkStay WA',
    shortName: 'ParkStay',
    description: 'Campgrounds.',
    website: 'https://parkstay.dbca.wa.gov.au',
    integration: 'api',
    brand: { color: '#2F5D50', monogram: 'PS' },
    locationKinds: ['campground'],
    timezone: 'Australia/Perth',
    currency: 'AUD',
    capabilities: {
      catalog: true,
      catalogMode: 'full',
      availability: true,
      bulkAvailability: true,
      watches: true,
      snipes: true,
      holds: true,
      bookingImport: false,
      accessGate: true,
      account: 'required-for-holds',
    },
    limits: { minWatchIntervalMinutes: 15, maxConcurrentRequests: 4, catalogTtlHours: 24 },
    stayFields: [
      {
        key: 'gearType',
        label: 'Gear',
        type: 'select',
        options: [{ value: 'all', label: 'All' }],
        default: 'all',
        appliesTo: ['watch', 'snipe'],
      },
      {
        key: 'postcode',
        label: 'Postcode',
        type: 'text',
        pattern: '^\\d{4}$',
        appliesTo: ['snipe', 'hold'],
        required: true,
      },
      {
        key: 'numVehicles',
        label: 'Vehicles',
        type: 'number',
        min: 0,
        max: 5,
        default: 1,
        appliesTo: ['hold'],
      },
    ],
    releaseModes: [
      { id: 'daily_rollover', label: 'Daily', description: 'Rolls over.', usesAccessGate: true },
    ],
  };

  const withChange = (change: (m: ProviderManifest) => void): ProviderManifest => {
    const copy = structuredClone(manifest);
    change(copy);
    return copy;
  };

  it('accepts a full manifest with stay fields and release modes', () => {
    expect(issuesAt(ProviderManifestSchema.safeParse(manifest))).toEqual([]);
  });

  it('trims the website and drops tabs and newlines in it (zod 4 z.url()), still https only', () => {
    // Pinned so a change to this normalisation is deliberate.
    const parsed = ProviderManifestSchema.safeParse({
      ...manifest,
      website: ' https://parkstay.dbca.wa.\tgov.au/\n ',
    });
    expect(parsed.success && parsed.data.website).toBe('https://parkstay.dbca.wa.gov.au/');
    expect(
      ProviderManifestSchema.safeParse({ ...manifest, website: ' http://parkstay.dbca.wa.gov.au' })
        .success
    ).toBe(false);
  });

  it('accepts the stay fields bulk availability depends on, provider params included', () => {
    const bulk = {
      ...manifest,
      bulkAvailabilityStayFields: ['arrival', 'departure', 'equipment', 'params.gearType'],
    };
    expect(issuesAt(ProviderManifestSchema.safeParse(bulk))).toEqual([]);
  });

  it.each<[string, (m: ProviderManifest) => void, string]>([
    ['an http website', (m) => (m.website = 'http://parkstay.dbca.wa.gov.au'), 'website'],
    ['a named colour', (m) => (m.brand.color = 'green'), 'brand.color'],
    ['a long monogram', (m) => (m.brand.monogram = 'PARK'), 'brand.monogram'],
    ['no location kinds', (m) => (m.locationKinds = []), 'locationKinds'],
    ['an unknown time zone', (m) => (m.timezone = 'Mars/Olympus'), 'timezone'],
    ['no currency', (m) => delete (m as Partial<ProviderManifest>).currency, 'currency'],
    ['a lower-case currency', (m) => (m.currency = 'aud'), 'currency'],
    [
      'bulk availability without both dates',
      (m) => (m.bulkAvailabilityStayFields = ['arrival', 'adults']),
      'bulkAvailabilityStayFields',
    ],
    [
      'an unknown bulk availability stay field',
      (m) => (m.bulkAvailabilityStayFields = ['arrival', 'departure', 'party' as 'adults']),
      'bulkAvailabilityStayFields.2',
    ],
    ['a currency symbol', (m) => (m.currency = '$'), 'currency'],
    [
      'an unknown catalogue mode',
      (m) => ((m.capabilities as { catalogMode: string }).catalogMode = 'scrape'),
      'capabilities.catalogMode',
    ],
    [
      'a zero watch interval',
      (m) => (m.limits!.minWatchIntervalMinutes = 0),
      'limits.minWatchIntervalMinutes',
    ],
    [
      'fractional concurrency',
      (m) => (m.limits!.maxConcurrentRequests = 1.5),
      'limits.maxConcurrentRequests',
    ],
    ['a negative catalogue TTL', (m) => (m.limits!.catalogTtlHours = -1), 'limits.catalogTtlHours'],
    [
      'an unknown account requirement',
      (m) => ((m.capabilities as { account: string }).account = 'maybe'),
      'capabilities.account',
    ],
    [
      'a missing capability',
      (m) => delete (m.capabilities as Partial<typeof m.capabilities>).accessGate,
      'capabilities.accessGate',
    ],
    ['a select without options', (m) => (m.stayFields![0].options = []), 'stayFields.0.options'],
    ['a bad pattern', (m) => (m.stayFields![1].pattern = '(['), 'stayFields.1.pattern'],
    ['min above max', (m) => (m.stayFields![2].min = 9), 'stayFields.2.min'],
    [
      'a default of the wrong type',
      (m) => (m.stayFields![2].default = 'one'),
      'stayFields.2.default',
    ],
    ['no appliesTo', (m) => (m.stayFields![0].appliesTo = []), 'stayFields.0.appliesTo'],
    [
      'an unknown use (usedBy wording)',
      (m) => ((m.stayFields![0].appliesTo as string[]) = ['watches']),
      'stayFields.0.appliesTo.0',
    ],
    ['duplicate stay field keys', (m) => (m.stayFields![1].key = 'gearType'), 'stayFields'],
    [
      'duplicate release modes',
      (m) => m.releaseModes!.push({ ...m.releaseModes![0] }),
      'releaseModes',
    ],
  ])('rejects %s', (_label, change, path) => {
    expect(issuesAt(ProviderManifestSchema.safeParse(withChange(change)))).toContain(path);
  });
});

describe('provider limits', () => {
  it('defaults every limit when the manifest sets none, and keeps the ones it sets', () => {
    expect(providerLimits({})).toEqual(DEFAULT_PROVIDER_LIMITS);
    expect(
      providerLimits({
        limits: { minWatchIntervalMinutes: 30, maxConcurrentRequests: 1, catalogTtlHours: 6 },
      })
    ).toEqual({ minWatchIntervalMinutes: 30, maxConcurrentRequests: 1, catalogTtlHours: 6 });
    expect(Object.isFrozen(DEFAULT_PROVIDER_LIMITS)).toBe(true);
  });

  it('a manifest without limits is valid', () => {
    const manifest = testManifest('nolimits');
    expect(manifest.limits).toBeUndefined();
    expect(ProviderManifestSchema.safeParse(manifest).success).toBe(true);
  });
});

describe('AccountFieldsSchema (credentials sign-in fields)', () => {
  it('accepts fields with a key, a label and whether each is secret', () => {
    expect(
      AccountFieldsSchema.safeParse([
        { key: 'email', label: 'Email', secret: false },
        { key: 'password', label: 'Password', secret: true, help: 'As on the website' },
      ]).success
    ).toBe(true);
  });

  it.each<[string, unknown]>([
    ['no fields', []],
    ['a missing secret flag', [{ key: 'email', label: 'Email' }]],
    ['an empty label', [{ key: 'email', label: ' ', secret: false }]],
    ['a key with a dot', [{ key: 'user.email', label: 'Email', secret: false }]],
    [
      'duplicate keys',
      [
        { key: 'email', label: 'Email', secret: false },
        { key: 'email', label: 'Again', secret: false },
      ],
    ],
  ])('rejects %s', (_label, fields) => {
    expect(AccountFieldsSchema.safeParse(fields).success).toBe(false);
  });
});
