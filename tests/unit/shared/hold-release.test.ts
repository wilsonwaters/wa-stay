/**
 * The messages of a hold that ended early (R18, `src/shared/utils/hold-release.ts`): main writes
 * them (`HoldPaymentService`), and the renderer tells such a hold from one that ran out by them.
 */
import {
  HOLD_RELEASED_MESSAGE,
  HOLD_RELEASED_ON_CLOSE_MESSAGE,
  holdEndingOf,
  holdGoneMessage,
} from '@shared/utils/hold-release';
import {
  RELEASED_MESSAGE,
  RELEASED_ON_CLOSE_MESSAGE,
  holdGoneMessage as mainGoneMessage,
} from '@main/core/holds/hold-payment.service';

describe('hold ending messages', () => {
  it('are the ones main writes', () => {
    expect(RELEASED_MESSAGE).toBe(HOLD_RELEASED_MESSAGE);
    expect(RELEASED_ON_CLOSE_MESSAGE).toBe(HOLD_RELEASED_ON_CLOSE_MESSAGE);
    expect(mainGoneMessage('RAC')).toBe(holdGoneMessage('RAC'));
  });

  it.each([
    [HOLD_RELEASED_MESSAGE, 'let-go'],
    [HOLD_RELEASED_ON_CLOSE_MESSAGE, 'let-go'],
    [holdGoneMessage('RAC'), 'gone'],
    [holdGoneMessage("Fake Stay's Parks"), 'gone'],
  ])('%s → %s', (message, ending) => {
    expect(holdEndingOf(message)).toBe(ending);
  });

  it.each([
    ['a hold that ran out', 'The hold expired unpaid'],
    ['no message', undefined],
    ['another error', 'ParkStay refused the check (HTTP 403).'],
  ])('%s is no early ending', (_label, message) => {
    expect(holdEndingOf(message)).toBeUndefined();
  });
});
