/**
 * The snipe service's account gate (architecture-notes §12.32), generic and for providers
 * whose holds need an account (`required-for-holds`, `required`) only:
 * - create while signed out saves the snipe paused, with a sign-in hint;
 * - activate is `AUTH_REQUIRED` until the account is signed in, and writes nothing;
 * - an attempt whose stored account state is not signed in fails as "Sign in to …" without
 *   asking for a hold (no network on the hold path).
 * An `optional` provider (ParkStay) never asks the gate.
 */

import { ProviderAuthRequiredError, toApiError } from '@main/providers/sdk/errors';
import type { AccountGate } from '@main/core/accounts/ports';
import { SnipeResult, SnipeStatus } from '@shared/types/common.types';
import type { AccountStatus } from '@shared/types/provider.types';
import { createCoreHarness, fakeDateOnly, type CoreHarness } from '@tests/utils/core-harness';
import { createFakeProvider } from '@tests/utils/fake-provider';

const NOW = new Date('2026-10-04T02:00:00.000Z');

type State = AccountStatus['state'];

/** An account gate answering from `state`, as ProviderAccountService does for these providers. */
function accountGate(initial: State): AccountGate & { state: State } & {
  [K in keyof AccountGate]: jest.Mock;
} {
  const gate = {
    state: initial,
    ensureForHolds: jest.fn(async (providerId: string) => {
      if (gate.state !== 'signed-in') {
        throw new ProviderAuthRequiredError(providerId, 'Sign in to Fake first');
      }
    }),
    storedState: jest.fn(() => gate.state),
  };
  return gate;
}

describe('snipe account gate', () => {
  let h: CoreHarness;
  let gate: ReturnType<typeof accountGate>;

  afterEach(async () => {
    await h.close();
    jest.useRealTimers();
  });

  function setUp(account: 'optional' | 'required-for-holds', state: State): void {
    fakeDateOnly(NOW);
    gate = accountGate(state);
    h = createCoreHarness({
      providers: [createFakeProvider({ capabilities: { account } })],
      accounts: gate,
    });
  }

  const holdCalls = () => h.fake.calls.filter((c) => c.module === 'holds');

  describe('a provider whose holds need an account', () => {
    it('create while signed out saves the snipe paused, with a sign-in hint', async () => {
      setUp('required-for-holds', 'signed-out');
      const snipe = await h.snipes.create(h.userId, h.snipeInput());

      expect(snipe).toMatchObject({
        isActive: false,
        status: SnipeStatus.DISABLED,
        lastError: 'Sign in to Fake to arm this snipe',
      });
      // Nothing is due: the scheduler would not arm it
      expect(h.snipes.getActive()).toEqual([]);
      expect(h.events.emit).toHaveBeenLastCalledWith('snipe:updated', snipe);
    });

    it('activating while signed out is AUTH_REQUIRED and writes nothing; signed in, it arms', async () => {
      setUp('required-for-holds', 'signed-out');
      const snipe = await h.snipes.create(h.userId, h.snipeInput());
      const before = h.snipeRepo.findById(snipe.id);

      const error = await h.snipes.activate(snipe.id).catch((e: unknown) => e);
      expect(toApiError(error)).toMatchObject({ code: 'AUTH_REQUIRED' });
      expect(h.snipeRepo.findById(snipe.id)).toEqual(before);

      gate.state = 'signed-in';
      await h.snipes.activate(snipe.id);
      expect(h.snipeRepo.findById(snipe.id)).toMatchObject({
        isActive: true,
        status: SnipeStatus.ARMED,
      });
      // The sign-in hint is gone once it is armed
      expect(h.snipeRepo.findById(snipe.id)?.lastError).toBeUndefined();
    });

    it('create while signed in arms as usual', async () => {
      setUp('required-for-holds', 'signed-in');
      const snipe = await h.snipes.create(h.userId, h.snipeInput());
      expect(snipe).toMatchObject({ isActive: true, status: SnipeStatus.ARMED });
      expect(snipe.lastError).toBeUndefined();
    });

    it('an attempt whose stored state is signed out fails as "Sign in to Fake", without a hold', async () => {
      setUp('required-for-holds', 'signed-in');
      const snipe = await h.snipes.create(h.userId, h.snipeInput());
      h.snipeRepo.updateStatus(snipe.id, SnipeStatus.SNIPING);
      // The session expired after it was armed
      gate.state = 'signed-out';

      const outcome = await h.snipes.execute(snipe.id);
      expect(outcome).toMatchObject({
        next: 'done',
        result: { result: SnipeResult.ERROR, error: 'Sign in to Fake', matchedSiteId: 'u1' },
      });
      expect(holdCalls()).toEqual([]);
      expect(gate.ensureForHolds).toHaveBeenCalledTimes(1); // at create only: no network here
      expect(h.snipeRepo.findById(snipe.id)).toMatchObject({
        status: SnipeStatus.FAILED,
        isActive: false,
        lastError: 'Sign in to Fake',
        attemptsCount: 1,
      });
    });

    it('signed in at the attempt, it holds', async () => {
      setUp('required-for-holds', 'signed-in');
      const snipe = await h.snipes.create(h.userId, h.snipeInput());
      h.snipeRepo.updateStatus(snipe.id, SnipeStatus.SNIPING);

      const outcome = await h.snipes.execute(snipe.id);
      expect(outcome.result).toMatchObject({ held: true, holdReference: 'FAKE-1' });
      expect(holdCalls()).toHaveLength(1);
    });
  });

  describe('an optional account (ParkStay)', () => {
    it('signed out, a snipe is created armed, activates, and holds; the gate is never asked', async () => {
      setUp('optional', 'signed-out');
      const snipe = await h.snipes.create(h.userId, h.snipeInput());
      expect(snipe).toMatchObject({ isActive: true, status: SnipeStatus.ARMED });

      await h.snipes.deactivate(snipe.id);
      await h.snipes.activate(snipe.id);
      h.snipeRepo.updateStatus(snipe.id, SnipeStatus.SNIPING);
      const outcome = await h.snipes.execute(snipe.id);

      expect(outcome.result).toMatchObject({ held: true });
      expect(gate.ensureForHolds).not.toHaveBeenCalled();
      expect(gate.storedState).not.toHaveBeenCalled();
    });
  });
});
