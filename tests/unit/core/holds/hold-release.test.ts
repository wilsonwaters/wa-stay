/**
 * Letting a hold go (R18, `HoldPaymentService`) on a FakeProvider with `holds.release`, a real
 * database and in-memory windows. Holds are seeded rows (never a live hold, §12.33).
 *
 * - **The close decision:** a payment window that closes with no confirmation calls `release`
 *   once, for a provider with `releaseOnPaymentClose`; not after a recorded confirmation (nor
 *   when one is being read as it closes), not for a first page that failed, not on quit, not
 *   for a provider without `releaseOnPaymentClose`, not for a hold that expired meanwhile.
 * - **Recording:** `released` and `gone` each end the hold now with their message (a snipe
 *   EXPIRED, a watch still held with its hold expired), then `snipe:updated`/`watch:updated`,
 *   never a notification; the night guard then frees the nights. A row booked meanwhile is left.
 * - **Failure:** a rejection, an answer that is neither outcome, or a hang past the deadline
 *   changes nothing and answers `PROVIDER_ERROR`; the log names the code, never the reference.
 * - **One at a time:** two declines make one call; a decline while the payment window is open
 *   closes it first, then one release; `releasing(providerId)` while it runs; quit aborts it.
 * - **Delete:** `releaseBeforeDelete` lets an unexpired hold go first, never rejects.
 * - **Interactive pace:** `holds.create` and `holds.release` run at `interactive` inside a
 *   background poll on a paced provider; the poll's check stays `background`.
 */

import { BookingService } from '@main/core/bookings/booking.service';
import {
  HoldPaymentService,
  RELEASED_MESSAGE,
  RELEASED_ON_CLOSE_MESSAGE,
  holdGoneMessage,
  releaseFailedMessage,
} from '@main/core/holds/hold-payment.service';
import { NightGuard } from '@main/core/holds/night-guard';
import { BookingRepository } from '@main/database/repositories';
import { ProviderHttpError, toApiError } from '@main/providers/sdk/errors';
import { withRequestPriority } from '@main/providers/sdk/pacing';
import { SnipeResult, SnipeStatus, WatchResult } from '@shared/types/common.types';
import { createCoreHarness, type CoreHarness } from '@tests/utils/core-harness';
import {
  createFakeProvider,
  createMemoryLogger,
  type FakeProviderOptions,
} from '@tests/utils/fake-provider';
import { FakeOpener } from '@tests/utils/fake-provider-windows';

