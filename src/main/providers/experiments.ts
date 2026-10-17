/**
 * Experiments (architecture-notes §12.35): what a provider ships switched off
 * (`manifest.experiments`, each turning on capabilities that are off), for the person to turn
 * on in Settings → Accounts.
 *
 * - **The choice** is the `provider_state` row `('<providerId>', 'core.experiments')`,
 *   `{ [experimentId]: boolean }`, read and written here through the repository. A provider's
 *   own `ctx.state` cannot reach `core.*` keys (`sdk/kv-store.ts`), so no provider turns its
 *   own experiment on. A row that is not an object of booleans reads as everything off, with a
 *   warning, and the next change rewrites it.
 * - **Applied at registration, so after a restart.** `registerBuiltInProviders` (`index.ts`)
 *   asks `enabledFor` before each provider registers and registers
 *   `withExperiments(factory, ids)`: the manifest with those experiments applied, which the
 *   registry parses and freezes, so `ctx.manifest` (and every screen) has their capabilities
 *   on. If the provider cannot register with them, it registers without, and they read
 *   `failed`. A stored id the manifest no longer declares is ignored, with a warning.
 * - **Turning off acts on holds at once.** Turning off an experiment that turns on `holds` is
 *   refused (`ACCOUNT_BUSY`) while a hold or snipe needs the provider (`isBusy`); once it is
 *   off, `holdsTurningOff` tells the watch and snipe services to place no new hold through it
 *   before the restart. Turning on is never immediate.
 */

import type { ProviderExperimentState } from '@shared/contracts/providers';
import type { ProviderId, ProviderManifest } from '@shared/types/provider.types';
import type { ProviderStateRepository } from '../database/repositories/provider-state.repository';
import { AppError } from '../utils/app-error';
import type { ProviderRegistry } from './registry';
import type { ProviderContext, ProviderLogger } from './sdk/context';
import type { ProviderFactory } from './sdk/provider';

/** The `provider_state` key of a provider's experiment choices. */
export const EXPERIMENTS_STATE_KEY = 'core.experiments';

type Choices = Record<string, boolean>;

function isChoices(value: unknown): value is Choices {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((on) => typeof on === 'boolean')
  );
}

/**
 * `manifest` with each experiment it declares among `ids` applied: marked `applied`, with the
 * capabilities it turns on on. Ids it does not declare are ignored; with none to apply it is
 * returned as it is.
 */
export function applyExperiments(
  manifest: ProviderManifest,
  ids: readonly string[]
): ProviderManifest {
  const experiments = Array.isArray(manifest.experiments) ? manifest.experiments : [];
  const applying = experiments.filter((e) => ids.includes(e.id));
  if (!applying.length) return manifest;
  const capabilities = { ...manifest.capabilities };
  for (const capability of applying.flatMap((e) => e.turnsOn)) capabilities[capability] = true;
  return {
    ...manifest,
    capabilities,
    experiments: experiments.map((e) => (ids.includes(e.id) ? { ...e, applied: true } : e)),
  };
}

/**
 * `factory` with the experiments `ids` applied to its manifest (`applyExperiments`). The
 * registry parses and freezes that manifest and builds the context from it, so the factory
 * sees the capabilities on in `ctx.manifest`.
 */
export function withExperiments(factory: ProviderFactory, ids: readonly string[]): ProviderFactory {
  const manifest = applyExperiments(factory.manifest, ids);
  return Object.assign((ctx: ProviderContext) => factory(ctx), { id: factory.id, manifest });
}

/** What registration applied to one provider in this run. */
export interface ExperimentRegistration {
  /** Registered with these on. */
  active: readonly string[];
  /** Stored on, but the provider registered without them: registering with them failed. */
  failed: readonly string[];
}

export interface ProviderExperimentsDeps {
  /** `provider_state`. */
  state: Pick<ProviderStateRepository, 'get' | 'set'>;
  /** Where the providers are registered: their manifests declare the experiments. */
  providers: Pick<ProviderRegistry, 'get' | 'tryGet'>;
  /** A hold or snipe needs the provider (the container's predicate, as for sign-out). */
  isBusy: (providerId: ProviderId, now: Date) => boolean;
  logger: ProviderLogger;
  clock?: () => Date;
}

export class ProviderExperiments {
  private readonly state: ProviderExperimentsDeps['state'];
  private readonly providers: ProviderExperimentsDeps['providers'];
  private readonly isBusy: ProviderExperimentsDeps['isBusy'];
  private readonly logger: ProviderLogger;
  private readonly clock: () => Date;
  private readonly registrations = new Map<ProviderId, ExperimentRegistration>();

