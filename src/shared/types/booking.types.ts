import { BookingStatus } from './common.types';
import type { ProviderId, StayParams } from './provider.types';
import type { BookingLocationRef, Stay, StayInput } from './stay.types';

/** A booking on a provider. Stay dates are calendar dates `YYYY-MM-DD`. */
export interface Booking {
  id: number;
  userId: number;
  providerId: ProviderId;
  /** `${providerId}:${location.externalId}`, when the provider's id for the location is known. */
  locationKey?: string;
  location: BookingLocationRef;
  /** The provider's reference, unique per provider. */
  bookingReference: string;
  stay: Stay;
  /** The booked units (ParkStay: the site number). */
  unitIds: string[];
  /** The provider's own stay fields (ParkStay: `siteType`). */
  stayParams: StayParams;
  numNights: number;
  totalCost?: number;
  currency: string;
  status: BookingStatus;
  bookingData?: ParkStayBookingData;
  notes?: string;
  /** Where the person manages the booking on the provider's site (its bookings page, or its website). */
  manageUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  syncedAt?: Date;
}

/** A booking as create requests send it. Main resolves the user. */
export interface BookingInput {
  providerId: ProviderId;
  bookingReference: string;
  location: BookingLocationRef;
  stay: StayInput;
  unitIds?: string[];
  stayParams?: StayParams;
  totalCost?: number;
  notes?: string;
}

/** The fields an update may change. A booking never moves to another provider. */
export type BookingUpdate = Partial<Omit<BookingInput, 'providerId'>>;

/** `bookings.list` filter. Main resolves the user. */
export interface BookingListFilter {
  providerId?: ProviderId;
  status?: BookingStatus;
}

/** `bookings.import`: a booking the provider knows by its reference. */
export interface BookingImportRequest {
  providerId: ProviderId;
  reference: string;
}

// Raw booking data from ParkStay API
export interface ParkStayBookingData {
  id: string;
  bookingNumber: string;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  campground: {
    id: string;
    name: string;
    parkId: string;
    parkName: string;
  };
  site: {
    id: string;
    name: string;
    type: string;
  };
  dates: {
    arrival: string;
    departure: string;
    nights: number;
  };
  charges: {
    subtotal: number;
    fees: number;
    total: number;
    currency: string;
  };
  status: string;
  createdAt: string;
  // Additional fields from ParkStay
  [key: string]: any;
}
