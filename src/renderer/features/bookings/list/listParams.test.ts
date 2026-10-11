import { makeBooking } from '@tests/fixtures/renderer/bookings';
import { FAKE_MANIFEST, PARKSTAY_MANIFEST } from '@tests/utils/renderer/manifests';
import {
  matchesSearch,
  parseListParams,
  providerFilterOptions,
  withListParams,
} from './listParams';

const parse = (query: string) => parseListParams(new URLSearchParams(query));

describe('Bookings list URL state', () => {
  it('reads ?tab=&provider=&q=, defaulting to Upcoming, every provider and no search', () => {
    expect(parse('')).toEqual({ tab: 'upcoming', provider: undefined, q: '' });
    expect(parse('tab=past&provider=parkstay&q=karijini')).toEqual({
      tab: 'past',
      provider: 'parkstay',
      q: 'karijini',
    });
    expect(parse('tab=someday&provider=all')).toEqual({
      tab: 'upcoming',
      provider: undefined,
      q: '',
    });
    expect(parse(`q=${'x'.repeat(300)}`).q).toHaveLength(100);
  });

  it('writes the state back, leaving out defaults and keeping other parameters', () => {
    const start = new URLSearchParams('keep=1&tab=past&q=old');
    expect(
      withListParams(start, { tab: 'cancelled', provider: 'fakestay', q: 'lucky' }).toString()
    ).toBe('keep=1&tab=cancelled&q=lucky&provider=fakestay');
    expect(withListParams(start, { tab: 'upcoming', q: '  ' }).toString()).toBe('keep=1');
  });

  it('round-trips', () => {
    const state = { tab: 'past' as const, provider: 'parkstay', q: 'Dales' };
    expect(parseListParams(withListParams(new URLSearchParams(), state))).toEqual(state);
  });
});

describe('search', () => {
  const dales = makeBooking({
    bookingReference: 'pb-77a',
    location: { name: 'Dales Campground', areaName: 'Karijini National Park' },
  });

  it('matches the location, the area or the reference, ignoring case and spaces around', () => {
    expect(matchesSearch(dales, 'dales')).toBe(true);
    expect(matchesSearch(dales, ' KARIJINI ')).toBe(true);
    expect(matchesSearch(dales, 'PB-77')).toBe(true);
    expect(matchesSearch(dales, 'osprey')).toBe(false);
    expect(matchesSearch(dales, '')).toBe(true);
  });
});

describe('provider filter options', () => {
  it('lists every registered provider, then providers no longer installed', () => {
    const orphan = makeBooking({ providerId: 'gone' });
    expect(providerFilterOptions([PARKSTAY_MANIFEST, FAKE_MANIFEST], [orphan])).toEqual([
      { value: 'all', label: 'All' },
      { value: 'parkstay', label: 'ParkStay' },
      { value: 'fakestay', label: 'Fake Stay' },
      { value: 'gone', label: 'Other provider (gone)' },
    ]);
  });

  it('still shows a single provider (§12.9)', () => {
    expect(providerFilterOptions([PARKSTAY_MANIFEST], [])).toHaveLength(2);
  });
});
