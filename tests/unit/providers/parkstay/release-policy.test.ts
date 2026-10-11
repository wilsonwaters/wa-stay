/**
 * The ParkStay release policy: daily rollover at the campground's release time (PQ3),
 * scheduled releases, cancellation, the release sentence, and `suggestScheduledAt`
 * (ported from the old `release-timing.test.ts`).
 */

import { CampgroundFacts } from '@main/providers/parkstay/catalog';
import {
  formatTimeOfDay,
  isReleased,
  nextFirstTuesdayAt10,
  NO_RELEASE_TIME_TTL_MS,
  ParkStayReleasePolicy,
  parseReleaseTime,
  type ReleasePolicyDeps,
} from '@main/providers/parkstay/release-policy';
import { InMemoryKeyValueStore, ProviderError } from '@main/providers/sdk';
import { createMemoryLogger } from '@tests/utils/fake-provider';
import { parkStayFixture } from '@tests/utils/parkstay-fixture-server';

const NOW = new Date('2026-10-02T02:00:00.000Z');
const stay = (arrival: string, departure: string) => ({ arrival, departure, adults: 1 });

function policy(overrides: Partial<ReleasePolicyDeps> = {}) {
  const deps: ReleasePolicyDeps = {
    providerId: 'parkstay',
    state: new InMemoryKeyValueStore(),
    facts: new CampgroundFacts(),
    timeZone: 'Australia/Perth',
    logger: createMemoryLogger(),
    clock: () => NOW,
    ...overrides,
  };
  return { release: new ParkStayReleasePolicy(deps), deps };
}

