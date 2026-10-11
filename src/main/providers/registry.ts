/**
 * `ProviderRegistry`: the one place core services find providers (architecture-notes §3,
 * §12.30).
 *
 * `register(factory, context)` checks, in order:
 * 1. the provider id, and that it is not taken;
 * 2. the factory's manifest: `ProviderManifestSchema`, then the manifest-flag rules
 *    (`MANIFEST_RULES`), e.g. `snipes` needs `holds`, `availability` and release modes;
 * 3. the context, built from the parsed manifest when `context` is a function;
 * 4. the provider the factory builds: links, a valid `auth` definition, and a module behind
 *    every capability (`CONSISTENCY_RULES`).
 *
 * A core service that checked a capability (or used `require`) can therefore rely on the
 * module being there. The registry hands out a frozen plain provider object carrying the
 * frozen parsed manifest, so neither the manifest nor the modules can change after the
 * checks. It keeps each provider's context, so `disposeAll` can close what the context holds.
 */

import {
  AccountFieldsSchema,
  ProviderIdSchema,
  type BooleanCapability,
  type ProviderId,
  type ProviderManifest,
} from '@shared/types/provider.types';
import type { ProviderContext, ProviderLogger } from './sdk/context';
import {
  ProviderCapabilityError,
  ProviderRegistrationError,
  UnknownProviderError,
} from './sdk/errors';
import type { HttpClient } from './sdk/http';
import { parseProviderManifest } from './sdk/manifest';
import { isHttpsOriginPattern, isHttpsUrlPattern } from './sdk/url-patterns';
import {
  assembleProvider,
  type AccessGate,
  type AccommodationProvider,
  type AvailabilityModule,
  type BookingsModule,
  type CatalogModule,
  type HoldsModule,
  type ProviderAuth,
  type ProviderFactory,
  type ProviderModules,
  type ReleasePolicy,
} from './sdk/provider';

/** The modules each capability guarantees once a provider is registered. */
interface CapabilityModules {
  catalog: { catalog: CatalogModule };
  availability: { availability: AvailabilityModule };
  watches: { availability: AvailabilityModule };
  bulkAvailability: {
    availability: AvailabilityModule & Required<Pick<AvailabilityModule, 'search'>>;
  };
  holds: { holds: HoldsModule };
  snipes: { availability: AvailabilityModule; holds: HoldsModule; release: ReleasePolicy };
  bookingImport: { bookings: BookingsModule & Required<Pick<BookingsModule, 'get'>> };
  accessGate: { access: AccessGate };
}

export type ProviderWith<C extends BooleanCapability> = AccommodationProvider &
  CapabilityModules[C];

/** Builds a provider's context from its parsed, frozen manifest. */
export type ProviderContextFactory = (manifest: Readonly<ProviderManifest>) => ProviderContext;

/** A rule on the manifest alone. Returns what is wrong, or `undefined`. */
export interface ManifestRule {
  rule: string;
  violation(manifest: Readonly<ProviderManifest>): string | undefined;
}

/** A rule on the built provider (its manifest is the parsed one). Returns what is wrong, or `undefined`. */
export interface ConsistencyRule {
  rule: string;
  violation(provider: AccommodationProvider): string | undefined;
}

const fn = (value: unknown): boolean => typeof value === 'function';
const hasCheck = (p: AccommodationProvider): boolean => fn(p.availability?.check);

/** Manifest-flag rules (§12.30). Exported so tests and the contract suite can name them. */
export const MANIFEST_RULES: readonly ManifestRule[] = [
  {
    rule: 'snipes needs holds and availability',
    violation: ({ capabilities: c }) =>
      c.snipes && !(c.holds && c.availability)
        ? 'capability snipes needs capabilities holds and availability'
        : undefined,
  },
  {
    rule: 'snipes needs release modes',
    violation: (m) =>
      m.capabilities.snipes && !m.releaseModes?.length
        ? 'capability snipes needs at least one release mode'
        : undefined,
  },
  {
    rule: 'usesAccessGate needs accessGate',
    violation: (m) => {
      const gated = (m.releaseModes ?? []).filter((mode) => mode.usesAccessGate);
      return gated.length && !m.capabilities.accessGate
        ? `release mode ${gated.map((mode) => mode.id).join(', ')} uses the access gate but capability accessGate is off`
        : undefined;
    },
  },
];

function isHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isHttpsOrigin(value: unknown): boolean {
  return isHttpsUrl(value) && new URL(value as string).origin === value;
}

/** What is wrong with an `auth` definition for its kind, or `undefined`. */
export function authViolation(auth: ProviderAuth): string | undefined {
  if (!fn(auth.isSignedIn)) return 'auth needs isSignedIn';
  const kind: unknown = auth.kind;
  switch (auth.kind) {
    case 'browser-session':
      if (!isHttpsUrl(auth.signInUrl)) return 'browser-session auth needs an https signInUrl';
      if (!auth.allowedOrigins?.length || !auth.allowedOrigins.every(isHttpsOrigin)) {
        return 'browser-session auth needs https allowedOrigins';
      }
      if (auth.completionUrlPatterns && !auth.completionUrlPatterns.every(isHttpsUrlPattern)) {
        return 'browser-session auth completionUrlPatterns must be https URL patterns';
      }
      return undefined;
    case 'credentials':
      if (!AccountFieldsSchema.safeParse(auth.fields).success) {
        return 'credentials auth needs fields (at least one, unique alphanumeric keys)';
      }
      return fn(auth.signIn) ? undefined : 'credentials auth needs signIn';
    case 'automation':
      return fn(auth.signIn) ? undefined : 'automation auth needs signIn';
    default:
      return `auth kind "${String(kind)}" is not browser-session, credentials or automation`;
  }
}

/** Capability → module rules (plus the auth shape). Exported so tests can name them. */
export const CONSISTENCY_RULES: readonly ConsistencyRule[] = [
  {
    rule: 'catalog',
    violation: (p) =>
      p.manifest.capabilities.catalog && !fn(p.catalog?.getLocation)
        ? 'capability catalog needs catalog.getLocation'
        : undefined,
  },
  {
    rule: 'catalogMode full',
    violation: ({ manifest: { capabilities: c }, catalog }) =>
      c.catalog && c.catalogMode === 'full' && !fn(catalog?.listLocations)
        ? 'catalogMode full needs catalog.listLocations'
        : undefined,
  },
  {
    rule: 'catalogMode search',
    violation: ({ manifest: { capabilities: c }, catalog }) =>
      c.catalog && c.catalogMode === 'search' && !fn(catalog?.searchArea)
        ? 'catalogMode search needs catalog.searchArea'
        : undefined,
  },
  {
    rule: 'availability/watches',
    violation: (p) =>
      (p.manifest.capabilities.availability || p.manifest.capabilities.watches) && !hasCheck(p)
        ? 'capability availability/watches needs availability.check'
        : undefined,
  },
  {
    rule: 'bulkAvailability',
    violation: (p) =>
      p.manifest.capabilities.bulkAvailability && !fn(p.availability?.search)
        ? 'capability bulkAvailability needs availability.search'
        : undefined,
  },
  {
    rule: 'holds',
    violation: (p) =>
      p.manifest.capabilities.holds && !(fn(p.holds?.create) && fn(p.holds?.paymentUrl))
        ? 'capability holds needs holds.create and holds.paymentUrl'
        : undefined,
  },
  {
    rule: 'holds payment origins',
    violation: (p) =>
      p.holds?.paymentOrigins && !p.holds.paymentOrigins.every(isHttpsOriginPattern)
        ? 'holds.paymentOrigins must be https origins or https://*.<domain> patterns'
        : undefined,
  },
  {
    rule: 'access waiting room origins',
    violation: (p) =>
      p.access?.waitingRoomOrigins && !p.access.waitingRoomOrigins.every(isHttpsOriginPattern)
        ? 'access.waitingRoomOrigins must be https origins or https://*.<domain> patterns'
        : undefined,
  },
  {
    rule: 'snipes',
    violation: (p) =>
      p.manifest.capabilities.snipes &&
      !(hasCheck(p) && p.holds !== undefined && fn(p.release?.computeReleaseAt))
        ? 'capability snipes needs availability, holds and release'
        : undefined,
  },
  {
    rule: 'release modes supported',
    violation: (p) => {
      if (!p.manifest.capabilities.snipes || !p.release) return undefined;
      const release = p.release;
      const unsupported = (p.manifest.releaseModes ?? []).filter((mode) => {
        try {
          return release.supports(mode.id) !== true;
        } catch {
          return true;
        }
      });
      return unsupported.length
        ? `release.supports() rejects release mode ${unsupported.map((m) => m.id).join(', ')}`
        : undefined;
    },
  },
  {
    rule: 'accessGate',
    violation: (p) =>
      p.manifest.capabilities.accessGate && !p.access
        ? 'capability accessGate needs access'
        : undefined,
  },
  {
    rule: 'account',
    violation: (p) =>
      p.manifest.capabilities.account !== 'none' && !p.auth
        ? 'capability account needs auth'
        : undefined,
  },
  {
    rule: 'auth',
    violation: (p) => (p.auth ? authViolation(p.auth) : undefined),
  },
  {
    rule: 'bookingImport',
    violation: (p) =>
      p.manifest.capabilities.bookingImport && !fn(p.bookings?.get)
        ? 'capability bookingImport needs bookings.get'
        : undefined,
  },
];

