/**
 * Release-alert snipes (R12, architecture-notes §12.35): a snipe's `action`, and what an
 * attempt does when the dates are free without holding.
 *
 * - An `alert` snipe ends ALERTED with what was free, when and the booking page, and calls
 *   neither `holds.create` nor the night guard; it never waits for a sign-in.
 * - A `hold` snipe alerts instead, with a note, when its provider has no holds (any more), or
 *   when it names no units and its candidates are of more than one stay type (R3).
 * - The action defaults per provider; `hold` without holds, or a changed action on a HELD or
 *   BOOKED snipe, is `VALIDATION` on `action`.
 * - The window is clamped to the release mode's `maxWindowMinutes` at create, at update and in
 *   `plan()`; the release policy hears the snipe's units and stay types.
 * - The booking link is the first candidate on the provider's own site (https), else none.
 * - A 403 or 429 ends the snipe FAILED with the reason, for every provider.
 */

import type { AccountGate } from '@main/core/accounts/ports';
import { ProviderAuthRequiredError, ProviderHttpError, toApiError } from '@main/providers/sdk';
import type { LocationAvailability, SiteSnipe, SiteSnipeInput } from '@shared/types';
import { SnipeReleaseMode, SnipeResult, SnipeStatus } from '@shared/types/common.types';
import type { AccountStatus } from '@shared/types/provider.types';
import { createCoreHarness, fakeDateOnly, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider, type FakeProviderOptions } from '@tests/utils/fake-provider';

// 4 Oct 2026, 10:00 in Perth
const NOW = new Date('2026-10-04T02:00:00.000Z');
const MINUTE = 60_000;
const STAY_QUERY = 'arrival=2026-12-01&departure=2026-12-03';
const HOLDS_OFF = 'Automatic holds are off for Fake, so Site Sniper alerted you instead.';
const MIXED_NOTE =
  'The units this snipe could hold are of more than one stay type: choose one stay type or units for it.';

