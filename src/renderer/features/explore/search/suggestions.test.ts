import { PARKSTAY_LOCATIONS } from '../../../../../tests/fixtures/catalog/parkstay-locations';
import {
  buildSuggestionIndex,
  matchScore,
  MAX_SUGGESTIONS,
  normalise,
  suggest,
} from './suggestions';

const index = buildSuggestionIndex(PARKSTAY_LOCATIONS);

describe('Where suggestions', () => {
  it('ranks exact, then starts-with, then word-start, then contains', () => {
    expect(matchScore('Pilbara', 'pilbara')).toBe(0);
    expect(matchScore('Pilbara', 'Pil')).toBe(1);
    expect(matchScore('Cape Range National Park', 'range')).toBe(2);
    expect(matchScore('Escape Bay', 'cape')).toBe(3);
    expect(matchScore('Lucky Bay', 'cape')).toBe(-1);
    expect(matchScore('Lucky Bay', '  ')).toBe(-1);
  });

  it('ignores case and accents', () => {
    expect(normalise('  Kalbárri ')).toBe('kalbarri');
    expect(matchScore('Kalbarri National Park', 'KALBÁRRI')).toBe(1);
  });

  it('offers the region first for "Pil", with its count', () => {
    const [first] = suggest(index, 'Pil');
    expect(first).toEqual({
      kind: 'region',
      value: 'region:Pilbara',
      label: 'Pilbara',
      description: 'Region · 39 places',
      group: 'Regions',
      target: 'Pilbara',
    });
  });

  it('groups Regions, Areas, Places in that order, 8 at most, places always present', () => {
    // "lake": no region, 4 areas and 8 places match: 3 areas, then 5 places.
    const lake = suggest(index, 'lake').map((s) => s.group);
    expect(lake).toEqual([
      'Areas',
      'Areas',
      'Areas',
      'Places',
      'Places',
      'Places',
      'Places',
      'Places',
    ]);

    const results = suggest(index, 'Cape');
    expect(results).toHaveLength(MAX_SUGGESTIONS);
    const groups = results.map((s) => s.group);
    expect(groups).toEqual([...groups].sort((a, b) => order(a) - order(b)));
    // Every place named "Cape…" is offered; the spare room goes to areas.
    const capePlaces = PARKSTAY_LOCATIONS.filter((p) => /cape/i.test(p.name)).length;
    expect(groups.filter((g) => g === 'Places')).toHaveLength(Math.min(capePlaces, 5));
    // Starts-with matches come before contains matches within a group.
    const areas = results.filter((s) => s.kind === 'area');
    expect(areas[0].label).toMatch(/^Cape /);
  });

  it('describes a place by its area and region, and targets its key', () => {
    const lucky = suggest(index, 'Lucky Bay').find((s) => s.kind === 'place');
    expect(lucky).toMatchObject({
      label: 'Lucky Bay (Cape Le Grand)',
      description: 'Cape Le Grand National Park · South Coast',
      target: expect.stringMatching(/^parkstay:\d+$/),
    });
  });

  it('gives spare room to areas and regions when few places match', () => {
    const results = suggest(index, 'South');
    expect(results.filter((s) => s.kind === 'region').map((s) => s.label)).toEqual([
      'South Coast',
      'South West',
    ]);
  });

  it('lists the regions as a starting point when nothing is typed', () => {
    const results = suggest(index, '');
    expect(results).toHaveLength(8);
    expect(results.every((s) => s.kind === 'region')).toBe(true);
    expect(results[0].label).toBe('Goldfields');
  });

  it('returns nothing for text that matches nothing', () => {
    expect(suggest(index, 'zzzz')).toEqual([]);
  });
});

function order(group: string): number {
  return ['Regions', 'Areas', 'Places'].indexOf(group);
}
