import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { CONTROL_CLASS } from './controlStyles';
import { cx } from './cx';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Multi-line text. Wrap it in `Field` for its label, hint and error. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 4, ...rest },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cx(CONTROL_CLASS, 'min-h-20 px-3 py-2', className)}
      {...rest}
    />
  );
});

export default Textarea;
