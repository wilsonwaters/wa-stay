/**
 * When the person's saved details for a provider change (R16: an RAC member number saved,
 * replaced or removed), the container's `onCredentialsChanged` makes that provider's
 * availability be asked again and its snipes ask for their release again. These are the two
 * core pieces it calls, on FakeProviders, with another provider alongside that must be left
 * alone:
 *
 * - `LocationCatalogService.forgetAvailability(providerId)`: the provider's bulk and
 *   per-location answers are asked again; an answer in flight then still answers its caller
 *   but is not kept, and a new call does not join it; the other provider's stay cached.
 * - `JobScheduler.rearmSnipes(providerId)`: the provider's armed `daily_rollover` snipes ask
 *   for their release instant again (a scheduled one has nothing to ask); the other provider's
 *   are not asked; nothing happens before the scheduler starts.
 */

import type Database from 'better-sqlite3';
import { LocationCatalogService } from '@main/core/catalog/location-catalog.service';
import { openDatabase } from '@main/database/connection';
import { LocationRepository, ProviderStateRepository } from '@main/database/repositories';
import { ProviderRegistry } from '@main/providers/registry';
import { SnipeReleaseMode, SnipeStatus } from '@shared/types/common.types';
import type { StayQuery } from '@shared/types/provider.types';
import { createCoreHarness, type CoreHarness } from '@tests/utils/core-harness';
import {
  createFakeProvider,
  createMemoryLogger,
  createTestProviderContext,
  FIXED_NOW,
  type FakeProvider,
} from '@tests/utils/fake-provider';

const STAY: StayQuery = { arrival: '2026-11-10', departure: '2026-11-12', adults: 2 };

describe('forgetting one provider’s availability (LocationCatalogService)', () => {
  let db: Database.Database;
  let registry: ProviderRegistry;
  let fake: FakeProvider;
  let other: FakeProvider;
  let catalog: LocationCatalogService;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    registry = new ProviderRegistry();
    fake = createFakeProvider();
    other = createFakeProvider({ id: 'other' });
    registry.register(fake.factory, createTestProviderContext);
    registry.register(other.factory, createTestProviderContext);
    catalog = new LocationCatalogService({
      registry,
      locations: new LocationRepository(db),
      providerState: new ProviderStateRepository(db),
      events: { emit: jest.fn() },
      logger: createMemoryLogger(),
      clock: () => FIXED_NOW,
    });
    await catalog.sync();
  });

  afterEach(async () => {
    catalog.stop();
    await registry.disposeAll();
    db.close();
  });

  const asked = (provider: FakeProvider, method: 'check' | 'search') =>
    provider.calls.filter((call) => call.module === 'availability' && call.method === method)
      .length;

  it("asks the provider again for checks and bulk availability; the other provider's answers stay", async () => {
    for (const id of ['fake', 'other']) {
      await catalog.checkLocation(`${id}:1`, STAY);
      await catalog.availability(STAY, { providerIds: [id] });
    }
    // Cached: asking again sends nothing
    await catalog.checkLocation('fake:1', STAY);
    await catalog.availability(STAY);
    expect([asked(fake, 'check'), asked(fake, 'search')]).toEqual([1, 1]);

    catalog.forgetAvailability('fake');
    await catalog.checkLocation('fake:1', STAY);
    await catalog.checkLocation('other:1', STAY);
    const result = await catalog.availability(STAY);
    expect(result.errors).toEqual([]);
    expect([asked(fake, 'check'), asked(fake, 'search')]).toEqual([2, 2]);
    expect([asked(other, 'check'), asked(other, 'search')]).toEqual([1, 1]);
  });

  it('an answer in flight still answers its caller, but is not kept', async () => {
    fake.delayMs = 30;
    const check = catalog.checkLocation('fake:1', STAY);
    const bulk = catalog.availability(STAY, { providerIds: ['fake'] });
    catalog.forgetAvailability('fake');
    await expect(check).resolves.toMatchObject({ key: 'fake:1' });
    await expect(bulk).resolves.toMatchObject({ errors: [] });
    expect([asked(fake, 'check'), asked(fake, 'search')]).toEqual([1, 1]);

    // Asked again: the answers that were in flight were not kept
    fake.delayMs = 0;
    await catalog.checkLocation('fake:1', STAY);
    await catalog.availability(STAY, { providerIds: ['fake'] });
    expect([asked(fake, 'check'), asked(fake, 'search')]).toEqual([2, 2]);
    // These were: asked once more, nothing is sent
    await catalog.checkLocation('fake:1', STAY);
    await catalog.availability(STAY, { providerIds: ['fake'] });
    expect([asked(fake, 'check'), asked(fake, 'search')]).toEqual([2, 2]);
  });

  it('a call made after it does not join one in flight from before', async () => {
    fake.delayMs = 30;
    const before = [
      catalog.checkLocation('fake:1', STAY),
      catalog.availability(STAY, { providerIds: ['fake'] }),
    ];
    catalog.forgetAvailability('fake');
    const after = [
      catalog.checkLocation('fake:1', STAY),
      catalog.availability(STAY, { providerIds: ['fake'] }),
    ];
    await Promise.all([...before, ...after]);
    expect([asked(fake, 'check'), asked(fake, 'search')]).toEqual([2, 2]);
    // The later call's answers are kept
    fake.delayMs = 0;
    await catalog.checkLocation('fake:1', STAY);
    await catalog.availability(STAY, { providerIds: ['fake'] });
    expect([asked(fake, 'check'), asked(fake, 'search')]).toEqual([2, 2]);
  });
});

