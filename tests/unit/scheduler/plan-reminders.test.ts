/**
 * Open Day plans (§12.38) on the real core and the real Stay Rottnest provider, with fake
 * timers: a plan for July 2027 is armed for Wed 4 Nov 2026, 8:30 am Perth, and sends its three
 * reminders (6 pm the day before, 6 am and 8:15 am) at their times, then is REMINDED, having
 * checked nothing; two plans for one Open Day get one notification per reminder; a plan whose
 * reminders passed while WA Stay was closed sends only the latest, and only while the release
 * is less than 30 minutes past; a release instant out of date is asked again, and the
 * reminders move with it; and a plan is refused for a stay on sale, a stay the rules refuse,
 * or any other action.
 */

import { rottnestFactory, rottnestManifest } from '@main/providers/rottnest';
import { ALREADY_ON_SALE } from '@main/providers/rottnest/release-policy';
import { SnipeReleaseMode, SnipeResult, SnipeStatus } from '@shared/types/common.types';
import type { SiteSnipeInput } from '@shared/types';
import { createCoreHarness, settle, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider, type FakeProvider } from '@tests/utils/fake-provider';

const MINUTE = 60_000;
/** 18 Oct 2026, 10 am Perth. */
const NOW = new Date('2026-10-18T02:00:00.000Z');
/** Wed 4 Nov 2026, 8:30 am Perth: July 2027's Open Day. */
const OPEN_DAY = new Date('2026-11-04T00:30:00.000Z');
const DAY_BEFORE_6PM = new Date('2026-11-03T10:00:00.000Z');
const SIX_AM = new Date('2026-11-03T22:00:00.000Z');
const QUARTER_PAST_8 = new Date('2026-11-04T00:15:00.000Z');

let h: CoreHarness;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  const rottnest = {
    factory: rottnestFactory,
    manifest: rottnestManifest,
  } as unknown as FakeProvider;
  h = createCoreHarness({ providers: [createFakeProvider(), rottnest] });
});

afterEach(async () => {
  const closing = h.close();
  await jest.advanceTimersByTimeAsync(10_000);
  await closing;
  jest.useRealTimers();
});

const planInput = (overrides: Partial<SiteSnipeInput> = {}): SiteSnipeInput => ({
  providerId: 'rottnest',
  name: 'Geordie Bay in July',
  location: { externalId: 'geordie-bay', name: 'Geordie Bay' },
  stay: { arrival: '2027-07-06', departure: '2027-07-08', adults: 2 },
  releaseMode: SnipeReleaseMode.OPEN_DAY,
  ...overrides,
});
const plan = (overrides: Partial<SiteSnipeInput> = {}) =>
  settle(h.snipes.create(h.userId, planInput(overrides)));
const stored = (id: number) => h.snipeRepo.findById(id)!;
const sent = () =>
  h.notifications.notifySnipeReminders.mock.calls.map(([items]) =>
    (items as { snipe: { id: number }; step: { title: string } }[]).map(
      (item) => `${item.snipe.id}: ${item.step.title}`
    )
  );
/** Advances the fake clock to `at`, plus the moment a due reminder waits for others. */
const advanceTo = async (at: Date) => {
  await jest.advanceTimersByTimeAsync(at.getTime() - Date.now());
  await jest.advanceTimersByTimeAsync(1_500);
};

