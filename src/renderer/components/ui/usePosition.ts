import { useCallback, useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { computePosition, type Align, type Position, type Side } from './position';

export interface UsePositionOptions {
  open: boolean;
  side?: Side;
  align?: Align;
  offset?: number;
}

/**
 * Positions a fixed layer against its anchor: below by default, flipped above when there is
 * no room, clamped to the viewport. Recomputes on resize, on scroll in any container and when
 * either element changes size. No positioning dependency. `available` is the room on the
 * chosen side (once measured), for a scrolling layer's max height.
 */
export function usePosition(
  anchorRef: RefObject<HTMLElement | null>,
  floatingRef: RefObject<HTMLElement | null>,
  { open, side = 'bottom', align = 'start', offset = 8 }: UsePositionOptions
): { style: CSSProperties; side: Side; available?: number; update: () => void } {
  const [position, setPosition] = useState<Position | null>(null);

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;
    const next = computePosition({
      anchor: anchor.getBoundingClientRect(),
      floating: { width: floating.offsetWidth, height: floating.offsetHeight },
      viewport: {
        width: document.documentElement.clientWidth || window.innerWidth,
        height: window.innerHeight,
      },
      side,
      align,
      offset,
    });
    setPosition((prev) =>
      prev &&
      prev.top === next.top &&
      prev.left === next.left &&
      prev.side === next.side &&
      prev.available === next.available
        ? prev
        : next
    );
  }, [anchorRef, floatingRef, side, align, offset]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      if (anchorRef.current) observer.observe(anchorRef.current);
      if (floatingRef.current) observer.observe(floatingRef.current);
    }
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      observer?.disconnect();
    };
  }, [open, update, anchorRef, floatingRef]);

  // Until measured, the layer is laid out but transparent (still focusable, unlike `hidden`).
  const style: CSSProperties = position
    ? { position: 'fixed', top: position.top, left: position.left }
    : { position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none' };

  return { style, side: position?.side ?? side, available: position?.available, update };
}
