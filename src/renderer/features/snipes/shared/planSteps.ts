/**
 * An Open Day plan's reminders on its card and page (§12.39): its release mode (one that only
 * reminds) and the next reminder still to come, at the times main sends them
 * (`reminderSteps`). Pure.
 */
import type {
  ProviderManifest,
  ReleaseModeDescriptor,
} from '../../../../shared/types/provider.types';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { reminderSteps, type ReminderStep } from '../../../../shared/utils/release-reminders';

/** The plan's release mode, when it is a plan and its provider declares the mode. */
export function planModeOf(
  snipe: Pick<SiteSnipe, 'action' | 'releaseMode'>,
  manifest: ProviderManifest | undefined
): ReleaseModeDescriptor | undefined {
  if (snipe.action !== 'remind') return undefined;
  const mode = manifest?.releaseModes?.find((m) => m.id === snipe.releaseMode);
  return mode?.remindOnly ? mode : undefined;
}

/** The plan's reminders at their times, for its release. */
export function planSteps(
  snipe: Pick<SiteSnipe, 'action' | 'releaseMode' | 'releaseAt'>,
  manifest: ProviderManifest | undefined
): ReminderStep[] {
  const mode = planModeOf(snipe, manifest);
  const releaseAt = snipe.releaseAt ? new Date(snipe.releaseAt) : undefined;
  if (!mode || !manifest || !releaseAt || Number.isNaN(releaseAt.getTime())) return [];
  return reminderSteps(releaseAt, mode.reminders ?? [], manifest.timezone);
}

/** The next reminder not yet done and still to come, if any. */
export function nextReminder(
  snipe: Pick<SiteSnipe, 'action' | 'releaseMode' | 'releaseAt' | 'remindersSent'>,
  manifest: ProviderManifest | undefined,
  now: Date
): ReminderStep | undefined {
  const done = new Set((snipe.remindersSent ?? []).map((at) => new Date(at).getTime()));
  return planSteps(snipe, manifest).find(
    (step) => !done.has(step.at.getTime()) && step.at.getTime() > now.getTime()
  );
}