describe("re-arming one provider's snipes (JobScheduler.rearmSnipes)", () => {
  let h: CoreHarness;
  let other: FakeProvider;

  beforeEach(() => {
    other = createFakeProvider({ id: 'other' });
    h = createCoreHarness({ providers: [createFakeProvider(), other] });
  });

  afterEach(() => h.close());

  const computes = (provider: FakeProvider) =>
    provider.calls.filter((call) => call.method === 'computeReleaseAt').length;
  /** Until `predicate` holds (real timers), at most 5 s. */
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 500 && !predicate(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(predicate()).toBe(true);
  };
  /** A year ahead: armed, its release (180 days before) still to come. */
  const AHEAD = { arrival: '2027-12-01', departure: '2027-12-03', adults: 2 };

  it("asks the provider's daily-rollover snipes for their release again, and no other's", async () => {
    const rolling = await h.snipes.create(
      h.userId,
      h.snipeInput({ stay: AHEAD, releaseMode: SnipeReleaseMode.DAILY_ROLLOVER })
    );
    const scheduled = await h.snipes.create(
      h.userId,
      h.snipeInput({
        stay: AHEAD,
        releaseMode: SnipeReleaseMode.SCHEDULED,
        releaseAt: new Date('2027-06-01T02:00:00.000Z'),
      })
    );
    const elsewhere = await h.snipes.create(
      h.userId,
      h.snipeInput({
        providerId: 'other',
        stay: AHEAD,
        releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
      })
    );
    // Nothing happens before the scheduler runs
    const created = [computes(h.fake), computes(other)];
    h.scheduler.rearmSnipes('fake');
    expect([computes(h.fake), computes(other)]).toEqual(created);

    h.scheduler.start();
    const armed = () =>
      [rolling, scheduled, elsewhere].every(
        (s) => h.snipeRepo.findById(s.id)?.status === SnipeStatus.ARMED
      );
    await until(armed);
    await new Promise((r) => setTimeout(r, 20));
    const started = [computes(h.fake), computes(other)];

    h.scheduler.rearmSnipes('fake');
    await until(() => computes(h.fake) === started[0] + 1);
    await new Promise((r) => setTimeout(r, 20));
    expect([computes(h.fake), computes(other)]).toEqual([started[0] + 1, started[1]]);
    expect(armed()).toBe(true);
    for (const snipe of [rolling, scheduled, elsewhere]) {
      expect(h.scheduler.snipeRunner.isScheduled(snipe.id)).toBe(true);
    }
  });
});
