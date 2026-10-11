import {
  checkFailure,
  formatOpensAt,
  guestRangeLabel,
  handoffPrefill,
  linkHost,
  placeKey,
  resolvePlaceLinks,
  sameStay,
  stayQueryOf,
  unitTypeBreakdown,
} from './placeModel';

const WEBSITE = 'https://parkstay.dbca.wa.gov.au';
const SEARCH_PAGE =
  'https://parkstay.dbca.wa.gov.au/search-availability/information/?campground_id=20';
const INFO = 'https://exploreparks.dbca.wa.gov.au/site/bungarra';
const DEEP_LINK = `${SEARCH_PAGE}&arrival=2026/11/06&departure=2026/11/08`;

describe('placeKey', () => {
  it('joins the route params into a location key, keeping ":" and "/" in the external id', () => {
    expect(placeKey('parkstay', '20')).toBe('parkstay:20');
    expect(placeKey('parkstay', 'a/b:c d')).toBe('parkstay:a/b:c d');
  });

  it('is null when the params cannot make a key', () => {
    expect(placeKey('Park Stay', '20')).toBeNull();
    expect(placeKey('parkstay', '')).toBeNull();
  });
});

describe('resolvePlaceLinks', () => {
  const online = { bookingMode: 'online' as const, bookingUrl: SEARCH_PAGE, infoUrl: INFO };

  it('books on the place page, or the stay-specific link once dates are checked', () => {
    expect(resolvePlaceLinks(online, WEBSITE)).toEqual({
      book: SEARCH_PAGE,
      view: SEARCH_PAGE,
      info: { url: INFO, host: 'exploreparks.dbca.wa.gov.au' },
    });
    expect(resolvePlaceLinks(online, WEBSITE, DEEP_LINK).book).toBe(DEEP_LINK);
  });

  it('offers Book only for places booked online', () => {
    expect(resolvePlaceLinks({ ...online, bookingMode: 'external' }, WEBSITE).book).toBeUndefined();
    expect(
      resolvePlaceLinks({ ...online, bookingMode: 'offline' }, WEBSITE, DEEP_LINK).book
    ).toBeUndefined();
  });

  it("falls back to the provider's website only when the place has neither link", () => {
    expect(resolvePlaceLinks({ bookingMode: 'external' }, WEBSITE)).toEqual({ visit: WEBSITE });
    expect(resolvePlaceLinks({ bookingMode: 'external', infoUrl: INFO }, WEBSITE).visit).toBe(
      undefined
    );
    expect(resolvePlaceLinks({ bookingMode: 'external' }, undefined)).toEqual({});
  });

  it('keeps only http(s) links', () => {
    expect(
      resolvePlaceLinks(
        { bookingMode: 'online', bookingUrl: 'javascript:alert(1)', infoUrl: 'file:///etc' },
        WEBSITE,
        'not a url'
      )
    ).toEqual({ visit: WEBSITE });
  });
});

describe('linkHost', () => {
  it("is an http(s) link's host", () => {
    expect(linkHost(INFO)).toBe('exploreparks.dbca.wa.gov.au');
    expect(linkHost('mailto:a@b.c')).toBeNull();
    expect(linkHost(undefined)).toBeNull();
  });
});

describe('unitTypeBreakdown', () => {
  it('groups units by type, most first, then by name, with untyped units last', () => {
    const unit = (unitType?: string) => ({ unitId: 'x', unitName: 'x', unitType });
    expect(
      unitTypeBreakdown([
        unit('Tent site'),
        unit(),
        unit('Caravan site'),
        unit('Tent site'),
        unit('  '),
        unit('Campervan site'),
      ])
    ).toEqual([
      { type: 'Tent site', count: 2 },
      { type: 'Campervan site', count: 1 },
      { type: 'Caravan site', count: 1 },
      { type: null, count: 2 },
    ]);
  });
});

