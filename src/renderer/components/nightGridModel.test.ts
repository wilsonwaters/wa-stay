import type { NightState, UnitAvailability } from '../../shared/types/provider.types';
import {
  formatPrice,
  isFreeEveryNightIfYouMove,
  isFullyAvailable,
  isMinStayNight,
  minStayRules,
  nightCellText,
  nightHeading,
  noFullRowsMessage,
  showAllLabel,
  stayNights,
  stayRangeLabel,
  summariseAvailability,
  summaryLine,
  stayMinimum,
  summaryNotes,
  unitStanding,
} from './nightGridModel';

const SITE = { one: 'site', many: 'sites' };
const NIGHTS = ['2026-11-06', '2026-11-07'];

function unit(id: string, states: (NightState | null)[]): UnitAvailability {
  const nights = NIGHTS.flatMap((date, i) =>
    states[i] === null ? [] : [{ date, state: states[i] as NightState }]
  );
  return {
    unitId: id,
    unitName: id,
    nights,
    fullyAvailable: nights.length === NIGHTS.length && nights.every((n) => n.state === 'available'),
  };
}

describe('stayNights', () => {
  it('has one night per date from arrival to the night before departure', () => {
    expect(stayNights('2026-11-06', '2026-11-08')).toEqual(NIGHTS);
    expect(stayNights('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
    ]);
  });
});

const summaryOf = (over: Partial<ReturnType<typeof summariseAvailability>>) => ({
  total: 0,
  known: 0,
  fully: 0,
  partly: 0,
  notReleased: 0,
  unknown: 0,
  nights: 2,
  ...over,
});

describe('unitStanding', () => {
  it('lets only known nights decide: booked or closed takes a unit, nothing else does', () => {
    expect(unitStanding(unit('a', ['available', 'available']), NIGHTS)).toBe('free');
    expect(unitStanding(unit('b', ['available', 'booked']), NIGHTS)).toBe('taken');
    expect(unitStanding(unit('c', ['closed', null]), NIGHTS)).toBe('taken');
    expect(unitStanding(unit('d', ['available', 'not-released']), NIGHTS)).toBe('not-released');
    expect(unitStanding(unit('e', ['available', null]), NIGHTS)).toBe('unknown');
    expect(unitStanding(unit('f', [null, null]), NIGHTS)).toBe('unknown');
    // An empty stay is never free.
    expect(unitStanding(unit('g', ['available', 'available']), [])).toBe('unknown');
    expect(isFullyAvailable(unit('g', ['available', 'available']), [])).toBe(false);
  });
});

describe('summariseAvailability', () => {
  it('counts only units whose known nights settle the stay, and notes the rest', () => {
    const units = [
      unit('a', ['available', 'available']),
      unit('b', ['available', 'booked']),
      unit('c', ['booked', 'booked']),
      unit('d', ['available', 'not-released']),
      unit('e', ['not-released', 'not-released']),
      // A night the provider did not report is unknown: not free, and not taken either.
      unit('f', ['available', null]),
    ];
    const summary = summariseAvailability(units, NIGHTS);
    expect(summary).toEqual({
      total: 6,
      known: 3,
      fully: 1,
      partly: 1,
      notReleased: 2,
      unknown: 1,
      nights: 2,
    });
    expect(summaryLine(summary, SITE, 'ParkStay')).toBe('1 of 3 sites free for all 2 nights');
    expect(summaryNotes(summary, SITE, 'ParkStay')).toEqual([
      "2 more sites have nights that aren't released yet.",
      "ParkStay didn't say which nights are free for 1 more site.",
    ]);
  });

  it("says the provider didn't say when no night is known (a class-listed place)", () => {
    const summary = summariseAvailability([unit('class', [null, null])], NIGHTS);
    expect(summary).toMatchObject({ total: 1, known: 0, unknown: 1 });
    expect(summaryLine(summary, SITE, 'ParkStay')).toBe(
      "ParkStay didn't say which nights are free; check on ParkStay"
    );
    expect(summaryNotes(summary, SITE, 'ParkStay')).toEqual([]);
    expect(noFullRowsMessage(summary, SITE)).toBe(
      'Turn off "Fully available only" to see each site\'s nights.'
    );
  });

  it("says the nights aren't released yet when none is, never that they are taken", () => {
    const summary = summariseAvailability(
      [unit('a', ['not-released', 'not-released']), unit('b', ['not-released', null])],
      NIGHTS
    );
    expect(summaryLine(summary, SITE, 'ParkStay')).toBe(
      "These nights aren't released for booking yet"
    );
    expect(summaryNotes(summary, SITE, 'ParkStay')).toEqual([]);
    expect(noFullRowsMessage(summary, SITE)).not.toMatch(/No sites are free/);
  });

  it('reads well for one night and one unit', () => {
    const summary = summariseAvailability([unit('a', ['available', null])], ['2026-11-06']);
    expect(summaryLine(summary, SITE, 'ParkStay')).toBe('1 of 1 site free for 1 night');
  });
});

