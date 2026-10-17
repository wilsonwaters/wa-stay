/**
 * `snipeState` for release-alert snipes (R12): an ALERTED snipe is finished, sorts with the
 * ended ones, and its timeline ends at "Alert sent" (as does every alert snipe's), with the same
 * number of steps in every state.
 */
import { SnipeStatus } from '../../../../shared/types/common.types';
import { makeSnipe } from '@tests/fixtures/renderer/snipes';
import { isFinished, releaseLineFor, sortSnipes, statusPillFor, timelineSteps } from './snipeState';

const ids = (steps: ReturnType<typeof timelineSteps>) => steps.map((s) => `${s.id}:${s.state}`);

describe('an alerted snipe', () => {
  it('is finished, with no release line, and its pill reads "Alert sent"', () => {
    const alerted = makeSnipe({ action: 'alert', status: SnipeStatus.ALERTED, isActive: false });
    expect(isFinished(alerted)).toBe(true);
    expect(releaseLineFor(alerted)).toEqual({ kind: 'none' });
    expect(statusPillFor(SnipeStatus.ALERTED).label).toBe('Alert sent');
  });

  it('ends its timeline at "Alert sent": the same count in every state, current once alerted', () => {
    const alerts = [
      makeSnipe({ action: 'alert' }),
      makeSnipe({ action: 'alert', status: SnipeStatus.SNIPING }),
      makeSnipe({ action: 'alert', status: SnipeStatus.ALERTED, isActive: false }),
      makeSnipe({ action: 'alert', status: SnipeStatus.EXPIRED, isActive: false }),
      makeSnipe({ action: 'alert', status: SnipeStatus.FAILED, isActive: false }),
    ];
    expect(alerts.map((snipe) => timelineSteps(snipe).length)).toEqual(alerts.map(() => 4));
    expect(ids(timelineSteps(alerts[2]))).toEqual([
      'armed:done',
      'waiting:done',
      'sniping:done',
      'alerted:current',
    ]);
    expect(timelineSteps(alerts[2]).at(-1)).toMatchObject({ label: 'Alert sent' });
    expect(timelineSteps(alerts[2]).some((step) => step.terminal)).toBe(false);
    expect(ids(timelineSteps(alerts[3]))).toEqual([
      'armed:done',
      'waiting:done',
      'sniping:done',
      'expired:current',
    ]);
    // A hold snipe that alerted instead ends there too
    expect(
      timelineSteps(makeSnipe({ status: SnipeStatus.ALERTED, isActive: false })).map((s) => s.id)
    ).toEqual(['armed', 'waiting', 'sniping', 'alerted']);
  });

  it('sorts with the ended snipes, before booked', () => {
    const list = [
      makeSnipe({ id: 1, status: SnipeStatus.BOOKED }),
      makeSnipe({ id: 2, status: SnipeStatus.ALERTED, isActive: false, action: 'alert' }),
      makeSnipe({ id: 3, status: SnipeStatus.DISABLED, isActive: false }),
      makeSnipe({ id: 4, status: SnipeStatus.SNIPING }),
    ];
    expect(sortSnipes(list).map((s) => s.id)).toEqual([4, 3, 2, 1]);
  });
});
