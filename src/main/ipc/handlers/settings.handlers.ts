/**
 * `settings` handlers. Keys come from the typed registry (`SETTING_KEYS`, architecture-notes
 * §12.7); main stores each under the registry's `valueType` and `category`, never values the
 * renderer sends. `settings.set` takes only renderer-writable keys (the request schema refuses
 * the rest). The values are read where they are used (`NotificationService` reads its
 * preferences on every notification), so a change needs nothing applied here.
 */

import { contract, SETTING_KEYS } from '@shared/contracts';
import type { AppContainer } from '../../app/container';
import { readSetting } from '../../app/settings-values';
import type { Handle } from '../handle';

export function registerSettingsHandlers(handle: Handle, c: AppContainer): void {
  const { settings } = contract;
  const repository = c.repositories.settings;

  // A key with nothing stored answers its default
  handle(settings.get, ({ key }) => readSetting(repository, key));

  handle(settings.set, ({ key, value }) => {
    const { valueType, category } = SETTING_KEYS[key];
    repository.set(key, value, valueType, category);
    return true;
  });

  handle(settings.getAll, () => repository.getAllAsObject());
}
