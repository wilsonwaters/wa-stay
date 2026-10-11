/**
 * ProviderRegistry: registration checks (id, duplicates, manifest, the manifest-flag rules,
 * the capability → module rules, auth kinds), the frozen registered copy, lookup errors,
 * capability queries, disposal of providers and their contexts, and built-in registration
 * that survives a broken provider.
 */

import { BUILT_IN_PROVIDERS, registerBuiltInProviders } from '@main/providers';
import { parkstayFactory } from '@main/providers/parkstay';
import {
  CONSISTENCY_RULES,
  MANIFEST_RULES,
  ProviderRegistry,
  type ProviderContextFactory,
} from '@main/providers/registry';
import {
  defineProvider,
  ProviderCapabilityError,
  ProviderRegistrationError,
  UnknownProviderError,
  type AccommodationProvider,
  type BrowserAutomation,
  type ProviderAuth,
  type ProviderContext,
} from '@main/providers/sdk';
import type { ProviderManifest } from '@shared/types/provider.types';
import {
  createFakeProvider,
  createMemoryLogger,
  createTestProviderContext,
  testManifest,
  type FakeProvider,
} from '@tests/utils/fake-provider';

function register(registry: ProviderRegistry, provider: FakeProvider): AccommodationProvider {
  return registry.register(provider.factory, createTestProviderContext);
}

/** Registering `provider` must fail with a ProviderRegistrationError mentioning `message`. */
function expectRegistrationError(provider: FakeProvider, message: RegExp): void {
  const registry = new ProviderRegistry();
  let error: unknown;
  try {
    register(registry, provider);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ProviderRegistrationError);
  expect((error as ProviderRegistrationError).providerId).toBe(provider.manifest.id);
  expect((error as Error).message).toMatch(message);
  expect(registry.tryGet(provider.manifest.id)).toBeUndefined();
}

/** A context whose browser records `close()`. */
function contextWithBrowser(
  manifest: ProviderManifest,
  close: () => Promise<void> = () => Promise.resolve()
): ProviderContext & { browser: BrowserAutomation & { close: jest.Mock } } {
  const ctx = createTestProviderContext(manifest);
  const browser = {
    isAvailable: () => ctx.browser.isAvailable(),
    withPage: <T>(run: Parameters<BrowserAutomation['withPage']>[0]) =>
      ctx.browser.withPage(run) as Promise<T>,
    close: jest.fn(close),
  };
  return { ...ctx, browser };
}

