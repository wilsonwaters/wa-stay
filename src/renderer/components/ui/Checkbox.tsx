import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cx } from './cx';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  /** Extra detail under the label, read as the checkbox's description. */
  description?: ReactNode;
}

/** A native checkbox with a tokenised box and its own label. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, className, id: idProp, ...rest },
  ref
) {
  const generated = useId();
  const id = idProp ?? `checkbox${generated}`;
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className={cx('flex items-start gap-3', className)}>
      <span className="relative mt-0.5 flex h-5 w-5 shrink-0">
        <input
          {...rest}
          ref={ref}
          id={id}
          type="checkbox"
          aria-describedby={cx(rest['aria-describedby'], descriptionId) || undefined}
          className={cx(
            'peer h-5 w-5 cursor-pointer appearance-none rounded-sm border border-border-strong bg-surface',
            'transition-colors duration-fast ease-standard checked:border-brand checked:bg-brand',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        />
        <Check
          size={14}
          strokeWidth={3}
          aria-hidden="true"
          className="pointer-events-none absolute left-[3px] top-[3px] hidden text-fg-inverse peer-checked:block"
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

export default Checkbox;
