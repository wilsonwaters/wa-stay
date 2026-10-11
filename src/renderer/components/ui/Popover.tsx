import {
  Children,
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { Portal } from './Portal';
import { useOverlay } from './OverlayStack';
import { cx } from './cx';
import { composeHandlers, mergeRefs } from './refs';
import { getTabbables } from './useFocusTrap';
import { usePosition } from './usePosition';
import type { Align, Side } from './position';

export interface PopoverProps {
  /** One button. It gets `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls`. */
  trigger: ReactElement;
  /** Content, or a function given `close` (for Done buttons). */
  children: ReactNode | ((api: { close: () => void }) => ReactNode);
  /** The popover's accessible name. */
  label: string;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: Side;
  align?: Align;
  /** Focused on open. Default: whatever inside took focus, else the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** `md` (default) pads the panel; `none` leaves it to content with its own sections. */
  padding?: 'md' | 'none';
  className?: string;
}

type TriggerProps = {
  ref?: Ref<HTMLElement>;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
};

/**
 * A non-modal `role="dialog"` anchored to its trigger. Focus moves in on open; Escape
 * (only when it is the top overlay) or a click outside closes it and returns focus to the
 * trigger. Tab out of either end also closes it.
 */
export function Popover({
  trigger,
  children,
  label,
  open: controlled,
  defaultOpen = false,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  initialFocusRef,
  padding = 'md',
  className,
}: PopoverProps) {
  const [inner, setInner] = useState(defaultOpen);
  const open = controlled ?? inner;
  const id = useId();
  const triggerRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { style } = usePosition(triggerRef, rootRef, { open, side, align });

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlled === undefined) setInner(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange]
  );

  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, [setOpen]);

  useOverlay({ open, modal: false, elementRef: rootRef, onEscape: close });

  // Move focus in on open, unless something inside has already taken it.
  useEffect(() => {
    const panel = rootRef.current;
    if (!open || !panel) return;
    if (initialFocusRef?.current) initialFocusRef.current.focus();
    else if (!panel.contains(document.activeElement)) (getTabbables(panel)[0] ?? panel).focus();
  }, [open, initialFocusRef]);

  // Outside click closes and gives focus back to the trigger (a focusable target then takes it).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
      // A press on something that cannot take focus moves it to the page itself once the press
      // is handled: give it back to the trigger then.
      const trigger = triggerRef.current;
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || active === document.body) trigger?.focus();
      }, 0);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !rootRef.current) return;
    const tabbables = getTabbables(rootRef.current);
    const first = tabbables[0];
    const last = tabbables[tabbables.length - 1];
    const current = document.activeElement;
    if (
      tabbables.length === 0 ||
      (event.shiftKey && (current === first || current === rootRef.current)) ||
      (!event.shiftKey && current === last)
    ) {
      event.preventDefault();
      close();
    }
  };

  const child = Children.only(trigger) as ReactElement<TriggerProps>;
  const triggerElement = cloneElement(child, {
    // React 19: a ref is a prop like any other.
    ref: mergeRefs(child.props.ref, triggerRef),
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
    onClick: composeHandlers(child.props.onClick, () => (open ? close() : setOpen(true))),
  } as TriggerProps);

  return (
    <>
      {triggerElement}
      {open && (
        <Portal>
          <div
            ref={rootRef}
            id={id}
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            style={style}
            onKeyDown={onPanelKeyDown}
            className={cx(
              'z-overlay max-w-[calc(100vw-1rem)] animate-scale-in rounded-lg border border-border bg-surface text-fg shadow-pop focus:outline-hidden',
              padding === 'md' && 'p-4',
              className
            )}
          >
            {typeof children === 'function' ? children({ close }) : children}
          </div>
        </Portal>
      )}
    </>
  );
}

export default Popover;