describe('ParkStay release policy', () => {
  it('supports daily rollover, scheduled and cancellation, and nothing else', () => {
    const { release } = policy();
    expect(['daily_rollover', 'scheduled', 'cancellation'].map((m) => release.supports(m))).toEqual(
      [true, true, true]
    );
    expect(release.supports('ningaloo')).toBe(false);
  });

  it('polls no faster than 500 ms in a release window and 3 s continuously', () => {
    expect(policy().release.pollFloorMs).toEqual({ window: 500, continuous: 3000 });
  });

  describe('daily_rollover', () => {
    it("opens at the campground's release time: '02:00 AM', arrival 2027-04-01, 180 days → 2026-10-02T18:00Z", async () => {
      const { release, deps } = policy();
      deps.facts.rememberFeature('20', 0, 180);
      await deps.state.set('release.time.20', '02:00');
      const at = await release.computeReleaseAt({
        mode: 'daily_rollover',
        externalId: '20',
        stay: stay('2027-04-01', '2027-04-03'),
        now: NOW,
      });
      // 02:00 AWST on 3 Oct 2026.
      expect(at?.toISOString()).toBe('2026-10-02T18:00:00.000Z');
    });

    it('falls back to 00:00 AWST when the release time is not known', async () => {
      const { release } = policy();
      const at = await release.computeReleaseAt({
        mode: 'daily_rollover',
        externalId: '20',
        stay: stay('2027-04-01', '2027-04-03'),
        now: NOW,
      });
      expect(at?.toISOString()).toBe('2026-10-02T16:00:00.000Z');
    });

    it('reads the release time from the campground once, when it is not known yet', async () => {
      const loadView = jest.fn(async () => {
        await deps.state.set('release.time.20', '02:00');
      });
      const { release, deps } = policy({ loadView });
      const input = {
        mode: 'daily_rollover',
        externalId: '20',
        stay: stay('2027-04-01', '2027-04-02'),
        now: NOW,
      };
      expect((await release.computeReleaseAt(input))?.toISOString()).toBe(
        '2026-10-02T18:00:00.000Z'
      );
      await release.computeReleaseAt(input);
      expect(loadView).toHaveBeenCalledTimes(1);
    });

    it('does not read a campground without a release time again for an hour (offline type 1)', async () => {
      let now = NOW.getTime();
      // As the real view source does: a view without `release_time_friendly`.
      const loadView = jest.fn(async (id: string) => release.rememberReleaseTime(id, null));
      const { release } = policy({ loadView, clock: () => new Date(now) });
      const input = {
        mode: 'daily_rollover',
        externalId: '20',
        stay: stay('2027-04-01', '2027-04-02'),
        now: NOW,
      };
      for (let i = 0; i < 5; i++) {
        expect((await release.computeReleaseAt(input))?.toISOString()).toBe(
          '2026-10-02T16:00:00.000Z' // midnight AWST
        );
      }
      expect(loadView).toHaveBeenCalledTimes(1);

      now += NO_RELEASE_TIME_TTL_MS - 1;
      await release.computeReleaseAt(input);
      expect(loadView).toHaveBeenCalledTimes(1);
      now += 1;
      await release.computeReleaseAt(input);
      expect(loadView).toHaveBeenCalledTimes(2);
    });

    it('falls back to midnight, with a warning, when the campground cannot be read', async () => {
      const logger = createMemoryLogger();
      const { release } = policy({
        logger,
        loadView: async () => {
          throw new Error('HTTP 503');
        },
      });
      const at = await release.computeReleaseAt({
        mode: 'daily_rollover',
        externalId: '20',
        stay: stay('2027-04-01', '2027-04-02'),
        now: NOW,
      });
      expect(at?.toISOString()).toBe('2026-10-02T16:00:00.000Z');
      expect(logger.lines[0]).toMatchObject({ level: 'warn' });
    });

    it("uses the catalogue's booking window when it is not 180 days", async () => {
      const { release, deps } = policy();
      deps.facts.rememberFeature('7', 0, 365);
      const at = await release.computeReleaseAt({
        mode: 'daily_rollover',
        externalId: '7',
        stay: stay('2027-10-02', '2027-10-03'),
        now: NOW,
      });
      expect(at?.toISOString()).toBe('2026-10-01T16:00:00.000Z');
    });

    it('stores a release time only when it changes', async () => {
      const state = new InMemoryKeyValueStore();
      const set = jest.spyOn(state, 'set');
      const { release } = policy({ state });
      await release.rememberReleaseTime('20', '02:00 AM');
      await release.rememberReleaseTime('20', '02:00 AM');
      await release.rememberReleaseTime('20', 'garbage');
      expect(set).toHaveBeenCalledTimes(1);
      expect(await state.get('release.time.20')).toBe('02:00');
    });
  });

  describe('scheduled', () => {
    it('rejects without a requested time', async () => {
      await expect(
        policy().release.computeReleaseAt({
          mode: 'scheduled',
          externalId: '20',
          stay: stay('2027-04-01', '2027-04-02'),
          now: NOW,
        })
      ).rejects.toBeInstanceOf(ProviderError);
    });

    it('opens at the requested time', async () => {
      const requestedAt = new Date('2026-11-03T02:00:00.000Z');
      expect(
        await policy().release.computeReleaseAt({
          mode: 'scheduled',
          externalId: '20',
          stay: stay('2027-04-01', '2027-04-02'),
          requestedAt,
          now: NOW,
        })
      ).toBe(requestedAt);
    });
  });

  it('cancellation has no release (poll continuously)', async () => {
    expect(
      await policy().release.computeReleaseAt({
        mode: 'cancellation',
        externalId: '20',
        stay: stay('2026-11-10', '2026-11-12'),
        now: NOW,
      })
    ).toBeNull();
  });

  it('rejects a mode it does not support', async () => {
    await expect(
      policy().release.computeReleaseAt({
        mode: 'ningaloo',
        externalId: '20',
        stay: stay('2026-11-10', '2026-11-12'),
        now: NOW,
      })
    ).rejects.toBeInstanceOf(ProviderError);
  });

  describe('describe', () => {
    it('says "Bookings open 180 days ahead at 12:00 am AWST" when nothing more is known', async () => {
      expect(await policy().release.describe('20')).toBe(
        'Bookings open 180 days ahead at 12:00 am AWST'
      );
    });

    it("uses the campground's release time", async () => {
      const { release, deps } = policy();
      await deps.state.set('release.time.20', '02:00');
      expect(await release.describe('20')).toBe('Bookings open 180 days ahead at 2:00 am AWST');
    });

    it('during a release period: bookable up to the day before release_date; suggest a scheduled snipe', async () => {
      const { release, deps } = policy();
      deps.facts.rememberView('20', parkStayFixture('campsite_availablity_view_20.json'), NOW);
      expect(await release.describe('20')).toBe(
        'Bookable up to 31 March 2027; later dates are released in blocks — use a scheduled snipe'
      );
    });

    it('describes nothing for a campground ParkStay does not book online', async () => {
      const { release, deps } = policy();
      deps.facts.rememberFeature('5', 2, 180);
      expect(await release.describe('5')).toBeUndefined();
    });
  });

  describe('suggestScheduledAt (next first Tuesday, 10:00 AWST)', () => {
    const suggest = (from: string) =>
      policy().release.suggestScheduledAt!('20', new Date(from))!.toISOString();

    it('returns the next first-Tuesday 10:00 AWST (02:00 UTC) after `from`', () => {
      // July 2026's first Tuesday is the 7th; by the 15th the next is 4 August.
      expect(suggest('2026-07-15T00:00:00Z')).toBe('2026-08-04T02:00:00.000Z');
    });

    it('is strictly after `from` even when `from` is a first-Tuesday release', () => {
      // 1 September 2026 is itself a Tuesday.
      expect(suggest('2026-08-04T02:00:00Z')).toBe('2026-09-01T02:00:00.000Z');
    });

    it('always lands on a Tuesday within the first 7 days at 02:00 UTC', () => {
      const result = nextFirstTuesdayAt10(new Date('2026-02-10T00:00:00Z'), 'Australia/Perth');
      expect(result.getUTCDay()).toBe(2);
      expect(result.getUTCDate()).toBeLessThanOrEqual(7);
      expect(result.getUTCHours()).toBe(2);
    });

    it('uses the Perth calendar: 1 Sep 2026 23:00 UTC is already 2 Sep in Perth', () => {
      expect(suggest('2026-09-01T01:59:00Z')).toBe('2026-09-01T02:00:00.000Z');
      expect(suggest('2026-09-01T23:00:00Z')).toBe('2026-10-06T02:00:00.000Z');
    });
  });
});

