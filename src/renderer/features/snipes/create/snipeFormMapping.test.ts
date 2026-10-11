import { SnipeReleaseMode } from '../../../../shared/types/common.types';
import { PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import { parseSnipePrefill } from './prefill';
import { emptySnipeForm } from './snipeForm';
import {
  issueField,
  minutesToMs,
  msToMinutes,
  msToSeconds,
  secondsToMs,
  toSnipeInput,
} from './snipeFormMapping';

const filled = () => ({
  ...emptySnipeForm(PARKSTAY_MANIFEST),
  location: { externalId: '20', name: 'Bungarra' },
  arrival: '2099-12-11',
  departure: '2099-12-13',
  name: 'Bungarra',
});

describe('timing conversions', () => {
  it('turns seconds and minutes into the contract’s ms, and back', () => {
    expect(secondsToMs(0.5)).toBe(500);
    expect(secondsToMs(1.5)).toBe(1500);
    expect(minutesToMs(15)).toBe(900_000);
    expect(msToSeconds(1500)).toBe(1.5);
    expect(msToMinutes(900_000)).toBe(15);
  });

  it('starts the form at the app’s defaults', () => {
    const form = emptySnipeForm(PARKSTAY_MANIFEST);
    expect(form).toMatchObject({
      releaseMode: 'daily_rollover',
      leadTimeSeconds: '120',
      pollIntervalSeconds: '1.5',
      windowMinutes: '15',
      maxAttempts: '0',
      accessGateEnabled: true,
    });
  });
});

describe('toSnipeInput', () => {
  it('leaves out lead time and the window for a cancellation snipe, and the queue it cannot use', () => {
    const input = toSnipeInput(
      { ...filled(), releaseMode: SnipeReleaseMode.CANCELLATION },
      PARKSTAY_MANIFEST
    );
    expect(input).not.toHaveProperty('leadTimeSeconds');
    expect(input).not.toHaveProperty('windowDurationMs');
    expect(input).not.toHaveProperty('releaseAt');
    expect(input.accessGateEnabled).toBe(false);
    expect(input.pollIntervalMs).toBe(1500);
  });
});

describe('issueField', () => {
  it('maps main’s issue paths to the form’s fields', () => {
    expect(issueField('releaseAt', 'scheduled')).toBe('releaseDate');
    // A computed release the provider could not work out: the visible mode control, never the
    // hidden date field.
    expect(issueField('releaseAt', 'daily_rollover')).toBe('releaseMode');
    expect(issueField('releaseMode')).toBe('releaseMode');
    expect(issueField('stay.departure')).toBe('departure');
    expect(issueField('stay')).toBe('arrival');
    expect(issueField('stayParams.postcode')).toBe('stayParams.postcode');
    expect(issueField('pollIntervalMs')).toBe('pollIntervalSeconds');
    expect(issueField('somethingElse')).toBeUndefined();
  });
});

describe('parseSnipePrefill', () => {
  const now = new Date('2026-10-02T02:00:00Z');

  it('takes a ParkStay link’s place, dates and guests', () => {
    expect(
      parseSnipePrefill(
        '?provider=parkstay&location=20&arrival=2027-04-10&departure=2027-04-12&adults=3&children=1',
        [PARKSTAY_MANIFEST],
        now
      )
    ).toEqual({
      providerId: 'parkstay',
      locationId: '20',
      arrival: '2027-04-10',
      departure: '2027-04-12',
      adults: 3,
      children: 1,
      notices: [],
    });
  });

  it('drops a provider without Site Sniper, and dates that have passed', () => {
    const noSnipes = {
      ...PARKSTAY_MANIFEST,
      capabilities: { ...PARKSTAY_MANIFEST.capabilities, snipes: false },
    };
    const prefill = parseSnipePrefill(
      '?provider=parkstay&location=20&arrival=2026-09-01&departure=2026-09-03',
      [noSnipes],
      now
    );
    expect(prefill.providerId).toBeUndefined();
    expect(prefill.notices).toEqual([
      "ParkStay doesn't offer Site Sniper, so choose a provider.",
      "The link's place couldn't be used, so choose a location.",
      "The link's dates couldn't be used (they have passed or are out of order), so choose your dates.",
    ]);
  });
});
