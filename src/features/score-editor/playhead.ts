/**
 * Playhead caret geometry: maps a playback tick to a vertical-line position
 * on the notation canvas, and a canvas point back to a tick (click-to-seek).
 * Pure functions over music_lib's `LayoutPlan` (logical/unscaled units —
 * callers multiply by zoom), same convention as `hit-test.ts`.
 *
 * The tick <-> x mapping interpolates linearly across each measure's stave
 * box. VexFlow doesn't space notes perfectly linearly (and first-in-system
 * measures spend their left edge on clef/key/time), so the caret is a close
 * approximation rather than glyph-exact — the same trade every DAW-style
 * ruler makes.
 */
import type { Score } from '@sudobility/music_types';
import type { LayoutPlan, MeasureLayout, SystemLayout } from '@sudobility/music_lib';

export type CaretPosition = {
  /** Logical x of the caret line. */
  x: number;
  /** Logical top/bottom of the system the tick falls in (the caret spans the whole system, all tracks). */
  yTop: number;
  yBottom: number;
};

type MeasureTiming = { startTick: number; durationTicks: number };

/** The score's shared measure grid (first track — every track shares it once `rebuildMeasureTicks` has run; same convention as `store/selectors.ts`). */
function measureTimings(score: Score): MeasureTiming[] {
  return score.tracks[0]?.measures ?? [];
}

function systemForMeasureIndex(plan: LayoutPlan, measureIndex: number): SystemLayout | null {
  return plan.systems.find((s) => s.measureIndices.includes(measureIndex)) ?? null;
}

function measureLayoutForIndex(plan: LayoutPlan, measureIndex: number): MeasureLayout | null {
  return plan.trackLayouts[0]?.measures.find((m) => m.measureIndex === measureIndex) ?? null;
}

/**
 * Where the caret for `tick` sits on the canvas, or `null` when there is
 * nothing to draw against (empty score / no layout). Ticks past the end of
 * the score clamp to the final measure's right edge.
 */
export function caretPositionForTick(
  plan: LayoutPlan,
  score: Score,
  tick: number,
): CaretPosition | null {
  const timings = measureTimings(score);
  if (timings.length === 0) return null;

  let measureIndex = timings.findIndex(
    (m) => tick >= m.startTick && tick < m.startTick + m.durationTicks,
  );
  if (measureIndex === -1) measureIndex = tick < timings[0].startTick ? 0 : timings.length - 1;

  const timing = timings[measureIndex];
  const layout = measureLayoutForIndex(plan, measureIndex);
  const system = systemForMeasureIndex(plan, measureIndex);
  if (!layout || !system) return null;

  const fraction =
    timing.durationTicks > 0
      ? Math.min(1, Math.max(0, (tick - timing.startTick) / timing.durationTicks))
      : 0;
  return {
    x: layout.box.x + fraction * layout.box.width,
    yTop: system.yTop,
    yBottom: system.yBottom,
  };
}

/**
 * The tick a canvas click at logical `(x, y)` should seek to, or `null`
 * when the point is in dead space between/outside systems. Horizontal
 * positions left/right of a system's measures clamp to that system's
 * first/last measure, so clicking the clef area seeks to the system start.
 */
export function tickForPoint(plan: LayoutPlan, score: Score, x: number, y: number): number | null {
  const timings = measureTimings(score);
  if (timings.length === 0) return null;

  const system = plan.systems.find((s) => y >= s.yTop && y <= s.yBottom);
  if (!system) return null;

  const layouts = system.measureIndices
    .map((i) => measureLayoutForIndex(plan, i))
    .filter((m): m is MeasureLayout => m !== null)
    .sort((a, b) => a.box.x - b.box.x);
  if (layouts.length === 0) return null;

  const first = layouts[0];
  const last = layouts[layouts.length - 1];
  const clampedX = Math.min(Math.max(x, first.box.x), last.box.x + last.box.width);

  const hit = layouts.find((m) => clampedX >= m.box.x && clampedX < m.box.x + m.box.width) ?? last;
  const timing = timings[hit.measureIndex];
  if (!timing) return null;

  const fraction = hit.box.width > 0 ? (clampedX - hit.box.x) / hit.box.width : 0;
  return Math.round(timing.startTick + Math.min(1, Math.max(0, fraction)) * timing.durationTicks);
}