describe('free counts (a provider that counts its units, such as RAC)', () => {
  const SPOTS = { one: 'spot', many: 'spots' };
  /** A category of sites: free for the stay with `freeCount` of them, or taken with 0. */
  const category = (id: string, states: (NightState | null)[], freeCount: number) => ({
    ...unit(id, states),
    freeCount,
  });

  it('counts the units the free ones stand for, and gives no total', () => {
    const units = [
      category('powered', ['available', 'available'], 51),
      category('ensuite', ['booked', 'booked'], 0),
    ];
    const summary = summariseAvailability(units, NIGHTS);
    expect(summary).toMatchObject({ total: 2, known: 2, fully: 1, freeUnits: 51 });
    expect(summaryLine(summary, SPOTS, 'RAC')).toBe('51 spots free for all 2 nights');
    expect(summaryLine(summariseAvailability(units.slice(0, 1), NIGHTS), SITE, 'RAC')).toBe(
      '51 sites free for all 2 nights'
    );
  });

  it('says none are free, with no total, when no unit is free for the whole stay', () => {
    const units = [
      category('powered', ['available', 'booked'], 0),
      category('ensuite', ['booked', 'booked'], 0),
    ];
    const summary = summariseAvailability(units, NIGHTS);
    expect(summary.freeUnits).toBe(0);
    expect(summaryLine(summary, SPOTS, 'RAC')).toBe('No spots free for all 2 nights');
    expect(summaryLine({ ...summary, nights: 1 }, SITE, 'RAC')).toBe('No sites free for 1 night');
    expect(
      summaryLine(
        summariseAvailability([category('one', ['available', 'available'], 1)], NIGHTS),
        SITE,
        'RAC'
      )
    ).toBe('1 site free for all 2 nights');
  });

  it('counts a free unit with a count that is not a whole number of 1 or more as one', () => {
    const odd = [
      { ...unit('a', ['available', 'available']), freeCount: 2.5 },
      { ...unit('b', ['available', 'available']), freeCount: 0 },
      category('c', ['available', 'available'], 3),
    ];
    expect(summariseAvailability(odd, NIGHTS).freeUnits).toBe(5);
  });

  it('keeps "N of M" for a provider whose units are one each (ParkStay)', () => {
    const summary = summariseAvailability(
      [unit('a', ['available', 'available']), unit('b', ['booked', 'available'])],
      NIGHTS
    );
    expect(summary).not.toHaveProperty('freeUnits');
    expect(summaryLine(summary, SITE, 'ParkStay')).toBe('1 of 2 sites free for all 2 nights');
  });

  it('says why when no unit is settled, as before', () => {
    const summary = summariseAvailability(
      [category('a', ['not-released', 'not-released'], 0)],
      NIGHTS
    );
    expect(summaryLine(summary, SPOTS, 'RAC')).toBe("These nights aren't released for booking yet");
  });
});

describe('showAllLabel', () => {
  it('counts rows as units, or as types when each stands for several (RAC)', () => {
    expect(showAllLabel(false, 24, SITE, false)).toBe('Show all 24 sites');
    expect(showAllLabel(true, 24, SITE, false)).toBe('Show fewer sites');
    const SPOTS = { one: 'spot', many: 'spots' };
    expect(showAllLabel(false, 12, SPOTS, true)).toBe('Show all 12 spot types');
    expect(showAllLabel(true, 12, SPOTS, true)).toBe('Show fewer spot types');
  });
});

