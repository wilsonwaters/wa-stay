/**
 * Experiments (R17): a provider declares them in its manifest, the person's choice is the
 * `provider_state` row `core.experiments`, and `registerBuiltInProviders` applies the ones
 * turned on before the registry parses and freezes the manifest, so they take effect after a
 * restart. Here with a FakeProvider whose holds sit behind an experiment (`autoCart`), as RAC's
 * will: its factory hands over the holds module only when `ctx.manifest` has holds on.
 */

import type Database from 'better-sqlite3';
import { openDatabase } from '@main/database/connection';
import { ProviderStateRepository } from '@main/database/repositories';
import { BUILT_IN_PROVIDERS, registerBuiltInProviders } from '@main/providers';
import {
  applyExperiments,
  EXPERIMENTS_STATE_KEY,
  ProviderExperiments,
  withExperiments,
} from '@main/providers/experiments';
import { parkstayFactory } from '@main/providers/parkstay';
import { providerViolations, ProviderRegistry } from '@main/providers/registry';
import { UnknownProviderError } from '@main/providers/sdk';
import { AppError } from '@main/utils/app-error';
import type { ProviderExperiment } from '@shared/types/provider.types';
import {
  createFakeProvider,
  createMemoryLogger,
  createTestProviderContext,
  type FakeProvider,
  type MemoryLogger,
} from '@tests/utils/fake-provider';

const AUTO_CART: ProviderExperiment = {
  id: 'autoCart',
  label: 'Hold a stay in the cart',
  description: 'When a watch finds your stay, WA Stay puts it in the cart for you.',
  warning: 'Only after a booking of your own has worked.',
  turnsOn: ['holds'],
};

/** Holds behind `autoCart` (built, handed over only when on); no Site Sniper. */
function cartProvider(options: Parameters<typeof createFakeProvider>[0] = {}): FakeProvider {
  return createFakeProvider({
    id: 'expstay',
    shortName: 'ExpStay',
    capabilities: { snipes: false },
    experiments: [AUTO_CART],
    ...options,
  });
}

describe('built-in providers ship every experiment off', () => {
  it.each(BUILT_IN_PROVIDERS.map((factory) => [factory.id, factory] as const))(
    '%s marks no experiment applied, and keeps what each turns on off',
    (_id, factory) => {
      const { capabilities, experiments = [] } = factory.manifest;
      expect(experiments.filter((e) => e.applied).map((e) => e.id)).toEqual([]);
      for (const experiment of experiments) {
        expect(experiment.turnsOn.filter((capability) => capabilities[capability])).toEqual([]);
      }
    }
  );
});

