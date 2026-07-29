/**
 * Where each track's stave sits on screen, for the topmost visible system.
 *
 * Pure over `LayoutPlan` — no DOM, no store — so the coordinate maths is
 * unit-testable. `ScoreEditorView` is the only thing that holds both the
 * layout plan and the live scroll position, so it is the only thing that can
 * compute this; the track panel consumes it.
 *
 * Results are in **viewport client coordinates**, because the consumer is a
 * sibling column with its own origin and its own top offset (the editor
 * toolbar sits above the staves but not above the track panel). Each side
 * converts against its own bounding box and neither needs to know the other's
 * layout.
 *
 * In page mode a track's stave repeats once per system down the page, so a
 * single vertical list cannot align with all of them — it follows whichever
 * system is currently at the top of the scrollport.
 */
import type { LayoutPlan } from '@sudobility/music_lib';

export type StaveRect = {
  trackId: string;
  /** Client-space top edge of this track's stave. */
  top: number;
  /** Zoom-scaled stave height. */
  height: number;
};

export function staveRectsForViewport(
  plan: LayoutPlan,
  zoom: number,
  scrollTop: number,
  boxTop: number,
): StaveRect[] {
  if (plan.systems.length === 0) return [];

  // The first system whose bottom is still below the viewport top — i.e. the
  // one showing at the top of the scrollport. Scrolled past the end,
  // `findIndex` returns -1 and we fall back to the last system rather than
  // returning nothing, which would blank the panel at the bottom of a long
  // score.
  const scrollLogical = scrollTop / zoom;
  const found = plan.systems.findIndex((system) => system.yBottom >= scrollLogical);
  const system = found === -1 ? plan.systems[plan.systems.length - 1] : plan.systems[found];

  const measureIndex = system.measureIndices[0];
  const rects: StaveRect[] = [];

  for (const trackLayout of plan.trackLayouts) {
    const placement = trackLayout.measures.find((m) => m.measureIndex === measureIndex);
    if (!placement) continue;
    rects.push({
      trackId: trackLayout.track.id,
      top: placement.box.y * zoom - scrollTop + boxTop,
      height: placement.box.height * zoom,
    });
  }

  return rects;
}
