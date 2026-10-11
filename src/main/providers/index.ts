/**
 * The built-in providers. Adding a provider is its folder plus an import and an entry in
 * BUILT_IN_PROVIDERS here; `npm run provider:new` writes all three.
 */

import { parkstayFactory } from './parkstay';
import type { ProviderContextFactory, ProviderRegistry } from './registry';
import type { ProviderLogger } from './sdk/context';
import { ProviderRegistrationError } from './sdk/errors';
import type { ProviderFactory } from './sdk/provider';
import type { ProviderId } from '@shared/types/provider.types';

export const BUILT_IN_PROVIDERS: readonly ProviderFactory[] = [parkstayFactory];

export interface BuiltInRegistration {
  registered: ProviderId[];
  failed: ProviderRegistrationError[];
}

/**
 * Registers each factory with a context `makeContext` builds from its validated manifest. A
 * provider that fails to register is logged and skipped, so the app still starts with the
 * others.
 */
export function registerBuiltInProviders(
  registry: ProviderRegistry,
  makeContext: ProviderContextFactory,
  options: { factories?: readonly ProviderFactory[]; logger?: ProviderLogger } = {}
): BuiltInRegistration {
  const { factories = BUILT_IN_PROVIDERS, logger } = options;
  const result: BuiltInRegistration = { registered: [], failed: [] };

  for (const factory of factories) {
    try {
      registry.register(factory, makeContext);
      result.registered.push(factory.id);
    } catch (error) {
      const failure =
        error instanceof ProviderRegistrationError
          ? error
          : new ProviderRegistrationError(
              factory.id,
              error instanceof Error ? error.message : String(error),
              error
            );
      logger?.error(failure.message, failure.cause);
      result.failed.push(failure);
    }
  }

  return result;
}