describe('noFullRowsMessage', () => {
  it('suggests turning the switch off when some units are partly free, or unsettled', () => {
    expect(noFullRowsMessage(summaryOf({ total: 3, known: 3, partly: 2 }), SITE)).toBe(
      'No sites are free for all 2 nights. Turn off "Fully available only" to see sites free for some of them.'
    );
    expect(noFullRowsMessage(summaryOf({ total: 3, known: 3 }), SITE)).toBe(
      'No sites are free for all 2 nights.'
    );
    expect(noFullRowsMessage(summaryOf({ total: 3, known: 2, notReleased: 1 }), SITE)).toBe(
      'No sites are free for all 2 nights. Turn off "Fully available only" to see each site\'s nights.'
    );
  });
});

describe('nightCellText', () => {
  it('says the state in words, with the price of an available night', () => {
    expect(nightCellText({ date: '2026-11-06', state: 'available', price: 30 })).toEqual({
      label: 'Available, $30',
      short: '$30',
    });
    expect(nightCellText({ date: '2026-11-06', state: 'available' })).toEqual({
      label: 'Available',
    });
    expect(nightCellText({ date: '2026-11-06', state: 'booked', price: 30 })).toEqual({
      label: 'Booked',
    });
    expect(nightCellText({ date: '2026-11-06', state: 'closed' }).label).toBe('Closed');
    expect(nightCellText({ date: '2026-11-06', state: 'not-released' }).label).toBe(
      'Not released yet'
    );
    expect(nightCellText({ date: '2026-11-06', state: 'unknown' }).label).toBe('Unknown');
  });
});

describe('formatPrice', () => {
  it('shows cents only when there are some', () => {
    expect(formatPrice(30)).toBe('$30');
    expect(formatPrice(30.5)).toBe('$30.50');
    expect(formatPrice(1234)).toBe('$1,234');
  });
});

describe('nightHeading', () => {
  it('is the weekday and day, with the month on the first night and a new month', () => {
    expect(nightHeading('2026-10-30')).toBe('Fri 30 Oct');
    expect(nightHeading('2026-10-31', '2026-10-30')).toBe('Sat 31');
    expect(nightHeading('2026-11-01', '2026-10-31')).toBe('Sun 1 Nov');
  });
});

describe('stayRangeLabel', () => {
  it('shortens a range within a month, and spells out months and years when they change', () => {
    expect(stayRangeLabel('2026-11-06', '2026-11-08')).toBe('6–8 Nov');
    expect(stayRangeLabel('2026-10-30', '2026-11-02')).toBe('30 Oct – 2 Nov');
    expect(stayRangeLabel('2026-12-30', '2027-01-02')).toBe('30 Dec 2026 – 2 Jan 2027');
  });
});

describe('split nights (free, but not on the same unit as the nights next to them)', () => {
  // A class-listed place: free on the 6th, then free only on another site on the 7th.
  const split: UnitAvailability = {
    unitId: 'class:117',
    unitName: 'One site - select on arrival',
    nights: [
      { date: '2026-11-06', state: 'available', price: 20 },
      { date: '2026-11-07', state: 'unknown', reason: 'split', price: 20 },
    ],
    fullyAvailable: false,
  };

  it('settle the stay as not free on one unit, never as unknown', () => {
    expect(unitStanding(split, NIGHTS)).toBe('split');
    expect(isFullyAvailable(split, NIGHTS)).toBe(false);
    // Booked or closed still decides first.
    const taken = {
      ...split,
      nights: [...split.nights.slice(1), { date: NIGHTS[0], state: 'booked' as const }],
    };
    expect(unitStanding(taken, NIGHTS)).toBe('taken');
  });

  it('count as known and partly free, with a note in the unit noun, not the source', () => {
    const summary = summariseAvailability([split, unit('b', ['available', 'available'])], NIGHTS);
    expect(summary).toMatchObject({
      total: 2,
      known: 2,
      fully: 1,
      partly: 1,
      unknown: 0,
      split: 1,
    });
    expect(summaryLine(summary, SITE, 'ParkStay')).toBe('1 of 2 sites free for all 2 nights');
    expect(summaryNotes(summary, SITE, 'ParkStay')).toEqual([
      'Free on some nights, but not on one site for the whole stay.',
    ]);
    const alone = summariseAvailability([split], NIGHTS);
    expect(summaryLine(alone, SITE, 'ParkStay')).toBe('0 of 1 site free for all 2 nights');
    expect(noFullRowsMessage(alone, SITE)).toBe(
      'No sites are free for all 2 nights. Turn off "Fully available only" to see sites free for some of them.'
    );
  });

  it('say "Free on another site" in the cell, with no price', () => {
    expect(nightCellText(split.nights[1], 'AUD', SITE)).toEqual({ label: 'Free on another site' });
    // With no kinds to go on, a unit is a "spot" (R9)
    expect(nightCellText(split.nights[1]).label).toBe('Free on another spot');
  });
});

