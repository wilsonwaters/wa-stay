/**
 * `app`: application info, the logs folder and launch at login.
 *
 * Launch at login is an OS entry, so main writes its two settings (`launchOnStartup`,
 * `app.startMinimised`) only here, together with the entry; `settings.set` refuses them.
 */

import { z } from 'zod';
import type { SecretStorageBackend } from '../types/secret.types';
import { assertTypeEquals } from '../utils/type-equality';
import { CHANNELS } from './channels';
import type { Namespace } from './define';

export interface AppInfo {
  name: string;
  version: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  os: string;
  arch: string;
  userDataPath: string;
  logsPath: string;
  /** Where stored secrets are encrypted: `local` means OS encryption is unavailable (weaker). */
  secretStorage: { backend: SecretStorageBackend };
}

/** Launch at login, and whether a login launch opens minimised (`--hidden`). */
export interface LaunchAtLogin {
  enabled: boolean;
  startMinimised: boolean;
  /** False where the OS cannot start WA Stay at sign-in (Linux): the switch is unavailable. */
  supported: boolean;
}

/** The `app.setAutoLaunch` payload. An omitted `startMinimised` keeps the stored choice. */
export interface SetAutoLaunchRequest {
  enabled: boolean;
  startMinimised?: boolean;
}

const setAutoLaunchRequest = z.object({
  enabled: z.boolean(),
  startMinimised: z.boolean().optional(),
});
assertTypeEquals<z.input<typeof setAutoLaunchRequest>, SetAutoLaunchRequest>(true);
assertTypeEquals<z.output<typeof setAutoLaunchRequest>, SetAutoLaunchRequest>(true);

const C = CHANNELS.app;

export const app = {
  getInfo: { channel: C.getInfo, request: z.void(), args: {} as [], response: {} as AppInfo },
  openLogsFolder: {
    channel: C.openLogsFolder,
    request: z.void(),
    args: {} as [],
    response: {} as boolean,
  },
  /** Registers or removes the login item (refused when running from source) and stores it. */
  setAutoLaunch: {
    channel: C.setAutoLaunch,
    request: setAutoLaunchRequest,
    args: {} as [enabled: boolean, startMinimised?: boolean],
    response: {} as LaunchAtLogin,
  },
  getAutoLaunch: {
    channel: C.getAutoLaunch,
    request: z.void(),
    args: {} as [],
    response: {} as LaunchAtLogin,
  },
} satisfies Namespace;
