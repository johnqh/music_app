/**
 * Pure bounding-box geometry for score-editor hit-testing (spec §7 items
 * 7-10: note selection, shift-click multi-selection, drag-box selection).
 * Deliberately free of React/DOM/store imports so it can be unit-tested
 * with plain constructed `BBox` values.
 *
 * Real coordinates come from `RenderResult.idToBBox`
 * (`adapters/vexflow/renderer.ts`, Task 11), which are all-zero in jsdom
 * (no real SVG layout engine) — so `ScoreEditorView`'s component tests
 * exercise *this* module's math separately (with synthetic bboxes) from
 * the DOM click-target-id-based path used for plain point clicks (which
 * works fine in jsdom since it only needs element identity, not geometry).
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

/** The first id (in map iteration order) whose bbox contains `point`, or `null` if none match. */
export function eventIdAtPoint(idToBBox: ReadonlyMap<string, BBox>, point: Point): string | null {
  for (const [id, box] of idToBBox) {
    if (pointInBBox(box, point)) return id;
  }
  return null;
}

/** Every id whose bbox intersects `box` (drag-box/rubber-band selection), in map iteration order. */
export function eventIdsInBox(idToBBox: ReadonlyMap<string, BBox>, box: BBox): string[] {
  const ids: string[] = [];
  for (const [id, candidate] of idToBBox) {
    if (bboxesIntersect(candidate, box)) ids.push(id);
  }
  return ids;
}
