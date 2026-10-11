import { BaseRepository } from './base.repository';
import {
  locationKeyOf,
  type UnitAvailability,
  Watch,
  WatchInput,
  type WatchHoldState,
  type WatchListFilter,
  WatchUpdate,
} from '@shared/types';
import { WatchResult } from '@shared/types/common.types';
import { DEFAULT_WATCH_INTERVAL } from '@shared/constants';
import { AppError } from '../../utils/app-error';
import { readStay, readStayParams, readUnitIds, StayRow, stayValues } from '../stay-columns';

interface WatchRow extends StayRow {
  id: number;
  user_id: number;
  provider_id: string;
  name: string;
  location_external_id: string;
  location_name: string;
  area_name: string | null;
  unit_ids: string | null;
  stay_params: string | null;
  check_interval_minutes: number;
  is_active: number;
  last_checked_at: string | null;
  next_check_at: string | null;
  last_result: string | null;
  found_count: number;
  auto_book: number;
  notify_only: number;
  allow_partial_match: number;
  max_price: number | null;
  notes: string | null;
  last_availability: string | null;
  // Migration v9 (§12.31)
  hold_reference: string | null;
  hold_expires_at: string | null;
  hold_unit_id: string | null;
  payment_url: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export class WatchRepository extends BaseRepository<Watch> {
  protected readonly tableName = 'watches';

  /**
   * Create a new watch
   */
  create(userId: number, input: WatchInput): Watch {
    const stmt = this.db.prepare(`
      INSERT INTO watches (
        user_id, provider_id, name, location_external_id, location_name, area_name,
        arrival_date, departure_date, num_adults, num_children, num_infants, num_concessions,
        unit_ids, stay_params, check_interval_minutes, auto_book, notify_only,
        allow_partial_match, max_price, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      userId,
      input.providerId,
      input.name,
      input.location.externalId,
      input.location.name,
      input.location.areaName ?? null,
      ...stayValues(input.stay),
      JSON.stringify(input.unitIds ?? []),
      JSON.stringify(input.stayParams ?? {}),
      input.checkIntervalMinutes || DEFAULT_WATCH_INTERVAL,
      input.autoHold ? 1 : 0,
      input.notifyOnly !== false ? 1 : 0,
      input.allowPartialMatch ? 1 : 0,
      input.maxPrice || null,
      input.notes || null
    );

    const watch = this.findById(result.lastInsertRowid as number);
    if (!watch) {
      throw new Error('Failed to create watch');
    }
    return watch;
  }

  /**
   * Update watch. The provider never changes; `location` and `stay` are replaced whole.
   */
  update(id: number, updates: WatchUpdate): Watch {
    const fields: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      fields.push(`${column} = ?`);
      values.push(value);
    };

    if (updates.name !== undefined) push('name', updates.name);
    if (updates.location !== undefined) {
      push('location_external_id', updates.location.externalId);
      push('location_name', updates.location.name);
      push('area_name', updates.location.areaName ?? null);
    }
    if (updates.stay !== undefined) {
      const [arrival, departure, adults, children, infants, concessions] = stayValues(updates.stay);
      push('arrival_date', arrival);
      push('departure_date', departure);
      push('num_adults', adults);
      push('num_children', children);
      push('num_infants', infants);
      push('num_concessions', concessions);
    }
    if (updates.unitIds !== undefined) push('unit_ids', JSON.stringify(updates.unitIds));
    if (updates.stayParams !== undefined) push('stay_params', JSON.stringify(updates.stayParams));
    if (updates.checkIntervalMinutes !== undefined) {
      push('check_interval_minutes', updates.checkIntervalMinutes);
    }
    if (updates.autoHold !== undefined) push('auto_book', updates.autoHold ? 1 : 0);
    if (updates.notifyOnly !== undefined) push('notify_only', updates.notifyOnly ? 1 : 0);
    if (updates.allowPartialMatch !== undefined) {
      push('allow_partial_match', updates.allowPartialMatch ? 1 : 0);
    }
    // 0 is "no max price" (the renderer clears one with it), stored as NULL as on create.
    if (updates.maxPrice !== undefined) push('max_price', updates.maxPrice || null);
    if (updates.notes !== undefined) push('notes', updates.notes);

    if (fields.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE watches SET ${fields.join(', ')} WHERE id = ?`).run(values);
    }

    const watch = this.findById(id);
    if (!watch) throw new AppError('NOT_FOUND', 'Watch not found');
    return watch;
  }

