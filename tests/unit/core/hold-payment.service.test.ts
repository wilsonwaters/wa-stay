/**
 * `HoldPaymentService` on a FakeProvider (nothing ParkStay-specific), a real database and
 * in-memory windows:
 * - the window request: the provider's payment page, its payment and sign-in origins and its
 *   waiting room, nothing opened externally; a payment page off those origins is
 *   `PROVIDER_ERROR`;
 * - the provider's queue first (bounded); not getting through still opens the window;
 * - opening settles with the first page: a blocked or failed first page is the error, and the
 *   window is gone; while the queue is passed, the same hold joins and another is refused;
 * - the provider's `bookedReference` decides when a hold is paid, from the URL and the text
 *   the page shows (an error page with the right URL books nothing); a provider without one
 *   never records a booking;
 * - the BOOKED status and the booking are one transaction (a failed booking write leaves the
 *   snipe HELD), and a failed write is tried again when the confirmation loads again; a
 *   deleted snipe records nothing;
 * - the booking names the held unit (the watch's last check, else the place's cached units),
 *   never a provider's unit id; with no name it keeps no unit;
 * - closing the window calls `onWindowClosed` once; after `dispose`, pages and closes do
 *   nothing.
 */

import { BookingService } from '@main/core/bookings/booking.service';
import { HoldPaymentService } from '@main/core/holds/hold-payment.service';
import { BookingRepository, LocationRepository } from '@main/database/repositories';
import type { LocationSummary } from '@shared/types/catalog.types';
import { toApiError } from '@main/providers/sdk/errors';
import { SnipeStatus, WatchResult } from '@shared/types/common.types';
import { createCoreHarness, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider, createMemoryLogger } from '@tests/utils/fake-provider';
import { FakeOpener } from '@tests/utils/fake-provider-windows';

