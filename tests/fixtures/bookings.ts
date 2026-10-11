/**
 * Booking Test Fixtures
 */

import { Booking, BookingInput, BookingStatus } from '@shared/types';
import { randomBookingReference } from '@tests/utils/test-helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date `days` days from now (UTC), for upcoming and past bookings. */
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

export const mockBookingInput: BookingInput = {
  providerId: 'parkstay',
  bookingReference: 'BK123456',
  location: { name: 'Dales Campground', areaName: 'Karijini National Park' },
  stay: { arrival: '2024-06-15', departure: '2024-06-18', adults: 2 },
  unitIds: ['12'],
  stayParams: { siteType: 'Unpowered' },
  totalCost: 105.0,
  notes: 'Test booking',
};

export const mockBooking: Booking = {
  id: 1,
  userId: 1,
  providerId: 'parkstay',
  location: { name: 'Dales Campground', areaName: 'Karijini National Park' },
  bookingReference: 'BK123456',
  stay: {
    arrival: '2024-06-15',
    departure: '2024-06-18',
    adults: 2,
    children: 0,
    infants: 0,
    concessions: 0,
  },
  unitIds: ['12'],
  stayParams: { siteType: 'Unpowered' },
  numNights: 3,
  totalCost: 105.0,
  currency: 'AUD',
  status: BookingStatus.CONFIRMED,
  notes: 'Test booking',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

export const mockUpcomingBooking: Booking = {
  ...mockBooking,
  id: 2,
  bookingReference: 'BK234567',
  stay: { ...mockBooking.stay, arrival: daysFromNow(7), departure: daysFromNow(10) },
};

export const mockPastBooking: Booking = {
  ...mockBooking,
  id: 3,
  bookingReference: 'BK345678',
  stay: { ...mockBooking.stay, arrival: daysFromNow(-10), departure: daysFromNow(-7) },
};

export const mockCancelledBooking: Booking = {
  ...mockBooking,
  id: 4,
  bookingReference: 'BK456789',
  status: BookingStatus.CANCELLED,
};

export const invalidBookingInputs = [
  {
    ...mockBookingInput,
    bookingReference: '',
    expectedError: 'Booking reference is required',
  },
  {
    ...mockBookingInput,
    location: { ...mockBookingInput.location, name: '' },
    expectedError: 'Campground name is required',
  },
  {
    ...mockBookingInput,
    stay: { arrival: '2024-06-18', departure: '2024-06-15', adults: 2 },
    expectedError: 'Departure date must be after arrival date',
  },
  {
    ...mockBookingInput,
    stay: { arrival: '2024-06-15', departure: '2024-06-18', adults: 0 },
    expectedError: 'Number of guests must be at least 1',
  },
  {
    ...mockBookingInput,
    stay: { arrival: '2024-06-15', departure: '2024-06-18', adults: 100 },
    expectedError: 'Number of guests cannot exceed 50',
  },
  {
    ...mockBookingInput,
    totalCost: -10,
    expectedError: 'Total cost cannot be negative',
  },
];

export function createMockBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    ...mockBooking,
    ...overrides,
  };
}

export function createMockBookingInput(overrides: Partial<BookingInput> = {}): BookingInput {
  return {
    ...mockBookingInput,
    bookingReference: overrides.bookingReference || randomBookingReference(),
    ...overrides,
  };
}

export function createMultipleMockBookings(count: number, userId: number = 1): Booking[] {
  return Array.from({ length: count }, (_, i) =>
    createMockBooking({
      id: i + 1,
      userId,
      bookingReference: `BK${100000 + i}`,
      stay: {
        ...mockBooking.stay,
        arrival: daysFromNow((i + 1) * 7),
        departure: daysFromNow((i + 4) * 7),
      },
    })
  );
}
