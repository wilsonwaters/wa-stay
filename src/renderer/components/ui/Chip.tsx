import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cx } from './cx';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /**
   * A choice is made: the chip takes the brand tint. Use it for a chip that opens choices
   * (a Popover trigger), whose name should then say what is chosen ("Region, 1 selected").
   */
  selected?: boolean;
  /**
   * Makes it an on/off toggle: sets `aria-pressed`, takes the brand tint and shows a tick while
   * on. Leave it undefined for a chip that opens choices.
   */
  pressed?: boolean;
  leadingIcon?: ReactNode;
  /** E.g. a chevron on a chip that opens a Popover. */
  trailingIcon?: ReactNode;
  children: ReactNode;
}

const BASE =
  'inline-flex h-9 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors duration-fast ease-standard disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';
const OFF =
  'border-border-strong bg-surface text-fg [&:not(:disabled):not([aria-disabled=true])]:hover:border-fg';
const ON = 'border-brand bg-brand-subtle text-brand-strong';

/**
 * A filter chip: a pill-shaped button in a row of filters. Either it opens choices (put it in a
 * Popover's `trigger`, with `selected` while any is chosen), or it is an on/off toggle
 * (`pressed`). Ink on white while off; the brand tint while on.
 *
 * `aria-disabled` (rather than `disabled`) keeps it focusable, so a Tooltip around it can say
 * why it is unavailable; it then looks disabled and ignores presses.
 */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  {
    selected = false,
    pressed,
    leadingIcon,
    trailingIcon,
    className,
    children,
    type = 'button',
    onClick,
    ...rest
  },
  ref
) {
  const on = pressed ?? selected;
  const unavailable = rest['aria-disabled'] === true || rest['aria-disabled'] === 'true';
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      className={cx(BASE, on ? ON : OFF, className)}
      onClick={unavailable ? undefined : onClick}
      {...rest}
    >
      {pressed ? <Check size={16} aria-hidden="true" className="-ml-1" /> : leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
});

export default Chip;
