import {
  DEFAULT_EXPLORE_PARAMS,
  hasActiveFilters,
  parseExploreParams,
  replaceExploreParams,
  serialiseExploreParams,
  type ExploreParams,
} from './exploreParams';

const params = (patch: Partial<ExploreParams>): ExploreParams => ({
  ...DEFAULT_EXPLORE_PARAMS,
  ...patch,
});

describe('exploreParams', () => {
  it('round-trips every key through the URL', () => {
    const full = params({
      q: 'Cape Range',
      providers: ['parkstay'],
      kinds: ['campground', 'hut'],
      regions: ['Pilbara', 'Kimberley'],
      amenities: ['Dogs permitted', 'Road access for 2WD/SUV'],
      online: true,
      arrival: '2026-12-01',
      departure: '2026-12-04',
      adults: 2,
      children: 1,
      infants: 0,
      avail: true,
      map: { lng: 121.5, lat: -26.25, zoom: 4.5 },
      follow: false,
      view: 'map',
      sel: 'parkstay:20',
    });
    const search = serialiseExploreParams(full);
    expect(search).toBe(
      '?q=Cape+Range&providers=parkstay&kinds=campground,hut&regions=Pilbara,Kimberley' +
        '&amenities=Dogs+permitted,Road+access+for+2WD%2FSUV&online=1&arrival=2026-12-01' +
        '&departure=2026-12-04&adults=2&children=1&infants=0&avail=1&map=121.5,-26.25,4.5&follow=0' +
        '&view=map&sel=parkstay%3A20'
    );
    expect(parseExploreParams(search).params).toEqual(full);
    expect(parseExploreParams(search).canonical).toBe(search);
  });

  it('writes nothing for the defaults', () => {
    expect(serialiseExploreParams(params({}))).toBe('');
    expect(parseExploreParams('').params).toEqual(DEFAULT_EXPLORE_PARAMS);
  });

  it('keeps a comma inside a list item and reads + as a space', () => {
    const search = serialiseExploreParams(params({ amenities: ['Camp kitchen, barbecue'] }));
    expect(search).toBe('?amenities=Camp+kitchen%2C+barbecue');
    expect(parseExploreParams(search).params.amenities).toEqual(['Camp kitchen, barbecue']);
  });

  it('drops invalid values and says so through the canonical query', () => {
    const { params: parsed, canonical } = parseExploreParams(
      '?q=bay&kinds=campground,castle&online=yes&arrival=2026-02-30&adults=0&children=11' +
        '&infants=x&map=200,-30,5&follow=no&view=grid&sel=nope'
    );
    expect(parsed).toEqual(params({ q: 'bay', kinds: ['campground'] }));
    expect(canonical).toBe('?q=bay&kinds=campground');
  });

  it('drops both dates when the arrival is on or after the departure', () => {
    for (const search of [
      '?arrival=2026-12-04&departure=2026-12-01',
      '?arrival=2026-12-04&departure=2026-12-04',
    ]) {
      const parsed = parseExploreParams(search).params;
      expect([parsed.arrival, parsed.departure]).toEqual([null, null]);
    }
    expect(parseExploreParams('?arrival=2026-12-01').params.arrival).toBe('2026-12-01');
  });

  it('drops regions, providers, amenities and a selection that are not known, silently', () => {
    const { params: parsed, canonical } = parseExploreParams(
      '?providers=parkstay,rac&regions=Pilbara,Atlantis&amenities=Toilet,Spa&sel=parkstay:999',
      {
        providers: ['parkstay'],
        regions: ['Pilbara', 'Kimberley'],
        amenities: ['Toilet'],
        keys: new Set(['parkstay:20']),
      }
    );
    expect(parsed).toMatchObject({
      providers: ['parkstay'],
      regions: ['Pilbara'],
      amenities: ['Toilet'],
      sel: null,
    });
    expect(canonical).toBe('?providers=parkstay&regions=Pilbara&amenities=Toilet');
  });

  it('keeps values it cannot check yet (the lists have not loaded)', () => {
    const parsed = parseExploreParams('?regions=Pilbara&sel=parkstay:20').params;
    expect(parsed.regions).toEqual(['Pilbara']);
    expect(parsed.sel).toBe('parkstay:20');
  });

  it('removes duplicates and empty list items', () => {
    expect(parseExploreParams('?regions=Pilbara,,Pilbara,%20').params.regions).toEqual(['Pilbara']);
  });

  it('keeps keys Explore does not own, after its own, when rewriting', () => {
    expect(parseExploreParams('?devFixture=5000&q=bay&online=2').canonical).toBe(
      '?q=bay&devFixture=5000'
    );
    expect(
      replaceExploreParams('?devFixture=5000&q=bay', params({ q: 'cape', online: true }))
    ).toBe('?q=cape&online=1&devFixture=5000');
  });

  it('rounds the camera to a sensible precision', () => {
    expect(
      serialiseExploreParams(
        params({ map: { lng: 115.123456789, lat: -31.987654321, zoom: 7.6543 } })
      )
    ).toBe('?map=115.12346,-31.98765,7.65');
  });

  it('keeps "Available only" with an arrival, even before the departure is chosen again, and drops it with no dates', () => {
    expect(
      parseExploreParams('?arrival=2026-12-01&departure=2026-12-04&avail=1').params.avail
    ).toBe(true);
    expect(parseExploreParams('?arrival=2026-12-01&avail=1').canonical).toBe(
      '?arrival=2026-12-01&avail=1'
    );
    expect(parseExploreParams('?avail=1')).toEqual({
      params: expect.objectContaining({ avail: false }),
      canonical: '',
    });
    expect(
      parseExploreParams('?arrival=2026-12-01&departure=2026-12-04&avail=yes').params.avail
    ).toBe(false);
  });

  it('counts only real filters as active (not the text, map or stay)', () => {
    expect(hasActiveFilters(params({ q: 'bay', map: { lng: 1, lat: 1, zoom: 3 } }))).toBe(false);
    expect(hasActiveFilters(params({ online: true }))).toBe(true);
    expect(hasActiveFilters(params({ regions: ['Pilbara'] }))).toBe(true);
  });
});