const MINUTE = 60_000;
const GONE = holdGoneMessage('Fake');
/** Lets pending promise callbacks and the fake's 0 ms timers run, a few turns over. */
async function drain(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

async function until(ready: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !ready(); turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(ready()).toBe(true);
}

describe('HoldPaymentService: letting a hold go', () => {
  let h: CoreHarness;
  let windows: FakeOpener;
  let notifications: { notifySnipeBooked: jest.Mock; notifyBookingConfirmed: jest.Mock };
  let logger: ReturnType<typeof createMemoryLogger>;
  let service: HoldPaymentService;
  /** The service's clock: the instant a release records as the hold's end. */
  let now: number;

  function setUp(
    options: FakeProviderOptions = { holdRelease: { onPaymentClose: true } },
    releaseTimeoutMs?: number
  ): void {
    h = createCoreHarness({ providers: [createFakeProvider(options)] });
    windows = new FakeOpener();
    notifications = {
      notifySnipeBooked: jest.fn().mockResolvedValue(undefined),
      notifyBookingConfirmed: jest.fn().mockResolvedValue(undefined),
    };
    logger = createMemoryLogger();
    now = Date.now();
    service = new HoldPaymentService({
      providers: h.registry,
      snipes: h.snipeRepo,
      watches: h.watchRepo,
      bookings: new BookingService({
        bookings: new BookingRepository(h.db),
        providers: h.registry,
        events: h.events,
      }),
      notifications,
      windows,
      events: h.events,
      transaction: (fn) => h.db.transaction(fn)(),
      logger,
      clock: () => new Date(now),
      timings: {
        accessGateWaitMs: 5_000,
        firstPageWaitMs: 5_000,
        ...(releaseTimeoutMs ? { releaseTimeoutMs } : {}),
      },
    });
  }

  afterEach(async () => {
    service.dispose();
    await h.close();
  });

  /** A snipe holding u1 as `reference` until `minutes` from now (a seeded row). */
  function heldSnipe(reference = 'FAKE-1', minutes = 20) {
    const snipe = h.snipeRepo.create(h.userId, h.snipeInput());
    h.snipeRepo.markHeld(
      snipe.id,
      reference,
      new Date(now + minutes * MINUTE),
      `https://fake.example/pay/${reference}`,
      'u1'
    );
    return h.snipeRepo.findById(snipe.id)!;
  }

  /** A watch whose auto-hold holds u2 as `reference` for 20 more minutes (a seeded row). */
  function heldWatch(reference = 'FAKE-7') {
    const watch = h.watchRepo.create(h.userId, h.watchInput({ autoHold: true }));
    h.watchRepo.markHeld(watch.id, {
      reference,
      expiresAt: new Date(now + 20 * MINUTE),
      unitId: 'u2',
      paymentUrl: `https://fake.example/pay/${reference}`,
    });
    return h.watchRepo.findById(watch.id)!;
  }

  const releases = () => h.fake.calls.filter((c) => c.module === 'holds' && c.method === 'release');
  const emitted = () => h.events.emit.mock.calls.map(([name]) => name);
  const warnings = () => logger.lines.filter((line) => line.level === 'warn');
  /** Waits for the release a close started, and for it to be recorded. */
  async function closeAndSettle(): Promise<void> {
    windows.last.close();
    await drain();
  }

  describe('when the payment window closes', () => {
    it('with no confirmation: release is called once with the hold, and the snipe ends EXPIRED now, "Let go when the payment window closed."', async () => {
      setUp();
      const snipe = heldSnipe();
      await service.openForSnipe(snipe.id);
      h.events.emit.mockClear();

      await closeAndSettle();

      expect(releases()).toEqual([
        expect.objectContaining({
          args: [{ reference: 'FAKE-1', unitId: 'u1', expiresAt: snipe.holdExpiresAt }],
          priority: 'interactive',
        }),
      ]);
      expect(h.snipeRepo.findById(snipe.id)).toMatchObject({
        status: SnipeStatus.EXPIRED,
        lastResult: SnipeResult.EXPIRED,
        isActive: false,
        lastError: RELEASED_ON_CLOSE_MESSAGE,
        holdReference: 'FAKE-1',
        holdExpiresAt: new Date(now),
      });
      expect(emitted()).toEqual(['snipe:updated']);
      // The person did it: no notification
      expect(notifications.notifySnipeBooked).not.toHaveBeenCalled();
      expect(h.notifications.notifyWarning).not.toHaveBeenCalled();
    });

    it('a watch hold: released on close, the watch keeps "held" with its hold ended now', async () => {
      setUp();
      const watch = heldWatch();
      await service.openForWatch(watch.id);
      h.events.emit.mockClear();

      await closeAndSettle();

      expect(releases()).toHaveLength(1);
      expect(h.watchRepo.findById(watch.id)).toMatchObject({
        lastResult: WatchResult.HELD,
        isActive: false,
        lastError: RELEASED_ON_CLOSE_MESSAGE,
        hold: { reference: 'FAKE-7', expiresAt: new Date(now), unitId: 'u2' },
      });
      expect(emitted()).toEqual(['watch:updated']);
    });

    it('after a recorded confirmation: no release (the hold is booked)', async () => {
      setUp();
      const snipe = heldSnipe();
      await service.openForSnipe(snipe.id);
      windows.last.showPage('https://fake.example/paid/FAKE-1', { text: 'BK-FAKE-1' });
      await drain();
      expect(h.snipeRepo.findById(snipe.id)?.status).toBe(SnipeStatus.BOOKED);

      await closeAndSettle();

      expect(releases()).toEqual([]);
      expect(h.snipeRepo.findById(snipe.id)).toMatchObject({
        status: SnipeStatus.BOOKED,
        bookedReference: 'BK-FAKE-1',
      });
    });

    it('a confirmation being read as the window closes wins: booked, and no release', async () => {
      setUp();
      const snipe = heldSnipe();
      await service.openForSnipe(snipe.id);
      const window = windows.last;
      // The window closes while the provider reads the confirmation page
      window.hasText = (text) => {
        const shows = window.pageText.includes(text);
        window.close();
        return Promise.resolve(shows);
      };

      window.showPage('https://fake.example/paid/FAKE-1', { text: 'BK-FAKE-1' });
      await drain();

      expect(window.closed).toBe(true);
      expect(h.snipeRepo.findById(snipe.id)?.status).toBe(SnipeStatus.BOOKED);
      expect(releases()).toEqual([]);
    });

    it('a first page that failed (the window closed itself): no release, the hold stays', async () => {
      setUp();
      windows.autoCommit = false;
      const snipe = heldSnipe();
      const opening = service.openForSnipe(snipe.id).catch((e: unknown) => e);
      await until(() => windows.windows.length === 1);

      windows.last.failFirstPage("Fake's page could not be loaded");
      expect(toApiError(await opening).code).toBe('PROVIDER_ERROR');
      await drain();

      expect(releases()).toEqual([]);
      expect(h.snipeRepo.findById(snipe.id)).toEqual(snipe);
    });

    it('on quit (dispose): no release, the hold lapses on its own', async () => {
      setUp();
      const snipe = heldSnipe();
      await service.openForSnipe(snipe.id);

      service.dispose();
      await closeAndSettle();

      expect(releases()).toEqual([]);
      expect(h.snipeRepo.findById(snipe.id)).toEqual(snipe);
    });

    it('a provider with release but not releaseOnPaymentClose: no release, and the hold stays payable', async () => {
      setUp({ holdRelease: {} });
      const snipe = heldSnipe();
      await service.openForSnipe(snipe.id);

      await closeAndSettle();

      expect(releases()).toEqual([]);
      expect(h.snipeRepo.findById(snipe.id)).toEqual(snipe);
      await expect(service.openForSnipe(snipe.id)).resolves.toBeUndefined();
    });

    it('a hold that expired while the window was open: no release, and the existing expired state', async () => {
      setUp();
      const snipe = heldSnipe('FAKE-1', 1);
      await service.openForSnipe(snipe.id);

      now += 2 * MINUTE;
      await closeAndSettle();

      expect(releases()).toEqual([]);
      expect(h.snipeRepo.findById(snipe.id)).toEqual(snipe);
    });
  });

  describe('declining ("Let it go")', () => {
    it('released: the snipe ends EXPIRED now with "You let it go.", then snipe:updated, no notification', async () => {
      setUp({ holdRelease: {} });
      const snipe = heldSnipe();

      const answer = await service.releaseSnipeHold(snipe.id);

      expect(releases()).toEqual([
        expect.objectContaining({
          args: [{ reference: 'FAKE-1', unitId: 'u1', expiresAt: snipe.holdExpiresAt }],
          priority: 'interactive',
        }),
      ]);
      expect(answer).toMatchObject({
        status: SnipeStatus.EXPIRED,
        lastResult: SnipeResult.EXPIRED,
        lastError: RELEASED_MESSAGE,
        holdExpiresAt: new Date(now),
      });
      expect(h.snipeRepo.findById(snipe.id)).toEqual(answer);
      expect(emitted()).toEqual(['snipe:updated']);
      expect(h.events.emit).toHaveBeenCalledWith('snipe:updated', answer);
      expect(notifications.notifySnipeBooked).not.toHaveBeenCalled();
    });

    it('gone: the watch\'s hold ends now and it points to the provider\'s confirmation, never "booked"', async () => {
      setUp({ holdRelease: {} });
      h.fake.scriptRelease('gone');
      const watch = heldWatch();

      const answer = await service.releaseWatchHold(watch.id);

      expect(answer).toMatchObject({
        lastResult: WatchResult.HELD,
        lastError: GONE,
        hold: { reference: 'FAKE-7', expiresAt: new Date(now) },
      });
      expect(GONE).toBe(
        "Fake no longer holds it. If you paid, look for Fake's confirmation email."
      );
      expect(emitted()).toEqual(['watch:updated']);
      expect(new BookingRepository(h.db).findByUserId(h.userId)).toEqual([]);
    });

    it('gone for a snipe: EXPIRED with the same message', async () => {
      setUp({ holdRelease: {} });
      h.fake.scriptRelease('gone');
      const snipe = heldSnipe();
      await expect(service.releaseSnipeHold(snipe.id)).resolves.toMatchObject({
        status: SnipeStatus.EXPIRED,
        lastError: GONE,
      });
    });

    it('an estimated expiry is let go as it is, and the ended hold is exact', async () => {
      setUp({ holdRelease: {} });
      const snipe = h.snipeRepo.create(h.userId, h.snipeInput());
      h.snipeRepo.markHeld(snipe.id, 'FAKE-3', new Date(now + 10 * MINUTE), undefined, 'u1', true);
      expect(h.snipeRepo.findById(snipe.id)?.holdExpiresEstimated).toBe(true);

      const answer = await service.releaseSnipeHold(snipe.id);
      expect(answer.holdExpiresEstimated).toBeUndefined();
    });

    it('a rejection changes nothing: PROVIDER_ERROR, the hold stays payable, logged by its code without the reference', async () => {
      setUp({ holdRelease: {} });
      const snipe = heldSnipe('SECRET-REF-1');
      h.fake.failNext(
        'holds',
        new ProviderHttpError({
          providerId: 'fake',
          status: 429,
          url: 'https://fake.example/cart?token=SECRET-REF-1',
        })
      );

      const error = await service.releaseSnipeHold(snipe.id).catch((e: unknown) => e);

      expect(toApiError(error)).toEqual({
        code: 'PROVIDER_ERROR',
        message: releaseFailedMessage('Fake'),
      });
      expect(releaseFailedMessage('Fake')).toBe(
        "Fake couldn't be asked to let the hold go, so it stays until it runs out. You can still pay for it."
      );
      expect(h.snipeRepo.findById(snipe.id)).toEqual(snipe);
      expect(emitted()).toEqual([]);
      expect(warnings()).toEqual([
        expect.objectContaining({
          message:
            'snipe 1: Fake could not let its hold go (RATE_LIMITED HTTP 429, decline); it stays until it runs out',
        }),
      ]);
      expect(JSON.stringify(logger.lines)).not.toContain('SECRET-REF-1');
      await expect(service.openForSnipe(snipe.id)).resolves.toBeUndefined();
      // Nothing retried it
      expect(releases()).toHaveLength(1);
    });

    it('an answer that is neither released nor gone changes nothing (PROVIDER_ERROR)', async () => {
      setUp({ holdRelease: {} });
      const watch = heldWatch();
      jest
        .spyOn(h.fake.holds!, 'release')
        .mockResolvedValue({ outcome: 'paid' } as unknown as { outcome: 'gone' });

      const error = await service.releaseWatchHold(watch.id).catch((e: unknown) => e);

      expect(toApiError(error).code).toBe('PROVIDER_ERROR');
      expect(h.watchRepo.findById(watch.id)).toEqual(watch);
    });

    it('a release that hangs is aborted at its deadline: PROVIDER_ERROR, and the hold stays', async () => {
      setUp({ holdRelease: {}, delays: { holds: 60_000 } }, 50);
      const snipe = heldSnipe();

      const error = await service.releaseSnipeHold(snipe.id).catch((e: unknown) => e);

      expect(toApiError(error).code).toBe('PROVIDER_ERROR');
      expect(releases()[0].signal?.aborted).toBe(true);
      expect(h.snipeRepo.findById(snipe.id)).toEqual(snipe);
      expect(warnings()[0].message).toContain('(PROVIDER_ERROR, decline)');
    });

    it('two declines at once make one call, and both answer the ended hold', async () => {
      setUp({ holdRelease: {}, delays: { holds: 20 } });
      const snipe = heldSnipe();

      const [first, second] = await Promise.all([
        service.releaseSnipeHold(snipe.id),
        service.releaseSnipeHold(snipe.id),
      ]);

      expect(releases()).toHaveLength(1);
      expect(first).toEqual(second);
      expect(first.status).toBe(SnipeStatus.EXPIRED);
      // Once it ended, there is nothing left to let go
      await expect(service.releaseSnipeHold(snipe.id)).rejects.toMatchObject({
        code: 'HOLD_EXPIRED',
      });
      expect(releases()).toHaveLength(1);
    });

    it('a decline while the payment window is open closes it first, then one release ("You let it go.")', async () => {
      setUp();
      const snipe = heldSnipe();
      await service.openForSnipe(snipe.id);
      const window = windows.last;

      const answer = await service.releaseSnipeHold(snipe.id);
      await drain();

      expect(window.closed).toBe(true);
      expect(releases()).toHaveLength(1);
      expect(answer.lastError).toBe(RELEASED_MESSAGE);
    });

    it('a decline while a close is letting the hold go joins it: one call', async () => {
      setUp({ holdRelease: { onPaymentClose: true }, delays: { holds: 20 } });
      const watch = heldWatch();
      await service.openForWatch(watch.id);
      windows.last.close();
      await until(() => releases().length === 1);

      const answer = await service.releaseWatchHold(watch.id);

      expect(releases()).toHaveLength(1);
      expect(answer.lastError).toBe(RELEASED_ON_CLOSE_MESSAGE);
    });

    it('afterwards the night guard lets another hold take the same nights', async () => {
      setUp({ holdRelease: {} });
      const snipe = heldSnipe();
      const guard = new NightGuard(h.snipeRepo, h.watchRepo);
      const request = {
        providerId: 'fake',
        userId: h.userId,
        arrival: snipe.stay.arrival,
        departure: snipe.stay.departure,
        owner: { kind: 'watch' as const, id: 999 },
      };
      expect(guard.tryReserve(request)).toMatchObject({ ok: false, transient: false });

      await service.releaseSnipeHold(snipe.id);

      const reserved = guard.tryReserve(request);
      expect(reserved.ok).toBe(true);
    });

    it('a row booked while the provider was asked is left alone', async () => {
      setUp({ holdRelease: {}, delays: { holds: 20 } });
      const watch = heldWatch();
      const declining = service.releaseWatchHold(watch.id);
      await until(() => releases().length === 1);
      h.watchRepo.setBooked(watch.id);

      await expect(declining).resolves.toMatchObject({ lastResult: WatchResult.BOOKED });
      expect(h.watchRepo.findById(watch.id)?.lastError).toBeUndefined();
      expect(emitted()).toEqual([]);
    });

    it('releasing(providerId) while a release runs; quit aborts it and records nothing', async () => {
      setUp({ holdRelease: {}, delays: { holds: 60_000 } });
      const snipe = heldSnipe();
      const declining = service.releaseSnipeHold(snipe.id).catch((e: unknown) => e);
      await until(() => releases().length === 1);
      expect(service.releasing('fake')).toBe(true);
      expect(service.releasing('other')).toBe(false);

      service.dispose();
      expect(toApiError(await declining).code).toBe('PROVIDER_ERROR');

      expect(service.releasing('fake')).toBe(false);
      expect(h.snipeRepo.findById(snipe.id)).toEqual(snipe);
      expect(warnings()).toEqual([]);
    });

    it('NOT_FOUND for no row; CAPABILITY without release (as ParkStay); HOLD_EXPIRED with nothing unexpired', async () => {
      setUp({ holdRelease: {} });
      await expect(service.releaseSnipeHold(404)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(service.releaseWatchHold(404)).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const lapsed = heldSnipe('FAKE-2', -1);
      await expect(service.releaseSnipeHold(lapsed.id)).rejects.toMatchObject({
        code: 'HOLD_EXPIRED',
      });
      const unheld = h.watchRepo.create(h.userId, h.watchInput());
      await expect(service.releaseWatchHold(unheld.id)).rejects.toMatchObject({
        code: 'HOLD_EXPIRED',
      });
      expect(releases()).toEqual([]);
      await h.close();

      setUp({});
      const held = heldSnipe();
      const error = await service.releaseSnipeHold(held.id).catch((e: unknown) => e);
      expect(toApiError(error)).toEqual({
        code: 'CAPABILITY',
        message: 'fake does not support holdRelease',
      });
      expect(h.snipeRepo.findById(held.id)).toEqual(held);
    });
  });

  describe('before a delete', () => {
    it("lets an unexpired hold go first (closing its payment window); the row's end is recorded", async () => {
      setUp();
      const snipe = heldSnipe();
      await service.openForSnipe(snipe.id);

      await service.releaseBeforeDelete('snipe', snipe.id);
      await drain();

      expect(windows.last.closed).toBe(true);
      expect(releases()).toHaveLength(1);
      expect(h.snipeRepo.findById(snipe.id)?.lastError).toBe(RELEASED_MESSAGE);
    });

    it('asks nothing for an expired hold, an unheld row, a missing row, or a provider without release', async () => {
      setUp({ holdRelease: {} });
      await service.releaseBeforeDelete('snipe', heldSnipe('FAKE-2', -1).id);
      await service.releaseBeforeDelete('watch', h.watchRepo.create(h.userId, h.watchInput()).id);
      await service.releaseBeforeDelete('watch', 404);
      expect(releases()).toEqual([]);
      await h.close();

      setUp({});
      await service.releaseBeforeDelete('watch', heldWatch().id);
      expect(h.fake.calls.filter((c) => c.module === 'holds')).toEqual([]);
    });

    it('a rejection never rejects: logged, and the hold is left as it was', async () => {
      setUp({ holdRelease: {} });
      const watch = heldWatch();
      h.fake.failNext('holds', new Error('offline'));

      await expect(service.releaseBeforeDelete('watch', watch.id)).resolves.toBeUndefined();

      expect(h.watchRepo.findById(watch.id)).toEqual(watch);
      expect(warnings()).toEqual([
        expect.objectContaining({
          message:
            'watch 1: Fake could not let its hold go (INTERNAL, delete); it stays until it runs out',
        }),
      ]);
    });
  });
});

describe('interactive pace for holds (R18)', () => {
  let h: CoreHarness;

  afterEach(async () => {
    await h.close();
  });

  /** A provider paced as R2 paces one: one request at a time, 10 s apart in the background. */
  function setUp(): void {
    h = createCoreHarness({
      providers: [
        createFakeProvider({
          holdRelease: {},
          availability: { '1': { u1: 'available' } },
          limits: { maxConcurrentRequests: 1, minRequestIntervalMs: 10_000 },
        }),
      ],
    });
  }

  const priorities = (module: string, method: string) =>
    h.fake.calls.filter((c) => c.module === module && c.method === method).map((c) => c.priority);

  it("a snipe's poll checks at background, and its hold is placed at interactive", async () => {
    setUp();
    const snipe = await h.snipes.create(h.userId, h.snipeInput({ action: 'hold' }));
    h.snipeRepo.updateStatus(snipe.id, SnipeStatus.SNIPING);

    const outcome = await withRequestPriority('background', () => h.snipes.execute(snipe.id));

    expect(outcome.result.held).toBe(true);
    expect(priorities('availability', 'check')).toEqual(['background']);
    expect(priorities('holds', 'create')).toEqual(['interactive']);
  });

  it("a watch's background check stays background, and its automatic hold is interactive", async () => {
    setUp();
    const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));

    const result = await withRequestPriority('background', () => h.watches.execute(watch.id));

    expect(result.hold).toBeDefined();
    expect(priorities('availability', 'check')).toEqual(['background']);
    expect(priorities('holds', 'create')).toEqual(['interactive']);
  });

  it('a release asked from a background scope is interactive', async () => {
    setUp();
    const service = new HoldPaymentService({
      providers: h.registry,
      snipes: h.snipeRepo,
      watches: h.watchRepo,
      bookings: { recordConfirmed: jest.fn(), announce: jest.fn() },
      notifications: { notifySnipeBooked: jest.fn(), notifyBookingConfirmed: jest.fn() },
      windows: new FakeOpener(),
      events: h.events,
      transaction: (fn) => h.db.transaction(fn)(),
      logger: createMemoryLogger(),
    });
    const snipe = h.snipeRepo.create(h.userId, h.snipeInput());
    h.snipeRepo.markHeld(snipe.id, 'FAKE-1', new Date(Date.now() + 20 * MINUTE), undefined, 'u1');

    await withRequestPriority('background', () => service.releaseSnipeHold(snipe.id));

    expect(priorities('holds', 'release')).toEqual(['interactive']);
    service.dispose();
  });
});

