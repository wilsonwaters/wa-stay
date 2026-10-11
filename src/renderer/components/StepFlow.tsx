import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Button, VisuallyHidden } from './ui';
import { cx } from './ui/cx';

export interface FlowStep {
  id: string;
  title: string;
}

export interface StepFlowProps {
  /** Names the step list, e.g. "New watch steps". */
  label: string;
  steps: FlowStep[];
  /** The id of the step on screen. */
  current: string;
  /** Called to move to another step: Back, Continue, or a finished step in the list. */
  onStepChange: (id: string) => void;
  /**
   * Checks the current step before moving on (or, on the last step, finishes the flow).
   * Resolve `false` to stay: the first invalid field in the step then takes focus.
   */
  onContinue: () => Promise<boolean> | boolean;
  /** The last step's button, e.g. "Create watch". */
  finalLabel: string;
  /** Shows the final button as busy while the flow finishes. */
  finishing?: boolean;
  /** The current step's content. */
  children: ReactNode;
  className?: string;
}

/** The first control in `root` marked invalid, so a failed step can send focus to it. */
function firstInvalid(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? null;
}

/**
 * A create flow, one step at a time: an ordered step list (finished steps can be revisited,
 * the current one has `aria-current="step"`), the step's heading and content, and Back and
 * Continue. Moving to a step focuses its heading (not on first render, so the page heading
 * keeps the route's focus); a step that fails its check focuses its first invalid field.
 * Domain-generic: the caller owns the form and the step order.
 */
export function StepFlow({
  label,
  steps,
  current,
  onStepChange,
  onContinue,
  finalLabel,
  finishing = false,
  children,
  className,
}: StepFlowProps) {
  const index = Math.max(
    0,
    steps.findIndex((step) => step.id === current)
  );
  const step = steps[index];
  const last = index === steps.length - 1;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const shown = useRef(current);
  const checking = useRef(false);
  const [invalidTick, setInvalidTick] = useState(0);

  useEffect(() => {
    if (shown.current === current) return;
    shown.current = current;
    headingRef.current?.focus();
  }, [current]);

  useEffect(() => {
    if (invalidTick > 0) firstInvalid(panelRef.current)?.focus();
  }, [invalidTick]);

  const next = async () => {
    if (checking.current || finishing) return;
    checking.current = true;
    try {
      const ok = await onContinue();
      if (!ok) setInvalidTick((tick) => tick + 1);
      else if (!last) onStepChange(steps[index + 1].id);
    } finally {
      checking.current = false;
    }
  };

  return (
    <div className={cx('flex flex-col gap-8', className)}>
      <nav aria-label={label}>
        <ol className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {steps.map((item, i) => {
            const done = i < index;
            const isCurrent = i === index;
            const marker = (
              <span
                aria-hidden="true"
                className={cx(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                  isCurrent && 'bg-brand text-fg-inverse',
                  done && 'bg-brand-subtle text-brand-strong',
                  !isCurrent && !done && 'border border-border-strong text-fg-muted'
                )}
              >
                {done ? <Check size={14} /> : i + 1}
              </span>
            );
            return (
              <li key={item.id} aria-current={isCurrent ? 'step' : undefined}>
                {done ? (
                  <button
                    type="button"
                    onClick={() => onStepChange(item.id)}
                    className="flex items-center gap-2 rounded-md font-semibold text-brand-strong hover:underline"
                  >
                    {marker}
                    <span aria-hidden="true">{item.title}</span>
                    <VisuallyHidden>{`${item.title}, done`}</VisuallyHidden>
                  </button>
                ) : (
                  <span
                    className={cx(
                      'flex items-center gap-2',
                      isCurrent ? 'font-semibold text-fg' : 'text-fg-muted'
                    )}
                  >
                    {marker}
                    {item.title}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <section aria-labelledby={`step-${step.id}-heading`} className="flex flex-col gap-6">
        <h2
          id={`step-${step.id}-heading`}
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold text-fg"
        >
          <VisuallyHidden>{`Step ${index + 1} of ${steps.length}: `}</VisuallyHidden>
          {step.title}
        </h2>
        <div ref={panelRef} className="flex flex-col gap-6">
          {children}
        </div>
      </section>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
        {index > 0 ? (
          <Button variant="ghost" onClick={() => onStepChange(steps[index - 1].id)}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" onClick={() => void next()} loading={finishing}>
          {last ? finalLabel : 'Continue'}
        </Button>
      </div>
    </div>
  );
}

export default StepFlow;
