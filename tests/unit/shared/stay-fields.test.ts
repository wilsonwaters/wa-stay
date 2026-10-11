import fs from 'fs';
import path from 'path';
import { stayFieldProblem } from '@shared/utils/stay-fields';
import type { StayFieldDescriptor } from '@shared/types/provider.types';

const gear: StayFieldDescriptor = {
  key: 'gearType',
  label: 'Camping with',
  type: 'select',
  options: [
    { value: 'all', label: 'Any' },
    { value: 'tent', label: 'Tent' },
  ],
  appliesTo: ['watch'],
};
const vehicles: StayFieldDescriptor = {
  key: 'numVehicles',
  label: 'Vehicles',
  type: 'number',
  min: 0,
  max: 5,
  appliesTo: ['hold'],
};
const postcode: StayFieldDescriptor = {
  key: 'postcode',
  label: 'Postcode',
  type: 'text',
  pattern: '\\d{4}',
  appliesTo: ['hold'],
};
const powered: StayFieldDescriptor = {
  key: 'powered',
  label: 'Powered site',
  type: 'boolean',
  appliesTo: ['watch'],
};

describe('stayFieldProblem (shared by main and the renderer)', () => {
  it('accepts a listed select option and names the options otherwise', () => {
    expect(stayFieldProblem(gear, 'tent')).toBeUndefined();
    expect(stayFieldProblem(gear, 'tent,caravan')).toBe('Camping with must be one of Any, Tent');
    expect(stayFieldProblem(gear, 3)).toBe('Camping with must be one of the listed options');
  });

  it('checks a number is finite and in range', () => {
    expect(stayFieldProblem(vehicles, 2)).toBeUndefined();
    expect(stayFieldProblem(vehicles, -1)).toBe('Vehicles must be at least 0');
    expect(stayFieldProblem(vehicles, 6)).toBe('Vehicles must be at most 5');
    expect(stayFieldProblem(vehicles, Number.NaN)).toBe('Vehicles must be a number');
  });

  it('matches the whole text against the pattern', () => {
    expect(stayFieldProblem(postcode, '6000')).toBeUndefined();
    expect(stayFieldProblem(postcode, '60001')).toBe('Postcode is not in the expected format');
    expect(stayFieldProblem(postcode, 6000)).toBe('Postcode must be text');
  });

  it('wants a real boolean for a yes/no field', () => {
    expect(stayFieldProblem(powered, false)).toBeUndefined();
    expect(stayFieldProblem(powered, 'yes')).toBe('Powered site must be yes or no');
  });

  it('has no node or electron imports, so the renderer can use it', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../../src/shared/utils/stay-fields.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/from '(?:node:)?(?:fs|path|electron|os)'/);
    expect(source).not.toMatch(/@main\//);
  });
});
