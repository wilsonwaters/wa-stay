import { BaseRepository } from './base.repository';
import {
  locationKeyOf,
  SiteSnipe,
  SiteSnipeInput,
  SiteSnipeUpdate,
  type SnipeListFilter,
} from '@shared/types';
import { SnipeResult, SnipeReleaseMode, SnipeStatus } from '@shared/types/common.types';
import { AppError } from '../../utils/app-error';
import { readStay, readStayParams, readUnitIds, StayRow, stayValues } from '../stay-columns';

interface SiteSnipeRow extends StayRow {
  id: number;
  user_id: number;
  provider_id: string;
  name: string;
  location_external_id: string;
  location_name: string | null;
  area_name: string | null;
  unit_ids: string | null;
  stay_params: string | null;
  release_mode: string;
  release_at: string | null;
  access_gate_enabled: number;
  lead_time_seconds: number;
  poll_interval_ms: number;
  window_duration_ms: number;
  status: string;
  is_active: number;
  attempts_count: number;
  max_attempts: number;
  last_checked_at: string | null;
  next_check_at: string | null;
  last_result: string | null;
  last_error: string | null;
  hold_reference: string | null;
  hold_expires_at: string | null;
  hold_unit_id: string | null;
  payment_url: string | null;
  booked_reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Repository for Site Snipe entries (site_snipes table).
 */
export class SiteSniperRepository extends BaseRepository<SiteSnipe> {
  protected readonly tableName = 'site_snipes';

