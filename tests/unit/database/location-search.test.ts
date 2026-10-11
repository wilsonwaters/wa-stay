/**
 * `LocationRepository.search` (V5): FTS5 words as prefixes, filters, facets, paging and
 * scope, on a real migrated database; plus the helpers the catalogue service uses
 * (`externalIds`, `setSummaryIfEmpty`) and the summary a sync keeps. Includes the
 * performance criterion: `text: 'bay'` over 5,000 rows in under 200 ms. And `mergeMany`,
 * which stores what a search-mode catalogue's search found (DX2).
 */

import type Database from 'better-sqlite3';
import { LocationRepository } from '@main/database/repositories';
import type { LocationSummary } from '@shared/types';
import { TestDatabaseHelper } from '@tests/utils/database-helper';

const AT = new Date('2026-10-02T02:00:00.000Z');

function place(
  providerId: string,
  externalId: string,
  name: string,
  extra: Partial<LocationSummary> = {}
): LocationSummary {
  return {
    key: `${providerId}:${externalId}`,
    providerId,
    externalId,
    name,
    kind: 'campground',
    bookingMode: 'online',
    lat: -32,
    lng: 116,
    imageUrls: [],
    amenities: [],
    ...extra,
  };
}

describe('LocationRepository.search', () => {
  let helper: TestDatabaseHelper;
  let db: Database.Database;
  let locations: LocationRepository;
  const SCOPE = ['fake', 'fake2'];

  beforeEach(async () => {
    helper = new TestDatabaseHelper('location-search');
    db = await helper.setup();
    locations = new LocationRepository(db);
    locations.upsertMany(
      'fake',
      [
        place('fake', '1', 'Lucky Bay', {
          area: { name: 'Cape Le Grand National Park', region: 'South Coast' },
          amenities: ['Toilet', 'Showers'],
          lat: -33.99,
          lng: 122.23,
        }),
        place('fake', '2', 'Bayside Cabins', {
          kind: 'cabin',
          bookingMode: 'offline',
          area: { name: 'Esperance', region: 'South Coast' },
          amenities: ['Toilet'],
          lat: -33.86,
          lng: 121.89,
        }),
        place('fake', '3', 'Pīnaroo Camp', {
          area: { name: 'Dirk Hartog Island National Park', region: 'Gascoyne' },
          summary: 'Remote island camping on the bay side',
          amenities: ['Showers'],
          lat: -25.85,
          lng: 113.08,
        }),
        place('fake', '4', 'Café Point', {
          area: { name: 'Shark Bay', region: 'Gascoyne' },
          lat: -25.7,
          lng: 113.5,
        }),
      ],
      AT
    );
    locations.upsertMany(
      'fake2',
      [place('fake2', 'a', 'Bay View Farm', { kind: 'farm-stay', amenities: ['Toilet'] })],
      AT
    );
    // A provider that is no longer registered: never in scope
    locations.upsertMany('gone', [place('gone', 'x', 'Lost Bay')], AT);
  });

  afterEach(async () => {
    await helper.teardown();
  });

  const keys = (query: Parameters<LocationRepository['search']>[0], scope = SCOPE): string[] =>
    locations.search(query, scope).items.map((l) => l.key);

  it('matches every word as a prefix in name, area, region or summary; name matches rank first', () => {
    const bay = keys({ text: 'bay' });
    // bm25 with the name weighted most, then the area, then the summary
    expect(bay.slice(0, 3).sort()).toEqual(['fake2:a', 'fake:1', 'fake:2']);
    expect(bay.slice(3)).toEqual(['fake:4', 'fake:3']);
    expect(keys({ text: 'lucky' })).toEqual(['fake:1']);
    expect(keys({ text: 'cape grand' })).toEqual(['fake:1']);
    expect(keys({ text: 'remote isl' })).toEqual(['fake:3']);
  });

  it('folds case and diacritics (remove_diacritics), both ways', () => {
    expect(keys({ text: 'PINAROO' })).toEqual(['fake:3']);
    expect(keys({ text: 'pīnaroo' })).toEqual(['fake:3']);
    expect(keys({ text: 'cafe' })).toEqual(['fake:4']);
    expect(keys({ text: 'Dirk Hartog' })).toEqual(['fake:3']);
  });

  it('treats whitespace- or punctuation-only text as no text, sorted by name', () => {
    const all = ['fake2:a', 'fake:2', 'fake:4', 'fake:1', 'fake:3'];
    expect(keys({ text: '   ' })).toEqual(all);
    expect(keys({ text: '"*()' })).toEqual(all);
    expect(keys({})).toEqual(all);
  });

  it('never runs text as FTS syntax or SQL', () => {
    expect(locations.search({ text: '"; DROP TABLE' }, SCOPE)).toMatchObject({
      items: [],
      total: 0,
    });
    expect(locations.search({ text: 'bay" OR "x' }, SCOPE).total).toBe(0);
    expect(locations.search({ text: "') OR 1=1 --" }, SCOPE).total).toBe(0);
    expect(locations.countByProvider()).toEqual({ fake: 4, fake2: 1, gone: 1 });
  });

  it('sort overrides the order: name with text, relevance without text falls back to name', () => {
    expect(keys({ text: 'bay', sort: 'name' })).toEqual([
      'fake2:a',
      'fake:2',
      'fake:4',
      'fake:1',
      'fake:3',
    ]);
    expect(keys({ sort: 'relevance' })).toEqual(keys({}));
  });

  it('applies kinds, regions and bookingModes as IN filters, and amenities as all-of', () => {
    expect(keys({ kinds: ['cabin', 'farm-stay'] })).toEqual(['fake2:a', 'fake:2']);
    expect(keys({ regions: ['Gascoyne'] })).toEqual(['fake:4', 'fake:3']);
    expect(keys({ bookingModes: ['offline'] })).toEqual(['fake:2']);
    expect(keys({ amenities: ['Toilet'] })).toEqual(['fake2:a', 'fake:2', 'fake:1']);
    expect(keys({ amenities: ['Toilet', 'Showers'] })).toEqual(['fake:1']);
    expect(keys({ amenities: ['Toilet', 'Spa'] })).toEqual([]);
    // An empty list is no filter
    expect(keys({ kinds: [], amenities: [] })).toHaveLength(5);
  });

  it('filters by bbox [west, south, east, north]', () => {
    expect(keys({ bbox: [113, -26, 114, -25] })).toEqual(['fake:4', 'fake:3']);
    expect(keys({ bbox: [121, -34.5, 123, -33.5], text: 'bay' }).sort()).toEqual([
      'fake:1',
      'fake:2',
    ]);
    expect(keys({ bbox: [0, 0, 1, 1] })).toEqual([]);
  });

  it('only returns providers in scope; unknown providerIds are ignored', () => {
    expect(keys({ text: 'lost' })).toEqual([]);
    expect(keys({ providerIds: ['fake2'] })).toEqual(['fake2:a']);
    expect(keys({ providerIds: ['fake2', 'nope', 'gone'] })).toEqual(['fake2:a']);
    expect(keys({ providerIds: ['nope'] })).toEqual([]);
    expect(keys({}, [])).toEqual([]);
  });

  it('pages with limit and offset; total counts every match', () => {
    const page = locations.search({ limit: 2, offset: 1 }, SCOPE);
    expect(page.items.map((l) => l.key)).toEqual(['fake:2', 'fake:4']);
    expect(page.total).toBe(5);

    const beyond = locations.search({ text: 'bay', offset: 50 }, SCOPE);
    expect(beyond).toMatchObject({ items: [], total: 5 });
  });

  it('counts each facet over what every other filter matches', () => {
    const { facets, total } = locations.search({ regions: ['Gascoyne'] }, SCOPE);
    expect(total).toBe(2);
    // Regions ignore the region filter: every region still shows, with its count
    expect(facets!.regions).toEqual([
      { value: 'Gascoyne', count: 2 },
      { value: 'South Coast', count: 2 },
    ]);
    // The others are counted within Gascoyne
    expect(facets!.amenities).toEqual([{ value: 'Showers', count: 1 }]);
    expect(facets!.kinds).toEqual([{ value: 'campground', count: 2 }]);
    expect(facets!.providers).toEqual([{ value: 'fake', count: 2 }]);

    const byProvider = locations.search({ providerIds: ['fake2'], text: 'bay' }, SCOPE).facets!;
    expect(byProvider.providers).toEqual([
      { value: 'fake', count: 4 },
      { value: 'fake2', count: 1 },
    ]);
    expect(byProvider.kinds).toEqual([{ value: 'farm-stay', count: 1 }]);
    const byAmenity = locations.search({ amenities: ['Showers'] }, SCOPE).facets!;
    expect(byAmenity.amenities).toEqual([
      { value: 'Toilet', count: 3 },
      { value: 'Showers', count: 2 },
    ]);
  });

  it('externalIds lists a provider’s cached ids, inside a bbox when given', () => {
    expect([...locations.externalIds('fake')].sort()).toEqual(['1', '2', '3', '4']);
    expect([...locations.externalIds('fake', [113, -26, 114, -25])].sort()).toEqual(['3', '4']);
    expect(locations.externalIds('nope').size).toBe(0);
  });

  it('setSummaryIfEmpty fills only an empty summary, and FTS finds it; a sync keeps it', () => {
    expect(locations.setSummaryIfEmpty('fake', '1', 'Turquoise water and kangaroos')).toBe(true);
    expect(locations.setSummaryIfEmpty('fake', '3', 'Something else')).toBe(false);
    expect(locations.setSummaryIfEmpty('fake', 'missing', 'x')).toBe(false);
    expect(keys({ text: 'kangaroo' })).toEqual(['fake:1']);
    expect(locations.get('fake', '3')?.summary).toBe('Remote island camping on the bay side');

    // The provider sends no summary: the derived one stays (and stays indexed)
    locations.upsertMany('fake', [place('fake', '1', 'Lucky Bay')], AT);
    expect(locations.get('fake', '1')?.summary).toBe('Turquoise water and kangaroos');
    expect(keys({ text: 'kangaroo' })).toEqual(['fake:1']);
    // A summary from the provider replaces it
    locations.upsertMany('fake', [place('fake', '1', 'Lucky Bay', { summary: 'Fresh' })], AT);
    expect(keys({ text: 'kangaroo' })).toEqual([]);
    expect(keys({ text: 'fresh' })).toEqual(['fake:1']);
  });
});

