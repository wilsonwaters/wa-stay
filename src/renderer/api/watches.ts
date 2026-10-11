import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Watch,
  WatchExecutionResult,
  WatchInput,
  WatchUpdate,
} from '../../shared/types/watch.types';
import { unwrap } from './client';
import { useInvalidateOn } from './events';
import { queryKeys } from './queryKeys';

/** Bursts of `watch:updated` (a scheduler run touches many watches) refetch once per window. */
export const WATCH_EVENT_COALESCE_MS = 500;

/**
 * Every watch of the local profile, in one cache entry. Pages filter it in the renderer, so
 * changing a filter never refetches and the whole list can still drive the filter options.
 */
export function useWatches() {
  return useQuery({
    queryKey: queryKeys.watches.list(),
    queryFn: () => unwrap((api) => api.watches.list()),
  });
}

/** One watch, or `null` when it does not exist (it was deleted). */
export function useWatch(id: number) {
  return useQuery({
    queryKey: queryKeys.watches.detail(id),
    queryFn: () => unwrap((api) => api.watches.get(id)),
    enabled: Number.isInteger(id) && id > 0,
  });
}

/** Keeps every watch query fresh: `watch:updated` marks them stale, coalesced. */
export function useWatchUpdates(): void {
  useInvalidateOn('watch:updated', queryKeys.watches.all, {
    coalesceMs: WATCH_EVENT_COALESCE_MS,
  });
}

function useInvalidateWatches() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.watches.all });
}

export function useCreateWatch() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateWatches();
  return useMutation({
    mutationFn: (input: WatchInput) => unwrap((api) => api.watches.create(input)),
    onSuccess: (watch: Watch) => {
      queryClient.setQueryData(queryKeys.watches.detail(watch.id), watch);
      void invalidate();
    },
  });
}

export function useUpdateWatch() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateWatches();
  return useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: WatchUpdate }) =>
      unwrap((api) => api.watches.update(id, updates)),
    onSuccess: (watch: Watch) => {
      queryClient.setQueryData(queryKeys.watches.detail(watch.id), watch);
      void invalidate();
    },
  });
}

export function useDeleteWatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap((api) => api.watches.delete(id)),
    onSuccess: (_deleted, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.watches.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.watches.list() });
    },
  });
}

/**
 * Resumes (`activate`) or pauses (`deactivate`) a watch. Main sends `watch:updated` after the
 * change, and `useWatchUpdates` refreshes the lists from that: no second refetch here.
 */
export function useSetWatchActive() {
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      unwrap((api) => (active ? api.watches.activate(id) : api.watches.deactivate(id))),
  });
}

/**
 * Checks a watch now. Resolves with what the check found; the watch itself refreshes from the
 * `watch:updated` main sends after the check (one refetch, not two).
 */
export function useRunWatchNow() {
  return useMutation({
    mutationFn: (id: number): Promise<WatchExecutionResult> =>
      unwrap((api) => api.watches.runNow(id)),
  });
}

/**
 * Opens the provider's payment page for the watch's hold. A hold that expired meanwhile
 * (`HOLD_EXPIRED`) refetches the watch, so the page stops offering payment.
 */
export function useOpenWatchPayment() {
  const invalidate = useInvalidateWatches();
  return useMutation({
    mutationFn: (id: number) => unwrap((api) => api.watches.openPayment(id)),
    onError: () => {
      void invalidate();
    },
  });
}
