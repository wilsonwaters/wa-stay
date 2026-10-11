import { stayKey } from '../../../api';
import { exploreStay } from './stay';

const NONE = { arrival: null, departure: null, adults: null, children: null, infants: null };

describe('exploreStay', () => {
  it('is set with both dates, the party as chosen', () => {
    expect(
      exploreStay({
        arrival: '2026-11-06',
        departure: '2026-11-08',
        adults: 2,
        children: 1,
        infants: 0,
      })
    ).toEqual({
      arrival: '2026-11-06',
      departure: '2026-11-08',
      adults: 2,
      children: 1,
      infants: 0,
    });
  });

  it('asks for 1 adult while no guests are chosen, as a place page does', () => {
    expect(exploreStay({ ...NONE, arrival: '2026-11-06', departure: '2026-11-08' })).toEqual({
      arrival: '2026-11-06',
      departure: '2026-11-08',
      adults: 1,
      children: 0,
      infants: 0,
    });
  });

  it.each([
    ['no dates', NONE],
    ['only an arrival', { ...NONE, arrival: '2026-11-06' }],
    ['a departure on the arrival', { ...NONE, arrival: '2026-11-06', departure: '2026-11-06' }],
    ['a departure before the arrival', { ...NONE, arrival: '2026-11-08', departure: '2026-11-06' }],
    ['more than 30 nights', { ...NONE, arrival: '2026-11-01', departure: '2026-12-02' }],
    ['a date that is not one', { ...NONE, arrival: '2026-02-30', departure: '2026-03-02' }],
    ['no adults', { ...NONE, arrival: '2026-11-06', departure: '2026-11-08', adults: 0 }],
  ])('is not set with %s', (_, params) => {
    expect(exploreStay(params)).toBeNull();
  });

  it('allows exactly 30 nights', () => {
    expect(exploreStay({ ...NONE, arrival: '2026-11-01', departure: '2026-12-01' })).not.toBeNull();
  });
});

describe('stayKey', () => {
  it('is arrival_departure_adults_children_infants, absent counts as 0', () => {
    expect(stayKey({ arrival: '2026-11-06', departure: '2026-11-08', adults: 2 })).toBe(
      '2026-11-06_2026-11-08_2_0_0'
    );
    expect(
      stayKey({
        arrival: '2026-11-06',
        departure: '2026-11-08',
        adults: 2,
        children: 1,
        infants: 1,
      })
    ).toBe('2026-11-06_2026-11-08_2_1_1');
  });

  it('differs for every guest change, so each party is its own cache entry', () => {
    const base = { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 };
    const keys = new Set([
      stayKey(base),
      stayKey({ ...base, adults: 3 }),
      stayKey({ ...base, children: 1 }),
      stayKey({ ...base, infants: 1 }),
      stayKey({ ...base, departure: '2026-11-09' }),
    ]);
    expect(keys.size).toBe(5);
  });
});
