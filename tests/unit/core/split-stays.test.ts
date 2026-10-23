/**
 * Split stays (`src/main/core/split-stays.ts`): `splitStaysOf` derives the fewest parts across
 * units that are one place each, per kind and only when no unit of the kind is free for the
 * whole stay, under the stay rules and the price rule; it lists every valid reported split
 * stay and ignores invalid ones; it orders them best first. `withSplitStayLinks` adds the
 * contact page or each part's booking page, only on the provider's own https site.
 */
import { splitStaysOf, withSplitStayLinks } from '@main/core/split-stays';
import type { BookingLinkProvider } from '@main/core/booking-link';
import type {
  NightStatus,
  StayQuery,
  UnitAvailability,
  UnitKind,
  UnitSplitStay,
} from '@shared/types/provider.types';

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

/** A 5-night stay, 1–6 Dec 2099. */
const ARRIVAL = '2099-12-01';
const DEPARTURE = '2099-12-06';
const DATES = ['2099-12-01', '2099-12-02', '2099-12-03', '2099-12-04', '2099-12-05'];
const STAY: StayQuery = { arrival: ARRIVAL, departure: DEPARTURE, adults: 2 };

type NightExtra = Partial<Pick<NightStatus, 'noArrival' | 'noDeparture' | 'minNights' | 'price'>>;

/**
 * A unit whose nights are written one character a night: `#` free ($30), `.` booked, `s` split
 * ($90, the category's rate), `m` refused under the stay rules (`min-stay`), `u` free with no
 * price. `extra` sets more on a night by its index.
 */
function unit(
  unitId: string,
  pattern: string,
  options: Partial<UnitAvailability> & { kind?: UnitKind; extra?: Record<number, NightExtra> } = {}
): UnitAvailability {
  const { kind = 'campsite', extra = {}, ...rest } = options;
  const nights: NightStatus[] = DATES.map((date, i): NightStatus => {
    const night = ((): NightStatus => {
      switch (pattern[i]) {
        case '#':
          return { date, state: 'available', price: 30 };
        case 'u':
          return { date, state: 'available' };
        case 's':
          return { date, state: 'unknown', reason: 'split', price: 90 };
        case 'm':
          return { date, state: 'unknown', reason: 'min-stay', price: 30 };
        default:
          return { date, state: 'booked' };
      }
    })();
    return { ...night, ...extra[i] };
  });
  return {
    unitId,
    unitName: `Unit ${unitId}`,
    unitKind: kind,
    nights,
    fullyAvailable: pattern === '#####',
    ...rest,
  };
}

/** A category (RAC-like): free sites counted, none for the whole stay, with a report. */
function category(unitId: string, unitName: string, report: UnitSplitStay, kind?: UnitKind) {
  return unit(unitId, 'sssss', { unitName, freeCount: 0, splitStay: report, kind });
}

/** A provider with links on its own site, each saying which unit and dates it is for. */
function provider(links: Partial<BookingLinkProvider['links']> = {}): BookingLinkProvider {
  return {
    manifest: { id: 'test', website: 'https://www.test.example' },
    links: {
      location: (externalId) => `https://www.test.example/places/${externalId}/`,
      booking: (externalId, stay, unitId) =>
        `https://book.test.example/${externalId}/${unitId}?from=${stay?.arrival}&to=${stay?.departure}`,
      ...links,
    },
  };
}

beforeEach(() => {
  for (const level of ['info', 'warn', 'error', 'debug']) mockLog[level].mockClear();
});

