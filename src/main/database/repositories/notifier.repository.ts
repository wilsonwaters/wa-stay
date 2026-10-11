/**
 * Notifier Repository
 * Handles CRUD operations for notifiers (the `notifiers` table). Each config is stored as a
 * SecretVault envelope of its JSON. A config that cannot be decrypted reads with
 * `secretState: 'unreadable'`, `status: 'error'` and an empty `config`, and stays stored
 * unchanged until the user saves new settings.
 */

import Database from 'better-sqlite3';
import { BaseRepository, readInstant } from './base.repository';
import {
  Notifier,
  NotifierInput,
  NotifierChannel,
  NotifierStatus,
  NotificationDeliveryLog,
  NotificationDeliveryLogInput,
  NOTIFIER_SECRET_UNREADABLE,
  type SecretState,
} from '@shared/types';
import type { SecretVault } from '../../security/secret-vault';
import { logger } from '../../utils/logger';

interface NotifierRow {
  id: number;
  channel: string;
  display_name: string;
  enabled: number;
  config: string;
  status: string;
  last_tested_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface DeliveryLogRow {
  id: number;
  notification_id: number | null;
  notifier_channel: string;
  status: string;
  message_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

export class NotifierRepository extends BaseRepository<Notifier> {
  protected readonly tableName = 'notifiers';

  constructor(
    db: Database.Database,
    private readonly vault: SecretVault
  ) {
    super(db);
  }

  /**
   * Map database row to Notifier model. The config is decrypted; a `local` envelope is
   * re-encrypted to `os` when that is available.
   */
  protected mapRow(row: NotifierRow): Notifier {
    const secret = this.vault.read(row.config, (envelope) => {
      this.db
        .prepare('UPDATE notifiers SET config = ? WHERE id = ? AND config = ?')
        .run(envelope, row.id, row.config);
    });

    let config: Record<string, unknown> = {};
    let secretState: SecretState = secret.state;
    if (secret.state === 'ok') {
      try {
        config = JSON.parse(secret.value);
      } catch {
        secretState = 'unreadable';
      }
    }
    const unreadable = secretState === 'unreadable';

    return {
      id: row.id,
      channel: row.channel as NotifierChannel,
      displayName: row.display_name,
      enabled: row.enabled === 1,
      config,
      secretState,
      status: unreadable ? NotifierStatus.ERROR : (row.status as NotifierStatus),
      lastTestedAt: readInstant(row.last_tested_at),
      lastError: unreadable ? NOTIFIER_SECRET_UNREADABLE : row.last_error || undefined,
      createdAt: readInstant(row.created_at) ?? new Date(0),
      updatedAt: readInstant(row.updated_at) ?? new Date(0),
    };
  }

  /**
   * Create or update a notifier
   */
  upsert(input: NotifierInput): Notifier {
    try {
      const existing = this.findByChannel(input.channel);

      if (existing) {
        // Update existing notifier
        return this.updateNotifier(existing.id, input);
      }

      // Create new notifier
      const encryptedConfig = this.vault.encrypt(JSON.stringify(input.config));

      const stmt = this.db.prepare(`
        INSERT INTO notifiers (
          channel, display_name, enabled, config, status
        )
        VALUES (?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        input.channel,
        input.displayName,
        input.enabled ? 1 : 0,
        encryptedConfig,
        NotifierStatus.CONFIGURED
      );

      const notifier = this.findById(result.lastInsertRowid as number);
      if (!notifier) throw new Error('Failed to create notifier');

      logger.info(`Notifier created: ${input.channel}`);
      return notifier;
    } catch (error) {
      logger.error('Error creating notifier:', error);
      throw error;
    }
  }

  /**
   * Update a notifier
   */
  updateNotifier(id: number, input: Partial<NotifierInput>): Notifier {
    try {
      const updates: string[] = [];
      const values: any[] = [];

      if (input.displayName !== undefined) {
        updates.push('display_name = ?');
        values.push(input.displayName);
      }

      if (input.enabled !== undefined) {
        updates.push('enabled = ?');
        values.push(input.enabled ? 1 : 0);
      }

      if (input.config !== undefined) {
        updates.push('config = ?');
        values.push(this.vault.encrypt(JSON.stringify(input.config)));
        updates.push('status = ?');
        values.push(NotifierStatus.CONFIGURED);
      }

      if (updates.length === 0) {
        const existing = this.findById(id);
        if (!existing) throw new Error('Notifier not found');
        return existing;
      }

      values.push(id);

      const stmt = this.db.prepare(`
        UPDATE notifiers
        SET ${updates.join(', ')}
        WHERE id = ?
      `);

      stmt.run(...values);

      const notifier = this.findById(id);
      if (!notifier) throw new Error('Failed to update notifier');

      logger.info(`Notifier updated: ID ${id}`);
      return notifier;
    } catch (error) {
      logger.error('Error updating notifier:', error);
      throw error;
    }
  }

  /**
   * Find notifier by channel
   */
  findByChannel(channel: NotifierChannel): Notifier | null {
    try {
      const row = this.db.prepare('SELECT * FROM notifiers WHERE channel = ?').get(channel);
      return row ? this.mapRow(row as NotifierRow) : null;
    } catch (error) {
      logger.error(`Error finding notifier by channel ${channel}:`, error);
      throw error;
    }
  }

  /**
   * Find all enabled notifiers
   */
  findEnabled(): Notifier[] {
    try {
      const rows = this.db
        .prepare('SELECT * FROM notifiers WHERE enabled = 1')
        .all() as NotifierRow[];
      return rows.map((row) => this.mapRow(row));
    } catch (error) {
      logger.error('Error finding enabled notifiers:', error);
      throw error;
    }
  }

  /**
   * Enable a notifier
   */
  enable(channel: NotifierChannel): boolean {
    try {
      const result = this.db
        .prepare('UPDATE notifiers SET enabled = 1 WHERE channel = ?')
        .run(channel);
      return result.changes > 0;
    } catch (error) {
      logger.error(`Error enabling notifier ${channel}:`, error);
      throw error;
    }
  }

  /**
   * Disable a notifier
   */
  disable(channel: NotifierChannel): boolean {
    try {
      const result = this.db
        .prepare('UPDATE notifiers SET enabled = 0 WHERE channel = ?')
        .run(channel);
      return result.changes > 0;
    } catch (error) {
      logger.error(`Error disabling notifier ${channel}:`, error);
      throw error;
    }
  }

  /**
   * Update notifier status
   */
  updateStatus(channel: NotifierChannel, status: NotifierStatus, error?: string): void {
    try {
      this.db
        .prepare(
          `
          UPDATE notifiers
          SET status = ?, last_error = ?
          WHERE channel = ?
        `
        )
        .run(status, error || null, channel);
    } catch (err) {
      logger.error(`Error updating notifier status ${channel}:`, err);
      throw err;
    }
  }

  /**
   * Update last tested timestamp
   */
  updateLastTested(channel: NotifierChannel, success: boolean, error?: string): void {
    try {
      this.db
        .prepare(
          `
          UPDATE notifiers
          SET last_tested_at = CURRENT_TIMESTAMP,
              status = ?,
              last_error = ?
          WHERE channel = ?
        `
        )
        .run(success ? NotifierStatus.CONFIGURED : NotifierStatus.ERROR, error || null, channel);
    } catch (err) {
      logger.error(`Error updating last tested for ${channel}:`, err);
      throw err;
    }
  }

  /**
   * Log a notification delivery
   */
  logDelivery(input: NotificationDeliveryLogInput): NotificationDeliveryLog {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO notification_delivery_logs (
          notification_id, notifier_channel, status, message_id, error_message, sent_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        input.notificationId || null,
        input.notifierChannel,
        input.status,
        input.messageId || null,
        input.errorMessage || null,
        input.sentAt?.toISOString() || null
      );

      return this.getDeliveryLog(result.lastInsertRowid as number)!;
    } catch (error) {
      logger.error('Error logging notification delivery:', error);
      throw error;
    }
  }

  /**
   * Get delivery log by ID
   */
  getDeliveryLog(id: number): NotificationDeliveryLog | null {
    try {
      const row = this.db
        .prepare('SELECT * FROM notification_delivery_logs WHERE id = ?')
        .get(id) as DeliveryLogRow | undefined;

      if (!row) return null;

      return {
        id: row.id,
        notificationId: row.notification_id || undefined,
        notifierChannel: row.notifier_channel as NotifierChannel,
        status: row.status as 'sent' | 'failed' | 'pending',
        messageId: row.message_id || undefined,
        errorMessage: row.error_message || undefined,
        sentAt: readInstant(row.sent_at),
        createdAt: readInstant(row.created_at) ?? new Date(0),
      };
    } catch (error) {
      logger.error('Error getting delivery log:', error);
      throw error;
    }
  }

  /**
   * Get delivery logs for a notification
   */
  getDeliveryLogsForNotification(notificationId: number): NotificationDeliveryLog[] {
    try {
      const rows = this.db
        .prepare('SELECT * FROM notification_delivery_logs WHERE notification_id = ?')
        .all(notificationId) as DeliveryLogRow[];

      return rows.map((row) => ({
        id: row.id,
        notificationId: row.notification_id || undefined,
        notifierChannel: row.notifier_channel as NotifierChannel,
        status: row.status as 'sent' | 'failed' | 'pending',
        messageId: row.message_id || undefined,
        errorMessage: row.error_message || undefined,
        sentAt: readInstant(row.sent_at),
        createdAt: readInstant(row.created_at) ?? new Date(0),
      }));
    } catch (error) {
      logger.error('Error getting delivery logs for notification:', error);
      throw error;
    }
  }

  /**
   * Deletes up to `limit` delivery logs created before `cutoff` and returns how many.
   * `created_at` is compared as an instant (`julianday`), whatever its text format.
   */
  deleteDeliveryLogsCreatedBefore(cutoff: Date, limit: number): number {
    return this.db
      .prepare(
        `DELETE FROM notification_delivery_logs WHERE id IN (
           SELECT id FROM notification_delivery_logs
           WHERE julianday(created_at) < julianday(?) LIMIT ?
         )`
      )
      .run(cutoff.toISOString(), limit).changes;
  }
}