describe('ProviderRegistry.register', () => {
  it('registers a consistent provider, building its context from the parsed manifest', () => {
    const registry = new ProviderRegistry();
    const fake = createFakeProvider();
    const makeContext = jest.fn<ProviderContext, Parameters<ProviderContextFactory>>(
      createTestProviderContext
    );

    const provider = registry.register(fake.factory, makeContext);

    expect(makeContext).toHaveBeenCalledTimes(1);
    const [manifest] = makeContext.mock.calls[0];
    expect(manifest).toEqual(fake.manifest);
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(fake.ctx).toBe(makeContext.mock.results[0].value);
    expect(fake.ctx).toMatchObject({ id: 'fake', timezone: 'Australia/Perth' });
    expect(registry.get('fake')).toBe(provider);
  });

  it('also accepts a ready-made context for the provider', () => {
    const registry = new ProviderRegistry();
    const fake = createFakeProvider();
    const ctx = createTestProviderContext(fake.manifest);

    registry.register(fake.factory, ctx);

    expect(fake.ctx).toBe(ctx);
  });

  it('hands out a frozen copy: the parsed, frozen manifest and the modules as built', () => {
    const registry = new ProviderRegistry();
    const fake = createFakeProvider();
    (fake.manifest as ProviderManifest & { extra?: string }).extra = 'not in the schema';

    const provider = registry.register(fake.factory, createTestProviderContext);

    expect(Object.isFrozen(provider)).toBe(true);
    expect(Object.isFrozen(provider.manifest.capabilities)).toBe(true);
    expect(provider.manifest).not.toHaveProperty('extra');
    expect(registry.list()[0]).toBe(provider.manifest);
    expect(provider.holds).toBe(fake.holds);
    expect(provider.catalog).toBe(fake.catalog);
    // Changing the provider's own manifest afterwards changes nothing the registry hands out.
    (fake.manifest.capabilities as { holds: boolean }).holds = false;
    expect(registry.require('fake', 'holds').holds).toBe(fake.holds);
  });

  it('throws ProviderRegistrationError for a duplicate id', () => {
    const registry = new ProviderRegistry();
    register(registry, createFakeProvider());

    expect(() => register(registry, createFakeProvider())).toThrow(ProviderRegistrationError);
    expect(() => register(registry, createFakeProvider())).toThrow(/already registered/);
  });

  it('throws for an invalid id (ParkStay)', () => {
    const registry = new ProviderRegistry();
    const fake = createFakeProvider({ id: 'ParkStay' });
    const ctx = { ...createTestProviderContext('parkstay'), id: 'ParkStay' };

    expect(() => registry.register(fake.factory, ctx)).toThrow(ProviderRegistrationError);
    expect(() => registry.register(fake.factory, ctx)).toThrow(/invalid provider id/);
  });

  it('throws when the manifest id differs from the factory id, or the context is for another provider', () => {
    const registry = new ProviderRegistry();
    const fake = createFakeProvider({ id: 'fake' });
    const misnamed = Object.assign(() => fake, { id: 'other', manifest: fake.manifest });

    expect(() => registry.register(misnamed, createTestProviderContext('other'))).toThrow(
      /manifest id "fake" does not match/
    );
    expect(() => registry.register(fake.factory, createTestProviderContext('fake2'))).toThrow(
      /context belongs to "fake2"/
    );
  });

  it('throws, naming the provider, when the manifest is invalid, before building anything', () => {
    const fake = createFakeProvider();
    (fake.manifest.brand as { color: string }).color = 'green';
    const makeContext = jest.fn(createTestProviderContext);

    expect(() => new ProviderRegistry().register(fake.factory, makeContext)).toThrow(
      /invalid manifest \(brand\.color/
    );
    expect(makeContext).not.toHaveBeenCalled();
    expect(fake.ctx).toBeUndefined();
  });

  it('throws, naming the provider, when its context cannot be built', () => {
    const fake = createFakeProvider();
    expect(() =>
      new ProviderRegistry().register(fake.factory, () => {
        throw new Error('partition unavailable');
      })
    ).toThrow('Provider "fake" could not be registered: its context could not be built');
  });

  it('throws, naming the provider, when its factory throws, and closes its browser', () => {
    const registry = new ProviderRegistry();
    const broken = defineProvider(testManifest('broken'), () => {
      throw new Error('no network');
    });
    const ctx = contextWithBrowser(testManifest('broken'));

    let error: unknown;
    try {
      registry.register(broken, ctx);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ProviderRegistrationError);
    expect(error).toMatchObject({ providerId: 'broken', code: 'registration' });
    expect((error as Error).message).toBe(
      'Provider "broken" could not be registered: its factory threw: no network'
    );
    expect(ctx.browser.close).toHaveBeenCalledTimes(1);
  });

  it('throws when the provider has no links', () => {
    const fake = createFakeProvider();
    (fake as { links?: unknown }).links = undefined;
    expectRegistrationError(fake, /no links/);
  });

  it('disposes what a rejected provider built: its gate, itself and its browser', () => {
    const fake = createFakeProvider();
    delete fake.holds;
    const gateDispose = jest.spyOn(fake.access!, 'dispose');
    const ctx = contextWithBrowser(fake.manifest);

    expect(() => new ProviderRegistry().register(fake.factory, ctx)).toThrow(/holds/);
    expect(gateDispose).toHaveBeenCalled();
    expect(fake.disposed).toBe(true);
    expect(ctx.browser.close).toHaveBeenCalledTimes(1);
  });

  describe('manifest-flag rules (one case per rule)', () => {
    const cases: Array<[rule: string, options: Parameters<typeof createFakeProvider>[0], RegExp]> =
      [
        [
          'snipes needs holds and availability',
          { capabilities: { holds: false } },
          /capability snipes needs capabilities holds and availability/,
        ],
        ['snipes needs release modes', {}, /capability snipes needs at least one release mode/],
        [
          'usesAccessGate needs accessGate',
          {},
          /release mode daily_rollover, scheduled uses the access gate but capability accessGate is off/,
        ],
      ];

    it('covers every manifest rule', () => {
      expect(cases.map(([rule]) => rule)).toEqual(MANIFEST_RULES.map((r) => r.rule));
    });

    it.each(cases)('%s', (rule, options, message) => {
      const fake = createFakeProvider(options);
      if (rule === 'snipes needs release modes') fake.manifest.releaseModes = [];
      if (rule === 'usesAccessGate needs accessGate') {
        // The gate is off but two modes still wait in it.
        fake.manifest.capabilities.accessGate = false;
        delete fake.access;
        fake.manifest.releaseModes = fake.manifest.releaseModes!.map((mode) => ({
          ...mode,
          usesAccessGate: mode.id !== 'cancellation',
        }));
      }
      expectRegistrationError(fake, message);
    });

    it('snipes also needs availability on', () => {
      const fake = createFakeProvider({ capabilities: { availability: false } });
      expectRegistrationError(fake, /snipes needs capabilities holds and availability/);
    });

    it('modes that do not use the gate are fine without one', () => {
      const fake = createFakeProvider({ capabilities: { accessGate: false } });
      expect(fake.manifest.releaseModes!.every((m) => !m.usesAccessGate)).toBe(true);
      expect(() => register(new ProviderRegistry(), fake)).not.toThrow();
    });
  });

  describe('capability → module rules (one case per rule)', () => {
    type Mutation = (p: FakeProvider) => void;
    const auth = (p: FakeProvider): Record<string, unknown> =>
      p.auth as unknown as Record<string, unknown>;
    const cases: Array<
      [rule: string, options: Parameters<typeof createFakeProvider>[0], Mutation, RegExp]
    > = [
      ['catalog', {}, (p) => delete p.catalog, /capability catalog needs catalog\.getLocation/],
      [
        'catalogMode full',
        {},
        (p) => delete p.catalog!.listLocations,
        /catalogMode full needs catalog\.listLocations/,
      ],
      [
        'catalogMode search',
        { capabilities: { catalogMode: 'search' } },
        (p) => delete p.catalog!.searchArea,
        /catalogMode search needs catalog\.searchArea/,
      ],
      [
        'availability/watches',
        {},
        (p) => delete p.availability,
        /availability\/watches needs availability\.check/,
      ],
      [
        'bulkAvailability',
        {},
        (p) => delete p.availability!.search,
        /bulkAvailability needs availability\.search/,
      ],
      [
        'holds',
        {},
        (p) => delete p.holds,
        /capability holds needs holds\.create and holds\.paymentUrl/,
      ],
      [
        'holds payment origins',
        {},
        (p) => ((p.holds as { paymentOrigins?: string[] }).paymentOrigins = ['https://*.au']),
        /holds\.paymentOrigins must be https origins or https:\/\/\*\.<domain> patterns/,
      ],
      [
        'access waiting room origins',
        {},
        (p) =>
          ((p.access as { waitingRoomOrigins?: string[] }).waitingRoomOrigins = [
            'http://queue.fake.example',
          ]),
        /access\.waitingRoomOrigins must be https origins or https:\/\/\*\.<domain> patterns/,
      ],
      ['snipes', {}, (p) => delete p.release, /snipes needs availability, holds and release/],
      [
        'release modes supported',
        {},
        (p) => (p.release!.supports = (mode) => mode !== 'scheduled'),
        /release\.supports\(\) rejects release mode scheduled/,
      ],
      ['accessGate', {}, (p) => delete p.access, /capability accessGate needs access/],
      ['account', {}, (p) => delete p.auth, /capability account needs auth/],
      [
        'auth',
        {},
        (p) => (auth(p).signInUrl = 'http://fake.example/sign-in'),
        /browser-session auth needs an https signInUrl/,
      ],
      ['bookingImport', {}, (p) => delete p.bookings!.get, /bookingImport needs bookings\.get/],
    ];

    it('covers every module rule', () => {
      expect(cases.map(([rule]) => rule)).toEqual(CONSISTENCY_RULES.map((r) => r.rule));
    });

    it.each(cases)('%s: a missing module is rejected', (_rule, options, breakIt, message) => {
      const fake = createFakeProvider(options);
      breakIt(fake);
      expectRegistrationError(fake, message);
    });

    it('watches alone also needs availability.check', () => {
      const fake = createFakeProvider({
        capabilities: { availability: false, bulkAvailability: false, snipes: false },
      });
      delete fake.availability;
      expectRegistrationError(fake, /availability\/watches needs availability\.check/);
    });

    it('a release policy that throws in supports() is a rejected mode, not a crash', () => {
      const fake = createFakeProvider();
      fake.release!.supports = () => {
        throw new Error('boom');
      };
      expectRegistrationError(fake, /rejects release mode daily_rollover, scheduled, cancellation/);
    });

    it('turning a capability off lets the module go', () => {
      const registry = new ProviderRegistry();
      const fake = createFakeProvider({
        capabilities: { holds: false, snipes: false, account: 'none' },
      });
      expect(fake.holds).toBeUndefined();
      expect(fake.auth).toBeUndefined();
      expect(register(registry, fake).manifest.id).toBe('fake');
    });
  });

  describe('auth kinds', () => {
    const signedIn = async () => ({ state: 'signed-in' as const });
    const cases: Array<[label: string, auth: unknown, error: RegExp | null]> = [
      [
        'browser-session',
        {
          kind: 'browser-session',
          signInUrl: 'https://fake.example/sign-in',
          allowedOrigins: ['https://fake.example'],
          isSignedIn: signedIn,
        },
        null,
      ],
      [
        'browser-session with an origin that has a path',
        {
          kind: 'browser-session',
          signInUrl: 'https://fake.example/sign-in',
          allowedOrigins: ['https://fake.example/login'],
          isSignedIn: signedIn,
        },
        /browser-session auth needs https allowedOrigins/,
      ],
      [
        'browser-session with completion URL patterns',
        {
          kind: 'browser-session',
          signInUrl: 'https://fake.example/sign-in',
          allowedOrigins: ['https://fake.example'],
          completionUrlPatterns: ['https://fake.example/done/*'],
          isSignedIn: signedIn,
        },
        null,
      ],
      [
        'browser-session with an http completion pattern',
        {
          kind: 'browser-session',
          signInUrl: 'https://fake.example/sign-in',
          allowedOrigins: ['https://fake.example'],
          completionUrlPatterns: ['http://fake.example/done/*'],
          isSignedIn: signedIn,
        },
        /completionUrlPatterns must be https URL patterns/,
      ],
      [
        'credentials',
        {
          kind: 'credentials',
          fields: [
            { key: 'email', label: 'Email', secret: false },
            { key: 'password', label: 'Password', secret: true, help: 'Your RAC password' },
          ],
          signIn: signedIn,
          isSignedIn: signedIn,
        },
        null,
      ],
      [
        'credentials without fields',
        { kind: 'credentials', fields: [], signIn: signedIn, isSignedIn: signedIn },
        /credentials auth needs fields/,
      ],
      [
        'credentials with duplicate keys',
        {
          kind: 'credentials',
          fields: [
            { key: 'email', label: 'Email', secret: false },
            { key: 'email', label: 'Email again', secret: false },
          ],
          signIn: signedIn,
          isSignedIn: signedIn,
        },
        /credentials auth needs fields/,
      ],
      [
        'credentials without signIn',
        {
          kind: 'credentials',
          fields: [{ key: 'email', label: 'Email', secret: false }],
          isSignedIn: signedIn,
        },
        /credentials auth needs signIn/,
      ],
      ['automation', { kind: 'automation', signIn: signedIn, isSignedIn: signedIn }, null],
      [
        'automation without signIn',
        { kind: 'automation', isSignedIn: signedIn },
        /automation auth needs signIn/,
      ],
      [
        'an unknown kind',
        { kind: 'oauth', isSignedIn: signedIn },
        /auth kind "oauth" is not browser-session, credentials or automation/,
      ],
      ['no isSignedIn', { kind: 'automation', signIn: signedIn }, /auth needs isSignedIn/],
    ];

    it.each(cases)('%s', (_label, auth, error) => {
      const fake = createFakeProvider();
      fake.auth = auth as ProviderAuth;
      if (error) expectRegistrationError(fake, error);
      else expect(register(new ProviderRegistry(), fake).auth).toBe(auth);
    });
  });
});

describe('ProviderRegistry lookups', () => {
  let registry: ProviderRegistry;
  let fake: FakeProvider;
  let fake2: FakeProvider;

  beforeEach(() => {
    registry = new ProviderRegistry();
    fake2 = createFakeProvider({
      id: 'fake2',
      name: 'Another Fake',
      capabilities: { holds: false, snipes: false },
    });
    fake = createFakeProvider({ id: 'fake', name: 'Zebra Fake' });
    register(registry, fake);
    register(registry, fake2);
  });

  it('httpOf returns the HTTP client of the provider context; unknown ids throw', () => {
    expect(registry.httpOf('fake')).toBe(fake.ctx?.http);
    expect(registry.httpOf('fake').providerId).toBe('fake');
    expect(() => registry.httpOf('nope')).toThrow(UnknownProviderError);
  });

  it('get("nope") throws UnknownProviderError; tryGet returns undefined', () => {
    expect(() => registry.get('nope')).toThrow(UnknownProviderError);
    expect(() => registry.get('nope')).toThrow('Unknown provider "nope"');
    expect(registry.tryGet('nope')).toBeUndefined();
    expect(registry.tryGet('fake')).toBe(registry.get('fake'));
  });

  it('list() returns the manifests sorted by name', () => {
    expect(registry.list().map((m) => m.name)).toEqual(['Another Fake', 'Zebra Fake']);
    expect(registry.list()[0]).toEqual(fake2.manifest);
  });

  it('withCapability returns only providers with it, sorted by name', () => {
    expect(registry.withCapability('holds').map((p) => p.manifest.id)).toEqual(['fake']);
    expect(registry.withCapability('catalog').map((p) => p.manifest.id)).toEqual(['fake2', 'fake']);
  });

  it('require returns the provider when it has the capability', () => {
    const provider = registry.require('fake', 'holds');
    expect(provider).toBe(registry.get('fake'));
    expect(provider.holds).toBe(fake.holds);
    expect(typeof provider.holds.create).toBe('function');
  });

  it('require("fake", "holds") on a provider without holds throws ProviderCapabilityError', () => {
    const withoutHolds = new ProviderRegistry();
    register(withoutHolds, createFakeProvider({ capabilities: { holds: false, snipes: false } }));

    let error: unknown;
    try {
      withoutHolds.require('fake', 'holds');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ProviderCapabilityError);
    expect(error).toMatchObject({ providerId: 'fake', capability: 'holds', code: 'capability' });
    expect((error as Error).message).toBe('fake does not support holds');
    // The same in a two-provider registry
    expect(() => registry.require('fake2', 'holds')).toThrow(ProviderCapabilityError);
  });

  it('require on an unknown provider throws UnknownProviderError', () => {
    expect(() => registry.require('nope', 'catalog')).toThrow(UnknownProviderError);
  });
});

describe('ProviderRegistry.disposeAll', () => {
  it('disposes every provider even when one rejects or throws, logs the failures and never rejects', async () => {
    const logger = createMemoryLogger();
    const registry = new ProviderRegistry({ logger });
    const rejecting = createFakeProvider({ id: 'rejects' });
    const throwing = createFakeProvider({ id: 'throws' });
    const fine = createFakeProvider({ id: 'fine' });
    rejecting.dispose = jest.fn(() => Promise.reject(new Error('socket stuck')));
    throwing.dispose = jest.fn(() => {
      throw new Error('sync boom');
    });
    const fineDispose = jest.spyOn(fine, 'dispose');
    for (const p of [rejecting, throwing, fine]) register(registry, p);

    await expect(registry.disposeAll()).resolves.toBeUndefined();

    expect(rejecting.dispose).toHaveBeenCalledTimes(1);
    expect(throwing.dispose).toHaveBeenCalledTimes(1);
    expect(fineDispose).toHaveBeenCalledTimes(1);
    expect(logger.lines.filter((l) => l.level === 'error').map((l) => l.message)).toEqual([
      'Provider rejects failed to dispose',
      'Provider throws failed to dispose',
    ]);
    expect(registry.list()).toEqual([]);
  });

  it("disposes each provider's access gate and closes its context's browser, even when one fails", async () => {
    const logger = createMemoryLogger();
    const registry = new ProviderRegistry({ logger });
    const fake = createFakeProvider();
    // Only the registry's call throws; the fake's own dispose calls it again.
    const gateDispose = jest.spyOn(fake.access!, 'dispose').mockImplementationOnce(() => {
      throw new Error('timer stuck');
    });
    const ctx = contextWithBrowser(fake.manifest, () => Promise.reject(new Error('kill failed')));
    registry.register(fake.factory, ctx);

    await registry.disposeAll();

    expect(gateDispose).toHaveBeenCalled();
    expect(fake.disposed).toBe(true);
    expect(ctx.browser.close).toHaveBeenCalledTimes(1);
    expect(logger.lines.map((l) => l.message)).toEqual([
      'Provider fake access gate failed to dispose',
      'Provider fake browser failed to close',
    ]);
  });

  it('starts every dispose, gate and browser close synchronously', () => {
    const registry = new ProviderRegistry();
    const fake = createFakeProvider();
    const ctx = contextWithBrowser(fake.manifest);
    registry.register(fake.factory, ctx);

    void registry.disposeAll();

    expect(fake.disposed).toBe(true);
    expect(ctx.browser.close).toHaveBeenCalledTimes(1);
  });
});

describe('registerBuiltInProviders', () => {
  it('registers every built-in provider by default, ParkStay among them, each with a context built from its own manifest', () => {
    const ids = BUILT_IN_PROVIDERS.map((factory) => factory.id);
    expect(BUILT_IN_PROVIDERS).toContain(parkstayFactory);
    expect(new Set(ids).size).toBe(ids.length);
    const registry = new ProviderRegistry();
    const makeContext = jest.fn(createTestProviderContext);

    const result = registerBuiltInProviders(registry, makeContext);

    expect(result).toEqual({ registered: ids, failed: [] });
    expect(
      registry
        .list()
        .map((m) => m.id)
        .sort()
    ).toEqual([...ids].sort());
    const contexts = makeContext.mock.results.map((r) => r.value as ProviderContext);
    expect(contexts.map((ctx) => ctx.id)).toEqual(ids);
    expect(contexts.find((ctx) => ctx.id === 'parkstay')).toMatchObject({
      timezone: 'Australia/Perth',
      limits: { minWatchIntervalMinutes: 15 },
    });
  });

  it('keeps going past a provider whose factory or context throws, and logs it by name', () => {
    const logger = createMemoryLogger();
    const registry = new ProviderRegistry();
    const broken = defineProvider(testManifest('broken'), () => {
      throw new Error('bad config');
    });
    const noContext = createFakeProvider({ id: 'no-context' });
    const fake = createFakeProvider();

    const result = registerBuiltInProviders(
      registry,
      (manifest) => {
        if (manifest.id === 'no-context') throw new Error('partition unavailable');
        return createTestProviderContext(manifest);
      },
      { factories: [broken, noContext.factory, fake.factory], logger }
    );

    expect(result.registered).toEqual(['fake']);
    expect(result.failed.map((e) => [e.constructor.name, e.providerId])).toEqual([
      ['ProviderRegistrationError', 'broken'],
      ['ProviderRegistrationError', 'no-context'],
    ]);
    expect(logger.lines.map((l) => l.message)).toEqual([
      'Provider "broken" could not be registered: its factory threw: bad config',
      'Provider "no-context" could not be registered: its context could not be built: partition unavailable',
    ]);
    expect(registry.get('fake').holds).toBe(fake.holds);
  });
});
