import { useMutation } from '@tanstack/react-query';
import type { UpdateStatus } from '../../shared/contracts';
import { ApiError, unwrap } from './client';

/**
 * Starts downloading the update main found. Progress, the finished download and errors arrive
 * as `updater:*` events.
 */
export function useDownloadUpdate() {
  return useMutation({ mutationFn: () => unwrap((api) => api.updater.downloadUpdate()) });
}

/** Quits WA Stay and installs the downloaded update. */
export function useInstallUpdate() {
  return useMutation({ mutationFn: () => unwrap((api) => api.updater.installUpdate()) });
}

/** What a check found: the updater's status after it, and the newest release's version. */
export interface UpdateCheckOutcome {
  status: UpdateStatus;
  /** The newest release's version (possibly the one running). */
  latest?: string;
}

/**
 * Asks GitHub for a newer WA Stay (`updater.checkForUpdates`), then reads the updater's status,
 * which the check has just set. A check that could not run (offline, or a build that is not
 * installed) rejects. Downloading stays with the update card in the tray.
 */
export function useCheckForUpdates() {
  return useMutation({
    mutationFn: async (): Promise<UpdateCheckOutcome> => {
      const found = await unwrap((api) => api.updater.checkForUpdates());
      if (found === null) throw new ApiError("Couldn't check for updates");
      const status = await unwrap((api) => api.updater.getStatus());
      return { status, latest: found.version };
    },
  });
}
