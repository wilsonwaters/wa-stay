import {
  Children,
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type Ref,
} from 'react';
import { Portal } from './Portal';
import { cx } from './cx';
import { composeHandlers, mergeRefs } from './refs';
import { usePosition } from './usePosition';
import type { Side } from './position';

/** Hover delay before a tooltip opens. Focus opens it at once. */
export const TOOLTIP_DELAY_MS = 400;
/** Grace period after the pointer leaves, so it can cross the gap onto the tooltip. */
export const TOOLTIP_CLOSE_DELAY_MS = 100;

export interface TooltipProps {
  /** Short plain text. Tooltips never hold interactive content. */
  content: string;
  /** One focusable element: the trigger. */
  children: ReactElement;
  side?: Side;
  /**
   * When true (the default) the trigger gets `aria-describedby` pointing at the tooltip.
   * IconButton passes false: its tooltip repeats the accessible name, so it describes nothing
   * and is hidden from assistive technology.
   */
  describe?: boolean;
}

type TriggerProps = {
  ref?: Ref<HTMLElement>;
  'aria-describedby'?: string;
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
};

/**
 * A short label for a control: `role="tooltip"`, opened by hover (after 400 ms) or focus
 * (at once), closed by Escape, blur or pointer leave. It is hoverable (WCAG 1.4.13): the
 * pointer can move from the trigger onto the tooltip and it stays open.
 */
export function Tooltip({ content, children, side = 'top', describe = true }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { style } = usePosition(triggerRef, tipRef, { open, side, align: 'center', offset: 6 });

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  // Pointer leaving the trigger or the tooltip: close unless it arrives on the other one.
  const hideSoon = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return hide();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), TOOLTIP_CLOSE_DELAY_MS);
  };
  const keepOpen = () => clearTimeout(timer.current);

  const child = Children.only(children) as ReactElement<TriggerProps>;
  const own = child.props;

  const trigger = cloneElement(child, {
    // React 19: a ref is a prop like any other.
    ref: mergeRefs(child.props.ref, triggerRef),
    'aria-describedby': describe ? cx(own['aria-describedby'], id) : own['aria-describedby'],
    onPointerEnter: composeHandlers(own.onPointerEnter, (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') return;
      clearTimeout(timer.current);
      if (open) return;
      timer.current = setTimeout(() => setOpen(true), TOOLTIP_DELAY_MS);
    }),
    onPointerLeave: composeHandlers(own.onPointerLeave, hideSoon),
    onFocus: composeHandlers(own.onFocus, show),
    onBlur: composeHandlers(own.onBlur, hide),
    onKeyDown: composeHandlers(own.onKeyDown, (event: KeyboardEvent<HTMLElement>) => {
      // Escape dismisses the tooltip and still reaches the dialog or popover around it, so a
      // focused Close button closes its dialog on the first press.
      if (event.key === 'Escape') hide();
    }),
  });

  // A describing tooltip stays in the DOM (hidden) so `aria-describedby` always resolves.
  const render = open || describe;

  return (
    <>
      {trigger}
      {render && (
        <Portal>
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            hidden={!open}
            aria-hidden={describe ? undefined : true}
            style={style}
            onPointerEnter={keepOpen}
            onPointerLeave={hideSoon}
            className="z-tooltip max-w-xs rounded-md bg-surface-inverse px-2 py-1 text-xs font-medium text-fg-inverse shadow-pop"
          >
            {content}
          </div>
        </Portal>
      )}
    </>
  );
}

export default Tooltip;