describe('splitStaysOf: derived across units that are one place each', () => {
  it('two units (A nights 1–2, B nights 3–5) give two parts across 2 units, with totals', () => {
    const split = splitStaysOf([unit('a', '##...'), unit('b', '..###')], ARRIVAL, DEPARTURE);

    expect(split).toEqual([
      {
        unitKind: 'campsite',
        booking: 'separate',
        units: 2,
        parts: [
          {
            unitId: 'a',
            unitName: 'Unit a',
            arrival: '2099-12-01',
            departure: '2099-12-03',
            total: 60,
          },
          {
            unitId: 'b',
            unitName: 'Unit b',
            arrival: '2099-12-03',
            departure: '2099-12-06',
            total: 90,
          },
        ],
        total: 150,
      },
    ]);
  });

  it('takes the fewest parts among the options', () => {
    const units = [
      unit('n1', '#....'),
      unit('n2', '.#...'),
      unit('n3', '..#..'),
      unit('n4', '...#.'),
      unit('n5', '....#'),
      unit('wide', '###..'),
      unit('late', '..###'),
    ];
    const [split] = splitStaysOf(units, ARRIVAL, DEPARTURE);
    expect(split.parts?.map((p) => [p.unitId, p.arrival, p.departure])).toEqual([
      ['wide', '2099-12-01', '2099-12-03'],
      ['late', '2099-12-03', '2099-12-06'],
    ]);
  });

  it('counts a unit used twice once: "across 2" with three parts', () => {
    const units = [unit('a', '##.##'), unit('b', '..#..')];
    const [split] = splitStaysOf(units, ARRIVAL, DEPARTURE);
    expect(split.units).toBe(2);
    expect(split.parts?.map((p) => p.unitId)).toEqual(['a', 'b', 'a']);
  });

  it('never crosses kinds, and derives each kind on its own', () => {
    expect(
      splitStaysOf([unit('s', '##...'), unit('c', '..###', { kind: 'cabin' })], ARRIVAL, DEPARTURE)
    ).toEqual([]);

    const both = splitStaysOf(
      [
        unit('c1', '###..', { kind: 'cabin' }),
        unit('s1', '##...'),
        unit('c2', '...##', { kind: 'cabin' }),
        unit('s2', '..###'),
      ],
      ARRIVAL,
      DEPARTURE
    );
    expect(both.map((split) => [split.unitKind, split.parts?.map((p) => p.unitId)])).toEqual([
      ['cabin', ['c1', 'c2']],
      ['campsite', ['s1', 's2']],
    ]);
  });

  it('gives no kind when the units give none (they count as other)', () => {
    const [split] = splitStaysOf(
      [unit('a', '##...', { unitKind: undefined }), unit('b', '..###', { unitKind: undefined })],
      ARRIVAL,
      DEPARTURE
    );
    expect(split.booking).toBe('separate');
    expect(split.unitKind).toBeUndefined();
  });

  it('never derives from units with a freeCount (each counts several places)', () => {
    expect(
      splitStaysOf(
        [unit('cat:1', '##...', { freeCount: 0 }), unit('cat:2', '..###', { freeCount: 0 })],
        ARRIVAL,
        DEPARTURE
      )
    ).toEqual([]);
  });

  it('derives nothing for a kind with a unit free for the whole stay, but lists a reported one', () => {
    const units = [unit('free', '#####'), unit('a', '##...'), unit('b', '..###')];
    expect(splitStaysOf(units, ARRIVAL, DEPARTURE)).toEqual([]);

    const reported = category('cat:1', 'Powered Site', { booking: 'contact' });
    expect(splitStaysOf([...units, reported], ARRIVAL, DEPARTURE)).toEqual([
      expect.objectContaining({ booking: 'contact', unitId: 'cat:1', unitName: 'Powered Site' }),
    ]);
  });

  it('a unit free for the whole stay at a price over the limit does not stop a derived one', () => {
    const units = [
      unit('dear', '#####', { extra: { 0: { price: 80 } } }),
      unit('a', '##...'),
      unit('b', '..###'),
    ];
    expect(splitStaysOf(units, ARRIVAL, DEPARTURE)).toEqual([]);
    expect(splitStaysOf(units, ARRIVAL, DEPARTURE, { maxPrice: 50 })).toHaveLength(1);
  });

  it('never counts a min-stay or split night toward a part', () => {
    expect(splitStaysOf([unit('a', '##...'), unit('b', '..mmm')], ARRIVAL, DEPARTURE)).toEqual([]);
    expect(splitStaysOf([unit('a', '##...'), unit('b', '..s##')], ARRIVAL, DEPARTURE)).toEqual([]);
  });

  it('moves a boundary off a day the next unit takes no arrivals', () => {
    // A free nights 1–3, B nights 2–5: by length, A for 1 night then B for 4
    const free = [unit('a', '###..'), unit('b', '.####')];
    const [first] = splitStaysOf(free, ARRIVAL, DEPARTURE);
    expect(first.parts?.map((p) => p.departure)).toEqual(['2099-12-02', '2099-12-06']);

    const noArrival = [
      unit('a', '###..'),
      unit('b', '.####', { extra: { 1: { noArrival: true } } }),
    ];
    const [moved] = splitStaysOf(noArrival, ARRIVAL, DEPARTURE);
    expect(moved.parts?.map((p) => [p.unitId, p.arrival])).toEqual([
      ['a', '2099-12-01'],
      ['b', '2099-12-03'],
    ]);
  });

  it('moves a boundary off a morning the old unit takes no departures', () => {
    const units = [unit('a', '###..', { extra: { 1: { noDeparture: true } } }), unit('b', '.####')];
    const [moved] = splitStaysOf(units, ARRIVAL, DEPARTURE);
    expect(moved.parts?.map((p) => [p.unitId, p.arrival, p.departure])).toEqual([
      ['a', '2099-12-01', '2099-12-03'],
      ['b', '2099-12-03', '2099-12-06'],
    ]);
  });

  it('leaves no split when the only move falls on a refused day', () => {
    expect(
      splitStaysOf(
        [unit('a', '##...'), unit('b', '..###', { extra: { 2: { noArrival: true } } })],
        ARRIVAL,
        DEPARTURE
      )
    ).toEqual([]);
    expect(
      splitStaysOf(
        [unit('a', '##...', { extra: { 2: { noDeparture: true } } }), unit('b', '..###')],
        ARRIVAL,
        DEPARTURE
      )
    ).toEqual([]);
  });

  it('refuses a part shorter than its minimum: the unit’s, or its first night’s', () => {
    expect(
      splitStaysOf([unit('a', '##...'), unit('b', '..###', { minNights: 4 })], ARRIVAL, DEPARTURE)
    ).toEqual([]);
    const nightRule = [
      unit('a', '##...'),
      unit('b', '..###', { extra: { 2: { minNights: 4 } } }),
      unit('c', '.####'),
    ];
    const [split] = splitStaysOf(nightRule, ARRIVAL, DEPARTURE);
    expect(split.parts?.map((p) => p.unitId)).toEqual(['a', 'c']);
  });

  it('applies the price rule per part, and passes a part with an unpriced night', () => {
    const dear = [unit('a', '##...'), unit('b', '..###', { extra: { 4: { price: 40 } } })];
    expect(splitStaysOf(dear, ARRIVAL, DEPARTURE, { maxPrice: 35 })).toEqual([]);
    expect(splitStaysOf(dear, ARRIVAL, DEPARTURE, { maxPrice: 40 })).toHaveLength(1);

    const unpriced = [unit('a', '##...'), unit('b', '..uu#', { extra: { 4: { price: 40 } } })];
    const [split] = splitStaysOf(unpriced, ARRIVAL, DEPARTURE, { maxPrice: 35 });
    // A part with a night with no price passes, and neither it nor the stay has a total
    expect(split.parts?.map((p) => p.total)).toEqual([60, undefined]);
    expect(split.total).toBeUndefined();
  });

  it('finds nothing for a one-night stay, or dates that are not calendar dates', () => {
    expect(splitStaysOf([unit('a', '#....'), unit('b', '#....')], ARRIVAL, DATES[1])).toEqual([]);
    expect(splitStaysOf([unit('a', '##...'), unit('b', '..###')], 'soon', DEPARTURE)).toEqual([]);
  });
});

