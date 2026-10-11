import type { StayQuery } from '@shared/types/provider.types';
import { stayKeyFor } from '@shared/utils/stay-key';

const STAY: StayQuery = { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 };
const PARKSTAY_FIELDS = ['arrival', 'departure', 'equipment', 'params.gearType'] as const;

describe('stayKeyFor', () => {
  it('ignores what the fields leave out: the guests, for a provider that reads only dates and gear', () => {
    const base = stayKeyFor(STAY, PARKSTAY_FIELDS);
    expect(stayKeyFor({ ...STAY, adults: 4, children: 2, infants: 1 }, PARKSTAY_FIELDS)).toBe(base);
    expect(stayKeyFor({ ...STAY, params: { postcode: '6000' } }, PARKSTAY_FIELDS)).toBe(base);
  });

  it('changes with each field it keys by', () => {
    const base = stayKeyFor(STAY, PARKSTAY_FIELDS);
    expect(stayKeyFor({ ...STAY, departure: '2026-11-09' }, PARKSTAY_FIELDS)).not.toBe(base);
    expect(stayKeyFor({ ...STAY, equipment: 'tent' }, PARKSTAY_FIELDS)).not.toBe(base);
    expect(stayKeyFor({ ...STAY, params: { gearType: 'caravan' } }, PARKSTAY_FIELDS)).not.toBe(
      base
    );
  });

  it('keys by every field and param when given none, absent counts as 0', () => {
    const base = stayKeyFor(STAY);
    expect(stayKeyFor({ ...STAY, children: 0, infants: 0, concessions: 0 })).toBe(base);
    expect(stayKeyFor({ ...STAY, adults: 3 })).not.toBe(base);
    expect(stayKeyFor({ ...STAY, params: { postcode: '6000' } })).not.toBe(base);
  });

  it('does not depend on the order the fields are given in', () => {
    expect(stayKeyFor(STAY, ['departure', 'arrival'])).toBe(
      stayKeyFor(STAY, ['arrival', 'departure'])
    );
  });
});
