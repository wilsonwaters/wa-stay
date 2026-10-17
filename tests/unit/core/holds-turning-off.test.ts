/**
 * A holds experiment turned off (R17): the provider's holds stay on until WA Stay restarts, but
 * no new hold is placed meanwhile (`holdsTurningOff`). A watch's auto-hold notifies the match
 * as usual, with a note; a hold snipe alerts instead of holding (ALERTED, no night reserved).
 */

import { SnipeResult, SnipeStatus, WatchResult } from '@shared/types/common.types';
import { createCoreHarness, fakeDateOnly, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider } from '@tests/utils/fake-provider';

const NOW = new Date('2026-10-04T02:00:00.000Z');
const NOTE = 'Automatic holds on Fake are turning off. Restart WA Stay.';
const HOLDS_OFF = 'Automatic holds are off for Fake, so Site Sniper alerted you instead.';

describe('holds turning off (an experiment turned off, until the restart)', () => {
  let h: CoreHarness;
  let turningOff: jest.Mock;

  beforeEach(() => {
    fakeDateOnly(NOW);
    turningOff = jest.fn().mockReturnValue(true);
    h = createCoreHarness({
      providers: [createFakeProvider({ availability: { '1': { u1: 'available' } } })],
      holdsTurningOff: turningOff,
    });
  });

  afterEach(async () => {
    await h.close();
    jest.useRealTimers();
  });

  const holdCalls = () => h.fake.calls.filter((c) => c.module === 'holds');

  /** An auto-hold watch created while holds were on, checked now that they are turning off. */
  async function autoHoldWatch() {
    turningOff.mockReturnValue(false);
    const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));
    turningOff.mockClear().mockReturnValue(true);
    return watch;
  }

  it("a watch's auto-hold places no hold, notes why, and the watch alerts as usual", async () => {
    const watch = await autoHoldWatch();
    const reserve = jest.spyOn(h.nightGuard, 'tryReserve');
    const result = await h.watches.execute(watch.id);

    expect(turningOff).toHaveBeenCalledWith('fake');
    expect(holdCalls()).toEqual([]);
    expect(reserve).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, found: true });
    expect(result.hold).toBeUndefined();
    expect(h.watchRepo.findById(watch.id)).toMatchObject({
      lastResult: WatchResult.FOUND,
      lastError: NOTE,
    });
    expect(h.notifications.notifyWatchFound).toHaveBeenCalledWith(
      expect.objectContaining({ id: watch.id }),
      expect.any(Array),
      NOTE,
      expect.any(String)
    );
    expect(h.notifications.notifyWatchHeld).not.toHaveBeenCalled();

    // Turned back on before the restart: it holds again
    turningOff.mockReturnValue(false);
    await h.watches.execute(watch.id, { manual: true });
    expect(holdCalls()).toHaveLength(1);
    expect(h.watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.HELD);
  });

  it('a new watch cannot be set to hold (VALIDATION on autoHold), as a new hold snipe cannot', async () => {
    const before = h.watchRepo.findByUserId(h.userId).length;
    await expect(
      h.watches.create(h.userId, h.watchInput({ autoHold: true }))
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'Automatic holds on Fake are turning off, so turn off the automatic hold',
      issues: ['autoHold'],
    });
    expect(h.watchRepo.findByUserId(h.userId)).toHaveLength(before);
    await expect(h.snipes.create(h.userId, h.snipeInput({ action: 'hold' }))).rejects.toMatchObject(
      { code: 'VALIDATION', issues: ['action'] }
    );

    // Nor turned on by an edit; a watch that holds already keeps doing so, and may be edited
    const plain = await h.watches.create(h.userId, h.watchInput());
    await expect(h.watches.update(plain.id, { autoHold: true })).rejects.toMatchObject({
      code: 'VALIDATION',
      issues: ['autoHold'],
    });
    expect(h.watchRepo.findById(plain.id)?.autoHold).toBe(false);
    const holding = await autoHoldWatch();
    await expect(
      h.watches.update(holding.id, { autoHold: true, name: 'Renamed' })
    ).resolves.toMatchObject({ autoHold: true, name: 'Renamed' });
    // Off is always allowed
    await expect(h.watches.update(holding.id, { autoHold: false })).resolves.toMatchObject({
      autoHold: false,
    });
  });

  it('a watch without auto-hold is not asked', async () => {
    const watch = await h.watches.create(h.userId, h.watchInput());
    await h.watches.execute(watch.id);

    expect(turningOff).not.toHaveBeenCalled();
    expect(h.notifications.notifyWatchFound.mock.calls[0][2]).toBeUndefined();
  });

  /** A hold snipe created while holds were on, sniping now that they are turning off. */
  async function holdSnipe() {
    turningOff.mockReturnValue(false);
    const snipe = await h.snipes.create(h.userId, h.snipeInput({ action: 'hold' }));
    h.snipeRepo.updateStatus(snipe.id, SnipeStatus.SNIPING);
    turningOff.mockClear().mockReturnValue(true);
    return snipe;
  }

  it('a hold snipe that finds a free unit holds nothing: it alerts, with the booking page and why', async () => {
    const snipe = await holdSnipe();
    const reserve = jest.spyOn(h.nightGuard, 'tryReserve');
    const outcome = await h.snipes.execute(snipe.id);

    expect(turningOff).toHaveBeenCalledWith('fake');
    expect(holdCalls()).toEqual([]);
    expect(reserve).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      next: 'done',
      result: expect.objectContaining({
        result: SnipeResult.ALERTED,
        held: false,
        matchedSiteId: 'u1',
      }),
    });
    const alerted = h.snipeRepo.findById(snipe.id)!;
    expect(alerted).toMatchObject({
      action: 'hold',
      status: SnipeStatus.ALERTED,
      isActive: false,
      alert: {
        at: NOW,
        unitId: 'u1',
        unitName: 'Site u1',
        bookingUrl: 'https://fake.example/book/1?arrival=2026-12-01&departure=2026-12-03',
        note: HOLDS_OFF,
      },
    });
    expect(h.notifications.notifySnipeAlert).toHaveBeenCalledWith(alerted, undefined);
    expect(h.notifications.notifySnipeHeld).not.toHaveBeenCalled();
    expect(h.notifications.notifyWarning).not.toHaveBeenCalled();
  });

  it('a hold snipe with nothing free keeps polling: only a match is affected', async () => {
    h.fake.setAvailability('1', { u1: 'booked' });
    const snipe = await holdSnipe();
    const outcome = await h.snipes.execute(snipe.id);

    expect(outcome.next).toBe('continue');
    expect(turningOff).not.toHaveBeenCalled();
    expect(h.snipeRepo.findById(snipe.id)?.status).toBe(SnipeStatus.SNIPING);
    expect(h.notifications.notifySnipeAlert).not.toHaveBeenCalled();
  });

  it('while holds are turning off, a new snipe is an alert snipe, and one asked to hold is refused', async () => {
    const snipe = await h.snipes.create(h.userId, h.snipeInput());
    expect(snipe.action).toBe('alert');
    expect(turningOff).toHaveBeenCalledWith('fake');

    await expect(h.snipes.create(h.userId, h.snipeInput({ action: 'hold' }))).rejects.toMatchObject(
      {
        code: 'VALIDATION',
        issues: ['action'],
        message: "Fake can't hold automatically, so choose an alert",
      }
    );
    await expect(h.snipes.update(snipe.id, { action: 'hold' })).rejects.toMatchObject({
      code: 'VALIDATION',
      issues: ['action'],
    });

    // Turned back on before the restart: holds are offered again
    turningOff.mockReturnValue(false);
    expect((await h.snipes.create(h.userId, h.snipeInput())).action).toBe('hold');
  });
});