describe('min-stay nights (free, but refused for this stay by the stay rules)', () => {
  // RAC's school holidays: room both nights, but a 3-night minimum, no arrivals on Sat 25 Sep
  const STAY = ['2027-09-25', '2027-09-26'];
  const refused = (unitId: string, extra: Partial<UnitAvailability> = {}): UnitAvailability => ({
    unitId,
    unitName: unitId,
    nights: [
      { date: STAY[0], state: 'unknown', reason: 'min-stay', minNights: 3, noArrival: true },
      { date: STAY[1], state: 'unknown', reason: 'min-stay', minNights: 3, noDeparture: true },
    ],
    fullyAvailable: false,
    ...extra,
  });
  const free = (unitId: string): UnitAvailability => ({
    unitId,
    unitName: unitId,
    nights: STAY.map((date) => ({ date, state: 'available' as const, price: 75 })),
    fullyAvailable: true,
  });

  it('settle a unit as min-stay: known, not free, after taken and split', () => {
    const unit = refused('a');
    expect(isMinStayNight(unit.nights[0])).toBe(true);
    expect(unitStanding(unit, STAY)).toBe('min-stay');
    expect(isFullyAvailable(unit, STAY)).toBe(false);
    // The reason wins over an available state
    const available = {
      ...unit,
      nights: unit.nights.map((night) => ({ ...night, state: 'available' as const })),
    };
    expect(unitStanding(available, STAY)).toBe('min-stay');
    expect(isFullyAvailable(available, STAY)).toBe(false);
    // Booked still decides first
    const taken = {
      ...unit,
      nights: [unit.nights[0], { date: STAY[1], state: 'booked' as const }],
    };
    expect(unitStanding(taken, STAY)).toBe('taken');
  });

  it('count as known and not free, by the minimum for the arrival night', () => {
    const units = [refused('a'), refused('b'), refused('c', { minNights: 5 }), free('d')];
    // c's arrival night has no minimum of its own: the unit's 5 applies
    units[2].nights[0] = { ...units[2].nights[0], minNights: undefined };
    const summary = summariseAvailability(units, STAY);
    expect(summary).toMatchObject({
      total: 4,
      known: 4,
      fully: 1,
      partly: 0,
      minStay: 3,
      minimums: { 3: 2, 5: 1 },
      noArrival: { date: STAY[0], units: 3 },
    });
    expect(summaryLine(summary, SITE, 'RAC')).toBe('1 of 4 sites free for all 2 nights');
  });

  it('note the sites that need a longer stay, and the day with no arrivals', () => {
    const summary = summariseAvailability([refused('a'), refused('b'), free('c')], STAY);
    expect(summaryNotes(summary, SITE, 'RAC')).toEqual([
      '2 sites need a stay of at least 3 nights.',
      '2 sites take no arrivals on Sat 25 Sep.',
    ]);
    const all = summariseAvailability([refused('a')], STAY);
    expect(summaryNotes(all, { one: 'cabin', many: 'cabins' }, 'RAC')).toEqual([
      '1 cabin needs a stay of at least 3 nights.',
      'No arrivals on Sat 25 Sep.',
    ]);
    expect(noFullRowsMessage(all, SITE)).toBe(
      'No sites are free for all 2 nights. Turn off "Fully available only" to see each site\'s nights.'
    );
    // A minimum the stay meets (refused for another rule) is not a note
    const longEnough = summariseAvailability([refused('a')], [...STAY, '2027-09-27']);
    expect(summaryNotes(longEnough, SITE, 'RAC')).toEqual(['No arrivals on Sat 25 Sep.']);
  });

  it('name no number of rows when each row is a type standing for several (RAC): "Some spots need …"', () => {
    const SPOTS = { one: 'spot', many: 'spots' };
    const counted = (unit: UnitAvailability, freeCount: number) => ({ ...unit, freeCount });
    const unreleased = (unitId: string) =>
      counted(
        {
          unitId,
          unitName: unitId,
          nights: STAY.map((date) => ({ date, state: 'not-released' as const })),
          fullyAvailable: false,
        },
        0
      );
    const silent = (unitId: string) =>
      counted({ unitId, unitName: unitId, nights: [], fullyAvailable: false }, 0);
    const summary = summariseAvailability(
      [
        counted(refused('a'), 0),
        counted(refused('b', { minNights: 5 }), 0),
        counted(free('c'), 51),
        unreleased('d'),
        unreleased('e'),
        silent('f'),
      ],
      STAY
    );
    expect(summary.freeUnits).toBe(51);
    expect(summaryLine(summary, SPOTS, 'RAC')).toBe('51 spots free for all 2 nights');
    expect(summaryNotes(summary, SPOTS, 'RAC')).toEqual([
      'Some spots need a stay of at least 3 nights.',
      'Some spots take no arrivals on Sat 25 Sep.',
      "Some other spots have nights that aren't released yet.",
      "RAC didn't say which nights are free for some other spots.",
    ]);
    // Every row takes no arrivals: no count was ever given
    const all = summariseAvailability([counted(refused('a'), 0)], STAY);
    expect(summaryNotes(all, SPOTS, 'RAC')).toEqual([
      'Some spots need a stay of at least 3 nights.',
      'No arrivals on Sat 25 Sep.',
    ]);
  });

  it("read a unit's minimum from its arrival night, else the unit; 0, 1, negative or a fraction is none", () => {
    expect(stayMinimum(refused('a'), STAY[0])).toBe(3);
    const unitOnly = refused('b', { minNights: 4 });
    unitOnly.nights[0] = { ...unitOnly.nights[0], minNights: undefined };
    expect(stayMinimum(unitOnly, STAY[0])).toBe(4);
    for (const minNights of [0, 1, -3, 2.5, undefined]) {
      const none = refused('c', { minNights });
      none.nights[0] = { ...none.nights[0], minNights };
      expect(stayMinimum(none, STAY[0])).toBeUndefined();
    }
    // A night's own 1 beats the unit's 3: arriving that night has no minimum
    const own = refused('d', { minNights: 3 });
    own.nights[0] = { ...own.nights[0], minNights: 1 };
    expect(stayMinimum(own, STAY[0])).toBeUndefined();
  });

  it('say which rule in the cell, with no price, and no number for a stay refused as too long', () => {
    const [arrival, last] = refused('a').nights;
    expect(nightCellText({ ...arrival, price: 75 }, 'AUD', SITE, 2)).toEqual({
      label: 'Available, 3-night minimum, no arrivals this day',
    });
    expect(nightCellText(last, 'AUD', SITE, 2).label).toBe(
      'Available, 3-night minimum, no departures this day'
    );
    expect(minStayRules({ ...arrival, noDeparture: true }, 2)).toBe(
      '3-night minimum, no arrivals or departures this day'
    );
    expect(
      minStayRules({ date: STAY[0], state: 'unknown', reason: 'min-stay', minNights: 3 })
    ).toBe('3-night minimum');
    // Too long, not too short: the minimum is no reason, so no number
    expect(nightCellText({ ...arrival, noArrival: undefined }, 'AUD', SITE, 14).label).toBe(
      'Available, stay rules apply'
    );
    expect(nightCellText({ date: STAY[0], state: 'unknown', reason: 'min-stay' }).label).toBe(
      'Available, stay rules apply'
    );
  });

  it('leave old nights without the new fields as they were', () => {
    const old: UnitAvailability = {
      unitId: 'x',
      unitName: 'x',
      nights: [
        { date: STAY[0], state: 'available', price: 20 },
        { date: STAY[1], state: 'booked' },
      ],
      fullyAvailable: false,
    };
    expect(unitStanding(old, STAY)).toBe('taken');
    const summary = summariseAvailability([old], STAY);
    expect(summary).not.toHaveProperty('minStay');
    expect(summary).not.toHaveProperty('minimums');
    expect(summary).not.toHaveProperty('noArrival');
    expect(nightCellText(old.nights[0], 'AUD', SITE, 2)).toEqual({
      label: 'Available, $20',
      short: '$20',
    });
  });
});

