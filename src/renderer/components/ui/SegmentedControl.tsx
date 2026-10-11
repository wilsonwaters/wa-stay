import { useId, useState, type ReactNode } from 'react';
import { cx } from './cx';

export interface SegmentedOption {
  value: string;
  label: ReactNode;
  /** A decorative icon before the label. */
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  /** Names the radio group, e.g. "View". */
  label: string;
  options: SegmentedOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  className?: string;
}

/**
 * Two to four mutually exclusive views ("Map" / "List"): a `radiogroup` of native radios, so
 * arrow keys move the selection. The selected segment is a solid ink fill.
 */
export function SegmentedControl({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  className,
}: SegmentedControlProps) {
  const generated = useId();
  const groupName = name ?? `segmented${generated}`;
  const [inner, setInner] = useState(defaultValue ?? options[0]?.value);
  const current = value ?? inner;
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(
        'inline-flex rounded-md border border-border-strong bg-surface p-0.5',
        className
      )}
    >
      {options.map((option) => (
        <label key={option.value} className="relative">
          <input
            type="radio"
            name={groupName}
            value={option.value}
            checked={current === option.value}
            disabled={option.disabled}
            onChange={() => {
              if (value === undefined) setInner(option.value);
              onValueChange?.(option.value);
            }}
            className="peer sr-only"
          />
          <span
            className={cx(
              'flex h-9 cursor-pointer items-center gap-1.5 rounded-[6px] px-3 text-sm font-medium text-fg-secondary',
              'transition-colors duration-fast ease-standard hover:text-fg',
              'peer-checked:bg-surface-inverse peer-checked:text-fg-inverse',
              'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
              'peer-focus-visible:outline-solid peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus'
            )}
          >
            {option.icon}
            {option.label}
          </span>
        </label>
      ))}
    </div>
  );
}

export default SegmentedControl;
