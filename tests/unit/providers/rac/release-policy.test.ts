/**
 * RAC's release policy (`src/main/providers/rac/release-policy.ts`) on a fake clock (`now` is
 * fixed in every call), with the exact UTC instant each case gives. Perth is UTC+8 all year (no
 * daylight saving), so 00:00 AWST is 16:00Z the day before, 7 am is 23:00Z the day before, 8 am
 * is 00:00Z and 9 am is 01:00Z the same day.
 *
 * - `daily_rollover`: the rolling window (00:00 AWST on departure − 365), or a later
 *   school-holiday release at the park's hour, 48 hours earlier for a member at a park and
 *   category in the pre-sale (terms rule 14); Cable Beach follows the rolling window only;
 *   the public instant once the member window has passed; refusals for an unannounced period,
 *   a night the calendar does not cover, and a stay already open.
 * - `scheduled`: the person's time, refused without one.
 * - `isMember` asked at every compute; no request sent; `describe`; the poll floors.
 */

import { racFactory, racManifest, RAC_PARKS } from '@main/providers/rac';
import {
  inPreSale,
  RacReleasePolicy,
  rollingInstant,
  wantsPreSale,
} from '@main/providers/rac/release-policy';
import {
  isAnnounced,
  SCHOOL_HOLIDAY_PERIODS,
  type AnnouncedRelease,
} from '@main/providers/rac/release-calendar';
import { isAbortError, ProviderError } from '@main/providers/sdk';
import type { ReleaseComputeInput } from '@main/providers/sdk/provider';
import { SnipeReleaseMode } from '@shared/types/common.types';
import type { StayQuery, UnitKind } from '@shared/types/provider.types';
import { addDays } from '@shared/utils/calendar-date';
import { RecordingHttpClient } from '@tests/utils/fake-paced-provider';
import { createTestProviderContext } from '@tests/utils/fake-provider';

/** 10 am in Perth, 17 Oct 2026: the day after the research's live boundary test. */
const NOW = new Date('2026-10-17T02:00:00.000Z');
const HOUR = 3_600_000;

const stay = (arrival: string, departure: string): StayQuery => ({ arrival, departure, adults: 2 });
/** 20–23 Dec 2027: three nights in the summer 2027–28 holidays. */
const SUMMER = stay('2027-12-20', '2027-12-23');

const UNANNOUNCED_MESSAGE = (park: string) =>
  `RAC hasn't announced when these school holidays open at ${park}. ` +
  'Set a watch, or choose a time you set.';
const ALREADY_OPEN =
  'These dates are already open on RAC. Set a watch to hear about cancellations.';

/** The policy with `isMember` a spy answering `member` (changeable). */
function makePolicy(member = false) {
  const state = { member };
  const isMember = jest.fn(async () => state.member);
  return { policy: new RacReleasePolicy({ providerId: 'rac', isMember }), isMember, state };
}

interface Options {
  member?: boolean;
  now?: Date;
  unitIds?: string[];
  unitKinds?: UnitKind[];
}

/** The `daily_rollover` instant for `stay` at `park`, as an ISO string. */
async function opens(park: string, at: StayQuery, options: Options = {}): Promise<string> {
  const { policy } = makePolicy(options.member);
  const instant = await policy.computeReleaseAt({
    mode: SnipeReleaseMode.DAILY_ROLLOVER,
    externalId: park,
    stay: at,
    now: options.now ?? NOW,
    unitIds: options.unitIds,
    unitKinds: options.unitKinds,
  });
  return instant!.toISOString();
}

/** Why `daily_rollover` refuses `stay` at `park`. */
async function refusal(park: string, at: StayQuery, options: Options = {}): Promise<ProviderError> {
  const error = await opens(park, at, options).then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(ProviderError);
  expect((error as ProviderError).code).toBe('provider');
  return error as ProviderError;
}

