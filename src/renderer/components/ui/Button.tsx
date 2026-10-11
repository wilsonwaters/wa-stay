import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ForwardedRef,
  type JSX,
  type ReactNode,
} from 'react';
import { LoaderCircle } from 'lucide-react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'floating' | 'inverse';
/** `danger-solid` is only for the confirm button of a destructive ConfirmDialog. */
type InternalVariant = ButtonVariant | 'danger-solid';
export type ButtonSize = 'sm' | 'md' | 'lg';
/** `rounded`: the default corners. `pill`: fully round ends, for controls that sit in a pill
 * (the search pill's Search button) or float over the map. */
export type ButtonShape = 'rounded' | 'pill';

// Hover styles skip disabled and loading (aria-disabled) buttons.
const VARIANT: Record<InternalVariant, string> = {
  primary:
    'bg-accent text-accent-fg [&:not(:disabled):not([aria-disabled=true])]:hover:bg-accent-hover',
  secondary:
    'border border-fg bg-surface text-fg [&:not(:disabled):not([aria-disabled=true])]:hover:bg-surface-subtle',
  // Ghost inherits its text colour, so it reads correctly on tints (notices, toasts).
  ghost:
    'bg-transparent text-inherit [&:not(:disabled):not([aria-disabled=true])]:hover:bg-surface-inverse/6',
  // The default destructive style: a crimson outline, never confused with the coral primary.
  danger:
    'border border-danger bg-surface text-danger [&:not(:disabled):not([aria-disabled=true])]:hover:bg-danger-subtle',
  // The final confirm of a destructive ConfirmDialog only: a deep crimson (danger-fg) fill, far
  // darker and cooler than the coral primary so the two never read as the same button.
  'danger-solid':
    'bg-danger-fg text-fg-inverse [&:not(:disabled):not([aria-disabled=true])]:hover:bg-danger-fg/90',
  // Floating over a photo or the map: a white surface lifted by the pill shadow, no outline.
  floating:
    'bg-surface text-fg shadow-pill [&:not(:disabled):not([aria-disabled=true])]:hover:bg-surface-subtle',
  // Floating over content in ink, such as the "Show map" / "Show list" switch.
  inverse:
    'bg-surface-inverse text-fg-inverse shadow-pill [&:not(:disabled):not([aria-disabled=true])]:hover:bg-surface-inverse/90',
};

const SHAPE: Record<ButtonShape, string> = {
  rounded: 'rounded-md',
  pill: 'rounded-full',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-sm',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-5 text-base',
};

/** Icon-only buttons are square, with no text padding (it would squeeze the icon). */
const SQUARE: Record<ButtonSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
};

const ICON: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** `pill` for fully round ends. */
  shape?: ButtonShape;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
}

export type ButtonAsButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    as?: 'button';
    /**
     * Shows a spinner, sets `aria-busy` and `aria-disabled`, and ignores activation. The label
     * stays, and the button stays focusable so focus is not lost while the action runs.
     */
    loading?: boolean;
  };

export type ButtonAsLinkProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> & {
    as: 'a';
    href: string;
    loading?: never;
  };

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps;

export function buttonClassName({
  variant = 'primary',
  size = 'md',
  shape = 'rounded',
  fullWidth,
  iconOnly,
  className,
}: {
  variant?: InternalVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  fullWidth?: boolean;
  iconOnly?: boolean;
  className?: string;
}): string {
  return cx(
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-semibold',
    SHAPE[shape],
    'transition-colors duration-fast ease-standard',
    'disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress',
    VARIANT[variant],
    iconOnly ? SQUARE[size] : SIZE[size],
    fullWidth && 'w-full',
    className
  );
}

type InternalProps = Omit<ButtonProps, 'variant'> & { variant?: InternalVariant };

const ButtonImpl = forwardRef<HTMLButtonElement | HTMLAnchorElement, InternalProps>(
  function Button(props, ref) {
    const {
      as,
      variant,
      size = 'md',
      shape,
      leadingIcon,
      trailingIcon,
      fullWidth,
      loading,
      className,
      children,
      ...rest
    } = props;
    const classes = buttonClassName({ variant, size, shape, fullWidth, className });

    if (as === 'a') {
      return (
        <a
          ref={ref as ForwardedRef<HTMLAnchorElement>}
          className={classes}
          {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {leadingIcon}
          {children}
          {trailingIcon}
        </a>
      );
    }

    const {
      disabled,
      type = 'button',
      onClick,
      ...button
    } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
    return (
      <button
        ref={ref as ForwardedRef<HTMLButtonElement>}
        type={type}
        className={classes}
        disabled={disabled}
        {...button}
        // Loading is aria-disabled, not disabled: a disabled button drops focus to the body.
        aria-busy={loading || undefined}
        aria-disabled={loading || button['aria-disabled']}
        onClick={(event) => {
          if (loading) {
            // Also stops a submit button from submitting its form again.
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
      >
        {loading ? (
          <LoaderCircle size={ICON[size]} className="animate-spin" aria-hidden="true" />
        ) : (
          leadingIcon
        )}
        {children}
        {trailingIcon}
      </button>
    );
  }
);

/** Internal: lets ConfirmDialog use the solid danger fill. Not exported from the barrel. */
export const ButtonBase = ButtonImpl as (
  props: InternalProps & { ref?: ForwardedRef<HTMLButtonElement | HTMLAnchorElement> }
) => JSX.Element;

/**
 * The one button. `primary` is the coral call to action (one per view), `secondary` an ink
 * outline, `ghost` for quiet actions and `danger` a crimson outline. `floating` (white) and
 * `inverse` (ink) carry the pill shadow, for controls over a photo or the map. `shape="pill"`
 * rounds the ends. `as="a"` renders a link.
 */
export const Button = ButtonImpl as (
  props: ButtonProps & { ref?: ForwardedRef<HTMLButtonElement | HTMLAnchorElement> }
) => JSX.Element;

export default Button;