describe('guestRangeLabel', () => {
  const site = { one: 'site' };
  const unit = (maxPeople?: number) => ({ unitId: 'x', unitName: 'x', maxPeople });
  it('gives the range of the most guests a unit takes', () => {
    expect(guestRangeLabel([unit(2), unit(6), unit(4)], site)).toBe('Up to 2–6 guests per site');
    expect(guestRangeLabel([unit(6), unit(6)], site)).toBe('Up to 6 guests per site');
    expect(guestRangeLabel([unit(1)], { one: 'bunk' })).toBe('Up to 1 guest per bunk');
    expect(guestRangeLabel([unit(), unit(0)], site)).toBeUndefined();
  });
});

describe('handoffPrefill', () => {
  it('carries the provider, the external id, the dates, adults and children (not infants)', () => {
    expect(
      handoffPrefill('parkstay', '20', {
        arrival: '2026-11-06',
        departure: '2026-11-08',
        adults: 2,
        children: 1,
        infants: 1,
      })
    ).toEqual({
      provider: 'parkstay',
      location: '20',
      arrival: '2026-11-06',
      departure: '2026-11-08',
      adults: 2,
      children: 1,
    });
  });

  it('leaves out what is not chosen, and a departure without an arrival', () => {
    expect(handoffPrefill('parkstay', 'a/b', { departure: '2026-11-08', children: 0 })).toEqual({
      provider: 'parkstay',
      location: 'a/b',
    });
  });
});

describe('stayQueryOf and sameStay', () => {
  it('needs both dates, and asks for 1 adult until guests are chosen', () => {
    const stay = {
      arrival: '2026-11-06',
      departure: '2026-11-08',
      adults: null,
      children: null,
      infants: null,
    };
    expect(stayQueryOf(stay)).toEqual({
      arrival: '2026-11-06',
      departure: '2026-11-08',
      adults: 1,
      children: 0,
      infants: 0,
    });
    expect(stayQueryOf({ ...stay, departure: null })).toBeNull();
  });

  it('compares the dates and the party', () => {
    const a = { arrival: '2026-11-06', departure: '2026-11-08', adults: 2 };
    expect(sameStay(a, { ...a, children: 0 })).toBe(true);
    expect(sameStay(a, { ...a, departure: '2026-11-09' })).toBe(false);
    expect(sameStay(a, { ...a, adults: 3 })).toBe(false);
    expect(sameStay(null, null)).toBe(true);
    expect(sameStay(a, null)).toBe(false);
  });
});

describe('formatOpensAt', () => {
  it("reads in the provider's time zone, with its abbreviation", () => {
    // Midnight 1 April 2027 in Perth is 16:00 UTC the day before.
    expect(formatOpensAt('2027-03-31T16:00:00.000Z', 'Australia/Perth')).toBe(
      'Thu 1 Apr 2027, 12:00 am AWST'
    );
    expect(formatOpensAt('2027-04-01T02:30:00.000Z', 'Australia/Perth')).toBe(
      'Thu 1 Apr 2027, 10:30 am AWST'
    );
  });

  it('is null for a timestamp or zone that is not one', () => {
    expect(formatOpensAt('soon', 'Australia/Perth')).toBeNull();
    expect(formatOpensAt('2027-03-31T16:00:00.000Z', 'Not/AZone')).toBeNull();
  });
});

describe('checkFailure', () => {
  const gated = { capabilities: { accessGate: true } } as never;
  const ungated = { capabilities: { accessGate: false } } as never;

  it('is the waiting queue only for a provider that has one', () => {
    expect(checkFailure({ code: 'ACCESS_GATE' }, gated)).toBe('access-gate');
    expect(checkFailure({ code: 'ACCESS_GATE' }, ungated)).toBe('other');
  });

  it('is a rate limit by its code, RATE_LIMITED, never by the wording', () => {
    expect(checkFailure({ code: 'RATE_LIMITED' }, ungated)).toBe('rate-limit');
    expect(checkFailure({ code: 'PROVIDER_ERROR' }, gated)).toBe('other');
    expect(checkFailure(undefined, gated)).toBe('other');
  });
});
