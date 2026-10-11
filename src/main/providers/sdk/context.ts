/**
 * `ProviderContext`: everything a provider gets from the app, scoped to that provider
 * (architecture-notes §3). Providers never reach for globals: no `electron`, no app logger,
 * no database.
 *
 * The context is built from the provider's manifest (§12.30), so its time zone and limits
 * are at hand before the provider is created.
 */

import path from 'path';
import {
  providerLimits,
  type ProviderId,
  type ProviderLimits,
  type ProviderManifest,
} from '@shared/types/provider.types';
import type { BrowserAutomation } from './browser';
import { PlaywrightBrowserAutomation } from './browser-automation';
import type { HttpClient } from './http';
import type { KeyValueStore } from './kv-store';
import { freezeProviderManifest } from './manifest';
import { createScopedSecretVault, type ScopedSecretVault, type SecretVaultLike } from './secrets';

/** The logging surface providers use (Winston's logger satisfies it). */
export interface ProviderLogger {
  debug(message: string, ...meta: unknown[]): void;
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
  child(meta: Record<string, unknown>): ProviderLogger;
}

export interface ProviderContext {
  readonly id: ProviderId;
  /** The provider's manifest, parsed and frozen. */
  readonly manifest: Readonly<ProviderManifest>;
  /** IANA zone the provider's dates and release times are in (`manifest.timezone`). */
  readonly timezone: string;
  /** `manifest.limits`, or `DEFAULT_PROVIDER_LIMITS`. */
  readonly limits: Readonly<ProviderLimits>;
  /** Bound to the provider's session partition, whose cookies its sign-in and payment windows share. */
  readonly http: HttpClient;
  /**
   * Drives the installed Edge or Chrome (`PlaywrightBrowserAutomation`), with the provider's
   * own profile at `<providersDir>/<id>/browser`. Costs nothing until first used.
   */
  readonly browser: BrowserAutomation;
  /** The provider's own key-value state. */
  readonly state: KeyValueStore;
  /** Encrypted secrets, stored in `state` and readable only by this provider. */
  readonly secrets: ScopedSecretVault;
  /** A child logger tagged `{ provider: id }`. */
  readonly logger: ProviderLogger;
  readonly clock: () => Date;
}

/** What the app supplies to build each provider's context. */
export interface ProviderContextDeps {
  createHttp(providerId: ProviderId): HttpClient;
  createState(providerId: ProviderId): KeyValueStore;
  /** The app's secret vault (P5). */
  vault: SecretVaultLike;
  /** The app logger; each provider gets a child of it. */
  logger: ProviderLogger;
  /**
   * Absolute; holds each provider's browser profile at `<providersDir>/<id>/browser`. The
   * container passes `<userData>/providers`; tests pass a temporary folder.
   */
  providersDir: string;
  /** Development only: the browser executable to automate instead of detecting Edge or Chrome. */
  browserExecutablePath?: string;
  clock?: () => Date;
}

/** Builds the context for the provider `manifest` describes. Throws for an invalid manifest. */
export function createProviderContext(
  manifest: ProviderManifest,
  deps: ProviderContextDeps
): ProviderContext {
  const frozen = freezeProviderManifest(manifest);
  const id = frozen.id;
  const state = deps.createState(id);
  const logger = deps.logger.child({ provider: id });
  return Object.freeze({
    id,
    manifest: frozen,
    timezone: frozen.timezone,
    limits: Object.freeze(providerLimits(frozen)),
    http: deps.createHttp(id),
    browser: new PlaywrightBrowserAutomation({
      providerId: id,
      providerName: frozen.name,
      userDataDir: path.join(deps.providersDir, id, 'browser'),
      timezoneId: frozen.timezone,
      executablePath: deps.browserExecutablePath,
      state,
      logger,
    }),
    state,
    secrets: createScopedSecretVault({ providerId: id, vault: deps.vault, store: state, logger }),
    logger,
    clock: deps.clock ?? (() => new Date()),
  });
}
