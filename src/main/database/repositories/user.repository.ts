/**
 * User Repository: the local profile (architecture-notes §12.21). One `users` row owns every
 * watch, snipe, booking and notification, and nothing may delete it (§12.22).
 *
 * The row holds the profile only: email (a hint, never a sign-in), names and phone. Sign-in
 * lives with each provider (`provider_accounts` and the provider's session partition);
 * migration v9 dropped the v1.x ParkStay password columns (§12.32).
 */

import { BaseRepository, readInstant } from './base.repository';
import { User, UserInput } from '@shared/types';
import { logger } from '../../utils/logger';

interface UserRow {
  id: number;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
}

export class UserRepository extends BaseRepository<User> {
  protected readonly tableName = 'users';

  /** A NULL email (a profile that never had one) reads as ''. */
  protected mapRow(row: UserRow): User {
    return {
      id: row.id,
      email: row.email ?? '',
      firstName: row.first_name || undefined,
      lastName: row.last_name || undefined,
      phone: row.phone || undefined,
      createdAt: readInstant(row.created_at) ?? new Date(0),
      updatedAt: readInstant(row.updated_at) ?? new Date(0),
    };
  }

  /**
   * Creates the single local profile (id 1) when the table is empty. A no-op when any row
   * exists. Returns the local profile.
   */
  createLocalProfileIfMissing(): User {
    this.db.prepare(`INSERT INTO users (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM users)`).run();
    const profile = this.getFirstUser();
    if (!profile) throw new Error('Failed to create the local profile');
    return profile;
  }

  /**
   * Update user profile
   */
  updateProfile(id: number, data: Partial<UserInput>): User | null {
    try {
      const updates: string[] = [];
      const values: any[] = [];

      if (data.firstName !== undefined) {
        updates.push('first_name = ?');
        values.push(data.firstName);
      }
      if (data.lastName !== undefined) {
        updates.push('last_name = ?');
        values.push(data.lastName);
      }
      if (data.phone !== undefined) {
        updates.push('phone = ?');
        values.push(data.phone);
      }

      if (updates.length === 0) {
        return this.findById(id);
      }

      values.push(id);

      const stmt = this.db.prepare(`
        UPDATE users SET ${updates.join(', ')} WHERE id = ?
      `);

      stmt.run(...values);

      logger.info(`User profile updated: ID ${id}`);
      return this.findById(id);
    } catch (error) {
      logger.error(`Error updating user profile for ID ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get the first user (single-user application)
   */
  getFirstUser(): User | null {
    try {
      const row = this.db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();
      return row ? this.mapRow(row as UserRow) : null;
    } catch (error) {
      logger.error('Error getting first user:', error);
      throw error;
    }
  }

  /**
   * Check if any user exists
   */
  hasUsers(): boolean {
    try {
      const result = this.db.prepare('SELECT COUNT(*) as count FROM users').get() as {
        count: number;
      };
      return result.count > 0;
    } catch (error) {
      logger.error('Error checking if users exist:', error);
      throw error;
    }
  }
}
