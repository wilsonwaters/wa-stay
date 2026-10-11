/**
 * Booking Repository
 * Handles CRUD operations for bookings
 */

import { BaseRepository, readInstant } from './base.repository';
import {
  Booking,
  BookingInput,
  type BookingListFilter,
  BookingStatus,
  BookingUpdate,
  locationKeyOf,
} from '@shared/types';
import { nightsBetween } from '@shared/utils/calendar-date';
import { logger } from '../../utils/logger';
import { readStay, readStayParams, readUnitIds, StayRow, stayValues } from '../stay-columns';

interface BookingRow extends StayRow {
  id: number;
  user_id: number;
  provider_id: string;
  booking_reference: string;
  location_external_id: string | null;
  location_name: string;
  area_name: string | null;
  unit_ids: string | null;
  stay_params: string | null;
  num_nights: number;
  total_cost: number | null;
  currency: string;
  status: string;
  booking_data: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}

export class BookingRepository extends BaseRepository<Booking> {
  protected readonly tableName = 'bookings';

  /**
   * Map database row to Booking model
   */
  protected mapRow(row: BookingRow): Booking {
    const where = `bookings ${row.id}`;
    return {
      id: row.id,
      userId: row.user_id,
      providerId: row.provider_id,
      ...(row.location_external_id !== null
        ? { locationKey: locationKeyOf(row.provider_id, row.location_external_id) }
        : {}),
      location: {
        ...(row.location_external_id !== null ? { externalId: row.location_external_id } : {}),
        name: row.location_name,
        ...(row.area_name !== null ? { areaName: row.area_name } : {}),
      },
      bookingReference: row.booking_reference,
      stay: readStay(row),
      unitIds: readUnitIds(row.unit_ids, where),
      stayParams: readStayParams(row.stay_params, where),
      numNights: row.num_nights,
      totalCost: row.total_cost || undefined,
      currency: row.currency,
      status: row.status as BookingStatus,
      bookingData: this.parseJson(row.booking_data),
      notes: row.notes || undefined,
      createdAt: readInstant(row.created_at) ?? new Date(0),
      updatedAt: readInstant(row.updated_at) ?? new Date(0),
      syncedAt: this.parseDate(row.synced_at),
    };
  }

