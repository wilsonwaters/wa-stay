import {
  BROWSE_ONLY_MANIFEST,
  FAKE_MANIFEST,
  PARKSTAY_MANIFEST,
} from '@tests/utils/renderer/manifests';
import { makeWatch } from '@tests/fixtures/renderer/watches';
import {
  parseWatchFilters,
  passesFilters,
  providerFilterOptions,
  sortWatches,
  withWatchFilters,
} from './listFilters';

describe('watch list filters', () => {
  it('reads provider and status from the URL, ignoring values that mean nothing', () => {
    expect(parseWatchFilters(new URLSearchParams('provider=parkstay&status=active'))).toEqual({
      provider: 'parkstay',
      status: 'active',
    });
    expect(parseWatchFilters(new URLSearchParams('status=sleeping&provider='))).toEqual({
      provider: undefined,
      status: 'all',
    });
    expect(parseWatchFilters(new URLSearchParams('provider=all&status=paused')).provider).toBe(
      undefined
    );
  });

  it('writes filters back, leaving defaults and other parameters alone', () => {
    const next = withWatchFilters(new URLSearchParams('x=1&status=paused'), {
      provider: 'fakestay',
      status: 'all',
    });
    expect(next.toString()).toBe('x=1&provider=fakestay');
  });

  it('narrows by provider and by active or paused; ended only under All', () => {
    const active = makeWatch();
    const paused = makeWatch({ id: 2, isActive: false, providerId: 'fakestay' });
    const all = { status: 'all' as const };
    expect(passesFilters(active, 'active', { status: 'active' })).toBe(true);
    expect(passesFilters(paused, 'paused', { status: 'active' })).toBe(false);
    expect(passesFilters(paused, 'paused', { status: 'paused' })).toBe(true);
    expect(passesFilters(active, 'ended', { status: 'active' })).toBe(false);
    expect(passesFilters(active, 'ended', all)).toBe(true);
    expect(passesFilters(paused, 'paused', { ...all, provider: 'parkstay' })).toBe(false);
  });

  it('keeps held, expired-hold and booked watches out of Active and Paused, like ended ones', () => {
    const stopped = makeWatch({ isActive: false });
    for (const state of ['held', 'hold-expired', 'booked', 'ended'] as const) {
      expect(passesFilters(stopped, state, { status: 'paused' })).toBe(false);
      expect(passesFilters(stopped, state, { status: 'active' })).toBe(false);
      expect(passesFilters(stopped, state, { status: 'all' })).toBe(true);
    }
  });

  it('offers All, the watch providers, and any other provider a watch belongs to', () => {
    const options = providerFilterOptions(
      [PARKSTAY_MANIFEST, BROWSE_ONLY_MANIFEST, FAKE_MANIFEST],
      [makeWatch({ providerId: 'rac' }), makeWatch({ providerId: 'browseonly' })]
    );
    expect(options.map((o) => o.label)).toEqual([
      'All',
      'ParkStay',
      'Fake Stay',
      'Unknown provider (rac)',
      'Browse Only',
    ]);
  });

  it('sorts held first, then by arrival, with ended last', () => {
    const rows = [
      {
        watch: makeWatch({ id: 1, stay: { ...makeWatch().stay, arrival: '2099-12-20' } }),
        state: 'active' as const,
      },
      { watch: makeWatch({ id: 2 }), state: 'ended' as const },
      {
        watch: makeWatch({ id: 3, stay: { ...makeWatch().stay, arrival: '2099-12-01' } }),
        state: 'paused' as const,
      },
      { watch: makeWatch({ id: 4 }), state: 'held' as const },
    ];
    expect(sortWatches(rows).map((r) => r.watch.id)).toEqual([4, 3, 1, 2]);
  });
});
