/**
 * A snipe whose hold ended early (R18) says how in its timeline, and so in its ended notice: "Hold
 * let go" (the person let it go, or its payment window closed), "Hold ended" (the provider no
 * longer held it), and "Hold expired" only for a hold that ran out.
 */
import { SnipeResult, SnipeStatus } from '../../../../shared/types/common.types';
import {
  HOLD_RELEASED_MESSAGE,
  HOLD_RELEASED_ON_CLOSE_MESSAGE,
  holdGoneMessage,
} from '../../../../shared/utils/hold-release';
import { makeHeldSnipe } from '@tests/fixtures/renderer/snipes';
import { timelineSteps } from './snipeState';

const ended = (lastError: string) =>
  makeHeldSnipe(-1, {
    status: SnipeStatus.EXPIRED,
    lastResult: SnipeResult.EXPIRED,
    isActive: false,
    lastError,
  });
const terminal = (lastError: string) => timelineSteps(ended(lastError)).find((s) => s.terminal);

describe('timelineSteps: a hold that ended early', () => {
  it.each([
    [HOLD_RELEASED_MESSAGE, 'Hold let go'],
    [HOLD_RELEASED_ON_CLOSE_MESSAGE, 'Hold let go'],
    [holdGoneMessage('ParkStay'), 'Hold ended'],
    ['The hold expired unpaid', 'Hold expired'],
  ])('%s → "%s"', (message, label) => {
    expect(terminal(message)).toMatchObject({ label, state: 'current', terminal: true });
  });

  it('a snipe that never held keeps "Expired"', () => {
    const unheld = makeHeldSnipe(-1, {
      status: SnipeStatus.EXPIRED,
      holdReference: undefined,
      holdExpiresAt: undefined,
      lastError: HOLD_RELEASED_MESSAGE,
    });
    expect(timelineSteps(unheld).find((s) => s.terminal)?.label).toBe('Expired');
  });
});
