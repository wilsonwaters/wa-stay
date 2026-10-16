import type { BulkAvailabilityEntry, UnitKind } from '../../../../shared/types/provider.types';
import {
  availabilityLabel,
  deriveAvailability,
  sortByAvailability,
  type AvailabilityInput,
  type PlaceAvailability,
} from './deriveAvailability';

const BULK = { availability: true, bulkAvailability: true, accessGate: true };
const ONE_AT_A_TIME = { availability: true, bulkAvailability: false, accessGate: false };
const NO_AVAILABILITY = { availability: false, bulkAvailability: false, accessGate: false };
const ONLINE = { bookingMode: 'online' as const, kind: 'campground' as const };
const entry = (availableUnits: number, bookableUnits: number) => ({
  key: 'parkstay:20',
  availableUnits,
  bookableUnits,
});

describe('deriveAvailability', () => {
  const answered: AvailabilityInput = {
    staySet: true,
    capabilities: BULK,
    status: 'success',
    entry: entry(8, 24),
  };

  it.each<[string, Parameters<typeof deriveAvailability>[0], AvailabilityInput, PlaceAvailability]>(
    [
      // Each row beats every row below it.
      ['no stay', ONLINE, { ...answered, staySet: false }, { state: 'no-dates' }],
      [
        'not bookable online, even with an entry',
        { ...ONLINE, bookingMode: 'offline' },
        answered,
        { state: 'offline-booking' },
      ],
      [
        'booked by application',
        { ...ONLINE, bookingMode: 'application' },
        answered,
        { state: 'offline-booking' },
      ],
      [
        'a provider that checks one place at a time',
        ONLINE,
        { ...answered, capabilities: ONE_AT_A_TIME },
        { state: 'check-dates' },
      ],
      [
        'a provider with no availability',
        ONLINE,
        { ...answered, capabilities: NO_AVAILABILITY },
        { state: 'not-supported' },
      ],
      [
        'main says the provider has no bulk availability (CAPABILITY)',
        ONLINE,
        { ...answered, status: 'unsupported' },
        { state: 'not-supported' },
      ],
      [
        'the provider failed',
        ONLINE,
        { ...answered, status: 'error', errorCode: 'PROVIDER_ERROR' },
        { state: 'error', queue: false },
      ],
      [
        "the provider's waiting queue is up",
        ONLINE,
        { ...answered, status: 'error', errorCode: 'ACCESS_GATE' },
        { state: 'error', queue: true },
      ],
      ['still asking', ONLINE, { ...answered, status: 'loading' }, { state: 'loading' }],
      [
        'a unit free every night',
        ONLINE,
        answered,
        { state: 'available', availableUnits: 8, bookableUnits: 24 },
      ],
      [
        'none free, some bookable',
        ONLINE,
        { ...answered, entry: entry(0, 24) },
        { state: 'full' as const, bookableUnits: 24 },
      ],
      [
        'nothing bookable (past the 180-day horizon)',
        ONLINE,
        { ...answered, entry: entry(0, 0) },
        { state: 'none-open' },
      ],
      [
        'the provider answered without this place',
        ONLINE,
        { ...answered, entry: undefined },
        { state: 'unknown' },
      ],
      [
        'offline with nothing cached',
        ONLINE,
        { ...answered, status: 'idle', entry: undefined },
        { state: 'unknown' },
      ],
      [
        'a provider not known (yet)',
        ONLINE,
        { ...answered, capabilities: undefined },
        { state: 'unknown' },
      ],
    ]
  )('%s', (_, location, input, expected) => {
    expect(deriveAvailability(location, input)).toEqual(expected);
  });

  it('never counts a stray count: negative, fractional or missing numbers are whole units or none', () => {
    expect(deriveAvailability(ONLINE, { ...answered, entry: entry(2.7, 5) })).toEqual({
      state: 'available',
      availableUnits: 2,
      bookableUnits: 5,
    });
    expect(deriveAvailability(ONLINE, { ...answered, entry: entry(-3, 5) })).toEqual({
      state: 'full',
      bookableUnits: 5,
    });
    expect(
      deriveAvailability(ONLINE, { ...answered, entry: entry(Number.NaN, Number.NaN) })
    ).toEqual({ state: 'none-open' });
  });

  it('calls a queue only a queue for a provider that has an access gate (§12.2)', () => {
    expect(
      deriveAvailability(ONLINE, {
        ...answered,
        capabilities: { ...BULK, accessGate: false },
        status: 'error',
        errorCode: 'ACCESS_GATE',
      })
    ).toEqual({ state: 'error', queue: false });
  });
});

