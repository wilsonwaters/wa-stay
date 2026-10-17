import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from './client';
import { useApiEvent } from './events';
import { queryKeys } from './queryKeys';

import type { ProviderExperimentState } from '../../shared/contracts';
import type {
  AccessStatus,
  BooleanCapability,
  ProviderCapabilities,
  ProviderId,
  ProviderManifest,
} from '../../shared/types/provider.types';

export type { ProviderCapabilities, ProviderExperimentState, ProviderManifest };

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
 * only for a provider whose manifest declares experiments.
 */
export function useProviderExperiments(providerId: ProviderId) {
  return useQuery({
    queryKey: queryKeys.providers.experiments(providerId),
    queryFn: () => unwrap((api) => api.providers.experiments(providerId)),
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
