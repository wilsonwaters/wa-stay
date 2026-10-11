import { BaseRepository, readInstant } from './base.repository';
import { Notification, NotificationInput } from '@shared/types';
import { NotificationType, RelatedType } from '@shared/types/common.types';

const NOTIFICATION_TYPES: ReadonlySet<string> = new Set(Object.values(NotificationType));
const RELATED_TYPES: ReadonlySet<string> = new Set(Object.values(RelatedType));

export class NotificationRepository extends BaseRepository<Notification> {
  protected readonly tableName = 'notifications';

  /**
   * Create a new notification. The table has no CHECK constraints (since v7), so `type` and
   * `relatedType` are validated here. Reads do not validate: legacy rows (`stq_success`,
   * related type `stq`) stay readable.
   */
  create(input: NotificationInput): Notification {
    if (!NOTIFICATION_TYPES.has(input.type)) {
      throw new Error(`Unknown notification type: ${String(input.type)}`);
    }
    if (input.relatedType && !RELATED_TYPES.has(input.relatedType)) {
      throw new Error(`Unknown notification related type: ${String(input.relatedType)}`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO notifications (
        user_id, provider_id, type, title, message, related_id, related_type, action_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      input.userId,
      input.providerId ?? null,
      input.type,
      input.title,
      input.message,
      input.relatedId || null,
      input.relatedType || null,
      input.actionUrl || null
    );

    const notification = this.findById(result.lastInsertRowid as number);
    if (!notification) {
      throw new Error('Failed to create notification');
    }
    return notification;
  }

  /**
   * Find notifications by user ID
   */
  findByUserId(userId: number, limit?: number): Notification[] {
    const sql = limit
      ? `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC`;
    const stmt = this.db.prepare(sql);
    const rows = limit ? stmt.all(userId, limit) : stmt.all(userId);
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * Find unread notifications by user ID
   */
  findUnreadByUserId(userId: number): Notification[] {
    const stmt = this.db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ? AND is_read = 0
      ORDER BY created_at DESC
    `);
    const rows = stmt.all(userId);
    return rows.map((row) => this.mapRow(row));
  }

  /**
   * Get unread count
   */
  getUnreadCount(userId: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(userId) as { count: number };
    return row.count;
  }

  /**
   * Mark as read
   */
  markAsRead(id: number): void {
    const stmt = this.db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?');
    stmt.run(id);
  }

  /**
   * Mark all as read for user
   */
  markAllAsRead(userId: number): void {
    const stmt = this.db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?');
    stmt.run(userId);
  }

  /**
   * Deletes up to `limit` notifications created before `cutoff`, read or not, and returns how
   * many (their delivery logs go with them: ON DELETE CASCADE). `created_at` is compared as an
   * instant (`julianday`), so `CURRENT_TIMESTAMP` text and ISO strings both count; a value
   * SQLite cannot read is kept.
   */
  deleteCreatedBefore(cutoff: Date, limit: number): number {
    return this.db
      .prepare(
        `DELETE FROM notifications WHERE id IN (
           SELECT id FROM notifications WHERE julianday(created_at) < julianday(?) LIMIT ?
         )`
      )
      .run(cutoff.toISOString(), limit).changes;
  }

  /**
   * Delete all notifications for user
   */
  deleteAllForUser(userId: number): number {
    return this.db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userId).changes;
  }

  protected mapRow(row: any): Notification {
    return {
      id: row.id,
      userId: row.user_id,
      ...(row.provider_id ? { providerId: row.provider_id } : {}),
      type: row.type as NotificationType,
      title: row.title,
      message: row.message,
      relatedId: row.related_id,
      relatedType: row.related_type as RelatedType | undefined,
      actionUrl: row.action_url,
      isRead: Boolean(row.is_read),
      // `DEFAULT CURRENT_TIMESTAMP`: UTC with no zone, so "5 min ago" is right in Perth too
      createdAt: readInstant(row.created_at) ?? new Date(0),
    };
  }
}
