/**
 * Free units for a stay, counted one way everywhere (`src/shared/utils/free-units.ts`): a free
 * unit counts as the units it stands for (`freeCount`), else as one, and a provider that counts
 * its units gives no total.
 */
import { countsFreeUnits, freeUnitsOf, sumFreeUnits } from '@shared/utils/free-units';

describe('free units', () => {
  it('counts a free unit as its freeCount, a whole number of 1 or more, else as one', () => {
    expect(freeUnitsOf({ freeCount: 51 })).toBe(51);
    expect(freeUnitsOf({ freeCount: 1 })).toBe(1);
    // None (a check stored before counts, or a provider whose units are one each), or not a count
    for (const freeCount of [undefined, 0, -2, 2.5, Number.NaN, '51', null]) {
      expect(freeUnitsOf({ freeCount })).toBe(1);
    }
    expect(freeUnitsOf({})).toBe(1);
  });

  it('adds up the units free units stand for', () => {
    expect(sumFreeUnits([])).toBe(0);
    expect(sumFreeUnits([{}, {}, {}])).toBe(3);
    expect(sumFreeUnits([{ freeCount: 51 }, { freeCount: 3 }, {}])).toBe(55);
  });

  it('tells a provider that counts its units (any freeCount, 0 included) from one that does not', () => {
    expect(countsFreeUnits([{ freeCount: 0 }, { freeCount: 0 }])).toBe(true);
    expect(countsFreeUnits([{}, { freeCount: 51 }])).toBe(true);
    expect(countsFreeUnits([{}, {}])).toBe(false);
    expect(countsFreeUnits([])).toBe(false);
  });
});
