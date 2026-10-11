/**
 * Booking Service: the local booking records, on any provider.
 *
 * Bookings are unique per `(providerId, reference)`. Every booking it returns carries
 * `manageUrl`, where the person manages it on the provider's site (§12.5): the provider's
 * bookings page, or its website. `importBooking` asks the provider for a booking by its
 * reference (`capabilities.bookingImport`); ParkStay has none, so it is a `CAPABILITY` error.
 */

import type { EventSink } from '@shared/contracts/events';
import {
  Booking,
  BookingInput,
  type BookingListFilter,
  BookingStatus,
  BookingUpdate,
  StayInput,
} from '@shared/types';
import { compareDates, isCalendarDate } from '@shared/utils/calendar-date';
import type { BookingRepository } from '../../database/repositories/booking.repository';
import type { ProviderRegistry } from '../../providers/registry';
import type { ExternalBooking } from '../../providers/sdk/provider';
import { logger } from '../../utils/logger';
import { AppError } from '../../utils/app-error';

/** Everyone in the party. */
function partySize(stay: StayInput): number {
  return stay.adults + (stay.children ?? 0) + (stay.infants ?? 0) + (stay.concessions ?? 0);
}

/** `CONFLICT`'s message for a reference the provider's bookings already have here. */
export const DUPLICATE_BOOKING_MESSAGE = 'This booking is already in your bookings';

const IMPORTED_STATUS: Record<ExternalBooking['status'], BookingStatus> = {
  confirmed: BookingStatus.CONFIRMED,
  pending: BookingStatus.PENDING,
  cancelled: BookingStatus.CANCELLED,
  unknown: BookingStatus.PENDING,
};

export interface BookingServiceDeps {
  bookings: BookingRepository;
  providers: ProviderRegistry;
  /** `booking:updated` after every change. */
  events?: EventSink;
}

export class BookingService {
  private bookingRepository: BookingRepository;
  private readonly providers: ProviderRegistry;
  private readonly events?: EventSink;

  constructor(deps: BookingServiceDeps) {
    this.bookingRepository = deps.bookings;
    this.providers = deps.providers;
    this.events = deps.events;
  }

  /** The booking with `manageUrl`: the provider's bookings page, else its website. */
  private withManageUrl(booking: Booking): Booking {
    const provider = this.providers.tryGet(booking.providerId);
    if (!provider) return booking;
    const manageUrl =
      provider.links.manageBooking?.(booking.bookingReference) ?? provider.manifest.website;
    return { ...booking, manageUrl };
  }

  private withManageUrlOrNull(booking: Booking | null): Booking | null {
    return booking ? this.withManageUrl(booking) : null;
  }

  /** Emits `booking:updated` and returns the booking as the renderer sees it. */
  private changed(booking: Booking): Booking {
    const dto = this.withManageUrl(booking);
    this.events?.emit('booking:updated', dto);
    return dto;
  }

  /**
   * Create a new booking
   */
  async createBooking(userId: number, input: BookingInput): Promise<Booking> {
    try {
      // Validate input
      this.validateBookingInput(input);

      // Check if booking already exists (references are unique per provider)
      const existing = this.bookingRepository.findByReference(
        input.providerId,
        input.bookingReference
      );
      if (existing) {
        throw new AppError('CONFLICT', DUPLICATE_BOOKING_MESSAGE);
      }

      // Create booking
      const booking = this.bookingRepository.create(userId, input);

      logger.info(`Booking created: ${booking.id}`);
      return this.changed(booking);
    } catch (error) {
      // An expected refusal (a duplicate) is a warning with its code, never a stack.
      if (error instanceof AppError && error.code !== 'INTERNAL') {
        logger.warn(`Booking not created: ${error.code}`);
      } else {
        logger.error('Error creating booking:', error);
      }
      throw error;
    }
  }

