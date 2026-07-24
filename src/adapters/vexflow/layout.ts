/**
 * System layout (spec §7, §26): decides which measures share a system
 * ("row") and the pixel box (x, y, width, height) each track's stave
 * occupies for every measure, for both "page" (wraps to `options.width`)
 * and "continuous" (everything in one system) layout modes.
 *
 * Heuristic by design (per spec §26, layout need only be "practical", not
 * exact): measure width is a fixed target scaled by zoom, not derived from
 * actual note density/glyph widths. Good enough for MVP rendering; a denser
 * formatter could replace this later without touching the renderer's shape.
 */
import type { Score, Track } from '@/domain/score/types';
import type { RenderOptions } from '@/adapters/vexflow/types';

export type StaveBox = { x: number; y: number; width: number; height: number };

export type MeasureLayout = {
  measureIndex: number;
  isFirstInSystem: boolean;
  box: StaveBox;
};

export type TrackLayout = {
  track: Track;
  measures: MeasureLayout[];
};

/** A brace/connector-worthy row: the outer bounds of every track's stave sharing this system. */
export type SystemLayout = {
  measureIndices: number[];
  xLeft: number;
  xRight: number;
  yTop: number;
  yBottom: number;
};

export type LayoutPlan = {
  tracks: Track[];
  trackLayouts: TrackLayout[];
  systems: SystemLayout[];
  totalWidth: number;
  totalHeight: number;
};

const BASE_MEASURE_WIDTH = 200;
const MIN_MEASURE_WIDTH = 90;
/** Extra width reserved on a system's first measure for clef + key signature + time signature. */
const SYSTEM_HEADER_WIDTH = 90;
const STAVE_HEIGHT = 100;
const TRACK_GAP = 20;
const SYSTEM_GAP = 40;
const LEFT_MARGIN = 10;
const TOP_MARGIN = 10;

/** Tracks to render, in `options.trackIds` order when given (unknown ids are dropped); else score order. */
function selectTracks(score: Score, options: RenderOptions): Track[] {
  if (!options.trackIds || options.trackIds.length === 0) {
    return score.tracks;
  }
  const byId = new Map(score.tracks.map((t) => [t.id, t] as const));
  return options.trackIds.map((id) => byId.get(id)).filter((t): t is Track => t !== undefined);
}

/** Greedily groups measure indices into systems (rows) so each row's total width fits `maxWidth`. */
function groupIntoSystems(measureCount: number, measureWidth: (index: number) => number, maxWidth: number): number[][] {
  const systems: number[][] = [];
  let current: number[] = [];
  let currentWidth = 0;

  for (let i = 0; i < measureCount; i += 1) {
    const width = measureWidth(i);
    if (current.length > 0 && currentWidth + width > maxWidth) {
      systems.push(current);
      current = [];
      currentWidth = 0;
    }
    current.push(i);
    currentWidth += width;
  }
  if (current.length > 0) systems.push(current);
  return systems;
}

/**
 * Computes per-track, per-measure stave boxes and per-system outer bounds
 * (for brace/connector drawing). Assumes all selected tracks share the same
 * measure count; a track with fewer measures than the score's max simply
 * has no box for the missing trailing measures (defensive, not expected in
 * practice — spec §4 keeps tracks aligned to the same measure grid).
 */
export function computeLayout(score: Score, options: RenderOptions): LayoutPlan {
  const zoom = options.zoom > 0 ? options.zoom : 1;
  const tracks = selectTracks(score, options);
  const measureCount = tracks.reduce((max, t) => Math.max(max, t.measures.length), 0);

  const measureWidth = Math.max(MIN_MEASURE_WIDTH, BASE_MEASURE_WIDTH * zoom);
  const headerWidth = SYSTEM_HEADER_WIDTH * zoom;
  const staveHeight = STAVE_HEIGHT * zoom;
  const trackGap = TRACK_GAP * zoom;
  const systemGap = SYSTEM_GAP * zoom;
  const leftMargin = LEFT_MARGIN * zoom;
  const topMargin = TOP_MARGIN * zoom;

  const widthOf = (isFirstInSystem: boolean): number => measureWidth + (isFirstInSystem ? headerWidth : 0);

  // A measure's width can't depend on system membership until we know system
  // membership, so pack using each measure's "first-in-system" width as an
  // upper bound (every measure could end up first); this only ever
  // under-packs a system slightly versus a hypothetical perfect packer, never
  // overflows `options.width`.
  const availableWidth = options.layoutMode === 'continuous' ? Number.POSITIVE_INFINITY : Math.max(options.width, measureWidth + headerWidth);
  const systemsOfIndices = groupIntoSystems(measureCount, () => widthOf(true), availableWidth - leftMargin);

  const rowHeight = (count: number): number => (count > 0 ? count * staveHeight + Math.max(0, count - 1) * trackGap : 0);
  const trackRowHeight = rowHeight(tracks.length);

  const trackLayouts: TrackLayout[] = tracks.map((track) => ({ track, measures: [] }));
  const systems: SystemLayout[] = [];

  let maxSystemRight = 0;

  systemsOfIndices.forEach((measureIndices, systemIndex) => {
    const yTop = topMargin + systemIndex * (trackRowHeight + systemGap);
    const yBottom = yTop + trackRowHeight;

    let cursorX = leftMargin;
    measureIndices.forEach((measureIndex, positionInSystem) => {
      const isFirstInSystem = positionInSystem === 0;
      const width = widthOf(isFirstInSystem);

      tracks.forEach((track, trackIndex) => {
        if (measureIndex >= track.measures.length) return;
        const y = yTop + trackIndex * (staveHeight + trackGap);
        trackLayouts[trackIndex].measures.push({
          measureIndex,
          isFirstInSystem,
          box: { x: cursorX, y, width, height: staveHeight },
        });
      });

      cursorX += width;
    });

    maxSystemRight = Math.max(maxSystemRight, cursorX);
    systems.push({ measureIndices, xLeft: leftMargin, xRight: cursorX, yTop, yBottom });
  });

  const totalHeight = systems.length > 0 ? systems[systems.length - 1].yBottom + topMargin : topMargin * 2;
  const totalWidth = Math.max(maxSystemRight + leftMargin, options.layoutMode === 'page' ? options.width : 0);

  return { tracks, trackLayouts, systems, totalWidth, totalHeight };
}
