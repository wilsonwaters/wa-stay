import { placeNoun, unitCountLabel, unitPeopleLabel, unitVehiclesLabel } from './locationFormat';

describe('placeNoun', () => {
  const PARKSTAY = { locationKinds: ['campground' as const] };

  it('names a place’s units by the kinds its units say, where they are loaded', () => {
    const units = [
      { unitId: '1', unitName: 'Cabin 1', unitKind: 'cabin' as const },
      { unitId: '2', unitName: 'Cabin 2', unitKind: 'cabin' as const },
    ];
    expect(placeNoun({ kind: 'campground', units }, PARKSTAY)).toEqual({
      one: 'cabin',
      many: 'cabins',
    });
    expect(
      placeNoun({ kind: 'holiday-park', units: [...units, { unitId: '3', unitName: 'Site 3' }] })
    ).toEqual({ one: 'spot', many: 'spots' });
  });

  it('else by its own unit kinds or its kind’s; else its provider’s; else "spot"', () => {
    expect(placeNoun({ kind: 'campground' })).toEqual({ one: 'site', many: 'sites' });
    // Units that say no kind: the place's
    expect(placeNoun({ kind: 'hut', units: [{ unitId: '1', unitName: 'Hut' }] }).many).toBe(
      'bunks'
    );
    expect(placeNoun({ kind: 'holiday-park', unitKinds: ['room'] }).many).toBe('rooms');
    expect(placeNoun({ kind: 'holiday-park' }).many).toBe('spots');
    expect(placeNoun(undefined, PARKSTAY).many).toBe('sites');
    expect(placeNoun(undefined).many).toBe('spots');
    expect(unitCountLabel(1, placeNoun({ kind: 'campground' }))).toBe('1 site');
  });
});

describe('unit limits', () => {
  it('says how many people a unit takes, compactly', () => {
    expect(unitPeopleLabel({ minPeople: 1, maxPeople: 6 })).toBe('1–6 people');
    expect(unitPeopleLabel({ minPeople: 4, maxPeople: 4 })).toBe('4 people');
    expect(unitPeopleLabel({ minPeople: 1, maxPeople: 1 })).toBe('1 person');
    expect(unitPeopleLabel({ maxPeople: 8 })).toBe('Up to 8 people');
    expect(unitPeopleLabel({ minPeople: 2 })).toBe('At least 2 people');
    // Bad data says nothing rather than something wrong.
    expect(unitPeopleLabel({ minPeople: 8, maxPeople: 4 })).toBe('Up to 4 people');
    expect(unitPeopleLabel({ minPeople: 0, maxPeople: 0 })).toBeUndefined();
    expect(unitPeopleLabel({})).toBeUndefined();
  });

  it('says how many vehicles a unit takes', () => {
    expect(unitVehiclesLabel({ maxVehicles: 3 })).toBe('3 vehicles');
    expect(unitVehiclesLabel({ maxVehicles: 1 })).toBe('1 vehicle');
    expect(unitVehiclesLabel({ maxVehicles: 0 })).toBe('No vehicles');
    expect(unitVehiclesLabel({ maxVehicles: 1.5 })).toBeUndefined();
    expect(unitVehiclesLabel({})).toBeUndefined();
  });
});
