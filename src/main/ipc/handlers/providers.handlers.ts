/**
 * `providers` handlers: the registered providers' manifests, access-gate state and
 * experiments. Every gate's status changes are forwarded to the renderer as
 * `provider:access-status` events.
 *
 * - `experiments` / `setExperiment`: the provider's experiments, stored for the next start
 *   (`ProviderExperiments`); `UNKNOWN_PROVIDER` for one that is not registered, `NOT_FOUND`
 *   for an experiment it does not declare, `ACCOUNT_BUSY` for turning off its holds while a
 *   hold or snipe needs it.
 */

import { contract } from '@shared/contracts';
import type { AccessStatus } from '@shared/types/provider.types';
import type { AppContainer } from '../../app/container';
import type { AccommodationProvider } from '../../providers/sdk/provider';
import type { Handle } from '../handle';

function accessStatusOf(provider: AccommodationProvider): AccessStatus {
  const gate = provider.manifest.capabilities.accessGate ? provider.access : undefined;
  if (gate) return gate.status();
  return {
    providerId: provider.manifest.id,
    state: 'unsupported',
    updatedAt: new Date().toISOString(),
  };
}

export function registerProvidersHandlers(handle: Handle, c: AppContainer): void {
  const api = contract.providers;
  const registry = c.providers;

  handle(api.list, () => registry.list());
  handle(api.accessStatus, ({ providerId }) => accessStatusOf(registry.get(providerId)));
  handle(api.experiments, ({ providerId }) => c.experiments.list(providerId));
  handle(api.setExperiment, ({ providerId, experimentId, enabled }) =>
    c.experiments.set(providerId, experimentId, enabled)
  );

  // A gate drops its listeners when it is disposed (registry.disposeAll on quit).
  for (const provider of registry.withCapability('accessGate')) {
    provider.access.onStatus((status) => c.rendererEvents.emit('provider:access-status', status));
  }
}