describe('deriveAvailability with stay types chosen', () => {
  /** A holiday park: sites and cabins, 5 of 30 units free (3 sites, 2 cabins). */
  const PARK = { bookingMode: 'online' as const, kind: 'holiday-park' as const };
  const mixed = (patch: Partial<BulkAvailabilityEntry> = {}): BulkAvailabilityEntry => ({
    key: 'fake:1',
    availableUnits: 5,
    bookableUnits: 30,
    byKind: {
      campsite: { availableUnits: 3, bookableUnits: 20 },
      cabin: { availableUnits: 2, bookableUnits: 10 },
    },
    ...patch,
  });
  const derive = (
    location: Parameters<typeof deriveAvailability>[0],
    entry: BulkAvailabilityEntry,
    stayTypes: UnitKind[]
  ) =>
    deriveAvailability(location, {
      staySet: true,
      capabilities: BULK,
      status: 'success',
      entry,
      stayTypes,
    });

  it('counts the totals when nothing is chosen', () => {
    expect(derive(PARK, mixed(), [])).toEqual({
      state: 'available',
      availableUnits: 5,
      bookableUnits: 30,
    });
    expect(
      deriveAvailability(PARK, {
        staySet: true,
        capabilities: BULK,
        status: 'success',
        entry: mixed(),
      })
    ).toEqual({ state: 'available', availableUnits: 5, bookableUnits: 30 });
  });

  it('counts the totals when every kind the place has is chosen, even with no byKind', () => {
    expect(derive(PARK, mixed(), ['campsite', 'cabin'])).toEqual({
      state: 'available',
      availableUnits: 5,
      bookableUnits: 30,
    });
    // A campground is sites only: Camping is all of it, byKind or not.
    expect(derive(ONLINE, entry(8, 24), ['campsite', 'dorm'])).toEqual({
      state: 'available',
      availableUnits: 8,
      bookableUnits: 24,
    });
    // Its own unit kinds decide, not its kind.
    expect(
      derive({ ...PARK, unitKinds: ['cabin'] }, mixed({ byKind: undefined }), ['cabin'])
    ).toEqual({ state: 'available', availableUnits: 5, bookableUnits: 30 });
  });

  it("counts only the chosen kinds' units at a place with other kinds too", () => {
    expect(derive(PARK, mixed(), ['cabin'])).toEqual({
      state: 'available',
      availableUnits: 2,
      bookableUnits: 10,
    });
    expect(derive(PARK, mixed(), ['campsite', 'room'])).toEqual({
      state: 'available',
      availableUnits: 3,
      bookableUnits: 20,
    });
  });

  it("sums the chosen kinds' counts over several, and reads full or not open from them", () => {
    const park = { ...PARK, unitKinds: ['campsite', 'cabin', 'glamping'] as UnitKind[] };
    const counts = mixed({
      byKind: {
        campsite: { availableUnits: 0, bookableUnits: 20 },
        cabin: { availableUnits: 2, bookableUnits: 10 },
        glamping: { availableUnits: 1, bookableUnits: 4 },
      },
    });
    expect(derive(park, counts, ['cabin', 'glamping'])).toEqual({
      state: 'available',
      availableUnits: 3,
      bookableUnits: 14,
    });
    expect(derive(park, counts, ['campsite'])).toEqual({ state: 'full', bookableUnits: 20 });
    expect(
      derive(park, mixed({ byKind: { cabin: { availableUnits: 0, bookableUnits: 0 } } }), ['cabin'])
    ).toEqual({ state: 'none-open' });
  });

  it('counts a chosen kind that byKind leaves out as none', () => {
    const park = { ...PARK, unitKinds: ['campsite', 'cabin', 'glamping'] as UnitKind[] };
    expect(derive(park, mixed(), ['cabin', 'glamping'])).toEqual({
      state: 'available',
      availableUnits: 2,
      bookableUnits: 10,
    });
  });

  it('says "check dates", never "not open", when byKind counts none of the chosen kinds', () => {
    expect(derive(PARK, mixed({ byKind: undefined }), ['cabin'])).toEqual({
      state: 'check-dates',
    });
    expect(
      derive(PARK, mixed({ byKind: { campsite: { availableUnits: 3, bookableUnits: 20 } } }), [
        'cabin',
      ])
    ).toEqual({ state: 'check-dates' });
    // Not usable: anything but an object of counts is no entry.
    const junk = { campsite: null, cabin: 'two' } as unknown as BulkAvailabilityEntry['byKind'];
    expect(derive(PARK, mixed({ byKind: junk }), ['cabin'])).toEqual({ state: 'check-dates' });
    expect(
      derive(PARK, mixed({ byKind: 'none' as unknown as BulkAvailabilityEntry['byKind'] }), [
        'cabin',
      ])
    ).toEqual({ state: 'check-dates' });
  });

  it("clamps the chosen kinds' NaN, negative and fractional counts to whole units or none", () => {
    expect(
      derive(
        PARK,
        mixed({ byKind: { cabin: { availableUnits: Number.NaN, bookableUnits: 4.8 } } }),
        ['cabin']
      )
    ).toEqual({ state: 'full', bookableUnits: 4 });
    expect(
      derive(
        PARK,
        mixed({ byKind: { cabin: { availableUnits: -2, bookableUnits: Number.NaN } } }),
        ['cabin']
      )
    ).toEqual({ state: 'none-open' });
  });

  it('keeps the order before the counts: no dates, info only, one at a time, loading, unknown', () => {
    const input: AvailabilityInput = {
      staySet: true,
      capabilities: BULK,
      status: 'success',
      entry: mixed({ byKind: undefined }),
      stayTypes: ['cabin'],
    };
    expect(deriveAvailability(PARK, { ...input, staySet: false })).toEqual({ state: 'no-dates' });
    expect(deriveAvailability({ ...PARK, bookingMode: 'offline' }, input)).toEqual({
      state: 'offline-booking',
    });
    expect(deriveAvailability(PARK, { ...input, capabilities: NO_AVAILABILITY })).toEqual({
      state: 'not-supported',
    });
    expect(deriveAvailability(PARK, { ...input, status: 'loading' })).toEqual({ state: 'loading' });
    expect(deriveAvailability(PARK, { ...input, entry: undefined })).toEqual({ state: 'unknown' });
  });

  it('lets "Available only" hide a place that says "check dates", and sorts it after full ones', () => {
    const places = [
      {
        name: 'Cabins unknown',
        availability: derive(PARK, mixed({ byKind: undefined }), ['cabin']),
      },
      { name: 'Cabins free', availability: derive(PARK, mixed(), ['cabin']) },
      {
        name: 'Cabins full',
        availability: derive(
          PARK,
          mixed({ byKind: { cabin: { availableUnits: 0, bookableUnits: 6 } } }),
          ['cabin']
        ),
      },
    ];
    // "Available only" keeps the places whose state is available (ExplorePage's `isAvailable`).
    expect(
      places.filter((place) => place.availability.state === 'available').map((p) => p.name)
    ).toEqual(['Cabins free']);
    expect(sortByAvailability(places, (place) => place.availability).map((p) => p.name)).toEqual([
      'Cabins free',
      'Cabins full',
      'Cabins unknown',
    ]);
    expect(availabilityLabel(places[0].availability, 'holiday-park', 'Fake')).toEqual({
      pill: 'Check dates',
      card: 'Check dates on the place page',
      tone: 'neutral',
    });
  });
});

