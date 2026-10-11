import {
  BROWSE_ONLY_MANIFEST,
  FAKE_MANIFEST,
  PARKSTAY_MANIFEST,
} from '@tests/utils/renderer/manifests';
import { parseWatchPrefill } from './prefill';

const MANIFESTS = [PARKSTAY_MANIFEST, FAKE_MANIFEST, BROWSE_ONLY_MANIFEST];
const NOW = new Date('2026-10-09T02:00:00Z'); // 10 am on 9 Oct in Perth
const parse = (query: string, now = NOW) => parseWatchPrefill(query, MANIFESTS, now);

describe('parseWatchPrefill', () => {
  it('reads a whole link', () => {
    expect(
      parse(
        'provider=parkstay&location=123&arrival=2026-12-12&departure=2026-12-14&adults=2&children=1'
      )
    ).toEqual({
      providerId: 'parkstay',
      locationId: '123',
      arrival: '2026-12-12',
      departure: '2026-12-14',
      adults: 2,
      children: 1,
      notices: [],
    });
  });

  it('reads part of a link, and ignores parameters it does not know', () => {
    expect(parse('provider=fakestay&utm=x')).toEqual({ providerId: 'fakestay', notices: [] });
    expect(parse('')).toEqual({ notices: [] });
  });

  it('drops an unknown provider or one without watches, and the location with it', () => {
    expect(parse('provider=rac&location=9')).toEqual({
      notices: [
        "The link's provider isn't available, so choose a provider.",
        "The link's place couldn't be used, so choose a location.",
      ],
    });
    expect(parse('provider=browseonly').notices).toEqual([
      "Browse Only can't be watched, so choose a provider.",
    ]);
    expect(parse('location=parkstay:123').locationId).toBeUndefined();
  });

  it('drops dates that are malformed, out of order, half given or past in the provider’s zone', () => {
    const dropped =
      "The link's dates couldn't be used (they have passed or are out of order), so choose your dates.";
    expect(parse('provider=parkstay&arrival=2026-12-14&departure=2026-12-12').notices).toEqual([
      dropped,
    ]);
    expect(parse('provider=parkstay&arrival=12/12/2026&departure=2026-12-14').notices).toEqual([
      dropped,
    ]);
    expect(parse('provider=parkstay&arrival=2026-12-12').notices).toEqual([dropped]);
    expect(parse('provider=parkstay&arrival=2026-10-08&departure=2026-10-10').notices).toEqual([
      dropped,
    ]);
    // 11 pm on 8 Oct UTC is already 9 Oct in Perth: arriving on the 8th has passed there.
    const lateUtc = new Date('2026-10-08T23:00:00Z');
    expect(
      parse('provider=parkstay&arrival=2026-10-08&departure=2026-10-10', lateUtc).arrival
    ).toBeUndefined();
    expect(
      parse('provider=parkstay&arrival=2026-10-09&departure=2026-10-10', lateUtc).arrival
    ).toBe('2026-10-09');
  });

  it('drops guests that are not whole numbers in range', () => {
    expect(parse('adults=0&children=2')).toEqual({
      children: 2,
      notices: ["The link's guests couldn't be used, so check who's coming."],
    });
    expect(parse('adults=two').adults).toBeUndefined();
  });
});
