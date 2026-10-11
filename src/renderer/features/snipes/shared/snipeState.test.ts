import { SnipeReleaseMode, SnipeStatus } from '../../../../shared/types/common.types';
import { makeHeldSnipe, makeSnipe } from '@tests/fixtures/renderer/snipes';
import {
  primaryActionFor,
  releaseLineFor,
  sortSnipes,
  statusPillFor,
  timelineSteps,
  unitLabel,
} from './snipeState';

const ids = (steps: ReturnType<typeof timelineSteps>) => steps.map((s) => `${s.id}:${s.state}`);

describe('statusPillFor', () => {
  it('calls a disabled snipe Paused and a booked one Booked', () => {
    expect(statusPillFor(SnipeStatus.DISABLED).label).toBe('Paused');
    expect(statusPillFor(SnipeStatus.BOOKED).label).toBe('Booked');
  });

  it('falls back to the raw status for one it does not know', () => {
    expect(statusPillFor('rate_limited').label).toBe('rate_limited');
  });
});

describe('primaryActionFor', () => {
  it.each([
    [SnipeStatus.DISABLED, false, 'arm'],
    [SnipeStatus.ARMED, true, 'disarm'],
    [SnipeStatus.QUEUEING, true, 'disarm'],
    [SnipeStatus.WAITING_RELEASE, true, 'disarm'],
    [SnipeStatus.SNIPING, true, 'disarm'],
    [SnipeStatus.HELD, false, 'pay'],
    [SnipeStatus.BOOKED, false, 'booking'],
    [SnipeStatus.EXPIRED, false, 'arm-again'],
    [SnipeStatus.FAILED, false, 'arm-again'],
  ])('%s (active %s) leads with %s', (status, isActive, action) => {
    expect(primaryActionFor({ status, isActive })).toBe(action);
  });

  it('never offers Arm for a held or booked snipe, and nothing for an unknown status', () => {
    expect(primaryActionFor({ status: SnipeStatus.HELD, isActive: true })).toBe('pay');
    expect(primaryActionFor({ status: 'mystery' as SnipeStatus, isActive: true })).toBeNull();
  });
});

describe('timelineSteps', () => {
  it('leaves out the queue step unless the snipe uses the provider’s queue', () => {
    expect(ids(timelineSteps(makeSnipe()))).toEqual([
      'armed:current',
      'waiting:upcoming',
      'sniping:upcoming',
      'held:upcoming',
      'booked:upcoming',
    ]);
    expect(
      ids(timelineSteps(makeSnipe({ accessGateEnabled: true, status: SnipeStatus.QUEUEING })))
    ).toEqual([
      'armed:done',
      'queueing:current',
      'waiting:upcoming',
      'sniping:upcoming',
      'held:upcoming',
      'booked:upcoming',
    ]);
  });

  it('marks the steps before the current one done', () => {
    expect(ids(timelineSteps(makeSnipe({ status: SnipeStatus.SNIPING })))).toEqual([
      'armed:done',
      'waiting:done',
      'sniping:current',
      'held:upcoming',
      'booked:upcoming',
    ]);
    expect(ids(timelineSteps(makeHeldSnipe()))).toEqual([
      'armed:done',
      'waiting:done',
      'sniping:done',
      'held:current',
      'booked:upcoming',
    ]);
  });

  it('ends at Booked, current once there is a booking', () => {
    const booked = makeHeldSnipe(10, { status: SnipeStatus.BOOKED, bookedReference: 'PB123' });
    expect(timelineSteps(booked).at(-1)).toMatchObject({ id: 'booked', state: 'current' });
  });

  it('has the same number of steps in every state, so "Step n of N" keeps its N', () => {
    const states = [
      makeSnipe({ status: SnipeStatus.DISABLED, isActive: false }),
      makeSnipe(),
      makeSnipe({ status: SnipeStatus.WAITING_RELEASE }),
      makeSnipe({ status: SnipeStatus.SNIPING }),
      makeHeldSnipe(),
      makeHeldSnipe(10, { status: SnipeStatus.BOOKED, bookedReference: 'PB123' }),
      makeHeldSnipe(-5, { status: SnipeStatus.EXPIRED }),
      makeSnipe({ status: SnipeStatus.EXPIRED }),
      makeSnipe({ status: SnipeStatus.FAILED }),
    ];
    expect(states.map((snipe) => timelineSteps(snipe).length)).toEqual(states.map(() => 5));
    const queued = states.map((snipe) => ({ ...snipe, accessGateEnabled: true }));
    expect(queued.map((snipe) => timelineSteps(snipe).length)).toEqual(states.map(() => 6));
  });

  it('has no release to wait for when watching for cancellations', () => {
    const steps = timelineSteps(
      makeSnipe({ releaseMode: SnipeReleaseMode.CANCELLATION, status: SnipeStatus.SNIPING })
    );
    expect(steps.map((s) => s.label)).toEqual(['Armed', 'Sniping', 'Held', 'Booked']);
  });

  it('ends an expired or failed snipe with a terminal step, marking only what happened', () => {
    expect(ids(timelineSteps(makeHeldSnipe(-5, { status: SnipeStatus.EXPIRED })))).toEqual([
      'armed:done',
      'waiting:done',
      'sniping:done',
      'held:done',
      'expired:current',
    ]);
    const lapsed = timelineSteps(makeSnipe({ status: SnipeStatus.EXPIRED }));
    expect(lapsed.at(-1)).toMatchObject({ label: 'Expired', terminal: true });
    expect(lapsed.find((s) => s.id === 'held')?.state).toBe('missed');
    expect(ids(timelineSteps(makeSnipe({ status: SnipeStatus.FAILED })))).toEqual([
      'armed:done',
      'waiting:missed',
      'sniping:missed',
      'held:missed',
      'failed:current',
    ]);
    expect(timelineSteps(makeHeldSnipe(-5, { status: SnipeStatus.EXPIRED })).at(-1)?.label).toBe(
      'Hold expired'
    );
  });

  it('has no current step while paused, and survives an unknown status', () => {
    expect(
      timelineSteps(makeSnipe({ status: SnipeStatus.DISABLED, isActive: false })).every(
        (s) => s.state === 'upcoming'
      )
    ).toBe(true);
    expect(timelineSteps(makeSnipe({ status: 'mystery' as SnipeStatus })).length).toBe(5);
  });
});

