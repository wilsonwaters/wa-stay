/**
 * Bookings as the renderer receives them, for component tests, and a provider that can import
 * bookings by reference (ParkStay cannot: it has no booking-lookup API).
 */
import type { Booking } from '../../../src/shared/types/booking.types';
import { BookingStatus } from '../../../src/shared/types/common.types';
import type { ProviderManifest } from '../../../src/shared/types/provider.types';
import { FAKE_MANIFEST } from '../../utils/renderer/manifests';

export function makeBooking(overrides: Partial<Booking> = {}): Booking {
  const providerId = overrides.providerId ?? 'parkstay';
  const location = overrides.location ?? {
    externalId: '20',
    name: 'Osprey Bay',
    areaName: 'Cape Range National Park',
  };
  return {
    id: 1,
    userId: 1,
    providerId,
    ...(location.externalId ? { locationKey: `${providerId}:${location.externalId}` } : {}),
    location,
    bookingReference: 'PB123456',
    stay: {
      arrival: '2099-12-11',
      departure: '2099-12-13',
      adults: 2,
      children: 0,
      infants: 0,
      concessions: 0,
    },
    unitIds: ['12'],
    stayParams: {},
    numNights: 2,
    currency: 'AUD',
    status: BookingStatus.CONFIRMED,
    manageUrl: 'https://parkstay.dbca.wa.gov.au/mybookings/',
    createdAt: new Date('2099-01-01T00:00:00Z'),
    updatedAt: new Date('2099-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** A v6 booking as V2 migrated it: ParkStay, no location id, the park as the area. */
export function makeLegacyBooking(overrides: Partial<Booking> = {}): Booking {
  const booking = makeBooking({
    location: { name: 'Dales Campground', areaName: 'Karijini National Park' },
    bookingReference: 'BK123456',
    stayParams: { siteType: 'Unpowered' },
    ...overrides,
  });
  delete booking.locationKey;
  return booking;
}

/** A provider that imports bookings by reference and needs an account to do it. */
export const IMPORT_MANIFEST: ProviderManifest = {
  ...FAKE_MANIFEST,
  id: 'tripco',
  name: 'TripCo Holiday Parks',
  shortName: 'TripCo',
  description: 'Holiday parks that can import a booking by reference',
  website: 'https://tripco.example.com',
  brand: { color: '#8C3E3E', monogram: 'TC' }, // token-guard-ignore: provider brand data
  capabilities: {
    ...FAKE_MANIFEST.capabilities,
    catalog: false,
    bookingImport: true,
    account: 'required',
  },
};

/**
 * Freezes the clock at `iso` for every test in the file: only `Date` is faked, so React Query,
 * user-event and the components' own timers keep running for real.
 */
export function freezeDateAt(iso: string): void {
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date(iso),
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
  });
  afterEach(() => jest.useRealTimers());
}
