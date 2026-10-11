/**
 * Auto-Updater Service
 * Manages application updates via electron-updater and GitHub Releases
 */

import { autoUpdater, UpdateCheckResult, UpdateInfo, ProgressInfo } from 'electron-updater';
import type { EventSink } from '@shared/contracts/events';
import type { UpdateStatus } from '@shared/contracts/updater';
import { AppError } from '../../utils/app-error';
import { logger } from '../../utils/logger';

export type { UpdateStatus };

/** What the update card says when a download fails (the updater's own message is logged). */
export const DOWNLOAD_FAILED_MESSAGE =
  "The update didn't download. Check your internet connection and try again.";

export class AutoUpdaterService {
  private status: UpdateStatus = { state: 'idle' };
  /**
   * Whether the person started a download. Only a failed download reaches the update card: a
   * failed check (offline at start, or no release feed) is logged, and Settings → About reports
   * the check the person asked for.
   */
  private downloading = false;

  /** `events` delivers `updater:*` events to trusted renderers only. */
  constructor(private readonly events: EventSink) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    this.setupListeners();
  }

  private setupListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      this.status = { state: 'checking' };
      logger.info('Checking for updates...');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.status = {
        state: 'available',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      };
      logger.info(`Update available: v${info.version}`);
      this.events.emit('updater:available', {
        version: info.version,
        releaseNotes: this.status.releaseNotes,
      });
    });

    autoUpdater.on('update-not-available', (_info: UpdateInfo) => {
      this.status = { state: 'not-available' };
      logger.info('No updates available');
      this.events.emit('updater:not-available', null);
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.status = {
        ...this.status,
        state: 'downloading',
        percent: progress.percent,
      };
      this.events.emit('updater:progress', {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.status = {
        state: 'downloaded',
        version: info.version,
      };
      logger.info(`Update downloaded: v${info.version}`);
      this.events.emit('updater:downloaded', {
        version: info.version,
      });
    });

    autoUpdater.on('error', (error: Error) => {
      this.status = {
        state: 'error',
        error: error.message,
      };
      logger.error('Auto-updater error:', error);
      if (!this.downloading) return;
      this.downloading = false;
      this.events.emit('updater:error', { error: DOWNLOAD_FAILED_MESSAGE });
    });
  }

  async checkForUpdates(): Promise<UpdateCheckResult | null> {
    try {
      return await autoUpdater.checkForUpdates();
    } catch (error: any) {
      logger.error('Failed to check for updates:', error);
      return null;
    }
  }

  /** Downloads the update the person accepted; a failure rejects with the card's message. */
  async downloadUpdate(): Promise<void> {
    this.downloading = true;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      logger.error('Update download failed:', error);
      throw new AppError('INTERNAL', DOWNLOAD_FAILED_MESSAGE);
    } finally {
      this.downloading = false;
    }
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall();
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  /**
   * Check for updates after a delay (called on startup)
   */
  scheduleUpdateCheck(delayMs = 15000): void {
    setTimeout(async () => {
      try {
        await this.checkForUpdates();
      } catch (error) {
        logger.error('Scheduled update check failed:', error);
      }
    }, delayMs);
  }
}
