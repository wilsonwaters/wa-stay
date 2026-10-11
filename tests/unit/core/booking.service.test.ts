/**
 * BookingService: booking records on any provider (CRUD, validation), `manageUrl` on every
 * booking it returns, `booking:updated` events, and import through the provider's
 * `bookingImport` capability (ParkStay has none).
 */

import { BookingService } from '@main/core/bookings/booking.service';
import { parkstayFactory, parkstayManifest } from '@main/providers/parkstay';
import { ProviderRegistry } from '@main/providers/registry';
import { ProviderCapabilityError, toApiError } from '@main/providers/sdk/errors';
import { createFakeProvider, createTestProviderContext } from '@tests/utils/fake-provider';
import { BookingRepository } from '@main/database/repositories/booking.repository';
import { insertUser, TestDatabaseHelper } from '@tests/utils/database-helper';
import {
  mockBookingInput,
  createMockBookingInput,
  invalidBookingInputs,
} from '@tests/fixtures/bookings';
import { mockUserInput } from '@tests/fixtures/users';
import { BookingStatus } from '@shared/types';
import { expectAsyncThrow } from '@tests/utils/test-helpers';
import { logger } from '@main/utils/logger';

// Fixed calendar dates far from today. BookingRepository.findUpcoming/findPast compare with
// SQLite date('now'), which Jest fake timers cannot pin, so the dates sit decades either
// side of any real "now".
const UPCOMING = { arrival: '2099-06-15', departure: '2099-06-18', adults: 2 };
const PAST = { arrival: '2000-06-15', departure: '2000-06-17', adults: 2 };

