import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from './client';
import { useApiEvent } from './events';
import { queryKeys } from './queryKeys';

import type {
  AccessStatus,
  BooleanCapability,
  ProviderCapabilities,
  ProviderManifest,
} from '../../shared/types/provider.types';

export type { ProviderCapabilities, ProviderManifest };

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