  /**
   * Create a new Site Snipe. Applies sensible defaults for optional fields. Provider-specific
   * defaults (gear type, vehicles) are the services' to apply: `stay_params` is stored as given.
   */
  create(userId: number, input: SiteSnipeInput): SiteSnipe {
    const stmt = this.db.prepare(`
      INSERT INTO site_snipes (
        user_id, provider_id, name, location_external_id, location_name, area_name, unit_ids,
        arrival_date, departure_date, num_adults, num_children, num_infants, num_concessions,
        stay_params, release_mode, release_at, access_gate_enabled, lead_time_seconds,
        poll_interval_ms, window_duration_ms, status, is_active, max_attempts, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      userId,
      input.providerId,
      input.name,
      input.location.externalId,
      input.location.name || null,
      input.location.areaName ?? null,
      JSON.stringify(input.unitIds ?? []),
      ...stayValues(input.stay),
      JSON.stringify(input.stayParams ?? {}),
      input.releaseMode,
      this.formatDate(input.releaseAt),
      input.accessGateEnabled ? 1 : 0,
      input.leadTimeSeconds ?? 120,
      input.pollIntervalMs ?? 1500,
      input.windowDurationMs ?? 900000,
      SnipeStatus.ARMED,
      1,
      input.maxAttempts ?? 0,
      input.notes || null
    );

    const snipe = this.findById(result.lastInsertRowid as number);
    if (!snipe) {
      throw new Error('Failed to create site snipe');
    }
    return snipe;
  }

  /**
   * Update a Site Snipe's editable fields. The provider never changes; `location` and
   * `stay` are replaced whole.
   */
  update(id: number, updates: SiteSnipeUpdate): SiteSnipe {
    const fields: string[] = [];
    const values: unknown[] = [];

    const push = (column: string, value: unknown): void => {
      fields.push(`${column} = ?`);
      values.push(value);
    };

    if (updates.name !== undefined) push('name', updates.name);
    if (updates.location !== undefined) {
      push('location_external_id', updates.location.externalId);
      push('location_name', updates.location.name || null);
      push('area_name', updates.location.areaName ?? null);
    }
    if (updates.unitIds !== undefined) push('unit_ids', JSON.stringify(updates.unitIds));
    if (updates.stay !== undefined) {
      const [arrival, departure, adults, children, infants, concessions] = stayValues(updates.stay);
      push('arrival_date', arrival);
      push('departure_date', departure);
      push('num_adults', adults);
      push('num_children', children);
      push('num_infants', infants);
      push('num_concessions', concessions);
    }
    if (updates.stayParams !== undefined) push('stay_params', JSON.stringify(updates.stayParams));
    if (updates.releaseMode !== undefined) push('release_mode', updates.releaseMode);
    if (updates.releaseAt !== undefined) push('release_at', this.formatDate(updates.releaseAt));
    if (updates.accessGateEnabled !== undefined) {
      push('access_gate_enabled', updates.accessGateEnabled ? 1 : 0);
    }
    if (updates.leadTimeSeconds !== undefined) push('lead_time_seconds', updates.leadTimeSeconds);
    if (updates.pollIntervalMs !== undefined) push('poll_interval_ms', updates.pollIntervalMs);
    if (updates.windowDurationMs !== undefined)
      push('window_duration_ms', updates.windowDurationMs);
    if (updates.maxAttempts !== undefined) push('max_attempts', updates.maxAttempts);
    if (updates.notes !== undefined) push('notes', updates.notes);

    if (fields.length > 0) {
      values.push(id);
      this.db.prepare(`UPDATE site_snipes SET ${fields.join(', ')} WHERE id = ?`).run(values);
    }

    const snipe = this.findById(id);
    if (!snipe) throw new AppError('NOT_FOUND', 'Site snipe not found');
    return snipe;
  }

  /**
   * The user's snipes, optionally of one provider or status (newest first).
   */
  findByUserId(userId: number, filter: SnipeListFilter = {}): SiteSnipe[] {
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
      .prepare(
        `SELECT * FROM site_snipes WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC`
      )
      .all(values);
    return rows.map((row) => this.mapRow(row as SiteSnipeRow));
  }

  /**
   * Snipes of the provider and user that hold or booked a night of the stay, other than
   * `excludeId`: BOOKED ones, and HELD ones whose hold has not expired at `now`. Calendar
   * dates compare as text.
   */
  findHeldOverlapping(
    providerId: string,
    userId: number,
    arrival: string,
    departure: string,
    now: Date,
    excludeId?: number
  ): SiteSnipe[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM site_snipes
         WHERE provider_id = ? AND user_id = ? AND id != ?
           AND (status = ? OR (status = ? AND (hold_expires_at IS NULL OR hold_expires_at > ?)))
           AND arrival_date < ? AND ? < departure_date`
      )
      .all(
        providerId,
        userId,
        excludeId ?? -1,
        SnipeStatus.BOOKED,
        SnipeStatus.HELD,
        now.toISOString(),
        departure,
        arrival
      );
    return rows.map((row) => this.mapRow(row as SiteSnipeRow));
  }

  /** HELD snipes whose hold has an expiry, for the hold-expiry timers. */
  findHeld(): SiteSnipe[] {
    const rows = this.db
      .prepare('SELECT * FROM site_snipes WHERE status = ? AND hold_expires_at IS NOT NULL')
      .all(SnipeStatus.HELD);
    return rows.map((row) => this.mapRow(row as SiteSnipeRow));
  }

  /**
   * Find all active snipes.
   */
  findActive(): SiteSnipe[] {
    const rows = this.db.prepare('SELECT * FROM site_snipes WHERE is_active = 1').all();
    return rows.map((row) => this.mapRow(row as SiteSnipeRow));
  }

  /**
   * Find snipes that are armed and awaiting their release window.
   */
  findArmed(): SiteSnipe[] {
    const rows = this.db
      .prepare('SELECT * FROM site_snipes WHERE is_active = 1 AND status IN (?, ?)')
      .all(SnipeStatus.ARMED, SnipeStatus.WAITING_RELEASE);
    return rows.map((row) => this.mapRow(row as SiteSnipeRow));
  }

