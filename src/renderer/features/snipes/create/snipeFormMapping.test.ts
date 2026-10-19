import { SnipeReleaseMode } from '../../../../shared/types/common.types';
import { PARKSTAY_MANIFEST, ROTTNEST_MANIFEST } from '@tests/utils/renderer/manifests';
import { parseSnipePrefill } from './prefill';
import { emptySnipeForm } from './snipeForm';
import {
  actionFor,
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

  it('sends what the snipe does when the dates are free, always', () => {
    expect(toSnipeInput(filled(), PARKSTAY_MANIFEST).action).toBe('hold');
    expect(toSnipeInput({ ...filled(), action: 'alert' }, PARKSTAY_MANIFEST).action).toBe('alert');
  });

  it('sends the chosen stay types, and nothing for any', () => {
    expect(
      toSnipeInput({ ...filled(), unitKinds: ['cabin', 'room'] }, PARKSTAY_MANIFEST)
    ).toMatchObject({ unitKinds: ['cabin', 'room'] });
    expect(toSnipeInput(filled(), PARKSTAY_MANIFEST)).not.toHaveProperty('unitKinds');
  });
});

describe('an Open Day plan (a mode that only reminds)', () => {
  it('starts as a plan, and sends action remind with no timing', () => {
    const form = {
      ...emptySnipeForm(ROTTNEST_MANIFEST),
      location: { externalId: 'geordie-bay', name: 'Geordie Bay' },
      arrival: '2099-07-06',
      departure: '2099-07-08',
      name: 'Geordie Bay in July',
    };
    expect(form).toMatchObject({ releaseMode: 'open_day', action: 'remind' });
    const input = toSnipeInput(form, ROTTNEST_MANIFEST);
    expect(input).toMatchObject({ releaseMode: 'open_day', action: 'remind' });
    for (const key of ['leadTimeSeconds', 'pollIntervalMs', 'windowDurationMs', 'maxAttempts']) {
      expect(input).not.toHaveProperty(key);
    }
  });

  it('is a plan in its mode whatever was chosen, and never in another mode', () => {
    expect(actionFor({ releaseMode: 'open_day', action: 'alert' }, ROTTNEST_MANIFEST)).toBe(
      'remind'
    );
    expect(
      actionFor(
        { releaseMode: SnipeReleaseMode.DAILY_ROLLOVER, action: 'remind' },
        PARKSTAY_MANIFEST
      )
    ).toBe('hold');
    expect(
      actionFor(
        { releaseMode: SnipeReleaseMode.DAILY_ROLLOVER, action: 'alert' },
        PARKSTAY_MANIFEST
      )
    ).toBe('alert');
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
    // Main refusing a hold (a provider without holds): the "When the dates are free" choice
    expect(issueField('action')).toBe('action');
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
      "ParkStay doesn't offer Site Sniper, so choose a booking site.",
      "The link's place couldn't be used, so choose a location.",
      "The link's dates couldn't be used (they have passed or are out of order), so choose your dates.",
    ]);
  });

  it('reads the link’s stay types, and says when it named one it cannot use', () => {
    const parse = (query: string) => parseSnipePrefill(query, [PARKSTAY_MANIFEST], now);
    expect(parse('?provider=parkstay&location=20&stay=cabin,cabin')).toEqual({
      providerId: 'parkstay',
      locationId: '20',
      unitKinds: ['cabin'],
      notices: [],
    });
    expect(parse('?stay=bogus')).toEqual({
      notices: ["The link's stay type couldn't be used, so choose one."],
    });
    expect(parse('?stay=')).toEqual({ notices: [] });
  });
});
