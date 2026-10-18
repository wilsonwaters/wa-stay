/**
 * Unit nouns (R9): one noun for every unit kind, "spot" for mixed, `other` or no kinds, and the
 * order copy takes its kinds in (the units it is about, the watch's or snipe's stay types, the
 * place's, the provider's default).
 */

import type { ProviderManifest } from '@shared/types/provider.types';
import {
  capitalise,
  kindsOfUnits,
  MIXED_UNIT_NOUN,
  nounForKinds,
  nounOfUnits,
  providerUnitKinds,
  unitCountLabel,
  unitNounFrom,
} from '@shared/utils/unit-noun';

describe('nounForKinds', () => {
  it.each([
    ['campsite', 'site', 'sites'],
    ['cabin', 'cabin', 'cabins'],
    ['room', 'room', 'rooms'],
    ['dorm', 'bunk', 'bunks'],
    ['glamping', 'tent', 'tents'],
  ])('names units that are all %s "%s" / "%s"', (kind, one, many) => {
    expect(nounForKinds([kind])).toEqual({ one, many });
  });

  it('reads "spot" for other, for more than one kind (other counts as one), and for none', () => {
    const spot = { one: 'spot', many: 'spots' };
    expect(nounForKinds(['other'])).toEqual(spot);
    expect(nounForKinds(['campsite', 'cabin'])).toEqual(spot);
    expect(nounForKinds(['cabin', 'other'])).toEqual(spot);
    expect(nounForKinds([])).toEqual(spot);
    expect(nounForKinds(undefined)).toEqual(spot);
    expect(MIXED_UNIT_NOUN).toEqual(spot);
  });

  it('leaves out repeats and values that are not unit kinds', () => {
    expect(nounForKinds(['cabin', 'cabin', 'castle', 7])).toEqual({ one: 'cabin', many: 'cabins' });
  });

  it('returns a copy each time, so a caller cannot change the next answer', () => {
    const noun = nounForKinds(['other']);
    noun.one = 'changed';
    expect(nounForKinds(['other']).one).toBe('spot');
  });
});

describe('kindsOfUnits', () => {
  it('lists the kinds of the units, in order, without repeats', () => {
    expect(
      kindsOfUnits([{ unitKind: 'cabin' }, { unitKind: 'campsite' }, { unitKind: 'cabin' }])
    ).toEqual(['cabin', 'campsite']);
  });

  it('counts a unit with no kind as other, as matching does, when another unit has one', () => {
    expect(kindsOfUnits([{ unitKind: 'cabin' }, {}])).toEqual(['cabin', 'other']);
  });

  it('has none when no unit says its kind (a check stored before kinds), or for no units', () => {
    expect(kindsOfUnits([{}, { unitKind: 'castle' }])).toEqual([]);
    expect(kindsOfUnits([])).toEqual([]);
    expect(kindsOfUnits(undefined)).toEqual([]);
  });
});

describe('providerUnitKinds', () => {
  const manifest = (locationKinds: ProviderManifest['locationKinds']) => ({ locationKinds });

  it('is what the provider’s first location kind offers', () => {
    expect(providerUnitKinds(manifest(['campground', 'hut']))).toEqual(['campsite']);
    expect(providerUnitKinds(manifest(['hut']))).toEqual(['dorm']);
    expect(providerUnitKinds(manifest(['holiday-park']))).toEqual(['campsite', 'cabin']);
  });

  it('is none for an unknown provider', () => {
    expect(providerUnitKinds(undefined)).toEqual([]);
    expect(providerUnitKinds(manifest([]))).toEqual([]);
  });
});

describe('unitNounFrom', () => {
  it('takes the first source with a kind: units, then stay types, place and provider', () => {
    expect(unitNounFrom(['cabin'], ['campsite'], ['room'], ['dorm']).many).toBe('cabins');
    expect(unitNounFrom([], ['room'], ['campsite'], ['dorm']).many).toBe('rooms');
    expect(unitNounFrom(undefined, [], ['dorm'], ['campsite']).many).toBe('bunks');
    expect(unitNounFrom([], [], [], ['campsite']).many).toBe('sites');
  });

  it('reads "spot" for matched units of several kinds, whatever comes after', () => {
    expect(unitNounFrom(['campsite', 'cabin'], ['campsite'], ['campsite']).one).toBe('spot');
  });

  it('skips a source with nothing it knows, and reads "spot" with no kinds anywhere', () => {
    expect(unitNounFrom(['castle'], ['glamping']).one).toBe('tent');
    expect(unitNounFrom()).toEqual({ one: 'spot', many: 'spots' });
    expect(unitNounFrom(undefined, null, [])).toEqual({ one: 'spot', many: 'spots' });
  });
});

describe('nounOfUnits', () => {
  it('names units by their kinds, else gives the fallback noun', () => {
    const sites = nounForKinds(['campsite']);
    expect(nounOfUnits([{ unitKind: 'cabin' }], sites).many).toBe('cabins');
    expect(nounOfUnits([{ unitKind: 'cabin' }, { unitKind: 'room' }], sites).many).toBe('spots');
    expect(nounOfUnits([{}], sites)).toBe(sites);
    expect(nounOfUnits(undefined, sites)).toBe(sites);
  });
});

describe('unitCountLabel and capitalise', () => {
  it('counts one and many, and capitalises the start of a sentence', () => {
    const cabin = nounForKinds(['cabin']);
    expect(unitCountLabel(1, cabin)).toBe('1 cabin');
    expect(unitCountLabel(3, cabin)).toBe('3 cabins');
    expect(unitCountLabel(0, nounForKinds([]))).toBe('0 spots');
    expect(capitalise(cabin.one)).toBe('Cabin');
  });
});