  /**
   * Find cancellation-mode snipes due for a poll.
   */
  findDueForCheck(): SiteSnipe[] {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM site_snipes
         WHERE is_active = 1 AND release_mode = ?
           AND (next_check_at IS NULL OR next_check_at <= ?)`
      )
      .all(SnipeReleaseMode.CANCELLATION, now);
    return rows.map((row) => this.mapRow(row as SiteSnipeRow));
  }

  /**
   * Creates a snipe saved paused: inactive, DISABLED, with `reason` as its last error, all in
   * one transaction (nothing ever sees it active).
   */
  createPaused(userId: number, input: SiteSnipeInput, reason: string): SiteSnipe {
    return this.transaction(() => {
      const snipe = this.create(userId, input);
      this.deactivate(snipe.id);
      this.setResult(snipe.id, SnipeResult.PENDING, reason);
      return this.findById(snipe.id)!;
    });
  }

  /**
   * Activate a snipe (arm it).
   */
  activate(id: number): void {
    this.db
      .prepare(`UPDATE site_snipes SET is_active = 1, status = ? WHERE id = ?`)
      .run(SnipeStatus.ARMED, id);
  }

  /**
   * Deactivate a snipe. Preserves terminal statuses (held/booked); otherwise disables.
   */
  deactivate(id: number): void {
    const snipe = this.findById(id);
    const terminal =
      snipe &&
      (snipe.status === SnipeStatus.HELD ||
        snipe.status === SnipeStatus.BOOKED ||
        snipe.status === SnipeStatus.EXPIRED ||
        snipe.status === SnipeStatus.FAILED);
    if (terminal) {
      this.db.prepare('UPDATE site_snipes SET is_active = 0 WHERE id = ?').run(id);
    } else {
      this.db
        .prepare('UPDATE site_snipes SET is_active = 0, status = ? WHERE id = ?')
        .run(SnipeStatus.DISABLED, id);
    }
  }

  /**
   * Update the snipe status.
   */
  updateStatus(id: number, status: SnipeStatus): void {
    this.db.prepare('UPDATE site_snipes SET status = ? WHERE id = ?').run(status, id);
  }

  /**
   * Update the last-checked / next-check timestamps.
   */
  updateCheckTimestamps(id: number, lastChecked: Date, nextCheck?: Date): void {
    this.db
      .prepare('UPDATE site_snipes SET last_checked_at = ?, next_check_at = ? WHERE id = ?')
      .run(lastChecked.toISOString(), nextCheck ? nextCheck.toISOString() : null, id);
  }

  /**
   * Increment the attempts counter.
   */
  incrementAttempts(id: number): void {
    this.db
      .prepare('UPDATE site_snipes SET attempts_count = attempts_count + 1 WHERE id = ?')
      .run(id);
  }

  /**
   * Record that a temporary hold was placed: the provider's hold reference, when it expires
   * and the unit it is on.
   */
  setHeld(
    id: number,
    holdReference: string,
    expiresAt: Date,
    paymentUrl?: string,
    holdUnitId?: string
  ): void {
    this.db
      .prepare(
        `UPDATE site_snipes
         SET status = ?, last_result = ?, hold_reference = ?, hold_expires_at = ?,
             hold_unit_id = ?, payment_url = ?, last_error = NULL
         WHERE id = ?`
      )
      .run(
        SnipeStatus.HELD,
        SnipeResult.HELD,
        holdReference,
        expiresAt.toISOString(),
        holdUnitId ?? null,
        paymentUrl || null,
        id
      );
  }

  /**
   * The hold was placed: `setHeld` and deactivation in one transaction, so a restart never
   * sees an active snipe that already holds a unit.
   */
  markHeld(
    id: number,
    holdReference: string,
    expiresAt: Date,
    paymentUrl?: string,
    holdUnitId?: string
  ): void {
    this.db.transaction(() => {
      this.setHeld(id, holdReference, expiresAt, paymentUrl, holdUnitId);
      this.db.prepare('UPDATE site_snipes SET is_active = 0 WHERE id = ?').run(id);
    })();
  }

  /** Ends the snipe: a terminal status (EXPIRED, FAILED), its result and message, inactive. */
  finish(id: number, status: SnipeStatus, result: SnipeResult, error?: string): void {
    this.db
      .prepare(
        `UPDATE site_snipes SET status = ?, last_result = ?, last_error = ?, is_active = 0
         WHERE id = ?`
      )
      .run(status, result, error ?? null, id);
  }

  /** The release instant the scheduler arms for (a recomputed daily rollover). */
  setReleaseAt(id: number, releaseAt: Date): void {
    this.db
      .prepare('UPDATE site_snipes SET release_at = ? WHERE id = ?')
      .run(this.formatDate(releaseAt), id);
  }

  /**
   * Record that the booking was completed (payment confirmed by the user).
   */
  setBooked(id: number, reference: string): void {
    this.db
      .prepare(
        `UPDATE site_snipes
         SET status = ?, last_result = ?, booked_reference = ?, is_active = 0
         WHERE id = ?`
      )
      .run(SnipeStatus.BOOKED, SnipeResult.BOOKED, reference, id);
  }

  /**
   * Record the outcome of an attempt (and optional error message).
   */
  setResult(id: number, result: SnipeResult, error?: string): void {
    this.db
      .prepare('UPDATE site_snipes SET last_result = ?, last_error = ? WHERE id = ?')
      .run(result, error || null, id);
  }

  /**
   * Whether the snipe has reached its max attempts. maxAttempts === 0 means unlimited.
   */
  hasReachedMaxAttempts(id: number): boolean {
    const snipe = this.findById(id);
    if (!snipe) return true;
    if (snipe.maxAttempts <= 0) return false;
    return snipe.attemptsCount >= snipe.maxAttempts;
  }

  /**
   * How many of the provider's snipes are in one of `statuses`, active or not (a HELD snipe
   * is inactive). The account service asks it before a sign-out.
   */
  countByStatus(providerId: string, statuses: readonly SnipeStatus[]): number {
    if (statuses.length === 0) return 0;
    const placeholders = statuses.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM site_snipes WHERE provider_id = ? AND status IN (${placeholders})`
      )
      .get(providerId, ...statuses) as { n: number };
    return row.n;
  }