/** Every manifest-flag rule the manifest breaks, as messages. */
export function manifestViolations(manifest: Readonly<ProviderManifest>): string[] {
  return MANIFEST_RULES.map((r) => r.violation(manifest)).filter((v): v is string => !!v);
}

/** Every manifest and module rule the provider breaks, as messages; empty when it is consistent. */
export function providerViolations(provider: AccommodationProvider): string[] {
  return [
    ...manifestViolations(provider.manifest),
    ...CONSISTENCY_RULES.map((r) => r.violation(provider)).filter((v): v is string => !!v),
  ];
}

const byName = (a: ProviderManifest, b: ProviderManifest): number =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);

/** Starts `run` now and turns a synchronous throw into a rejection. */
function attempt(run: () => unknown): Promise<unknown> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(error);
  }
}

interface Entry {
  readonly provider: AccommodationProvider;
  readonly manifest: Readonly<ProviderManifest>;
  readonly ctx: ProviderContext;
}

export interface ProviderRegistryOptions {
  logger?: ProviderLogger;
}

export class ProviderRegistry {
  private readonly entries = new Map<ProviderId, Entry>();
  private readonly logger?: ProviderLogger;

  constructor(options: ProviderRegistryOptions = {}) {
    this.logger = options.logger;
  }

  /**
   * Validates the factory's manifest, builds the context (when `context` is a function) and
   * the provider, checks it and adds it. Returns the registered provider. Throws
   * `ProviderRegistrationError` naming the provider.
   */
  register(
    factory: ProviderFactory,
    context: ProviderContext | ProviderContextFactory
  ): AccommodationProvider {
    const id = factory?.id;
    const fail = (reason: string, cause?: unknown): never => {
      throw new ProviderRegistrationError(String(id), reason, cause);
    };
    const reasonOf = (error: unknown): string =>
      error instanceof Error ? error.message : String(error);

    if (!ProviderIdSchema.safeParse(id).success) fail('invalid provider id');
    if (this.entries.has(id)) fail('a provider with this id is already registered');

    const parsed = parseProviderManifest(factory.manifest);
    if (!parsed.ok) return fail(`invalid manifest (${parsed.issues.join('; ')})`);
    const manifest = parsed.manifest;
    if (manifest.id !== id) fail(`its manifest id "${manifest.id}" does not match`);
    const flagProblems = manifestViolations(manifest);
    if (flagProblems.length) fail(flagProblems.join('; '));

    let ctx: ProviderContext;
    try {
      ctx = typeof context === 'function' ? context(manifest) : context;
    } catch (error) {
      return fail(`its context could not be built: ${reasonOf(error)}`, error);
    }
    if (ctx.id !== id) fail(`its context belongs to "${ctx.id}"`);

    let impl: ProviderModules;
    try {
      impl = factory(ctx);
    } catch (error) {
      this.closeQuietly(id, { ctx });
      return fail(`its factory threw: ${reasonOf(error)}`, error);
    }
    if (typeof impl !== 'object' || impl === null) {
      this.closeQuietly(id, { ctx });
      return fail('its factory returned no provider');
    }

    // The registry's copy: the parsed manifest, the modules as built, nothing replaceable.
    const provider = Object.freeze(assembleProvider(manifest, impl));
    const problem =
      !fn(provider.links?.location) || !fn(provider.links?.booking)
        ? 'it has no links'
        : providerViolations(provider).join('; ');
    if (problem) {
      // Release anything the half-built provider started.
      this.closeQuietly(id, { provider, ctx });
      fail(problem);
    }

    this.entries.set(id, { provider, manifest, ctx });
    return provider;
  }

