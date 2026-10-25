import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { unwrap } from './client';
import { useApiEvent } from './events';
import { queryKeys } from './queryKeys';

import type { ProviderExperimentState, ProviderNoticeStatus } from '../../shared/contracts';
import type {
  AccessStatus,
  BooleanCapability,
  ProviderCapabilities,
  ProviderId,
  ProviderManifest,
  ProviderNotice,
} from '../../shared/types/provider.types';

export type {
  ProviderCapabilities,
  ProviderExperimentState,
  ProviderManifest,
  ProviderNotice,
  ProviderNoticeStatus,
};

/** The on/off capabilities a flow can filter providers by (`account`/`catalogMode` are not). */
export type ProviderCapability = BooleanCapability;

/** `providers.list()`: every registered provider's manifest. */
function listProviders(): Promise<ProviderManifest[]> {
  return unwrap((api) => api.providers.list());
}

/** Every registered provider's manifest, sorted by name in main. */
export function useProviders() {
  return useQuery({ queryKey: queryKeys.providers.list(), queryFn: listProviders });
}

/** One provider's manifest, or `undefined` while loading or when the id is unknown. */
export function useProvider(id: string) {
  const select = useCallback(
    (manifests: ProviderManifest[]) => manifests.find((m) => m.id === id),
    [id]
  );
  return useQuery({ queryKey: queryKeys.providers.list(), queryFn: listProviders, select });
}

/**
 * The providers that offer `capability`, for a create flow's provider step (§12.9); with no
 * capability, every provider (adding a booking by hand needs none).
 */
export function useProvidersWith(capability?: ProviderCapability) {
  const select = useCallback(
    (manifests: ProviderManifest[]) =>
      capability ? manifests.filter((m) => m.capabilities[capability] === true) : manifests,
    [capability]
  );
  return useQuery({ queryKey: queryKeys.providers.list(), queryFn: listProviders, select });
}

/**
 * A provider's experiments (`providers.experiments`): each one's stored choice (`enabled`) and
 * whether it is on in this run (`active`); a change takes effect when WA Stay restarts. Ask
 * only for a provider whose manifest declares experiments (`enabled` false asks nothing).
 */
export function useProviderExperiments(providerId: ProviderId, enabled = true) {
  return useQuery({
    queryKey: queryKeys.providers.experiments(providerId),
    queryFn: () => unwrap((api) => api.providers.experiments(providerId)),
    enabled,
  });
}

/**
 * Turns an experiment on or off from the next start (`providers.setExperiment`); main's answer
 * replaces the provider's experiments. Rejects with `ACCOUNT_BUSY` for turning off one that
 * turns on holds while a stay is held.
 */
export function useSetExperiment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      providerId,
      experimentId,
      enabled,
    }: {
      providerId: ProviderId;
      experimentId: string;
      enabled: boolean;
    }) => unwrap((api) => api.providers.setExperiment(providerId, experimentId, enabled)),
    onSuccess: (states, { providerId }) =>
      queryClient.setQueryData(queryKeys.providers.experiments(providerId), states),
  });
}

/**
 * Whether the person has accepted a provider's notice (`providers.notice`, §12.37): until
 * then WA Stay checks nothing there. Ask only for a provider whose manifest has a notice
 * (`enabled` false asks nothing); a provider without one is always `accepted`.
 */
export function useProviderNotice(providerId: ProviderId | undefined, enabled = true) {
  return useQuery<ProviderNoticeStatus>({
    queryKey: queryKeys.providers.notice(providerId ?? ''),
    queryFn: () => unwrap((api) => api.providers.notice(providerId as ProviderId)),
    enabled: enabled && Boolean(providerId),
  });
}

/** The provider's availability answers: its place checks and Explore's counts. */
function availabilityOf(providerId: ProviderId) {
  const checkPrefix = `${providerId}:`;
  return ({ queryKey }: { queryKey: readonly unknown[] }) =>
    queryKey[0] === queryKeys.catalog.all[0] &&
    ((queryKey[1] === 'availability' && queryKey[3] === providerId) ||
      (queryKey[1] === 'check' &&
        typeof queryKey[2] === 'string' &&
        queryKey[2].startsWith(checkPrefix)));
}

/**
 * The provider's availability answers go, as the notice that let them be asked has: each
 * query on screen asks again (and is refused), and none shows an answer from before, even one
 * not on screen now.
 */
function forgetProviderAvailability(queryClient: QueryClient, providerId: ProviderId): void {
  void queryClient.resetQueries({ predicate: availabilityOf(providerId) });
}

/** The provider's availability answers are asked again (each query on screen refetches). */
function askProviderAvailabilityAgain(queryClient: QueryClient, providerId: ProviderId): void {
  void queryClient.invalidateQueries({ predicate: availabilityOf(providerId) });
}

/**
 * Accepts a provider's notice at the version the person read (`providers.acceptNotice`): its
 * status is main's answer, and its checks and counts are asked again. Rejects with
 * `VALIDATION` when the notice changed meanwhile.
 */
export function useAcceptNotice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ providerId, version }: { providerId: ProviderId; version: number }) =>
      unwrap((api) => api.providers.acceptNotice(providerId, version)),
    onSuccess: (status, { providerId }) => {
      queryClient.setQueryData(queryKeys.providers.notice(providerId), status);
      askProviderAvailabilityAgain(queryClient, providerId);
    },
  });
}

/**
 * Withdraws the person's acceptance (`providers.withdrawNotice`): WA Stay stops checking the
 * provider at once. Its status is main's answer; its availability answers are dropped (main
 * drops its own too), and its watches are read again.
 */
export function useWithdrawNotice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: ProviderId) =>
      unwrap((api) => api.providers.withdrawNotice(providerId)),
    onSuccess: (status, providerId) => {
      queryClient.setQueryData(queryKeys.providers.notice(providerId), status);
      forgetProviderAvailability(queryClient, providerId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.watches.all });
    },
  });
}

const updatedAt = (status: AccessStatus | undefined) =>
  status ? Date.parse(status.updatedAt) || 0 : -Infinity;

/**
 * A provider's access gate (its queue), from `providers.accessStatus(id)` once and then from
 * `provider:access-status` events: main pushes every change, so nothing polls. An answer that
 * arrives after a newer event keeps the event's status.
 */
export function useAccessStatus(providerId: string) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.providers.access(providerId);
  useApiEvent('provider:access-status', (status) => {
    if (status.providerId !== providerId) return;
    const current = queryClient.getQueryData<AccessStatus>(queryKey);
    if (updatedAt(status) >= updatedAt(current)) queryClient.setQueryData(queryKey, status);
  });
  return useQuery<AccessStatus>({
    queryKey,
    queryFn: async () => {
      const fetched = await unwrap((api) => api.providers.accessStatus(providerId));
      const current = queryClient.getQueryData<AccessStatus>(queryKey);
      return current && updatedAt(current) >= updatedAt(fetched) ? current : fetched;
    },
    staleTime: Infinity,
  });
}
