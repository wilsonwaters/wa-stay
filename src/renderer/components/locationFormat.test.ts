import { unitCountLabel, unitNoun, unitPeopleLabel, unitVehiclesLabel } from './locationFormat';

describe('locationFormat units', () => {
  it('names a location’s units by its kind, with "unit" for anything unknown', () => {
    expect(unitNoun('campground')).toEqual({ one: 'site', many: 'sites' });
    expect(unitNoun('cabin')).toEqual({ one: 'cabin', many: 'cabins' });
    expect(unitNoun('spaceport')).toEqual({ one: 'unit', many: 'units' });
    expect(unitNoun(undefined)).toEqual({ one: 'unit', many: 'units' });
    expect(unitCountLabel('campground', 1)).toBe('1 site');
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
