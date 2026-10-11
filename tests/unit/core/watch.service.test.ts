/**
 * WatchService on a registry holding only FakeProviders and a real in-memory database:
 * provider resolution by capability, create validation in the provider's calendar, one
 * availability call per check with matches and partial runs from it, `next_check_at` after
 * every run, expiry with `todayIn`, and errors that never wait in a queue.
 */

import {
  AccessGateError,
  ProviderCapabilityError,
  UnknownProviderError,
} from '@main/providers/sdk';
import { WatchResult } from '@shared/types/common.types';
import { createCoreHarness, fakeDateOnly, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider, FAKE_PRICE } from '@tests/utils/fake-provider';

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
});
