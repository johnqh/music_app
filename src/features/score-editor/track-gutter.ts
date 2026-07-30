/**
 * Hit-testing the canvas track-info gutter. Pure over `LayoutPlan` — no DOM, no
 * store — so the coordinate maths is unit-testable.
 *
 * **Viewport coordinates, not content coordinates.** The renderer pins the
 * gutter to the viewport's left edge (see `drawTrackInfoGutter`), because in
 * continuous mode a gutter in content space would scroll out of view. Every
 * other hit test in the editor works in content coordinates; this one is the
 * exception, and passing it content coordinates would put the hit region in the
 * right place only at scroll position zero.
 */
import { TRACK_INFO_WIDTH } from '@sudobility/music_lib';
import type { LayoutPlan } from '@sudobility/music_lib';

export type GutterPoint = { x: number; y: number };

/**
 * The track whose gutter cell contains `point`, or `null` — outside the
 * gutter's width, or in the gap between two staves.
 *
 * Walks every system, not just the topmost: the gutter repeats down the page,
 * so a click can land on any of them.
 */
export function trackIdAtGutterPoint(
  plan: LayoutPlan,
  zoom: number,
  scrollTop: number,
  point: GutterPoint,
): string | null {
  if (point.x < 0 || point.x > TRACK_INFO_WIDTH * zoom) return null;

  // Back into the plan's logical, unscrolled space.
  const logicalY = (point.y + scrollTop) / zoom;

  for (const system of plan.systems) {
    const measureIndex = system.measureIndices[0];
    for (const trackLayout of plan.trackLayouts) {
      const box = trackLayout.measures.find((m) => m.measureIndex === measureIndex)?.box;
      if (!box) continue;
      if (logicalY >= box.y && logicalY < box.y + box.height) return trackLayout.track.id;
    }
  }

  return null;
}
