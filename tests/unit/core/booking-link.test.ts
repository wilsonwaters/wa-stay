/**
 * @jest-environment node
 *
 * Booking links (brief R6, R7; `core/booking-link.ts`): a link is accepted only when it is
 * https on the provider's own site, with no credentials; the first acceptable candidate wins
 * and refused ones are logged by origin only; a watch's match gets its unit's own link first,
 * then `links.booking` for the match's stay (a partial run's dates) and unit.
 */
import {
  firstBookingLink,
  httpsLink,
  isProviderBookingLink,
  matchedStayLink,
  type BookingLinkProvider,
} from '@main/core/booking-link';
import { parkstayLinks, parkstayManifest } from '@main/providers/parkstay';
import type { StayQuery } from '@shared/types/provider.types';
import type { UnitAvailability, Watch, WatchMatch } from '@shared/types';

jest.mock('@main/utils/logger', () => {
  const log: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  log.child = () => log;
  return { logger: log };
});
const mockLog = (jest.requireMock('@main/utils/logger') as { logger: Record<string, jest.Mock> })
  .logger;

const PARKSTAY = { id: 'parkstay', website: 'https://parkstay.dbca.wa.gov.au' };
const WWW_SITE = { id: 'example', website: 'https://www.example-parks.test' };

/** Every logged line, as one string. */
const logged = () =>
  JSON.stringify(
    Object.values(mockLog).map((fn) => (typeof fn === 'function' ? fn.mock?.calls : []))
  );

beforeEach(() => {
  for (const fn of Object.values(mockLog)) if (typeof fn === 'function') fn.mockClear?.();
});

describe('isProviderBookingLink', () => {
  it.each([
    [
      'the website itself',
      PARKSTAY,
      'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20&arrival=2026/11/10&departure=2026/11/12',
    ],
    ['a subdomain of a www website', WWW_SITE, 'https://book.example-parks.test/stay?park=1'],
    ['the www host itself', WWW_SITE, 'https://www.example-parks.test/book/1'],
    ['the www website without its www', WWW_SITE, 'https://example-parks.test/book/1'],
    ['a deeper subdomain', PARKSTAY, 'https://a.b.parkstay.dbca.wa.gov.au/x'],
  ])('accepts %s', (_name, manifest, url) => {
    expect(isProviderBookingLink(manifest, url)).toBe(true);
  });

  it.each([
    ['http', PARKSTAY, 'http://parkstay.dbca.wa.gov.au/search-availability/information/'],
    ['another host', PARKSTAY, 'https://evil.test/search-availability/information/'],
    ['a look-alike host', PARKSTAY, 'https://parkstay.dbca.wa.gov.au.evil.test/x'],
    ['a host that only ends with the name', PARKSTAY, 'https://evilparkstay.dbca.wa.gov.au/x'],
    ['the parent domain of a website without www', PARKSTAY, 'https://dbca.wa.gov.au/x'],
    ['credentials', PARKSTAY, 'https://user:pass@parkstay.dbca.wa.gov.au/x'],
    ['a user name alone', PARKSTAY, 'https://user@parkstay.dbca.wa.gov.au/x'],
    ['another port', PARKSTAY, 'https://parkstay.dbca.wa.gov.au:8443/x'],
    ['javascript:', PARKSTAY, 'javascript:alert(document.cookie)'],
    ['a data: URL', PARKSTAY, 'data:text/html,<script>alert(1)</script>'],
    ['an in-app path', PARKSTAY, '/watches/1'],
    ['text that is not a URL', PARKSTAY, 'not a url'],
    ['a subdomain of another www site', WWW_SITE, 'https://www.example-parks.test.evil.test/x'],
  ])('refuses %s', (_name, manifest, url) => {
    expect(isProviderBookingLink(manifest, url)).toBe(false);
  });

  it('refuses everything for a website that is not https', () => {
    expect(isProviderBookingLink({ website: 'http://site.test' }, 'https://site.test/x')).toBe(
      false
    );
  });
});

describe('httpsLink', () => {
  it('normalises an https URL and drops anything else', () => {
    expect(httpsLink('https://site.test/a b?q="x"')).toBe('https://site.test/a%20b?q=%22x%22');
    expect(httpsLink('http://site.test/')).toBeUndefined();
    expect(httpsLink('https://u:p@site.test/')).toBeUndefined();
    expect(httpsLink(undefined)).toBeUndefined();
    expect(httpsLink('')).toBeUndefined();
  });
});

