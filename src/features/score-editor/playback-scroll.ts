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
 * - **Page mode** scrolls only when the system being played is not already on
 *   screen, and then keeps the *offset within the system*: if track 3 sits at
 *   the top of the viewport, it still does after the wrap, because the new
 *   system's top replaces the old one's and the reader's offset into it is
 *   carried over.
 * - **Continuous mode** is one very wide system, so following the music is
 *   purely horizontal and vertical scroll is left completely alone. It too
 *   moves only when the playing measure is reaching the edge of the viewport.
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
  /** The measure's width in logical (unzoomed) content coordinates. */
  measureWidth: number;
  /** Current horizontal scroll position, in on-screen px. */
  scrollLeft: number;
  /** Visible width of the scroll box, in on-screen px. */
  viewportWidth: number;
  /** Current vertical scroll position, in on-screen px. */
  scrollTop: number;
  /** Visible height of the scroll box, in on-screen px. */
  viewportHeight: number;
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
 *
 * Every "no move needed" path returns `null` rather than the current scroll
 * position, and that distinction is load-bearing: the caller scrolls with
 * `behavior: 'smooth'`, and issuing *any* `scrollTo` — even one naming the
 * position the box is already heading to — cancels the animation in flight and
 * strands it wherever it had reached. Returning the current position once per
 * measure therefore killed each scroll a moment after it started, and the sheet
 * appeared not to follow the music at all.
 */
export function playbackScrollTarget({
  plan,
  layoutMode,
  zoom,
  measureIndex,
  measureX,
  measureWidth,
  scrollLeft,
  viewportWidth,
  scrollTop,
  viewportHeight,
  margin,
}: PlaybackScrollParams): PlaybackScrollTarget | null {
  const target = systemOf(plan, measureIndex);
  if (!target) return null;

  if (layoutMode === 'continuous') {
    // The track-info gutter is pinned to the viewport's left edge and painted
    // over the sheet, so the target has to clear its width as well as the
    // margin — scrolling the playing measure to `margin` parked it, and the
    // caret travelling through it, *behind* the track info for most of every
    // measure. Gutter width scales with zoom: it is cleared in the zoom-scaled
    // space.
    //
    // Vertical is left completely alone: one long system means there is no
    // "next line" to follow, so any vertical move would be the caller fighting
    // the reader for the scrollbar.
    const gutter = TRACK_INFO_WIDTH * zoom;
    const measureLeft = measureX * zoom;
    const measureRight = (measureX + measureWidth) * zoom;

    // Only move once the music is actually reaching the edge of what the reader
    // can see. This used to re-target every measure, which both fought the
    // reader for the scrollbar and meant a fresh smooth-scroll animation was
    // started before the previous one had travelled anywhere.
    const firstVisible = scrollLeft + gutter + margin;
    const lastVisible = scrollLeft + viewportWidth - margin;
    if (measureLeft >= firstVisible && measureRight <= lastVisible) return null;

    return { left: Math.max(0, measureLeft - gutter - margin), top: scrollTop };
  }

  // Page mode wraps every system to the viewport and does not scroll
  // horizontally at all, so there is no horizontal following to do — and
  // asking for one would scroll the sheet under the gutter with no way for the
  // reader to bring it back.
  const left = 0;

  // Already on screen in full: leave it alone. Wrapping to a new system is not
  // by itself a reason to scroll — a viewport tall enough to show several
  // systems was being yanked up a line every time the music crossed into the
  // next one, long before the caret was anywhere near the bottom of what the
  // reader could see. Only a target the reader cannot actually see justifies
  // moving the page under them.
  //
  // A system taller than the viewport can never satisfy this (a multi-track
  // score is the normal case), so that falls through to the offset-carrying
  // path below, which is what it is there for.
  const targetTop = target.yTop * zoom;
  const targetBottom = target.yBottom * zoom;
  if (targetTop >= scrollTop && targetBottom <= scrollTop + viewportHeight) return null;

  const current = systemAtViewportTop(plan, scrollTop, zoom);
  // Same system: the music has not wrapped, so nothing vertical needs to move.
  if (!current || current === target) return null;

  // Carry the reader's offset into the system across to the new one, but never
  // so far that the music leaves the screen.
  //
  // The clamp is what makes this safe. `systemAtViewportTop` answers with the
  // system *above* when the scroll position has landed in the gap between two
  // systems — which is exactly where the previous wrap tends to leave it — so
  // the raw offset came out close to a whole system tall. The next wrap then
  // overshot by that much and the line being played ended up above the top of
  // the viewport, with the music audible but nowhere on screen. Worse, each
  // overshoot parked the reader in another gap, so the error repeated on every
  // wrap and the page raced a line ahead of the music.
  //
  // Bounding the offset to what the target system can actually give up keeps
  // the intent — a reader watching track 3 goes on watching track 3 — while
  // guaranteeing the system stays in view. A system shorter than the viewport
  // has nothing to give up, so it simply aligns to the top.
  const targetHeight = (target.yBottom - target.yTop) * zoom;
  const maxOffset = Math.max(0, targetHeight - viewportHeight);
  const rawOffset = scrollTop - current.yTop * zoom;
  const offsetIntoSystem = Math.min(Math.max(rawOffset, 0), maxOffset);
  return { left, top: Math.max(0, target.yTop * zoom + offsetIntoSystem) };
}