describe('splitStaysOf: reported split stays', () => {
  it('a valid contact report gives a split stay on its unit, priced from its nights', () => {
    expect(
      splitStaysOf([category('cat:7', 'Powered Site', { booking: 'contact' })], ARRIVAL, DEPARTURE)
    ).toEqual([
      {
        unitKind: 'campsite',
        booking: 'contact',
        unitId: 'cat:7',
        unitName: 'Powered Site',
        total: 450,
      },
    ]);
  });

  it('a valid separate report with parts gives its parts on its unit, each with its total', () => {
    const parts = [
      { arrival: '2099-12-01', departure: '2099-12-02' },
      { arrival: '2099-12-02', departure: '2099-12-04' },
      { arrival: '2099-12-04', departure: '2099-12-06' },
    ];
    const classUnit = unit('class:117', '#s#s#', {
      unitName: 'Campsite',
      splitStay: { booking: 'separate', parts, units: 3 },
    });
    expect(splitStaysOf([classUnit], ARRIVAL, DEPARTURE)).toEqual([
      {
        unitKind: 'campsite',
        booking: 'separate',
        unitId: 'class:117',
        unitName: 'Campsite',
        units: 3,
        parts: [
          { unitId: 'class:117', unitName: 'Campsite', ...parts[0], total: 30 },
          { unitId: 'class:117', unitName: 'Campsite', ...parts[1], total: 120 },
          { unitId: 'class:117', unitName: 'Campsite', ...parts[2], total: 120 },
        ],
        total: 270,
      },
    ]);
  });

  it.each<[string, UnitAvailability]>([
    ['a unit free for the whole stay', unit('bad', '#####', { splitStay: { booking: 'contact' } })],
    ['a booked night', unit('bad', 'ss.ss', { splitStay: { booking: 'contact' } })],
    ['a night not reported', { ...category('bad', 'Bad', { booking: 'contact' }), nights: [] }],
    [
      'no split night',
      unit('bad', '#####', { fullyAvailable: false, splitStay: { booking: 'contact' } }),
    ],
    [
      'free units counted',
      unit('bad', 'sssss', { freeCount: 2, splitStay: { booking: 'contact' } }),
    ],
    ['a count of 1', category('bad', 'Bad', { booking: 'contact', units: 1 })],
    ['a count that is not whole', category('bad', 'Bad', { booking: 'contact', units: 2.5 })],
    [
      'a way to book it does not know',
      category('bad', 'Bad', { booking: 'phone' as unknown as 'contact' }),
    ],
    [
      'one part',
      category('bad', 'Bad', {
        booking: 'separate',
        parts: [{ arrival: ARRIVAL, departure: DEPARTURE }],
      }),
    ],
    [
      'parts with a gap',
      category('bad', 'Bad', {
        booking: 'separate',
        parts: [
          { arrival: '2099-12-01', departure: '2099-12-02' },
          { arrival: '2099-12-03', departure: '2099-12-06' },
        ],
      }),
    ],
    [
      'parts that overlap',
      category('bad', 'Bad', {
        booking: 'separate',
        parts: [
          { arrival: '2099-12-01', departure: '2099-12-04' },
          { arrival: '2099-12-03', departure: '2099-12-06' },
        ],
      }),
    ],
    [
      'parts that stop short of the departure',
      category('bad', 'Bad', {
        booking: 'separate',
        parts: [
          { arrival: '2099-12-01', departure: '2099-12-03' },
          { arrival: '2099-12-03', departure: '2099-12-05' },
        ],
      }),
    ],
    [
      'more units than parts',
      category('bad', 'Bad', {
        booking: 'separate',
        units: 5,
        parts: [
          { arrival: '2099-12-01', departure: '2099-12-03' },
          { arrival: '2099-12-03', departure: '2099-12-06' },
        ],
      }),
    ],
    ...(['booked', 'closed', 'not-released'] as const).map((state): [string, UnitAvailability] => {
      const bad = category('bad', 'Bad', { booking: 'contact' });
      return [
        `a ${state} night marked split`,
        { ...bad, nights: bad.nights.map((n, i) => (i === 2 ? { ...n, state } : n)) },
      ];
    }),
  ])('ignores a report with %s, in one debug line naming the provider and unit', (_why, bad) => {
    expect(splitStaysOf([bad], ARRIVAL, DEPARTURE, { providerId: 'test' })).toEqual([]);
    expect(mockLog.debug).toHaveBeenCalledTimes(1);
    expect(mockLog.debug.mock.calls[0][0]).toMatch(
      /^test: ignored the split stay reported on unit bad: /
    );
  });

  it('takes a split night with room, unknown or available, and as many units as parts', () => {
    const report = category('cat:1', 'Powered Site', { booking: 'contact' });
    const available: UnitAvailability = {
      ...report,
      nights: report.nights.map((n, i) => (i === 0 ? { ...n, state: 'available' as const } : n)),
    };
    expect(splitStaysOf([available], ARRIVAL, DEPARTURE)).toHaveLength(1);

    const parts = [
      { arrival: '2099-12-01', departure: '2099-12-03' },
      { arrival: '2099-12-03', departure: '2099-12-06' },
    ];
    const asMany = category('cat:2', 'Ensuite Site', { booking: 'separate', units: 2, parts });
    expect(splitStaysOf([asMany], ARRIVAL, DEPARTURE)).toEqual([
      expect.objectContaining({ unitId: 'cat:2', units: 2 }),
    ]);
  });

  it('logs nothing for an ignored report when quiet (the watch reads)', () => {
    const bad = category('bad', 'Bad', { booking: 'contact', units: 1 });
    expect(splitStaysOf([bad], ARRIVAL, DEPARTURE, { quiet: true })).toEqual([]);
    expect(mockLog.debug).not.toHaveBeenCalled();
  });

  it('drops a report whose nights break the price rule, and keeps one with unpriced nights', () => {
    const report = category('cat:1', 'Powered Site', { booking: 'contact' });
    expect(splitStaysOf([report], ARRIVAL, DEPARTURE, { maxPrice: 80 })).toEqual([]);
    expect(splitStaysOf([report], ARRIVAL, DEPARTURE, { maxPrice: 90 })).toHaveLength(1);

    const unpriced: UnitAvailability = {
      ...report,
      nights: report.nights.map(({ price: _price, ...night }) => night),
    };
    const [split] = splitStaysOf([unpriced], ARRIVAL, DEPARTURE, { maxPrice: 80 });
    expect(split).toMatchObject({ unitId: 'cat:1' });
    expect(split.total).toBeUndefined();
  });
});

