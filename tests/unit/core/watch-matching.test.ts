/**
 * What a watch finds in one availability answer (`core/watches/matching.ts`): wanted units (by
 * id, else by stay type), whether "any unit" spans stay types, full matches, partial runs from
 * the same nights, and the per-night price rule.
 */

import {
  fullMatches,
  kindsAmbiguous,
  partialMatches,
  priceCheck,
  wantedUnits,
} from '@main/core/watches/matching';
import type { NightStatus, UnitAvailability, UnitKind } from '@shared/types';

const D1 = '2026-12-01';
const D2 = '2026-12-02';
const D3 = '2026-12-03';
const D4 = '2026-12-04';

function night(date: string, state: NightStatus['state'], price?: number): NightStatus {
  return { date, state, ...(price !== undefined ? { price } : {}) };
}

function unit(
  unitId: string,
  nights: NightStatus[],
  extra: Partial<UnitAvailability> = {}
): UnitAvailability {
  return {
    unitId,
    unitName: `Site ${unitId}`,
    nights,
    fullyAvailable: nights.length > 0 && nights.every((n) => n.state === 'available'),
    ...extra,
  };
}

describe('watch matching', () => {
  describe('wanted units', () => {
    const units = [unit('1', []), unit('2', []), unit('3', [])];

    it('wants every unit when the watch names none', () => {
      expect(wantedUnits({ unitIds: [] }, units)).toHaveLength(3);
    });

    it('wants the units named by id or by name (legacy watches stored names)', () => {
      expect(wantedUnits({ unitIds: ['2', 'Site 3'] }, units).map((u) => u.unitId)).toEqual([
        '2',
        '3',
      ]);
    });

    it('wants a unit the provider says a kept id names (aliases), and only that one', () => {
      const regrouped = [{ ...unit('class:117', []), aliases: ['309'] }, unit('class:118', [])];
      expect(wantedUnits({ unitIds: ['309'] }, regrouped).map((u) => u.unitId)).toEqual([
        'class:117',
      ]);
      expect(wantedUnits({ unitIds: ['350'] }, regrouped)).toEqual([]);
    });
  });

  describe('stay types (unitKinds)', () => {
    const kinded = (unitId: string, unitKind?: UnitKind, nights: NightStatus[] = []) =>
      unit(unitId, nights, unitKind ? { unitKind } : {});
    // A mixed place: two sites, a cabin, a dorm bed and a unit the provider gives no kind
    const mixed = [
      kinded('s1', 'campsite'),
      kinded('c1', 'cabin'),
      kinded('s2', 'campsite'),
      kinded('d1', 'dorm'),
      kinded('x1'),
    ];
    const ids = (units: UnitAvailability[]) => units.map((u) => u.unitId);

    it('keeps only the units of the kinds wanted, in the provider’s order', () => {
      expect(ids(wantedUnits({ unitIds: [], unitKinds: ['cabin'] }, mixed))).toEqual(['c1']);
      expect(ids(wantedUnits({ unitIds: [], unitKinds: ['dorm', 'campsite'] }, mixed))).toEqual([
        's1',
        's2',
        'd1',
      ]);
      expect(wantedUnits({ unitIds: [], unitKinds: ['room'] }, mixed)).toEqual([]);
    });

    it('counts a unit with no kind, or a kind it does not know, as other', () => {
      const odd = [...mixed, unit('q1', [], { unitKind: 'castle' as UnitKind })];
      expect(ids(wantedUnits({ unitIds: [], unitKinds: ['other'] }, odd))).toEqual(['x1', 'q1']);
      expect(ids(wantedUnits({ unitIds: [], unitKinds: ['cabin'] }, odd))).toEqual(['c1']);
    });

    it('ids win over kinds: named units match by id, name or alias whatever their kind', () => {
      const regrouped = [...mixed, { ...kinded('class:9', 'glamping'), aliases: ['309'] }];
      expect(
        ids(wantedUnits({ unitIds: ['s1', 'Site d1', '309'], unitKinds: ['cabin'] }, regrouped))
      ).toEqual(['s1', 'd1', 'class:9']);
    });

    it('with no units and no kinds (none or empty) wants every unit', () => {
      expect(ids(wantedUnits({ unitIds: [] }, mixed))).toEqual(ids(mixed));
      expect(ids(wantedUnits({ unitIds: [], unitKinds: [] }, mixed))).toEqual(ids(mixed));
    });

    it('a provider that sets no kinds: every unit is other, so a cabin watch matches nothing', () => {
      const plain = [unit('1', []), unit('2', [])];
      expect(wantedUnits({ unitIds: [], unitKinds: ['cabin'] }, plain)).toEqual([]);
      expect(kindsAmbiguous({ unitIds: [] }, plain)).toBe(false);
    });

    it('kindsAmbiguous: no units named and the wanted units span more than one kind', () => {
      expect(kindsAmbiguous({ unitIds: [] }, mixed)).toBe(true);
      expect(kindsAmbiguous({ unitIds: [] }, [kinded('s1', 'campsite'), kinded('x1')])).toBe(true);
      const twoKinds = { unitIds: [], unitKinds: ['cabin', 'dorm'] as UnitKind[] };
      expect(kindsAmbiguous(twoKinds, wantedUnits(twoKinds, mixed))).toBe(true);
    });

    it('kindsAmbiguous is false for one kind, for named units, and for a place with one unit', () => {
      const cabins = { unitIds: [], unitKinds: ['cabin'] as UnitKind[] };
      expect(kindsAmbiguous(cabins, wantedUnits(cabins, mixed))).toBe(false);
      expect(
        kindsAmbiguous({ unitIds: [] }, [kinded('s1', 'campsite'), kinded('s2', 'campsite')])
      ).toBe(false);
      expect(kindsAmbiguous({ unitIds: ['s1', 'c1'] }, mixed)).toBe(false);
      expect(kindsAmbiguous({ unitIds: [] }, [kinded('c1', 'cabin')])).toBe(false);
      expect(kindsAmbiguous({ unitIds: [] }, [])).toBe(false);
    });

    it('kindsAmbiguous counts every wanted unit, free or not', () => {
      const oneFree = [
        kinded('s1', 'campsite', [night(D1, 'available')]),
        kinded('c1', 'cabin', [night(D1, 'booked')]),
      ];
      expect(kindsAmbiguous({ unitIds: [] }, oneFree)).toBe(true);
    });

    it('partial runs come from the same kind-filtered units', () => {
      const units = [
        kinded('s1', 'campsite', [night(D1, 'available'), night(D2, 'booked')]),
        kinded('c1', 'cabin', [night(D1, 'booked'), night(D2, 'available')]),
      ];
      const wanted = wantedUnits({ unitIds: [], unitKinds: ['cabin'] }, units);
      expect(partialMatches({}, wanted).map((m) => [m.unitId, m.arrival])).toEqual([['c1', D2]]);
      expect(fullMatches({}, wanted)).toEqual([]);
    });
  });

  describe('full matches', () => {
    it('matches a unit with every night available, with its total', () => {
      const [match] = fullMatches({}, [
        unit('1', [night(D1, 'available', 30), night(D2, 'available', 30)]),
      ]);
      expect(match).toEqual({
        unitId: '1',
        unitName: 'Site 1',
        arrival: D1,
        departure: D3,
        partial: false,
        priceKnown: true,
        total: 60,
      });
    });

    it('does not match a unit with a booked night', () => {
      expect(
        fullMatches({}, [unit('1', [night(D1, 'available', 30), night(D2, 'booked')])])
      ).toEqual([]);
    });

    it('filters out a unit with 2 available nights at $30 when maxPrice is 25 (per night)', () => {
      expect(
        fullMatches({ maxPrice: 25 }, [
          unit('1', [night(D1, 'available', 30), night(D2, 'available', 30)]),
        ])
      ).toEqual([]);
    });

    it('keeps a unit whose every night is within maxPrice', () => {
      expect(
        fullMatches({ maxPrice: 30 }, [
          unit('1', [night(D1, 'available', 30), night(D2, 'available', 25)]),
        ])
      ).toHaveLength(1);
    });

    it('passes a unit with unknown prices, marked priceKnown false', () => {
      const [match] = fullMatches({ maxPrice: 25 }, [
        unit('1', [night(D1, 'available', 30), night(D2, 'available')]),
      ]);
      expect(match).toMatchObject({ unitId: '1', priceKnown: false });
      expect(match.total).toBeUndefined();
    });
  });

  describe('partial runs', () => {
    it('a 3-night stay with nights 1–2 available yields one run {d1 → d3}', () => {
      const matches = partialMatches({}, [
        unit('1', [night(D1, 'available', 30), night(D2, 'available', 30), night(D3, 'booked')]),
      ]);
      expect(matches).toEqual([
        {
          unitId: '1',
          unitName: 'Site 1',
          arrival: D1,
          departure: D3,
          partial: true,
          priceKnown: true,
          total: 60,
        },
      ]);
    });

    it('splits runs at an unavailable night, per unit', () => {
      const matches = partialMatches({}, [
        unit('1', [night(D1, 'available'), night(D2, 'booked'), night(D3, 'available')]),
        unit('2', [night(D1, 'closed'), night(D2, 'available'), night(D3, 'available')]),
      ]);
      expect(matches.map((m) => [m.unitId, m.arrival, m.departure])).toEqual([
        ['1', D1, D2],
        ['1', D3, D4],
        ['2', D2, D4],
      ]);
    });

    it('splits a priced run at nights above maxPrice', () => {
      const matches = partialMatches({ maxPrice: 25 }, [
        unit('1', [
          night(D1, 'available', 20),
          night(D2, 'available', 40),
          night(D3, 'available', 20),
        ]),
      ]);
      expect(matches.map((m) => [m.arrival, m.departure, m.total])).toEqual([
        [D1, D2, 20],
        [D3, D4, 20],
      ]);
    });

    it('keeps a run with an unpriced night whole, priceKnown false', () => {
      const matches = partialMatches({ maxPrice: 25 }, [
        unit('1', [night(D1, 'available', 40), night(D2, 'available'), night(D3, 'booked')]),
      ]);
      expect(matches).toEqual([
        expect.objectContaining({ arrival: D1, departure: D3, priceKnown: false }),
      ]);
    });

    it('treats a gap in the dates as the end of a run', () => {
      const matches = partialMatches({}, [
        unit('1', [night(D1, 'available'), night(D3, 'available')]),
      ]);
      expect(matches.map((m) => [m.arrival, m.departure])).toEqual([
        [D1, D2],
        [D3, D4],
      ]);
    });
  });

  it('priceCheck: no nights is not a known price', () => {
    expect(priceCheck([], 10)).toEqual({ passes: true, priceKnown: false, total: undefined });
  });
});
