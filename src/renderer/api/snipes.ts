import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SiteSnipe,
  SiteSnipeInput,
  SnipeExecutionResult,
} from '../../shared/types/site-sniper.types';
import { unwrap } from './client';
import { useApiEvent, useInvalidateOn } from './events';
import { queryKeys } from './queryKeys';

/** Bursts of `snipe:updated` (a snipe at release changes every second) refetch once per window. */
export const SNIPE_EVENT_COALESCE_MS = 500;

/** Every snipe of the local profile, in one cache entry. */
export function useSnipes() {
  return useQuery({
    queryKey: queryKeys.snipes.list(),
    queryFn: () => unwrap((api) => api.snipes.list()),
  });
}

/** One snipe, or `null` when it does not exist (it was deleted). */
export function useSnipe(id: number) {
  return useQuery({
    queryKey: queryKeys.snipes.detail(id),
    queryFn: () => unwrap((api) => api.snipes.get(id)),
    enabled: Number.isInteger(id) && id > 0,
  });
}

/**
 * Keeps snipe queries fresh. `snipe:updated` carries the whole snipe, so the affected card and
 * detail change in place at once (no refetch, no spinner); the lists are then marked stale,
 * coalesced, which also catches a snipe that was deleted or created elsewhere.
 */
export function useSnipeUpdates(): void {
  const queryClient = useQueryClient();
  useApiEvent('snipe:updated', (snipe) => {
    queryClient.setQueryData<SiteSnipe[]>(queryKeys.snipes.list(), (list) =>
      list?.map((item) => (item.id === snipe.id ? snipe : item))
    );
    queryClient.setQueryData<SiteSnipe | null>(queryKeys.snipes.detail(snipe.id), (current) =>
      current === undefined ? current : snipe
    );
  });
  useInvalidateOn('snipe:updated', queryKeys.snipes.all, { coalesceMs: SNIPE_EVENT_COALESCE_MS });
}

export function useCreateSnipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SiteSnipeInput) => unwrap((api) => api.snipes.create(input)),
    onSuccess: (snipe: SiteSnipe) => {
      queryClient.setQueryData(queryKeys.snipes.detail(snipe.id), snipe);
      void queryClient.invalidateQueries({ queryKey: queryKeys.snipes.list() });
    },
  });
}

export function useDeleteSnipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap((api) => api.snipes.delete(id)),
    onSuccess: (_deleted, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.snipes.detail(id) });
      queryClient.setQueryData<SiteSnipe[]>(queryKeys.snipes.list(), (list) =>
        list?.filter((item) => item.id !== id)
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.snipes.list() });
    },
  });
}

/**
 * Arms (`activate`) or disarms (`deactivate`) a snipe. Main sends `snipe:updated` after the
 * change, and `useSnipeUpdates` applies it: no refetch here.
 */
export function useSetSnipeActive() {
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      unwrap((api) => (active ? api.snipes.activate(id) : api.snipes.deactivate(id))),
  });
}

/** One attempt now. The snipe itself refreshes from the `snipe:updated` main sends after it. */
export function useRunSnipeNow() {
  return useMutation({
    mutationFn: (id: number): Promise<SnipeExecutionResult> =>
      unwrap((api) => api.snipes.runNow(id)),
  });
}

/**
 * Opens the provider's payment window for a held snipe's hold. A failure (the hold expired,
 * the provider did not answer) refetches the snipe, so the page shows what is true now.
 */
export function useOpenSnipePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => unwrap((api) => api.snipes.openPayment(id)),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.snipes.all });
    },
  });
}
