import { WatchResult } from '../../../../shared/types/common.types';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import { makeWatch } from '@tests/fixtures/renderer/watches';
import {
  autoHoldLabel,
  heldNoun,
  statusPillFor,
  unitNameOf,
  watchNoun,
  watchStateOf,
} from './watchState';

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
  const SITES = { one: 'site', many: 'sites' };

  it('gives each state its pill, a hold with the held unit’s noun', () => {
    expect(statusPillFor('active', SITES).label).toBe('Watching');
    expect(statusPillFor('paused', SITES).label).toBe('Paused');
    expect(statusPillFor('ended', SITES).label).toBe('Ended');
    expect(statusPillFor('held', SITES).label).toBe('Site held');
    expect(statusPillFor('hold-expired', { one: 'cabin', many: 'cabins' }).label).toBe(
      'Cabin held'
    );
    expect(statusPillFor('booked', SITES).label).toBe('Booked');
  });

  it('names units by the provider’s main kind, and a held unit by its last-check name', () => {
    expect(watchNoun(makeWatch(), PARKSTAY_MANIFEST)).toEqual(SITES);
    // A holiday park has sites and cabins (`deriveUnitKinds`): "spots"
    expect(watchNoun(makeWatch(), FAKE_MANIFEST)).toEqual({ one: 'spot', many: 'spots' });
    expect(watchNoun(makeWatch(), undefined)).toEqual({ one: 'spot', many: 'spots' });
    const watch = makeWatch({
      lastAvailability: [{ unitId: '7', unitName: 'Site 07', nights: [], fullyAvailable: true }],
    });
    expect(unitNameOf(watch, '7', SITES)).toBe('Site 07');
    expect(unitNameOf(watch, '9', SITES)).toBe('Site 9');
  });

  it('names a watch’s units by its last check, its stay types, the place or the provider (R9)', () => {
    const unit = (unitId: string, unitKind?: 'cabin' | 'campsite') => ({
      unitId,
      unitName: `Unit ${unitId}`,
      nights: [],
      fullyAvailable: true,
      ...(unitKind ? { unitKind } : {}),
    });
    const cabins = makeWatch({ lastAvailability: [unit('1', 'cabin'), unit('2', 'cabin')] });
    expect(watchNoun(cabins, PARKSTAY_MANIFEST).many).toBe('cabins');
    const mixed = makeWatch({ lastAvailability: [unit('1', 'cabin'), unit('2', 'campsite')] });
    expect(watchNoun(mixed, PARKSTAY_MANIFEST).many).toBe('spots');
    // A check stored before kinds: the stay types, then the place's units, then the provider
    const old = makeWatch({ lastAvailability: [unit('1')] });
    expect(watchNoun({ ...old, unitKinds: ['room'] }, PARKSTAY_MANIFEST).many).toBe('rooms');
    expect(watchNoun(old, PARKSTAY_MANIFEST, { placeUnits: [unit('3', 'cabin')] }).many).toBe(
      'cabins'
    );
    expect(watchNoun(old, PARKSTAY_MANIFEST).many).toBe('sites');
  });

  it('names a held unit by its own kind, and falls back when it is not in the last check', () => {
    const hold = { reference: 'H1', expiresAt: new Date('2099-12-01T02:30:00Z'), unitId: '2' };
    const lastAvailability = [
      { unitId: '1', unitName: 'Site 1', nights: [], fullyAvailable: true, unitKind: 'campsite' },
      { unitId: '2', unitName: 'Cabin 2', nights: [], fullyAvailable: true, unitKind: 'cabin' },
    ] as const;
    const held = makeWatch({ hold, lastAvailability: [...lastAvailability] });
    expect(heldNoun(held, PARKSTAY_MANIFEST).one).toBe('cabin');
    expect(heldNoun({ ...held, hold: { ...hold, unitId: '9' } }, PARKSTAY_MANIFEST).one).toBe(
      'site'
    );
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
