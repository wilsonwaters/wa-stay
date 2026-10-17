/**
 * One snipe attempt (`SiteSniperService.execute`): check → one-booking-per-night guard →
 * hold, and what each outcome does to the snipe and to the next tick; which unit it holds
 * (the named units, or the first free one of its stay types), and a snipe for "any unit" at a
 * place with more than one stay type, which holds nothing.
 */

import { AccessGateError } from '@main/providers/sdk';
import { RelatedType, SnipeResult, SnipeStatus } from '@shared/types/common.types';
import type { SiteSnipe, SiteSnipeInput } from '@shared/types';
import { createCoreHarness, fakeDateOnly, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider } from '@tests/utils/fake-provider';

const NOW = new Date('2026-10-04T02:00:00.000Z');

describe('snipe attempt', () => {
  let h: CoreHarness;

  afterEach(async () => {
    await h.close();
    jest.useRealTimers();
  });

  async function sniping(
    options: Parameters<typeof createFakeProvider>[0] = {},
    input: Partial<SiteSnipeInput> = {}
  ): Promise<SiteSnipe> {
    fakeDateOnly(NOW);
    h = createCoreHarness({ providers: [createFakeProvider(options)] });
    const snipe = await h.snipes.create(h.userId, h.snipeInput(input));
    h.snipeRepo.updateStatus(snipe.id, SnipeStatus.SNIPING);
    return snipe;
  }

  const stored = (id: number) => h.snipeRepo.findById(id)!;

  it('holds the first free unit: HELD with the reference, expiry, unit and payment URL, and stops', async () => {
    const snipe = await sniping();
    const outcome = await h.snipes.execute(snipe.id);

    expect(outcome.next).toBe('done');
    expect(outcome.result).toMatchObject({ held: true, holdReference: 'FAKE-1' });
    expect(stored(snipe.id)).toMatchObject({
      status: SnipeStatus.HELD,
      isActive: false,
      holdReference: 'FAKE-1',
      holdExpiresAt: new Date(NOW.getTime() + 30 * 60_000),
      holdUnitId: 'u1',
      paymentUrl: 'https://fake.example/pay/FAKE-1',
      attemptsCount: 1,
    });
    expect(h.notifications.notifySnipeHeld).toHaveBeenCalledTimes(1);
  });

  it('no free unit: counted, and the next tick polls again', async () => {
    const snipe = await sniping({ availability: { '1': { u1: 'booked' } } });
    const outcome = await h.snipes.execute(snipe.id);

    expect(outcome).toMatchObject({
      next: 'continue',
      result: { result: SnipeResult.UNAVAILABLE },
    });
    expect(stored(snipe.id)).toMatchObject({ status: SnipeStatus.SNIPING, attemptsCount: 1 });
  });

  it('a hold in progress is transient: retried next tick and not counted', async () => {
    const snipe = await sniping();
    h.fake.scriptHold({ ok: false, reason: 'in-progress', message: 'A booking is in progress' });
    const outcome = await h.snipes.execute(snipe.id);

    expect(outcome.next).toBe('continue');
    expect(stored(snipe.id)).toMatchObject({ status: SnipeStatus.SNIPING, attemptsCount: 0 });
  });

  it('auth-required ends the snipe as FAILED, "Sign in to Fake", not retried', async () => {
    const snipe = await sniping();
    h.fake.scriptHold({ ok: false, reason: 'auth-required', message: 'Sign in' });
    const outcome = await h.snipes.execute(snipe.id);

    expect(outcome.next).toBe('done');
    expect(stored(snipe.id)).toMatchObject({
      status: SnipeStatus.FAILED,
      isActive: false,
      lastError: 'Sign in to Fake',
    });
  });

  it('the race lost (taken) is counted and tried again', async () => {
    const snipe = await sniping();
    h.fake.scriptHold({ ok: false, reason: 'taken', message: 'Gone' });
    const outcome = await h.snipes.execute(snipe.id);

    expect(outcome.next).toBe('continue');
    expect(stored(snipe.id)).toMatchObject({
      lastResult: SnipeResult.UNAVAILABLE,
      attemptsCount: 1,
    });
  });

  it("the provider's queue in the way: QUEUE_FULL, not counted, and the scheduler is told", async () => {
    const snipe = await sniping();
    h.fake.failNext('availability', new AccessGateError('fake', 'waiting'));
    const outcome = await h.snipes.execute(snipe.id);

    expect(outcome.next).toBe('access-gate');
    expect(stored(snipe.id)).toMatchObject({
      lastResult: SnipeResult.QUEUE_FULL,
      attemptsCount: 0,
    });
  });

  it('another snipe holding a shared night ends this one as FAILED with a clear message', async () => {
    const snipe = await sniping();
    const other = h.snipeRepo.create(h.userId, {
      ...h.snipeInput({ stay: { arrival: '2026-12-02', departure: '2026-12-04', adults: 2 } }),
    });
    h.snipeRepo.markHeld(other.id, 'FAKE-0', new Date(NOW.getTime() + 30 * 60_000));
    const outcome = await h.snipes.execute(snipe.id);

    expect(outcome.next).toBe('done');
    expect(h.fake.calls.filter((c) => c.module === 'holds')).toHaveLength(0);
    expect(stored(snipe.id)).toMatchObject({
      status: SnipeStatus.FAILED,
      lastError: expect.stringContaining('one booking per night'),
    });
  });

  it('only a SNIPING snipe is attempted on a tick; a manual run works before the release', async () => {
    const snipe = await sniping();
    h.snipeRepo.updateStatus(snipe.id, SnipeStatus.ARMED);

    await expect(h.snipes.execute(snipe.id)).resolves.toMatchObject({ next: 'done' });
    expect(h.fake.calls.filter((c) => c.module === 'availability')).toHaveLength(0);
    await expect(h.snipes.execute(snipe.id, { manual: true })).resolves.toMatchObject({
      result: { held: true },
    });
  });

  it('maximum attempts reached: EXPIRED', async () => {
    const snipe = await sniping({ availability: { '1': { u1: 'booked' } } });
    h.db
      .prepare('UPDATE site_snipes SET max_attempts = 1, attempts_count = 1 WHERE id = ?')
      .run(snipe.id);
    const outcome = await h.snipes.execute(snipe.id);

    expect(outcome.next).toBe('done');
    expect(stored(snipe.id)).toMatchObject({ status: SnipeStatus.EXPIRED, isActive: false });
  });

  describe('stay types', () => {
    // A free campsite listed first, then a free cabin and a booked dorm bed
    const mixedPlace: Parameters<typeof createFakeProvider>[0] = {
      availability: { '1': { s1: 'available', c1: 'available', d1: 'booked' } },
      unitKinds: { s1: 'campsite', c1: 'cabin', d1: 'dorm' },
    };
    const MIXED_ERROR =
      'Free units of more than one stay type: choose a stay type or units for this snipe';

    it("with unitKinds ['cabin'] it holds a cabin, even when a free site is listed first", async () => {
      const snipe = await sniping(mixedPlace, { unitKinds: ['cabin'] });
      expect(snipe.unitKinds).toEqual(['cabin']);
      const outcome = await h.snipes.execute(snipe.id);

      const holds = h.fake.calls.filter((c) => c.module === 'holds');
      expect(holds).toHaveLength(1);
      expect(holds[0].args[0]).toMatchObject({ unitId: 'c1' });
      expect(outcome.result).toMatchObject({ held: true, matchedSiteId: 'c1' });
      expect(stored(snipe.id)).toMatchObject({ status: SnipeStatus.HELD, holdUnitId: 'c1' });
    });

    it('an ambiguous snipe ends FAILED, with no hold, no night reserved and one warning', async () => {
      const snipe = await sniping(mixedPlace);
      const create = jest.spyOn(h.registry.get('fake').holds!, 'create');
      const reserve = jest.spyOn(h.nightGuard, 'tryReserve');
      h.events.emit.mockClear();
      const outcome = await h.snipes.execute(snipe.id);

      expect(outcome).toMatchObject({
        next: 'done',
        result: { result: SnipeResult.ERROR, held: false, error: MIXED_ERROR },
      });
      expect(create).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
      expect(stored(snipe.id)).toMatchObject({
        status: SnipeStatus.FAILED,
        lastResult: SnipeResult.ERROR,
        lastError: MIXED_ERROR,
        isActive: false,
        attemptsCount: 1,
      });
      expect(h.events.emit).toHaveBeenCalledWith(
        'snipe:updated',
        expect.objectContaining({ id: snipe.id, status: SnipeStatus.FAILED })
      );
      expect(h.notifications.notifyWarning).toHaveBeenCalledTimes(1);
      expect(h.notifications.notifyWarning).toHaveBeenCalledWith(
        h.userId,
        'Snipe stopped at Banksia Camp',
        `${MIXED_ERROR}.`,
        {
          providerId: 'fake',
          relatedType: RelatedType.SNIPE,
          relatedId: snipe.id,
          locationName: 'Banksia Camp',
        }
      );
      expect(h.notifications.notifySnipeHeld).not.toHaveBeenCalled();
    });

    it('two kinds are ambiguous too; units named are not, and kinds do not apply to them', async () => {
      const twoKinds = await sniping(mixedPlace, { unitKinds: ['campsite', 'cabin'] });
      await h.snipes.execute(twoKinds.id);
      expect(stored(twoKinds.id)).toMatchObject({
        status: SnipeStatus.FAILED,
        lastError: MIXED_ERROR,
      });
      await h.close();

      const named = await sniping(mixedPlace, { unitIds: ['d1', 's1'], unitKinds: ['cabin'] });
      await h.snipes.execute(named.id);
      expect(h.fake.calls.filter((c) => c.module === 'holds')[0].args[0]).toMatchObject({
        unitId: 's1',
      });
      expect(stored(named.id).status).toBe(SnipeStatus.HELD);
    });

    it('a cabin snipe where no cabin is free keeps polling; a provider without kinds is never ambiguous', async () => {
      const cabins = await sniping(
        { ...mixedPlace, availability: { '1': { s1: 'available', c1: 'booked' } } },
        { unitKinds: ['cabin'] }
      );
      await expect(h.snipes.execute(cabins.id)).resolves.toMatchObject({
        next: 'continue',
        result: { result: SnipeResult.UNAVAILABLE },
      });
      expect(h.fake.calls.filter((c) => c.module === 'holds')).toHaveLength(0);
      await h.close();

      // No kinds at all: every unit is `other`, so "any unit" holds the first free one
      const plain = await sniping({ availability: { '1': { u1: 'available', u2: 'available' } } });
      await expect(h.snipes.execute(plain.id)).resolves.toMatchObject({ result: { held: true } });
    });

    it('drops duplicate kinds at create and update', async () => {
      const snipe = await sniping({}, { unitKinds: ['cabin', 'cabin', 'dorm'] });
      expect(snipe.unitKinds).toEqual(['cabin', 'dorm']);
      await expect(
        h.snipes.update(snipe.id, { unitKinds: ['glamping', 'glamping'] })
      ).resolves.toMatchObject({ unitKinds: ['glamping'] });
    });
  });

  describe('stay rules (R8)', () => {
    it('never holds a fullyAvailable unit whose stay its rules refuse, and holds the next one', async () => {
      const snipe = await sniping({ availability: { '1': { u1: 'available', u2: 'available' } } });
      const check = h.fake.availability!.check.bind(h.fake.availability);
      // The provider's mistake: u1 says fullyAvailable under its own 3-night minimum (the
      // snipe is 2 nights), and u2 arrives on a day that takes no arrivals
      const mistaken = (units: string[]) =>
        jest.spyOn(h.fake.availability!, 'check').mockImplementation(async (...args) => {
          const answer = await check(...args);
          return {
            ...answer,
            units: answer.units
              .filter((unit) => units.includes(unit.unitId))
              .map((unit) =>
                unit.unitId === 'u1'
                  ? { ...unit, minNights: 3 }
                  : unit.unitId === 'u2'
                    ? {
                        ...unit,
                        nights: [
                          { ...unit.nights[0], noArrival: true as const },
                          ...unit.nights.slice(1),
                        ],
                      }
                    : unit
              ),
          };
        });

      mistaken(['u1', 'u2']);
      const refused = await h.snipes.execute(snipe.id);
      expect(refused).toMatchObject({
        next: 'continue',
        result: { result: SnipeResult.UNAVAILABLE, held: false },
      });
      expect(h.fake.calls.filter((c) => c.module === 'holds')).toEqual([]);
      expect(stored(snipe.id)).toMatchObject({ status: SnipeStatus.SNIPING, attemptsCount: 1 });

      // With a third unit that meets the rules, that one is held
      jest.restoreAllMocks();
      h.fake.setAvailability('1', { u1: 'available', u2: 'available', u3: 'available' });
      mistaken(['u1', 'u2', 'u3']);
      const held = await h.snipes.execute(snipe.id);
      expect(held.result).toMatchObject({ held: true, matchedSiteId: 'u3' });
      expect(stored(snipe.id)).toMatchObject({ status: SnipeStatus.HELD, holdUnitId: 'u3' });
    });
  });

  it('writes nothing once aborted mid-check', async () => {
    const snipe = await sniping({ delayMs: 5_000 });
    const controller = new AbortController();
    const running = h.snipes.execute(snipe.id, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    await expect(running).resolves.toMatchObject({ next: 'done' });
    expect(stored(snipe.id)).toMatchObject({ status: SnipeStatus.SNIPING, attemptsCount: 0 });
    expect(stored(snipe.id).lastCheckedAt).toEqual(NOW); // set at create, unchanged
  });
});
