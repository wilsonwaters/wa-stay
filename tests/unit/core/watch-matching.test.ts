/**
 * What a watch finds in one availability answer (`core/watches/matching.ts`): wanted units,
 * full matches, partial runs from the same nights, and the per-night price rule.
 */

import { fullMatches, partialMatches, priceCheck, wantedUnits } from '@main/core/watches/matching';
import type { NightStatus, UnitAvailability } from '@shared/types';

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
