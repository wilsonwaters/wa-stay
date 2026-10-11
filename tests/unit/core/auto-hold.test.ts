/**
 * Watch auto-hold (PQ4, architecture-notes §12.4): on a full match a watch with `autoHold`
 * places exactly one hold on the first matching unit, notifies like a snipe and stops;
 * signed out (when the provider needs an account for holds) or blocked by another hold on
 * the same nights, it notifies a normal match instead.
 */

import { SnipeReleaseMode, WatchResult } from '@shared/types/common.types';
import { createCoreHarness, fakeDateOnly, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider } from '@tests/utils/fake-provider';

const NOW = new Date('2026-10-04T02:00:00.000Z');

describe('watch auto-hold', () => {
  let h: CoreHarness;

  afterEach(async () => {
    await h.close();
    jest.useRealTimers();
  });

  function setUp(options: Parameters<typeof createFakeProvider>[0] = {}, signedIn = true): void {
    fakeDateOnly(NOW);
    h = createCoreHarness({
      providers: [createFakeProvider(options)],
      accountState: () => (signedIn ? 'signed-in' : 'signed-out'),
    });
  }

  const holdCalls = () => h.fake.calls.filter((c) => c.module === 'holds');

  it('a full match places exactly one hold on the first matching unit and deactivates the watch', async () => {
    setUp({ availability: { '1': { u1: 'available', u2: 'available' } } });
    const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));
    const result = await h.watches.execute(watch.id);

    expect(holdCalls()).toHaveLength(1);
    expect(holdCalls()[0].args[0]).toMatchObject({ externalId: '1', unitId: 'u1' });
    expect(result.hold).toEqual({
      reference: 'FAKE-1',
      expiresAt: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
      unitId: 'u1',
      paymentUrl: 'https://fake.example/pay/FAKE-1',
    });
    expect(h.watchRepo.findById(watch.id)).toMatchObject({
      isActive: false,
      lastResult: WatchResult.HELD,
    });
    expect(h.notifications.notifyWatchHeld).toHaveBeenCalledWith(
      expect.objectContaining({ id: watch.id }),
      result.hold,
      'Site u1'
    );
    expect(h.notifications.notifyWatchFound).not.toHaveBeenCalled();

    // Stopped: a second check (run now) cannot hold again
    await expect(h.watches.activate(watch.id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('a watch hold persists its reference, expiry, unit and payment URL (migration v9 columns)', async () => {
    setUp({ availability: { '1': { u1: 'available', u2: 'available' } } });
    const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));
    await h.watches.execute(watch.id);

    const stored = h.watchRepo.findById(watch.id)!;
    expect(stored.hold).toEqual({
      reference: 'FAKE-1',
      expiresAt: new Date(NOW.getTime() + 30 * 60_000),
      unitId: 'u1',
      paymentUrl: 'https://fake.example/pay/FAKE-1',
    });
    expect(stored.lastError).toBeUndefined();
    const row = h.db
      .prepare(
        'SELECT hold_reference, hold_expires_at, hold_unit_id, payment_url, last_error FROM watches WHERE id = ?'
      )
      .get(watch.id);
    expect(row).toEqual({
      hold_reference: 'FAKE-1',
      hold_expires_at: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
      hold_unit_id: 'u1',
      payment_url: 'https://fake.example/pay/FAKE-1',
      last_error: null,
    });
    // Sign-out sees the hold until it expires (D3)
    expect(h.watchRepo.countUnexpiredHolds('fake', NOW)).toBe(1);
    expect(h.watchRepo.countUnexpiredHolds('fake', new Date(NOW.getTime() + 31 * 60_000))).toBe(0);
  });

  it('a hold not placed is the watch’s last error, and a later good check clears it', async () => {
    setUp();
    h.fake.scriptHold({ ok: false, reason: 'closed', message: 'Closed for bookings' });
    const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));
    await h.watches.execute(watch.id);
    expect(h.watchRepo.findById(watch.id)).toMatchObject({
      lastResult: WatchResult.FOUND,
      lastError: 'Automatic hold failed: Closed for bookings',
    });
    expect(h.watchRepo.findById(watch.id)?.hold).toBeUndefined();

    await h.watches.update(watch.id, { autoHold: false });
    await h.watches.execute(watch.id, { manual: true });
    expect(h.watchRepo.findById(watch.id)?.lastError).toBeUndefined();
  });

  it('signed out, on a provider that needs an account for holds, notifies a normal match with the sign-in hint', async () => {
    setUp({ capabilities: { account: 'required-for-holds' } }, false);
    const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));
    await h.watches.execute(watch.id);

    expect(holdCalls()).toHaveLength(0);
    expect(h.notifications.notifyWatchFound).toHaveBeenCalledWith(
      expect.objectContaining({ id: watch.id }),
      expect.any(Array),
      'Sign in to Fake to enable automatic holds'
    );
    expect(h.watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.FOUND);
  });

  it('a provider answering auth-required is treated the same way', async () => {
    setUp();
    h.fake.scriptHold({ ok: false, reason: 'auth-required', message: 'Sign in' });
    const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));
    await h.watches.execute(watch.id);

    expect(holdCalls()).toHaveLength(1);
    expect(h.notifications.notifyWatchFound.mock.calls[0][2]).toBe(
      'Sign in to Fake to enable automatic holds'
    );
    expect(h.watchRepo.findById(watch.id)?.lastResult).toBe(WatchResult.FOUND);
  });

  it('another hold on the same nights (one booking per night) means no hold, a normal match', async () => {
    setUp();
    const snipe = h.snipeRepo.create(h.userId, {
      ...h.snipeInput({ stay: { arrival: '2026-12-02', departure: '2026-12-05', adults: 2 } }),
      releaseMode: SnipeReleaseMode.CANCELLATION,
    });
    h.snipeRepo.markHeld(snipe.id, 'FAKE-0', new Date(NOW.getTime() + 30 * 60_000));
    const watch = await h.watches.create(h.userId, h.watchInput({ autoHold: true }));
    await h.watches.execute(watch.id);

    expect(holdCalls()).toHaveLength(0);
    expect(h.notifications.notifyWatchFound.mock.calls[0][2]).toMatch(/one booking per night/);
  });

  it('autoHold is rejected at create on a provider without holds', async () => {
    setUp({ capabilities: { holds: false, snipes: false } });
    await expect(
      h.watches.create(h.userId, h.watchInput({ autoHold: true }))
    ).rejects.toMatchObject({ name: 'ProviderCapabilityError', capability: 'holds' });
  });
});