describe('release-alert snipes', () => {
  let h: CoreHarness;

  afterEach(async () => {
    await h.close();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function setUp(options: FakeProviderOptions = {}, accounts?: AccountGate): void {
    fakeDateOnly(NOW);
    h = createCoreHarness({ providers: [createFakeProvider(options)], accounts });
  }

  /** A created snipe, made SNIPING as the scheduler would at the release. */
  async function sniping(input: Partial<SiteSnipeInput> = {}): Promise<SiteSnipe> {
    const snipe = await h.snipes.create(h.userId, h.snipeInput(input));
    h.snipeRepo.updateStatus(snipe.id, SnipeStatus.SNIPING);
    return snipe;
  }

  /** A row stored as it is, bypassing the service's checks (e.g. saved while holds were on). */
  function storedRow(input: Partial<SiteSnipeInput> = {}): SiteSnipe {
    const snipe = h.snipeRepo.create(h.userId, h.snipeInput(input));
    h.snipeRepo.updateStatus(snipe.id, SnipeStatus.SNIPING);
    return snipe;
  }

  const stored = (id: number) => h.snipeRepo.findById(id)!;
  const holdCalls = () => h.fake.calls.filter((c) => c.module === 'holds');
  const checks = () => h.fake.calls.filter((c) => c.module === 'availability');

  async function rejectsWith(promise: Promise<unknown>) {
    const error = await promise.then(
      () => undefined,
      (e: unknown) => e
    );
    expect(error).toBeDefined();
    return error as { code?: string; message: string; issues?: string[] };
  }

  describe('on a match', () => {
    it('an alert snipe ends ALERTED with its link, and calls neither holds.create nor the night guard', async () => {
      setUp({ unitBookingUrls: true });
      const snipe = await sniping({ action: 'alert' });
      const create = jest.spyOn(h.registry.get('fake').holds!, 'create');
      const reserve = jest.spyOn(h.nightGuard, 'tryReserve');
      h.events.emit.mockClear();

      const outcome = await h.snipes.execute(snipe.id);

      expect(outcome).toEqual({
        next: 'done',
        result: {
          snipeId: snipe.id,
          success: true,
          result: SnipeResult.ALERTED,
          held: false,
          checkedAt: NOW,
          matchedSiteId: 'u1',
        },
      });
      expect(create).not.toHaveBeenCalled();
      expect(reserve).not.toHaveBeenCalled();
      expect(holdCalls()).toHaveLength(0);
      const alerted = stored(snipe.id);
      expect(alerted).toMatchObject({
        action: 'alert',
        status: SnipeStatus.ALERTED,
        lastResult: SnipeResult.ALERTED,
        isActive: false,
        attemptsCount: 1,
        alert: {
          at: NOW,
          unitId: 'u1',
          unitName: 'Site u1',
          bookingUrl: `https://book.fake.example/1/u1?${STAY_QUERY}`,
        },
      });
      expect(alerted.alert).not.toHaveProperty('note');
      expect(alerted.lastError).toBeUndefined();
      expect(h.events.emit).toHaveBeenCalledWith('snipe:updated', alerted);
      expect(h.notifications.notifySnipeAlert).toHaveBeenCalledTimes(1);
      // The fake's units say no kind
      expect(h.notifications.notifySnipeAlert).toHaveBeenCalledWith(alerted, undefined);
      expect(h.notifications.notifySnipeHeld).not.toHaveBeenCalled();
    });

    it('passes the free unit’s kind to the alert, for its noun', async () => {
      setUp({ availability: { '1': { c1: 'available' } }, unitKinds: { c1: 'cabin' } });
      const snipe = await sniping({ action: 'alert' });
      await h.snipes.execute(snipe.id);

      expect(h.notifications.notifySnipeAlert).toHaveBeenCalledWith(
        expect.objectContaining({ id: snipe.id, alert: expect.objectContaining({ unitId: 'c1' }) }),
        'cabin'
      );
    });

    it('a hold snipe whose provider has no holds alerts, with the note', async () => {
      setUp({ capabilities: { holds: false } });
      // Saved while the provider still placed holds (R17's switch, since turned off)
      const snipe = storedRow({ action: 'hold' });
      expect(snipe.action).toBe('hold');
      const reserve = jest.spyOn(h.nightGuard, 'tryReserve');

      const outcome = await h.snipes.execute(snipe.id);

      expect(outcome).toMatchObject({ next: 'done', result: { result: SnipeResult.ALERTED } });
      expect(reserve).not.toHaveBeenCalled();
      expect(stored(snipe.id)).toMatchObject({
        action: 'hold',
        status: SnipeStatus.ALERTED,
        alert: {
          at: NOW,
          unitId: 'u1',
          bookingUrl: `https://fake.example/book/1?${STAY_QUERY}`,
          note: HOLDS_OFF,
        },
      });
      expect(h.notifications.notifySnipeAlert).toHaveBeenCalledTimes(1);
    });

    it('an ambiguous hold snipe (R3) alerts with R3’s note, and sends no warning notification', async () => {
      setUp({
        availability: { '1': { s1: 'available', c1: 'available' } },
        unitKinds: { s1: 'campsite', c1: 'cabin' },
      });
      const snipe = await sniping();
      expect(snipe.action).toBe('hold');

      await h.snipes.execute(snipe.id);

      expect(holdCalls()).toHaveLength(0);
      expect(stored(snipe.id)).toMatchObject({
        status: SnipeStatus.ALERTED,
        alert: { unitId: 's1', note: MIXED_NOTE },
      });
      expect(h.notifications.notifyWarning).not.toHaveBeenCalled();
      expect(h.notifications.notifySnipeAlert).toHaveBeenCalledTimes(1);
    });

    it('an alert snipe at a mixed place needs no stay type: it alerts on the first free unit', async () => {
      setUp({
        availability: { '1': { s1: 'booked', c1: 'available' } },
        unitKinds: { s1: 'campsite', c1: 'cabin' },
      });
      const snipe = await sniping({ action: 'alert' });
      await h.snipes.execute(snipe.id);

      expect(stored(snipe.id).alert).toEqual({
        at: NOW,
        unitId: 'c1',
        unitName: 'Site c1',
        bookingUrl: `https://fake.example/book/1?${STAY_QUERY}`,
      });
    });

    it('a hold snipe that is not ambiguous still holds, as before', async () => {
      setUp();
      const snipe = await sniping();
      await h.snipes.execute(snipe.id);

      expect(holdCalls()).toHaveLength(1);
      expect(stored(snipe.id)).toMatchObject({ status: SnipeStatus.HELD });
      expect(stored(snipe.id).alert).toBeUndefined();
      expect(h.notifications.notifySnipeAlert).not.toHaveBeenCalled();
    });

    it('a cancellation alert snipe polls until a unit is free, then alerts once and ends', async () => {
      setUp({ availability: { '1': { u1: 'booked' } } });
      const snipe = await sniping({ action: 'alert' });

      await expect(h.snipes.execute(snipe.id)).resolves.toMatchObject({ next: 'continue' });
      h.fake.setAvailability('1', { u1: 'available' });
      await expect(h.snipes.execute(snipe.id)).resolves.toMatchObject({ next: 'done' });
      await expect(h.snipes.execute(snipe.id)).resolves.toMatchObject({
        next: 'done',
        result: { error: 'Snipe is not active' },
      });

      expect(checks()).toHaveLength(2);
      expect(h.notifications.notifySnipeAlert).toHaveBeenCalledTimes(1);
    });

    it('an attempt stopped after the check writes nothing and alerts no one', async () => {
      setUp();
      const snipe = await sniping({ action: 'alert' });
      const before = stored(snipe.id);
      const controller = new AbortController();
      const check = h.registry.get('fake').availability!.check;
      jest
        .spyOn(h.registry.get('fake').availability!, 'check')
        .mockImplementation(async (...args) => {
          const answer = await check(...args);
          controller.abort();
          return answer;
        });

      await expect(
        h.snipes.execute(snipe.id, { signal: controller.signal })
      ).resolves.toMatchObject({ result: { error: 'The attempt was stopped' } });
      expect(stored(snipe.id)).toEqual(before);
      expect(h.notifications.notifySnipeAlert).not.toHaveBeenCalled();
    });

    it('a snipe deleted during its attempt sends no alert', async () => {
      setUp();
      const snipe = await sniping({ action: 'alert' });
      const check = h.registry.get('fake').availability!.check;
      jest
        .spyOn(h.registry.get('fake').availability!, 'check')
        .mockImplementation(async (...args) => {
          await h.snipes.delete(snipe.id);
          return check(...args);
        });

      await expect(h.snipes.execute(snipe.id)).resolves.toMatchObject({ next: 'done' });
      expect(h.snipeRepo.findById(snipe.id)).toBeNull();
      expect(h.notifications.notifySnipeAlert).not.toHaveBeenCalled();
    });

    it('an alert that could not be sent still leaves the snipe ALERTED', async () => {
      setUp();
      h.notifications.notifySnipeAlert.mockRejectedValueOnce(new Error('no window'));
      const snipe = await sniping({ action: 'alert' });

      await expect(h.snipes.execute(snipe.id)).resolves.toMatchObject({ next: 'done' });
      expect(stored(snipe.id).status).toBe(SnipeStatus.ALERTED);
    });
  });

  describe('the action', () => {
    it('defaults to hold for a provider with holds, and to alert for one without', async () => {
      setUp();
      await expect(h.snipes.create(h.userId, h.snipeInput())).resolves.toMatchObject({
        action: 'hold',
      });
      await expect(
        h.snipes.create(h.userId, h.snipeInput({ action: 'alert' }))
      ).resolves.toMatchObject({ action: 'alert' });
      await h.close();

      setUp({ capabilities: { holds: false } });
      await expect(h.snipes.create(h.userId, h.snipeInput())).resolves.toMatchObject({
        action: 'alert',
      });
    });

    it('creating a hold snipe for a provider without holds is VALIDATION on action', async () => {
      setUp({ capabilities: { holds: false } });
      const error = await rejectsWith(h.snipes.create(h.userId, h.snipeInput({ action: 'hold' })));

      expect(error).toMatchObject({
        code: 'VALIDATION',
        message: "Fake can't hold automatically, so choose an alert",
        issues: ['action'],
      });
      expect(h.snipeRepo.findAll()).toEqual([]);
    });

    it('updating to hold without holds, or the action of a HELD or BOOKED snipe, is VALIDATION on action', async () => {
      setUp({ capabilities: { holds: false } });
      const alert = await h.snipes.create(h.userId, h.snipeInput());
      await expect(
        rejectsWith(h.snipes.update(alert.id, { action: 'hold' }))
      ).resolves.toMatchObject({ code: 'VALIDATION', issues: ['action'] });
      expect(stored(alert.id).action).toBe('alert');
      await h.close();

      setUp();
      const held = await h.snipes.create(h.userId, h.snipeInput());
      h.snipeRepo.markHeld(held.id, 'FAKE-0', new Date(NOW.getTime() + 30 * MINUTE));
      await expect(
        rejectsWith(h.snipes.update(held.id, { action: 'alert' }))
      ).resolves.toMatchObject({
        code: 'VALIDATION',
        message: "This snipe already has a hold, so what it does can't change",
        issues: ['action'],
      });
      h.snipeRepo.setBooked(held.id, 'PB1');
      await expect(
        rejectsWith(h.snipes.update(held.id, { action: 'alert' }))
      ).resolves.toMatchObject({ code: 'VALIDATION', issues: ['action'] });
      expect(stored(held.id).action).toBe('hold');

      // The same action is no change; another snipe may switch
      await expect(h.snipes.update(held.id, { action: 'hold' })).resolves.toMatchObject({
        action: 'hold',
      });
      const other = await h.snipes.create(h.userId, h.snipeInput());
      await expect(h.snipes.update(other.id, { action: 'alert' })).resolves.toMatchObject({
        action: 'alert',
      });
    });

    it('an ALERTED snipe can be armed again: its alert is cleared', async () => {
      setUp();
      const snipe = await sniping({ action: 'alert' });
      await h.snipes.execute(snipe.id);
      expect(stored(snipe.id).alert).toBeDefined();

      await h.snipes.activate(snipe.id);

      expect(stored(snipe.id)).toMatchObject({ status: SnipeStatus.ARMED, isActive: true });
      expect(stored(snipe.id).alert).toBeUndefined();
    });

    it('stopping an ALERTED snipe keeps it ALERTED', async () => {
      setUp();
      const snipe = await sniping({ action: 'alert' });
      await h.snipes.execute(snipe.id);
      await h.snipes.deactivate(snipe.id);

      expect(stored(snipe.id)).toMatchObject({ status: SnipeStatus.ALERTED, isActive: false });
    });
  });

  describe('sign-in', () => {
    function signedOutGate(): AccountGate & { [K in keyof AccountGate]: jest.Mock } {
      const state: AccountStatus['state'] = 'signed-out';
      return {
        ensureForHolds: jest.fn(async (providerId: string) => {
          throw new ProviderAuthRequiredError(providerId, 'Sign in to Fake first');
        }),
        storedState: jest.fn(() => state),
      };
    }

    it('an alert snipe on a required-for-holds provider arms, runs and alerts while signed out', async () => {
      const gate = signedOutGate();
      setUp({ capabilities: { account: 'required-for-holds' }, account: 'signed-out' }, gate);
      const snipe = await h.snipes.create(h.userId, h.snipeInput({ action: 'alert' }));

      expect(snipe).toMatchObject({ isActive: true, status: SnipeStatus.ARMED });
      expect(snipe.lastError).toBeUndefined();
      await h.snipes.deactivate(snipe.id);
      await expect(h.snipes.activate(snipe.id)).resolves.toBeUndefined();
      expect(gate.ensureForHolds).not.toHaveBeenCalled();

      h.snipeRepo.updateStatus(snipe.id, SnipeStatus.SNIPING);
      await h.snipes.execute(snipe.id);
      expect(stored(snipe.id).status).toBe(SnipeStatus.ALERTED);
      expect(gate.storedState).not.toHaveBeenCalled();
    });

    it('a hold snipe on that provider still waits for the sign-in', async () => {
      const gate = signedOutGate();
      setUp({ capabilities: { account: 'required-for-holds' }, account: 'signed-out' }, gate);
      const snipe = await h.snipes.create(h.userId, h.snipeInput({ action: 'hold' }));

      expect(snipe).toMatchObject({
        isActive: false,
        lastError: 'Sign in to Fake to arm this snipe',
      });
      expect(toApiError(await rejectsWith(h.snipes.activate(snipe.id)))).toMatchObject({
        code: 'AUTH_REQUIRED',
      });
    });

    it('an armed alert snipe switched to hold while signed out is saved paused, as create saves one', async () => {
      const gate = signedOutGate();
      setUp({ capabilities: { account: 'required-for-holds' }, account: 'signed-out' }, gate);
      const snipe = await h.snipes.create(h.userId, h.snipeInput({ action: 'alert' }));
      expect(snipe).toMatchObject({ isActive: true, status: SnipeStatus.ARMED });
      h.events.emit.mockClear();

      const updated = await h.snipes.update(snipe.id, { action: 'hold', name: 'Renamed' });

      expect(updated).toMatchObject({
        action: 'hold',
        name: 'Renamed',
        isActive: false,
        status: SnipeStatus.DISABLED,
        lastResult: SnipeResult.PENDING,
        lastError: 'Sign in to Fake to arm this snipe',
      });
      expect(stored(snipe.id)).toEqual(updated);
      expect(h.events.emit).toHaveBeenCalledWith('snipe:updated', updated);
      expect(toApiError(await rejectsWith(h.snipes.activate(snipe.id)))).toMatchObject({
        code: 'AUTH_REQUIRED',
      });
    });

    it('a switch to hold stays armed once signed in, and a switch to alert never asks', async () => {
      const gate = signedOutGate();
      setUp({ capabilities: { account: 'required-for-holds' }, account: 'signed-out' }, gate);
      const alert = await h.snipes.create(h.userId, h.snipeInput({ action: 'alert' }));
      gate.ensureForHolds.mockResolvedValue(undefined);

      await expect(h.snipes.update(alert.id, { action: 'hold' })).resolves.toMatchObject({
        action: 'hold',
        isActive: true,
        status: SnipeStatus.ARMED,
      });
      expect(stored(alert.id).lastError).toBeUndefined();

      gate.ensureForHolds.mockClear();
      await expect(h.snipes.update(alert.id, { action: 'alert' })).resolves.toMatchObject({
        action: 'alert',
        isActive: true,
      });
      expect(gate.ensureForHolds).not.toHaveBeenCalled();
    });
  });

  describe('the window', () => {
    it('is clamped to the mode’s maxWindowMinutes at create and at update', async () => {
      setUp({ maxWindowMinutes: 30 });
      const long = await h.snipes.create(
        h.userId,
        h.snipeInput({ windowDurationMs: 2 * 60 * MINUTE })
      );
      expect(long.windowDurationMs).toBe(30 * MINUTE);
      const usual = await h.snipes.create(h.userId, h.snipeInput());
      expect(usual.windowDurationMs).toBe(15 * MINUTE);
      const short = await h.snipes.create(h.userId, h.snipeInput({ windowDurationMs: 5 * MINUTE }));
      expect(short.windowDurationMs).toBe(5 * MINUTE);

      await expect(
        h.snipes.update(short.id, { windowDurationMs: 3 * 60 * MINUTE })
      ).resolves.toMatchObject({ windowDurationMs: 30 * MINUTE });
    });

    it('without a limit the person’s window is kept', async () => {
      setUp();
      const snipe = await h.snipes.create(
        h.userId,
        h.snipeInput({ windowDurationMs: 2 * 60 * MINUTE })
      );
      expect(snipe.windowDurationMs).toBe(2 * 60 * MINUTE);
    });

    it('plan() clamps an older row’s window too', () => {
      setUp({ maxWindowMinutes: 30 });
      const releaseAt = new Date(NOW.getTime() + 60 * MINUTE);
      const older = h.snipeRepo.create(
        h.userId,
        h.snipeInput({
          releaseMode: SnipeReleaseMode.SCHEDULED,
          releaseAt,
          windowDurationMs: 2 * 60 * MINUTE,
        })
      );
      expect(older.windowDurationMs).toBe(2 * 60 * MINUTE);

      expect(h.snipes.plan(older)?.windowEnd).toEqual(new Date(releaseAt.getTime() + 30 * MINUTE));
    });

    it('the release policy hears the snipe’s units and stay types, at create and when it is asked again', async () => {
      setUp();
      const compute = jest.spyOn(h.registry.get('fake').release!, 'computeReleaseAt');
      const snipe = await h.snipes.create(
        h.userId,
        h.snipeInput({
          releaseMode: SnipeReleaseMode.DAILY_ROLLOVER,
          unitIds: ['u1'],
          unitKinds: ['cabin', 'cabin'],
        })
      );
      expect(compute).toHaveBeenLastCalledWith(
        expect.objectContaining({ unitIds: ['u1'], unitKinds: ['cabin'] })
      );

      await h.snipes.refreshReleaseAt(snipe);
      expect(compute).toHaveBeenLastCalledWith(
        expect.objectContaining({ unitIds: ['u1'], unitKinds: ['cabin'] })
      );
    });
  });

  describe('the booking link', () => {
    /** The fake's check, with the unit's and the check's own links replaced. */
    function linksInCheck(unitUrl?: string, checkUrl?: string): void {
      const availability = h.registry.get('fake').availability!;
      const check = availability.check;
      jest.spyOn(availability, 'check').mockImplementation(async (...args) => {
        const answer: LocationAvailability = await check(...args);
        return {
          ...answer,
          bookingUrl: checkUrl,
          units: answer.units.map((unit) => ({ ...unit, bookingUrl: unitUrl })),
        };
      });
    }

    it('takes the unit’s, then the check’s, then links.booking: the first on the provider’s own https site', async () => {
      setUp();
      linksInCheck(
        `http://fake.example/unit/u1?${STAY_QUERY}`,
        `https://book.fake.example/stay?${STAY_QUERY}`
      );
      const snipe = await sniping({ action: 'alert' });
      await h.snipes.execute(snipe.id);

      expect(stored(snipe.id).alert?.bookingUrl).toBe(
        `https://book.fake.example/stay?${STAY_QUERY}`
      );
    });

    it('drops an off-site or http link; with none left the alert has no link', async () => {
      setUp();
      linksInCheck('https://evil.example/book', 'http://fake.example/book');
      jest
        .spyOn(h.registry.get('fake').links, 'booking')
        .mockReturnValue('https://fake.example.evil.test/book');
      const snipe = await sniping({ action: 'alert' });
      await h.snipes.execute(snipe.id);

      expect(stored(snipe.id).status).toBe(SnipeStatus.ALERTED);
      expect(stored(snipe.id).alert).not.toHaveProperty('bookingUrl');
    });

    it('a links.booking that throws gives no link from it, and the alert is still sent', async () => {
      setUp();
      linksInCheck(undefined, undefined);
      const links = h.registry.get('fake').links;
      const booking = links.booking;
      // Only the core's call names the unit; the fake's own check still gets its link
      jest.spyOn(links, 'booking').mockImplementation((externalId, stay, unitId) => {
        if (unitId) throw new TypeError('bad stay');
        return booking(externalId, stay);
      });
      const snipe = await sniping({ action: 'alert' });
      await h.snipes.execute(snipe.id);

      expect(stored(snipe.id).alert).toEqual({ at: NOW, unitId: 'u1', unitName: 'Site u1' });
      expect(h.notifications.notifySnipeAlert).toHaveBeenCalledTimes(1);
    });

    it('a held snipe’s alert gets the same public link, for booking away from the computer', async () => {
      setUp({ unitBookingUrls: true });
      const snipe = await sniping();
      await h.snipes.execute(snipe.id);

      expect(h.notifications.notifySnipeHeld).toHaveBeenCalledWith(
        expect.objectContaining({ id: snipe.id, status: SnipeStatus.HELD }),
        undefined,
        `https://book.fake.example/1/u1?${STAY_QUERY}`
      );
    });
  });

  describe('a provider that turns the snipe away', () => {
    const blocked = (status: number) =>
      `Fake refused the check (HTTP ${status}). Site Sniper stopped and won't try again by itself.`;

    it.each([403, 429])(
      'a %s on the check ends the snipe FAILED with the reason',
      async (status) => {
        setUp();
        const snipe = await sniping({ action: 'alert' });
        h.fake.failNext(
          'availability',
          new ProviderHttpError({ providerId: 'fake', status, url: 'https://fake.example/check' })
        );

        const outcome = await h.snipes.execute(snipe.id);

        expect(outcome).toMatchObject({
          next: 'done',
          result: { result: SnipeResult.ERROR, error: blocked(status) },
        });
        expect(stored(snipe.id)).toMatchObject({
          status: SnipeStatus.FAILED,
          lastResult: SnipeResult.ERROR,
          lastError: blocked(status),
          isActive: false,
          attemptsCount: 1,
        });
        expect(h.notifications.notifySnipeAlert).not.toHaveBeenCalled();
      }
    );

    it('a 403 while a hold is placed ends a hold snipe FAILED too, instead of retrying', async () => {
      setUp();
      const snipe = await sniping();
      h.fake.failNext(
        'holds',
        new ProviderHttpError({ providerId: 'fake', status: 403, url: 'https://fake.example/hold' })
      );

      await expect(h.snipes.execute(snipe.id)).resolves.toMatchObject({ next: 'done' });
      expect(stored(snipe.id)).toMatchObject({
        status: SnipeStatus.FAILED,
        lastError: blocked(403),
      });
    });

    it('other HTTP failures keep polling, as before', async () => {
      setUp();
      const snipe = await sniping({ action: 'alert' });
      h.fake.failNext(
        'availability',
        new ProviderHttpError({
          providerId: 'fake',
          status: 503,
          url: 'https://fake.example/check',
        })
      );

      await expect(h.snipes.execute(snipe.id)).resolves.toMatchObject({ next: 'continue' });
      expect(stored(snipe.id).status).toBe(SnipeStatus.SNIPING);
    });
  });
});
