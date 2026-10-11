/**
 * `updater`: auto-update through GitHub Releases. Progress arrives as `updater:*` events.
 */

import { z } from 'zod';
import { CHANNELS } from './channels';
import type { Namespace } from './define';

export interface UpdateStatus {
  state:
    'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  releaseNotes?: string;
  percent?: number;
  error?: string;
}

const C = CHANNELS.updater;

export const updater = {
  /** `null` when the check could not run. */
  checkForUpdates: {
    channel: C.checkForUpdates,
    request: z.void(),
    args: {} as [],
    response: {} as { version?: string } | null,
  },
  downloadUpdate: {
    channel: C.downloadUpdate,
    request: z.void(),
    args: {} as [],
    response: {} as boolean,
  },
  installUpdate: {
    channel: C.installUpdate,
    request: z.void(),
    args: {} as [],
    response: {} as boolean,
  },
  getStatus: {
    channel: C.getStatus,
    request: z.void(),
    args: {} as [],
    response: {} as UpdateStatus,
  },
} satisfies Namespace;