describe('RAC release policy', () => {
  describe('daily_rollover: the rolling 364-day window', () => {
    it('opens departure 2027-10-17 at 2026-10-16T16:00:00.000Z, the live boundary', async () => {
      // 2027-10-17 − 365 days = 2026-10-17; 00:00 AWST = 16:00Z on the 16th. Asked at 23:36 AWST
      // on 16 Oct 2026, as the research's boundary test was.
      const now = new Date('2026-10-16T15:36:00.000Z');
      expect(await opens('busselton', stay('2027-10-15', '2027-10-17'), { now })).toBe(
        '2026-10-16T16:00:00.000Z'
      );
      expect(rollingInstant('2027-10-17').toISOString()).toBe('2026-10-16T16:00:00.000Z');
    });

    it('counts 365 days across a leap day: departure 2028-03-01 opens 2027-03-01T16:00:00.000Z', async () => {
      // 2027-03-01 → 2028-03-01 is 366 days (29 Feb 2028), so departure − 365 = 2027-03-02.
      expect(await opens('busselton', stay('2028-02-28', '2028-03-01'))).toBe(
        '2027-03-01T16:00:00.000Z'
      );
    });

    it('starts at midnight: the instant at 15:59:59Z, refused as open from 16:30Z, its window', async () => {
      const edge = stay('2027-10-15', '2027-10-17');
      for (const now of ['2026-10-16T15:59:59.000Z', '2026-10-16T16:29:59.000Z']) {
        expect(await opens('busselton', edge, { now: new Date(now) })).toBe(
          '2026-10-16T16:00:00.000Z'
        );
      }
      const error = await refusal('busselton', edge, {
        now: new Date('2026-10-16T16:30:00.000Z'),
      });
      expect(error.message).toBe(ALREADY_OPEN);
    });

    it('refuses a stay that has been open for long, member number or not', async () => {
      for (const member of [false, true]) {
        expect(
          (await refusal('busselton', stay('2026-11-06', '2026-11-08'), { member })).message
        ).toBe(ALREADY_OPEN);
      }
    });
  });

  describe('daily_rollover: school-holiday releases', () => {
    it('Busselton, 20–23 Dec 2027: 2027-02-05T00:00Z (8 am), or 2027-02-03T00:00Z with a member number (rule 14)', async () => {
      expect(await opens('busselton', SUMMER)).toBe('2027-02-05T00:00:00.000Z');
      expect(await opens('busselton', SUMMER, { member: true })).toBe('2027-02-03T00:00:00.000Z');
    });

    it("Esperance opens at 7 am (23:00Z the day before), Exmouth at 9 am: the park's own hour", async () => {
      expect(await opens('esperance', SUMMER)).toBe('2027-02-04T23:00:00.000Z');
      expect(await opens('esperance', SUMMER, { member: true })).toBe('2027-02-02T23:00:00.000Z');
      expect(await opens('exmouth', SUMMER)).toBe('2027-02-05T01:00:00.000Z');
      expect(await opens('exmouth', SUMMER, { member: true })).toBe('2027-02-03T01:00:00.000Z');
    });

    it("Margaret River with a member number: dorms alone open at the public time, any other category at the pre-sale's", async () => {
      const member = true;
      const publicAt = '2027-02-04T23:00:00.000Z';
      const preSaleAt = '2027-02-02T23:00:00.000Z';
      expect(await opens('margaret-river', SUMMER, { member, unitKinds: ['dorm'] })).toBe(publicAt);
      // Its dorm categories by id: Sleeps 14, 26 and 5
      expect(await opens('margaret-river', SUMMER, { member, unitIds: ['cat:2', 'cat:3'] })).toBe(
        publicAt
      );
      expect(await opens('margaret-river', SUMMER, { member })).toBe(preSaleAt);
      expect(await opens('margaret-river', SUMMER, { member, unitKinds: ['dorm', 'cabin'] })).toBe(
        preSaleAt
      );
      expect(await opens('margaret-river', SUMMER, { member, unitIds: ['cat:4', 'cat:9'] })).toBe(
        preSaleAt
      );
      // Without a number, everything at the public time
      expect(await opens('margaret-river', SUMMER, { unitKinds: ['cabin'] })).toBe(publicAt);
    });

    it('Cable Beach follows the rolling window only, member number or not: 2026-12-22T16:00Z', async () => {
      // departure 2027-12-23 − 365 = 2026-12-23, 00:00 AWST
      expect(await opens('cable-beach', SUMMER)).toBe('2026-12-22T16:00:00.000Z');
      expect(await opens('cable-beach', SUMMER, { member: true })).toBe('2026-12-22T16:00:00.000Z');
      // Nor does an unannounced period or the calendar's end stop it
      expect(await opens('cable-beach', stay('2028-07-02', '2028-07-05'))).toBe(
        '2027-07-05T16:00:00.000Z'
      );
    });

    it("takes the period's both ends: the night of 17 Dec 2027 and of 31 Jan 2028 are in it, 16 Dec and 1 Feb not", async () => {
      // Last night 16 Dec: rolling only (2027-12-17 − 365 = 2026-12-17)
      expect(await opens('busselton', stay('2027-12-15', '2027-12-17'))).toBe(
        '2026-12-16T16:00:00.000Z'
      );
      expect(await opens('busselton', stay('2027-12-17', '2027-12-18'))).toBe(
        '2027-02-05T00:00:00.000Z'
      );
      expect(await opens('busselton', stay('2028-01-31', '2028-02-01'))).toBe(
        '2027-02-05T00:00:00.000Z'
      );
      // First night 1 Feb 2028: rolling only (2028-02-03 − 365 = 2027-02-03)
      expect(await opens('busselton', stay('2028-02-01', '2028-02-03'))).toBe(
        '2027-02-02T16:00:00.000Z'
      );
    });

    it('a long stay touching the holidays takes the later, holiday, instant', async () => {
      // Nights 10–19 Dec 2027: the rolling instant (2026-12-20) is earlier than the release
      expect(await opens('busselton', stay('2027-12-10', '2027-12-20'))).toBe(
        '2027-02-05T00:00:00.000Z'
      );
    });

    it('April 2028 at Busselton: 2027-04-30T00:00Z, or 2027-04-28T00:00Z with a member number', async () => {
      const april = stay('2028-04-10', '2028-04-13');
      expect(await opens('busselton', april)).toBe('2027-04-30T00:00:00.000Z');
      expect(await opens('busselton', april, { member: true })).toBe('2027-04-28T00:00:00.000Z');
    });

    it("opens every announced release to members exactly 48 h before the public, at each pre-sale park's own hour", async () => {
      // Before every release in the calendar
      const now = new Date('2026-10-01T00:00:00.000Z');
      const announced = SCHOOL_HOLIDAY_PERIODS.filter((period) => isAnnounced(period.release));
      const parks = RAC_PARKS.filter((park) => park.schoolHolidays?.memberPreSale);
      expect([announced.length, parks.length]).toEqual([3, 7]);
      for (const period of announced) {
        const release = period.release as AnnouncedRelease;
        const firstNight = stay(period.first, addDays(period.first, 1));
        for (const park of parks) {
          const hour = park.schoolHolidays!.hour;
          const publicAt = new Date(await opens(park.slug, firstNight, { now }));
          const memberAt = new Date(await opens(park.slug, firstNight, { now, member: true }));
          // The park's hour in Perth (UTC+8) on the public release day
          const [y, m, d] = release.publicRelease.split('-').map(Number);
          expect([park.slug, publicAt.getTime()]).toEqual([
            park.slug,
            Date.UTC(y, m - 1, d, hour - 8),
          ]);
          expect([park.slug, publicAt.getTime() - memberAt.getTime()]).toEqual([
            park.slug,
            48 * HOUR,
          ]);
        }
      }
    });

    it('a member who missed the pre-sale gets the public instant; one inside its window, the pre-sale', async () => {
      // Pre-sale 2027-02-03T00:00Z, its window to 00:30Z; public 2027-02-05T00:00Z
      const member = true;
      expect(
        await opens('busselton', SUMMER, { member, now: new Date('2027-02-03T00:20:00.000Z') })
      ).toBe('2027-02-03T00:00:00.000Z');
      expect(
        await opens('busselton', SUMMER, { member, now: new Date('2027-02-03T00:30:00.000Z') })
      ).toBe('2027-02-05T00:00:00.000Z');
      expect(
        await opens('busselton', SUMMER, { member, now: new Date('2027-02-04T00:00:00.000Z') })
      ).toBe('2027-02-05T00:00:00.000Z');
      const error = await refusal('busselton', SUMMER, {
        member,
        now: new Date('2027-02-05T00:30:00.000Z'),
      });
      expect(error.message).toBe(ALREADY_OPEN);
    });
  });

  describe('daily_rollover: refusals', () => {
    it('refuses a night in a school-holiday period RAC has not announced, at a park in the releases', async () => {
      const error = await refusal('busselton', stay('2028-06-29', '2028-07-02'));
      expect(error.message).toBe(UNANNOUNCED_MESSAGE('RAC Busselton Holiday Park'));
      expect((await refusal('exmouth', stay('2028-10-08', '2028-10-09'))).message).toBe(
        UNANNOUNCED_MESSAGE('RAC Exmouth Cape Holiday Park')
      );
    });

    it('refuses a night after CALENDAR_COVERS_UNTIL, naming its year', async () => {
      const message =
        "WA Stay doesn't know RAC's release dates for 2029 yet. Set a watch, or choose a time you set.";
      expect((await refusal('busselton', stay('2029-02-10', '2029-02-12'))).message).toBe(message);
      // The night of 31 Jan 2029 is the first the calendar does not cover
      expect((await refusal('karri-valley', stay('2029-01-29', '2029-02-01'))).message).toBe(
        message
      );
    });

    it('refuses a park the seed does not have, and a stay that is not two dates in order', async () => {
      expect((await refusal('ningaloo', SUMMER)).message).toMatch(/no park "ningaloo"/);
      expect((await refusal('busselton', stay('2027-12-23', '2027-12-20'))).message).toMatch(
        /arrival and a later departure/
      );
    });
  });

  describe('scheduled', () => {
    it("returns the person's own time, and refuses without one", async () => {
      const { policy } = makePolicy();
      const requestedAt = new Date('2027-03-01T01:00:00.000Z');
      const input: ReleaseComputeInput = {
        mode: SnipeReleaseMode.SCHEDULED,
        externalId: 'cable-beach',
        stay: stay('2027-08-01', '2027-08-03'),
        requestedAt,
        now: NOW,
      };
      await expect(policy.computeReleaseAt(input)).resolves.toBe(requestedAt);
      const error = await policy
        .computeReleaseAt({ ...input, requestedAt: undefined })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).message).toBe('A scheduled release needs a time');
    });
  });

  describe('modes, floors and the member input', () => {
    it('supports daily_rollover and scheduled, not cancellation', () => {
      const { policy } = makePolicy();
      expect(
        [
          SnipeReleaseMode.DAILY_ROLLOVER,
          SnipeReleaseMode.SCHEDULED,
          SnipeReleaseMode.CANCELLATION,
        ].map((mode) => policy.supports(mode))
      ).toEqual([true, true, false]);
    });

    it('checks every 10 s in a window, and no faster than a watch otherwise', () => {
      expect(makePolicy().policy.pollFloorMs).toEqual({ window: 10_000, continuous: 900_000 });
    });

    it('asks isMember at every compute and keeps nothing, so a saved number shows at once', async () => {
      const { policy, isMember, state } = makePolicy(false);
      const input: ReleaseComputeInput = {
        mode: SnipeReleaseMode.DAILY_ROLLOVER,
        externalId: 'busselton',
        stay: SUMMER,
        now: NOW,
      };
      expect((await policy.computeReleaseAt(input))!.toISOString()).toBe(
        '2027-02-05T00:00:00.000Z'
      );
      state.member = true;
      expect((await policy.computeReleaseAt(input))!.toISOString()).toBe(
        '2027-02-03T00:00:00.000Z'
      );
      state.member = false;
      expect((await policy.computeReleaseAt(input))!.toISOString()).toBe(
        '2027-02-05T00:00:00.000Z'
      );
      expect(isMember).toHaveBeenCalledTimes(3);
    });

    it('tells which categories take part in the pre-sale', () => {
      const margaretRiver = RAC_PARKS.find(
        (park) => park.slug === 'margaret-river'
      )!.schoolHolidays!;
      const busselton = RAC_PARKS.find((park) => park.slug === 'busselton')!.schoolHolidays!;
      expect(inPreSale(margaretRiver, { unitId: 'cat:3', unitKind: 'dorm' })).toBe(false);
      expect(inPreSale(margaretRiver, { unitId: 'cat:99', unitKind: 'dorm' })).toBe(false);
      expect(inPreSale(margaretRiver, { unitId: 'cat:9', unitKind: 'cabin' })).toBe(true);
      expect(inPreSale(busselton, { unitId: 'cat:3', unitKind: 'dorm' })).toBe(true);
      expect(wantsPreSale(margaretRiver)).toBe(true);
      expect(wantsPreSale(margaretRiver, [], ['dorm'])).toBe(false);
      expect(wantsPreSale(margaretRiver, ['cat:2', 'cat:3', 'cat:4'], ['cabin'])).toBe(false);
      expect(wantsPreSale({ ...busselton, memberPreSale: false })).toBe(false);
    });

    it('is no member through the factory until the member number can be saved', async () => {
      const provider = racFactory(createTestProviderContext(racManifest, { clock: () => NOW }));
      const instant = await provider.release!.computeReleaseAt({
        mode: SnipeReleaseMode.DAILY_ROLLOVER,
        externalId: 'busselton',
        stay: SUMMER,
        now: NOW,
      });
      expect(instant!.toISOString()).toBe('2027-02-05T00:00:00.000Z');
    });

    it('sends no request: computeReleaseAt and describe read only the calendar, the parks, the clock and isMember', async () => {
      const http = new RecordingHttpClient({ providerId: 'rac' });
      const provider = racFactory(
        createTestProviderContext(racManifest, { http, clock: () => NOW })
      );
      const release = provider.release!;
      await release.computeReleaseAt({
        mode: SnipeReleaseMode.DAILY_ROLLOVER,
        externalId: 'busselton',
        stay: SUMMER,
        now: NOW,
      });
      await release.computeReleaseAt({
        mode: SnipeReleaseMode.SCHEDULED,
        externalId: 'busselton',
        stay: SUMMER,
        requestedAt: new Date('2027-01-01T00:00:00.000Z'),
        now: NOW,
      });
      await release.describe('busselton');
      expect(http.requests).toEqual([]);
    });

    it('honours an aborted signal', async () => {
      const { policy } = makePolicy();
      const controller = new AbortController();
      controller.abort();
      const error = await policy
        .computeReleaseAt({
          mode: SnipeReleaseMode.DAILY_ROLLOVER,
          externalId: 'busselton',
          stay: SUMMER,
          now: NOW,
          signal: controller.signal,
        })
        .catch((e: unknown) => e);
      expect(isAbortError(error)).toBe(true);
    });
  });

  describe('describe', () => {
    it("says when a park's dates open: the rolling window, then its school-holiday hour, in AWST", async () => {
      const { policy } = makePolicy();
      expect(await policy.describe('busselton')).toBe(
        'New dates open daily at midnight AWST, 364 days ahead. School holidays open on ' +
          "RAC's release days at 8 am AWST, 48 hours earlier for members."
      );
      expect(await policy.describe('esperance')).toMatch(/at 7 am AWST, 48 hours earlier/);
      expect(await policy.describe('cervantes')).toMatch(/at 9 am AWST, 48 hours earlier/);
    });

    it('says Cable Beach follows the rolling window, with seasonal dates at a time you set', async () => {
      expect(await makePolicy().policy.describe('cable-beach')).toBe(
        'New dates open daily at midnight AWST, 364 days ahead. Seasonal dates: choose a time you set.'
      );
    });

    it('describes nothing for a park the seed does not have', async () => {
      expect(await makePolicy().policy.describe('ningaloo')).toBeUndefined();
    });
  });
});
