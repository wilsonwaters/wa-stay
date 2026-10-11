/**
 * `updater` handlers. Progress is pushed as `updater:*` events by `AutoUpdaterService`.
 */

import { contract } from '@shared/contracts';
import type { AppContainer } from '../../app/container';
import type { Handle } from '../handle';

export function registerUpdaterHandlers(handle: Handle, c: AppContainer): void {
  const { updater } = contract;
  const service = c.autoUpdater;

  handle(updater.checkForUpdates, async () => {
    const result = await service.checkForUpdates();
    return result ? { version: result.updateInfo?.version } : null;
  });

  handle(updater.downloadUpdate, async () => {
    await service.downloadUpdate();
    return true;
  });

  handle(updater.installUpdate, () => {
    service.quitAndInstall();
    return true;
  });

  handle(updater.getStatus, () => service.getStatus());
}