describe('experiments', () => {
  let db: Database.Database;
  let state: ProviderStateRepository;
  let registry: ProviderRegistry;
  let logger: MemoryLogger;
  let isBusy: jest.Mock;
  let experiments: ProviderExperiments;

  beforeEach(() => {
    db = openDatabase(':memory:');
    state = new ProviderStateRepository(db);
    registry = new ProviderRegistry();
    logger = createMemoryLogger();
    isBusy = jest.fn().mockReturnValue(false);
    experiments = new ProviderExperiments({ state, providers: registry, isBusy, logger });
  });

  afterEach(async () => {
    await registry.disposeAll();
    db.close();
  });

  const store = (value: unknown, providerId = 'expstay') =>
    state.set(providerId, EXPERIMENTS_STATE_KEY, value);
  const stored = (providerId = 'expstay') => state.get(providerId, EXPERIMENTS_STATE_KEY);
  /** Registers like the container does: each provider with the experiments turned on. */
  const start = (...providers: FakeProvider[]) =>
    registerBuiltInProviders(registry, (manifest) => createTestProviderContext(manifest), {
      factories: providers.map((p) => p.factory),
      logger,
      experiments,
    });
  const lines = (level: string) =>
    logger.lines.filter((line) => line.level === level).map((line) => line.message);

  describe('applied at registration', () => {
    it('off (nothing stored): holds are off in the manifest and ctx.manifest, and there is no holds module', () => {
      const fake = cartProvider();
      expect(start(fake).registered).toEqual(['expstay']);

      const provider = registry.get('expstay');
      expect(provider.manifest.capabilities.holds).toBe(false);
      expect(fake.ctx!.manifest.capabilities.holds).toBe(false);
      expect(provider.holds).toBeUndefined();
      expect(registry.withCapability('holds')).toEqual([]);
      expect(provider.manifest.experiments).toEqual([AUTO_CART]);
      expect(experiments.list('expstay')).toEqual([
        { id: 'autoCart', enabled: false, active: false },
      ]);
    });

    it('on: holds are on in the frozen manifest and ctx.manifest, and the module is there', () => {
      store({ autoCart: true });
      const fake = cartProvider();
      start(fake);

      const provider = registry.get('expstay');
      expect(provider.manifest.capabilities.holds).toBe(true);
      expect(fake.ctx!.manifest.capabilities.holds).toBe(true);
      expect(provider.holds).toBe(fake.holds);
      expect(registry.require('expstay', 'holds')).toBe(provider);
      expect(provider.manifest.experiments).toEqual([{ ...AUTO_CART, applied: true }]);
      expect(Object.isFrozen(provider.manifest)).toBe(true);
      expect(Object.isFrozen(provider.manifest.capabilities)).toBe(true);
      expect(Object.isFrozen(provider.manifest.experiments![0])).toBe(true);
      expect(experiments.list('expstay')).toEqual([
        { id: 'autoCart', enabled: true, active: true },
      ]);
      // The declared factory is unchanged: the next start reads the choice again
      expect(fake.factory.manifest.capabilities.holds).toBe(false);
    });

    it('a stored id the manifest no longer declares is ignored, with a warning; the next write drops it', () => {
      store({ autoCart: false, oldCart: true });
      start(cartProvider());

      expect(registry.get('expstay').manifest.capabilities.holds).toBe(false);
      expect(lines('warn')).toEqual([
        'Experiment oldCart of expstay is no longer declared; ignored',
      ]);
      expect(experiments.list('expstay')).toEqual([
        { id: 'autoCart', enabled: false, active: false },
      ]);

      experiments.set('expstay', 'autoCart', true);
      expect(stored()).toEqual({ autoCart: true });
    });

    it('an experiment whose module is missing: registered without it, logged, failed: true', () => {
      store({ autoCart: true });
      // No holds module is built, so registering with holds on fails
      const fake = cartProvider({ capabilities: { snipes: false, holds: false } });
      const result = start(fake);

      expect(result).toEqual({ registered: ['expstay'], failed: [] });
      const provider = registry.get('expstay');
      expect(provider.manifest.capabilities.holds).toBe(false);
      expect(provider.holds).toBeUndefined();
      expect(fake.ctx!.manifest.capabilities.holds).toBe(false);
      expect(lines('error')).toEqual([
        expect.stringMatching(
          /^Provider expstay could not start with experiment autoCart, so it starts without: .*capability holds needs holds\.create/
        ),
      ]);
      expect(experiments.list('expstay')).toEqual([
        { id: 'autoCart', enabled: true, active: false, failed: true },
      ]);
      // Turned off, it no longer reads failed
      experiments.set('expstay', 'autoCart', false);
      expect(experiments.list('expstay')).toEqual([
        { id: 'autoCart', enabled: false, active: false },
      ]);
    });

    it('a provider that cannot register at all fails as before, with or without its experiments', () => {
      store({ autoCart: true });
      const broken = cartProvider();
      delete (broken as { links?: unknown }).links;
      const result = start(broken, createFakeProvider({ id: 'other' }));

      expect(result.registered).toEqual(['other']);
      expect(result.failed.map((f) => f.providerId)).toEqual(['expstay']);
      expect(() => experiments.list('expstay')).toThrow(UnknownProviderError);
      expect(stored()).toEqual({ autoCart: true });
    });

    it('a built-in whose own manifest marks an experiment applied is refused: experiments ship off', () => {
      const fake = cartProvider();
      const result = start({
        ...fake,
        factory: withExperiments(fake.factory, ['autoCart']),
      } as FakeProvider);

      expect(result.registered).toEqual([]);
      expect(result.failed.map((f) => f.message)).toEqual([
        'Provider "expstay" could not be registered: its manifest marks experiment autoCart applied, but experiments ship off',
      ]);
      expect(registry.tryGet('expstay')).toBeUndefined();
    });

    it('a provider without experiments (ParkStay) registers as it always has', () => {
      start(createFakeProvider({ id: 'plain' }));
      registerBuiltInProviders(registry, (m) => createTestProviderContext(m), {
        factories: [parkstayFactory],
        experiments,
      });

      expect(registry.get('parkstay').manifest).toEqual(parkstayFactory.manifest);
      expect(registry.get('parkstay').manifest.experiments).toBeUndefined();
      expect(experiments.list('parkstay')).toEqual([]);
      expect(experiments.list('plain')).toEqual([]);
      expect(lines('warn')).toEqual([]);
    });

    it.each<[string, unknown]>([
      ['an array', [true]],
      ['a string', 'on'],
      ['an object of strings', { autoCart: 'yes' }],
      ['null', null],
    ])(
      'a stored value that is %s reads as everything off, with a warning; the next change rewrites it',
      (_label, value) => {
        store(value);
        start(cartProvider());

        expect(registry.get('expstay').manifest.capabilities.holds).toBe(false);
        expect(experiments.list('expstay')).toEqual([
          { id: 'autoCart', enabled: false, active: false },
        ]);
        expect(lines('warn')).toContain('Experiments of expstay are not readable; all read as off');

        // Off again, but the row is rewritten
        experiments.set('expstay', 'autoCart', false);
        expect(stored()).toEqual({ autoCart: false });
      }
    );

    it('stored text that is not JSON reads as everything off, with a warning', () => {
      db.prepare(
        "INSERT INTO provider_state (provider_id, key, value, updated_at) VALUES ('expstay', ?, 'not json', '2026-10-01T00:00:00.000Z')"
      ).run(EXPERIMENTS_STATE_KEY);
      start(cartProvider());

      expect(registry.get('expstay').manifest.capabilities.holds).toBe(false);
      expect(lines('warn')).toContain('Experiments of expstay are not readable; all read as off');
      experiments.set('expstay', 'autoCart', true);
      expect(stored()).toEqual({ autoCart: true });
    });
  });

  describe('withExperiments and applyExperiments', () => {
    it('withExperiments(factory, ids): the same factory, its manifest applied (ids it does not declare ignored)', () => {
      const fake = cartProvider();
      const factory = withExperiments(fake.factory, ['autoCart', 'notDeclared']);

      expect(factory.id).toBe('expstay');
      expect(factory.manifest.capabilities.holds).toBe(true);
      expect(factory.manifest.experiments).toEqual([{ ...AUTO_CART, applied: true }]);
      const provider = registry.register(factory, (m) => createTestProviderContext(m));
      expect(provider.holds).toBe(fake.holds);
      expect(fake.ctx!.manifest.capabilities.holds).toBe(true);
      // What R19's contract suite needs: the registered provider is consistent
      expect(providerViolations(provider)).toEqual([]);
      // Registering the applied manifest again (the contract suite does) is a fixed point
      const again = new ProviderRegistry();
      const copy = Object.assign(() => provider, { id: 'expstay', manifest: provider.manifest });
      expect(again.register(copy, (m) => createTestProviderContext(m)).manifest).toEqual(
        provider.manifest
      );
    });

    it('applyExperiments changes nothing without an experiment to apply', () => {
      const { manifest } = cartProvider();
      expect(applyExperiments(manifest, [])).toBe(manifest);
      expect(applyExperiments(manifest, ['notDeclared'])).toBe(manifest);
      const plain = createFakeProvider().manifest;
      expect(applyExperiments(plain, ['autoCart'])).toBe(plain);
    });
  });

  describe('set', () => {
    beforeEach(() => {
      start(cartProvider(), createFakeProvider({ id: 'plain' }));
    });

    it('stores the choice for the next start, logs provider, experiment and on or off, and answers the list', () => {
      expect(experiments.set('expstay', 'autoCart', true)).toEqual([
        { id: 'autoCart', enabled: true, active: false },
      ]);
      expect(stored()).toEqual({ autoCart: true });
      expect(lines('info')).toEqual(['Experiment autoCart of expstay turned on']);
      // Nothing changes in this run
      expect(registry.get('expstay').manifest.capabilities.holds).toBe(false);

      experiments.set('expstay', 'autoCart', false);
      expect(stored()).toEqual({ autoCart: false });
      expect(lines('info')).toEqual([
        'Experiment autoCart of expstay turned on',
        'Experiment autoCart of expstay turned off',
      ]);
    });

    it('setting the stored value writes nothing and gives the same answer', () => {
      experiments.set('expstay', 'autoCart', true);
      const written = state.getEntry('expstay', EXPERIMENTS_STATE_KEY)!.updatedAt;
      const setSpy = jest.spyOn(state, 'set');

      expect(experiments.set('expstay', 'autoCart', true)).toEqual(experiments.list('expstay'));
      expect(setSpy).not.toHaveBeenCalled();
      expect(state.getEntry('expstay', EXPERIMENTS_STATE_KEY)!.updatedAt).toEqual(written);
      expect(lines('info')).toHaveLength(1);
    });

    it('off with nothing stored is the stored value too: no row is written', () => {
      expect(experiments.set('expstay', 'autoCart', false)).toEqual([
        { id: 'autoCart', enabled: false, active: false },
      ]);
      expect(stored()).toBeUndefined();
    });

    it('NOT_FOUND for an experiment the provider does not declare; UnknownProviderError for an unknown provider', () => {
      expect(() => experiments.set('expstay', 'nothing', true)).toThrow(
        expect.objectContaining({ code: 'NOT_FOUND', message: 'ExpStay has no experiment nothing' })
      );
      expect(() => experiments.set('plain', 'autoCart', true)).toThrow(AppError);
      store({ autoCart: true }, 'gone');
      expect(() => experiments.set('gone', 'autoCart', false)).toThrow(UnknownProviderError);
      expect(stored('gone')).toEqual({ autoCart: true });
      expect(stored()).toBeUndefined();
    });

    it('turning off a holds experiment is ACCOUNT_BUSY while a hold or snipe needs the provider; turning on is not', () => {
      isBusy.mockReturnValue(true);
      experiments.set('expstay', 'autoCart', true);

      expect(() => experiments.set('expstay', 'autoCart', false)).toThrow(
        expect.objectContaining({
          code: 'ACCOUNT_BUSY',
          message: 'A stay is held on ExpStay. Pay for it or let it go first.',
        })
      );
      expect(isBusy).toHaveBeenCalledWith('expstay', expect.any(Date));
      expect(stored()).toEqual({ autoCart: true });

      isBusy.mockReturnValue(false);
      experiments.set('expstay', 'autoCart', false);
      expect(stored()).toEqual({ autoCart: false });
    });

    it('turning off an experiment that does not turn on holds is never busy', () => {
      registry.register(
        createFakeProvider({
          id: 'gatestay',
          capabilities: { snipes: false },
          experiments: [{ ...AUTO_CART, id: 'importing', turnsOn: ['bookingImport'] }],
        }).factory,
        (m) => createTestProviderContext(m)
      );
      isBusy.mockReturnValue(true);
      experiments.set('gatestay', 'importing', true);
      expect(experiments.set('gatestay', 'importing', false)).toEqual([
        { id: 'importing', enabled: false, active: false },
      ]);
      expect(isBusy).not.toHaveBeenCalled();
    });
  });

  describe('holdsTurningOff (no new hold before the restart)', () => {
    it('is true only while holds are on through an experiment that is now stored off', () => {
      store({ autoCart: true });
      start(cartProvider(), createFakeProvider({ id: 'plain' }));

      expect(experiments.holdsTurningOff('expstay')).toBe(false);
      experiments.set('expstay', 'autoCart', false);
      expect(experiments.holdsTurningOff('expstay')).toBe(true);
      expect(experiments.list('expstay')).toEqual([
        { id: 'autoCart', enabled: false, active: true },
      ]);
      // On, then off, before a restart: nothing pending
      experiments.set('expstay', 'autoCart', true);
      expect(experiments.holdsTurningOff('expstay')).toBe(false);

      // Providers whose holds are their own, or that are not registered, never turn off
      expect(experiments.holdsTurningOff('plain')).toBe(false);
      expect(experiments.holdsTurningOff('nosuch')).toBe(false);
    });

    it('is false while the experiment is only waiting to turn on', () => {
      start(cartProvider());
      experiments.set('expstay', 'autoCart', true);
      expect(experiments.holdsTurningOff('expstay')).toBe(false);
      experiments.set('expstay', 'autoCart', false);
      expect(experiments.holdsTurningOff('expstay')).toBe(false);
    });

    it('stays false while another stored-on experiment keeps holds on', () => {
      const second = { ...AUTO_CART, id: 'cartToo' };
      store({ autoCart: true, cartToo: true });
      start(cartProvider({ experiments: [AUTO_CART, second] }));

      experiments.set('expstay', 'autoCart', false);
      expect(experiments.holdsTurningOff('expstay')).toBe(false);
      experiments.set('expstay', 'cartToo', false);
      expect(experiments.holdsTurningOff('expstay')).toBe(true);
    });
  });
});
