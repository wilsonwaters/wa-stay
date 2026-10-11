import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> {
  label: ReactNode;
  description?: ReactNode;
}

/**
 * An on/off setting that applies at once: a native `input type="checkbox" role="switch"`.
 * The thumb's position, not only its colour, shows the state.
 */
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, description, className, id: idProp, ...rest },
  ref
) {
  const generated = useId();
  const id = idProp ?? `switch${generated}`;
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className={cx('flex items-start justify-between gap-4', className)}>
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
      <span className="relative inline-flex h-6 w-11 shrink-0">
        <input
          {...rest}
          ref={ref}
          id={id}
          type="checkbox"
          role="switch"
          aria-describedby={cx(rest['aria-describedby'], descriptionId) || undefined}
          className={cx(
            'peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-full border border-border-strong bg-surface',
            'transition-colors duration-fast ease-standard checked:border-brand checked:bg-brand',
            'disabled:cursor-not-allowed disabled:opacity-50'
          )}
        />
        <span
          aria-hidden="true"
          className={cx(
            'pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-full bg-border-strong',
            'transition-transform duration-fast ease-standard peer-checked:translate-x-5 peer-checked:bg-surface'
          )}
        />
      </span>
    </div>
  );
});

export default Switch;
