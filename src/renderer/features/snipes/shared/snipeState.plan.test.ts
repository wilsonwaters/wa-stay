/**
 * `snipeState` and `planSteps` for Open Day plans (§12.39): a plan's timeline is "Reminders
 * set" then "Reminders sent", its pill reads "Reminders set" while it runs, a reminded or
 * expired plan is offered no Arm again (main refuses a past release), it sorts with the ended
 * snipes once reminded, and its next reminder is the first neither done nor past.
 */
import { SnipeStatus } from '../../../../shared/types/common.types';
import { DEFAULT_UNIT_NOUN } from '../../../components/nightGridModel';
import { makePlan, makeSnipe, PLAN_OPEN_DAY } from '@tests/fixtures/renderer/snipes';
import { ROTTNEST_MANIFEST } from '@tests/utils/renderer/manifests';
import { nextReminder, planModeOf, planSteps } from './planSteps';
import {
  isFinished,
  primaryActionFor,
  releaseLineFor,
  sortSnipes,
  statusPillFor,
  timelineSteps,
} from './snipeState';

const ids = (steps: ReturnType<typeof timelineSteps>) => steps.map((s) => `${s.id}:${s.state}`);
const FIRST = new Date('2099-11-03T10:00:00.000Z');
const SECOND = new Date('2099-11-03T22:00:00.000Z');
const THIRD = new Date('2099-11-04T00:15:00.000Z');

describe('an Open Day plan', () => {
  it('runs as "Reminders set", then ends at "Reminders sent", finished, with no release line', () => {
    expect(ids(timelineSteps(makePlan()))).toEqual(['armed:current', 'reminded:upcoming']);
    expect(statusPillFor(SnipeStatus.ARMED, DEFAULT_UNIT_NOUN, 'remind').label).toBe(
      'Reminders set'
    );
    expect(statusPillFor(SnipeStatus.ARMED, DEFAULT_UNIT_NOUN, 'alert').label).not.toBe(
      'Reminders set'
    );
    const reminded = makePlan({ status: SnipeStatus.REMINDED, isActive: false });
    expect(ids(timelineSteps(reminded))).toEqual(['armed:done', 'reminded:current']);
    expect(statusPillFor(SnipeStatus.REMINDED, DEFAULT_UNIT_NOUN, 'remind').label).toBe(
      'Reminders sent'
    );
    expect(isFinished(reminded)).toBe(true);
    expect(releaseLineFor(reminded)).toEqual({ kind: 'none' });
  });

  it('counts down to its release while it runs, and says nothing without one', () => {
    expect(releaseLineFor(makePlan())).toEqual({ kind: 'countdown', at: PLAN_OPEN_DAY });
    expect(releaseLineFor(makePlan({ releaseAt: undefined }))).toEqual({ kind: 'none' });
  });

  it('expired, it stopped after being set; neither it nor a reminded plan is offered Arm again', () => {
    const expired = makePlan({ status: SnipeStatus.EXPIRED, isActive: false });
    expect(ids(timelineSteps(expired))).toEqual(['armed:done', 'expired:current']);
    expect(primaryActionFor(expired)).toBeNull();
    expect(
      primaryActionFor(makePlan({ status: SnipeStatus.REMINDED, isActive: false }))
    ).toBeNull();
    // A snipe that expired is offered Arm again, as before
    expect(primaryActionFor(makeSnipe({ status: SnipeStatus.EXPIRED, isActive: false }))).toBe(
      'arm-again'
    );
    expect(primaryActionFor(makePlan())).toBe('disarm');
    expect(primaryActionFor(makePlan({ status: SnipeStatus.DISABLED, isActive: false }))).toBe(
      'arm'
    );
  });

  it('once reminded, sorts with the ended snipes', () => {
    const reminded = makePlan({ id: 1, status: SnipeStatus.REMINDED, isActive: false });
    const armed = makePlan({ id: 2 });
    const booked = makeSnipe({ id: 3, status: SnipeStatus.BOOKED, isActive: false });
    expect(sortSnipes([booked, reminded, armed]).map((s) => s.id)).toEqual([2, 1, 3]);
  });

  it('has its mode’s reminders at their times, and the next is the first neither done nor past', () => {
    expect(planModeOf(makePlan(), ROTTNEST_MANIFEST)?.id).toBe('open_day');
    expect(planModeOf(makeSnipe(), ROTTNEST_MANIFEST)).toBeUndefined();
    expect(planSteps(makePlan(), ROTTNEST_MANIFEST).map((step) => step.at)).toEqual([
      FIRST,
      SECOND,
      THIRD,
    ]);
    expect(planSteps(makePlan(), undefined)).toEqual([]);
    const before = new Date('2099-11-01T00:00:00.000Z');
    expect(nextReminder(makePlan(), ROTTNEST_MANIFEST, before)?.at).toEqual(FIRST);
    expect(
      nextReminder(makePlan({ remindersSent: [FIRST] }), ROTTNEST_MANIFEST, before)?.at
    ).toEqual(SECOND);
    expect(nextReminder(makePlan(), ROTTNEST_MANIFEST, new Date(SECOND.getTime() + 1))?.at).toEqual(
      THIRD
    );
    expect(
      nextReminder(makePlan({ remindersSent: [FIRST, SECOND, THIRD] }), ROTTNEST_MANIFEST, before)
    ).toBeUndefined();
  });
});