describe('availabilityLabel', () => {
  const label = (availability: PlaceAvailability, kind = 'campground') =>
    availabilityLabel(availability, kind, 'ParkStay');

  it.each<[PlaceAvailability, string, string | null, string | null]>([
    [{ state: 'full', bookableUnits: 24 }, 'None free', 'No site free every night', 'neutral'],
    [{ state: 'none-open' }, 'Not open', 'No sites open for these dates', 'neutral'],
    [{ state: 'check-dates' }, 'Check dates', 'Check dates on the place page', 'neutral'],
    // The card already says "Info only": no second badge.
    [{ state: 'offline-booking' }, 'Info only', null, 'neutral'],
    [{ state: 'not-supported' }, '–', 'Availability not shared by ParkStay', 'neutral'],
    [{ state: 'unknown' }, '–', 'Availability unknown', 'neutral'],
    [{ state: 'error', queue: false }, '–', "Couldn't check ParkStay", 'danger'],
    [{ state: 'loading' }, '···', '', null],
  ])('%j reads "%s" on the pill and "%s" on the card', (availability, pill, card, tone) => {
    expect(label(availability)).toEqual({ pill, card, tone });
  });

  it('says how many of the total are free, so the card need not repeat the total', () => {
    expect(label({ state: 'available', availableUnits: 8, bookableUnits: 24 })).toEqual({
      pill: '8 available',
      card: '8 of 24 sites available',
      tone: 'available',
      statesTotal: true,
    });
  });

  it('never says "booked" when none is free every night: it may be split, closed or unreleased', () => {
    const full = label({ state: 'full', bookableUnits: 24 });
    expect(`${full?.pill} ${full?.card}`).not.toMatch(/booked/i);
    expect(label({ state: 'full', bookableUnits: 6 }, 'cabin')?.card).toBe(
      'No cabin free every night'
    );
  });

  it('shows nothing without dates', () => {
    expect(label({ state: 'no-dates' })).toBeNull();
  });

  it('keeps a waiting queue calm on every card: the same words, no danger tone', () => {
    expect(label({ state: 'error', queue: true })).toEqual({
      pill: '–',
      card: "Couldn't check ParkStay",
      tone: 'neutral',
    });
  });

  it('names the units by the kind of place, one or many', () => {
    const two = { state: 'available', availableUnits: 2, bookableUnits: 6 } as const;
    expect(label(two, 'caravan-park').card).toBe('2 of 6 sites available');
    expect(label(two, 'cabin').card).toBe('2 of 6 cabins available');
    expect(label(two, 'farm-stay').card).toBe('2 of 6 rooms available');
    expect(label({ state: 'available', availableUnits: 1, bookableUnits: 1 }).card).toBe(
      '1 of 1 site available'
    );
    expect(label({ state: 'none-open' }, 'cabin').card).toBe('No cabins open for these dates');
  });

  it('says only what is free when a provider reports fewer bookable than free', () => {
    expect(label({ state: 'available', availableUnits: 5, bookableUnits: 3 })).toEqual({
      pill: '5 available',
      card: '5 sites available',
      tone: 'available',
    });
  });
});

