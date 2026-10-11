import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { buttonClassName, type ButtonShape, type ButtonSize, type ButtonVariant } from './Button';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  /** Required. Becomes the accessible name (`aria-label`) and the tooltip text. */
  label: string;
  /** A lucide icon, e.g. `<X />`. It is decorative; the label names the button. */
  icon: ReactNode;
  variant?: ButtonVariant;
  /** 32, 40 or 48 px square. */
  size?: ButtonSize;
  /** `pill` makes it a circle. */
  shape?: ButtonShape;
}

/** A button that shows only an icon. It always has a name, and a tooltip with the same text. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', shape, className, type = 'button', ...rest },
  ref
) {
  return (
    <Tooltip content={label} describe={false}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={buttonClassName({ variant, size, shape, iconOnly: true, className })}
        {...rest}
      >
        {icon}
      </button>
    </Tooltip>
  );
});

export default IconButton;
