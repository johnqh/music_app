/**
 * Edge autoscroll for drag-box selection. Pure: takes a pointer position
 * relative to the scroll box and returns a per-frame scroll delta, so the
 * rate curve is unit-testable without a real scroll container.
 *
 * The axis follows the layout mode because that is the axis with anywhere to
 * go: continuous mode lays every measure in one very wide system, page mode
 * wraps into a tall column.
 */
export type AutoscrollParams = {
  /** Pointer x relative to the scroll box's left edge. */
  x: number;
  /** Pointer y relative to the scroll box's top edge. */
  y: number;
  box: { width: number; height: number };
  layoutMode: 'page' | 'continuous';
};

/** How close to an edge (px) the pointer must come before autoscroll engages. */
export const AUTOSCROLL_EDGE_PX = 48;
/** Maximum scroll per animation frame (px), reached at or past the edge itself. */
export const AUTOSCROLL_MAX_PX_PER_FRAME = 18;

/** 0 outside the band, ramping linearly to 1 at (or past) the edge. */
function rate(distanceFromEdge: number): number {
  if (distanceFromEdge >= AUTOSCROLL_EDGE_PX) return 0;
  const clamped = Math.max(0, distanceFromEdge);
  return (AUTOSCROLL_EDGE_PX - clamped) / AUTOSCROLL_EDGE_PX;
}

export function autoscrollDelta({ x, y, box, layoutMode }: AutoscrollParams): {
  dx: number;
  dy: number;
} {
  if (layoutMode === 'continuous') {
    const left = rate(x);
    const right = rate(box.width - x);
    return { dx: Math.round((right - left) * AUTOSCROLL_MAX_PX_PER_FRAME), dy: 0 };
  }
  const top = rate(y);
  const bottom = rate(box.height - y);
  return { dx: 0, dy: Math.round((bottom - top) * AUTOSCROLL_MAX_PX_PER_FRAME) };
}