describe('an Open Day plan', () => {
  it('is a remind snipe, released on its Open Day, and needs no check', async () => {
    const snipe = await plan();
    expect(snipe).toMatchObject({
      action: 'remind',
      releaseMode: SnipeReleaseMode.OPEN_DAY,
      releaseAt: OPEN_DAY,
    });
    expect(h.snipes.reminderStepsOf(snipe).map((step) => step.at)).toEqual([
      DAY_BEFORE_6PM,
      SIX_AM,
      QUARTER_PAST_8,
    ]);
    const outcome = await h.snipes.execute(snipe.id, { manual: true });
    expect(outcome.result).toMatchObject({
      result: SnipeResult.PENDING,
      error: 'An Open Day plan only reminds you: it never checks',
    });
  });

  it('sends its three reminders at their times, then is REMINDED and inactive', async () => {
    const snipe = await plan();
    h.scheduler.snipeRunner.arm(snipe.id);
    await jest.advanceTimersByTimeAsync(0);
    expect(stored(snipe.id).status).toBe(SnipeStatus.ARMED);

    await advanceTo(new Date(DAY_BEFORE_6PM.getTime() - MINUTE));
    expect(sent()).toEqual([]);
    await advanceTo(DAY_BEFORE_6PM);
    expect(sent()).toEqual([[`${snipe.id}: Open Day tomorrow`]]);
    const [[items]] = h.notifications.notifySnipeReminders.mock.calls as [
      [{ bookingUrl?: string }[]],
    ];
    expect(items[0].bookingUrl).toMatch(
      /^https:\/\/bookings\.stayrottnest\.com\/rates-room1\?hotel=62607&arrival=2027-07-06&departure=2027-07-08/
    );
    expect(stored(snipe.id).remindersSent).toEqual([DAY_BEFORE_6PM]);

    await advanceTo(SIX_AM);
    await advanceTo(QUARTER_PAST_8);
    expect(sent()).toEqual([
      [`${snipe.id}: Open Day tomorrow`],
      [`${snipe.id}: The waiting room is open`],
      [`${snipe.id}: 15 minutes to Open Day`],
    ]);
    expect(stored(snipe.id)).toMatchObject({
      status: SnipeStatus.REMINDED,
      lastResult: SnipeResult.REMINDED,
      isActive: false,
      remindersSent: [DAY_BEFORE_6PM, SIX_AM, QUARTER_PAST_8],
    });
    expect(h.scheduler.snipeRunner.isScheduled(snipe.id)).toBe(false);
  });

  it('two plans for one Open Day get one notification per reminder', async () => {
    const first = await plan();
    const second = await plan({
      name: 'Fay’s Bay in July',
      location: { externalId: 'fays-bay', name: "Fay's Bay" },
    });
    h.scheduler.snipeRunner.arm(first.id);
    h.scheduler.snipeRunner.arm(second.id);
    await advanceTo(DAY_BEFORE_6PM);
    expect(sent()).toEqual([[`${first.id}: Open Day tomorrow`, `${second.id}: Open Day tomorrow`]]);
  });

  it('missed while WA Stay was closed: only the latest is sent, within 30 minutes of the release', async () => {
    const late = await plan();
    const tooLate = await plan({ location: { externalId: 'fays-bay', name: "Fay's Bay" } });
    // WA Stay opens at 8:20 am on the Open Day: the 6 pm and 6 am reminders passed
    jest.setSystemTime(new Date('2026-11-04T00:20:00.000Z'));
    h.scheduler.snipeRunner.arm(late.id);
    await jest.advanceTimersByTimeAsync(1_500);
    expect(sent()).toEqual([[`${late.id}: 15 minutes to Open Day`]]);
    expect(stored(late.id)).toMatchObject({
      status: SnipeStatus.REMINDED,
      remindersSent: [DAY_BEFORE_6PM, SIX_AM, QUARTER_PAST_8],
    });

    // At 9:05 am, more than 30 minutes after the release: nothing is sent
    jest.setSystemTime(new Date('2026-11-04T01:05:00.000Z'));
    h.scheduler.snipeRunner.arm(tooLate.id);
    await jest.advanceTimersByTimeAsync(1_500);
    expect(sent()).toHaveLength(1);
    expect(stored(tooLate.id).status).toBe(SnipeStatus.REMINDED);
  });

  it('a release instant out of date is asked again, and the reminders move with it', async () => {
    const snipe = await plan();
    // As if stored before the Open Day moved: a week later
    h.snipeRepo.setReleaseAt(snipe.id, new Date(OPEN_DAY.getTime() + 7 * 24 * 60 * MINUTE));
    h.scheduler.snipeRunner.arm(snipe.id);
    await jest.advanceTimersByTimeAsync(0);
    expect(stored(snipe.id).releaseAt).toEqual(OPEN_DAY);
    await advanceTo(DAY_BEFORE_6PM);
    expect(sent()).toEqual([[`${snipe.id}: Open Day tomorrow`]]);
  });

  it('is refused for a stay on sale, a stay the rules refuse, or another action; and other modes take no plan', async () => {
    await expect(
      h.snipes.create(
        h.userId,
        planInput({ stay: { arrival: '2027-06-08', departure: '2027-06-10', adults: 2 } })
      )
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      message: ALREADY_ON_SALE,
      issues: ['releaseAt'],
    });
    await expect(
      h.snipes.create(
        h.userId,
        planInput({ stay: { arrival: '2027-07-06', departure: '2027-07-22', adults: 2 } })
      )
    ).rejects.toMatchObject({ code: 'VALIDATION', issues: ['stay.departure'] });
    await expect(h.snipes.create(h.userId, planInput({ action: 'alert' }))).rejects.toMatchObject({
      code: 'VALIDATION',
      issues: ['action'],
    });
    await expect(
      h.snipes.create(h.userId, h.snipeInput({ action: 'remind' }))
    ).rejects.toMatchObject({ code: 'VALIDATION', issues: ['action'] });
  });

  it('a REMINDED plan whose release has passed cannot be armed again', async () => {
    const snipe = await plan();
    h.snipeRepo.markReminded(snipe.id, [], NOW);
    jest.setSystemTime(new Date(OPEN_DAY.getTime() + MINUTE));
    await expect(h.snipes.activate(snipe.id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
