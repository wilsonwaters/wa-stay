import { matchPath } from 'react-router';
import {
  buildPath,
  LEGACY_REDIRECTS,
  pageTitleFor,
  parseCreatePrefill,
  PATTERNS,
  placeLinkState,
  ROUTES,
} from './routes';

describe('buildPath', () => {
  it('encodes each param, so an external id may hold slashes, spaces and query characters', () => {
    expect(
      buildPath(PATTERNS.placeDetail, { providerId: 'parkstay', externalId: 'a/b c?d#e' })
    ).toBe('/places/parkstay/a%2Fb%20c%3Fd%23e');
  });

  it('drops a missing optional param and throws for a missing required one', () => {
    expect(buildPath(PATTERNS.settings)).toBe('/settings');
    expect(buildPath(PATTERNS.settings, { section: 'notifications' })).toBe(
      '/settings/notifications'
    );
    expect(() => buildPath(PATTERNS.watchDetail)).toThrow(':id');
  });

  it('appends a query string, leaving out empty values', () => {
    expect(
      buildPath(PATTERNS.watchNew, {}, { provider: 'parkstay', location: '12', adults: 2, x: '' })
    ).toBe('/watches/new?provider=parkstay&location=12&adults=2');
    expect(buildPath(PATTERNS.explore, {}, { q: undefined })).toBe('/');
  });
});

describe('ROUTES', () => {
  it('has exactly the keys later tasks rely on', () => {
    expect(Object.keys(ROUTES).sort()).toEqual(
      [
        'explore',
        'placeDetail',
        'watches',
        'watchNew',
        'watchDetail',
        'watchEdit',
        'snipes',
        'snipeNew',
        'snipeDetail',
        'bookings',
        'bookingDetail',
        'settings',
        'design',
      ].sort()
    );
  });

  it('builds the addresses of architecture-notes §12.10', () => {
    expect(ROUTES.explore()).toBe('/');
    expect(ROUTES.placeDetail('parkstay', '12 3')).toBe('/places/parkstay/12%203');
    expect(ROUTES.watches()).toBe('/watches');
    expect(ROUTES.watchNew()).toBe('/watches/new');
    expect(
      ROUTES.watchNew({ provider: 'parkstay', location: '7', arrival: '2026-12-01', adults: 2 })
    ).toBe('/watches/new?provider=parkstay&location=7&arrival=2026-12-01&adults=2');
    expect(ROUTES.watchDetail(12)).toBe('/watches/12');
    expect(ROUTES.watchEdit(12)).toBe('/watches/12/edit');
    expect(ROUTES.snipes()).toBe('/site-sniper');
    expect(ROUTES.snipeNew({ location: '9' })).toBe('/site-sniper/new?location=9');
    expect(ROUTES.snipeDetail(4)).toBe('/site-sniper/4');
    expect(ROUTES.bookings()).toBe('/bookings');
    expect(ROUTES.bookingDetail(3)).toBe('/bookings/3');
    expect(ROUTES.settings()).toBe('/settings');
    expect(ROUTES.settings('notifications')).toBe('/settings/notifications');
    expect(ROUTES.settings('accounts', { provider: 'parkstay' })).toBe(
      '/settings/accounts?provider=parkstay'
    );
    expect(ROUTES.design()).toBe('/__design');
  });

  it("adds the stay to a place's address, in a fixed order, leaving out what is not set", () => {
    expect(
      ROUTES.placeDetail('parkstay', '20', {
        adults: 2,
        arrival: '2026-11-06',
        departure: '2026-11-08',
        children: null,
        infants: 0,
      })
    ).toBe('/places/parkstay/20?arrival=2026-11-06&departure=2026-11-08&adults=2&infants=0');
    expect(ROUTES.placeDetail('parkstay', '20', {})).toBe('/places/parkstay/20');
  });

  it('round-trips an external id with "/", ":" and spaces through the route pattern', () => {
    const path = ROUTES.placeDetail('parkstay', 'a/b:c d');
    expect(path).toBe('/places/parkstay/a%2Fb%3Ac%20d');
    // React Router matches the decoded path, with an encoded "/" kept inside its segment.
    const decoded = path
      .split('/')
      .map((part) => decodeURIComponent(part).replace(/\//g, '%2F'))
      .join('/');
    const match = matchPath(PATTERNS.placeDetail, decoded);
    expect(match?.params.externalId?.replace(/%2F/g, '/')).toBe('a/b:c d');
  });

  it('redirects the old create routes to /new', () => {
    expect(LEGACY_REDIRECTS).toEqual([
      { from: '/watches/create', to: '/watches/new' },
      { from: '/site-sniper/create', to: '/site-sniper/new' },
    ]);
  });
});

describe('pageTitleFor', () => {
  it.each([
    ['/', 'Explore'],
    ['/watches', 'Watches'],
    ['/watches/new', 'New watch'],
    ['/watches/12', 'Watch'],
    ['/watches/12/edit', 'Edit watch'],
    ['/site-sniper', 'Site Sniper'],
    ['/bookings/3', 'Booking'],
    ['/settings/notifications', 'Settings'],
    ['/nowhere', 'Page not found'],
  ])('%s is "%s"', (pathname, title) => {
    expect(pageTitleFor(pathname)).toBe(title);
  });
});

describe('parseCreatePrefill', () => {
  it('reads the §12.10 prefill query', () => {
    expect(
      parseCreatePrefill(
        '?provider=parkstay&location=20&arrival=2026-11-06&departure=2026-11-08&adults=2&children=1&infants=1'
      )
    ).toEqual({
      provider: 'parkstay',
      location: '20',
      arrival: '2026-11-06',
      departure: '2026-11-08',
      adults: 2,
      children: 1,
    });
  });

  it('round-trips what ROUTES.watchNew builds', () => {
    const prefill = {
      provider: 'parkstay',
      location: 'a/b c',
      arrival: '2026-11-06',
      departure: '2026-11-08',
      adults: 3,
    };
    expect(parseCreatePrefill(ROUTES.watchNew(prefill).split('?')[1])).toEqual(prefill);
  });

  it('leaves out values that are not valid', () => {
    expect(
      parseCreatePrefill(
        '?provider=Not+A+Provider&location=&arrival=2026-11-08&departure=2026-11-06&adults=0'
      )
    ).toEqual({ arrival: '2026-11-08' });
    expect(parseCreatePrefill('')).toEqual({});
  });
});

describe('placeLinkState', () => {
  it('reads the state Explore gives a link to a place, and nothing else', () => {
    expect(placeLinkState({ from: 'explore', search: '?q=bay' })).toEqual({
      from: 'explore',
      search: '?q=bay',
    });
    expect(placeLinkState({ from: 'watches', search: '' })).toBeNull();
    expect(placeLinkState(null)).toBeNull();
    expect(placeLinkState('explore')).toBeNull();
  });
});
