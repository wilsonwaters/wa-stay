/**
 * The "Add booking" form: its values, the rules the details step checks, and the
 * `BookingInput` it sends. References are kept as typed (trimmed, never upper-cased): only
 * ParkStay's are all capitals. Pure.
 */
import type { Booking, BookingInput } from '../../../../shared/types/booking.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { LocationChoice } from '../../../components/LocationCombobox';

export interface AddBookingValues {
  providerId: string;
  /** The catalogue place, for a provider with a catalogue. */
  location: LocationChoice | null;
  /** The place's name as typed, for a provider without one. */
  locationName: string;
  areaName: string;
  /** Calendar dates `YYYY-MM-DD`, or '' until chosen. */
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  infants: number;
  unit: string;
  reference: string;
  /** As typed: '' is no cost. */
  totalCost: string;
  notes: string;
}

export type AddBookingField =
  'location' | 'dates' | 'adults' | 'unit' | 'reference' | 'totalCost' | 'notes';
export type AddBookingErrors = Partial<Record<AddBookingField, string>>;

export const REFERENCE_MAX = 50;
export const UNIT_MAX = 50;
export const NOTES_MAX = 2000;

export function emptyBookingValues(providerId = ''): AddBookingValues {
  return {
    providerId,
    location: null,
    locationName: '',
    areaName: '',
    arrival: '',
    departure: '',
    adults: 2,
    children: 0,
    infants: 0,
    unit: '',
    reference: '',
    totalCost: '',
    notes: '',
  };
}

/** "105", "105.5", "$1,050.00". */
const AMOUNT = /^\d+(\.\d{1,2})?$/;

/** A typed cost as a number; undefined for '' and for anything that is not an amount. */
export function parseAmount(text: string): number | undefined {
  const cleaned = text.trim().replace(/^\$/, '').replace(/,/g, '');
  return AMOUNT.test(cleaned) ? Number(cleaned) : undefined;
}

/** The booking already stored under this provider and reference, if any. */
export function existingBooking(
  bookings: readonly Booking[],
  providerId: string,
  reference: string
): Booking | undefined {
  const ref = reference.trim();
  return bookings.find((b) => b.providerId === providerId && b.bookingReference === ref);
}

/** What is wrong with the details step: one message per field, in the order they show. */
export function validateDetails(
  values: AddBookingValues,
  manifest: ProviderManifest | undefined
): AddBookingErrors {
  const errors: AddBookingErrors = {};
  const catalog = manifest?.capabilities.catalog === true;
  if (catalog ? !values.location : !values.locationName.trim()) {
    errors.location = catalog ? 'Choose the place you booked' : "Enter the place's name";
  }
  if (!values.arrival || !values.departure) {
    errors.dates = 'Choose your check-in and check-out dates';
  } else if (values.departure <= values.arrival) {
    errors.dates = 'Check-out must be after check-in';
  }
  if (values.adults + values.children + values.infants < 1) {
    errors.adults = 'Add at least one guest';
  }
  if (values.unit.trim().length > UNIT_MAX) {
    errors.unit = `Use ${UNIT_MAX} characters or fewer`;
  }
  const reference = values.reference.trim();
  if (!reference) errors.reference = 'Enter the booking reference';
  else if (reference.length > REFERENCE_MAX) {
    errors.reference = `Use ${REFERENCE_MAX} characters or fewer`;
  }
  if (values.totalCost.trim() && parseAmount(values.totalCost) === undefined) {
    errors.totalCost = 'Enter an amount like 105.50, or leave it empty';
  }
  if (values.notes.length > NOTES_MAX) errors.notes = `Use ${NOTES_MAX} characters or fewer`;
  return errors;
}

/** The booking to create: calendar dates `YYYY-MM-DD`, the provider, and no user (main's). */
export function toBookingInput(
  values: AddBookingValues,
  manifest: ProviderManifest | undefined
): BookingInput {
  const catalog = manifest?.capabilities.catalog === true && values.location;
  const name = catalog ? values.location!.name : values.locationName.trim();
  const area = values.areaName.trim();
  const unit = values.unit.trim();
  const cost = parseAmount(values.totalCost);
  const notes = values.notes.trim();
  return {
    providerId: values.providerId,
    bookingReference: values.reference.trim(),
    location: {
      ...(catalog ? { externalId: values.location!.externalId } : {}),
      name,
      ...(area ? { areaName: area } : {}),
    },
    stay: {
      arrival: values.arrival,
      departure: values.departure,
      adults: values.adults,
      children: values.children,
      infants: values.infants,
    },
    ...(unit ? { unitIds: [unit] } : {}),
    ...(cost !== undefined ? { totalCost: cost } : {}),
    ...(notes ? { notes } : {}),
  };
}
