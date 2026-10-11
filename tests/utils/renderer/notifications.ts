/**
 * An in-memory `notifications` namespace for renderer tests: the list, the unread count and the
 * actions all work on one array, as main's repository does, so a test sees what the app would
 * (an optimistic change that main confirms, or one it refuses).
 *
 *   const backend = notificationsBackend([notification({ id: 12, relatedId: 12 })]);
 *   renderWithApp({ api: { notifications: backend.stubs } });
 *   backend.add(notification({ id: 13 }));   // then emit notification:created
 */
import { NotificationType, RelatedType } from '../../../src/shared/types/common.types';
import type { Notification } from '../../../src/shared/types/notification.types';
import { fail, ok } from './createMockApi';

let nextId = 1000;

/** A ParkStay watch notification, unread, five minutes old; override what the test needs. */
export function notification(overrides: Partial<Notification> = {}): Notification {
  const id = overrides.id ?? nextId++;
  return {
    id,
    userId: 1,
    providerId: 'parkstay',
    type: NotificationType.WATCH_FOUND,
    title: `Sites available at Camp ${id}`,
    message: '2 sites are free for your dates.',
    relatedType: RelatedType.WATCH,
    relatedId: id,
    actionUrl: `/watches/${id}`,
    isRead: false,
    createdAt: new Date(Date.now() - 5 * 60_000),
    ...overrides,
  };
}

export function notificationsBackend(initial: Notification[] = []) {
  let items = [...initial];
  const unread = () => items.filter((n) => !n.isRead).length;
  const stubs = {
    list: jest.fn(async (limit?: number) => ok(items.slice(0, limit ?? items.length))),
    unreadCount: jest.fn(async () => ok(unread())),
    markRead: jest.fn(async (id: number) => {
      items = items.map((n) => (n.id === id ? { ...n, isRead: true } : n));
      return ok(undefined);
    }),
    markAllRead: jest.fn(async () => {
      items = items.map((n) => ({ ...n, isRead: true }));
      return ok(undefined);
    }),
    delete: jest.fn(async (id: number) => {
      const before = items.length;
      items = items.filter((n) => n.id !== id);
      return items.length < before ? ok(true) : fail('Notification not found', 'NOT_FOUND');
    }),
    clearAll: jest.fn(async () => {
      const count = items.length;
      items = [];
      return ok(count);
    }),
  };
  return {
    stubs,
    /** Main stored a new notification (newest first). Emit `notification:created` after. */
    add(next: Notification) {
      items = [next, ...items];
      return next;
    },
    get items() {
      return items;
    },
  };
}
