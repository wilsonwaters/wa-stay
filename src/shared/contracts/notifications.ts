/**
 * `notifications`: in-app notifications of the local profile.
 */

import { z } from 'zod';
import type { Notification } from '../types/notification.types';
import { CHANNELS } from './channels';
import { idPayload, Namespace } from './define';

const C = CHANNELS.notifications;

export const notifications = {
  /** Newest first. Without `limit`, every notification. */
  list: {
    channel: C.list,
    request: z.object({ limit: z.number().int().positive().optional() }),
    args: {} as [limit?: number],
    response: {} as Notification[],
  },
  markRead: {
    channel: C.markRead,
    request: idPayload,
    args: {} as [id: number],
    response: undefined as void,
  },
  /** Marks every notification read. */
  markAllRead: {
    channel: C.markAllRead,
    request: z.void(),
    args: {} as [],
    response: undefined as void,
  },
  /** How many notifications are unread: all of them, not only those `list` returned. */
  unreadCount: {
    channel: C.unreadCount,
    request: z.void(),
    args: {} as [],
    response: {} as number,
  },
  delete: {
    channel: C.delete,
    request: idPayload,
    args: {} as [id: number],
    response: {} as boolean,
  },
  /** Deletes every notification. Resolves to the number deleted. */
  clearAll: { channel: C.clearAll, request: z.void(), args: {} as [], response: {} as number },
} satisfies Namespace;
