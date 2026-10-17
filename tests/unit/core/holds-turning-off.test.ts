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

  it("a watch's auto-hold places no hold, notes why, and the watch alerts as usual", async () => {
    const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));
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

  it('a watch without auto-hold is not asked', async () => {
    const watch = await h.watches.create(h.userId, h.watchInput());
    await h.watches.execute(watch.id);

    expect(turningOff).not.toHaveBeenCalled();
    expect(h.notifications.notifyWatchFound.mock.calls[0][2]).toBeUndefined();
  });

  it('a hold snipe that finds a free unit holds nothing: it alerts, with the booking page and why', async () => {
    const snipe = await h.snipes.create(h.userId, h.snipeInput({ action: 'hold' }));
    h.snipeRepo.updateStatus(snipe.id, SnipeStatus.SNIPING);
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
    const snipe = await h.snipes.create(h.userId, h.snipeInput());
    h.snipeRepo.updateStatus(snipe.id, SnipeStatus.SNIPING);
    const outcome = await h.snipes.execute(snipe.id);

    expect(outcome.next).toBe('continue');
    expect(turningOff).not.toHaveBeenCalled();
    expect(h.snipeRepo.findById(snipe.id)?.status).toBe(SnipeStatus.SNIPING);
    expect(h.notifications.notifyWarning).not.toHaveBeenCalled();
  });
});
