/**
 * The core names no unit it does not know (R9): a provider without holds "cannot hold
 * automatically", a held snipe "already has a hold", a missing snipe is "Snipe not found" (it
 * names the record), and the held unit's kind reaches its alert, so a cabin reads "Cabin held".
 */
import { SnipeStatus } from '@shared/types/common.types';
import type { SiteSnipeInput } from '@shared/types';
import { createCoreHarness, fakeDateOnly, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider } from '@tests/utils/fake-provider';

const NOW = new Date('2026-10-04T02:00:00.000Z');

/** A free cabin at a place of campsites and cabins. */
const CABINS: Parameters<typeof createFakeProvider>[0] = {
  availability: { '1': { s1: 'booked', c1: 'available' } },
  unitKinds: { s1: 'campsite', c1: 'cabin' },
};

describe('core messages without a unit noun', () => {
  let h: CoreHarness;

  afterEach(async () => {
    await h.close();
    jest.useRealTimers();
  });

  function setUp(options: Parameters<typeof createFakeProvider>[0] = {}): void {
    fakeDateOnly(NOW);
    h = createCoreHarness({ providers: [createFakeProvider(options)] });
  }

  async function heldSnipe(input: Partial<SiteSnipeInput> = {}) {
    const snipe = await h.snipes.create(h.userId, h.snipeInput(input));
    h.snipeRepo.updateStatus(snipe.id, SnipeStatus.SNIPING);
    await h.snipes.execute(snipe.id);
    return snipe;
  }

  it('a provider without holds "cannot hold automatically", whatever its units are', async () => {
    setUp({ ...CABINS, capabilities: { holds: false, snipes: false } });
    // Stored while the provider could hold (the service now refuses autoHold for it)
    const watch = h.watchRepo.create(h.userId, h.watchInput({ autoHold: true }));
    await h.watches.execute(watch.id);

    expect(h.notifications.notifyWatchFound).toHaveBeenCalledWith(
      expect.objectContaining({ id: watch.id }),
      expect.any(Array),
      'Fake cannot hold automatically',
      expect.anything()
    );
  });

  it('a watch’s automatic hold hands the held unit, with its kind, to the alert', async () => {
    setUp({ ...CABINS, account: 'signed-in' });
    const watch = await h.watches.create(
      h.userId,
      h.watchInput({ autoHold: true, unitKinds: ['cabin'] })
    );
    await h.watches.execute(watch.id);

    expect(h.notifications.notifyWatchHeld).toHaveBeenCalledWith(
      expect.objectContaining({ id: watch.id }),
      expect.objectContaining({ unitId: 'c1' }),
      expect.objectContaining({ unitId: 'c1', unitKind: 'cabin' }),
      expect.anything()
    );
  });

  it('a snipe’s hold tells the alert the held unit’s kind', async () => {
    setUp({ ...CABINS, account: 'signed-in' });
    const snipe = await heldSnipe({ unitKinds: ['cabin'] });

    expect(h.notifications.notifySnipeHeld).toHaveBeenCalledWith(
      expect.objectContaining({ id: snipe.id, holdUnitId: 'c1' }),
      'cabin'
    );
  });

  it('a held snipe "already has a hold"; a missing one is "Snipe not found"', async () => {
    setUp({ ...CABINS, account: 'signed-in' });
    const snipe = await heldSnipe({ unitKinds: ['cabin'] });

    await expect(h.snipes.activate(snipe.id)).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'This snipe already has a hold',
    });
    await expect(h.snipes.activate(999)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Snipe not found',
    });
    await expect(h.snipes.deactivate(999)).rejects.toMatchObject({ message: 'Snipe not found' });
    await expect(h.snipes.execute(999)).resolves.toMatchObject({
      result: { error: 'Snipe not found' },
    });
  });
});
