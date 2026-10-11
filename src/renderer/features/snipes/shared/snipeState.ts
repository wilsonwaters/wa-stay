/**
 * What state a snipe is in, as the UI shows it: its status label and pill, which action leads,
 * its timeline, and what its release line says. The one place that decides; pure.
 */
import { CircleHelp } from 'lucide-react';
import { SnipeReleaseMode, SnipeStatus } from '../../../../shared/types/common.types';
import type { ProviderManifest } from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { unitNoun } from '../../../components/locationFormat';
import type { UnitNoun } from '../../../components/stay/UnitPicker';
import { statusPresets, type StatusPreset } from '../../../components/ui';

const KNOWN = new Set<string>(Object.values(SnipeStatus));

/** The status pill: the preset ("Paused", "Booked"…), or the raw status for one it does not know. */
export function statusPillFor(status: string): StatusPreset {
  if (KNOWN.has(status)) return statusPresets.snipe[status as SnipeStatus];
  return { tone: 'neutral', icon: CircleHelp, label: status };
}

/** Working towards a hold: armed, in the queue, waiting for the release, or trying now. */
const RUNNING = new Set<string>([
  SnipeStatus.ARMED,
  SnipeStatus.QUEUEING,
  SnipeStatus.WAITING_RELEASE,
  SnipeStatus.SNIPING,
]);

export function isRunning(snipe: Pick<SiteSnipe, 'status' | 'isActive'>): boolean {
  return snipe.isActive && RUNNING.has(snipe.status);
}

/** The snipe has finished one way or another: nothing will change unless it is armed again. */
export function isFinished(snipe: Pick<SiteSnipe, 'status'>): boolean {
  return (
    snipe.status === SnipeStatus.HELD ||
    snipe.status === SnipeStatus.BOOKED ||
    snipe.status === SnipeStatus.EXPIRED ||
    snipe.status === SnipeStatus.FAILED
  );
}

/**
 * The one visible action, by status: Arm a paused (or ended) snipe, Disarm a running one, pay
 * for a held site, see a booked one. Main refuses to arm a held or booked snipe again (§12.31),
 * so neither is ever offered Arm.
 */
export type PrimaryAction = 'arm' | 'arm-again' | 'disarm' | 'pay' | 'booking';

export function primaryActionFor(
  snipe: Pick<SiteSnipe, 'status' | 'isActive'>
): PrimaryAction | null {
  switch (snipe.status) {
    case SnipeStatus.HELD:
      return 'pay';
    case SnipeStatus.BOOKED:
      return 'booking';
    case SnipeStatus.EXPIRED:
    case SnipeStatus.FAILED:
      return 'arm-again';
    case SnipeStatus.DISABLED:
      return 'arm';
    default:
      if (RUNNING.has(snipe.status)) return snipe.isActive ? 'disarm' : 'arm';
      return null;
  }
}

export type StepState = 'done' | 'current' | 'upcoming' | 'missed';

export interface TimelineStep {
  id: string;
  label: string;
  state: StepState;
  /** A terminal step (expired, failed): the snipe stopped here. */
  terminal?: boolean;
}

/**
 * The steps in order (the state machine in tech-review): Armed → … → Held → Booked. Booked is
 * always there, still to come until the hold is paid for, so a snipe counts the same steps in
 * every state ("Step 4 of 5: Held", then "Step 5 of 5: Booked").
 */
function stepsFor(snipe: SiteSnipe): { id: string; label: string }[] {
  const continuous = snipe.releaseMode === SnipeReleaseMode.CANCELLATION;
  const queue = snipe.accessGateEnabled || snipe.status === SnipeStatus.QUEUEING;
  return [
    { id: 'armed', label: 'Armed' },
    ...(queue ? [{ id: 'queueing', label: 'Queueing' }] : []),
    // A cancellation snipe has no release to wait for.
    ...(continuous && snipe.status !== SnipeStatus.WAITING_RELEASE
      ? []
      : [{ id: 'waiting', label: 'Waiting for release' }]),
    { id: 'sniping', label: 'Sniping' },
    { id: 'held', label: 'Held' },
    { id: 'booked', label: 'Booked' },
  ];
}

const CURRENT_STEP: Partial<Record<string, string>> = {
  [SnipeStatus.ARMED]: 'armed',
  [SnipeStatus.QUEUEING]: 'queueing',
  [SnipeStatus.WAITING_RELEASE]: 'waiting',
  [SnipeStatus.SNIPING]: 'sniping',
  [SnipeStatus.HELD]: 'held',
  [SnipeStatus.BOOKED]: 'booked',
};

/**
 * The timeline: each step done, current, still to come, or (once the snipe has stopped) not
 * reached. A paused or unknown status has no current step. Expired and Failed take Booked's
 * place as the current, terminal step, so the count stays the same; only steps known to have
 * happened are marked done (an expired hold was held; an expired window was spent sniping; a
 * failure only says it was armed).
 */
