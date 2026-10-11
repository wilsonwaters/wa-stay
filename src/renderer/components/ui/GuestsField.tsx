import { useId, type ReactNode } from 'react';
import { CircleAlert, Users } from 'lucide-react';
import { Button } from './Button';
import { Popover } from './Popover';
import { Stepper } from './Stepper';
import { CONTROL_CLASS } from './controlStyles';
import { cx } from './cx';
import { SegmentMessages } from './SegmentMessages';
import { SEGMENT_CLASS, SEGMENT_LABEL_CLASS } from './searchFieldStyles';

export interface Guests {
  adults: number;
  children: number;
  infants: number;
}

type GuestKind = keyof Guests;
export type GuestLimits = Record<GuestKind, { min: number; max: number }>;

export const DEFAULT_GUEST_LIMITS: GuestLimits = {
  adults: { min: 1, max: 16 },
  children: { min: 0, max: 10 },
  infants: { min: 0, max: 5 },
};

export const DEFAULT_GUEST_HINTS: Record<GuestKind, string> = {
  adults: '18 or over',
  children: '6–17',
  infants: 'Under 6',
};

const ROWS: { kind: GuestKind; label: string; one: string; many: string }[] = [
  { kind: 'adults', label: 'Adults', one: 'adult', many: 'adults' },
  { kind: 'children', label: 'Children', one: 'child', many: 'children' },
  { kind: 'infants', label: 'Infants', one: 'infant', many: 'infants' },
];

/** "2 adults, 1 child", or undefined when nobody is chosen yet. */
export function guestsSummary(guests: Guests | undefined): string | undefined {
  if (!guests) return undefined;
  const parts = ROWS.filter((row) => guests[row.kind] > 0).map(
    (row) => `${guests[row.kind]} ${guests[row.kind] === 1 ? row.one : row.many}`
  );
  return parts.length ? parts.join(', ') : undefined;
}

export interface GuestsFieldProps {
  label?: string;
  /** Leave undefined until the person chooses: the field reads "Add guests". */
  value?: Guests;
  onChange: (guests: Guests) => void;
  limits?: Partial<GuestLimits>;
  hints?: Partial<Record<GuestKind, string>>;
  appearance?: 'field' | 'segment';
  /** Marks the field invalid; shown under it (in a `segment`, under the value) and read with it. */
  error?: ReactNode;
  className?: string;
}

/**
 * Who is coming: adults, children and infants, each a Stepper in a Popover. Provider rules
 * (concessions, equipment, party size) belong to provider stay fields, not here.
 */
export function GuestsField({
  label = 'Guests',
  value,
  onChange,
  limits: limitsProp,
  hints: hintsProp,
  appearance = 'field',
  error,
  className,
}: GuestsFieldProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const errorId = error ? `${id}-error` : undefined;
  const limits = { ...DEFAULT_GUEST_LIMITS, ...limitsProp };
  const hints = { ...DEFAULT_GUEST_HINTS, ...hintsProp };
  const current: Guests = value ?? {
    adults: limits.adults.min,
    children: limits.children.min,
    infants: limits.infants.min,
  };
  const summary = guestsSummary(value) ?? 'Add guests';

  const trigger =
    appearance === 'segment' ? (
      <button
        type="button"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={errorId}
        aria-invalid={error ? true : undefined}
        className={SEGMENT_CLASS}
      >
        <span id={labelId} className={SEGMENT_LABEL_CLASS}>
          {label}
        </span>
        <span id={valueId} className={cx('truncate text-sm', value ? 'text-fg' : 'text-fg-muted')}>
          {summary}
        </span>
        <SegmentMessages error={error} errorId={errorId} />
      </button>
    ) : (
      <button
        type="button"
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={errorId}
        aria-invalid={error ? true : undefined}
        className={cx(CONTROL_CLASS, 'flex h-10 items-center justify-between gap-2 px-3 text-left')}
      >
        <span id={valueId} className={cx('truncate', !value && 'text-fg-muted')}>
          {summary}
        </span>
        <Users size={18} aria-hidden="true" className="shrink-0 text-fg-secondary" />
      </button>
    );

  const popover = (
    <Popover trigger={trigger} label="Choose guests" className="w-80">
      {({ close }) => (
        <div className="flex flex-col gap-5">
          {ROWS.map((row) => (
            <Stepper
              key={row.kind}
              label={row.label}
              hint={hints[row.kind]}
              value={current[row.kind]}
              min={limits[row.kind].min}
              max={limits[row.kind].max}
              onChange={(next) => onChange({ ...current, [row.kind]: next })}
            />
          ))}
          <div className="flex justify-end border-t border-border pt-3">
            <Button variant="secondary" size="sm" onClick={close}>
              Done
            </Button>
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

export default GuestsField;
