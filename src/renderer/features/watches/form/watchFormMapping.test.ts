import { contract } from '../../../../shared/contracts';
import { PARKSTAY_MANIFEST, FAKE_MANIFEST } from '@tests/utils/renderer/manifests';
import { makeWatch } from '@tests/fixtures/renderer/watches';
import type { WatchFormValues } from './watchFormSchema';
import {
  emptyWatchForm,
  fromWatch,
  suggestedName,
  toWatchInput,
  toWatchUpdate,
} from './watchFormMapping';

const form = (overrides: Partial<WatchFormValues> = {}): WatchFormValues => ({
  ...emptyWatchForm(PARKSTAY_MANIFEST),
  location: {
    externalId: '20',
    name: 'Osprey Bay',
    areaName: 'Cape Range National Park',
    kind: 'campground',
  },
  arrival: '2099-12-11',
  departure: '2099-12-13',
  name: ' Osprey Bay summer ',
  ...overrides,
});

describe('toWatchInput', () => {
  it('sends the provider, the location ref and a YYYY-MM-DD stay, and no user id', () => {
    const input = toWatchInput(form(), PARKSTAY_MANIFEST);
    expect(input).toEqual({
      providerId: 'parkstay',
      name: 'Osprey Bay summer',
      location: { externalId: '20', name: 'Osprey Bay', areaName: 'Cape Range National Park' },
      stay: { arrival: '2099-12-11', departure: '2099-12-13', adults: 2 },
      stayParams: { gearType: 'all' },
      checkIntervalMinutes: 60,
      notifyOnly: true,
      allowPartialMatch: false,
    });
    expect(contract.watches.create.request.parse(input)).toEqual(input);
  });

  it('leaves out an empty max price (no NaN), and sends units, children, notes and the hold fields', () => {
    const input = toWatchInput(
      form({
        maxPrice: '45.5',
        unitIds: ['12', '13'],
        children: 1,
        notes: ' near the water ',
        autoHold: true,
        stayParams: { gearType: 'tent', numVehicles: 2, postcode: '6000' },
      }),
      PARKSTAY_MANIFEST
    );
    expect(input).toMatchObject({
      maxPrice: 45.5,
      unitIds: ['12', '13'],
      stay: { adults: 2, children: 1 },
      notes: 'near the water',
      autoHold: true,
      stayParams: { gearType: 'tent', numVehicles: 2, postcode: '6000' },
    });
    expect(toWatchInput(form({ maxPrice: '' }), PARKSTAY_MANIFEST)).not.toHaveProperty('maxPrice');
  });

  it('never sends hold fields or auto-hold for a provider without holds', () => {
    const input = toWatchInput(
      { ...form({ providerId: 'fakestay', autoHold: true }), stayParams: {} },
      FAKE_MANIFEST
    );
    expect(input).not.toHaveProperty('autoHold');
    expect(input).not.toHaveProperty('stayParams');
  });
});

describe('fromWatch and toWatchUpdate', () => {
  const legacy = makeWatch({
    unitIds: ['Site 3'],
    stayParams: { parkId: '17', gearType: 'tent,caravan' },
    maxPrice: 40,
  });

  it('pre-fills every field, turning the legacy gear CSV into a valid choice with a note', () => {
    const { values, notes } = fromWatch(legacy, PARKSTAY_MANIFEST);
    expect(values).toMatchObject({
      providerId: 'parkstay',
      location: legacy.location,
      arrival: '2099-12-11',
      departure: '2099-12-13',
      adults: 2,
      unitIds: ['Site 3'],
      stayParams: { gearType: 'all', numVehicles: 1, postcode: '' },
      maxPrice: '40',
      checkIntervalMinutes: 60,
      name: legacy.name,
    });
    expect(notes.gearType).toMatch(/was saved as "Tent, Caravan".*now Any/);
  });

  it('sends only what changed', () => {
    const { values } = fromWatch(legacy, PARKSTAY_MANIFEST);
    expect(toWatchUpdate(values, values, legacy, PARKSTAY_MANIFEST)).toEqual({});
    expect(
      toWatchUpdate(
        { ...values, notes: 'Bring the kayak', adults: 3 },
        values,
        legacy,
        PARKSTAY_MANIFEST
      )
    ).toEqual({
      notes: 'Bring the kayak',
      stay: { arrival: '2099-12-11', departure: '2099-12-13', adults: 3 },
    });
  });

  it('sends stay params with auto-hold, keeping undeclared stored keys, and clears a max price with 0', () => {
    const { values } = fromWatch(legacy, PARKSTAY_MANIFEST);
    const update = toWatchUpdate(
      { ...values, autoHold: true, maxPrice: '' },
      values,
      legacy,
      PARKSTAY_MANIFEST
    );
    expect(update).toEqual({
      autoHold: true,
      maxPrice: 0,
      stayParams: { parkId: '17', gearType: 'all', numVehicles: 1 },
    });
    expect(contract.watches.update.request.parse({ id: 1, updates: update }).updates).toEqual(
      update
    );
  });
});

describe('suggestedName', () => {
  it('names a watch after the place and dates', () => {
    expect(suggestedName({ name: 'Osprey Bay' }, '2099-12-11', '2099-12-13', '2099-01-01')).toBe(
      'Osprey Bay · Fri 11 – Sun 13 Dec'
    );
    expect(suggestedName({ name: 'Osprey Bay' }, '', '', '2099-01-01')).toBe('Osprey Bay');
    expect(suggestedName(null, '', '', '2099-01-01')).toBe('');
  });
});
