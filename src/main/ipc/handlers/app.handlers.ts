/**
 * `app` handlers: about info, the logs folder and launch at login. Launch at login is the
 * only writer of `launchOnStartup` and `app.startMinimised`, so they always match the OS entry.
 */

import { app, shell } from 'electron';
import fs from 'fs';
import os from 'os';
import { contract, SETTING_KEYS, type LaunchAtLogin } from '@shared/contracts';
import type { AppContainer } from '../../app/container';
import { launchAtLoginSupported, setLaunchAtLogin } from '../../app/login-item';
import { AppError } from '../../utils/app-error';
import { readSetting } from '../../app/settings-values';
import { logger } from '../../utils/logger';
import type { Handle } from '../handle';

export function registerAppHandlers(handle: Handle, c: AppContainer): void {
  const api = contract.app;
  const settings = c.repositories.settings;

  handle(api.getInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electronVersion: process.versions.electron || '',
    chromeVersion: process.versions.chrome || '',
    nodeVersion: process.versions.node || '',
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    userDataPath: app.getPath('userData'),
    logsPath: c.logsDir,
    secretStorage: c.vault.status(),
  }));

  // The folder the log files are written to; created first, in case logging could not create it
  handle(api.openLogsFolder, async () => {
    fs.mkdirSync(c.logsDir, { recursive: true });
    const error = await shell.openPath(c.logsDir);
    if (error) throw new Error(`Could not open the logs folder: ${error}`);
    return true;
  });

  // `setLoginItemSettings` acts on Windows and macOS only: elsewhere nothing is stored as on
  const supported = () => launchAtLoginSupported(process.platform);
  const readLaunchAtLogin = (): LaunchAtLogin => ({
    enabled: supported() && readSetting(settings, 'launchOnStartup'),
    startMinimised: readSetting(settings, 'app.startMinimised'),
    supported: supported(),
  });

  handle(api.setAutoLaunch, ({ enabled, startMinimised: requested }) => {
    if (enabled && !supported()) {
      throw new AppError(
        'VALIDATION',
        'Starting at sign-in is available on Windows and macOS only.'
      );
    }
    // In dev mode, process.execPath points to node_modules/electron/dist/electron.exe,
    // which when launched at login has no app context and shows Electron's generic
    // welcome window. Refuse to register — auto-launch only makes sense for packaged builds.
    if (enabled && !app.isPackaged) {
      logger.warn('Auto-launch refused: only available in packaged builds, not in dev mode');
      throw new Error(
        'Starting at sign-in is only available in the installed app, not when running from source.'
      );
    }

    const startMinimised = requested ?? readLaunchAtLogin().startMinimised;
    setLaunchAtLogin({ enabled, startMinimised });

    for (const [key, value] of [
      ['launchOnStartup', enabled],
      ['app.startMinimised', startMinimised],
    ] as const) {
      const { valueType, category } = SETTING_KEYS[key];
      settings.set(key, value, valueType, category);
    }

    logger.info(
      `Auto-launch ${enabled ? 'enabled' : 'disabled'}${enabled && startMinimised ? ', minimised' : ''}`
    );
    return { enabled, startMinimised, supported: supported() };
  });

  handle(api.getAutoLaunch, readLaunchAtLogin);
}
