import { WatchResult } from '../../../../shared/types/common.types';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import { makeWatch } from '@tests/fixtures/renderer/watches';
import { autoHoldLabel, statusPillFor, unitNameOf, unitNounFor, watchStateOf } from './watchState';

const now = new Date('2099-12-01T02:00:00Z');
const today = '2099-12-01';

describe('watchStateOf', () => {
  it('is active or paused before the stay starts', () => {
    expect(watchStateOf(makeWatch(), today, now)).toBe('active');
    expect(watchStateOf(makeWatch({ isActive: false }), today, now)).toBe('paused');
  });

  it('is ended once the stay has started, in the provider’s day', () => {
    const watch = makeWatch({ stay: { ...makeWatch().stay, arrival: '2099-12-01' } });
    expect(watchStateOf(watch, '2099-12-01', now)).toBe('ended');
    expect(watchStateOf(watch, '2099-11-30', now)).toBe('active');
  });

  it('is held until the hold expires, then hold-expired', () => {
    const held = makeWatch({
      lastResult: WatchResult.HELD,
      hold: { reference: 'PB1', expiresAt: new Date('2099-12-01T02:30:00Z') },
    });
    expect(watchStateOf(held, today, now)).toBe('held');
    expect(watchStateOf(held, today, new Date('2099-12-01T02:31:00Z'))).toBe('hold-expired');
    expect(watchStateOf({ ...held, hold: undefined }, today, now)).toBe('hold-expired');
  });

  it('is booked once paid for, whatever else', () => {
    expect(
      watchStateOf(
        makeWatch({ lastResult: WatchResult.BOOKED, isActive: false }),
        '2100-01-01',
        now
      )
    ).toBe('booked');
  });
});

describe('watch state helpers', () => {
  it('gives each state its pill', () => {
    expect(statusPillFor('active').label).toBe('Watching');
    expect(statusPillFor('paused').label).toBe('Paused');
    expect(statusPillFor('ended').label).toBe('Ended');
    expect(statusPillFor('held').label).toBe('Site held');
    expect(statusPillFor('booked').label).toBe('Booked');
  });

  it('names units by the provider’s main kind, and a held unit by its last-check name', () => {
    expect(unitNounFor(PARKSTAY_MANIFEST)).toEqual({ one: 'site', many: 'sites' });
    expect(unitNounFor(FAKE_MANIFEST)).toEqual({ one: 'site', many: 'sites' });
    expect(unitNounFor(undefined)).toEqual({ one: 'unit', many: 'units' });
    const watch = makeWatch({
      lastAvailability: [{ unitId: '7', unitName: 'Site 07', nights: [], fullyAvailable: true }],
    });
    expect(unitNameOf(watch, '7', { one: 'site', many: 'sites' })).toBe('Site 07');
    expect(unitNameOf(watch, '9', { one: 'site', many: 'sites' })).toBe('Site 9');
  });
});

describe('autoHoldLabel', () => {
  const SITES = { one: 'site', many: 'sites' };
  const hold = { reference: 'PB1', unitId: '7', expiresAt: new Date('2099-12-01T02:30:00Z') };

  it('reads the stored setting before anything is held', () => {
    expect(autoHoldLabel(makeWatch({ autoHold: true }), 'active', SITES)).toBe(
      'On: hold a site when found'
    );
    expect(autoHoldLabel(makeWatch(), 'active', SITES)).toBe('Off');
  });

  it('says On once a hold was placed, even if the stored setting disagrees', () => {
    const held = makeWatch({ autoHold: false, lastResult: WatchResult.HELD, hold });
    expect(autoHoldLabel(held, 'held', SITES, '10:30 am AWST')).toBe(
      'On: Site 7 held until 10:30 am AWST'
    );
    expect(autoHoldLabel(held, 'hold-expired', SITES)).toBe('On: the hold on Site 7 expired');
    expect(autoHoldLabel({ ...held, lastResult: WatchResult.BOOKED }, 'booked', SITES)).toBe(
      'On: Site 7 held, then booked'
    );
  });
});
