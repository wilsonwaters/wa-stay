/**
 * Settings Repository
 * Handles CRUD operations for application settings
 */

import { BaseRepository, readInstant } from './base.repository';
import { Setting, SettingValueType, SettingCategory } from '@shared/types';
import { logger } from '../../utils/logger';

interface SettingRow {
  key: string;
  value: string;
  value_type: string;
  category: string;
  description: string | null;
  updated_at: string;
}

export class SettingsRepository extends BaseRepository<Setting, string> {
  protected readonly tableName = 'settings';
  protected readonly idColumn = 'key';

  /**
   * Map database row to Setting model
   */
  protected mapRow(row: SettingRow): Setting {
    return {
      key: row.key,
      value: row.value,
      valueType: row.value_type as SettingValueType,
      category: row.category as SettingCategory,
      description: row.description || undefined,
      updatedAt: readInstant(row.updated_at) ?? new Date(0),
    };
  }

  /**
   * Get setting by key
   */
  get(key: string): Setting | null {
    try {
      const row = this.db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
      return row ? this.mapRow(row as SettingRow) : null;
    } catch (error) {
      logger.error(`Error getting setting ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get typed value by key
   */
  getValue<T = any>(key: string): T | null {
    const setting = this.get(key);
    if (!setting) return null;

    switch (setting.valueType) {
      case SettingValueType.BOOLEAN:
        return (setting.value === 'true') as T;
      case SettingValueType.NUMBER:
        return Number(setting.value) as T;
      case SettingValueType.JSON:
        return JSON.parse(setting.value) as T;
      case SettingValueType.STRING:
      default:
        return setting.value as T;
    }
  }

  /**
   * Set setting value
   */
  set(key: string, value: any, valueType: SettingValueType, category: SettingCategory): Setting {
    try {
      let stringValue: string;

      switch (valueType) {
        case SettingValueType.BOOLEAN:
          stringValue = value ? 'true' : 'false';
          break;
        case SettingValueType.NUMBER:
          stringValue = String(value);
          break;
        case SettingValueType.JSON:
          stringValue = JSON.stringify(value);
          break;
        case SettingValueType.STRING:
        default:
          stringValue = String(value);
      }

      const stmt = this.db.prepare(`
        INSERT INTO settings (key, value, value_type, category)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          value_type = excluded.value_type,
          category = excluded.category
      `);

      stmt.run(key, stringValue, valueType, category);

      const setting = this.get(key);
      if (!setting) throw new Error('Failed to set setting');

      logger.debug(`Setting updated: ${key} = ${stringValue}`);
      return setting;
    } catch (error) {
      logger.error(`Error setting ${key}:`, error);
      throw error;
    }
  }

  /**
   * Get all settings by category
   */
  getByCategory(category: SettingCategory): Setting[] {
    try {
      const rows = this.db.prepare('SELECT * FROM settings WHERE category = ?').all(category);
      return rows.map((row) => this.mapRow(row as SettingRow));
    } catch (error) {
      logger.error(`Error getting settings by category ${category}:`, error);
      throw error;
    }
  }

  /**
   * Get all settings as object
   */
  getAllAsObject(): Record<string, any> {
    try {
      const settings = this.findAll();
      const result: Record<string, any> = {};

      for (const setting of settings) {
        result[setting.key] = this.parseValue(setting.value, setting.valueType);
      }

      return result;
    } catch (error) {
      logger.error('Error getting all settings as object:', error);
      throw error;
    }
  }

  /**
   * Parse value based on type
   */
  private parseValue(value: string, type: SettingValueType): any {
    switch (type) {
      case SettingValueType.BOOLEAN:
        return value === 'true';
      case SettingValueType.NUMBER:
        return Number(value);
      case SettingValueType.JSON:
        return JSON.parse(value);
      case SettingValueType.STRING:
      default:
        return value;
    }
  }

  /**
   * Delete setting
   */
  delete(key: string): boolean {
    try {
      const result = this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      logger.info(`Setting deleted: ${key}`);
      return result.changes > 0;
    } catch (error) {
      logger.error(`Error deleting setting ${key}:`, error);
      throw error;
    }
  }

  /**
   * Reset settings to defaults
   */
  resetToDefaults(): void {
    try {
      // This would typically be handled by re-running the seed
      this.db.prepare('DELETE FROM settings').run();
      logger.info('All settings deleted (ready for re-seed)');
    } catch (error) {
      logger.error('Error resetting settings:', error);
      throw error;
    }
  }
}
