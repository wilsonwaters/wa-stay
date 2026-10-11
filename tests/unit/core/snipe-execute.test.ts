/**
 * One snipe attempt (`SiteSniperService.execute`): check → one-booking-per-night guard →
 * hold, and what each outcome does to the snipe and to the next tick.
 */

import { AccessGateError } from '@main/providers/sdk';
import { SnipeResult, SnipeStatus } from '@shared/types/common.types';
import type { SiteSnipe } from '@shared/types';
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
    options: Parameters<typeof createFakeProvider>[0] = {}
  ): Promise<SiteSnipe> {
    fakeDateOnly(NOW);
    h = createCoreHarness({ providers: [createFakeProvider(options)] });
    const snipe = await h.snipes.create(h.userId, h.snipeInput());
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
