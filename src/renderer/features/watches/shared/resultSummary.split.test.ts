/**
 * What a watch says it found when the stay is free every night only by moving between units
 * (`SPLIT_FOUND`, §12.36): on its card and after Check now. Never "available".
 */
import { WatchResult } from '../../../../shared/types/common.types';
import type { SplitStay } from '../../../../shared/types/provider.types';
import type { WatchExecutionResult } from '../../../../shared/types/watch.types';
import { PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import { makeWatch } from '@tests/fixtures/renderer/watches';
import { resultSummary, runResultMessage } from './resultSummary';

const SITES = { one: 'site', many: 'sites' };
const NIGHTS = ['2099-12-11', '2099-12-12'];
const checked = { lastCheckedAt: new Date('2099-12-01T00:00:00Z') };

describe('stays free only if you move (SPLIT_FOUND)', () => {
  /** Site 3 on the 11th, Site 4 on the 12th: two bookings. */
  const derived: SplitStay = {
    unitKind: 'campsite',
    booking: 'separate',
    units: 2,
    parts: [
      { unitId: '3', unitName: 'Site 3', arrival: NIGHTS[0], departure: NIGHTS[1] },
      { unitId: '4', unitName: 'Site 4', arrival: NIGHTS[1], departure: '2099-12-13' },
    ],
  };
  /** RAC's Powered Site: no count of the sites it moves across. */
  const powered: SplitStay = {
    unitKind: 'campsite',
    booking: 'contact',
    unitId: 'cat:4',
    unitName: 'Powered Site',
  };
  const splitWatch = (splitStays?: SplitStay[]) =>
    makeWatch({ ...checked, lastResult: WatchResult.SPLIT_FOUND, splitStays });

  it('says how many units the best one moves across, else that it is free if you move', () => {
    expect(resultSummary(splitWatch([derived, powered]), SITES)).toBe('Free across 2 sites');
    expect(resultSummary(splitWatch([powered]), { one: 'spot', many: 'spots' })).toBe(
      'Free if you move sites'
    );
    // The stay was edited since: main gives none, and the watch's noun says it
    expect(resultSummary(splitWatch(), { one: 'cabin', many: 'cabins' })).toBe(
      'Free if you move cabins'
    );
    expect(resultSummary(splitWatch([derived]), SITES)).not.toMatch(/available/);
  });

  it('says it after Check now, at the place, below a whole stay and above some nights', () => {
    const base: WatchExecutionResult = {
      watchId: 1,
      success: true,
      found: true,
      matches: [],
      checkedAt: new Date(),
    };
    const watch = makeWatch();
    expect(
      runResultMessage({ ...base, splitStays: [derived] }, watch, SITES, PARKSTAY_MANIFEST)
    ).toBe('Free across 2 sites at Osprey Bay');
    expect(
      runResultMessage({ ...base, splitStays: [powered] }, watch, SITES, PARKSTAY_MANIFEST)
    ).toBe('Free if you move sites at Osprey Bay');
    // A whole stay comes first
    const whole = {
      unitId: '1',
      unitName: 'Site 1',
      arrival: NIGHTS[0],
      departure: '2099-12-13',
      partial: false,
      priceKnown: false,
    };
    expect(
      runResultMessage(
        { ...base, matches: [whole], splitStays: [derived] },
        watch,
        SITES,
        PARKSTAY_MANIFEST
      )
    ).toBe('1 site available at Osprey Bay');
    // No split stay: as before
    expect(
      runResultMessage({ ...base, found: false, splitStays: [] }, watch, SITES, undefined)
    ).toBe('Nothing available yet');
  });
});
