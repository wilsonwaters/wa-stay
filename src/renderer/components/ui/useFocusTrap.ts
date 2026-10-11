import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[tabindex]',
  '[contenteditable="true"]',
].join(',');

/** True when the document has layout (a browser). jsdom has none: nothing there has boxes. */
function hasLayout(doc: Document): boolean {
  return doc.documentElement.getClientRects().length > 0;
}

/**
 * Whether `el` can't take focus because it is not rendered: `hidden`/`inert`, `display: none`
 * on it or an ancestor, `visibility: hidden`, or (with layout) zero-size with no boxes at all.
 */
function isNotRendered(el: HTMLElement, layout: boolean): boolean {
  if (el.closest('[hidden], [inert]')) return true;
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const { visibility } = view.getComputedStyle(el);
  if (visibility === 'hidden' || visibility === 'collapse') return true;
  if (layout) return !el.offsetWidth && !el.offsetHeight && el.getClientRects().length === 0;
  // No layout engine: look for display:none up the tree instead.
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (view.getComputedStyle(node).display === 'none') return true;
  }
  return false;
}

/**
 * The elements Tab visits inside `container`, in DOM order: no negative tabindex, nothing
 * disabled (including controls in a disabled `<fieldset>`), hidden, invisible or inert, and
 * one radio per named group (the checked one, else the first), as the browser does.
 */
export function getTabbables(container: HTMLElement): HTMLElement[] {
  const layout = hasLayout(container.ownerDocument);
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) < 0) return false;
    // `:disabled` also covers controls inside a disabled fieldset (outside its first legend).
    if (el.matches(':disabled')) return false;
    return !isNotRendered(el, layout);
  });
  return candidates.filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) return true;
    const group = candidates.filter(
      (o): o is HTMLInputElement =>
        o instanceof HTMLInputElement && o.type === 'radio' && o.name === el.name
    );
    return el === (group.find((r) => r.checked) ?? group[0]);
  });
}

export interface FocusTrapOptions {
  active: boolean;
  /** Focused on activation. Default: the first tabbable not marked `data-skip-initial-focus`. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Return focus to the element that had it on activation (default true). */
  restoreFocus?: boolean;
}

/** Active traps, innermost last. Only the innermost one handles Tab. */
const activeTraps: object[] = [];

/**
 * Keeps keyboard focus inside `containerRef` while active: focus moves in on activation,
 * Tab and Shift+Tab wrap at the ends, Tab with focus lost to the body comes back in, and
 * focus returns to the opener on deactivation or unmount (when the opener is still in the
 * document). Focus in another layer outside the container (a Popover, a toast) is left alone.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  { active, initialFocusRef, restoreFocus = true }: FocusTrapOptions
): void {
  // Read in render, before any child can move focus (autoFocus runs before our effects).
  const opener = useRef<HTMLElement | null>(null);
  const wasActive = useRef(false);
  if (active && !wasActive.current) {
    opener.current =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  }
  wasActive.current = active;

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    const returnTo = opener.current;

    if (initialFocusRef?.current) {
      initialFocusRef.current.focus();
    } else if (!container.contains(document.activeElement)) {
      const tabbables = getTabbables(container);
      const target =
        tabbables.find((el) => !el.hasAttribute('data-skip-initial-focus')) ??
        tabbables[0] ??
        container;
      target.focus();
    }

    const token = {};
    activeTraps.push(token);

    // On the document, so a Tab pressed after focus fell to the body still reaches the trap.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      if (activeTraps[activeTraps.length - 1] !== token) return;
      const current = document.activeElement;
      const lost = !current || current === document.body || current === document.documentElement;
      if (!lost && !container.contains(current)) return;

      const tabbables = getTabbables(container);
      if (tabbables.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = tabbables[0];
      const last = tabbables[tabbables.length - 1];
      const outside = lost || current === container;
      if (event.shiftKey && (current === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      activeTraps.splice(activeTraps.indexOf(token), 1);
      if (restoreFocus && returnTo && returnTo.isConnected) returnTo.focus();
    };
  }, [active, containerRef, initialFocusRef, restoreFocus]);
}