describe('splitStaysOf: order', () => {
  it('fewest bookings first (parts, else the count), then reported before derived, then unit order', () => {
    const twoParts = [
      { arrival: '2099-12-01', departure: '2099-12-03' },
      { arrival: '2099-12-03', departure: '2099-12-06' },
    ];
    const units = [
      category('cat:1', 'Unknown count', { booking: 'contact' }),
      category('cat:2', 'Three sites', { booking: 'contact', units: 3 }),
      unit('a', '##...'),
      unit('b', '..###'),
      unit('class:9', 'sssss', {
        unitName: 'Class',
        splitStay: { booking: 'separate', parts: twoParts },
      }),
      category('cat:3', 'Unknown too', { booking: 'contact' }),
    ];

    expect(splitStaysOf(units, ARRIVAL, DEPARTURE).map((s) => s.unitId ?? 'derived')).toEqual([
      'class:9',
      'derived',
      'cat:2',
      'cat:1',
      'cat:3',
    ]);
  });
});

describe('withSplitStayLinks', () => {
  const contact = (): ReturnType<typeof splitStaysOf> =>
    splitStaysOf([category('cat:1', 'Powered Site', { booking: 'contact' })], ARRIVAL, DEPARTURE);
  const derived = (): ReturnType<typeof splitStaysOf> =>
    splitStaysOf([unit('a', '##...'), unit('b', '..###')], ARRIVAL, DEPARTURE);

  it('gives each part of a separate split stay its booking page, for its dates and unit', () => {
    const [split] = withSplitStayLinks(provider(), 'p1', STAY, derived());
    expect(split.parts?.map((p) => p.bookingUrl)).toEqual([
      'https://book.test.example/p1/a?from=2099-12-01&to=2099-12-03',
      'https://book.test.example/p1/b?from=2099-12-03&to=2099-12-06',
    ]);
    expect(split.contactUrl).toBeUndefined();
  });

  it('passes the stay fields on to each part’s booking page', () => {
    const booking = jest.fn(() => 'https://www.test.example/book');
    withSplitStayLinks(
      provider({ booking }),
      'p1',
      { ...STAY, params: { gear: 'tent' } },
      derived()
    );
    expect(booking).toHaveBeenCalledWith(
      'p1',
      { arrival: '2099-12-01', departure: '2099-12-03', adults: 2, params: { gear: 'tent' } },
      'a'
    );
  });

  it('a contact split stay gets the contact page, else the place’s page, else none', () => {
    const withContact = provider({
      contact: (id) => `https://www.test.example/places/${id}/contact-us/`,
    });
    expect(withSplitStayLinks(withContact, 'p1', STAY, contact())[0].contactUrl).toBe(
      'https://www.test.example/places/p1/contact-us/'
    );
    expect(withSplitStayLinks(provider(), 'p1', STAY, contact())[0].contactUrl).toBe(
      'https://www.test.example/places/p1/'
    );
    const none = provider({ contact: () => null, location: () => null });
    const [split] = withSplitStayLinks(none, 'p1', STAY, contact());
    expect(split).toEqual(contact()[0]);
    expect('contactUrl' in split).toBe(false);
  });

  it('refuses links off the provider’s site, logged by origin only', () => {
    const offSite = provider({
      contact: () => 'https://evil.example/contact?ref=secret',
      location: () => 'http://www.test.example/places/p1/',
      booking: () => 'https://evil.example/book?token=secret',
    });
    const [split] = withSplitStayLinks(offSite, 'p1', STAY, contact());
    expect(split.contactUrl).toBeUndefined();
    const [parts] = withSplitStayLinks(offSite, 'p1', STAY, derived());
    expect(parts.parts?.map((p) => p.bookingUrl)).toEqual([undefined, undefined]);

    const logged = mockLog.warn.mock.calls.map(([line]) => String(line));
    expect(logged.some((line) => line.includes('https://evil.example'))).toBe(true);
    expect(logged.join('\n')).not.toMatch(/secret|contact\?|\/book/);
  });

  it('catches a links call that throws, logged by its error’s name, and logs nothing when quiet', () => {
    const throwing = provider({
      contact: () => {
        throw new TypeError('https://www.test.example/secret');
      },
      booking: () => {
        throw new RangeError('no');
      },
    });
    const [split] = withSplitStayLinks(throwing, 'p1', STAY, contact());
    // The place's page stands in for the contact page that failed
    expect(split.contactUrl).toBe('https://www.test.example/places/p1/');
    const [parts] = withSplitStayLinks(throwing, 'p1', STAY, derived());
    expect(parts.parts?.every((p) => p.bookingUrl === undefined)).toBe(true);
    expect(mockLog.warn.mock.calls.map(([line]) => line)).toEqual([
      'test: links.contact failed: TypeError',
      'test: links.booking failed: RangeError',
      'test: links.booking failed: RangeError',
    ]);

    mockLog.warn.mockClear();
    withSplitStayLinks(throwing, 'p1', STAY, [...contact(), ...derived()], { quiet: true });
    expect(mockLog.warn).not.toHaveBeenCalled();
  });

  it('asks for the place’s page only when the contact page is missing or refused', () => {
    const location = jest.fn((id: string) => `https://www.test.example/places/${id}/`);
    const contactUrlWith = (contactLink: () => string | null) =>
      withSplitStayLinks(provider({ contact: contactLink, location }), 'p1', STAY, contact())[0]
        .contactUrl;

    expect(contactUrlWith(() => 'https://www.test.example/contact')).toBe(
      'https://www.test.example/contact'
    );
    expect(location).not.toHaveBeenCalled();

    expect(contactUrlWith(() => null)).toBe('https://www.test.example/places/p1/');
    expect(location).toHaveBeenCalledTimes(1);
    expect(contactUrlWith(() => 'https://elsewhere.example/contact')).toBe(
      'https://www.test.example/places/p1/'
    );
    expect(location).toHaveBeenCalledTimes(2);
    // A provider with no contact page at all
    expect(withSplitStayLinks(provider({ location }), 'p1', STAY, contact())[0].contactUrl).toBe(
      'https://www.test.example/places/p1/'
    );
    expect(location).toHaveBeenCalledTimes(3);
  });

  it('asks for the contact page once per call, and leaves its input as it was', () => {
    const contactLink = jest.fn(() => 'https://www.test.example/contact');
    const input = [...contact(), ...contact()];
    const before = structuredClone(input);
    withSplitStayLinks(provider({ contact: contactLink }), 'p1', STAY, input);
    expect(contactLink).toHaveBeenCalledTimes(1);
    expect(input).toEqual(before);
  });
});
