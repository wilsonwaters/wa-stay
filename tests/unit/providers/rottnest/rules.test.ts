/**
 * Stay Rottnest's booking rules (`src/main/providers/rottnest/rules.ts`), on the guides' own
 * examples: arrival not past nor today, 14 nights at most, closures, fixed peak stays (Geordie
 * Bay's December Tuesdays; a group's blocks running from one guide's month into the next; a
 * group that covers only some of Kingstown's types), the peak's 3-night minimums, event
 * Saturdays, the party, public holidays as a note, and the release with every verdict.
 */

import type { StayRulesVerdict } from '@shared/types/provider.types';
import { createRottnestRules, ROTTNEST_MAX_NIGHTS } from '@main/providers/rottnest/rules';
import { rottnestPrecinct } from '@main/providers/rottnest/precincts';

/** 18 Oct 2026, 10 am Perth: stays to June 2027 are on sale. */
const NOW = new Date('2026-10-18T02:00:00.000Z');
const rules = createRottnestRules();

function check(
  externalId: string,
  arrival: string,
  departure: string,
  extra: { adults?: number; children?: number; unitIds?: string[]; now?: Date } = {}
): StayRulesVerdict {
  return rules.check({
    externalId,
    stay: { arrival, departure, adults: extra.adults ?? 2, children: extra.children ?? 0 },
    ...(extra.unitIds ? { unitIds: extra.unitIds } : {}),
    now: extra.now ?? NOW,
  });
}

const refused = (verdict: StayRulesVerdict) => {
  if (verdict.ok) throw new Error(`Expected a refusal, got ${JSON.stringify(verdict)}`);
  return verdict;
};

describe('the arrival and the length', () => {
  it('allows an ordinary stay on sale, and says so', () => {
    expect(check('geordie-bay', '2026-10-27', '2026-10-30')).toEqual({
      ok: true,
      notes: [],
      release: { open: true, text: 'On sale.' },
    });
  });

  it('refuses a date already past, and today (no same-day bookings online)', () => {
    expect(refused(check('geordie-bay', '2026-10-17', '2026-10-19'))).toMatchObject({
      field: 'arrival',
      reason: 'That date has passed.',
    });
    expect(refused(check('geordie-bay', '2026-10-18', '2026-10-20'))).toMatchObject({
      field: 'arrival',
      reason: "Stay Rottnest doesn't take online bookings for the same day.",
    });
  });

  it('takes 14 nights at most, and suggests the longest it takes', () => {
    expect(check('geordie-bay', '2027-05-01', '2027-05-15').ok).toBe(true);
    expect(refused(check('geordie-bay', '2027-05-01', '2027-05-16'))).toMatchObject({
      field: 'departure',
      reason: `Stay Rottnest takes stays of ${ROTTNEST_MAX_NIGHTS} nights at most.`,
      suggestions: [{ arrival: '2027-05-01', departure: '2027-05-15' }],
    });
  });

  it('answers ok with no notes for a place it does not know', () => {
    expect(check('pinky-beach', '2027-05-01', '2027-05-03')).toEqual({ ok: true, notes: [] });
  });
});

describe('fixed peak stays', () => {
  it("Geordie Bay's December blocks (Tuesdays): a whole block is fine, anything else is refused with the blocks nearest", () => {
    expect(check('geordie-bay', '2026-12-08', '2026-12-15').ok).toBe(true);
    // Two blocks back to back, within 14 nights
    expect(check('geordie-bay', '2026-12-08', '2026-12-22').ok).toBe(true);
    const wrongArrival = refused(check('geordie-bay', '2026-12-10', '2026-12-12'));
    expect(wrongArrival).toMatchObject({ field: 'arrival' });
    expect(wrongArrival.reason).toBe(
      'From 1 Dec 2026 to 29 Dec 2026, stays at Geordie Bay arrive and leave on fixed dates only, such as 8–15 Dec, 15–22 Dec, 1–8 Dec.'
    );
    expect(wrongArrival.suggestions?.[0]).toEqual({
      arrival: '2026-12-08',
      departure: '2026-12-15',
    });
    expect(refused(check('geordie-bay', '2026-12-08', '2026-12-14'))).toMatchObject({
      field: 'departure',
    });
  });

  it("checks a group's blocks wherever its period runs: Thomson Bay South's December blocks start on 28 Nov", () => {
    // 28 Nov – 2 Dec is the block; 28–30 Nov is not
    expect(check('thomson-bay-south', '2026-11-28', '2026-12-02').ok).toBe(true);
    expect(refused(check('thomson-bay-south', '2026-11-28', '2026-11-30')).field).toBe('departure');
  });

  it("is a note at a precinct where only some types take fixed stays (Kingstown's cottages), unless one of them is chosen", () => {
    const any = check('kingstown', '2026-12-10', '2026-12-14', { adults: 1 });
    expect(any.ok).toBe(true);
    expect(any.notes).toContain(
      'From 28 Nov 2026 to 31 Dec 2026, some room types here take fixed stays only (Thomson Bay South and Kingstown Heritage/Superior View).'
    );
    expect(
      refused(check('kingstown', '2026-12-10', '2026-12-14', { unitIds: ['KHV06'] })).field
    ).toBe('arrival');
  });

  it('applies outside the peak to nothing', () => {
    expect(check('geordie-bay', '2027-02-09', '2027-02-11').ok).toBe(true);
  });
});

