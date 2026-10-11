import { createContext, useContext, useLayoutEffect, useRef, type RefObject } from 'react';

interface OverlayEntry {
  modal: boolean;
  /** The overlay's portal root, so overlays below a modal can be made inert too. */
  element: () => HTMLElement | null;
  /** Whether Escape currently closes this overlay. */
  handlesEscape: () => boolean;
  onEscape: () => void;
}

/**
 * The one stack of open overlays (Dialog, Sheet, Popover). It decides, in one place:
 * - Escape closes only the top overlay (a Popover inside a Dialog closes first);
 * - while any modal is open, `#root` and every overlay below the top modal are `inert`, and
 *   page scroll is locked;
 * - all of that is undone when the last modal unmounts, even if it never "closed".
 */
export class OverlayStack {
  private entries: OverlayEntry[] = [];
  private inert = new Set<HTMLElement>();
  private savedOverflow: string | null = null;

  constructor(private readonly doc: Document) {}

  push(entry: OverlayEntry): () => void {
    this.entries.push(entry);
    if (this.entries.length === 1) this.doc.addEventListener('keydown', this.onKeyDown);
    this.apply();
    return () => {
      this.entries = this.entries.filter((e) => e !== entry);
      if (this.entries.length === 0) this.doc.removeEventListener('keydown', this.onKeyDown);
      this.apply();
    };
  }

  /** Escape reaches here only if nothing inside (a Menu, Combobox or Tooltip) consumed it. */
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const top = this.entries[this.entries.length - 1];
    if (!top || !top.handlesEscape()) return;
    event.preventDefault();
    top.onEscape();
  };

  private apply() {
    let topModal = -1;
    this.entries.forEach((e, i) => {
      if (e.modal) topModal = i;
    });

    const next = new Set<HTMLElement>();
    if (topModal >= 0) {
      const root = this.doc.getElementById('root');
      if (root) next.add(root);
      for (const e of this.entries.slice(0, topModal)) {
        const el = e.element();
        if (el) next.add(el);
      }
    }
    for (const el of this.inert) if (!next.has(el)) el.removeAttribute('inert');
    for (const el of next) el.setAttribute('inert', '');
    this.inert = next;

    const body = this.doc.body;
    if (topModal >= 0 && this.savedOverflow === null) {
      this.savedOverflow = body.style.overflow;
      body.style.overflow = 'hidden';
    } else if (topModal < 0 && this.savedOverflow !== null) {
      body.style.overflow = this.savedOverflow;
      this.savedOverflow = null;
    }
  }
}

let defaultStack: OverlayStack | undefined;
function getDefaultStack(): OverlayStack {
  if (!defaultStack) defaultStack = new OverlayStack(document);
  return defaultStack;
}

/** Overlays share one stack. Tests or nested apps may provide their own. */
export const OverlayStackContext = createContext<OverlayStack | null>(null);

export interface UseOverlayOptions {
  open: boolean;
  modal: boolean;
  elementRef: RefObject<HTMLElement | null>;
  /** Called on Escape when this overlay is on top. Leave undefined to ignore Escape. */
  onEscape?: () => void;
}

/** Registers an open overlay with the shared stack for as long as it is open and mounted. */
export function useOverlay({ open, modal, elementRef, onEscape }: UseOverlayOptions): void {
  const context = useContext(OverlayStackContext);
  const escape = useRef(onEscape);
  escape.current = onEscape;

  useLayoutEffect(() => {
    if (!open) return;
    const stack = context ?? getDefaultStack();
    return stack.push({
      modal,
      element: () => elementRef.current,
      handlesEscape: () => Boolean(escape.current),
      onEscape: () => escape.current?.(),
    });
  }, [open, modal, context, elementRef]);
}
