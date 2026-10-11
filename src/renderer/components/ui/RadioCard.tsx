import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { CircleCheck } from 'lucide-react';
import { cx } from './cx';

interface RadioCardGroupContextValue {
  name: string;
  value?: string;
  select: (value: string) => void;
}

const RadioCardGroupContext = createContext<RadioCardGroupContextValue | null>(null);

export interface RadioCardGroupProps {
  /** Visible label for the group, e.g. "Provider". */
  label: ReactNode;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  /** Extra help, read as the group's description. */
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A `radiogroup` of card-style native radios (the provider step in create flows).
 * Arrow keys move the selection.
 */
export function RadioCardGroup({
  label,
  value,
  defaultValue,
  onValueChange,
  name,
  hint,
  children,
  className,
}: RadioCardGroupProps) {
  const generated = useId();
  const groupName = name ?? `radiocard${generated}`;
  const labelId = `${groupName}-label`;
  const hintId = hint ? `${groupName}-hint` : undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const select = (next: string) => {
    if (value === undefined) setInner(next);
    onValueChange?.(next);
  };
  return (
    <RadioCardGroupContext.Provider value={{ name: groupName, value: current, select }}>
      <div className={cx('flex flex-col gap-3', className)}>
        <div>
          <div id={labelId} className="text-sm font-semibold text-fg">
            {label}
          </div>
          {hint && (
            <p id={hintId} className="text-sm text-fg-muted">
              {hint}
            </p>
          )}
        </div>
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          aria-describedby={hintId}
          className="grid gap-3"
        >
          {children}
        </div>
      </div>
    </RadioCardGroupContext.Provider>
  );
}

export interface RadioCardProps {
  value: string;
  title: ReactNode;
  description?: ReactNode;
  /** A decorative icon at the start. */
  icon?: ReactNode;
  /** Right-hand slot: a ProviderBadge, a "Soon" badge. Not part of the name. */
  trailing?: ReactNode;
  disabled?: boolean;
}

export function RadioCard({ value, title, description, icon, trailing, disabled }: RadioCardProps) {
  const group = useContext(RadioCardGroupContext);
  const id = useId();
  if (!group) throw new Error('RadioCard must be used inside <RadioCardGroup>');
  const titleId = `${id}-title`;
  const descriptionId = description ? `${id}-description` : undefined;
  const checked = group.value === value;

  return (
    <label className={cx('relative block', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
      <input
        type="radio"
        name={group.name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => group.select(value)}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="peer sr-only"
      />
      <span
        className={cx(
          'flex items-start gap-3 rounded-lg border bg-surface p-4 transition-colors duration-fast ease-standard',
          'peer-focus-visible:outline-solid peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus',
          checked
            ? 'border-brand ring-1 ring-brand'
            : 'border-border-strong hover:border-fg-secondary',
          disabled && 'opacity-60'
        )}
      >
        {icon && (
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-fg-secondary">
            {icon}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={titleId} className="text-base font-semibold text-fg">
            {title}
          </span>
          {description && (
            <span id={descriptionId} className="text-sm text-fg-secondary">
              {description}
            </span>
          )}
        </span>
        {trailing && <span className="shrink-0">{trailing}</span>}
        <CircleCheck
          size={20}
          aria-hidden="true"
          className={cx('shrink-0 text-brand', checked ? 'visible' : 'invisible')}
        />
      </span>
    </label>
  );
}

export default RadioCard;
