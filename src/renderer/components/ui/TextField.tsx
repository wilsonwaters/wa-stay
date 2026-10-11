import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { CONTROL_CLASS } from './controlStyles';
import { cx } from './cx';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** A decorative icon inside the start of the field, e.g. `<Search />`. */
  leadingIcon?: ReactNode;
}

/** A single-line text input. Wrap it in `Field` for its label, hint and error. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { leadingIcon, className, type = 'text', ...rest },
  ref
) {
  const input = (
    <input
      ref={ref}
      type={type}
      className={cx(CONTROL_CLASS, 'h-10 px-3', leadingIcon ? 'pl-10' : undefined, className)}
      {...rest}
    />
  );
  if (!leadingIcon) return input;
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-fg-muted"
      >
        {leadingIcon}
      </span>
      {input}
    </div>
  );
});

export default TextField;
