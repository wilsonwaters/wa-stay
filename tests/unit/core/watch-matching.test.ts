/**
 * What a watch finds in one availability answer (`core/watches/matching.ts`): wanted units (by
 * id, else by stay type), whether "any unit" spans stay types, full matches, partial runs from
 * the same nights, the per-night price rule, and the provider's stay rules (minimum nights,
 * arrival and departure days).
 */

import {
  freeForStay,
  fullMatches,
  kindsAmbiguous,
  longestRun,
  meetsStayRules,
  minimumNights,
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

  describe('longestRun (what a partial alert and its booking link name)', () => {
    it('is the run with the most nights, wherever it is', () => {
      const runs = partialMatches({}, [
        unit('1', [night(D1, 'available'), night(D2, 'booked'), night(D3, 'available')]),
        unit('2', [night(D1, 'booked'), night(D2, 'available'), night(D3, 'available')]),
      ]);
      expect(runs).toHaveLength(3);
      expect(longestRun(runs)).toMatchObject({ unitId: '2', arrival: D2, departure: D4 });
    });

    it('is the first on a tie, and undefined for no runs', () => {
      const runs = partialMatches({}, [
        unit('1', [night(D1, 'available'), night(D2, 'booked'), night(D3, 'available')]),
        unit('2', [night(D1, 'booked'), night(D2, 'booked'), night(D3, 'available')]),
      ]);
      expect(runs.map((r) => [r.unitId, r.arrival])).toEqual([
        ['1', D1],
        ['1', D3],
        ['2', D3],
      ]);
      expect(longestRun(runs)).toBe(runs[0]);
      expect(longestRun([])).toBeUndefined();
    });
  });

  describe('stay rules (minimum nights, arrival and departure days)', () => {
    const D5 = '2026-12-05';
    const D6 = '2026-12-06';
    const free = (date: string, extra: Partial<NightStatus> = {}): NightStatus => ({
      ...night(date, 'available'),
      ...extra,
    });
    const runs = (units: UnitAvailability[], maxPrice?: number) =>
      partialMatches({ maxPrice }, units).map((m) => [m.unitId, m.arrival, m.departure]);

    it('drops a 2-night run under a 3-night minimum, and keeps a 3-night one', () => {
      expect(
        runs([
          unit('2n', [free(D1), free(D2), night(D3, 'booked')], { minNights: 3 }),
          unit('3n', [free(D1), free(D2), free(D3)], { minNights: 3, fullyAvailable: false }),
        ])
      ).toEqual([['3n', D1, D4]]);
    });

    it("lets a night's minNights beat the unit's, in either direction", () => {
      // The night asks for 2 where the unit says 3: the 2-night run is kept
      expect(
        runs([
          unit('1', [free(D1, { minNights: 2 }), free(D2), night(D3, 'booked')], { minNights: 3 }),
        ])
      ).toEqual([['1', D1, D3]]);
      // The night asks for 4 where the unit says 2: the 3-night run is dropped
      expect(
        runs([unit('1', [free(D1, { minNights: 4 }), free(D2), free(D3)], { minNights: 2 })])
      ).toEqual([]);
      expect(minimumNights({ minNights: 3 }, free(D1, { minNights: 1 }))).toBe(1);
    });

    it('decides by the first night when the nights of a run have different minimums', () => {
      const nights = [free(D1, { minNights: 2 }), free(D2, { minNights: 5 }), night(D3, 'booked')];
      expect(runs([unit('1', nights)])).toEqual([['1', D1, D3]]);
      const later = [night(D1, 'booked'), free(D2, { minNights: 3 }), free(D3, { minNights: 1 })];
      expect(runs([unit('1', later)])).toEqual([]);
    });

    it('reads a minNights of 0, 1, undefined, negative or a fraction as no rule', () => {
      for (const minNights of [0, 1, undefined, -2, 2.5, Number.NaN]) {
        const nights = [free(D1, { minNights }), night(D2, 'booked')];
        expect(runs([unit('1', nights, { minNights })])).toEqual([['1', D1, D2]]);
        expect(minimumNights({ minNights }, free(D1, { minNights }))).toBe(1);
      }
      // A night with no rule of its own falls back to the unit's
      expect(minimumNights({ minNights: 3 }, free(D1, { minNights: 0 }))).toBe(3);
    });

    it('trims a run that starts on a no-arrival night to start the next night, then keeps or drops it by length', () => {
      const nights = [free(D1, { noArrival: true }), free(D2), free(D3), night(D4, 'booked')];
      expect(runs([unit('kept', nights)])).toEqual([['kept', D2, D4]]);
      expect(runs([unit('short', nights, { minNights: 3 })])).toEqual([]);
      // Every night refusing arrivals leaves nothing
      const none = [free(D1, { noArrival: true }), free(D2, { noArrival: true })];
      expect(runs([unit('none', none)])).toEqual([]);
    });

    it('ignores a no-arrival night inside a run', () => {
      const nights = [free(D1), free(D2, { noArrival: true }), free(D3)];
      expect(runs([unit('1', nights, { fullyAvailable: false })])).toEqual([['1', D1, D4]]);
    });

    it('trims a run whose departure date takes no departures, back to a day that does', () => {
      // Leaving on the 4th is refused (a booked night that says so): the run ends on the 3rd
      const booked = [
        free(D1),
        free(D2),
        free(D3),
        { ...night(D4, 'booked'), noDeparture: true as const },
      ];
      expect(runs([unit('1', booked)])).toEqual([['1', D1, D3]]);
      // Leaving on the 3rd is refused too, by a night inside the run
      const twice = [
        free(D1),
        free(D2),
        free(D3, { noDeparture: true }),
        { ...night(D4, 'booked'), noDeparture: true as const },
      ];
      expect(runs([unit('1', twice)])).toEqual([['1', D1, D2]]);
      // ...and then too short for its minimum
      expect(runs([unit('1', twice, { minNights: 2 })])).toEqual([]);
    });

    it('allows a departure night the provider did not report', () => {
      // The run ends on the stay's last night: the 4th is not in the answer
      const nights = [night(D1, 'booked'), free(D2), free(D3, { noDeparture: true })];
      expect(runs([unit('1', nights)])).toEqual([['1', D2, D4]]);
      expect(meetsStayRules({}, [free(D2), free(D3)])).toBe(true);
    });

    it('splits a run at the price limit first, then trims and checks each piece', () => {
      const nights = [
        free(D1, { price: 20, noArrival: true }),
        free(D2, { price: 20 }),
        free(D3, { price: 20 }),
        free(D4, { price: 40 }),
        free(D5, { price: 20 }),
        free(D6, { price: 20, minNights: 3 }),
      ];
      // Pieces {1–3} and {5–6}; the first starts on the 2nd, the second (from the 5th, minimum
      // 1) keeps both nights
      expect(runs([unit('1', nights, { fullyAvailable: false })], 25)).toEqual([
        ['1', D2, D4],
        ['1', D5, '2026-12-07'],
      ]);
      // The 4th refuses departures: the first piece ends on the 2nd
      nights[3] = { ...nights[3], noDeparture: true };
      expect(runs([unit('1', nights, { fullyAvailable: false })], 25)).toEqual([
        ['1', D2, D3],
        ['1', D5, '2026-12-07'],
      ]);
    });

    it('breaks runs at min-stay nights, which never count as free (even beside available)', () => {
      const nights = [
        free(D1),
        { ...night(D2, 'unknown'), reason: 'min-stay' as const },
        free(D3),
        { ...free(D4), reason: 'min-stay' as const },
        free(D5),
      ];
      expect(runs([unit('1', nights, { fullyAvailable: false })])).toEqual([
        ['1', D1, D2],
        ['1', D3, D4],
        ['1', D5, D6],
      ]);
      // As a split night does, whatever its state
      const split = [free(D1), { ...free(D2), reason: 'split' as const }, free(D3)];
      expect(runs([unit('2', split, { fullyAvailable: false })])).toEqual([
        ['2', D1, D2],
        ['2', D3, D4],
      ]);
    });

    it('is no full match for a fullyAvailable unit whose minimum is above the stay', () => {
      const twoNights = [free(D1), free(D2)];
      const units = [
        unit('min3', twoNights, { minNights: 3, fullyAvailable: true }),
        unit('night3', [free(D1, { minNights: 3 }), free(D2)], { fullyAvailable: true }),
        unit('min2', twoNights, { minNights: 2, fullyAvailable: true }),
      ];
      expect(fullMatches({}, units).map((m) => m.unitId)).toEqual(['min2']);
      expect(units.map(freeForStay)).toEqual([false, false, true]);
    });

    it('is no full match for a fullyAvailable unit arriving on a no-arrival day, or with a min-stay night', () => {
      const units = [
        unit('arrival', [free(D1, { noArrival: true }), free(D2)], { fullyAvailable: true }),
        unit('reason', [free(D1), { ...free(D2), reason: 'min-stay' }], { fullyAvailable: true }),
        unit('inside', [free(D1), free(D2, { noArrival: true, noDeparture: true })]),
      ];
      expect(fullMatches({}, units).map((m) => m.unitId)).toEqual(['inside']);
    });

    it('meetsStayRules: long enough from its arrival, arriving and leaving on days that allow it', () => {
      const unitRule = { minNights: 2 };
      expect(meetsStayRules(unitRule, [free(D1), free(D2)])).toBe(true);
      expect(meetsStayRules(unitRule, [free(D1)])).toBe(false);
      expect(meetsStayRules({}, [free(D1, { noArrival: true })])).toBe(false);
      expect(meetsStayRules({}, [free(D1)], free(D2, { noDeparture: true }))).toBe(false);
      expect(meetsStayRules({}, [free(D1)], free(D2, { noArrival: true }))).toBe(true);
      expect(meetsStayRules({}, [])).toBe(false);
    });
  });
});
