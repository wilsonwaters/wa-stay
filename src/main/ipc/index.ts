/**
 * IPC registration. Every handler is registered through one `handle()` (see `handle.ts`),
 * one handler file per contract namespace, all built from the composition root.
 */

import type { AppContainer } from '../app/container';
import { createHandle, IpcMainLike, SenderGuard } from './handle';
import { registerAccountsHandlers } from './handlers/accounts.handlers';
import { registerAppHandlers } from './handlers/app.handlers';
import { registerBookingsHandlers } from './handlers/bookings.handlers';
import { registerCatalogHandlers } from './handlers/catalog.handlers';
import { registerNotificationsHandlers } from './handlers/notifications.handlers';
import { registerNotifiersHandlers } from './handlers/notifiers.handlers';
import { registerProvidersHandlers } from './handlers/providers.handlers';
import { registerSettingsHandlers } from './handlers/settings.handlers';
import { registerSnipesHandlers } from './handlers/snipes.handlers';
import { registerUpdaterHandlers } from './handlers/updater.handlers';
import { registerWatchesHandlers } from './handlers/watches.handlers';
import { logger } from '../utils/logger';

export interface IpcRegistrationOptions {
  /** Sender check for every invoke (`createSenderGuard`). */
  isTrustedSender: SenderGuard;
  /** Defaults to Electron's `ipcMain`. */
  ipc?: IpcMainLike;
}

export function registerIpcHandlers(
  container: AppContainer,
  { isTrustedSender, ipc }: IpcRegistrationOptions
): void {
  const handle = createHandle({ isTrustedSender, ipc });

  registerBookingsHandlers(handle, container);
  registerWatchesHandlers(handle, container);
  registerSnipesHandlers(handle, container);
  registerNotificationsHandlers(handle, container);
  registerNotifiersHandlers(handle, container);
  registerSettingsHandlers(handle, container);
  registerAppHandlers(handle, container);
  registerUpdaterHandlers(handle, container);
  registerProvidersHandlers(handle, container);
  registerCatalogHandlers(handle, container);
  registerAccountsHandlers(handle, container);

  logger.info('IPC handlers registered');
}