describe('release time helpers', () => {
  it.each([
    ['02:00 AM', { hour: 2, minute: 0 }],
    ['12:00 AM', { hour: 0, minute: 0 }],
    ['12:30 PM', { hour: 12, minute: 30 }],
    ['10:15 pm', { hour: 22, minute: 15 }],
    ['13:00 PM', undefined],
    ['', undefined],
    [null, undefined],
  ])('parseReleaseTime(%j) → %j', (friendly, expected) => {
    expect(parseReleaseTime(friendly)).toEqual(expected);
  });

  it('formats a time of day as people read it', () => {
    expect(formatTimeOfDay({ hour: 0, minute: 0 })).toBe('12:00 am');
    expect(formatTimeOfDay({ hour: 2, minute: 0 })).toBe('2:00 am');
    expect(formatTimeOfDay({ hour: 14, minute: 5 })).toBe('2:05 pm');
  });
});

describe('isReleased', () => {
  const base = { today: '2026-10-02', maxAdvanceDays: 180 };

  it('releases dates up to today + max_advance_booking', () => {
    expect(isReleased({ ...base, date: '2027-03-30' })).toBe(true);
    expect(isReleased({ ...base, date: '2027-04-01' })).toBe(false);
  });

  it('opens the furthest date itself only once booking_time_open is true', () => {
    expect(isReleased({ ...base, date: '2027-03-31', bookingTimeOpen: false })).toBe(false);
    expect(isReleased({ ...base, date: '2027-03-31', bookingTimeOpen: true })).toBe(true);
  });

  it('during a release period, closes release_date and later', () => {
    const period = { ...base, releaseDate: '2026-11-11', bookingTimeOpen: true };
    expect(isReleased({ ...period, date: '2026-11-10' })).toBe(true);
    expect(isReleased({ ...period, date: '2026-11-11' })).toBe(false);
    expect(isReleased({ ...period, date: '2026-12-01' })).toBe(false);
  });
});
