import { ALERT_ONLY_MANIFEST } from '@tests/fixtures/renderer/snipes';
import { PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import { SnipeReleaseMode } from '../../../../shared/types/common.types';
import type { ProviderManifest, UnitKind } from '../../../../shared/types/provider.types';
import { defaultSnipeAction, windowCapMinutes } from './snipeAction';
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
const issuesFor = (
  manifest: ProviderManifest,
  values: SnipeFormValues,
  placeKinds?: UnitKind[]
) => {
  const result = snipeFormSchema({
    manifest,
    today: '2099-12-01',
    now: NOW,
    placeKinds,
    noun: { one: 'site', many: 'sites' },
  }).safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message]));
};
const issues = (values: SnipeFormValues, placeKinds?: UnitKind[]) =>
  issuesFor(PARKSTAY_MANIFEST, values, placeKinds);

describe('snipeFormSchema: a stay type or a unit at a mixed place, to hold', () => {
  it('refuses a snipe that holds with neither, on its action (the Release step)', () => {
    expect(issues(valid(), ['campsite', 'cabin'])).toEqual({
      action:
        'Lucky Bay has more than one stay type. To hold one, choose a stay type or a site under "Your stay", or choose Alert me.',
    });
    expect(issues(valid(), ['campsite', 'other'])).toHaveProperty('action');
  });

  it('asks nothing of a snipe that alerts', () => {
    expect(issues(valid({ action: 'alert' }), ['campsite', 'cabin'])).toEqual({});
  });

  it('accepts one that holds with a stay type or a unit', () => {
    expect(issues(valid({ unitKinds: ['cabin'] }), ['campsite', 'cabin'])).toEqual({});
    expect(issues(valid({ unitIds: ['12'] }), ['campsite', 'cabin'])).toEqual({});
  });

  it('asks nothing at a place of one kind, or before the place’s units are known', () => {
    expect(issues(valid(), ['campsite'])).toEqual({});
    expect(issues(valid(), undefined)).toEqual({});
  });

  it('checks it on the Release step, with the action; the Stay step no longer does', () => {
    expect(stepFields('stay', PARKSTAY_MANIFEST)).toEqual([
      'arrival',
      'departure',
      'adults',
      'stayParams.gearType',
      'stayParams.numVehicles',
      'stayParams.postcode',
    ]);
    expect(stepFields('release', PARKSTAY_MANIFEST)).toEqual([
      'releaseMode',
      'releaseDate',
      'action',
      'leadTimeSeconds',
      'pollIntervalSeconds',
      'windowMinutes',
      'maxAttempts',
    ]);
  });
});

describe('the action a new snipe starts with', () => {
  it('holds where the provider places holds (ParkStay), and alerts where it does not', () => {
    expect(defaultSnipeAction(PARKSTAY_MANIFEST)).toBe('hold');
    expect(emptySnipeForm(PARKSTAY_MANIFEST).action).toBe('hold');
    expect(defaultSnipeAction(ALERT_ONLY_MANIFEST)).toBe('alert');
    expect(emptySnipeForm(ALERT_ONLY_MANIFEST).action).toBe('alert');
    expect(emptySnipeForm(undefined).action).toBe('alert');
  });
});

describe('snipeFormSchema: the release mode’s limit on the window', () => {
  const capped = (overrides: Partial<SnipeFormValues>, releaseMode = 'daily_rollover') =>
    issuesFor(
      ALERT_ONLY_MANIFEST,
      valid({ action: 'alert', stayParams: {}, releaseMode, ...overrides })
    );

  it('names the limit of the chosen mode', () => {
    expect(windowCapMinutes(ALERT_ONLY_MANIFEST, 'daily_rollover')).toBe(30);
    expect(windowCapMinutes(ALERT_ONLY_MANIFEST, 'scheduled')).toBeUndefined();
    expect(windowCapMinutes(PARKSTAY_MANIFEST, 'daily_rollover')).toBeUndefined();
  });

  it('refuses more than the limit, in the provider’s words, and takes the limit itself', () => {
    expect(capped({ windowMinutes: '45' })).toEqual({
      windowMinutes: 'Alert Stay allows at most 30 minutes',
    });
    expect(capped({ windowMinutes: '30' })).toEqual({});
    // The default (15 minutes) is within it
    expect(capped({})).toEqual({});
  });

  it('applies only to the mode that sets it, and never to a cancellation snipe', () => {
    expect(
      capped({ windowMinutes: '45', releaseDate: '2099-12-05', releaseTime: '10:00' }, 'scheduled')
    ).toEqual({});
    expect(
      issues(valid({ windowMinutes: '1440', releaseMode: SnipeReleaseMode.CANCELLATION }))
    ).toEqual({});
  });
});
