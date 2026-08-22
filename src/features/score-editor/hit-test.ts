/**
 * Pure bounding-box geometry for score-editor hit-testing (spec §7 items
 * 7-10: note selection, shift-click multi-selection, drag-box selection).
 * Deliberately free of React/DOM/store imports so it can be unit-tested
 * with plain constructed `BBox` values.
 *
 * Real coordinates come from `CanvasRenderResult.idToBBox`/
 * `measureIdToBBox` (music_lib's canvas renderer) — computed from
 * VexFlow's own layout math, not the DOM, so they are real values in
 * jsdom too and every interaction path is exercised geometrically in
 * component tests.
 */
import {
  STAVE_POSITION_HEIGHT,
  STAVE_TOP_LINE_OFFSET,
  pitchAtStavePosition,
  effectiveClef,
} from '@sudobility/music_lib';
import type { BBox, LayoutPlan } from '@sudobility/music_lib';
import type { Pitch, Score } from '@sudobility/music_types';

export type Point = { x: number; y: number };

/** Whether `point` falls within `box`, inclusive of edges. */
export function pointInBBox(box: BBox, point: Point): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

/** Whether two boxes overlap by a nonzero area (merely touching edges doesn't count). */
export function bboxesIntersect(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Builds a normalized (non-negative width/height) box spanning two drag corners, in either order. */
export function boxFromPoints(a: Point, b: Point): BBox {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/**
 * The topmost id whose bbox contains `point`, or `null` if none match.
 * Later map insertions win on overlap — the canvas renderer inserts in
 * draw order, so "later" is "drawn on top" (for the piano roll's
 * non-overlapping note rects, first vs. last is indistinguishable).
 * Linear over the map: the canvas maps only ever hold the drawn window,
 * so this is O(visible), within the no-O(score) interaction rule.
 */
export function eventIdAtPoint(idToBBox: ReadonlyMap<string, BBox>, point: Point): string | null {
  let hit: string | null = null;
  for (const [id, box] of idToBBox) {
    if (pointInBBox(box, point)) hit = id; // keep scanning: last inserted wins
  }
  return hit;
}

/**
 * Every event id whose bbox contains `point`.
 *
 * A chord's notes are drawn as one VexFlow `StaveNote`, so the renderer maps
 * all of their ids to the same box — `eventIdAtPoint` therefore returns an
 * arbitrary member of a chord, and no click can reach the others. Selecting
 * the whole chord is the honest answer to a click on overlapping noteheads;
 * picking individual notes out of it is the piano keyboard's job.
 */
export function eventIdsAtPoint(idToBBox: ReadonlyMap<string, BBox>, point: Point): string[] {
  const ids: string[] = [];
  for (const [id, box] of idToBBox) {
    if (pointInBBox(box, point)) ids.push(id);
  }
  return ids;
}

/** Every id whose bbox intersects `box` (drag-box/rubber-band selection), in map iteration order. */
export function eventIdsInBox(idToBBox: ReadonlyMap<string, BBox>, box: BBox): string[] {
  const ids: string[] = [];
  for (const [id, candidate] of idToBBox) {
    if (bboxesIntersect(candidate, box)) ids.push(id);
  }
  return ids;
}

/** The measure id whose stave box contains `point`, or `null`. Same window-scoped linear scan as `eventIdAtPoint`. */
export function measureIdAtPoint(
  measureIdToBBox: ReadonlyMap<string, BBox>,
  point: Point,
): string | null {
  let hit: string | null = null;
  for (const [id, box] of measureIdToBBox) {
    if (pointInBBox(box, point)) hit = id;
  }
  return hit;
}

/**
 * The measure index under `point` when it falls in a system's
 * measure-number gutter band, or `null` anywhere else. Logical (unzoomed)
 * content coordinates — the caller divides by zoom, same as `tickForPoint`.
 *
 * Measure geometry is read off track 0: every track shares one measure grid
 * (see `rebuildMeasureTicks`), which is exactly why one gutter can serve the
 * whole system rather than needing one band per stave.
 *
 * The band is half-open at the bottom (`y < system.yTop`) so a click landing
 * exactly on the stave's top line belongs to the stave, not the gutter —
 * otherwise the two hit zones would both claim that row of pixels.
 */
export function measureIndexAtGutterPoint(plan: LayoutPlan, point: Point): number | null {
  const measures = plan.trackLayouts[0]?.measures;
  if (!measures) return null;

  for (const system of plan.systems) {
    if (point.y < system.gutterTop || point.y >= system.yTop) continue;
    for (const measureIndex of system.measureIndices) {
      const box = measures.find((m) => m.measureIndex === measureIndex)?.box;
      if (!box) continue;
      if (point.x >= box.x && point.x < box.x + box.width) return measureIndex;
    }
    return null; // inside this system's band, but past its measures
  }
  return null;
}

/**
 * The track whose stave band contains `point`, in **content** coordinates.
 *
 * The sibling of `trackIdAtGutterPoint`, which does the same y-band search but
 * is x-constrained to the gutter and reads *viewport* coordinates — the one
 * place in the editor where the two spaces differ, because the gutter is
 * painted pinned to the viewport's left edge. A drop can land anywhere on the
 * staff, so it needs the ordinary content-space search.
 */
export function trackIdAtContentPoint(plan: LayoutPlan, point: Point): string | null {
  for (const system of plan.systems) {
    const measureIndex = system.measureIndices[0];
    if (measureIndex === undefined) continue;
    for (const trackLayout of plan.trackLayouts) {
      const box = trackLayout.measures.find((m) => m.measureIndex === measureIndex)?.box;
      if (!box) continue;
      if (point.y >= box.y && point.y < box.y + box.height) return trackLayout.track.id;
    }
  }
  return null;
}

/**
 * The pitch a point on a stave lands on, or `null` when it is not over one.
 *
 * A staff position is a line or the space beside it, so the y distance from the
 * top line divided by `STAVE_POSITION_HEIGHT` — rounded, since a click near a
 * line means that line — is how many diatonic steps down from the clef's top
 * note the reader is pointing at. `STAVE_TOP_LINE_OFFSET` is the same constant
 * the renderer draws with, so this agrees with what is on screen by
 * construction rather than by a matched guess.
 *
 * Content coordinates, unzoomed, like every other hit test here except the
 * track gutter.
 */
export function pitchAtStavePoint(
  plan: LayoutPlan,
  score: Score,
  point: Point,
): { pitch: Pitch; trackId: string } | null {
  for (const trackLayout of plan.trackLayouts) {
    for (const placement of trackLayout.measures) {
      const box = placement.box;
      if (point.x < box.x || point.x >= box.x + box.width) continue;
      if (point.y < box.y || point.y >= box.y + box.height) continue;

      const track = score.tracks.find((t) => t.id === trackLayout.track.id);
      if (!track) return null;

      const topLineY = box.y + STAVE_TOP_LINE_OFFSET;
      const position = Math.round((point.y - topLineY) / STAVE_POSITION_HEIGHT);
      /*
        The clef *in force at this bar*, not `track.clef`: a part that changes
        clef mid-piece reads in a different one from here on, and using the
        track's would place a clicked note a sixth away from the line under the
        pointer. The renderer resolves the stave's clef through the same
        function, which is what keeps the two in agreement by construction
        rather than by a matched guess.
      */
      const clef = effectiveClef(track, placement.measureIndex);
      return { pitch: pitchAtStavePosition(clef, position), trackId: track.id };
    }
  }
  return null;
}
