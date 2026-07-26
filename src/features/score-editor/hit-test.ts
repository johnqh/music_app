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
import type { BBox } from '@sudobility/music_lib';

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

/** Every id whose bbox intersects `box` (drag-box/rubber-band selection), in map iteration order. */
export function eventIdsInBox(idToBBox: ReadonlyMap<string, BBox>, box: BBox): string[] {
  const ids: string[] = [];
  for (const [id, candidate] of idToBBox) {
    if (bboxesIntersect(candidate, box)) ids.push(id);
  }
  return ids;
}

/** The measure id whose stave box contains `point`, or `null`. Same window-scoped linear scan as `eventIdAtPoint`. */
export function measureIdAtPoint(measureIdToBBox: ReadonlyMap<string, BBox>, point: Point): string | null {
  let hit: string | null = null;
  for (const [id, box] of measureIdToBBox) {
    if (pointInBBox(box, point)) hit = id;
  }
  return hit;
}
