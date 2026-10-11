import { PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import {
  stayFieldDefaults,
  stayFieldIssue,
  stayFieldsFor,
  storedStayFieldValue,
  toStayParams,
} from './stayFields';

const [gear, vehicles, postcode] = PARKSTAY_MANIFEST.stayFields ?? [];

describe('stay fields', () => {
  it('picks the fields that apply to a use, by appliesTo', () => {
    expect(stayFieldsFor(PARKSTAY_MANIFEST, ['watch']).map((f) => f.key)).toEqual(['gearType']);
    expect(stayFieldsFor(PARKSTAY_MANIFEST, ['watch', 'hold']).map((f) => f.key)).toEqual([
      'gearType',
      'numVehicles',
      'postcode',
    ]);
    expect(
      stayFieldsFor(PARKSTAY_MANIFEST, ['hold'], stayFieldsFor(PARKSTAY_MANIFEST, ['watch'])).map(
        (f) => f.key
      )
    ).toEqual(['numVehicles', 'postcode']);
    expect(stayFieldsFor(undefined, ['watch'])).toEqual([]);
  });

  it('starts from the declared defaults', () => {
    expect(stayFieldDefaults([gear, vehicles, postcode])).toEqual({
      gearType: 'all',
      numVehicles: 1,
      postcode: '',
    });
  });

  it('checks values with main’s rules; empty passes unless required', () => {
    expect(stayFieldIssue(postcode, '')).toBeUndefined();
    expect(stayFieldIssue(postcode, '60')).toBe('Postcode is not in the expected format');
    expect(stayFieldIssue({ ...postcode, required: true }, '')).toBe('Postcode is required');
    expect(stayFieldIssue(vehicles, 9)).toBe('Vehicles must be at most 5');
    expect(stayFieldIssue(gear, 'tent')).toBeUndefined();
  });

  it('turns form values into stay params, leaving out empty ones and other fields', () => {
    expect(
      toStayParams([gear, postcode], { gearType: 'tent', postcode: '', numVehicles: 2 })
    ).toEqual({ gearType: 'tent' });
  });

  it('keeps a listed stored value, and replaces an old CSV gear type with a note', () => {
    expect(storedStayFieldValue(gear, 'caravan')).toEqual({ value: 'caravan' });
    expect(storedStayFieldValue(gear, undefined)).toEqual({ value: 'all' });
    expect(storedStayFieldValue(gear, 'tent,')).toEqual({
      value: 'tent',
      note: 'Camping with was saved as "Tent", which can\'t be checked any more, so it is now Tent.',
    });
    expect(storedStayFieldValue(gear, 'tent,caravan')).toEqual({
      value: 'all',
      note: 'Camping with was saved as "Tent, Caravan", which can\'t be checked any more, so it is now Any.',
    });
    expect(storedStayFieldValue(gear, 'cabin').value).toBe('all');
  });
});
