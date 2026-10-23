/**
 * WatchService on a registry holding only FakeProviders and a real in-memory database:
 * provider resolution by capability, create validation in the provider's calendar, one
 * availability call per check with matches and partial runs from it, `next_check_at` after
 * every run, expiry with `todayIn`, and errors that never wait in a queue.
 */

import {
  AccessGateError,
  ProviderCapabilityError,
  ProviderHttpError,
  UnknownProviderError,
} from '@main/providers/sdk';
import {
  SPLIT_STAY_NO_HOLD_NOTE,
  WATCH_EDITED_DURING_CHECK,
} from '@main/core/watches/watch.service';
import type { WatchUpdate } from '@shared/types';
import { WatchResult } from '@shared/types/common.types';
import { createCoreHarness, fakeDateOnly, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider, FAKE_PRICE, type FakeUnitNights } from '@tests/utils/fake-provider';

// 4 Oct 2026, 10:00 in Perth
const NOW = new Date('2026-10-04T02:00:00.000Z');

describe('WatchService', () => {
  let h: CoreHarness;

  beforeEach(() => {
    fakeDateOnly(NOW);
    h = createCoreHarness({
      providers: [
        createFakeProvider(),
        createFakeProvider({ id: 'nowatch', capabilities: { watches: false, snipes: false } }),
        createFakeProvider({
          id: 'noholds',
          capabilities: { holds: false, snipes: false, accessGate: false },
        }),
      ],
    });
  });

  afterEach(async () => {
    await h.close();
    jest.useRealTimers();
  });

  describe('create', () => {
    it("creates a watch on 'fake' (a registry with no ParkStay), due at once", async () => {
      const watch = await h.watches.create(h.userId, h.watchInput());

      expect(watch).toMatchObject({ providerId: 'fake', isActive: true, autoHold: false });
      expect(watch.nextCheckAt).toEqual(NOW);
      // The provider's stay-field default (gear) is filled in
      expect(watch.stayParams).toEqual({ gearType: 'tent' });
      expect(h.events.emit).toHaveBeenCalledWith('watch:updated', watch);
    });

    it('rejects a provider without watches with ProviderCapabilityError, and an unknown one', async () => {
      await expect(
        h.watches.create(h.userId, h.watchInput({ providerId: 'nowatch' }))
      ).rejects.toBeInstanceOf(ProviderCapabilityError);
      await expect(
        h.watches.create(h.userId, h.watchInput({ providerId: 'gone' }))
      ).rejects.toBeInstanceOf(UnknownProviderError);
      expect(h.watchRepo.findAll()).toEqual([]);
    });

    it('rejects autoHold on a provider without holds (CAPABILITY), at create and update', async () => {
      await expect(
        h.watches.create(h.userId, h.watchInput({ providerId: 'noholds', autoHold: true }))
      ).rejects.toMatchObject({ capability: 'holds' });
      const watch = await h.watches.create(h.userId, h.watchInput({ providerId: 'noholds' }));
      await expect(h.watches.update(watch.id, { autoHold: true })).rejects.toBeInstanceOf(
        ProviderCapabilityError
      );
    });

    it('rejects a bad stay field with its issue path', async () => {
      await expect(
        h.watches.create(h.userId, h.watchInput({ stayParams: { gearType: 'yurt' } }))
      ).rejects.toMatchObject({ code: 'VALIDATION', issues: ['stayParams.gearType'] });
    });

    describe('arrival in the provider calendar (AWST, not UTC)', () => {
      it('at 20:00 UTC on 4 Oct it is 5 Oct in Perth: a 4 Oct arrival is in the past', async () => {
        jest.setSystemTime(new Date('2026-10-04T20:00:00.000Z'));
        await expect(
          h.watches.create(
            h.userId,
            h.watchInput({ stay: { arrival: '2026-10-04', departure: '2026-10-06', adults: 1 } })
          )
        ).rejects.toMatchObject({ code: 'VALIDATION', issues: ['stay.arrival'] });
        await expect(
          h.watches.create(
            h.userId,
            h.watchInput({ stay: { arrival: '2026-10-05', departure: '2026-10-06', adults: 1 } })
          )
        ).resolves.toMatchObject({ isActive: true });
      });
    });
  });

  describe('execute', () => {
    it('makes one availability call, stores the units and when the watch is next due', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput({ checkIntervalMinutes: 30 }));
      const result = await h.watches.execute(watch.id);

      expect(h.fake.calls.filter((c) => c.method === 'check')).toHaveLength(1);
      expect(result).toMatchObject({ success: true, found: true });
      expect(result.matches).toEqual([
        expect.objectContaining({ unitId: 'u1', priceKnown: true, total: 3 * FAKE_PRICE }),
      ]);
      const stored = h.watchRepo.findById(watch.id)!;
      expect(stored.lastResult).toBe(WatchResult.FOUND);
      expect(stored.lastAvailability?.map((u) => u.unitId)).toEqual(['u1', 'u2']);
      expect(stored.lastCheckedAt).toEqual(NOW);
      expect(stored.nextCheckAt).toEqual(new Date(NOW.getTime() + 30 * 60_000));
      expect(h.notifications.notifyWatchFound).toHaveBeenCalledTimes(1);
    });

    it('a 3-night stay with nights 1–2 free yields one partial result from one check call', async () => {
      h.fake.setAvailability('1', {
        u1: [{ state: 'available' }, { state: 'available' }, { state: 'booked' }],
      });
      const watch = await h.watches.create(h.userId, h.watchInput({ allowPartialMatch: true }));
      const result = await h.watches.execute(watch.id);

      expect(h.fake.calls.filter((c) => c.module === 'availability')).toHaveLength(1);
      expect(result.matches).toEqual([
        expect.objectContaining({ arrival: '2026-12-01', departure: '2026-12-03', partial: true }),
      ]);
      expect(h.watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.PARTIAL_FOUND);
      expect(h.notifications.notifyWatchPartialFound).toHaveBeenCalledTimes(1);
    });

    it('filters out $30 nights above maxPrice 25, and passes unpriced nights with priceKnown false', async () => {
      h.fake.setAvailability('1', {
        u1: [{ state: 'available' }, { state: 'available' }],
        u2: [
          { state: 'available', price: null },
          { state: 'available', price: null },
        ],
      });
      const watch = await h.watches.create(
        h.userId,
        h.watchInput({
          stay: { arrival: '2026-12-01', departure: '2026-12-03', adults: 2 },
          maxPrice: 25,
        })
      );
      const result = await h.watches.execute(watch.id);

      expect(result.matches.map((m) => [m.unitId, m.priceKnown])).toEqual([['u2', false]]);
    });

    it('deactivates a watch whose arrival has passed where the provider is (todayIn), without a request', async () => {
      const watch = await h.watches.create(
        h.userId,
        h.watchInput({ stay: { arrival: '2026-10-05', departure: '2026-10-07', adults: 1 } })
      );
      // 6 Oct 00:30 in Perth, still 5 Oct in UTC
      jest.setSystemTime(new Date('2026-10-05T16:30:00.000Z'));
      const result = await h.watches.execute(watch.id);

      expect(result).toMatchObject({ expired: true, success: false });
      expect(h.watchRepo.findById(watch.id)?.isActive).toBe(false);
      expect(h.fake.calls.filter((c) => c.module === 'availability')).toHaveLength(0);
    });

    it('still checks a watch whose arrival is today in Perth (late evening, before UTC midnight)', async () => {
      const watch = await h.watches.create(
        h.userId,
        h.watchInput({ stay: { arrival: '2026-10-05', departure: '2026-10-07', adults: 1 } })
      );
      // 5 Oct 23:59 in Perth (15:59 UTC)
      jest.setSystemTime(new Date('2026-10-05T15:59:00.000Z'));
      const result = await h.watches.execute(watch.id);
      expect(result.expired).toBeUndefined();
      expect(result.success).toBe(true);
      expect(h.fake.calls.filter((c) => c.module === 'availability')).toHaveLength(1);
    });

    it('records a gated provider as an error with no queueing, and schedules the next run normally', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput());
      h.fake.failNext('availability', new AccessGateError('fake', 'waiting'));
      const result = await h.watches.execute(watch.id);

      expect(result).toMatchObject({ success: false, errorCode: 'ACCESS_GATE' });
      expect(h.fake.calls.filter((c) => c.module === 'access')).toEqual([]);
      const stored = h.watchRepo.findById(watch.id)!;
      expect(stored.lastResult).toBe(WatchResult.ERROR);
      expect(stored.lastError).toBe('fake: the queue is waiting');
      expect(stored.nextCheckAt).toEqual(new Date(NOW.getTime() + 60 * 60_000));
    });

    it('marks a watch whose provider is gone as UNKNOWN_PROVIDER, due again after its interval', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput());
      h.db.prepare("UPDATE watches SET provider_id = 'gone' WHERE id = ?").run(watch.id);
      const result = await h.watches.execute(watch.id);

      expect(result).toMatchObject({ success: false, errorCode: 'UNKNOWN_PROVIDER' });
      expect(h.watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.ERROR);
    });

    it('a legacy 5-minute watch is due 15 minutes later and keeps its stored 5', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput());
      h.db.prepare('UPDATE watches SET check_interval_minutes = 5 WHERE id = ?').run(watch.id);
      await h.watches.execute(watch.id);

      const stored = h.watchRepo.findById(watch.id)!;
      expect(stored.checkIntervalMinutes).toBe(5);
      expect(stored.nextCheckAt).toEqual(new Date(NOW.getTime() + 15 * 60_000));
    });

    it('writes nothing once its signal is aborted', async () => {
      h.fake.delayMs = 5_000;
      const watch = await h.watches.create(h.userId, h.watchInput());
      const controller = new AbortController();
      const running = h.watches.execute(watch.id, { signal: controller.signal });
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();
      const result = await running;

      expect(result.error).toBe('The check was stopped');
      expect(h.watchRepo.findById(watch.id)?.lastCheckedAt).toBeUndefined();
    });
  });

  describe('stay types (unitKinds)', () => {
    // A mixed place: two campsites and two cabins, every unit free; s1 is listed first
    const MIXED = { s1: 'available', c1: 'available', s2: 'available', c2: 'available' } as const;

    beforeEach(async () => {
      await h.close();
      h = createCoreHarness({
        providers: [
          createFakeProvider({
            availability: { '1': MIXED },
            unitKinds: { s1: 'campsite', s2: 'campsite', c1: 'cabin', c2: 'cabin' },
          }),
        ],
      });
    });

    it("unitKinds ['cabin'] at a mixed place matches only cabins, and notifies only cabins", async () => {
      const watch = await h.watches.create(h.userId, h.watchInput({ unitKinds: ['cabin'] }));
      expect(watch.unitKinds).toEqual(['cabin']);
      const result = await h.watches.execute(watch.id);

      expect(result.matches.map((m) => m.unitId)).toEqual(['c1', 'c2']);
      const [, notified] = h.notifications.notifyWatchFound.mock.calls[0];
      expect(notified.map((m: { unitId: string }) => m.unitId)).toEqual(['c1', 'c2']);
      // The units it keeps for the watch's page are the cabins too
      expect(h.watchRepo.findById(watch.id)?.lastAvailability?.map((u) => u.unitId)).toEqual([
        'c1',
        'c2',
      ]);
    });

    it('with no kind, every unit matches as before', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput());
      expect(watch.unitKinds).toEqual([]);
      const result = await h.watches.execute(watch.id);
      expect(result.matches.map((m) => m.unitId)).toEqual(['s1', 'c1', 's2', 'c2']);
    });

    it('drops duplicate kinds at create and update; a change of kinds makes the watch due at once', async () => {
      const watch = await h.watches.create(
        h.userId,
        h.watchInput({ unitKinds: ['cabin', 'campsite', 'cabin'] })
      );
      expect(watch.unitKinds).toEqual(['cabin', 'campsite']);
      await h.watches.execute(watch.id);
      expect(h.watchRepo.findById(watch.id)?.nextCheckAt).toEqual(
        new Date(NOW.getTime() + 60 * 60_000)
      );

      const updated = await h.watches.update(watch.id, { unitKinds: ['dorm', 'dorm'] });
      expect(updated.unitKinds).toEqual(['dorm']);
      expect(updated.nextCheckAt).toEqual(NOW);
      await expect(h.watches.update(watch.id, { unitKinds: [] })).resolves.toMatchObject({
        unitKinds: [],
      });
    });
  });

  describe('stay rules (R8)', () => {
    it('a 2-night stay whose every night is refused under a 3-night minimum is NOT_FOUND, with no alert', async () => {
      const refused = { state: 'unknown', reason: 'min-stay', minNights: 3 } as const;
      h.fake.setAvailability('1', {
        u1: [{ ...refused, noArrival: true }, { ...refused }],
        u2: [{ ...refused }, { ...refused, noDeparture: true }],
      });
      const watch = await h.watches.create(
        h.userId,
        h.watchInput({
          stay: { arrival: '2026-12-01', departure: '2026-12-03', adults: 2 },
          allowPartialMatch: true,
        })
      );
      const result = await h.watches.execute(watch.id);

      expect(result).toMatchObject({ success: true, found: false, matches: [] });
      const stored = h.watchRepo.findById(watch.id)!;
      expect(stored.lastResult).toBe(WatchResult.NOT_FOUND);
      // The nights are kept as the provider said them, for the watch's page
      expect(stored.lastAvailability?.[0].nights[0]).toMatchObject({
        reason: 'min-stay',
        minNights: 3,
        noArrival: true,
      });
      expect(h.notifications.notifyWatchFound).not.toHaveBeenCalled();
      expect(h.notifications.notifyWatchPartialFound).not.toHaveBeenCalled();
      expect((await h.watches.get(watch.id))?.bookingLink).toBeUndefined();
    });

    it('a partial alert names the run from the day after a no-arrival night, with its booking page', async () => {
      h.fake.setAvailability('1', {
        u1: [
          { state: 'available', noArrival: true },
          { state: 'available' },
          { state: 'available' },
        ],
        u2: 'booked',
      });
      const watch = await h.watches.create(h.userId, h.watchInput({ allowPartialMatch: true }));
      const result = await h.watches.execute(watch.id);

      expect(result.matches).toEqual([
        expect.objectContaining({ unitId: 'u1', arrival: '2026-12-02', departure: '2026-12-04' }),
      ]);
      expect(h.watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.PARTIAL_FOUND);
      const url = 'https://fake.example/book/1?arrival=2026-12-02&departure=2026-12-04';
      expect(h.notifications.notifyWatchPartialFound).toHaveBeenCalledWith(
        expect.objectContaining({ id: watch.id }),
        [expect.objectContaining({ unitId: 'u1', arrival: '2026-12-02' })],
        url
      );
      expect((await h.watches.get(watch.id))?.bookingLink).toEqual({
        url,
        arrival: '2026-12-02',
        departure: '2026-12-04',
      });
    });
  });

  describe('booking links (R7)', () => {
    /** The fake's booking page (`links.booking`) for location 1 and these dates. */
    const bookingUrl = (arrival: string, departure: string) =>
      `https://fake.example/book/1?arrival=${arrival}&departure=${departure}`;
    const WHOLE_STAY = bookingUrl('2026-12-01', '2026-12-04');
    /** The `watch:updated` payloads for `id`, oldest first. */
    const updates = (id: number) =>
      h.events.emit.mock.calls
        .filter(([name, watch]) => name === 'watch:updated' && watch.id === id)
        .map(([, watch]) => watch);

    it('a found alert gets the booking page for the stay, and get, list and watch:updated carry it', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput());
      expect(watch.bookingLink).toBeUndefined();
      await h.watches.execute(watch.id);

      expect(h.notifications.notifyWatchFound).toHaveBeenCalledWith(
        expect.objectContaining({ id: watch.id }),
        [expect.objectContaining({ unitId: 'u1' })],
        undefined,
        WHOLE_STAY
      );
      const link = { url: WHOLE_STAY, arrival: '2026-12-01', departure: '2026-12-04' };
      expect((await h.watches.get(watch.id))?.bookingLink).toEqual(link);
      expect((await h.watches.list(h.userId)).map((w) => w.bookingLink)).toEqual([link]);
      expect(updates(watch.id).at(-1)?.bookingLink).toEqual(link);
      // Derived, never stored
      expect(h.watchRepo.findById(watch.id)?.bookingLink).toBeUndefined();
    });

    it("a partial alert gets the booking page for the longest run, with the run's dates", async () => {
      h.fake.setAvailability('1', {
        u1: [{ state: 'available' }, { state: 'booked' }, { state: 'available' }],
        u2: [{ state: 'available' }, { state: 'available' }, { state: 'booked' }],
      });
      const watch = await h.watches.create(h.userId, h.watchInput({ allowPartialMatch: true }));
      await h.watches.execute(watch.id);

      const runUrl = bookingUrl('2026-12-01', '2026-12-03');
      expect(h.notifications.notifyWatchPartialFound).toHaveBeenCalledWith(
        expect.objectContaining({ id: watch.id }),
        expect.arrayContaining([expect.objectContaining({ unitId: 'u2', partial: true })]),
        runUrl
      );
      expect((await h.watches.get(watch.id))?.bookingLink).toEqual({
        url: runUrl,
        arrival: '2026-12-01',
        departure: '2026-12-03',
      });
    });

    it('a held alert gets the booking page too (the email’s fallback), and the held watch has none', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));
      await h.watches.execute(watch.id);

      expect(h.notifications.notifyWatchHeld).toHaveBeenCalledWith(
        expect.objectContaining({ id: watch.id }),
        expect.objectContaining({ reference: 'FAKE-1' }),
        expect.objectContaining({ unitName: 'Site u1' }),
        WHOLE_STAY
      );
      const held = await h.watches.get(watch.id);
      expect(held?.lastResult).toBe(WatchResult.HELD);
      expect(held?.bookingLink).toBeUndefined();
    });

    it("uses the first full match's own unit link, after maxPrice has left a unit out", async () => {
      await h.close();
      h = createCoreHarness({
        providers: [
          createFakeProvider({
            unitBookingUrls: true,
            availability: {
              '1': {
                u1: [
                  { state: 'available', price: 40 },
                  { state: 'available', price: 40 },
                  { state: 'available', price: 40 },
                ],
                u2: 'available',
                u3: 'available',
              },
            },
          }),
        ],
      });
      const watch = await h.watches.create(h.userId, h.watchInput({ maxPrice: 35 }));
      await h.watches.execute(watch.id);

      const u2 = 'https://book.fake.example/1/u2?arrival=2026-12-01&departure=2026-12-04';
      const [, matches, , url] = h.notifications.notifyWatchFound.mock.calls[0];
      expect(matches.map((m: { unitId: string }) => m.unitId)).toEqual(['u2', 'u3']);
      expect(url).toBe(u2);
      expect((await h.watches.get(watch.id))?.bookingLink?.url).toBe(u2);
    });

    it('get and list have none for a result other than found or partly found', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput());
      await h.watches.execute(watch.id);
      expect((await h.watches.get(watch.id))?.bookingLink).toBeDefined();

      // A failed check keeps the stored units but is no longer a find
      h.fake.failNext('availability', new Error('HTTP 500'));
      await h.watches.execute(watch.id, { manual: true });
      expect((await h.watches.get(watch.id))?.lastResult).toBe(WatchResult.ERROR);
      expect((await h.watches.get(watch.id))?.bookingLink).toBeUndefined();

      h.fake.setAvailability('1', { u1: 'booked', u2: 'booked' });
      await h.watches.execute(watch.id, { manual: true });
      expect((await h.watches.get(watch.id))?.lastResult).toBe(WatchResult.NOT_FOUND);
      expect((await h.watches.list(h.userId))[0].bookingLink).toBeUndefined();
      expect(updates(watch.id).at(-1)?.bookingLink).toBeUndefined();
    });

    it('after the stay is edited there is none, until a check of the new stay', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput());
      await h.watches.execute(watch.id);
      expect((await h.watches.get(watch.id))?.bookingLink).toBeDefined();

      const newStay = { arrival: '2026-12-02', departure: '2026-12-05', adults: 2 };
      const updated = await h.watches.update(watch.id, { stay: newStay });
      expect(updated.lastResult).toBe(WatchResult.FOUND);
      expect(updated.bookingLink).toBeUndefined();
      expect(updates(watch.id).at(-1)?.bookingLink).toBeUndefined();
      expect((await h.watches.get(watch.id))?.bookingLink).toBeUndefined();
      expect((await h.watches.list(h.userId))[0].bookingLink).toBeUndefined();

      // A longer stay that still starts on the same night has none either
      await h.watches.update(watch.id, {
        stay: { arrival: '2026-12-01', departure: '2026-12-05', adults: 2 },
      });
      expect((await h.watches.get(watch.id))?.bookingLink).toBeUndefined();

      await h.watches.execute(watch.id, { manual: true });
      expect((await h.watches.get(watch.id))?.bookingLink?.url).toBe(
        bookingUrl('2026-12-01', '2026-12-05')
      );
    });

    it('after the location is edited there is none, also for a paused watch the due-loop skips', async () => {
      // notifyOnly: paused right after its found alert, so no check runs on its own
      const watch = await h.watches.create(h.userId, h.watchInput({ notifyOnly: true }));
      await h.watches.execute(watch.id);
      const paused = await h.watches.get(watch.id);
      expect(paused).toMatchObject({ isActive: false, lastResult: WatchResult.FOUND });
      expect(paused?.bookingLink?.url).toBe(WHOLE_STAY);

      // A new name for the same place keeps what the check found
      await h.watches.update(watch.id, { location: { externalId: '1', name: 'Banksia (north)' } });
      expect((await h.watches.get(watch.id))?.bookingLink?.url).toBe(WHOLE_STAY);

      const moved = await h.watches.update(watch.id, {
        location: { externalId: '2', name: 'Karri Grove' },
      });
      expect(moved.bookingLink).toBeUndefined();
      expect(moved).toMatchObject({ isActive: false });
      // The old place's check is forgotten: no result, units or time to show for the new one
      expect(moved.lastResult).toBeUndefined();
      expect(moved.lastAvailability).toBeUndefined();
      expect(moved.lastCheckedAt).toBeUndefined();
      expect(updates(watch.id).at(-1)?.bookingLink).toBeUndefined();
      expect((await h.watches.get(watch.id))?.bookingLink).toBeUndefined();
      expect((await h.watches.list(h.userId))[0].bookingLink).toBeUndefined();
      expect(h.watches.findDue(new Date(NOW.getTime() + 60_000), ['fake'])).toEqual([]);

      // Its next check is of the new place, with the new place's link
      await h.watches.execute(watch.id, { manual: true });
      expect((await h.watches.get(watch.id))?.bookingLink?.url).toBe(
        'https://fake.example/book/2?arrival=2026-12-01&departure=2026-12-04'
      );
    });

    it('a check in flight when the watch moves to another place keeps nothing and alerts on nothing', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput());
      h.fake.delayMs = 20;
      const running = h.watches.execute(watch.id, { manual: true });
      // The provider is answering about place 1 when the watch moves to place 2
      await new Promise((resolve) => setTimeout(resolve, 5));
      await h.watches.update(watch.id, { location: { externalId: '2', name: 'Karri Grove' } });
      const result = await running;

      expect(result).toMatchObject({ success: false, found: false, matches: [] });
      expect(result.error).toBe(WATCH_EDITED_DURING_CHECK);
      const moved = (await h.watches.get(watch.id))!;
      expect(moved.lastResult).toBeUndefined();
      expect(moved.lastAvailability).toBeUndefined();
      expect(moved.lastCheckedAt).toBeUndefined();
      expect(moved.bookingLink).toBeUndefined();
      expect(h.notifications.notifyWatchFound).not.toHaveBeenCalled();
      // The edit made it due at once: the next check is of the new place
      expect(h.watches.findDue(NOW, ['fake']).map((w) => w.id)).toEqual([watch.id]);
      h.fake.delayMs = 0;
      await h.watches.execute(watch.id);
      expect((await h.watches.get(watch.id))?.bookingLink?.url).toBe(
        'https://fake.example/book/2?arrival=2026-12-01&departure=2026-12-04'
      );
    });

    it("a check in flight keeps its answer when only the place's name or the interval changes", async () => {
      const watch = await h.watches.create(h.userId, h.watchInput());
      h.fake.delayMs = 20;
      const running = h.watches.execute(watch.id, { manual: true });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await h.watches.update(watch.id, {
        location: { externalId: '1', name: 'Banksia (north)' },
        checkIntervalMinutes: 60,
      });

      await expect(running).resolves.toMatchObject({ success: true, found: true });
      expect(h.watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.FOUND);
      expect(h.notifications.notifyWatchFound).toHaveBeenCalledTimes(1);
    });

    it.each<[string, WatchUpdate]>([
      ['dates', { stay: { arrival: '2026-12-02', departure: '2026-12-04', adults: 2 } }],
      ['units', { unitIds: ['u1'] }],
      ['stay types', { unitKinds: ['cabin'] }],
      ['stay fields', { stayParams: { gearType: 'caravan' } }],
    ])(
      'a check in flight when its %s change keeps nothing and alerts on nothing',
      async (_what, edit) => {
        const watch = await h.watches.create(h.userId, h.watchInput());
        h.fake.delayMs = 20;
        const running = h.watches.execute(watch.id, { manual: true });
        await new Promise((resolve) => setTimeout(resolve, 5));
        await h.watches.update(watch.id, edit);

        await expect(running).resolves.toMatchObject({
          success: false,
          error: WATCH_EDITED_DURING_CHECK,
        });
        const stored = h.watchRepo.findById(watch.id)!;
        expect(stored.lastResult).toBeUndefined();
        expect(stored.lastAvailability).toBeUndefined();
        expect(h.notifications.notifyWatchFound).not.toHaveBeenCalled();
        expect(h.watches.findDue(NOW, ['fake']).map((w) => w.id)).toEqual([watch.id]);
      }
    );

    it('a check in flight keeps its answer when automatic holds fill in a stay field only holds use', async () => {
      await h.close();
      h = createCoreHarness({
        providers: [
          createFakeProvider({
            stayFields: [
              {
                key: 'vehicles',
                label: 'Vehicles',
                type: 'number',
                min: 0,
                max: 3,
                default: 1,
                appliesTo: ['hold'],
              },
            ],
          }),
        ],
      });
      const watch = await h.watches.create(h.userId, h.watchInput());
      h.fake.delayMs = 20;
      const running = h.watches.execute(watch.id, { manual: true });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await h.watches.update(watch.id, { autoHold: true });
      expect(h.watchRepo.findById(watch.id)?.stayParams).toEqual({ gearType: 'tent', vehicles: 1 });

      await expect(running).resolves.toMatchObject({ success: true, found: true });
      expect(h.watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.FOUND);
      expect(h.notifications.notifyWatchFound).toHaveBeenCalledTimes(1);
    });

    it('a check that fails while the watch moves keeps nothing of the failure, and is due again', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput());
      h.fake.delayMs = 20;
      h.fake.failNext(
        'availability',
        new ProviderHttpError({ providerId: 'fake', status: 500, url: 'https://fake.example/a' })
      );
      const running = h.watches.execute(watch.id, { manual: true });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await h.watches.update(watch.id, { location: { externalId: '2', name: 'Karri Grove' } });

      await expect(running).resolves.toMatchObject({
        success: false,
        error: WATCH_EDITED_DURING_CHECK,
      });
      const moved = h.watchRepo.findById(watch.id)!;
      expect(moved.lastResult).toBeUndefined();
      expect(moved.lastError).toBeUndefined();
      expect(moved.lastCheckedAt).toBeUndefined();
      expect(h.watches.findDue(NOW, ['fake']).map((w) => w.id)).toEqual([watch.id]);
    });

    it.each([403, 429])(
      "keeps a provider's block (HTTP %i) met while the watch moves, and the next check waits its interval",
      async (status) => {
        const watch = await h.watches.create(h.userId, h.watchInput());
        h.fake.delayMs = 20;
        h.fake.failNext(
          'availability',
          new ProviderHttpError({
            providerId: 'fake',
            status,
            url: 'https://fake.example/a',
            retryable: false,
            message: `Fake turned the request away (HTTP ${status}).`,
          })
        );
        const running = h.watches.execute(watch.id, { manual: true });
        await new Promise((resolve) => setTimeout(resolve, 5));
        await h.watches.update(watch.id, { location: { externalId: '2', name: 'Karri Grove' } });

        const result = await running;
        expect(result).toMatchObject({ success: false });
        expect(result.error).not.toBe(WATCH_EDITED_DURING_CHECK);
        const moved = h.watchRepo.findById(watch.id)!;
        expect(moved.lastResult).toBe(WatchResult.ERROR);
        expect(moved.lastError).toBe(`Fake turned the request away (HTTP ${status}).`);
        expect(h.watches.findDue(NOW, ['fake'])).toEqual([]);
        expect(moved.nextCheckAt!.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 60 * 60_000);
      }
    );

    it('a held watch moved to another place keeps its hold and the held unit, and gets no link', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));
      await h.watches.execute(watch.id);
      const moved = await h.watches.update(watch.id, {
        location: { externalId: '2', name: 'Karri Grove' },
      });
      expect(moved).toMatchObject({ lastResult: WatchResult.HELD, hold: { reference: 'FAKE-1' } });
      expect(moved.lastAvailability?.map((u) => u.unitName)).toEqual(['Site u1', 'Site u2']);
      expect(moved.bookingLink).toBeUndefined();
    });

    it('a stored check it cannot read gives no link, and get and list still answer', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput());
      await h.watches.execute(watch.id);
      h.db
        .prepare('UPDATE watches SET last_availability = ? WHERE id = ?')
        .run(
          JSON.stringify([
            { unitId: 'u1', unitName: 'Site u1', nights: [null], fullyAvailable: true },
          ]),
          watch.id
        );

      expect((await h.watches.get(watch.id))?.bookingLink).toBeUndefined();
      expect((await h.watches.list(h.userId)).map((w) => [w.id, w.bookingLink])).toEqual([
        [watch.id, undefined],
      ]);
    });

    it('a notifyOnly watch paused after its alert keeps the link; an unregistered provider gives none', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput({ notifyOnly: true }));
      await h.watches.execute(watch.id);
      const paused = await h.watches.get(watch.id);
      expect(paused?.isActive).toBe(false);
      expect(paused?.bookingLink?.url).toBe(WHOLE_STAY);

      h.db.prepare("UPDATE watches SET provider_id = 'gone' WHERE id = ?").run(watch.id);
      expect((await h.watches.get(watch.id))?.bookingLink).toBeUndefined();
      expect((await h.watches.list(h.userId))[0].bookingLink).toBeUndefined();
    });
  });

  describe('lifecycle', () => {
    it('activate makes a watch due now; a held or booked watch cannot be activated again', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput());
      await h.watches.deactivate(watch.id);
      jest.setSystemTime(new Date(NOW.getTime() + 60_000));
      await h.watches.activate(watch.id);
      expect(h.watchRepo.findById(watch.id)).toMatchObject({
        isActive: true,
        nextCheckAt: new Date(NOW.getTime() + 60_000),
      });

      h.watchRepo.markHeld(watch.id, {
        reference: '41',
        expiresAt: new Date(NOW.getTime() + 60_000),
      });
      await expect(h.watches.activate(watch.id)).rejects.toMatchObject({
        code: 'VALIDATION',
        message: expect.stringContaining('already placed a hold'),
      });

      h.watchRepo.setBooked(watch.id);
      await expect(h.watches.activate(watch.id)).rejects.toMatchObject({
        code: 'VALIDATION',
        message: expect.stringContaining('already booked'),
      });
      expect(h.watchRepo.findById(watch.id)?.isActive).toBe(false);
    });

    it('list filters by provider and state', async () => {
      const a = await h.watches.create(h.userId, h.watchInput());
      const b = await h.watches.create(h.userId, h.watchInput({ providerId: 'noholds' }));
      await h.watches.deactivate(b.id);

      expect((await h.watches.list(h.userId, { providerId: 'fake' })).map((w) => w.id)).toEqual([
        a.id,
      ]);
      expect((await h.watches.list(h.userId, { status: 'inactive' })).map((w) => w.id)).toEqual([
        b.id,
      ]);
    });
  });

  describe('split stays', () => {
    /** Site u1 free the first two nights, u2 the third: every night free, none on one unit. */
    const SPLIT: Record<string, FakeUnitNights> = {
      u1: [{ state: 'available' }, { state: 'available' }, { state: 'booked' }],
      u2: [{ state: 'booked' }, { state: 'booked' }, { state: 'available' }],
    };
    /** The fake's booking page for location 1 and these dates (it ignores the unit). */
    const partUrl = (arrival: string, departure: string) =>
      `https://fake.example/book/1?arrival=${arrival}&departure=${departure}`;
    const UNLINKED = [
      {
        booking: 'separate',
        units: 2,
        parts: [
          {
            unitId: 'u1',
            unitName: 'Site u1',
            arrival: '2026-12-01',
            departure: '2026-12-03',
            total: 2 * FAKE_PRICE,
          },
          {
            unitId: 'u2',
            unitName: 'Site u2',
            arrival: '2026-12-03',
            departure: '2026-12-04',
            total: FAKE_PRICE,
          },
        ],
        total: 3 * FAKE_PRICE,
      },
    ];
    const LINKED = [
      {
        ...UNLINKED[0],
        parts: [
          { ...UNLINKED[0].parts[0], bookingUrl: partUrl('2026-12-01', '2026-12-03') },
          { ...UNLINKED[0].parts[1], bookingUrl: partUrl('2026-12-03', '2026-12-04') },
        ],
      },
    ];
    /** The `watch:updated` payloads for `id`, oldest first. */
    const updates = (id: number) =>
      h.events.emit.mock.calls
        .filter(([name, watch]) => name === 'watch:updated' && watch.id === id)
        .map(([, watch]) => watch);

    beforeEach(() => h.fake.setAvailability('1', SPLIT));

    it('off (the default): nothing changes, NOT_FOUND or PARTIAL_FOUND as before', async () => {
      const plain = await h.watches.create(h.userId, h.watchInput());
      expect(plain.allowSplitStay).toBe(false);
      await expect(h.watches.execute(plain.id)).resolves.toMatchObject({
        success: true,
        found: false,
        matches: [],
      });
      expect(h.watchRepo.findById(plain.id)?.lastResult).toBe(WatchResult.NOT_FOUND);

      const partly = await h.watches.create(h.userId, h.watchInput({ allowPartialMatch: true }));
      const result = await h.watches.execute(partly.id);
      expect(result.splitStays).toBeUndefined();
      expect(h.watchRepo.findById(partly.id)?.lastResult).toBe(WatchResult.PARTIAL_FOUND);
      expect(h.notifications.notifyWatchPartialFound).toHaveBeenCalledTimes(1);
      expect(h.notifications.notifyWatchSplitFound).not.toHaveBeenCalled();
    });

    it('on: SPLIT_FOUND, counted as found, above some nights, from the one check', async () => {
      const watch = await h.watches.create(
        h.userId,
        h.watchInput({ allowSplitStay: true, allowPartialMatch: true })
      );
      expect(watch.allowSplitStay).toBe(true);
      const result = await h.watches.execute(watch.id);

      expect(h.fake.calls.filter((c) => c.module === 'availability')).toHaveLength(1);
      expect(result).toMatchObject({ success: true, found: true, matches: [] });
      expect(result.splitStays).toEqual(LINKED);
      const stored = h.watchRepo.findById(watch.id)!;
      expect(stored).toMatchObject({ lastResult: WatchResult.SPLIT_FOUND, foundCount: 1 });
      expect(stored.lastAvailability?.map((u) => u.unitId)).toEqual(['u1', 'u2']);
      expect(stored.lastError).toBeUndefined();
      expect(h.notifications.notifyWatchPartialFound).not.toHaveBeenCalled();
      expect(h.notifications.notifyWatchFound).not.toHaveBeenCalled();
    });

    it('the alert gets the split stays with each part’s booking page, and no note', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput({ allowSplitStay: true }));
      await h.watches.execute(watch.id);

      expect(h.notifications.notifyWatchSplitFound).toHaveBeenCalledTimes(1);
      expect(h.notifications.notifyWatchSplitFound).toHaveBeenCalledWith(
        expect.objectContaining({ id: watch.id }),
        LINKED,
        undefined
      );
    });

    it('found beats a split stay', async () => {
      h.fake.setAvailability('1', { ...SPLIT, u3: 'available' });
      const watch = await h.watches.create(h.userId, h.watchInput({ allowSplitStay: true }));
      const result = await h.watches.execute(watch.id);

      expect(result.matches).toEqual([expect.objectContaining({ unitId: 'u3', partial: false })]);
      expect(result.splitStays).toBeUndefined();
      expect(h.watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.FOUND);
      expect(h.notifications.notifyWatchFound).toHaveBeenCalledTimes(1);
      expect(h.notifications.notifyWatchSplitFound).not.toHaveBeenCalled();
    });

    it('never holds a split stay, even with autoHold: no night reserved, no hold; the alert says so', async () => {
      const create = jest.spyOn(h.registry.get('fake').holds!, 'create');
      const reserve = jest.spyOn(h.nightGuard, 'tryReserve');
      const watch = await h.watches.create(
        h.userId,
        h.watchInput({ allowSplitStay: true, autoHold: true })
      );
      const result = await h.watches.execute(watch.id);

      expect(create).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
      expect(result.hold).toBeUndefined();
      expect(h.notifications.notifyWatchHeld).not.toHaveBeenCalled();
      expect(h.notifications.notifyWatchSplitFound).toHaveBeenCalledWith(
        expect.objectContaining({ id: watch.id }),
        LINKED,
        SPLIT_STAY_NO_HOLD_NOTE
      );
      expect(SPLIT_STAY_NO_HOLD_NOTE).toBe("WA Stay doesn't hold these automatically.");
      expect(h.watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.SPLIT_FOUND);
    });

    it('a notify-only watch pauses after a split alert; one that is not keeps watching', async () => {
      const once = await h.watches.create(
        h.userId,
        h.watchInput({ allowSplitStay: true, notifyOnly: true })
      );
      await h.watches.execute(once.id);
      expect(h.watchRepo.findById(once.id)?.isActive).toBe(false);

      const always = await h.watches.create(
        h.userId,
        h.watchInput({ allowSplitStay: true, notifyOnly: false })
      );
      await h.watches.execute(always.id);
      expect(h.watchRepo.findById(always.id)?.isActive).toBe(true);
    });

    it('a reported split stay booked through the place carries its contact page', async () => {
      await h.close();
      h = createCoreHarness({
        providers: [
          createFakeProvider({
            contactLinks: true,
            splitStays: { cat: { booking: 'contact' } },
            availability: {
              '1': {
                cat: [
                  { state: 'unknown', reason: 'split', price: 40 },
                  { state: 'unknown', reason: 'split', price: 40 },
                  { state: 'unknown', reason: 'split', price: 40 },
                ],
              },
            },
          }),
        ],
      });
      const watch = await h.watches.create(h.userId, h.watchInput({ allowSplitStay: true }));
      const result = await h.watches.execute(watch.id);

      const contact = [
        {
          booking: 'contact',
          unitId: 'cat',
          unitName: 'Site cat',
          total: 120,
          contactUrl: 'https://fake.example/locations/1/contact',
        },
      ];
      expect(result.splitStays).toEqual(contact);
      expect(h.notifications.notifyWatchSplitFound).toHaveBeenCalledWith(
        expect.anything(),
        contact,
        undefined
      );
      expect((await h.watches.get(watch.id))?.splitStays).toEqual(contact);
    });

    it('at a place of several kinds finds one per kind, never across them, the best first', async () => {
      await h.close();
      h = createCoreHarness({
        providers: [
          createFakeProvider({
            unitKinds: { s1: 'campsite', s2: 'campsite', c1: 'cabin', c2: 'cabin' },
            availability: {
              '1': {
                s1: SPLIT.u1,
                c1: [{ state: 'available' }, { state: 'booked' }, { state: 'booked' }],
                s2: SPLIT.u2,
                c2: [{ state: 'booked' }, { state: 'available' }, { state: 'available' }],
              },
            },
          }),
        ],
      });
      const watch = await h.watches.create(
        h.userId,
        h.watchInput({ allowSplitStay: true, autoHold: true })
      );
      const result = await h.watches.execute(watch.id);

      expect(
        result.splitStays?.map((split) => [split.unitKind, split.parts?.map((p) => p.unitId)])
      ).toEqual([
        ['campsite', ['s1', 's2']],
        ['cabin', ['c1', 'c2']],
      ]);
      expect(h.fake.calls.filter((c) => c.module === 'holds')).toEqual([]);
    });

    it('get, list and watch:updated carry them while split-found for the stay’s nights; never bookingLink', async () => {
      const watch = await h.watches.create(
        h.userId,
        h.watchInput({ allowSplitStay: true, notifyOnly: false })
      );
      expect(watch.splitStays).toBeUndefined();
      await h.watches.execute(watch.id);

      expect((await h.watches.get(watch.id))?.splitStays).toEqual(LINKED);
      expect((await h.watches.list(h.userId)).map((w) => w.splitStays)).toEqual([LINKED]);
      expect(updates(watch.id).at(-1)?.splitStays).toEqual(LINKED);
      expect((await h.watches.get(watch.id))?.bookingLink).toBeUndefined();
      // Derived, never stored
      expect(h.watchRepo.findById(watch.id)?.splitStays).toBeUndefined();

      // Another stay: the stored nights are not its nights
      const edited = await h.watches.update(watch.id, {
        stay: { arrival: '2026-12-01', departure: '2026-12-05', adults: 2 },
      });
      expect(edited.lastResult).toBe(WatchResult.SPLIT_FOUND);
      expect(edited.splitStays).toBeUndefined();
      expect((await h.watches.get(watch.id))?.splitStays).toBeUndefined();

      // Nothing found any more
      await h.watches.update(watch.id, {
        stay: { arrival: '2026-12-01', departure: '2026-12-04', adults: 2 },
      });
      h.fake.setAvailability('1', { u1: 'booked', u2: 'booked' });
      await h.watches.execute(watch.id);
      expect((await h.watches.get(watch.id))?.lastResult).toBe(WatchResult.NOT_FOUND);
      expect((await h.watches.get(watch.id))?.splitStays).toBeUndefined();
      expect(updates(watch.id).at(-1)?.splitStays).toBeUndefined();
    });

    it('a found or partly found watch has none, and a split-found one keeps none after moving', async () => {
      const found = await h.watches.create(h.userId, h.watchInput({ allowSplitStay: true }));
      h.fake.setAvailability('1', { ...SPLIT, u3: 'available' });
      await h.watches.execute(found.id);
      expect((await h.watches.get(found.id))?.splitStays).toBeUndefined();
      expect((await h.watches.get(found.id))?.bookingLink).toBeDefined();

      h.fake.setAvailability('1', SPLIT);
      const moved = await h.watches.create(h.userId, h.watchInput({ allowSplitStay: true }));
      await h.watches.execute(moved.id);
      expect((await h.watches.get(moved.id))?.splitStays).toEqual(LINKED);
      const away = await h.watches.update(moved.id, {
        location: { externalId: '2', name: 'Karri Grove' },
      });
      expect(away.lastResult).toBeUndefined();
      expect(away.splitStays).toBeUndefined();
    });

    it('quietly: no links for a provider no longer registered; none for a check it cannot read', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput({ allowSplitStay: true }));
      await h.watches.execute(watch.id);

      h.db.prepare("UPDATE watches SET provider_id = 'gone' WHERE id = ?").run(watch.id);
      expect((await h.watches.get(watch.id))?.splitStays).toEqual(UNLINKED);

      h.db.prepare("UPDATE watches SET provider_id = 'fake' WHERE id = ?").run(watch.id);
      h.db
        .prepare('UPDATE watches SET last_availability = ? WHERE id = ?')
        .run(
          JSON.stringify([
            { unitId: 'u1', unitName: 'Site u1', nights: [null], fullyAvailable: false },
          ]),
          watch.id
        );
      expect((await h.watches.get(watch.id))?.splitStays).toBeUndefined();
      expect((await h.watches.list(h.userId)).map((w) => [w.id, w.splitStays])).toEqual([
        [watch.id, undefined],
      ]);
    });

    it('turning the option on or off makes the watch due at once; setting what it is does not', async () => {
      h.fake.setAvailability('1', { u1: 'booked', u2: 'booked' });
      const watch = await h.watches.create(h.userId, h.watchInput({ notifyOnly: false }));
      await h.watches.execute(watch.id);
      const later = new Date(NOW.getTime() + 60 * 60_000);
      expect(h.watchRepo.findById(watch.id)?.nextCheckAt).toEqual(later);

      await h.watches.update(watch.id, { allowSplitStay: false });
      expect(h.watchRepo.findById(watch.id)?.nextCheckAt).toEqual(later);

      const on = await h.watches.update(watch.id, { allowSplitStay: true });
      expect(on.allowSplitStay).toBe(true);
      expect(h.watchRepo.findById(watch.id)?.nextCheckAt).toEqual(NOW);

      await h.watches.execute(watch.id);
      expect(h.watchRepo.findById(watch.id)?.nextCheckAt).toEqual(later);
      const off = await h.watches.update(watch.id, { allowSplitStay: false });
      expect(off.allowSplitStay).toBe(false);
      expect(h.watchRepo.findById(watch.id)?.nextCheckAt).toEqual(NOW);
    });

    it('split stays turned off while a check runs: nothing kept, no alert, no pause, due again at once', async () => {
      const watch = await h.watches.create(
        h.userId,
        h.watchInput({ allowSplitStay: true, notifyOnly: true })
      );
      h.fake.delayMs = 20;
      const running = h.watches.execute(watch.id, { manual: true });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await h.watches.update(watch.id, { allowSplitStay: false });

      await expect(running).resolves.toMatchObject({
        success: false,
        found: false,
        error: WATCH_EDITED_DURING_CHECK,
      });
      const stored = h.watchRepo.findById(watch.id)!;
      expect(stored).toMatchObject({ isActive: true, allowSplitStay: false, foundCount: 0 });
      expect(stored.lastResult).toBeUndefined();
      expect(stored.lastAvailability).toBeUndefined();
      expect(stored.nextCheckAt).toEqual(NOW);
      expect(h.notifications.notifyWatchSplitFound).not.toHaveBeenCalled();
      expect(h.watches.findDue(NOW, ['fake']).map((w) => w.id)).toEqual([watch.id]);
    });

    it('split stays turned on while a check runs: nothing kept, and due at once to answer it', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput({ notifyOnly: true }));
      h.fake.delayMs = 20;
      const running = h.watches.execute(watch.id, { manual: true });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await h.watches.update(watch.id, { allowSplitStay: true });

      await expect(running).resolves.toMatchObject({
        success: false,
        error: WATCH_EDITED_DURING_CHECK,
      });
      const stored = h.watchRepo.findById(watch.id)!;
      expect(stored.lastResult).toBeUndefined();
      expect(stored.lastAvailability).toBeUndefined();
      expect(stored.nextCheckAt).toEqual(NOW);
      expect(h.watches.findDue(NOW, ['fake']).map((w) => w.id)).toEqual([watch.id]);

      // The next check answers what the watch asks now
      h.fake.delayMs = 0;
      await h.watches.execute(watch.id);
      expect(h.watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.SPLIT_FOUND);
      expect(h.notifications.notifyWatchSplitFound).toHaveBeenCalledTimes(1);
    });

    it('turning split stays off forgets a split-found check, also on a watch paused after its alert', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput({ allowSplitStay: true }));
      await h.watches.execute(watch.id);
      const paused = (await h.watches.get(watch.id))!;
      expect(paused).toMatchObject({ isActive: false, lastResult: WatchResult.SPLIT_FOUND });
      expect(paused.splitStays).toEqual(LINKED);

      const off = await h.watches.update(watch.id, { allowSplitStay: false });
      expect(off).toMatchObject({ isActive: false, allowSplitStay: false });
      expect(off.lastResult).toBeUndefined();
      expect(off.lastAvailability).toBeUndefined();
      expect(off.splitStays).toBeUndefined();
      expect(updates(watch.id).at(-1)?.splitStays).toBeUndefined();
    });

    it('turning split stays off keeps any other result', async () => {
      h.fake.setAvailability('1', { ...SPLIT, u3: 'available' });
      const watch = await h.watches.create(
        h.userId,
        h.watchInput({ allowSplitStay: true, notifyOnly: false })
      );
      await h.watches.execute(watch.id);
      const off = await h.watches.update(watch.id, { allowSplitStay: false });
      expect(off.lastResult).toBe(WatchResult.FOUND);
      expect(off.bookingLink).toBeDefined();
    });

    it('a split-found row whose option is off reads no split stays', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput({ allowSplitStay: true }));
      await h.watches.execute(watch.id);
      h.db.prepare('UPDATE watches SET allow_split_stay = 0 WHERE id = ?').run(watch.id);
      const read = (await h.watches.get(watch.id))!;
      expect(read.lastResult).toBe(WatchResult.SPLIT_FOUND);
      expect(read.splitStays).toBeUndefined();
    });

    it('a check in flight when the dates change keeps nothing of a split stay and alerts on nothing', async () => {
      const watch = await h.watches.create(h.userId, h.watchInput({ allowSplitStay: true }));
      h.fake.delayMs = 20;
      const running = h.watches.execute(watch.id, { manual: true });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await h.watches.update(watch.id, {
        stay: { arrival: '2026-12-02', departure: '2026-12-04', adults: 2 },
      });

      await expect(running).resolves.toMatchObject({
        success: false,
        error: WATCH_EDITED_DURING_CHECK,
      });
      const stored = h.watchRepo.findById(watch.id)!;
      expect(stored.lastResult).toBeUndefined();
      expect(stored.lastAvailability).toBeUndefined();
      expect(h.notifications.notifyWatchSplitFound).not.toHaveBeenCalled();
    });
  });
});