describe('a split stay the provider reported (free every night, by moving: §12.36)', () => {
  // RAC's Powered Site: a free site every night, but no one site for the whole stay
  const powered: UnitAvailability = {
    unitId: 'cat:4',
    unitName: 'Powered Site',
    nights: [
      { date: '2026-11-06', state: 'unknown', reason: 'split', price: 90 },
      { date: '2026-11-07', state: 'unknown', reason: 'split', price: 90 },
    ],
    fullyAvailable: false,
    freeCount: 0,
    splitStay: { booking: 'contact' },
  };
  // A class with a free site on the 6th, then free only on another one on the 7th
  const classSplit: UnitAvailability = {
    unitId: 'class:117',
    unitName: 'One site - select on arrival',
    nights: [
      { date: '2026-11-06', state: 'available', price: 20 },
      { date: '2026-11-07', state: 'unknown', reason: 'split', price: 20 },
    ],
    fullyAvailable: false,
  };

  it('says "Free every night" for a unit with a split stay, and keeps the other note for the rest', () => {
    expect(isFreeEveryNightIfYouMove(powered, NIGHTS)).toBe(true);
    const alone = summariseAvailability([powered], NIGHTS);
    expect(alone).toMatchObject({ known: 1, fully: 0, split: 1, splitStays: 1 });
    expect(summaryNotes(alone, SITE, 'RAC')).toEqual([
      'Free every night, but not on one site for the whole stay.',
    ]);

    const both = summariseAvailability([powered, { ...classSplit, freeCount: 0 }], NIGHTS);
    expect(summaryNotes(both, SITE, 'RAC')).toEqual([
      'Free every night, but not on one site for the whole stay.',
      'Free on some nights, but not on one site for the whole stay.',
    ]);
  });

  it('claims "every night" only when every night shows it: free or split, at least one split', () => {
    // No split stay reported: the old note
    expect(isFreeEveryNightIfYouMove(classSplit, NIGHTS)).toBe(false);
    expect(summaryNotes(summariseAvailability([classSplit], NIGHTS), SITE, 'ParkStay')).toEqual([
      'Free on some nights, but not on one site for the whole stay.',
    ]);
    // A night it did not report, or one refused by the stay rules, is not free
    const missing = { ...powered, nights: powered.nights.slice(0, 1) };
    expect(isFreeEveryNightIfYouMove(missing, NIGHTS)).toBe(false);
    const refused = {
      ...powered,
      nights: [
        powered.nights[0],
        { date: NIGHTS[1], state: 'unknown' as const, reason: 'min-stay' as const },
      ],
    };
    expect(isFreeEveryNightIfYouMove(refused, NIGHTS)).toBe(false);
    // A split night with no room (booked or closed) is not free, as the core takes it
    const taken = {
      ...powered,
      nights: [
        powered.nights[0],
        { date: NIGHTS[1], state: 'booked' as const, reason: 'split' as const },
      ],
    };
    expect(isFreeEveryNightIfYouMove(taken, NIGHTS)).toBe(false);
    // Every night free with no split is no split stay
    const free = {
      ...powered,
      nights: NIGHTS.map((date) => ({ date, state: 'available' as const })),
    };
    expect(isFreeEveryNightIfYouMove(free, NIGHTS)).toBe(false);
    expect(isFreeEveryNightIfYouMove(powered, [])).toBe(false);
  });

  it('names the unit by its kind', () => {
    const summary = summariseAvailability([powered], NIGHTS);
    expect(summaryNotes(summary, { one: 'cabin', many: 'cabins' }, 'RAC')).toEqual([
      'Free every night, but not on one cabin for the whole stay.',
    ]);
  });
});
