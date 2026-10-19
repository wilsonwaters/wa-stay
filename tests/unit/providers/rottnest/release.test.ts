/**
 * Stay Rottnest's release status (`src/main/providers/rottnest/release.ts`): a stay is on sale
 * once every month it has a night in has had its Open Day, or sooner by the 5/3 rule (5 nights
 * in an open month take up to 3 of the next) unless the month's guide suspends it; dates past
 * RIA's calendar are expected; the sentence it is said in.
 */

import { releaseStatus, releaseText } from '@main/providers/rottnest/release';

/** 18 Oct 2026, 10 am Perth: stays to June 2027 are on sale. */
const NOW = new Date('2026-10-18T02:00:00.000Z');
const allowed = () => 'allowed' as const;
const suspended = () => 'suspended' as const;

describe('releaseStatus', () => {
  it('a stay in a month already open is on sale', () => {
    const status = releaseStatus({ arrival: '2027-06-10', departure: '2027-06-12' }, NOW, allowed);
    expect(status).toEqual({
      open: true,
      opensAt: new Date('2026-10-07T00:30:00.000Z'),
      month: '2027-06',
      expected: false,
    });
    expect(releaseText(status)).toBe('On sale.');
  });

  it('a stay in July 2027 opens on Wed 4 Nov 2026 at 8:30 am Perth, and not a second before', () => {
    const stay = { arrival: '2027-07-10', departure: '2027-07-12' };
    const before = releaseStatus(stay, new Date('2026-11-04T00:29:59.000Z'), allowed);
    expect(before).toMatchObject({ open: false, month: '2027-07', expected: false });
    expect(before.opensAt.toISOString()).toBe('2026-11-04T00:30:00.000Z');
    expect(releaseText(before)).toBe(
      "Opens Wed 4 Nov 2026, 8:30 am, Stay Rottnest's Open Day for July 2027. Its waiting room opens at 6 am."
    );
    expect(releaseStatus(stay, new Date('2026-11-04T00:30:00.000Z'), allowed).open).toBe(true);
  });

  it('a stay across two months waits for the later one', () => {
    const status = releaseStatus({ arrival: '2027-06-29', departure: '2027-07-03' }, NOW, allowed);
    expect(status).toMatchObject({ open: false, month: '2027-07' });
    expect(status.carriesOver).toBeUndefined();
  });

  it('the 5/3 rule: 5 nights in an open month take up to 3 of the next before it opens', () => {
    const status = releaseStatus({ arrival: '2027-06-25', departure: '2027-07-02' }, NOW, allowed);
    expect(status).toMatchObject({
      open: true,
      month: '2027-06',
      expected: false,
      carriesOver: { into: '2027-07' },
    });
    expect(releaseText(status)).toBe(
      'On sale. With 5 nights in June 2027, it can take up to 3 nights in July 2027.'
    );
    // Four nights in June, or four in July, are not enough
    expect(
      releaseStatus({ arrival: '2027-06-27', departure: '2027-07-02' }, NOW, allowed).open
    ).toBe(false);
    expect(
      releaseStatus({ arrival: '2027-06-25', departure: '2027-07-05' }, NOW, allowed).open
    ).toBe(false);
  });

  it("a guide that suspends the 5/3 rule makes the stay wait for the next month's Open Day", () => {
    const status = releaseStatus(
      { arrival: '2027-06-25', departure: '2027-07-02' },
      NOW,
      suspended
    );
    expect(status).toMatchObject({ open: false, month: '2027-07' });
  });

  it('a month without a guide yet allows the 5/3 rule, expected', () => {
    // On 4 Nov 2026 July opens; August does not until 2 Dec
    const at = new Date('2026-11-10T02:00:00.000Z');
    const status = releaseStatus(
      { arrival: '2027-07-26', departure: '2027-08-02' },
      at,
      () => 'unknown'
    );
    expect(status).toMatchObject({ open: true, month: '2027-07', expected: true });
  });

  it('dates past the published calendar are expected, and say so', () => {
    const status = releaseStatus({ arrival: '2028-08-10', departure: '2028-08-12' }, NOW, allowed);
    expect(status).toMatchObject({ open: false, month: '2028-08', expected: true });
    expect(status.opensAt.toISOString()).toBe('2027-12-01T00:30:00.000Z');
    expect(releaseText(status)).toMatch(/^Expected to open Wed 1 Dec 2027, 8:30 am/);
  });
});
