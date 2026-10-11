import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { CONTROL_CLASS } from './controlStyles';
import { cx } from './cx';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/** The native `<select>`, styled. Wrap it in `Field` for its label, hint and error. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...rest },
  ref
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cx(CONTROL_CLASS, 'h-10 cursor-pointer appearance-none pl-3 pr-10', className)}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        size={18}
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-secondary"
      />
    </div>
  );
});

export default Select;
