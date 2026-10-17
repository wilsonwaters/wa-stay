/**
 * Unit kinds (R1): the six `UNIT_KINDS`, the five stay types people choose from, the kinds a
 * place gets from its location kind when its provider does not say, the cleaning every
 * location's list goes through, and the catalogue query's `unitKinds` filter.
 */

import { CatalogQuerySchema } from '@shared/types/catalog.types';
import {
  LOCATION_KINDS,
  UNIT_KINDS,
  UnitKindSchema,
  type LocationKind,
  type UnitKind,
} from '@shared/types/provider.types';
import {
  cleanUnitKinds,
  deriveUnitKinds,
  isUnitKind,
  STAY_TYPES,
  unitKindOfUnit,
  unitKindsOf,
} from '@shared/utils/unit-kinds';

const issuesAt = (result: { success: boolean; error?: { issues: { path: unknown[] }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((i) => i.path.join('.'));

describe('UNIT_KINDS and STAY_TYPES', () => {
  it('has the six unit kinds, and a schema that takes only those', () => {
    expect([...UNIT_KINDS]).toEqual(['campsite', 'cabin', 'room', 'dorm', 'glamping', 'other']);
    expect(UnitKindSchema.options).toEqual([...UNIT_KINDS]);
    expect(UnitKindSchema.safeParse('castle').success).toBe(false);
  });

  it('groups them as five stay types, in display order, never other', () => {
    expect(STAY_TYPES.map(({ kind, label }) => [kind, label])).toEqual([
      ['campsite', 'Camping'],
      ['cabin', 'Cabins & villas'],
      ['room', 'Rooms'],
      ['dorm', 'Dorms'],
      ['glamping', 'Glamping'],
    ]);
    expect(STAY_TYPES.map((t) => t.kind)).not.toContain('other');
  });

  it('isUnitKind accepts the six and nothing else', () => {
    for (const kind of UNIT_KINDS) expect(isUnitKind(kind)).toBe(true);
    for (const value of ['castle', 'Cabin', '', 'campground', 1, null, undefined, ['cabin']]) {
      expect([value, isUnitKind(value)]).toEqual([value, false]);
    }
  });
});

describe('deriveUnitKinds', () => {
  const table: Array<[LocationKind, UnitKind[]]> = [
    ['campground', ['campsite']],
    ['caravan-park', ['campsite']],
    ['holiday-park', ['campsite', 'cabin']],
    ['cabin', ['cabin']],
    ['hut', ['dorm']],
    ['glamping', ['glamping']],
    ['farm-stay', ['other']],
    ['home', ['other']],
    ['other', ['other']],
  ];

  it('covers every location kind', () => {
    expect(table.map(([kind]) => kind)).toEqual([...LOCATION_KINDS]);
  });

  it.each(table)('%s → %j, never empty', (kind, expected) => {
    expect(deriveUnitKinds(kind)).toEqual(expected);
    expect(deriveUnitKinds(kind).length).toBeGreaterThan(0);
  });

  it('gives other for a kind outside LOCATION_KINDS (a stored row may have one)', () => {
    expect(deriveUnitKinds('castle' as LocationKind)).toEqual(['other']);
    expect(deriveUnitKinds('toString' as LocationKind)).toEqual(['other']);
  });

  it('returns a new array each time, so a caller cannot change the table', () => {
    const first = deriveUnitKinds('holiday-park');
    first.push('room');
    expect(deriveUnitKinds('holiday-park')).toEqual(['campsite', 'cabin']);
  });
});

describe('cleanUnitKinds and unitKindsOf', () => {
  it('cleanUnitKinds drops unknown values and duplicates, in order', () => {
    expect(cleanUnitKinds(['cabin', 'castle', 'campsite', 'cabin', 3, null])).toEqual([
      'cabin',
      'campsite',
    ]);
    expect(cleanUnitKinds('cabin')).toEqual([]);
    expect(cleanUnitKinds(undefined)).toEqual([]);
  });

  it("keeps a location's own cleaned kinds", () => {
    expect(unitKindsOf({ kind: 'campground', unitKinds: ['cabin', 'room'] })).toEqual([
      'cabin',
      'room',
    ]);
    expect(unitKindsOf({ kind: 'holiday-park', unitKinds: ['dorm', 'dorm', 'castle'] })).toEqual([
      'dorm',
    ]);
  });

  it.each<[string, unknown]>([
    ['left out', undefined],
    ['empty', []],
    ['only unknown values', ['castle', 'Cabin']],
    ['not an array', 'cabin'],
  ])('derives them from the kind when they are %s', (_label, unitKinds) => {
    expect(unitKindsOf({ kind: 'holiday-park', unitKinds })).toEqual(['campsite', 'cabin']);
    expect(unitKindsOf({ kind: 'farm-stay', unitKinds })).toEqual(['other']);
  });
});

describe('unitKindOfUnit', () => {
  it('is the unit’s own kind, or other when it has none or one this app does not know', () => {
    expect(unitKindOfUnit({ unitKind: 'cabin' })).toBe('cabin');
    expect(unitKindOfUnit({ unitKind: 'other' })).toBe('other');
    expect(unitKindOfUnit({})).toBe('other');
    expect(unitKindOfUnit({ unitKind: 'castle' })).toBe('other');
  });
});

describe("CatalogQuerySchema's unitKinds", () => {
  it('accepts any unit kinds, other included', () => {
    expect(CatalogQuerySchema.parse({ unitKinds: ['cabin', 'other'] }).unitKinds).toEqual([
      'cabin',
      'other',
    ]);
  });

  it('rejects an unknown unit kind at its index', () => {
    expect(issuesAt(CatalogQuerySchema.safeParse({ unitKinds: ['cabin', 'castle'] }))).toEqual([
      'unitKinds.1',
    ]);
  });
});
