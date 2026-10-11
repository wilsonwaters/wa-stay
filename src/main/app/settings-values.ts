/**
 * Reading typed settings (`SETTING_KEYS`, architecture-notes §12.7) in main: the stored value,
 * or the key's default while nothing is stored.
 */

import { settingDefault, type SettingKey, type SettingValue } from '@shared/contracts/settings';
import type { SettingsRepository } from '../database/repositories';

export function readSetting<K extends SettingKey>(
  settings: Pick<SettingsRepository, 'getValue'>,
  key: K
): SettingValue<K> {
  return settings.getValue<SettingValue<K>>(key) ?? settingDefault(key);
}
