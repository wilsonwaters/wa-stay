import { FAKE_MANIFEST, PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import {
  intervalLabel,
  intervalOptions,
  parsePrice,
  stepFields,
  watchFormSchema,
  type WatchFormValues,
} from './watchFormSchema';
import { emptyWatchForm } from './watchFormMapping';

const TODAY = '2099-12-01';
const valid = (overrides: Partial<WatchFormValues> = {}): WatchFormValues => ({
  ...emptyWatchForm(PARKSTAY_MANIFEST),
  location: { externalId: '20', name: 'Osprey Bay' },
  arrival: '2099-12-11',
  departure: '2099-12-13',
  name: 'Osprey Bay',
  ...overrides,
});
const issues = (values: WatchFormValues, keepArrival?: string) => {
  const result = watchFormSchema({
    manifest: PARKSTAY_MANIFEST,
    today: TODAY,
    keepArrival,
  }).safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('watchFormSchema', () => {
  it('accepts a complete form with no unit or unit type chosen and no max price', () => {
    expect(issues(valid())).toEqual({});
  });

  it("treats an empty max price as no limit; 'abc' and 0 are errors (never NaN)", () => {
    expect(issues(valid({ maxPrice: '' }))).toEqual({});
    expect(issues(valid({ maxPrice: '40.50' }))).toEqual({});
    expect(issues(valid({ maxPrice: 'abc' }))).toEqual({
      maxPrice: 'Enter a price in dollars, like 40, or leave it empty',
    });
    expect(issues(valid({ maxPrice: '0' }))).toHaveProperty('maxPrice');
    expect(parsePrice('$35')).toBe(35);
    expect(parsePrice('')).toBeUndefined();
  });

  it('needs a location, dates in order and not in the past, and an adult', () => {
    expect(issues(valid({ location: null, arrival: '', adults: 0 }))).toEqual({
      location: 'Choose a location',
      arrival: 'Choose your check-in and check-out dates',
      adults: 'Add at least 1 adult',
    });
    expect(issues(valid({ arrival: '2099-11-30' }))).toEqual({
      arrival: "Check-in can't be in the past",
    });
    expect(issues(valid({ departure: '2099-12-11' }))).toEqual({
      departure: 'Choose a check-out date after check-in',
    });
  });

  it('lets an edit keep a stored arrival that has passed', () => {
    expect(issues(valid({ arrival: '2099-11-30' }), '2099-11-30')).toEqual({});
  });

  it('checks the provider’s stay fields, and the hold fields only with auto-hold', () => {
    const postcode = { ...valid().stayParams, postcode: '60' };
    expect(issues(valid({ stayParams: postcode }))).toEqual({});
    expect(issues(valid({ stayParams: postcode, autoHold: true }))).toEqual({
      'stayParams.postcode': 'Postcode is not in the expected format',
    });
  });

  it('accepts an edited watch’s stored interval the list no longer has, and only that one', () => {
    const legacy = valid({ checkIntervalMinutes: 5 });
    expect(issues(legacy)).toHaveProperty('checkIntervalMinutes');
    const result = watchFormSchema({
      manifest: PARKSTAY_MANIFEST,
      today: TODAY,
      keepInterval: 5,
    }).safeParse(legacy);
    expect(result.success).toBe(true);
    expect(intervalOptions(PARKSTAY_MANIFEST, 5)).toEqual([5, 15, 30, 60, 240, 720, 1440]);
    expect(intervalOptions(PARKSTAY_MANIFEST, 60)).toEqual([15, 30, 60, 240, 720, 1440]);
    expect(intervalLabel(5, PARKSTAY_MANIFEST)).toBe('Every 5 minutes (checks run every 15)');
    expect(intervalLabel(15, PARKSTAY_MANIFEST)).toBe('Every 15 minutes');
  });

  it('wants a name and a contract interval', () => {
    expect(issues(valid({ name: '  ', checkIntervalMinutes: 5 }))).toEqual({
      name: 'Give the watch a name',
      checkIntervalMinutes: 'Choose how often to check',
    });
  });
});

describe('watch form options', () => {
  it('offers the contract intervals the provider allows', () => {
    expect(intervalOptions(PARKSTAY_MANIFEST)).toEqual([15, 30, 60, 240, 720, 1440]);
    expect(
      intervalOptions({
        ...FAKE_MANIFEST,
        limits: { minWatchIntervalMinutes: 60, maxConcurrentRequests: 1, catalogTtlHours: 24 },
      })
    ).toEqual([60, 240, 720, 1440]);
    expect([15, 60, 240, 1440].map(intervalLabel)).toEqual([
      'Every 15 minutes',
      'Every hour',
      'Every 4 hours',
      'Once a day',
    ]);
  });

  it('names the fields each step checks', () => {
    expect(stepFields('stay', PARKSTAY_MANIFEST, false)).toEqual([
      'arrival',
      'departure',
      'adults',
      'stayParams.gearType',
      'maxPrice',
    ]);
    expect(stepFields('alerts', PARKSTAY_MANIFEST, true)).toEqual([
      'checkIntervalMinutes',
      'stayParams.numVehicles',
      'stayParams.postcode',
    ]);
    expect(stepFields('alerts', FAKE_MANIFEST, true)).toEqual(['checkIntervalMinutes']);
  });
});
