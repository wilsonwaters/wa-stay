/**
 * Pure placement maths for floating layers (popovers, menus, listboxes, tooltips).
 * Coordinates are viewport pixels, as from `getBoundingClientRect()`, for `position: fixed`.
 */

export type Side = 'top' | 'bottom';
export type Align = 'start' | 'center' | 'end';

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface PositionInput {
  /** The trigger the layer hangs off. */
  anchor: Rect;
  /** The layer's own size. */
  floating: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Preferred side. The layer flips when it does not fit there and fits better on the other. */
  side?: Side;
  align?: Align;
  /** Gap between anchor and layer. */
  offset?: number;
  /** Minimum gap between layer and viewport edge. */
  padding?: number;
}

export interface Position {
  top: number;
  left: number;
  side: Side;
  /**
   * The height there is room for on `side`, between the anchor (and offset) and the viewport's
   * padding: a scrolling layer kept to it never covers its anchor.
   */
  available: number;
}

/** Places a layer below (or above) its anchor, flipping and clamping it inside the viewport. */
export function computePosition({
  anchor,
  floating,
  viewport,
  side = 'bottom',
  align = 'start',
  offset = 8,
  padding = 8,
}: PositionInput): Position {
  const spaceBelow = viewport.height - (anchor.top + anchor.height) - offset - padding;
  const spaceAbove = anchor.top - offset - padding;

  let placed: Side = side;
  if (side === 'bottom' && floating.height > spaceBelow && spaceAbove > spaceBelow) placed = 'top';
  if (side === 'top' && floating.height > spaceAbove && spaceBelow > spaceAbove) placed = 'bottom';

  const top =
    placed === 'bottom'
      ? anchor.top + anchor.height + offset
      : anchor.top - offset - floating.height;

  const left =
    align === 'start'
      ? anchor.left
      : align === 'end'
        ? anchor.left + anchor.width - floating.width
        : anchor.left + anchor.width / 2 - floating.width / 2;

  return {
    top: clamp(top, padding, viewport.height - padding - floating.height),
    left: clamp(left, padding, viewport.width - padding - floating.width),
    side: placed,
    available: Math.max(0, placed === 'bottom' ? spaceBelow : spaceAbove),
  };
}

/** Keeps `value` within [min, max]; when the layer is bigger than the room, `min` wins. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
