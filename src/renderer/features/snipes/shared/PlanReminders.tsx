import { useId } from 'react';
import { AlarmClock, CircleCheck, ListChecks } from 'lucide-react';
import type {
  ProviderManifest,
  ReleaseModeDescriptor,
  ReleaseReminder,
} from '../../../../shared/types/provider.types';
import { reminderSteps } from '../../../../shared/utils/release-reminders';
import { timeInZone } from '../../../components/timeFormat';
import { cx } from '../../../components/ui/cx';

/** "6:00 pm" from a reminder's `HH:MM`. */
export function clockLabel(at: string): string {
  const [hour, minute] = at.split(':').map(Number);
  const period = hour < 12 ? 'am' : 'pm';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${period}`;
}

/** "The day before, 6:00 pm", "On the day, 8:15 am", "3 days before, 9:00 am". */
export function reminderWhen(reminder: ReleaseReminder): string {
  const day =
    reminder.daysBefore === 0
      ? 'On the day'
      : reminder.daysBefore === 1
        ? 'The day before'
        : `${reminder.daysBefore} days before`;
  return `${day}, ${clockLabel(reminder.at)}`;
}

interface Row {
  key: string;
  when: string;
  title: string;
  body: string;
  done: boolean;
}

/** The reminders as rows: at their times for a known release, else as days before it. */
function rowsOf(
  mode: ReleaseModeDescriptor,
  timeZone: string,
  releaseAt: Date | undefined,
  sent: readonly Date[],
  now: Date
): Row[] {
  const reminders = mode.reminders ?? [];
  if (!releaseAt) {
    return reminders.map((reminder, i) => ({
      key: `${i}`,
      when: reminderWhen(reminder),
      title: reminder.title,
      body: reminder.body,
      done: false,
    }));
  }
  const done = new Set(sent.map((at) => at.getTime()));
  return reminderSteps(releaseAt, reminders, timeZone).map((step) => ({
    key: step.at.toISOString(),
    when: timeInZone(step.at, timeZone, now),
    title: step.title,
    body: step.body,
    done: done.has(step.at.getTime()),
  }));
}

export interface PlanRemindersProps {
  manifest: ProviderManifest;
  /** The plan's release mode: one that only reminds (`remindOnly`). */
  mode: ReleaseModeDescriptor;
  /** The release the plan reminds before (the Open Day), once known. */
  releaseAt?: Date;
  /** The reminders done so far (`SiteSnipe.remindersSent`), on the plan's page. */
  sent?: readonly Date[];
  now: Date;
  /** The heading level: 3 in the new-snipe flow, 2 on the plan's page. */
  level?: 2 | 3;
  className?: string;
}

/**
 * An Open Day plan's reminders and checklist (§12.38), as the new-snipe flow's Release step and
 * the plan's page show them: when each reminder comes, in the provider's time once the release
 * is known (`reminderSteps`, the same times main sends them at), else as days before it, and
 * which are done; then what to have ready (the mode's `checklist`), and that Site Sniper only
 * reminds.
 */
export function PlanReminders({
  manifest,
  mode,
  releaseAt,
  sent = [],
  now,
  level = 3,
  className,
}: PlanRemindersProps) {
  const remindersId = useId();
  const checklistId = useId();
  const Heading = level === 2 ? 'h2' : 'h3';
  const rows = rowsOf(mode, manifest.timezone, releaseAt, sent, now);
  const checklist = mode.checklist ?? [];
  const provider = manifest.shortName;

  return (
    <div className={cx('flex flex-col gap-4', className)}>
      <section aria-labelledby={remindersId} className="flex flex-col gap-2">
        <Heading
          id={remindersId}
          className="flex items-center gap-2 text-base font-semibold text-fg"
        >
          <AlarmClock size={18} aria-hidden="true" className="shrink-0" />
          Your reminders
        </Heading>
        <ol className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key} className="flex flex-col gap-0.5">
              <p className="text-sm text-fg">
                <span className="font-semibold">{row.when}</span> · {row.title}
                {row.done && (
                  <>
                    {' '}
                    <span className="ml-1 inline-flex items-center gap-1 text-fg-secondary">
                      <CircleCheck size={14} aria-hidden="true" />
                      Done
                    </span>
                  </>
                )}
              </p>
              <p className="text-sm text-fg-secondary">{row.body}</p>
            </li>
          ))}
        </ol>
        <p className="text-sm text-fg-secondary">
          Each comes as a WA Stay alert, and by email when you&apos;ve set up email alerts, while WA
          Stay is running. Site Sniper only reminds you: it doesn&apos;t check {provider}, wait in
          its queue or book for you.
        </p>
      </section>
      {checklist.length > 0 && (
        <section aria-labelledby={checklistId} className="flex flex-col gap-2">
          <Heading
            id={checklistId}
            className="flex items-center gap-2 text-base font-semibold text-fg"
          >
            <ListChecks size={18} aria-hidden="true" className="shrink-0" />
            Have ready
          </Heading>
          <ul className="list-disc pl-5 text-sm text-fg">
            {checklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default PlanReminders;
