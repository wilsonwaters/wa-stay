import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cx } from './cx';

type ControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean | 'true' | 'false';
};

export interface FieldProps {
  label: ReactNode;
  /** Help shown under the label and read after it. */
  hint?: ReactNode;
  /** Validation message. Marks the control invalid and is read with it. */
  error?: ReactNode;
  /** Sets `aria-required` on the control. Required fields carry no visual marker. */
  required?: boolean;
  /** Adds "(optional)" to the label. Mark the exceptions, not the rule. */
  optional?: boolean;
  /** Id for the control. Defaults to the control's own id, or a generated one. */
  id?: string;
  /** One control: TextField, Textarea, Select or Combobox input. */
  children: ReactElement<ControlProps>;
  className?: string;
}

/**
 * Label, hint and error around one form control, wired for assistive technology: the
 * control gets `id`, `aria-describedby` (hint and error), `aria-invalid` and `aria-required`.
 */
export function Field({
  label,
  hint,
  error,
  required,
  optional,
  id: idProp,
  children,
  className,
}: FieldProps) {
  const generated = useId();
  const id = idProp ?? children.props.id ?? `field${generated}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  const control = cloneElement(children, {
    id,
    'aria-describedby': cx(children.props['aria-describedby'], hintId, errorId) || undefined,
    'aria-invalid': error ? true : children.props['aria-invalid'],
    'aria-required': required ? true : children.props['aria-required'],
  });

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-fg">
        {label}
        {optional && <span className="font-normal text-fg-muted"> (optional)</span>}
      </label>
      {hint && (
        <p id={hintId} className="-mt-1 text-sm text-fg-muted">
          {hint}
        </p>
      )}
      {control}
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-sm font-medium text-danger">
          <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export default Field;
