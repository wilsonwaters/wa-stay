import { PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import type { UnitKind } from '../../../../shared/types/provider.types';
import { emptySnipeForm, snipeFormSchema, stepFields, type SnipeFormValues } from './snipeForm';

const NOW = new Date('2099-12-01T02:00:00Z');
const valid = (overrides: Partial<SnipeFormValues> = {}): SnipeFormValues => ({
  ...emptySnipeForm(PARKSTAY_MANIFEST),
  location: { externalId: '20', name: 'Lucky Bay' },
  arrival: '2099-12-11',
  departure: '2099-12-13',
  stayParams: { gearType: 'all', numVehicles: 1, postcode: '6000' },
  name: 'Lucky Bay',
  ...overrides,
});
const issues = (values: SnipeFormValues, placeKinds?: UnitKind[]) => {
  const result = snipeFormSchema({
    manifest: PARKSTAY_MANIFEST,
    today: '2099-12-01',
    now: NOW,
    placeKinds,
    noun: { one: 'site', many: 'sites' },
  }).safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('snipeFormSchema: a stay type or a unit at a mixed place', () => {
  it('refuses a snipe with neither, since it always holds', () => {
    expect(issues(valid(), ['campsite', 'cabin'])).toEqual({
      unitKinds:
        'Choose a stay type or a site. At a place with more than one stay type, Site Sniper holds only what you choose.',
    });
    expect(issues(valid(), ['campsite', 'other'])).toHaveProperty('unitKinds');
  });

  it('accepts one with a stay type or a unit', () => {
    expect(issues(valid({ unitKinds: ['cabin'] }), ['campsite', 'cabin'])).toEqual({});
    expect(issues(valid({ unitIds: ['12'] }), ['campsite', 'cabin'])).toEqual({});
  });

  it('asks nothing at a place of one kind, or before the place’s units are known', () => {
    expect(issues(valid(), ['campsite'])).toEqual({});
    expect(issues(valid(), undefined)).toEqual({});
  });

  it('checks it on the Stay step', () => {
    expect(stepFields('stay', PARKSTAY_MANIFEST)).toEqual([
      'arrival',
      'departure',
      'adults',
      'stayParams.gearType',
      'stayParams.numVehicles',
      'stayParams.postcode',
      'unitKinds',
    ]);
  });
});
