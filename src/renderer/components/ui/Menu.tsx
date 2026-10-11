import {
  Children,
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { Portal } from './Portal';
import { cx } from './cx';
import { composeHandlers, mergeRefs } from './refs';
import { usePosition } from './usePosition';
import type { Align } from './position';

interface MenuContextValue {
  /** Closes the menu, returns focus to the trigger, then runs the item's action. */
  select: (action?: () => void) => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

export interface MenuProps {
  /** One button (Button or IconButton). It gets `aria-haspopup="menu"` and `aria-expanded`. */
  trigger: ReactElement;
  /** MenuItem elements. */
  children: ReactNode;
  /** Name for the menu. Defaults to the trigger's name. */
  label?: string;
  align?: Align;
}

type TriggerProps = {
  ref?: Ref<HTMLElement>;
  id?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
};

const ITEM_SELECTOR = '[role="menuitem"]:not([aria-disabled="true"])';

/**
 * A menu button: the trigger opens a `role="menu"` of `menuitem`s. Arrow keys, Home and End
 * move; Enter or Space activates; Escape and Tab close and refocus the trigger. Choosing an
 * item puts focus back on the trigger first, so a Dialog it opens returns focus there.
 */
export function Menu({ trigger, children, label, align = 'start' }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<'first' | 'last'>('first');
  const menuId = useId();
  const generatedTriggerId = useId();
  const triggerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { style } = usePosition(triggerRef, menuRef, { open, align });

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const openMenu = (focus: 'first' | 'last') => {
    setInitial(focus);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const list = items();
    (initial === 'last' ? list[list.length - 1] : list[0])?.focus();
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  const select = useCallback(
    (action?: () => void) => {
      close(true);
      action?.();
    },
    [close]
  );

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        return move(index + 1);
      case 'ArrowUp':
        return move(index - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(list.length - 1);
      case 'Escape':
        // Consumed here, so a Dialog around the menu stays open.
        event.preventDefault();
        event.stopPropagation();
        return close(true);
      case 'Tab':
        event.preventDefault();
        return close(true);
      case 'Enter':
      case ' ':
        event.preventDefault();
        (document.activeElement as HTMLElement | null)?.click();
        return;
    }
  };

  const child = Children.only(trigger) as ReactElement<TriggerProps>;
  const triggerId = child.props.id ?? generatedTriggerId;
  const triggerElement = cloneElement(child, {
    // React 19: a ref is a prop like any other.
    ref: mergeRefs(child.props.ref, triggerRef),
    id: triggerId,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: composeHandlers(child.props.onClick, () => (open ? close(false) : openMenu('first'))),
    onKeyDown: composeHandlers(child.props.onKeyDown, (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
      }
    }),
  } as TriggerProps);

  return (
    <>
      {triggerElement}
      {open && (
        <Portal>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            aria-labelledby={label ? undefined : triggerId}
            style={style}
            onKeyDown={onMenuKeyDown}
            className="z-overlay min-w-48 max-w-[calc(100vw-1rem)] animate-scale-in rounded-lg border border-border bg-surface p-1 text-fg shadow-pop"
          >
            <MenuContext.Provider value={{ select }}>{children}</MenuContext.Provider>
          </div>
        </Portal>
      )}
    </>
  );
}

export interface MenuItemProps {
  children: ReactNode;
  /** Runs after the menu closes and the trigger has focus again. */
  onSelect?: () => void;
  /** Makes this a link item. */
  href?: string;
  target?: string;
  rel?: string;
  /** A decorative icon before the label. */
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

const ITEM_CLASS =
  'flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium outline-offset-0 hover:bg-surface-subtle focus:bg-surface-subtle aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/** One item in a Menu: a button, or a link when given `href`. */
export function MenuItem({
  children,
  onSelect,
  href,
  target,
  rel,
  icon,
  tone = 'default',
  disabled,
}: MenuItemProps) {
  const menu = useContext(MenuContext);
  const className = cx(ITEM_CLASS, tone === 'danger' ? 'text-danger' : 'text-fg');
  const common = {
    role: 'menuitem',
    tabIndex: -1,
    'aria-disabled': disabled || undefined,
    className,
  } as const;

  if (href) {
    return (
      <a
        {...common}
        href={disabled ? undefined : href}
        target={target}
        rel={rel}
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          menu?.select(onSelect);
        }}
      >
        {icon}
        {children}
      </a>
    );
  }
  return (
    <button
      {...common}
      type="button"
      onClick={() => {
        if (!disabled) menu?.select(onSelect);
      }}
    >
      {icon}
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />;
}

export default Menu;