describe('BookingService', () => {
  let dbHelper: TestDatabaseHelper;
  let bookingService: BookingService;
  let bookingRepository: BookingRepository;
  let registry: ProviderRegistry;
  let fake: ReturnType<typeof createFakeProvider>;
  let events: { emit: jest.Mock };
  let testUserId: number;

  beforeEach(async () => {
    dbHelper = new TestDatabaseHelper('booking-service');
    await dbHelper.setup();

    bookingRepository = new BookingRepository(dbHelper.getDb());
    registry = new ProviderRegistry();
    registry.register(parkstayFactory, createTestProviderContext(parkstayManifest));
    fake = createFakeProvider({
      bookings: [
        {
          reference: 'FAKE-77',
          externalId: '1',
          locationName: 'Banksia Camp',
          unitName: 'Site u1',
          arrival: '2099-03-01',
          departure: '2099-03-04',
          guests: 3,
          status: 'confirmed',
          totalPrice: 90,
        },
      ],
    });
    registry.register(fake.factory, createTestProviderContext(fake.manifest));
    events = { emit: jest.fn() };
    bookingService = new BookingService({
      bookings: bookingRepository,
      providers: registry,
      events,
    });

    // Create test user
    const user = insertUser(dbHelper.getDb(), mockUserInput.email, {
      firstName: mockUserInput.firstName,
      lastName: mockUserInput.lastName,
    });
    testUserId = user.id;
  });

  afterEach(async () => {
    await dbHelper.teardown();
  });

  describe('createBooking', () => {
    it('should create a new booking', async () => {
      const booking = await bookingService.createBooking(testUserId, mockBookingInput);

      expect(booking).toBeDefined();
      expect(booking.id).toBeDefined();
      expect(booking.userId).toBe(testUserId);
      expect(booking.bookingReference).toBe(mockBookingInput.bookingReference);
      expect(booking.providerId).toBe('parkstay');
      expect(booking.location).toEqual(mockBookingInput.location);
      expect(booking.stay).toEqual({
        ...mockBookingInput.stay,
        children: 0,
        infants: 0,
        concessions: 0,
      });
      expect(booking.unitIds).toEqual(['12']);
      expect(booking.stayParams).toEqual({ siteType: 'Unpowered' });
      expect(booking.status).toBe(BookingStatus.CONFIRMED);
    });

    it('allows the same reference on another provider (unique per provider)', async () => {
      await bookingService.createBooking(testUserId, mockBookingInput);

      const other = await bookingService.createBooking(testUserId, {
        ...mockBookingInput,
        providerId: 'fake',
        location: { name: 'Elsewhere' },
      });

      expect(other.providerId).toBe('fake');
      expect(other.bookingReference).toBe(mockBookingInput.bookingReference);
    });

    it('refuses a duplicate reference with CONFLICT, logged as a warning without a stack', async () => {
      await bookingService.createBooking(testUserId, mockBookingInput);
      const warn = jest.spyOn(logger, 'warn');
      const error = jest.spyOn(logger, 'error');

      await expect(
        bookingService.createBooking(testUserId, mockBookingInput)
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        message: 'This booking is already in your bookings',
      });
      expect(warn).toHaveBeenCalledWith('Booking not created: CONFLICT');
      expect(error).not.toHaveBeenCalled();
      warn.mockRestore();
      error.mockRestore();
    });

    it('should validate booking input', async () => {
      for (const invalidInput of invalidBookingInputs) {
        const { expectedError, ...input } = invalidInput;
        await expectAsyncThrow(
          () => bookingService.createBooking(testUserId, input as any),
          expectedError
        );
      }
    });

    it('should calculate num_nights correctly', async () => {
      const input = createMockBookingInput({
        stay: { arrival: '2024-06-01', departure: '2024-06-04', adults: 2 },
      });

      const booking = await bookingService.createBooking(testUserId, input);
      expect(booking.numNights).toBe(3);
    });

    it('should handle bookings with no cost', async () => {
      const input = createMockBookingInput({
        totalCost: undefined,
      });

      const booking = await bookingService.createBooking(testUserId, input);
      expect(booking.totalCost).toBeUndefined();
    });
  });

  describe('getBooking', () => {
    it('should retrieve booking by ID', async () => {
      const created = await bookingService.createBooking(testUserId, mockBookingInput);
      const retrieved = await bookingService.getBooking(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.bookingReference).toBe(mockBookingInput.bookingReference);
    });

    it('should return null for non-existent booking', async () => {
      const booking = await bookingService.getBooking(999999);
      expect(booking).toBeNull();
    });
  });

  describe('getBookingByReference', () => {
    it('should retrieve booking by reference', async () => {
      await bookingService.createBooking(testUserId, mockBookingInput);
      const retrieved = await bookingService.getBookingByReference(
        'parkstay',
        mockBookingInput.bookingReference
      );

      expect(retrieved).toBeDefined();
      expect(retrieved?.bookingReference).toBe(mockBookingInput.bookingReference);
    });

    it('should return null for non-existent reference', async () => {
      const booking = await bookingService.getBookingByReference('parkstay', 'NONEXISTENT');
      expect(booking).toBeNull();
      expect(
        await bookingService.getBookingByReference('fake', mockBookingInput.bookingReference)
      ).toBeNull();
    });
  });

  describe('listBookings', () => {
    it('should list all bookings for user', async () => {
      const input1 = createMockBookingInput();
      const input2 = createMockBookingInput();
      const input3 = createMockBookingInput();

      await bookingService.createBooking(testUserId, input1);
      await bookingService.createBooking(testUserId, input2);
      await bookingService.createBooking(testUserId, input3);

      const bookings = await bookingService.listBookings(testUserId);
      expect(bookings).toHaveLength(3);
    });

    it('should return empty array if no bookings', async () => {
      const bookings = await bookingService.listBookings(testUserId);
      expect(bookings).toHaveLength(0);
    });

    it('should only return bookings for specific user', async () => {
      // Create another user
      const user2 = insertUser(dbHelper.getDb(), 'user2@test.com');

      await bookingService.createBooking(testUserId, createMockBookingInput());
      await bookingService.createBooking(user2.id, createMockBookingInput());

      const user1Bookings = await bookingService.listBookings(testUserId);
      const user2Bookings = await bookingService.listBookings(user2.id);

      expect(user1Bookings).toHaveLength(1);
      expect(user2Bookings).toHaveLength(1);
    });
  });

  describe('getUpcomingBookings', () => {
    it('should return only upcoming bookings', async () => {
      await bookingService.createBooking(testUserId, createMockBookingInput({ stay: UPCOMING }));

      await bookingService.createBooking(testUserId, createMockBookingInput({ stay: PAST }));

      const upcoming = await bookingService.getUpcomingBookings(testUserId);
      expect(upcoming).toHaveLength(1);
      expect(upcoming[0].stay.arrival).toBe(UPCOMING.arrival);
    });
  });

  describe('getPastBookings', () => {
    it('should return only past bookings', async () => {
      await bookingService.createBooking(testUserId, createMockBookingInput({ stay: UPCOMING }));

      await bookingService.createBooking(testUserId, createMockBookingInput({ stay: PAST }));

      const past = await bookingService.getPastBookings(testUserId);
      expect(past).toHaveLength(1);
      expect(past[0].stay.arrival).toBe(PAST.arrival);
    });
  });

  describe('updateBooking', () => {
    it('should update booking details', async () => {
      const booking = await bookingService.createBooking(testUserId, mockBookingInput);

      const updated = await bookingService.updateBooking(booking.id, {
        unitIds: ['99'],
        notes: 'Updated notes',
      });

      expect(updated.unitIds).toEqual(['99']);
      expect(updated.notes).toBe('Updated notes');
      expect(updated.bookingReference).toBe(mockBookingInput.bookingReference);
    });

    it('should throw error for non-existent booking', async () => {
      await expectAsyncThrow(
        () => bookingService.updateBooking(999999, { notes: 'test' }),
        'not found'
      );
    });

    it('should validate date changes', async () => {
      const booking = await bookingService.createBooking(testUserId, mockBookingInput);

      await expectAsyncThrow(
        () =>
          bookingService.updateBooking(booking.id, {
            stay: { arrival: '2024-06-05', departure: '2024-06-01', adults: 2 },
          }),
        'Departure date must be after arrival date'
      );
    });
  });

  describe('cancelBooking', () => {
    it('should cancel an active booking', async () => {
      const booking = await bookingService.createBooking(testUserId, mockBookingInput);

      const cancelled = await bookingService.cancelBooking(booking.id);

      expect(cancelled.status).toBe(BookingStatus.CANCELLED);
    });

    it('should throw error if already cancelled', async () => {
      const booking = await bookingService.createBooking(testUserId, mockBookingInput);
      await bookingService.cancelBooking(booking.id);

      await expectAsyncThrow(() => bookingService.cancelBooking(booking.id), 'already cancelled');
    });

    it('should throw error for non-existent booking', async () => {
      await expectAsyncThrow(() => bookingService.cancelBooking(999999), 'not found');
    });
  });

  describe('deleteBooking', () => {
    it('should delete booking', async () => {
      const booking = await bookingService.createBooking(testUserId, mockBookingInput);

      await bookingService.deleteBooking(booking.id);

      const retrieved = await bookingService.getBooking(booking.id);
      expect(retrieved).toBeNull();
    });

    it('should throw error for non-existent booking', async () => {
      await expectAsyncThrow(() => bookingService.deleteBooking(999999), 'not found');
    });
  });

  describe('manageUrl', () => {
    it('every booking it returns links to where the provider manages it', async () => {
      const created = await bookingService.createBooking(testUserId, mockBookingInput);
      const onFake = await bookingService.createBooking(
        testUserId,
        createMockBookingInput({ providerId: 'fake', bookingReference: 'FAKE-1' })
      );

      expect(created.manageUrl).toBe('https://parkstay.dbca.wa.gov.au/mybookings/');
      expect(onFake.manageUrl).toBe('https://fake.example/bookings/FAKE-1');
      expect((await bookingService.getBooking(created.id))?.manageUrl).toBe(created.manageUrl);
      const listed = await bookingService.listBookings(testUserId);
      expect(listed.map((b) => b.manageUrl)).toEqual(
        expect.arrayContaining([created.manageUrl, onFake.manageUrl])
      );
    });

    it('falls back to the website when the provider has no bookings page, and to none for an unknown provider', async () => {
      const bare = new ProviderRegistry();
      const plain = createFakeProvider({ id: 'plain' });
      // A provider whose links have no manageBooking
      const factory = Object.assign(
        (ctx: Parameters<typeof plain.factory>[0]) => {
          const provider = plain.factory(ctx);
          return {
            ...provider,
            links: { location: provider.links.location, booking: provider.links.booking },
          };
        },
        { id: plain.factory.id, manifest: plain.factory.manifest }
      );
      bare.register(factory, createTestProviderContext(plain.manifest));
      const service = new BookingService({ bookings: bookingRepository, providers: bare });

      const onPlain = await service.createBooking(
        testUserId,
        createMockBookingInput({ providerId: 'plain', bookingReference: 'P-1' })
      );
      const unknown = await service.createBooking(
        testUserId,
        createMockBookingInput({ providerId: 'gone', bookingReference: 'G-1' })
      );

      expect(onPlain.manageUrl).toBe('https://plain.example');
      expect(unknown.manageUrl).toBeUndefined();
    });
  });

  describe('importBooking', () => {
    it('is a CAPABILITY error on ParkStay, which cannot import bookings', async () => {
      const failure = bookingService.importBooking(testUserId, 'parkstay', 'PB123');

      await expect(failure).rejects.toBeInstanceOf(ProviderCapabilityError);
      expect(toApiError(await failure.catch((e) => e)).code).toBe('CAPABILITY');
      expect(bookingRepository.findAll()).toEqual([]);
    });

    it('imports a booking from the provider, and a second import updates it instead of duplicating', async () => {
      const imported = await bookingService.importBooking(testUserId, 'fake', 'FAKE-77');

      expect(imported).toMatchObject({
        providerId: 'fake',
        bookingReference: 'FAKE-77',
        location: { externalId: '1', name: 'Banksia Camp' },
        stay: { arrival: '2099-03-01', departure: '2099-03-04', adults: 3 },
        totalCost: 90,
        status: BookingStatus.CONFIRMED,
        manageUrl: 'https://fake.example/bookings/FAKE-77',
      });
      expect(imported.syncedAt).toBeInstanceOf(Date);
      expect(fake.calls.filter((c) => c.method === 'get')).toHaveLength(1);

      const again = await bookingService.importBooking(testUserId, 'fake', 'FAKE-77');
      expect(again.id).toBe(imported.id);
      expect(bookingRepository.findAll()).toHaveLength(1);
      expect(events.emit).toHaveBeenCalledWith('booking:updated', again);
    });
  });

  describe('booking:updated', () => {
    it('is emitted after create, update, cancel and delete', async () => {
      const booking = await bookingService.createBooking(testUserId, mockBookingInput);
      await bookingService.updateBooking(booking.id, { notes: 'Bring the kayak' });
      await bookingService.cancelBooking(booking.id);
      await bookingService.deleteBooking(booking.id);

      expect(events.emit.mock.calls.map(([name, payload]) => [name, payload.id])).toEqual([
        ['booking:updated', booking.id],
        ['booking:updated', booking.id],
        ['booking:updated', booking.id],
        ['booking:updated', booking.id],
      ]);
    });
  });
});
