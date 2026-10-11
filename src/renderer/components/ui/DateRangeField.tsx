import { useId, useState, type ReactNode, type Ref } from 'react';
import { CalendarRange, CircleAlert } from 'lucide-react';
import { Button } from './Button';
import { Popover } from './Popover';
import { RangeCalendar } from './RangeCalendar';
import {
  choosingDeparture,
  rangeSummary,
  shortDay,
  shortRange,
  type DateRange,
  type IsoDate,
} from './calendar';
import { CONTROL_CLASS } from './controlStyles';
import { cx } from './cx';
import { SegmentMessages } from './SegmentMessages';
import { SEGMENT_CLASS, SEGMENT_LABEL_CLASS } from './searchFieldStyles';
import { useMinWidth } from './useMinWidth';

export interface DateRangeFieldProps {
  label?: string;
  /** Calendar dates, `YYYY-MM-DD`, never `Date`. */
  value: DateRange;
  onChange: (range: DateRange) => void;
  minDate?: IsoDate;
  maxDate?: IsoDate;
  /** Longest stay. Later departures are disabled while choosing, with the reason shown. */
  maxNights?: number;
  appearance?: 'field' | 'segment';
  placeholder?: string;
  /** Shown under the label; in a `segment`, read by screen readers only. */
  hint?: ReactNode;
  /** Marks the field invalid; shown under it (in a `segment`, under the value) and read with it. */
  error?: ReactNode;
  className?: string;
  /** The button that opens the calendar, e.g. to open it from elsewhere ("Try different dates"). */
  triggerRef?: Ref<HTMLButtonElement>;
}

function display(value: DateRange, placeholder: string): string {
  if (!value.arrival) return placeholder;
  if (!value.departure) return `${shortDay(value.arrival)} – add check-out`;
  return shortRange(value.arrival, value.departure);
}

/**
 * Check-in and check-out in one field: a button that opens a Popover with a RangeCalendar
 * (two months at 640 px and wider, one below), a summary, and Clear and Done.
 */
export function DateRangeField({
  label = 'Dates',
  value,
  onChange,
  minDate,
  maxDate,
  maxNights,
  appearance = 'field',
  placeholder = 'Add dates',
  hint,
  error,
  className,
  triggerRef,
}: DateRangeFieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const maxNightsId = `${id}-max-nights`;
  const [open, setOpen] = useState(false);
  const wide = useMinWidth(640);
  const shown = display(value, placeholder);
  const summary = rangeSummary(value);

  const describedBy = cx(hintId, errorId) || undefined;
  const trigger =
    appearance === 'segment' ? (
      <button
        ref={triggerRef}
        type="button"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={SEGMENT_CLASS}
      >
        <span id={labelId} className={SEGMENT_LABEL_CLASS}>
          {label}
        </span>
        <span
          id={valueId}
          className={cx('truncate text-sm', value.arrival ? 'text-fg' : 'text-fg-muted')}
        >
          {shown}
        </span>
        <SegmentMessages hint={hint} hintId={hintId} error={error} errorId={errorId} />
      </button>
    ) : (
      <button
        ref={triggerRef}
        type="button"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={cx(CONTROL_CLASS, 'flex h-10 items-center justify-between gap-2 px-3 text-left')}
      >
        <span id={valueId} className={cx('truncate', !value.arrival && 'text-fg-muted')}>
          {shown}
        </span>
        <CalendarRange size={18} aria-hidden="true" className="shrink-0 text-fg-secondary" />
      </button>
    );

  const popover = (
    <Popover trigger={trigger} label="Choose dates" open={open} onOpenChange={setOpen}>
      {({ close }) => (
        <div className="flex flex-col gap-4">
          <RangeCalendar
            value={value}
            onChange={onChange}
            minDate={minDate}
            maxDate={maxDate}
            maxNights={maxNights}
            months={wide ? 2 : 1}
            maxNightsHintId={maxNightsId}
            autoFocus
          />
          {maxNights !== undefined && choosingDeparture(value) && (
            <p id={maxNightsId} className="text-sm text-fg-muted">
              Stays can be up to {maxNights} nights, so later dates are unavailable.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p aria-live="polite" className="text-sm font-semibold text-fg">
              {summary ?? 'Choose a check-in date'}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => onChange({})}>
                Clear
              </Button>
              <Button variant="secondary" size="sm" onClick={close}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </Popover>
  );

  if (appearance === 'segment') return <div className={className}>{popover}</div>;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <span id={labelId} className="text-sm font-semibold text-fg">
        {label}
      </span>
      {hint && (
        <p id={hintId} className="-mt-1 text-sm text-fg-muted">
          {hint}
        </p>
      )}
      {popover}
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-danger">
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export default DateRangeField;