describe('LocationRepository.search performance', () => {
  let helper: TestDatabaseHelper;
  let locations: LocationRepository;

  beforeAll(async () => {
    helper = new TestDatabaseHelper('location-search-perf');
    const db = await helper.setup();
    locations = new LocationRepository(db);
    const words = ['Bay', 'Creek', 'Point', 'Beach', 'Hill', 'Spring', 'Gorge', 'Rock'];
    const regions = ['Pilbara', 'Kimberley', 'South West', 'Gascoyne', 'Goldfields'];
    const rows = Array.from({ length: 5_000 }, (_, i) =>
      place('fake', String(i), `${words[i % words.length]} Camp ${i}`, {
        area: { name: `Park ${i % 67}`, region: regions[i % regions.length] },
        summary: i % 3 === 0 ? 'Close to the bay and the beach' : undefined,
        amenities: i % 2 ? ['Toilet', 'Road access for 2WD/SUV'] : ['Toilet'],
        lat: -35 + (i % 200) * 0.1,
        lng: 113 + (i % 150) * 0.1,
      })
    );
    locations.upsertMany('fake', rows, AT);
  });

  afterAll(async () => {
    await helper.teardown();
  });

  it("search({ text: 'bay' }) over 5,000 rows, facets included, takes under 200 ms", () => {
    // One warm-up (statement preparation, page cache), then the best of 3: a single cold
    // timing measures the other Jest workers on the machine as much as the search.
    const result = locations.search({ text: 'bay' }, ['fake']);
    const timings = [0, 1, 2].map(() => {
      const started = performance.now();
      locations.search({ text: 'bay' }, ['fake']);
      return performance.now() - started;
    });
    const elapsed = Math.min(...timings);

    // "Bay" in the name (every 8th) or "bay" in the summary (every 3rd)
    const expected = Array.from({ length: 5_000 }, (_, i) => i).filter(
      (i) => i % 8 === 0 || i % 3 === 0
    ).length;
    expect(result.total).toBe(expected);
    expect(result.items[0].name).toMatch(/^Bay Camp/);
    expect(result.facets!.regions).toHaveLength(5);
    expect(elapsed).toBeLessThan(200);
  });
});