  get(id: ProviderId): AccommodationProvider {
    const entry = this.entries.get(id);
    if (!entry) throw new UnknownProviderError(id);
    return entry.provider;
  }

  tryGet(id: ProviderId): AccommodationProvider | undefined {
    return this.entries.get(id)?.provider;
  }

  /**
   * The provider's HTTP client (its context's `http`): bound to the provider's session
   * partition, the one its sign-in and payment windows share. The account service asks a
   * provider's `auth.isSignedIn` with it. Throws `UnknownProviderError`.
   */
  httpOf(id: ProviderId): HttpClient {
    const entry = this.entries.get(id);
    if (!entry) throw new UnknownProviderError(id);
    return entry.ctx.http;
  }

  /** Every manifest (parsed and frozen), sorted by name. */
  list(): Readonly<ProviderManifest>[] {
    return [...this.entries.values()].map((e) => e.manifest).sort(byName);
  }

  /** The providers with `capability` turned on, sorted by name. */
  withCapability<C extends BooleanCapability>(capability: C): ProviderWith<C>[] {
    return [...this.entries.values()]
      .filter((e) => e.manifest.capabilities[capability] === true)
      .sort((a, b) => byName(a.manifest, b.manifest))
      .map((e) => e.provider) as ProviderWith<C>[];
  }

  /** The provider, which must have `capability`. Throws `UnknownProviderError` or `ProviderCapabilityError`. */
  require<C extends BooleanCapability>(id: ProviderId, capability: C): ProviderWith<C> {
    const provider = this.get(id);
    if (provider.manifest.capabilities[capability] !== true) {
      throw new ProviderCapabilityError(id, capability);
    }
    return provider as ProviderWith<C>;
  }

  /**
   * Disposes every provider, even when some fail, and empties the registry. For each one it
   * disposes the access gate, calls the provider's `dispose`, and closes the context's
   * browser. Each starts synchronously, before this returns its promise. Failures are
   * logged; this never rejects, so it is safe on quit.
   */
  async disposeAll(): Promise<void> {
    const entries = [...this.entries.entries()];
    this.entries.clear();
    await Promise.all(entries.map(([id, entry]) => this.close(id, entry, 'error')));
  }

  private closeQuietly(id: ProviderId, parts: Partial<Pick<Entry, 'provider' | 'ctx'>>): void {
    void this.close(id, parts, 'warn');
  }

  private async close(
    id: ProviderId,
    { provider, ctx }: Partial<Pick<Entry, 'provider' | 'ctx'>>,
    level: 'warn' | 'error'
  ): Promise<void> {
    const steps: Array<[failure: string, run: () => unknown]> = [
      ['access gate failed to dispose', () => provider?.access?.dispose?.()],
      ['failed to dispose', () => provider?.dispose?.()],
      ['browser failed to close', () => ctx?.browser?.close?.()],
    ];
    const started = steps.map(([failure, run]) => [failure, attempt(run)] as const);
    for (const [failure, pending] of started) {
      await pending.catch((error: unknown) =>
        this.logger?.[level](`Provider ${id} ${failure}`, error)
      );
    }
  }
}
