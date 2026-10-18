import {
  holdNeedsChoice,
  isMixedPlace,
  placeUnitKinds,
  reconcileStayTypes,
  stayTypeLabel,
  stayTypeOptions,
  stayTypesText,
} from './stayTypes';

describe('placeUnitKinds and isMixedPlace', () => {
  it('lists each kind once, in stay-type order, a unit with no kind (or an unknown one) as other', () => {
    const units = [
      { unitKind: 'cabin' },
      {},
      { unitKind: 'campsite' },
      { unitKind: 'castle' },
      { unitKind: 'cabin' },
    ];
    expect(placeUnitKinds(units)).toEqual(['campsite', 'cabin', 'other']);
  });

  it('is mixed with two or more kinds, other included; not with one kind or none', () => {
    expect(isMixedPlace(['campsite', 'cabin'])).toBe(true);
    expect(isMixedPlace(['campsite', 'other'])).toBe(true);
    expect(isMixedPlace(['campsite'])).toBe(false);
    expect(isMixedPlace(['other'])).toBe(false);
    expect(isMixedPlace([])).toBe(false);
    expect(isMixedPlace(undefined)).toBe(false);
  });
});

describe('stayTypeOptions', () => {
  it('offers a mixed place’s kinds without other, in order', () => {
    expect(stayTypeOptions(['campsite', 'dorm', 'other'], [])).toEqual(['campsite', 'dorm']);
    expect(stayTypeOptions(['campsite', 'other'], [])).toEqual(['campsite']);
  });

  it('offers nothing at a place with one kind, or only other units, or none', () => {
    expect(stayTypeOptions(['campsite'], [])).toEqual([]);
    expect(stayTypeOptions(['other'], [])).toEqual([]);
    expect(stayTypeOptions([], [])).toEqual([]);
  });

  it('keeps a chosen kind on offer even when the place does not have it', () => {
    expect(stayTypeOptions(['campsite'], ['cabin'])).toEqual(['cabin']);
    expect(stayTypeOptions(['room', 'campsite'], ['glamping'])).toEqual([
      'campsite',
      'room',
      'glamping',
    ]);
  });
});

describe('stayTypeLabel and stayTypesText', () => {
  it('reads a choice in stay-type order, "Any" for none, and other as "Other"', () => {
    expect(stayTypeLabel('cabin')).toBe('Cabins & villas');
    expect(stayTypeLabel('other')).toBe('Other');
    expect(stayTypesText(['room', 'cabin'])).toBe('Cabins & villas, Rooms');
    expect(stayTypesText([])).toBe('Any');
  });
});

describe('holdNeedsChoice', () => {
  const mixed = ['campsite', 'cabin'] as const;

  it('needs a stay type or a unit at a mixed place', () => {
    expect(holdNeedsChoice([...mixed], [], [])).toBe(true);
    expect(holdNeedsChoice(['campsite', 'other'], [], [])).toBe(true);
  });

  it('is satisfied by one stay type, or by units', () => {
    expect(holdNeedsChoice([...mixed], ['cabin'], [])).toBe(false);
    expect(holdNeedsChoice(['campsite', 'other'], ['campsite'], [])).toBe(false);
    expect(holdNeedsChoice([...mixed], [], ['12'])).toBe(false);
  });

  it('still needs one when the chosen stay types are several kinds the place has, as main decides', () => {
    expect(holdNeedsChoice(['campsite', 'cabin', 'dorm'], ['campsite', 'cabin'], [])).toBe(true);
    expect(holdNeedsChoice(['campsite', 'cabin'], ['cabin', 'room'], [])).toBe(false);
  });

  it('never needs one at a place with one kind', () => {
    expect(holdNeedsChoice(['campsite'], [], [])).toBe(false);
    expect(holdNeedsChoice([], [], [])).toBe(false);
  });
});

describe('reconcileStayTypes', () => {
  it('keeps the link’s stay types the place has', () => {
    expect(reconcileStayTypes(['cabin', 'room'], ['campsite', 'cabin'], 'Lucky Bay')).toEqual({
      unitKinds: ['cabin'],
    });
  });

  it('clears them with a notice at a mixed place with none of them', () => {
    expect(reconcileStayTypes(['cabin'], ['campsite', 'dorm'], 'Lucky Bay')).toEqual({
      unitKinds: [],
      notice: 'Lucky Bay has no Cabins & villas, so choose a stay type.',
    });
    expect(reconcileStayTypes(['room', 'cabin'], ['campsite', 'other'], 'Lucky Bay')).toEqual({
      unitKinds: [],
      notice: 'Lucky Bay has no Cabins & villas or Rooms, so choose a stay type.',
    });
  });

  it('clears them silently at a place with one kind, or none chosen', () => {
    expect(reconcileStayTypes(['cabin'], ['campsite'], 'Osprey Bay')).toEqual({ unitKinds: [] });
    expect(reconcileStayTypes(['cabin'], [], 'Osprey Bay')).toEqual({ unitKinds: [] });
    expect(reconcileStayTypes([], ['campsite', 'cabin'], 'Lucky Bay')).toEqual({ unitKinds: [] });
  });
});