describe('firstBookingLink', () => {
  it('passes over a refused candidate to the next, and logs the refused one by origin only', () => {
    const url = firstBookingLink(PARKSTAY, [
      'https://evil.test/cart?add=1&token=secret',
      null,
      'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20',
    ]);

    expect(url).toBe(
      'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20'
    );
    expect(mockLog.warn).toHaveBeenCalledTimes(1);
    expect(mockLog.warn.mock.calls[0][0]).toContain('https://evil.test');
    expect(logged()).not.toMatch(/cart|token|secret|add=1/);
  });

  it('gives undefined, logging once, when nothing is a booking link of the provider', () => {
    expect(
      firstBookingLink(PARKSTAY, [
        'http://parkstay.dbca.wa.gov.au/a?x=1',
        'javascript:alert(1)',
        'https://parkstay.dbca.wa.gov.au.evil.test/b?y=2',
      ])
    ).toBeUndefined();
    expect(mockLog.warn).toHaveBeenCalledTimes(1);
    const [line] = mockLog.warn.mock.calls[0];
    expect(line).toContain('http://parkstay.dbca.wa.gov.au');
    expect(line).toContain('a javascript: URL');
    expect(line).toContain('https://parkstay.dbca.wa.gov.au.evil.test');
    expect(logged()).not.toMatch(/x=1|y=2|alert/);
  });

  it('logs nothing when there are no candidates', () => {
    expect(firstBookingLink(PARKSTAY, [undefined, null, ''])).toBeUndefined();
    expect(mockLog.warn).not.toHaveBeenCalled();
  });
});

describe('matchedStayLink', () => {
  const watch: Pick<Watch, 'location' | 'stay' | 'stayParams'> = {
    location: { externalId: '20', name: 'Bungarra' },
    stay: { arrival: '2026-11-10', departure: '2026-11-13', adults: 2, children: 1 },
    stayParams: { gearType: 'tent' },
  };
  const full: WatchMatch = {
    unitId: 'c1',
    unitName: 'Cabin 1',
    arrival: '2026-11-10',
    departure: '2026-11-13',
    partial: false,
    priceKnown: false,
  };
  const run: WatchMatch = {
    ...full,
    arrival: '2026-11-11',
    departure: '2026-11-13',
    partial: true,
  };
  const unit = (bookingUrl?: string): UnitAvailability => ({
    unitId: 'c1',
    unitName: 'Cabin 1',
    nights: [],
    fullyAvailable: true,
    ...(bookingUrl ? { bookingUrl } : {}),
  });

  /** A provider on www.example-parks.test whose `links.booking` names the stay and unit. */
  function provider(): BookingLinkProvider & { booking: jest.Mock } {
    const booking = jest.fn(
      (externalId: string, stay?: StayQuery, unitId?: string) =>
        `https://www.example-parks.test/book/${externalId}?arrival=${stay?.arrival}&departure=${stay?.departure}&adults=${stay?.adults}&unit=${unitId}`
    );
    return {
      manifest: WWW_SITE,
      links: { location: () => null, booking },
      booking,
    };
  }

  it("for a full match, the unit's own booking link comes first", () => {
    const p = provider();
    const link = matchedStayLink(p, watch, full, [
      unit('https://book.example-parks.test/cabins/c1?from=2026-11-10&to=2026-11-13'),
    ]);
    expect(link).toEqual({
      url: 'https://book.example-parks.test/cabins/c1?from=2026-11-10&to=2026-11-13',
      arrival: '2026-11-10',
      departure: '2026-11-13',
    });
  });

  it("a partial match uses links.booking with the run's dates, the party and the unit", () => {
    const p = provider();
    // A unit link is for the whole stay, so a run never uses it
    const link = matchedStayLink(p, watch, run, [unit('https://book.example-parks.test/c1')]);

    expect(p.booking).toHaveBeenCalledWith(
      '20',
      expect.objectContaining({
        arrival: '2026-11-11',
        departure: '2026-11-13',
        adults: 2,
        children: 1,
        params: { gearType: 'tent' },
      }),
      'c1'
    );
    expect(link).toEqual({
      url: 'https://www.example-parks.test/book/20?arrival=2026-11-11&departure=2026-11-13&adults=2&unit=c1',
      arrival: '2026-11-11',
      departure: '2026-11-13',
    });
  });

  it('a refused unit link falls through to links.booking, logged by origin only', () => {
    const p = provider();
    const link = matchedStayLink(p, watch, full, [unit('https://cart.evil.test/add?c1=1')]);

    expect(link?.url).toBe(
      'https://www.example-parks.test/book/20?arrival=2026-11-10&departure=2026-11-13&adults=2&unit=c1'
    );
    expect(mockLog.warn).toHaveBeenCalledTimes(1);
    expect(logged()).toContain('https://cart.evil.test');
    expect(logged()).not.toContain('c1=1');
  });

  it('nothing valid gives undefined: no unit link and links.booking off-site, null or throwing', () => {
    const offSite = provider();
    offSite.booking.mockReturnValue('https://elsewhere.test/book?x=1');
    expect(matchedStayLink(offSite, watch, full, [unit()])).toBeUndefined();

    const none = provider();
    none.booking.mockReturnValue(null);
    expect(matchedStayLink(none, watch, full, [unit()])).toBeUndefined();

    const broken = provider();
    broken.booking.mockImplementation(() => {
      throw new Error('https://www.example-parks.test/secret?token=1');
    });
    expect(matchedStayLink(broken, watch, full, [unit()])).toBeUndefined();
    expect(logged()).not.toMatch(/secret|token=1|x=1/);
  });

  it("ParkStay's link is its search page with the campground and the stay's dates", () => {
    const parkstay = { manifest: parkstayManifest, links: parkstayLinks };
    expect(matchedStayLink(parkstay, watch, run, [])).toEqual({
      url: 'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20&arrival=2026/11/11&departure=2026/11/13',
      arrival: '2026-11-11',
      departure: '2026-11-13',
    });
  });
});
