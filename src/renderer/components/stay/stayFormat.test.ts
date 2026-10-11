import { partyLabel, stayNightsLabel, stayDatesLabel } from './stayFormat';

describe('stayFormat', () => {
  it('writes a stay inside one month as "Fri 11 – Sun 13 Dec"', () => {
    expect(stayDatesLabel('2026-12-11', '2026-12-13', '2026-10-09')).toBe('Fri 11 – Sun 13 Dec');
  });

  it('names both months across a month end', () => {
    expect(stayDatesLabel('2026-10-30', '2026-11-02', '2026-10-09')).toBe('Fri 30 Oct – Mon 2 Nov');
  });

  it('adds the year for another year, and on both ends across a new year', () => {
    expect(stayDatesLabel('2027-01-08', '2027-01-10', '2026-10-09')).toBe(
      'Fri 8 – Sun 10 Jan 2027'
    );
    expect(stayDatesLabel('2026-12-30', '2027-01-01', '2026-10-09')).toBe(
      'Wed 30 Dec 2026 – Fri 1 Jan 2027'
    );
  });

  it('counts nights and people', () => {
    expect(stayNightsLabel('2026-12-11', '2026-12-13')).toBe('2 nights');
    expect(stayNightsLabel('2026-12-11', '2026-12-12')).toBe('1 night');
    expect(partyLabel({ adults: 2, children: 1 })).toBe('2 adults, 1 child');
    expect(partyLabel({ adults: 1, concessions: 2 })).toBe('1 adult, 2 concessions');
    expect(partyLabel({ adults: 0 })).toBe('No guests');
  });
});
