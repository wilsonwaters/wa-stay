import { Check, Circle, CircleDot, Minus, X } from 'lucide-react';
import type { SiteSnipe } from '../../../../shared/types/site-sniper.types';
import { VisuallyHidden } from '../../../components/ui';
import { cx } from '../../../components/ui/cx';
import { STEP_STATE_TEXT, timelineSteps, type TimelineStep } from './snipeState';

export interface SnipeTimelineProps {
  snipe: SiteSnipe;
  /** Only where it is ("Step 2 of 5: Waiting for release"), for a card. The detail page lists every step. */
  compact?: boolean;
  className?: string;
}

/** What each step's state is called beside it on the detail page. */
const VISIBLE_STATE: Record<TimelineStep['state'], string> = {
  done: 'Done',
  current: 'Now',
  upcoming: 'Not yet',
  missed: 'Not reached',
};

function StepIcon({ step, size }: { step: TimelineStep; size: number }) {
  if (step.terminal) return <X size={size} aria-hidden="true" />;
  if (step.state === 'done') return <Check size={size} aria-hidden="true" />;
  if (step.state === 'current') return <CircleDot size={size} aria-hidden="true" />;
  if (step.state === 'missed') return <Minus size={size} aria-hidden="true" />;
  return <Circle size={size} aria-hidden="true" />;
}

/**
 * A card's one line of progress: the current step and how many there are ("Step 2 of 5:
 * Waiting for release"), "Stopped: Hold expired" once it has ended, "Not running" while paused.
 */
export function compactProgress(steps: readonly TimelineStep[]): string {
  const at = steps.findIndex((step) => step.state === 'current');
  const step = steps[at];
  if (!step) return 'Not running';
  if (step.terminal) return `Stopped: ${step.label}`;
  return `Step ${at + 1} of ${steps.length}: ${step.label}`;
}

/**
 * Where a snipe is in its run: an ordered list of steps (Armed → Queueing → Waiting for release
 * → Sniping → Held → Booked), the current one `aria-current="step"`. Each step says its state
 * in words and with an icon, never by colour alone.
 */
export function SnipeTimeline({ snipe, compact = false, className }: SnipeTimelineProps) {
  const steps = timelineSteps(snipe);
  if (compact) {
    return <p className={cx('text-sm text-fg-muted', className)}>{compactProgress(steps)}</p>;
  }
  return (
    <ol aria-label="Progress" className={cx('flex flex-col', className)}>
      {steps.map((step, i) => (
        <li
          key={step.id}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className="relative flex gap-3 pb-4 last:pb-0"
        >
          {i < steps.length - 1 && (
            <span
              aria-hidden="true"
              className="absolute left-3 top-7 h-[calc(100%-1.75rem)] w-px bg-border"
            />
          )}
          <span
            className={cx(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
              step.state === 'done' && 'bg-brand-subtle text-brand-strong',
              step.state === 'current' && !step.terminal && 'bg-brand text-fg-inverse',
              step.terminal && 'bg-danger-subtle text-danger-fg',
              (step.state === 'upcoming' || step.state === 'missed') &&
                'border border-border-strong text-fg-muted'
            )}
          >
            <StepIcon step={step} size={14} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span
              className={cx(
                'text-sm',
                step.state === 'current' ? 'font-semibold text-fg' : 'text-fg-secondary'
              )}
            >
              {step.label}
            </span>
            <span className="text-xs text-fg-muted">
              <span aria-hidden="true">{VISIBLE_STATE[step.state]}</span>
              <VisuallyHidden>{STEP_STATE_TEXT[step.state]}</VisuallyHidden>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export default SnipeTimeline;
