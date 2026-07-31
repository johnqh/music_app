/**
 * Where to scroll so the playing measure stays in view.
 *
 * Pure over the `LayoutPlan` — no DOM, no store — so the arithmetic is
 * unit-testable, in the same shape as `autoscroll.ts` and `track-gutter.ts`.
 *
 * The rule that matters here is that following playback must not undo the
 * reader's own vertical scroll. A multi-track score is taller than the viewport,
 * so the reader picks a track to watch; scrolling to the top of each new system
 * threw that away and snapped back to track 1 every time the music wrapped.
 * Both modes therefore preserve vertical position, by different means:
 *
 * - **Page mode** keeps the *offset within the system*. If track 3 sits at the
 *   top of the viewport, it still does after the wrap, because the new system's
 *   top replaces the old one's and the reader's offset into it is carried over.
 * - **Continuous mode** is one very wide system, so following the music is
 *   purely horizontal and vertical scroll is left completely alone.
 */
import { TRACK_INFO_WIDTH } from '@sudobility/music_lib';
import type { LayoutPlan } from '@sudobility/music_lib';

export type PlaybackScrollParams = {
  plan: LayoutPlan;
  layoutMode: 'page' | 'continuous';
  zoom: number;
  /** Index of the measure now playing. */
  measureIndex: number;
  /** The measure's box in logical (unzoomed) content coordinates. */
  measureX: number;
  /** Current vertical scroll position, in on-screen px. */
  scrollTop: number;
  /** Breathing room left before the target, in on-screen px. */
  margin: number;
};

export type PlaybackScrollTarget = { left: number; top: number };

/** The system containing `measureIndex`, or null if it is outside the plan. */
function systemOf(plan: LayoutPlan, measureIndex: number) {
  return plan.systems.find((s) => s.measureIndices.includes(measureIndex)) ?? null;
}

/**
 * The system the reader is currently looking at: the one spanning the top of
 * the viewport, else the last one above it (which is where a scroll position
 * inside an inter-system gap lands), else the first.
 */
function systemAtViewportTop(plan: LayoutPlan, scrollTop: number, zoom: number) {
  const y = scrollTop / zoom;
  let best = plan.systems[0] ?? null;
  for (const system of plan.systems) {
    if (system.yTop <= y) best = system;
    if (system.yTop <= y && y < system.yBottom) return system;
  }
  return best;
}

/**
 * Where to scroll for the measure now playing, or `null` to leave the scroll
 * box alone.
 */
export function playbackScrollTarget({
  plan,
  layoutMode,
  zoom,
  measureIndex,
  measureX,
  scrollTop,
  margin,
}: PlaybackScrollParams): PlaybackScrollTarget | null {
  const target = systemOf(plan, measureIndex);
  if (!target) return null;

  // Horizontal follows the music in both modes. The track-info gutter is
  // pinned to the viewport's left edge and painted over the sheet, so the
  // target has to clear its width as well as the margin — scrolling the
  // playing measure to `margin` parked it, and the caret travelling through
  // it, *behind* the track info for most of every measure.
  //
  // Gutter width scales with zoom: it is cleared in the zoom-scaled space.
  const left = Math.max(0, measureX * zoom - TRACK_INFO_WIDTH * zoom - margin);

  // One long system: there is no "next line" to follow, so any vertical move
  // here would be the caller fighting the reader for the scrollbar.
  if (layoutMode === 'continuous') return { left, top: scrollTop };

  const current = systemAtViewportTop(plan, scrollTop, zoom);
  // Same system: the music has not wrapped, so nothing vertical needs to move.
  if (!current || current === target) return { left, top: scrollTop };

  // Carry the reader's offset into the system across to the new one. Clamped at
  // zero only; the scroll box clamps the far end itself.
  const offsetIntoSystem = scrollTop - current.yTop * zoom;
  return { left, top: Math.max(0, target.yTop * zoom + offsetIntoSystem) };
}