export function timelineSteps(snipe: SiteSnipe): TimelineStep[] {
  const steps = stepsFor(snipe);
  const current = CURRENT_STEP[snipe.status];
  if (current) {
    const at = steps.findIndex((step) => step.id === current);
    return steps.map((step, i) => ({
      ...step,
      state: i < at ? 'done' : i === at ? 'current' : 'upcoming',
    }));
  }
  if (snipe.status === SnipeStatus.EXPIRED || snipe.status === SnipeStatus.FAILED) {
    const wasHeld = Boolean(snipe.holdReference || snipe.holdExpiresAt);
    const reachedId = snipe.status === SnipeStatus.FAILED ? 'armed' : wasHeld ? 'held' : 'sniping';
    const reached = steps.findIndex((step) => step.id === reachedId);
    const terminalLabel =
      snipe.status === SnipeStatus.FAILED ? 'Failed' : wasHeld ? 'Hold expired' : 'Expired';
    return [
      ...steps
        .filter((step) => step.id !== 'booked')
        .map((step, i): TimelineStep => ({ ...step, state: i <= reached ? 'done' : 'missed' })),
      { id: snipe.status, label: terminalLabel, state: 'current', terminal: true },
    ];
  }
  return steps.map((step) => ({ ...step, state: 'upcoming' }));
}

/** What a step's state is called, for screen readers and the detail list. */
export const STEP_STATE_TEXT: Record<StepState, string> = {
  done: 'done',
  current: 'current step',
  upcoming: 'not yet',
  missed: 'not reached',
};

/**
 * The release line under a snipe:
 * - cancellation: no release, it keeps checking (while it runs);
 * - countdown: a running snipe before its release (it may pass while on screen: "Opening now");
 * - scheduled: a paused snipe's release, as a time, never a countdown it will not act on;
 * - unknown: a running snipe whose release time the provider could not work out;
 * - none: trying now, held, booked or ended (the status says it).
 */
export type ReleaseLine =
  | { kind: 'cancellation' }
  | { kind: 'countdown'; at: Date }
  | { kind: 'scheduled'; at: Date }
  | { kind: 'unknown' }
  | { kind: 'none' };

export function releaseLineFor(snipe: SiteSnipe): ReleaseLine {
  if (isFinished(snipe) || snipe.status === SnipeStatus.SNIPING) return { kind: 'none' };
  if (snipe.releaseMode === SnipeReleaseMode.CANCELLATION) {
    return isRunning(snipe) ? { kind: 'cancellation' } : { kind: 'none' };
  }
  const at = snipe.releaseAt ? new Date(snipe.releaseAt) : undefined;
  if (!isRunning(snipe)) return at ? { kind: 'scheduled', at } : { kind: 'none' };
  return at ? { kind: 'countdown', at } : { kind: 'unknown' };
}

/**
 * What a provider's units are called (its main location kind): ParkStay's are sites. A snipe
 * keeps no location kind, so this is the provider's first.
 */
export function unitNounFor(manifest: ProviderManifest | undefined): UnitNoun {
  return unitNoun(manifest?.locationKinds[0]);
}

/**
 * A unit by the place's own name for it ("CAMPSITE 01", "Camp site (no power)"). Without one, a
 * plain number reads "Site 12"; any other id (a class such as `class:117`) is never shown and
 * reads "A site".
 */
export function unitLabel(
  unitId: string | undefined,
  noun: UnitNoun,
  names?: ReadonlyMap<string, string>
): string {
  const named = unitId ? names?.get(unitId) : undefined;
  if (named) return named;
  if (!unitId || !/^\d+$/.test(unitId)) return `A ${noun.one}`;
  return `${noun.one.charAt(0).toUpperCase()}${noun.one.slice(1)} ${unitId}`;
}

/** Most urgent first: a hold to pay for, then running snipes, paused, ended, booked. */
const URGENCY: Partial<Record<string, number>> = {
  [SnipeStatus.HELD]: 0,
  [SnipeStatus.SNIPING]: 1,
  [SnipeStatus.QUEUEING]: 1,
  [SnipeStatus.WAITING_RELEASE]: 1,
  [SnipeStatus.ARMED]: 2,
  [SnipeStatus.DISABLED]: 3,
  [SnipeStatus.FAILED]: 4,
  [SnipeStatus.EXPIRED]: 4,
  [SnipeStatus.BOOKED]: 5,
};

/**
 * The list's order: by urgency, then the soonest release (a hold by its expiry), then the
 * earliest stay, then newest. A new array; the input is left as it is.
 */
export function sortSnipes(snipes: readonly SiteSnipe[]): SiteSnipe[] {
  const due = (snipe: SiteSnipe) => {
    const at = snipe.status === SnipeStatus.HELD ? snipe.holdExpiresAt : snipe.releaseAt;
    return at ? new Date(at).getTime() : Number.POSITIVE_INFINITY;
  };
  return [...snipes].sort(
    (a, b) =>
      (URGENCY[a.status] ?? 3) - (URGENCY[b.status] ?? 3) ||
      due(a) - due(b) ||
      a.stay.arrival.localeCompare(b.stay.arrival) ||
      b.id - a.id
  );
}