describe('sortByAvailability', () => {
  const place = (name: string, availability: PlaceAvailability) => ({ name, availability });
  const sort = (items: ReturnType<typeof place>[]) =>
    sortByAvailability(items, (item) => item.availability).map((item) => item.name);

  it('puts available places first, most free units first, then the other groups in order', () => {
    expect(
      sort([
        place('error', { state: 'error', queue: false }),
        place('unknown', { state: 'unknown' }),
        place('not shared', { state: 'not-supported' }),
        place('info only', { state: 'offline-booking' }),
        place('check dates', { state: 'check-dates' }),
        place('not open', { state: 'none-open' }),
        place('full', { state: 'full', bookableUnits: 9 }),
        place('2 free', { state: 'available', availableUnits: 2, bookableUnits: 9 }),
        place('7 free', { state: 'available', availableUnits: 7, bookableUnits: 9 }),
      ])
    ).toEqual([
      '7 free',
      '2 free',
      'full',
      'not open',
      'check dates',
      'info only',
      'not shared',
      'unknown',
      'error',
    ]);
  });

  it('keeps the given order within a group (stable), and returns a new array', () => {
    const items = [
      place('Zebra full', { state: 'full', bookableUnits: 1 }),
      place('Bay 3 free', { state: 'available', availableUnits: 3, bookableUnits: 9 }),
      place('Alpha full', { state: 'full', bookableUnits: 1 }),
      place('Cove 3 free', { state: 'available', availableUnits: 3, bookableUnits: 9 }),
      place('Mid full', { state: 'full', bookableUnits: 1 }),
    ];
    expect(sort(items)).toEqual([
      'Bay 3 free',
      'Cove 3 free',
      'Zebra full',
      'Alpha full',
      'Mid full',
    ]);
    expect(items[0].name).toBe('Zebra full');
  });
});