const MINUTE = 60_000;
/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** Waits (a turn at a time) until `ready` holds: the fake queue answers on 0 ms timers. */
async function until(ready: () => boolean): Promise<void> {
  for (let turn = 0; turn < 100 && !ready(); turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(ready()).toBe(true);
}

describe('HoldPaymentService', () => {
  let h: CoreHarness;
  let bookings: BookingService;
  let windows: FakeOpener;
  let notifications: { notifySnipeBooked: jest.Mock; notifyBookingConfirmed: jest.Mock };
  let onWindowClosed: jest.Mock;
  let logger: ReturnType<typeof createMemoryLogger>;
  let service: HoldPaymentService;
  let locations: LocationRepository;

  function setUp(provider = createFakeProvider()): void {
    h = createCoreHarness({ providers: [provider] });
    bookings = new BookingService({
      bookings: new BookingRepository(h.db),
      providers: h.registry,
      events: h.events,
    });
    windows = new FakeOpener();
    notifications = {
      notifySnipeBooked: jest.fn().mockResolvedValue(undefined),
      notifyBookingConfirmed: jest.fn().mockResolvedValue(undefined),
    };
    onWindowClosed = jest.fn();
    logger = createMemoryLogger();
    locations = new LocationRepository(h.db);
    service = new HoldPaymentService({
      providers: h.registry,
      snipes: h.snipeRepo,
      watches: h.watchRepo,
      bookings,
      notifications,
      windows,
      events: h.events,
      transaction: (fn) => h.db.transaction(fn)(),
      onWindowClosed,
      locations,
      logger,
      timings: { accessGateWaitMs: 5_000, firstPageWaitMs: 5_000 },
    });
  }

  afterEach(async () => {
    service.dispose();
    await h.close();
  });

  /** A snipe of the first provider holding u1 as FAKE-1 for 20 more minutes (a seeded row). */
  function heldSnipe(reference = 'FAKE-1') {
    const snipe = h.snipeRepo.create(h.userId, h.snipeInput());
    h.snipeRepo.markHeld(
      snipe.id,
      reference,
      new Date(Date.now() + 20 * MINUTE),
      `https://fake.example/pay/${reference}`,
      'u1'
    );
    return h.snipeRepo.findById(snipe.id)!;
  }

  /** Caches the detail of `fake` location 1 (the harness's place) with these units. */
  function cachePlaceUnits(units: { unitId: string; unitName: string }[]) {
    const place: LocationSummary = {
      key: 'fake:1',
      providerId: 'fake',
      externalId: '1',
      name: 'Banksia Camp',
      kind: 'campground',
      bookingMode: 'online',
      lat: -32,
      lng: 116,
      imageUrls: [],
      amenities: [],
    };
    locations.upsertMany('fake', [place], new Date());
    expect(locations.setDetail('fake', '1', { ...place, units }, new Date())).toBe(true);
  }

  /** The fake provider's confirmation page for `reference`: its URL and its booking number. */
  async function paid(reference: string, text = `Booking BK-${reference} is confirmed`) {
    windows.last.showPage(`https://fake.example/paid/${reference}?receipt=1`, { text });
    await settle();
    await settle();
  }

  const emitted = () => h.events.emit.mock.calls.map(([name]) => name);
  const allBookings = () => new BookingRepository(h.db).findByUserId(h.userId);
  const calls = (module: string) => h.fake.calls.filter((c) => c.module === module);

  describe('opening', () => {
    it("asks for a payment window on the provider's payment page, its payment and sign-in origins, and its waiting room", async () => {
      setUp(
        createFakeProvider({
          auth: { allowedOrigins: ['https://fake.example', 'https://id.example'] },
        })
      );
      await service.openForSnipe(heldSnipe().id);

      expect(windows.requests).toEqual([
        {
          providerId: 'fake',
          providerName: 'Fake',
          kind: 'payment',
          url: 'https://fake.example/pay/FAKE-1',
          allowedOrigins: ['https://fake.example', 'https://id.example'],
          openBlockedExternally: false,
          waitingRoomOrigins: ['https://queue.fake.example'],
        },
      ]);
    });

    it("passes the provider's queue first, bounded, so its cookie is in the session", async () => {
      setUp();
      await service.openForSnipe(heldSnipe().id);

      expect(calls('access')).toEqual([
        expect.objectContaining({ method: 'ensure', args: [{ maxWaitMs: 5_000 }] }),
      ]);
      const ensureAt = h.fake.calls.indexOf(calls('access')[0]);
      expect(ensureAt).toBeGreaterThanOrEqual(0);
      expect(windows.requests).toHaveLength(1);
    });

    it('a queue that does not let it through still opens the window (it shows the waiting room)', async () => {
      setUp(createFakeProvider({ accessStates: ['waiting', 'full'] }));
      await service.openForSnipe(heldSnipe().id);

      expect(windows.requests).toHaveLength(1);
      expect(logger.lines).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          message: expect.stringContaining('opening the payment page anyway'),
        })
      );
    });

    it('a provider without an access gate opens at once', async () => {
      setUp(createFakeProvider({ capabilities: { accessGate: false } }));
      await service.openForSnipe(heldSnipe().id);
      expect(calls('access')).toEqual([]);
      expect(windows.requests[0].waitingRoomOrigins).toBeUndefined();
    });

    it('a first page that is blocked or fails is the error (PROVIDER_ERROR); the window is gone and payment can open again', async () => {
      setUp();
      windows.autoCommit = false;
      const snipe = heldSnipe();
      const opening = service.openForSnipe(snipe.id);
      await until(() => windows.windows.length === 1);

      windows.last.failFirstPage(
        "Fake's page sent the window to https://evil.example, which it does not allow"
      );
      const error = await opening.catch((e: unknown) => e);
      expect(toApiError(error)).toEqual({
        code: 'PROVIDER_ERROR',
        message: "Fake's page sent the window to https://evil.example, which it does not allow",
      });
      expect(onWindowClosed).not.toHaveBeenCalled();

      windows.autoCommit = true;
      await expect(service.openForSnipe(snipe.id)).resolves.toBeUndefined();
      expect(windows.windows).toHaveLength(2);
    });

    it('resolves once the first page commits, or when the person closes the window first', async () => {
      setUp();
      windows.autoCommit = false;
      const snipe = heldSnipe();
      let done = false;
      const opening = service.openForSnipe(snipe.id).then(() => (done = true));
      await until(() => windows.windows.length === 1);
      await settle();
      expect(done).toBe(false);
      windows.last.navigate('https://fake.example/pay/FAKE-1');
      await opening;

      const again = service.openForSnipe(heldSnipe('FAKE-2').id).catch((e: unknown) => e);
      // The first window is still open: another hold must wait
      expect(await again).toMatchObject({ code: 'VALIDATION' });
      windows.last.close();
      const third = service.openForSnipe(heldSnipe('FAKE-3').id);
      await until(() => windows.windows.length === 2);
      windows.last.close();
      await expect(third).resolves.toBeUndefined();
    });

    it('while the queue is passed, the same hold joins the same opening and another hold is refused', async () => {
      setUp();
      const snipe = heldSnipe();
      const other = heldSnipe('FAKE-2');
      const first = service.openForSnipe(snipe.id);
      const second = service.openForSnipe(snipe.id);
      await expect(service.openForSnipe(other.id)).rejects.toMatchObject({ code: 'VALIDATION' });

      await Promise.all([first, second]);
      expect(windows.requests).toHaveLength(1);
      expect(calls('access')).toHaveLength(1);
    });

    it("a payment page off the provider's payment origins is PROVIDER_ERROR, and no window opens", async () => {
      setUp();
      jest
        .spyOn(h.fake.holds!, 'paymentUrl')
        .mockReturnValue('https://elsewhere.example/pay/FAKE-1');
      const error = await service.openForSnipe(heldSnipe().id).catch((e: unknown) => e);

      expect(toApiError(error).code).toBe('PROVIDER_ERROR');
      expect(windows.requests).toEqual([]);
    });
  });

  describe('the confirmation page', () => {
    it("the provider's bookedReference decides: its paid page showing the booking books the snipe as BK-FAKE-1", async () => {
      setUp();
      cachePlaceUnits([{ unitId: 'u1', unitName: 'Site 01' }]);
      const snipe = heldSnipe();
      await service.openForSnipe(snipe.id);
      h.events.emit.mockClear();

      windows.last.showPage('https://fake.example/pay/FAKE-1/step-2', { text: 'BK-FAKE-1' });
      await settle();
      expect(h.snipeRepo.findById(snipe.id)?.status).toBe(SnipeStatus.HELD);

      await paid('FAKE-1');
      expect(h.snipeRepo.findById(snipe.id)).toMatchObject({
        status: SnipeStatus.BOOKED,
        bookedReference: 'BK-FAKE-1',
      });
      expect(allBookings()).toEqual([
        expect.objectContaining({
          providerId: 'fake',
          bookingReference: 'BK-FAKE-1',
          // The unit's name from the place's cached units, not the provider's id `u1`
          unitIds: ['Site 01'],
        }),
      ]);
      expect(emitted()).toEqual(['snipe:updated', 'booking:updated']);
      expect(notifications.notifySnipeBooked).toHaveBeenCalledWith(
        expect.objectContaining({ id: snipe.id, bookedReference: 'BK-FAKE-1' })
      );
    });

    it('the right URL showing an error page (not the booking) records nothing; an error status is not read', async () => {
      setUp();
      const snipe = heldSnipe();
      await service.openForSnipe(snipe.id);

      await paid('FAKE-1', 'Your booking session has expired.');
      windows.last.showPage('https://fake.example/paid/FAKE-1', { text: 'BK-FAKE-1', status: 500 });
      await settle();

      expect(h.snipeRepo.findById(snipe.id)?.status).toBe(SnipeStatus.HELD);
      expect(allBookings()).toEqual([]);
    });

    it('a provider without bookedReference never records a booking', async () => {
      setUp();
      delete (h.fake.holds as { bookedReference?: unknown }).bookedReference;
      const snipe = heldSnipe();
      await service.openForSnipe(snipe.id);

      await paid('FAKE-1');
      expect(h.snipeRepo.findById(snipe.id)?.status).toBe(SnipeStatus.HELD);
      expect(allBookings()).toEqual([]);
    });

    it('a failed booking write rolls the BOOKED status back (one transaction), and the next confirmation page writes it', async () => {
      setUp();
      const snipe = heldSnipe();
      await service.openForSnipe(snipe.id);
      const write = jest.spyOn(bookings, 'recordConfirmed').mockImplementationOnce(() => {
        throw new Error('disk full');
      });

      await paid('FAKE-1');
      expect(h.snipeRepo.findById(snipe.id)?.status).toBe(SnipeStatus.HELD);
      expect(allBookings()).toEqual([]);
      expect(logger.lines).toContainEqual(
        expect.objectContaining({
          level: 'error',
          message: 'Payment for snipe 1 completed (BK-FAKE-1) but was not recorded',
        })
      );

      // The person reloads ParkStay's confirmation page: written this time
      await paid('FAKE-1');
      expect(write).toHaveBeenCalledTimes(2);
      expect(h.snipeRepo.findById(snipe.id)?.status).toBe(SnipeStatus.BOOKED);
      expect(allBookings()).toHaveLength(1);

      // Once written, more pages change nothing
      await paid('FAKE-1');
      expect(write).toHaveBeenCalledTimes(2);
    });

    it('a snipe deleted while paying records nothing', async () => {
      setUp();
      const snipe = heldSnipe();
      await service.openForSnipe(snipe.id);
      h.snipeRepo.deleteById(snipe.id);

      await paid('FAKE-1');
      expect(allBookings()).toEqual([]);
      expect(logger.lines).toContainEqual(
        expect.objectContaining({ level: 'warn', message: expect.stringContaining('deleted') })
      );
    });

    it('a watch hold on the fake provider books the watch', async () => {
      setUp();
      const watch = h.watchRepo.create(h.userId, h.watchInput({ autoHold: true }));
      h.watchRepo.recordRun(watch.id, {
        result: WatchResult.FOUND,
        found: true,
        checkedAt: new Date(),
        nextCheckAt: new Date(Date.now() + 60 * MINUTE),
        availability: [{ unitId: 'u2', unitName: 'Cabin 2', nights: [], fullyAvailable: true }],
      });
      h.watchRepo.markHeld(watch.id, {
        reference: 'FAKE-7',
        expiresAt: new Date(Date.now() + 20 * MINUTE),
        unitId: 'u2',
      });
      await service.openForWatch(watch.id);
      expect(windows.last.url).toBe('https://fake.example/pay/FAKE-7');

      await paid('FAKE-7');
      expect(h.watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.BOOKED);
      const [booking] = allBookings();
      // Named from the watch's last check
      expect(booking).toMatchObject({ bookingReference: 'BK-FAKE-7', unitIds: ['Cabin 2'] });
      expect(notifications.notifyBookingConfirmed).toHaveBeenCalledWith(
        expect.objectContaining({
          id: booking.id,
          userId: h.userId,
          providerId: 'fake',
          bookingReference: 'BK-FAKE-7',
          location: booking.location,
        })
      );
    });
  });

  describe("the booking's unit", () => {
    /** A snipe holding `unitId`, paid for: the booking it recorded. */
    async function paySnipeHolding(unitId: string) {
      const snipe = h.snipeRepo.create(h.userId, h.snipeInput());
      h.snipeRepo.markHeld(
        snipe.id,
        'FAKE-9',
        new Date(Date.now() + 20 * MINUTE),
        'https://fake.example/pay/FAKE-9',
        unitId
      );
      await service.openForSnipe(snipe.id);
      await paid('FAKE-9');
      return allBookings()[0];
    }

    it('a class hold stores the class name from the place’s cached units', async () => {
      setUp();
      cachePlaceUnits([{ unitId: 'class:117', unitName: 'One site - select on arrival' }]);
      expect((await paySnipeHolding('class:117')).unitIds).toEqual([
        'One site - select on arrival',
      ]);
    });

    it('a site hold stores the site name, never the provider’s global id', async () => {
      setUp();
      cachePlaceUnits([{ unitId: '2341', unitName: 'CAMPSITE 07' }]);
      expect((await paySnipeHolding('2341')).unitIds).toEqual(['CAMPSITE 07']);
    });

    it('stores no unit when nothing names it', async () => {
      setUp();
      const booking = await paySnipeHolding('2341');
      expect(booking.bookingReference).toBe('BK-FAKE-9');
      expect(booking.unitIds).toEqual([]);
    });
  });

  it('closing the window calls onWindowClosed once; after dispose, pages and closes do nothing', async () => {
    setUp();
    const first = heldSnipe('FAKE-1');
    await service.openForSnipe(first.id);
    windows.last.close();
    expect(onWindowClosed).toHaveBeenCalledTimes(1);
    expect(onWindowClosed).toHaveBeenCalledWith('fake');

    await service.openForSnipe(first.id);
    service.dispose();
    await paid('FAKE-1');
    windows.last.close();

    expect(h.snipeRepo.findById(first.id)?.status).toBe(SnipeStatus.HELD);
    expect(onWindowClosed).toHaveBeenCalledTimes(1);
  });

  it('dispose aborts a queue wait in progress, and no window opens', async () => {
    setUp(createFakeProvider({ delays: { access: 60_000 } }));
    const opening = service.openForSnipe(heldSnipe().id);
    await settle();
    service.dispose();
    await opening;
    expect(windows.requests).toEqual([]);
  });
});
