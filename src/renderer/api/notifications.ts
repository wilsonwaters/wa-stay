import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Notification } from '../../shared/types/notification.types';
import { unwrap } from './client';
import { useInvalidateOn } from './events';
import { queryKeys } from './queryKeys';

/** The notification list shows the newest this many. The unread count covers every one. */
export const NOTIFICATION_LIST_LIMIT = 20;

const listKey = () => queryKeys.notifications.list(NOTIFICATION_LIST_LIMIT);
const countKey = () => queryKeys.notifications.unreadCount();

/** The newest notifications, for the bell's list. Load it while the list is open. */
export function useNotifications(options: { enabled?: boolean } = {}) {
  return useQuery<Notification[]>({
    queryKey: listKey(),
    queryFn: () => unwrap((api) => api.notifications.list(NOTIFICATION_LIST_LIMIT)),
    enabled: options.enabled ?? true,
  });
}

/** How many notifications are unread, counted in main (not among the loaded page). */
export function useUnreadNotificationCount() {
  return useQuery<number>({
    queryKey: countKey(),
    queryFn: () => unwrap((api) => api.notifications.unreadCount()),
  });
}

/** A new notification (`notification:created`) marks both the list and the count stale. */
export function useNotificationUpdates(): void {
  useInvalidateOn('notification:created', queryKeys.notifications.all);
}

interface Snapshot {
  list?: Notification[];
  count?: number;
}

/**
 * Stops any reload in flight (it would overwrite the optimistic change), applies `change` to
 * the cached list and count, and returns what was there so a failure can put it back.
 */
async function applyOptimistic(
  queryClient: QueryClient,
  change: (list: Notification[] | undefined, count: number | undefined) => Snapshot
): Promise<Snapshot> {
  await queryClient.cancelQueries({ queryKey: queryKeys.notifications.all });
  const before: Snapshot = {
    list: queryClient.getQueryData<Notification[]>(listKey()),
    count: queryClient.getQueryData<number>(countKey()),
  };
  const after = change(before.list, before.count);
  if (after.list !== undefined) queryClient.setQueryData(listKey(), after.list);
  if (after.count !== undefined) queryClient.setQueryData(countKey(), Math.max(0, after.count));
  return before;
}

function restore(queryClient: QueryClient, snapshot: Snapshot | undefined): void {
  if (!snapshot) return;
  queryClient.setQueryData(listKey(), snapshot.list);
  queryClient.setQueryData(countKey(), snapshot.count);
}

const isUnread = (list: Notification[] | undefined, id: number) =>
  Boolean(list?.some((n) => n.id === id && !n.isRead));

/**
 * The shared shape of the optimistic mutations: change the cache at once, put it back if main
 * refuses, and re-read the count from main either way.
 */
function useOptimisticMutation<Variables>(
  mutationFn: (variables: Variables) => Promise<unknown>,
  change: (
    variables: Variables,
    list: Notification[] | undefined,
    count: number | undefined
  ) => Snapshot
) {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, Variables, Snapshot>({
    mutationFn,
    onMutate: (variables) =>
      applyOptimistic(queryClient, (list, count) => change(variables, list, count)),
    onError: (_error, _variables, snapshot) => restore(queryClient, snapshot),
    onSettled: () => queryClient.invalidateQueries({ queryKey: countKey() }),
  });
}

/** Marks one notification read, at once; it rolls back if main refuses. */
export function useMarkNotificationRead() {
  return useOptimisticMutation(
    (id: number) => unwrap((api) => api.notifications.markRead(id)),
    (id, list, count) => ({
      list: list?.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      count: count !== undefined && isUnread(list, id) ? count - 1 : undefined,
    })
  );
}

/** Marks every notification read, at once; it rolls back if main refuses. */
export function useMarkAllNotificationsRead() {
  return useOptimisticMutation(
    () => unwrap((api) => api.notifications.markAllRead()),
    (_none: void, list) => ({ list: list?.map((n) => ({ ...n, isRead: true })), count: 0 })
  );
}

/** Deletes one notification, at once; it comes back if main refuses. */
export function useDeleteNotification() {
  return useOptimisticMutation(
    (id: number) => unwrap((api) => api.notifications.delete(id)),
    (id, list, count) => ({
      list: list?.filter((n) => n.id !== id),
      count: count !== undefined && isUnread(list, id) ? count - 1 : undefined,
    })
  );
}

/** Deletes every notification once main has (the caller confirms first). */
export function useClearNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap((api) => api.notifications.clearAll()),
    onSuccess: () => {
      queryClient.setQueryData(listKey(), []);
      queryClient.setQueryData(countKey(), 0);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all }),
  });
}