describe('releaseLineFor', () => {
  const at = new Date('2099-06-14T16:00:00Z');

  it('counts down to a running snipe’s release, or says it keeps checking', () => {
    expect(releaseLineFor(makeSnipe({ releaseAt: at }))).toEqual({ kind: 'countdown', at });
    expect(
      releaseLineFor(
        makeSnipe({ releaseMode: SnipeReleaseMode.CANCELLATION, releaseAt: undefined })
      )
    ).toEqual({ kind: 'cancellation' });
    expect(releaseLineFor(makeSnipe({ releaseAt: undefined }))).toEqual({ kind: 'unknown' });
  });

  it('gives a paused snipe its release as a time, and says nothing once it has finished', () => {
    expect(
      releaseLineFor(makeSnipe({ status: SnipeStatus.DISABLED, isActive: false, releaseAt: at }))
    ).toEqual({ kind: 'scheduled', at });
    expect(releaseLineFor(makeHeldSnipe())).toEqual({ kind: 'none' });
    expect(releaseLineFor(makeSnipe({ status: SnipeStatus.SNIPING }))).toEqual({ kind: 'none' });
    expect(
      releaseLineFor(
        makeSnipe({
          releaseMode: SnipeReleaseMode.CANCELLATION,
          status: SnipeStatus.DISABLED,
          isActive: false,
        })
      )
    ).toEqual({ kind: 'none' });
  });
});

describe('unitLabel', () => {
  const sites = { one: 'site', many: 'sites' };

  it('names a unit by the place’s name for it, else by its id', () => {
    expect(unitLabel('12', sites, new Map([['12', 'Site 12 (powered)']]))).toBe(
      'Site 12 (powered)'
    );
    expect(unitLabel('12', sites)).toBe('Site 12');
    expect(unitLabel(undefined, sites)).toBe('A site');
    // A class id is never shown.
    expect(unitLabel('class:117', sites)).toBe('A site');
    expect(unitLabel('class:117', sites, new Map([['class:117', 'Camp site (no power)']]))).toBe(
      'Camp site (no power)'
    );
  });
});

describe('sortSnipes', () => {
  it('puts a hold first, then running snipes by release, then paused, ended and booked', () => {
    const soon = new Date(Date.now() + 3_600_000);
    const later = new Date(Date.now() + 7_200_000);
    const list = [
      makeSnipe({ id: 1, status: SnipeStatus.BOOKED }),
      makeSnipe({ id: 2, status: SnipeStatus.DISABLED, isActive: false }),
      makeSnipe({ id: 3, releaseAt: later }),
      makeSnipe({ id: 4, status: SnipeStatus.FAILED, isActive: false }),
      makeHeldSnipe(20, { id: 5 }),
      makeSnipe({ id: 6, releaseAt: soon }),
      makeSnipe({ id: 7, status: SnipeStatus.SNIPING }),
    ];
    expect(sortSnipes(list).map((s) => s.id)).toEqual([5, 7, 6, 3, 2, 4, 1]);
    expect(list[0].id).toBe(1);
  });
});