describe("the peak's minimum stays", () => {
  it('the Campground takes 3 nights at least in December 2026', () => {
    expect(refused(check('campground', '2026-12-10', '2026-12-12'))).toMatchObject({
      field: 'departure',
      reason: 'Campground needs a stay of at least 3 nights from 1 Dec 2026 to 31 Dec 2026.',
      suggestions: [{ arrival: '2026-12-10', departure: '2026-12-13' }],
    });
    expect(check('campground', '2026-12-10', '2026-12-13').ok).toBe(true);
  });

  it('a dorm chosen at Kingstown is refused; Kingstown with no type chosen has a note', () => {
    expect(
      refused(check('kingstown', '2027-01-05', '2027-01-07', { adults: 1, unitIds: ['KDM04'] }))
        .field
    ).toBe('departure');
    const any = check('kingstown', '2027-01-05', '2027-01-07', { adults: 1 });
    expect(any.ok).toBe(true);
    expect(any.notes.some((note) => note.startsWith('Some room types here: needs a stay'))).toBe(
      true
    );
  });
});

describe('closures and event Saturdays', () => {
  it('Bathurst is closed from 27 Apr to 30 June 2027 (its April, May and June closures as one)', () => {
    expect(refused(check('bathurst', '2027-05-02', '2027-05-04'))).toMatchObject({
      field: 'arrival',
      reason: 'Bathurst is closed from 27 Apr 2027 to 30 June 2027.',
    });
    // Its last April block still leaves on the 27th
    expect(check('bathurst', '2027-04-23', '2027-04-27').ok).toBe(true);
  });

  it('the Channel Swim and Port to Pub Saturdays are not a stay of that night alone', () => {
    expect(refused(check('longreach-bay', '2027-02-20', '2027-02-21'))).toMatchObject({
      field: 'departure',
      reason:
        'On the Rottnest Channel Swim weekend, a stay on Saturday 20 Feb 2027 must include the Friday or the Sunday night too.',
      suggestions: [
        { arrival: '2027-02-19', departure: '2027-02-21' },
        { arrival: '2027-02-20', departure: '2027-02-22' },
      ],
    });
    expect(check('longreach-bay', '2027-02-19', '2027-02-21').ok).toBe(true);
    expect(refused(check('fays-bay', '2027-03-20', '2027-03-21')).field).toBe('departure');
    // Any other Saturday night alone is fine (no guide since September 2026 asks for two)
    expect(check('fays-bay', '2027-02-27', '2027-02-28').ok).toBe(true);
  });
});

describe('the party', () => {
  it('everyone, children too, within what a room type sleeps', () => {
    const geordie = rottnestPrecinct('geordie-bay')!;
    const most = Math.max(...geordie.roomTypes.map((type) => type.sleeps));
    expect(check('geordie-bay', '2027-05-04', '2027-05-06', { adults: most }).ok).toBe(true);
    expect(
      refused(check('geordie-bay', '2027-05-04', '2027-05-06', { adults: most, children: 1 }))
    ).toMatchObject({
      field: 'guests',
      reason: `Nothing at Geordie Bay sleeps ${most + 1}: ${most} at most.`,
    });
    const type = geordie.roomTypes[0];
    expect(
      refused(
        check('geordie-bay', '2027-05-04', '2027-05-06', {
          adults: type.sleeps + 1,
          unitIds: [type.code],
        })
      ).reason
    ).toBe(`${type.name} sleeps ${type.sleeps} at most.`);
  });

  it('refuses room types that are not at the place', () => {
    expect(
      refused(check('geordie-bay', '2027-05-04', '2027-05-06', { unitIds: ['FPR04'] }))
    ).toMatchObject({ field: 'units', reason: 'None of these room types is at Geordie Bay.' });
  });
});

describe('public holidays and the release', () => {
  it("notes an arrival on a public holiday, which RIA's terms say may be restricted, without refusing it", () => {
    const verdict = check('geordie-bay', '2027-06-07', '2027-06-09');
    expect(verdict.ok).toBe(true);
    expect(verdict.notes).toEqual([
      "You'd arrive on a public holiday (Western Australia Day, 7 June 2027): Stay Rottnest's terms say arrivals and departures then may be restricted.",
    ]);
  });

  it('says when a stay not on sale yet opens, with any verdict', () => {
    expect(check('geordie-bay', '2027-07-06', '2027-07-08').release).toEqual({
      open: false,
      opensAt: '2026-11-04T00:30:00.000Z',
      text: "Opens Wed 4 Nov 2026, 8:30 am, Stay Rottnest's Open Day for July 2027. Its waiting room opens at 6 am.",
    });
    expect(refused(check('geordie-bay', '2027-07-06', '2027-07-22')).release?.open).toBe(false);
  });

  it("June's guide suspends the 5/3 rule: a stay into July waits for July's Open Day", () => {
    expect(check('geordie-bay', '2027-06-25', '2027-07-02').release).toMatchObject({
      open: false,
      opensAt: '2026-11-04T00:30:00.000Z',
    });
  });
});