describe('LocationRepository.mergeMany (search-mode catalogues)', () => {
  let helper: TestDatabaseHelper;
  let locations: LocationRepository;

  beforeEach(async () => {
    helper = new TestDatabaseHelper('location-merge');
    locations = new LocationRepository(await helper.setup());
    locations.upsertMany('fake', [place('fake', '1', 'Lucky Bay')], AT);
  });

  afterEach(async () => {
    await helper.teardown();
  });

  it('adds and updates without removing any other row, and counts the new ones', () => {
    const first = locations.mergeMany(
      'search',
      [place('search', 'a', 'Quenda Cottage'), place('search', 'b', 'Bilby Bungalow')],
      AT
    );
    const later = new Date(AT.getTime() + 60_000);
    const second = locations.mergeMany(
      'search',
      [
        place('search', 'b', 'Bilby Bungalow (renovated)', { summary: 'Fresh paint' }),
        place('search', 'b', 'Bilby Bungalow (renovated)'),
        place('search', 'c', 'Marri Retreat'),
      ],
      later
    );

    expect(first).toEqual({ stored: 2, added: 2 });
    expect(second).toEqual({ stored: 2, added: 1 });
    expect(locations.countByProvider()).toEqual({ fake: 1, search: 3 });
    expect(locations.get('search', 'b')).toMatchObject({
      name: 'Bilby Bungalow (renovated)',
      summary: 'Fresh paint',
    });
    expect(locations.search({ text: 'renovated' }, ['search']).items.map((l) => l.key)).toEqual([
      'search:b',
    ]);
  });

  it('refuses a location of another provider, storing nothing', () => {
    expect(() =>
      locations.mergeMany(
        'search',
        [place('search', 'a', 'Quenda Cottage'), place('other', 'x', 'Elsewhere')],
        AT
      )
    ).toThrow('Location other:x does not belong to provider search');
    expect(locations.countByProvider()).toEqual({ fake: 1 });
  });
});
