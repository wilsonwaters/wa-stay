/**
 * The built-in providers. Adding a provider is its folder plus an import and an entry in
 * BUILT_IN_PROVIDERS here; `npm run provider:new` writes all three.
 */

import { parkstayFactory } from './parkstay';
import { racFactory } from './rac';
import { withExperiments, type ProviderExperiments } from './experiments';
import type { ProviderContextFactory, ProviderRegistry } from './registry';
import type { ProviderLogger } from './sdk/context';
import { ProviderRegistrationError } from './sdk/errors';
import type { ProviderFactory } from './sdk/provider';
import type { ProviderId } from '@shared/types/provider.types';

export const BUILT_IN_PROVIDERS: readonly ProviderFactory[] = [parkstayFactory, racFactory];

export interface BuiltInRegistration {
  registered: ProviderId[];
  failed: ProviderRegistrationError[];
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Registers each factory with a context `makeContext` builds from its validated manifest. A
 * provider that fails to register is logged and skipped, so the app still starts with the
 * others.
 *
 * With `experiments`, each provider registers with the experiments the person turned on
 * (`withExperiments`), before the registry parses and freezes its manifest; if it cannot, it
 * registers without them, which is logged and read as `failed`.
 */
export function registerBuiltInProviders(
  registry: ProviderRegistry,
  makeContext: ProviderContextFactory,
  options: {
    factories?: readonly ProviderFactory[];
    logger?: ProviderLogger;
    experiments?: ProviderExperiments;
  } = {}
): BuiltInRegistration {
  const { factories = BUILT_IN_PROVIDERS, logger, experiments } = options;
  const result: BuiltInRegistration = { registered: [], failed: [] };

  for (const factory of factories) {
    const enabled = experiments?.enabledFor(factory.manifest) ?? [];
    if (experiments && enabled.length) {
      try {
        registry.register(withExperiments(factory, enabled), makeContext);
        experiments.registered(factory.id, { active: enabled, failed: [] });
        result.registered.push(factory.id);
        continue;
      } catch (error) {
        logger?.error(
          `Provider ${factory.id} could not start with experiment ${enabled.join(', ')}, so it starts without: ${reasonOf(error)}`
        );
        experiments.registered(factory.id, { active: [], failed: enabled });
      }
    }
    try {
      registry.register(factory, makeContext);
      result.registered.push(factory.id);
    } catch (error) {
      const failure =
        error instanceof ProviderRegistrationError
          ? error
          : new ProviderRegistrationError(factory.id, reasonOf(error), error);
      logger?.error(failure.message, failure.cause);
      result.failed.push(failure);
    }
  }

  return result;
}