  /**
   * The user's watches, optionally of one provider or state, oldest first.
   */
  findByUserId(userId: number, filter: WatchListFilter = {}): Watch[] {
    const where = ['user_id = ?'];
    const values: unknown[] = [userId];
    if (filter.providerId !== undefined) {
      where.push('provider_id = ?');
      values.push(filter.providerId);
    }
    if (filter.status !== undefined) {
      where.push('is_active = ?');
      values.push(filter.status === 'active' ? 1 : 0);
    }
    const rows = this.db
      .prepare(`SELECT * FROM watches WHERE ${where.join(' AND ')} ORDER BY id`)
      .all(values);
    return rows.map((row) => this.mapRow(row as WatchRow));
  }

  /**
   * Find active watches
   */
  findActive(): Watch[] {
    const rows = this.db.prepare('SELECT * FROM watches WHERE is_active = 1').all();
    return rows.map((row) => this.mapRow(row as WatchRow));
  }

  /**
   * Active watches of these providers due at `now` (never checked, or `next_check_at` reached),
   * the longest overdue first.
   */
  findDue(now: Date, providerIds: readonly string[]): Watch[] {
    if (providerIds.length === 0) return [];
    const placeholders = providerIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT * FROM watches
         WHERE is_active = 1 AND (next_check_at IS NULL OR next_check_at <= ?)
           AND provider_id IN (${placeholders})
         ORDER BY next_check_at IS NOT NULL, next_check_at, id`
      )
      .all(now.toISOString(), ...providerIds);
    return rows.map((row) => this.mapRow(row as WatchRow));
  }

  /**
   * Watches of the provider and user that hold or booked a night of the stay, other than
   * `excludeId`: booked ones (`last_result 'booked'`), and held ones whose hold has not
   * expired at `now` (`hold_expires_at`; a held row with none, from before v9, holds nothing).
   * Calendar dates compare as text.
   */
  findHeldOverlapping(
    providerId: string,
    userId: number,
    arrival: string,
    departure: string,
    now: Date,
    excludeId?: number
  ): Watch[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM watches
         WHERE provider_id = ? AND user_id = ? AND id != ?
           AND ((last_result = ? AND hold_expires_at > ?) OR last_result = ?)
           AND arrival_date < ? AND ? < departure_date`
      )
      .all(
        providerId,
        userId,
        excludeId ?? -1,
        WatchResult.HELD,
        now.toISOString(),
        WatchResult.BOOKED,
        departure,
        arrival
      );
    return rows.map((row) => this.mapRow(row as WatchRow));
  }

  /**
   * Activate watch. `nextCheckAt` makes it due (the scheduler picks it up on its next tick).
   */
  activate(id: number, nextCheckAt?: Date): void {
    this.db
      .prepare(
        'UPDATE watches SET is_active = 1, next_check_at = COALESCE(?, next_check_at) WHERE id = ?'
      )
      .run(nextCheckAt ? nextCheckAt.toISOString() : null, id);
  }

  /**
   * Deactivate watch
   */
  deactivate(id: number): void {
    const stmt = this.db.prepare('UPDATE watches SET is_active = 0 WHERE id = ?');
    stmt.run(id);
  }

  /** When the watch is next due. */
  setNextCheckAt(id: number, nextCheckAt: Date): void {
    this.db
      .prepare('UPDATE watches SET next_check_at = ? WHERE id = ?')
      .run(nextCheckAt.toISOString(), id);
  }

  /**
   * Records one check in one transaction: its result, the units it saw (when it got that
   * far), when it ran, when the watch is next due, and its error (none clears the last one).
   * `found` adds one to `found_count`.
   */
  recordRun(
    id: number,
    run: {
      result: WatchResult;
      found: boolean;
      checkedAt: Date;
      nextCheckAt: Date;
      availability?: UnitAvailability[];
      error?: string;
    }
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE watches
           SET last_result = ?, found_count = found_count + ?, last_checked_at = ?,
               next_check_at = ?, last_error = ?
           WHERE id = ?`
        )
        .run(
          run.result,
          run.found ? 1 : 0,
          run.checkedAt.toISOString(),
          run.nextCheckAt.toISOString(),
          run.error ?? null,
          id
        );
      if (run.availability) {
        this.db
          .prepare('UPDATE watches SET last_availability = ? WHERE id = ?')
          .run(JSON.stringify(run.availability), id);
      }
    })();
  }

  /**
   * The auto-hold placed a hold: `last_result 'held'`, the hold's reference, expiry, unit and
   * payment page, and the watch stops (one statement).
   */
  markHeld(id: number, hold: WatchHoldState): void {
    this.db
      .prepare(
        `UPDATE watches
         SET last_result = ?, is_active = 0, hold_reference = ?, hold_expires_at = ?,
             hold_unit_id = ?, payment_url = ?, last_error = NULL
         WHERE id = ?`
      )
      .run(
        WatchResult.HELD,
        hold.reference,
        hold.expiresAt.toISOString(),
        hold.unitId ?? null,
        hold.paymentUrl ?? null,
        id
      );
  }

  /** The hold was paid for: `last_result 'booked'`, inactive; the hold columns stay. */
  setBooked(id: number): void {
    this.db
      .prepare('UPDATE watches SET last_result = ?, is_active = 0, last_error = NULL WHERE id = ?')
      .run(WatchResult.BOOKED, id);
  }

  /** Why the last run fell short (an automatic hold that was not placed), or none. */
  setLastError(id: number, error: string | undefined): void {
    this.db.prepare('UPDATE watches SET last_error = ? WHERE id = ?').run(error ?? null, id);
  }

  /** The last result alone (an unknown provider, found when the scheduler starts). */
  setLastResult(id: number, result: WatchResult): void {
    this.db.prepare('UPDATE watches SET last_result = ? WHERE id = ?').run(result, id);
  }

  /** `hold`, when the row has a hold reference and expiry (v9 columns). */
  private readHold(row: WatchRow): { hold?: WatchHoldState } {
    const expiresAt = this.parseDate(row.hold_expires_at);
    if (!row.hold_reference || !expiresAt) return {};
    return {
      hold: {
        reference: row.hold_reference,
        expiresAt,
        ...(row.hold_unit_id ? { unitId: row.hold_unit_id } : {}),
        ...(row.payment_url ? { paymentUrl: row.payment_url } : {}),
      },
    };
  }

  /**
   * `last_availability` as units, or undefined. Rows written before V4 hold another shape
   * (per-site results); they read as undefined until the next check replaces them.
   */
  private readAvailability(value: string | null): UnitAvailability[] | undefined {
    const parsed = this.parseJson<unknown>(value);
    if (!Array.isArray(parsed)) return undefined;
    const units = parsed.every(
      (item) =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as UnitAvailability).unitId === 'string' &&
        Array.isArray((item as UnitAvailability).nights)
    );
    return units ? (parsed as UnitAvailability[]) : undefined;
  }

  /**
   * How many of the provider's watches hold a site whose hold has not expired at `now`
   * (`last_result 'held'` and `hold_expires_at`, migration v9). The account service asks it
   * before a sign-out: the hold lives in the provider's session.
   */
  countUnexpiredHolds(providerId: string, now: Date): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM watches
         WHERE provider_id = ? AND last_result = 'held' AND hold_expires_at > ?`
      )
      .get(providerId, now.toISOString()) as { n: number };
    return row.n;
  }

  protected mapRow(row: WatchRow): Watch {
    const where = `watches ${row.id}`;
    return {
      id: row.id,
      userId: row.user_id,
      providerId: row.provider_id,
      locationKey: locationKeyOf(row.provider_id, row.location_external_id),
      location: {
        externalId: row.location_external_id,
        name: row.location_name,
        ...(row.area_name !== null ? { areaName: row.area_name } : {}),
      },
      name: row.name,
      stay: readStay(row),
      unitIds: readUnitIds(row.unit_ids, where),
      stayParams: readStayParams(row.stay_params, where),
      checkIntervalMinutes: row.check_interval_minutes,
      isActive: Boolean(row.is_active),
      lastCheckedAt: this.parseDate(row.last_checked_at),
      nextCheckAt: this.parseDate(row.next_check_at),
      lastResult: (row.last_result ?? undefined) as WatchResult | undefined,
      lastAvailability: this.readAvailability(row.last_availability),
      foundCount: row.found_count,
      autoHold: Boolean(row.auto_book),
      notifyOnly: Boolean(row.notify_only),
      allowPartialMatch: Boolean(row.allow_partial_match),
      maxPrice: row.max_price ?? undefined,
      notes: row.notes ?? undefined,
      ...this.readHold(row),
      ...(row.last_error ? { lastError: row.last_error } : {}),
      createdAt: this.parseDate(row.created_at)!,
      updatedAt: this.parseDate(row.updated_at)!,
    };
  }
}