  /**
   * Create new booking. `num_nights` is worked out from the stay's calendar dates.
   */
  create(userId: number, input: BookingInput): Booking {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO bookings (
          user_id, provider_id, booking_reference, location_external_id, location_name,
          area_name, unit_ids, stay_params, arrival_date, departure_date, num_adults,
          num_children, num_infants, num_concessions, num_nights, total_cost, notes, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')
      `);

      const result = stmt.run(
        userId,
        input.providerId,
        input.bookingReference,
        input.location.externalId ?? null,
        input.location.name,
        input.location.areaName ?? null,
        JSON.stringify(input.unitIds ?? []),
        JSON.stringify(input.stayParams ?? {}),
        ...stayValues(input.stay),
        nightsBetween(input.stay.arrival, input.stay.departure),
        input.totalCost || null,
        input.notes || null
      );

      const booking = this.findById(result.lastInsertRowid as number);
      if (!booking) throw new Error('Failed to create booking');

      logger.info(`Booking created: ${booking.id}`);
      return booking;
    } catch (error) {
      logger.error('Error creating booking:', error);
      throw error;
    }
  }

  /**
   * The user's bookings, optionally of one provider or status, latest arrival first.
   */
  findByUserId(userId: number, filter: BookingListFilter = {}): Booking[] {
    try {
      const where = ['user_id = ?'];
      const values: unknown[] = [userId];
      if (filter.providerId !== undefined) {
        where.push('provider_id = ?');
        values.push(filter.providerId);
      }
      if (filter.status !== undefined) {
        where.push('status = ?');
        values.push(filter.status);
      }
      const rows = this.db
        .prepare(`SELECT * FROM bookings WHERE ${where.join(' AND ')} ORDER BY arrival_date DESC`)
        .all(values);
      return rows.map((row) => this.mapRow(row as BookingRow));
    } catch (error) {
      logger.error(`Error finding bookings for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Find a booking by its provider's reference. References are unique per provider.
   */
  findByReference(providerId: string, reference: string): Booking | null {
    try {
      const row = this.db
        .prepare('SELECT * FROM bookings WHERE provider_id = ? AND booking_reference = ?')
        .get(providerId, reference);
      return row ? this.mapRow(row as BookingRow) : null;
    } catch (error) {
      logger.error(`Error finding booking by reference ${reference}:`, error);
      throw error;
    }
  }

  /**
   * Update booking. The provider never changes; `location` and `stay` are replaced whole,
   * and a new stay recalculates `num_nights`.
   */
  update(id: number, updates: BookingUpdate): Booking | null {
    try {
      const fields: string[] = [];
      const values: unknown[] = [];
      const push = (column: string, value: unknown): void => {
        fields.push(`${column} = ?`);
        values.push(value);
      };

      if (updates.bookingReference !== undefined) {
        push('booking_reference', updates.bookingReference);
      }
      if (updates.location !== undefined) {
        push('location_external_id', updates.location.externalId ?? null);
        push('location_name', updates.location.name);
        push('area_name', updates.location.areaName ?? null);
      }
      if (updates.unitIds !== undefined) push('unit_ids', JSON.stringify(updates.unitIds));
      if (updates.stayParams !== undefined) {
        push('stay_params', JSON.stringify(updates.stayParams));
      }
      if (updates.stay !== undefined) {
        const [arrival, departure, adults, children, infants, concessions] = stayValues(
          updates.stay
        );
        push('arrival_date', arrival);
        push('departure_date', departure);
        push('num_adults', adults);
        push('num_children', children);
        push('num_infants', infants);
        push('num_concessions', concessions);
        push('num_nights', nightsBetween(arrival, departure));
      }
      if (updates.totalCost !== undefined) push('total_cost', updates.totalCost || null);
      if (updates.notes !== undefined) push('notes', updates.notes || null);

      if (fields.length === 0) {
        return this.findById(id);
      }

      values.push(id);
      this.db.prepare(`UPDATE bookings SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      logger.info(`Booking updated: ID ${id}`);
      return this.findById(id);
    } catch (error) {
      logger.error(`Error updating booking ${id}:`, error);
      throw error;
    }
  }

  /**
   * Update booking status
   */
  updateStatus(id: number, status: BookingStatus): Booking | null {
    try {
      const stmt = this.db.prepare('UPDATE bookings SET status = ? WHERE id = ?');
      stmt.run(status, id);

      logger.info(`Booking status updated: ID ${id}, status ${status}`);
      return this.findById(id);
    } catch (error) {
      logger.error(`Error updating booking status ${id}:`, error);
      throw error;
    }
  }

  /**
   * Mark booking as synced
   */
  markSynced(id: number): Booking | null {
    try {
      const stmt = this.db.prepare(
        'UPDATE bookings SET synced_at = CURRENT_TIMESTAMP WHERE id = ?'
      );
      stmt.run(id);

      logger.info(`Booking marked as synced: ID ${id}`);
      return this.findById(id);
    } catch (error) {
      logger.error(`Error marking booking as synced ${id}:`, error);
      throw error;
    }
  }

  /**
   * Find upcoming bookings
   */
  findUpcoming(userId: number): Booking[] {
    try {
      const rows = this.db
        .prepare(
          `
          SELECT * FROM bookings
          WHERE user_id = ?
            AND arrival_date >= date('now')
            AND status = 'confirmed'
          ORDER BY arrival_date ASC
        `
        )
        .all(userId);
      return rows.map((row) => this.mapRow(row as BookingRow));
    } catch (error) {
      logger.error(`Error finding upcoming bookings for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Find past bookings
   */
  findPast(userId: number): Booking[] {
    try {
      const rows = this.db
        .prepare(
          `
          SELECT * FROM bookings
          WHERE user_id = ?
            AND departure_date < date('now')
          ORDER BY departure_date DESC
        `
        )
        .all(userId);
      return rows.map((row) => this.mapRow(row as BookingRow));
    } catch (error) {
      logger.error(`Error finding past bookings for user ${userId}:`, error);
      throw error;
    }
  }
}