  /**
   * Get booking by ID
   */
  async getBooking(id: number): Promise<Booking | null> {
    try {
      return this.withManageUrlOrNull(this.bookingRepository.findById(id));
    } catch (error) {
      logger.error(`Error getting booking ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get booking by its provider's reference
   */
  async getBookingByReference(providerId: string, reference: string): Promise<Booking | null> {
    try {
      return this.withManageUrlOrNull(
        this.bookingRepository.findByReference(providerId, reference)
      );
    } catch (error) {
      logger.error(`Error getting booking by reference ${reference}:`, error);
      throw error;
    }
  }

  /**
   * The user's bookings, optionally of one provider or status
   */
  async listBookings(userId: number, filter: BookingListFilter = {}): Promise<Booking[]> {
    try {
      return this.bookingRepository
        .findByUserId(userId, filter)
        .map((booking) => this.withManageUrl(booking));
    } catch (error) {
      logger.error(`Error listing bookings for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get upcoming bookings
   */
  async getUpcomingBookings(userId: number): Promise<Booking[]> {
    try {
      return this.bookingRepository.findUpcoming(userId).map((b) => this.withManageUrl(b));
    } catch (error) {
      logger.error(`Error getting upcoming bookings for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Get past bookings
   */
  async getPastBookings(userId: number): Promise<Booking[]> {
    try {
      return this.bookingRepository.findPast(userId).map((b) => this.withManageUrl(b));
    } catch (error) {
      logger.error(`Error getting past bookings for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Update booking details
   */
  async updateBooking(id: number, updates: BookingUpdate): Promise<Booking> {
    try {
      const existing = await this.getBooking(id);
      if (!existing) {
        throw new AppError('NOT_FOUND', `Booking ${id} not found`);
      }

      // Validate the stay if it is being changed
      if (updates.stay) {
        this.validateStay(updates.stay);
      }

      const updated = this.bookingRepository.update(id, updates);
      if (!updated) {
        throw new Error(`Failed to update booking ${id}`);
      }

      logger.info(`Booking updated: ${id}`);
      return this.changed(updated);
    } catch (error) {
      logger.error(`Error updating booking ${id}:`, error);
      throw error;
    }
  }

  /**
   * Cancel booking
   */
  async cancelBooking(id: number): Promise<Booking> {
    try {
      const booking = await this.getBooking(id);
      if (!booking) {
        throw new AppError('NOT_FOUND', `Booking ${id} not found`);
      }

      if (booking.status === BookingStatus.CANCELLED) {
        throw new Error('Booking is already cancelled');
      }

      const updated = this.bookingRepository.updateStatus(id, BookingStatus.CANCELLED);
      if (!updated) {
        throw new Error(`Failed to cancel booking ${id}`);
      }

      logger.info(`Booking cancelled: ${id}`);
      return this.changed(updated);
    } catch (error) {
      logger.error(`Error cancelling booking ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete booking
   */
  async deleteBooking(id: number): Promise<void> {
    try {
      const booking = await this.getBooking(id);
      if (!booking) {
        throw new AppError('NOT_FOUND', `Booking ${id} not found`);
      }

      this.bookingRepository.deleteById(id);
      logger.info(`Booking deleted: ${id}`);
      // Its last state, once more, so a list showing it refreshes
      this.events?.emit('booking:updated', booking);
    } catch (error) {
      logger.error(`Error deleting booking ${id}:`, error);
      throw error;
    }
  }

  /**
   * Imports a booking from its provider by reference (`capabilities.bookingImport`): created,
   * or brought up to date when it is already here. Throws `ProviderCapabilityError`
   * (`CAPABILITY`) for a provider that cannot import, such as ParkStay.
   */
  async importBooking(userId: number, providerId: string, reference: string): Promise<Booking> {
    const provider = this.providers.require(providerId, 'bookingImport');
    const external = await provider.bookings.get(reference);
    const input: BookingInput = {
      providerId,
      bookingReference: external.reference,
      location: {
        externalId: external.externalId,
        name: external.locationName,
      },
      stay: {
        arrival: external.arrival,
        departure: external.departure,
        adults: Math.max(1, external.guests ?? 1),
      },
      ...(external.unitName ? { unitIds: [external.unitName] } : {}),
      ...(external.totalPrice !== undefined ? { totalCost: external.totalPrice } : {}),
    };
    this.validateStay(input.stay);

    const existing = this.bookingRepository.findByReference(providerId, external.reference);
    const saved = existing
      ? this.bookingRepository.update(existing.id, {
          location: input.location,
          stay: input.stay,
          ...(input.unitIds ? { unitIds: input.unitIds } : {}),
          ...(input.totalCost !== undefined ? { totalCost: input.totalCost } : {}),
        })
      : this.bookingRepository.create(userId, input);
    if (!saved) throw new AppError('INTERNAL', `Booking ${external.reference} was not saved`);
    this.bookingRepository.updateStatus(saved.id, IMPORTED_STATUS[external.status]);
    const synced = this.bookingRepository.markSynced(saved.id);
    if (!synced) throw new AppError('INTERNAL', `Booking ${external.reference} was not saved`);
    logger.info(`Booking imported: ${synced.id} (${providerId})`);
    return this.changed(synced);
  }

  /**
   * A booking the provider confirmed (a hold paid for in the payment window): created, or,
   * when the provider already has it here (a reloaded confirmation page), set confirmed.
   * Synchronous and silent, so it can share the caller's transaction; `announce` it after the
   * commit.
   */
  recordConfirmed(userId: number, input: BookingInput): Booking {
    this.validateBookingInput(input);
    const existing = this.bookingRepository.findByReference(
      input.providerId,
      input.bookingReference
    );
    const saved = existing
      ? this.bookingRepository.updateStatus(existing.id, BookingStatus.CONFIRMED)
      : this.bookingRepository.create(userId, input);
    if (!saved) throw new AppError('INTERNAL', `Booking ${input.bookingReference} was not saved`);
    logger.info(`Booking confirmed: ${saved.id} (${input.providerId})`);
    return saved;
  }

  /** Emits `booking:updated` for a booking written elsewhere; returns it with `manageUrl`. */
  announce(booking: Booking): Booking {
    return this.changed(booking);
  }

  /**
   * Validate booking input
   */
  private validateBookingInput(input: BookingInput): void {
    if (!input.bookingReference || input.bookingReference.trim() === '') {
      throw new Error('Booking reference is required');
    }

    if (!input.location.name || input.location.name.trim() === '') {
      throw new Error('Campground name is required');
    }

    this.validateStay(input.stay);

    if (input.totalCost !== undefined && input.totalCost < 0) {
      throw new Error('Total cost cannot be negative');
    }
  }

  /** The stay's dates are calendar dates in order, and the party is 1 to 50 people. */
  private validateStay(stay: StayInput): void {
    if (!stay.arrival) {
      throw new Error('Arrival date is required');
    }

    if (!stay.departure) {
      throw new Error('Departure date is required');
    }

    if (!isCalendarDate(stay.arrival)) {
      throw new Error('Invalid arrival date');
    }

    if (!isCalendarDate(stay.departure)) {
      throw new Error('Invalid departure date');
    }

    if (compareDates(stay.departure, stay.arrival) <= 0) {
      throw new Error('Departure date must be after arrival date');
    }

    const guests = partySize(stay);
    if (guests < 1) {
      throw new Error('Number of guests must be at least 1');
    }

    if (guests > 50) {
      throw new Error('Number of guests cannot exceed 50');
    }
  }
}
