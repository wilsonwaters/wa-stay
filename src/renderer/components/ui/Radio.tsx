import {
  createContext,
  forwardRef,
  useContext,
  useId,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { CircleAlert } from 'lucide-react';
import { cx } from './cx';

interface RadioGroupContextValue {
  name: string;
  value?: string;
  setValue: (value: string) => void;
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null);

export interface RadioGroupProps {
  legend: ReactNode;
  /** Shared by every radio. Generated when omitted. */
  name?: string;
  /** Controlled value. Leave out (and use `register` on each Radio) for uncontrolled forms. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  orientation?: 'vertical' | 'horizontal';
  children: ReactNode;
  className?: string;
}

/** A fieldset of native radios. Arrow keys move between them, as the browser does natively. */
export function RadioGroup({
  legend,
  name,
  value,
  defaultValue,
  onValueChange,
  hint,
  error,
  orientation = 'vertical',
  children,
  className,
}: RadioGroupProps) {
  const generated = useId();
  const groupName = name ?? `radio${generated}`;
  const [inner, setInner] = useState(defaultValue);
  const current = value !== undefined ? value : inner;
  const hintId = hint ? `${groupName}-hint` : undefined;
  const errorId = error ? `${groupName}-error` : undefined;

  const setValue = (next: string) => {
    if (value === undefined) setInner(next);
    onValueChange?.(next);
  };

  return (
    <RadioGroupContext.Provider
      value={{
        name: groupName,
        value: value !== undefined || defaultValue !== undefined ? current : undefined,
        setValue,
      }}
    >
      <fieldset
        aria-describedby={cx(hintId, errorId) || undefined}
        className={cx('flex flex-col gap-2', className)}
      >
        <legend className="mb-1 text-sm font-semibold text-fg">{legend}</legend>
        {hint && (
          <p id={hintId} className="-mt-1 text-sm text-fg-muted">
            {hint}
          </p>
        )}
        <div
          className={cx(
            'flex',
            orientation === 'horizontal' ? 'flex-row flex-wrap gap-6' : 'flex-col gap-3'
          )}
        >
          {children}
        </div>
        {error && (
          <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-danger">
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        )}
      </fieldset>
    </RadioGroupContext.Provider>
  );
}

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value'> {
  value: string;
  label: ReactNode;
  description?: ReactNode;
}

/** One native radio with its label. Use inside `RadioGroup`. */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { value, label, description, className, id: idProp, onChange, ...rest },
  ref
) {
  const group = useContext(RadioGroupContext);
  const generated = useId();
  const id = idProp ?? `radio${generated}`;
  const descriptionId = description ? `${id}-description` : undefined;
  const controlled = group?.value !== undefined ? { checked: group.value === value } : {};

  return (
    <div className={cx('flex items-start gap-3', className)}>
      <span className="relative mt-0.5 flex h-5 w-5 shrink-0">
        <input
          name={group?.name}
          {...rest}
          {...controlled}
          ref={ref}
          id={id}
          type="radio"
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            onChange?.(event);
            if (event.target.checked) group?.setValue(value);
          }}
          aria-describedby={cx(rest['aria-describedby'], descriptionId) || undefined}
          className={cx(
            'peer h-5 w-5 cursor-pointer appearance-none rounded-full border border-border-strong bg-surface',
            'transition-colors duration-fast ease-standard checked:border-brand',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[5px] top-[5px] hidden h-2.5 w-2.5 rounded-full bg-brand peer-checked:block"
        />
      </span>
      <span className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-fg">
          {label}
        </label>
        {description && (
          <span id={descriptionId} className="text-sm text-fg-muted">
            {description}
          </span>
        )}
      </span>
    </div>
  );
});

export default Radio;
