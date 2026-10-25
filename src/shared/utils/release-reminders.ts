/**
 * An Open Day plan's reminders as instants (§12.39): a reminder-only release mode declares
 * them as days before the release day and a local time (`ReleaseReminder`), and this works out
 * when each is due for one release, in the provider's time zone. Main sends them on time;
 * the renderer shows the same times on the plan. Pure.
 */

import type { ReleaseReminder } from '../types/provider.types';
import { addDays, todayIn, zonedInstant } from './calendar-date';

/** How long after its release a plan still sends a reminder it missed (WA Stay was closed). */
export const REMINDER_LATE_MS = 30 * 60_000;

export interface ReminderStep {
  /** When it is due. */
  at: Date;
  title: string;
  body: string;
}

/**
 * When each reminder is due for a release at `releaseAt`, in order; a reminder that would come
 * at or after the release is left out.
 */
export function reminderSteps(
  releaseAt: Date,
  reminders: readonly ReleaseReminder[],
  timeZone: string
): ReminderStep[] {
  const releaseDay = todayIn(timeZone, releaseAt);
  return reminders
    .map((reminder): ReminderStep => {
      const [hour, minute] = reminder.at.split(':').map(Number);
      return {
        at: zonedInstant(addDays(releaseDay, -reminder.daysBefore), { hour, minute }, timeZone),
        title: reminder.title,
        body: reminder.body,
      };
    })
    .filter((step) => step.at.getTime() < releaseAt.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}