describe('an estimated expiry, as a hold is placed (R18)', () => {
  let h: CoreHarness;

  beforeEach(() => {
    h = createCoreHarness({
      providers: [createFakeProvider({ availability: { '1': { u1: 'available' } } })],
    });
  });

  afterEach(async () => {
    await h.close();
  });

  const estimated = (reference: string) => ({
    ok: true as const,
    reference,
    expiresAt: new Date(Date.now() + 10 * MINUTE),
    expiresAtEstimated: true,
    unitId: 'u1',
  });

  it("a watch's automatic hold stores it, and its alert gets it", async () => {
    h.fake.scriptHold(estimated('FAKE-E1'));
    const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));

    const result = await h.watches.execute(watch.id);

    expect(result.hold).toMatchObject({ reference: 'FAKE-E1', expiresEstimated: true });
    expect(h.watchRepo.findById(watch.id)?.hold).toMatchObject({
      reference: 'FAKE-E1',
      expiresEstimated: true,
    });
    expect(h.notifications.notifyWatchHeld).toHaveBeenCalledWith(
      expect.objectContaining({ id: watch.id }),
      expect.objectContaining({ expiresEstimated: true }),
      expect.anything(),
      expect.anything()
    );
  });

  it("a snipe's hold stores it, and its alert gets it; an exact one stores none", async () => {
    h.fake.scriptHold(estimated('FAKE-E2'));
    const snipe = await h.snipes.create(h.userId, h.snipeInput({ action: 'hold' }));
    h.snipeRepo.updateStatus(snipe.id, SnipeStatus.SNIPING);

    await h.snipes.execute(snipe.id);

    expect(h.snipeRepo.findById(snipe.id)).toMatchObject({
      status: SnipeStatus.HELD,
      holdReference: 'FAKE-E2',
      holdExpiresEstimated: true,
    });
    expect(h.notifications.notifySnipeHeld).toHaveBeenCalledWith(
      expect.objectContaining({ holdExpiresEstimated: true }),
      undefined,
      expect.anything()
    );

    const exact = await h.snipes.create(h.userId, h.snipeInput({ action: 'hold' }));
    h.snipeRepo.updateStatus(exact.id, SnipeStatus.SNIPING);
    // The first hold is over, so its nights are free for the second
    h.snipeRepo.finish(snipe.id, SnipeStatus.EXPIRED, SnipeResult.EXPIRED);
    await h.snipes.execute(exact.id);
    expect(h.snipeRepo.findById(exact.id)?.status).toBe(SnipeStatus.HELD);
    expect(h.snipeRepo.findById(exact.id)).not.toHaveProperty('holdExpiresEstimated');
  });
});
