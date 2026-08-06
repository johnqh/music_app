/**
 * What an Option+drag resolves to: which track, and how far in time.
 *
 * Pure over a layout plan and a point — no store, no React — in the same shape
 * as `pitch-drag.ts` and `playback-scroll.ts`, so the rules are testable
 * without rendering anything.
 */
import { tickForPoint } from '@sudobility/music_lib';
import type { EditMode, LayoutPlan } from '@sudobility/music_lib';
import type { Score } from '@sudobility/music_types';
import type { CollisionMode } from '@sudobility/music_lib';
import { trackIdAtContentPoint } from '@/features/score-editor/hit-test';
import type { Point } from '@/features/score-editor/hit-test';

/** The note the gesture is anchored to: the one under the pointer at press. */
export type NoteDrag = { anchorId: string; anchorTick: number };

/** Where a drop would put the selection. */
export type DropTarget = { trackId: string; deltaTicks: number };

/**
 * The collision rule a drop uses, from the toolbar's edit mode.
 *
 * A drop is a write, so it obeys the mode already set rather than inventing a
 * rule or asking. `insert` ripples, which is what `insert` means everywhere
 * else in the editor.
 */
export function collisionForEditMode(mode: EditMode): CollisionMode {
  if (mode === 'insert') return 'ripple';
  return mode;
}

/** Rounds `tick` to the nearest multiple of `snapTicks`. */
function snap(tick: number, snapTicks: number): number {
  if (snapTicks <= 0) return tick;
  return Math.round(tick / snapTicks) * snapTicks;
}

/**
 * The track and tick delta a drop at `point` would produce, or null when the
 * pointer is not over a stave.
 *
 * The delta is relative to the **anchor**, so every other note in the
 * selection keeps its offset and a phrase keeps its shape.
 */
export function resolveDrop(
  plan: LayoutPlan,
  score: Score,
  drag: NoteDrag,
  point: Point,
  snapTicks: number,
): DropTarget | null {
  const trackId = trackIdAtContentPoint(plan, point);
  if (!trackId) return null;

  // `tickForPoint` needs the score as well as the plan: it reads measure
  // timings, not just geometry. Same call the caret already makes.
  const tick = tickForPoint(plan, score, point.x, point.y);
  if (tick === null) return null;

  return { trackId, deltaTicks: snap(tick, snapTicks) - drag.anchorTick };
}