  constructor(deps: ProviderExperimentsDeps) {
    this.state = deps.state;
    this.providers = deps.providers;
    this.isBusy = deps.isBusy;
    this.logger = deps.logger;
    this.clock = deps.clock ?? (() => new Date());
  }

  /**
   * The experiments `manifest` declares that are stored on: what its provider registers with.
   * A stored id it no longer declares is ignored, with a warning. Never throws.
   */
  enabledFor(manifest: ProviderManifest): string[] {
    try {
      const { choices } = this.read(manifest.id);
      const declared = new Set((manifest.experiments ?? []).map((e) => e.id));
      const on = Object.keys(choices).filter((id) => choices[id]);
      for (const id of on.filter((id) => !declared.has(id))) {
        this.logger.warn(`Experiment ${id} of ${manifest.id} is no longer declared; ignored`);
      }
      return on.filter((id) => declared.has(id));
    } catch (error) {
      this.logger.warn(`Experiments of ${String(manifest?.id)} could not be read; all off`, error);
      return [];
    }
  }

  /** Records what the provider registered with, for `list` (`active`, `failed`). */
  registered(providerId: ProviderId, registration: ExperimentRegistration): void {
    this.registrations.set(providerId, registration);
  }

  /**
   * Each experiment the provider declares: stored on or not (`enabled`), applied in this run
   * (`active`), and `failed` while it is stored on but the provider registered without it.
   * Throws `UnknownProviderError` for a provider that is not registered.
   */
  list(providerId: ProviderId): ProviderExperimentState[] {
    const { manifest } = this.providers.get(providerId);
    const { choices } = this.read(providerId);
    const registration = this.registrations.get(providerId);
    return (manifest.experiments ?? []).map(({ id }) => {
      const enabled = choices[id] === true;
      const state: ProviderExperimentState = {
        id,
        enabled,
        active: registration?.active.includes(id) ?? false,
      };
      if (enabled && registration?.failed.includes(id)) state.failed = true;
      return state;
    });
  }

  /**
   * Stores the person's choice, for the next start, and answers `list`. Setting the stored
   * value again writes nothing. Throws `UnknownProviderError`, `NOT_FOUND` for an experiment
   * the provider does not declare, and `ACCOUNT_BUSY` for turning off one that turns on holds
   * while a hold or snipe needs the provider.
   */
  set(providerId: ProviderId, experimentId: string, enabled: boolean): ProviderExperimentState[] {
    const { manifest } = this.providers.get(providerId);
    const declared = manifest.experiments ?? [];
    const experiment = declared.find((e) => e.id === experimentId);
    if (!experiment) {
      throw new AppError('NOT_FOUND', `${manifest.shortName} has no experiment ${experimentId}`);
    }
    const { choices, readable } = this.read(providerId);
    if (readable && (choices[experimentId] === true) === enabled) return this.list(providerId);

    const now = this.clock();
    if (!enabled && experiment.turnsOn.includes('holds') && this.isBusy(providerId, now)) {
      throw new AppError(
        'ACCOUNT_BUSY',
        `A stay is held on ${manifest.shortName}. Pay for it or let it go first.`
      );
    }
    // Only what the provider declares: an id it no longer declares is dropped here
    const next: Choices = {};
    for (const { id } of declared) next[id] = id === experimentId ? enabled : choices[id] === true;
    this.state.set(providerId, EXPERIMENTS_STATE_KEY, next, now);
    this.logger.info(
      `Experiment ${experimentId} of ${providerId} turned ${enabled ? 'on' : 'off'}`
    );
    return this.list(providerId);
  }

  /**
   * Whether the provider's holds are on in this run only through experiments that are now
   * stored off, so they go when WA Stay restarts: until then the core places no new hold on it.
   * Never throws.
   */
  holdsTurningOff(providerId: ProviderId): boolean {
    const active = this.registrations.get(providerId)?.active ?? [];
    const experiments = this.providers.tryGet(providerId)?.manifest.experiments ?? [];
    const holds = experiments.filter((e) => e.turnsOn.includes('holds'));
    if (!holds.some((e) => active.includes(e.id))) return false;
    const { choices } = this.read(providerId);
    return !holds.some((e) => choices[e.id] === true);
  }

  /** The stored choices; everything off, with a warning, when the row cannot be read. */
  private read(providerId: ProviderId): { choices: Choices; readable: boolean } {
    let value: unknown;
    try {
      value = this.state.get(providerId, EXPERIMENTS_STATE_KEY);
    } catch {
      value = null;
    }
    if (value === undefined) return { choices: {}, readable: true };
    if (isChoices(value)) return { choices: value, readable: true };
    this.logger.warn(`Experiments of ${providerId} are not readable; all read as off`);
    return { choices: {}, readable: false };
  }
}
