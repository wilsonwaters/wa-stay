/**
 * Snipe create and update through the provider (V4): the `snipes` capability, release modes
 * the provider supports, release instants it computes (field-level when it cannot), the
 * access gate only when the provider has one, and poll cadences never below its floors.
 */

import { ProviderCapabilityError } from '@main/providers/sdk';
import { SnipeReleaseMode, SnipeStatus } from '@shared/types/common.types';
import { createCoreHarness, fakeDateOnly, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider } from '@tests/utils/fake-provider';

const NOW = new Date('2026-10-04T02:00:00.000Z');

describe('snipe create and update', () => {
  let h: CoreHarness;

  beforeEach(() => {
    fakeDateOnly(NOW);
    const picky = createFakeProvider({ id: 'picky', capabilities: { accessGate: false } });
    h = createCoreHarness({
      providers: [
        createFakeProvider(),
        picky,
        createFakeProvider({ id: 'nosnipes', capabilities: { snipes: false } }),
      ],
    });
    // `picky` supports only cancellation snipes
    jest
      .spyOn(picky.release!, 'supports')
      .mockImplementation((mode) => mode === SnipeReleaseMode.CANCELLATION);
  });

  afterEach(async () => {
    await h.close();
    jest.useRealTimers();
  });

  it('rejects a provider without snipes (CAPABILITY)', async () => {
    await expect(
      h.snipes.create(h.userId, h.snipeInput({ providerId: 'nosnipes' }))
    ).rejects.toBeInstanceOf(ProviderCapabilityError);
  });

  it('rejects daily_rollover on a provider whose release.supports says no, on the releaseMode field', async () => {
    await expect(
      h.snipes.create(
        h.userId,
        h.snipeInput({ providerId: 'picky', releaseMode: SnipeReleaseMode.DAILY_ROLLOVER })
      )
    ).rejects.toMatchObject({ code: 'VALIDATION', issues: ['releaseMode'] });
    expect(h.snipeRepo.findAll()).toEqual([]);
  });

  it('a scheduled release without a time is a field-level VALIDATION on releaseAt', async () => {
    await expect(
      h.snipes.create(h.userId, h.snipeInput({ releaseMode: SnipeReleaseMode.SCHEDULED }))
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      issues: ['releaseAt'],
      message: 'A scheduled release needs a time',
    });
  });

  it('rejects a scheduled release at or after check-in where the provider is, on releaseAt, at create and update', async () => {
    const scheduled = (releaseAt: Date) =>
      h.snipeInput({ releaseMode: SnipeReleaseMode.SCHEDULED, releaseAt });
    // Check-in is 1 Dec; midnight in Perth is 16:00 UTC the day before
    const checkIn = new Date('2026-11-30T16:00:00Z');
    await expect(h.snipes.create(h.userId, scheduled(checkIn))).rejects.toMatchObject({
      code: 'VALIDATION',
      issues: ['releaseAt'],
      message: 'The release must be before check-in',
    });
    await expect(
      h.snipes.create(h.userId, scheduled(new Date('2026-12-02T00:00:00Z')))
    ).rejects.toMatchObject({ code: 'VALIDATION', issues: ['releaseAt'] });
    expect(h.snipeRepo.findAll()).toEqual([]);

    // A minute before check-in is fine
    const before = new Date(checkIn.getTime() - 60_000);
    const snipe = await h.snipes.create(h.userId, scheduled(before));
    expect(snipe.releaseAt).toEqual(before);

    // An update may not move the release past check-in, nor check-in before the release
    await expect(h.snipes.update(snipe.id, { releaseAt: checkIn })).rejects.toMatchObject({
      code: 'VALIDATION',
      issues: ['releaseAt'],
    });
    await expect(
      h.snipes.update(snipe.id, {
        stay: { arrival: '2026-11-20', departure: '2026-11-22', adults: 2 },
      })
    ).rejects.toMatchObject({ code: 'VALIDATION', issues: ['releaseAt'] });
    expect(h.snipeRepo.findById(snipe.id)).toMatchObject({
      releaseAt: before,
      stay: expect.objectContaining({ arrival: '2026-12-01' }),
    });
  });

  it('asks the provider for the release instant, fills in its stay-field defaults, and arms the snipe', async () => {
    const snipe = await h.snipes.create(
      h.userId,
      h.snipeInput({ releaseMode: SnipeReleaseMode.DAILY_ROLLOVER })
    );

    // FakeProvider releases 180 days ahead, at UTC midnight
    expect(snipe.releaseAt).toEqual(
      new Date(Date.parse('2026-12-01T00:00:00Z') - 180 * 86_400_000)
    );
    expect(snipe.stayParams).toEqual({ gearType: 'tent' });
    expect(snipe.status).toBe(SnipeStatus.ARMED);
    expect(h.events.emit).toHaveBeenCalledWith('snipe:updated', snipe);
  });

  it('uses the access gate only when asked, the provider has one and the mode uses it', async () => {
    const gated = await h.snipes.create(
      h.userId,
      h.snipeInput({
        releaseMode: SnipeReleaseMode.SCHEDULED,
        releaseAt: new Date('2026-11-01T02:00:00Z'),
        accessGateEnabled: true,
      })
    );
    const cancellation = await h.snipes.create(h.userId, h.snipeInput({ accessGateEnabled: true }));
    const noGate = await h.snipes.create(
      h.userId,
      h.snipeInput({ providerId: 'picky', accessGateEnabled: true })
    );

    expect(gated.accessGateEnabled).toBe(true);
    // Cancellation polling does not use the queue (its release mode says so)
    expect(cancellation.accessGateEnabled).toBe(false);
    expect(noGate.accessGateEnabled).toBe(false);
  });

  it("clamps the poll cadence up to the provider's floors: window for timed releases, continuous for cancellation", async () => {
    const timed = await h.snipes.create(
      h.userId,
      h.snipeInput({
        releaseMode: SnipeReleaseMode.SCHEDULED,
        releaseAt: new Date('2026-11-01T02:00:00Z'),
        pollIntervalMs: 100,
      })
    );
    const continuous = await h.snipes.create(h.userId, h.snipeInput({ pollIntervalMs: 1000 }));

    expect(timed.pollIntervalMs).toBe(500);
    expect(continuous.pollIntervalMs).toBe(3000);

    // An update is checked again
    const updated = await h.snipes.update(continuous.id, { pollIntervalMs: 10 });
    expect(updated.pollIntervalMs).toBe(3000);
  });

  it('rejects an arrival already past in the provider calendar', async () => {
    jest.setSystemTime(new Date('2026-10-04T20:00:00.000Z')); // 5 Oct in Perth
    await expect(
      h.snipes.create(
        h.userId,
        h.snipeInput({ stay: { arrival: '2026-10-04', departure: '2026-10-06', adults: 1 } })
      )
    ).rejects.toMatchObject({ code: 'VALIDATION', issues: ['stay.arrival'] });
  });

  it('refuses to re-activate a HELD or BOOKED snipe', async () => {
    const snipe = await h.snipes.create(h.userId, h.snipeInput());
    h.snipeRepo.markHeld(snipe.id, 'FAKE-9', new Date(NOW.getTime() + 60_000));
    await expect(h.snipes.activate(snipe.id)).rejects.toMatchObject({ code: 'VALIDATION' });
    h.snipeRepo.setBooked(snipe.id, 'B-9');
    await expect(h.snipes.activate(snipe.id)).rejects.toMatchObject({ code: 'VALIDATION' });

    // A FAILED snipe (say, a night-guard conflict) can be armed again
    const failed = await h.snipes.create(h.userId, h.snipeInput());
    h.snipeRepo.finish(failed.id, SnipeStatus.FAILED, 'error' as never, 'conflict');
    await h.snipes.activate(failed.id);
    expect(h.snipeRepo.findById(failed.id)).toMatchObject({
      isActive: true,
      status: SnipeStatus.ARMED,
    });
  });

  it('list filters by provider and status', async () => {
    const a = await h.snipes.create(h.userId, h.snipeInput());
    const b = await h.snipes.create(h.userId, h.snipeInput({ providerId: 'picky' }));
    h.snipeRepo.updateStatus(b.id, SnipeStatus.SNIPING);

    expect((await h.snipes.list(h.userId, { providerId: 'fake' })).map((s) => s.id)).toEqual([
      a.id,
    ]);
    expect(
      (await h.snipes.list(h.userId, { status: SnipeStatus.SNIPING })).map((s) => s.id)
    ).toEqual([b.id]);
  });
});