  protected mapRow(row: SiteSnipeRow): SiteSnipe {
    const where = `site_snipes ${row.id}`;
    return {
      id: row.id,
      userId: row.user_id,
      providerId: row.provider_id,
      locationKey: locationKeyOf(row.provider_id, row.location_external_id),
      location: {
        externalId: row.location_external_id,
        name: row.location_name ?? '',
        ...(row.area_name !== null ? { areaName: row.area_name } : {}),
      },
      name: row.name,
      stay: readStay(row),
      unitIds: readUnitIds(row.unit_ids, where),
      stayParams: readStayParams(row.stay_params, where),
      releaseMode: row.release_mode as SnipeReleaseMode,
      releaseAt: this.parseDate(row.release_at),
      accessGateEnabled: Boolean(row.access_gate_enabled),
      leadTimeSeconds: row.lead_time_seconds,
      pollIntervalMs: row.poll_interval_ms,
      windowDurationMs: row.window_duration_ms,
      status: row.status as SnipeStatus,
      isActive: Boolean(row.is_active),
      attemptsCount: row.attempts_count,
      maxAttempts: row.max_attempts,
      lastCheckedAt: this.parseDate(row.last_checked_at),
      nextCheckAt: this.parseDate(row.next_check_at),
      lastResult: (row.last_result as SnipeResult | null) || undefined,
      lastError: row.last_error || undefined,
      holdReference: row.hold_reference || undefined,
      holdExpiresAt: this.parseDate(row.hold_expires_at),
      holdUnitId: row.hold_unit_id || undefined,
      paymentUrl: row.payment_url || undefined,
      bookedReference: row.booked_reference || undefined,
      notes: row.notes || undefined,
      createdAt: this.parseDate(row.created_at)!,
      updatedAt: this.parseDate(row.updated_at)!,
    };
  }
}
