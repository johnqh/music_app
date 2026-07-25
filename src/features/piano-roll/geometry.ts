/**
 * Pure coordinate math and hit-testing for the piano roll (spec §8),
 * deliberately free of React/DOM/store imports so it can be unit-tested
 * with plain numbers and constructed fixtures, matching the score-editor's
 * `hit-test.ts` precedent (Task 12): this module owns tick<->x and
 * midi<->y conversions plus note-rect/grid-line computation; box/point
 * intersection itself is *not* duplicated here — `boxFromPoints`,
 * `pointInBBox`, `bboxesIntersect`, `eventIdAtPoint`, and `eventIdsInBox`
 * from `@/features/score-editor/hit-test` are reused as-is (a note's
 * rendered rect is the same `{x,y,width,height}` shape either way), and
 * re-exported here for convenience so `PianoRollView`/`interactions.ts`
 * only need to import from one place.
 */
import type { BBox } from '@/adapters/vexflow/types';
import type { Point } from '@/features/score-editor/hit-test';
import { boxFromPoints, bboxesIntersect, eventIdAtPoint, eventIdsInBox, pointInBBox } from '@/features/score-editor/hit-test';
import type { DurationName, NoteEvent, Score, Track, UUID } from '@/domain/score/types';
import { isNoteEvent } from '@/domain/score/types';
import { pitchToMidi, midiToPitch, pitchToString } from '@/domain/pitch/pitch';
import { beatBoundaries, measureDurationTicks, ticksFor } from '@/domain/time/ticks';
import type { ScoreFragment } from '@/domain/score/fragment';

export { boxFromPoints, pointInBBox, bboxesIntersect, eventIdAtPoint, eventIdsInBox };
export type { Point };

// ---- constants ----------------------------------------------------------------

/** Piano-roll pitch axis: the standard 88-key range, A0 (21) to C8 (108). */
export const MIN_MIDI = 21;
export const MAX_MIDI = 108;

/** Row height (px) per semitone at `zoomV = 1`. */
export const ROW_HEIGHT = 14;

/** Px per quarter note at `zoomH = 1`. */
export const BASE_PX_PER_QUARTER = 60;

/** Width (px) of the fixed left keyboard column. */
export const KEYBOARD_WIDTH = 56;

/** Pointer-proximity tolerance (px) for the right-edge resize handle. */
export const RESIZE_HANDLE_PX = 6;

/** Height (px) of one row in the below-the-keyboard "voice lane" strip (spec §8's "drag onto another track row region" — see `interactions.ts` for why this targets voice, not track, reassignment). */
export const VOICE_LANE_ROW_HEIGHT = 20;

/** Height (px) of the velocity lane at the bottom of the canvas. */
export const VELOCITY_LANE_HEIGHT = 70;

// ---- tick <-> x -----------------------------------------------------------------

/** Horizontal pixel position of `tick`, at the given ppq and horizontal zoom. */
export function tickToX(tick: number, ppq: number, zoomH: number): number {
  return (tick / ppq) * BASE_PX_PER_QUARTER * zoomH;
}

/** Inverse of `tickToX`: the tick nearest a given x position (not snapped to any grid). */
export function xToTick(x: number, ppq: number, zoomH: number): number {
  return (x / (BASE_PX_PER_QUARTER * zoomH)) * ppq;
}

// ---- midi <-> y -----------------------------------------------------------------

/** Row height (px) at the given vertical zoom. */
export function rowHeight(zoomV: number): number {
  return ROW_HEIGHT * zoomV;
}

/** Vertical pixel position (top of its row) of `midi`, higher pitches nearer the top (smaller y). */
export function midiToY(midi: number, zoomV: number): number {
  return (MAX_MIDI - midi) * rowHeight(zoomV);
}

/** Inverse of `midiToY`: the midi note whose row contains `y`, clamped to `[MIN_MIDI, MAX_MIDI]`. */
export function yToMidi(y: number, zoomV: number): number {
  const rowIndex = Math.round(y / rowHeight(zoomV));
  const midi = MAX_MIDI - rowIndex;
  return Math.max(MIN_MIDI, Math.min(MAX_MIDI, midi));
}

// ---- snapping -------------------------------------------------------------------

/** Rounds `tick` to the nearest multiple of `gridTicks` (or to the nearest integer if `gridTicks <= 0`), clamped to non-negative. */
export function snapTick(tick: number, gridTicks: number): number {
  const snapped = gridTicks > 0 ? Math.round(tick / gridTicks) * gridTicks : Math.round(tick);
  return Math.max(0, snapped);
}

// ---- keyboard -------------------------------------------------------------------

/** True for the five black keys per octave (pitch classes 1, 3, 6, 8, 10). */
export function isBlackKey(midi: number): boolean {
  const pitchClass = ((midi % 12) + 12) % 12;
  return [1, 3, 6, 8, 10].includes(pitchClass);
}

/** A midi number formatted as a pitch string, e.g. `C4`, `F#3` (sharp spelling; the keyboard column doesn't have a key signature to spell against). */
export function noteLabel(midi: number): string {
  return pitchToString(midiToPitch(midi));
}

export type KeyboardRow = { midi: number; isBlack: boolean; y: number; label: string | null };

/** One row per key from `MAX_MIDI` down to `MIN_MIDI` (top to bottom, matching `midiToY`), each labeled only at C (octave boundaries). */
export function computeKeyboardRows(zoomV: number): KeyboardRow[] {
  const rows: KeyboardRow[] = [];
  for (let midi = MAX_MIDI; midi >= MIN_MIDI; midi -= 1) {
    const pitch = midiToPitch(midi);
    rows.push({
      midi,
      isBlack: isBlackKey(midi),
      y: midiToY(midi, zoomV),
      label: pitch.step === 'C' && pitch.accidental === 0 ? noteLabel(midi) : null,
    });
  }
  return rows;
}

// ---- resize hit-testing -----------------------------------------------------------

/** Whether `point` falls within `handlePx` of `rect`'s right edge (and within its vertical band) — the piano roll's resize-handle hit test. */
export function isNearRightEdge(rect: BBox, point: Point, handlePx: number): boolean {
  if (point.y < rect.y || point.y > rect.y + rect.height) return false;
  const rightEdge = rect.x + rect.width;
  return point.x >= rightEdge - handlePx && point.x <= rightEdge + handlePx;
}

// ---- track color -------------------------------------------------------------------

/** A fixed, visually-distinct palette cycled by track index — deliberately independent of the MUI theme so track identity stays stable across light/dark mode. */
const TRACK_PALETTE = [
  '#1976d2', // blue
  '#d32f2f', // red
  '#388e3c', // green
  '#f57c00', // orange
  '#7b1fa2', // purple
  '#00838f', // teal
  '#c2185b', // pink
  '#5d4037', // brown
];

/** Deterministic color for a track, cycled through `TRACK_PALETTE` by index. */
export function trackColor(trackIndex: number): string {
  return TRACK_PALETTE[trackIndex % TRACK_PALETTE.length];
}

// ---- note rects -------------------------------------------------------------------

export type NoteRect = BBox & {
  id: UUID;
  trackId: UUID;
  trackIndex: number;
  velocity: number;
  midi: number;
};

export type ComputeNoteRectsOptions = {
  /** Track ids to include; `null` means "every track" (the default overlay view). */
  visibleTrackIds: ReadonlySet<UUID> | null;
  zoomH: number;
  zoomV: number;
};

/** Every note event across `score`'s (visible) tracks, positioned as a `{x,y,width,height}` rect via `tickToX`/`midiToY`. */
export function computeNoteRects(score: Score, options: ComputeNoteRectsOptions): NoteRect[] {
  const { visibleTrackIds, zoomH, zoomV } = options;
  const rects: NoteRect[] = [];

  score.tracks.forEach((track: Track, trackIndex) => {
    if (visibleTrackIds && !visibleTrackIds.has(track.id)) return;
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (!isNoteEvent(event)) continue;
          const note = event as NoteEvent;
          const midi = pitchToMidi(note.pitch);
          rects.push({
            id: note.id,
            trackId: track.id,
            trackIndex,
            velocity: note.velocity,
            midi,
            x: tickToX(note.startTick, score.ppq, zoomH),
            y: midiToY(midi, zoomV),
            width: Math.max(1, tickToX(note.durationTicks, score.ppq, zoomH)),
            height: rowHeight(zoomV),
          });
        }
      }
    }
  });

  return rects;
}

// ---- grid lines -------------------------------------------------------------------

export type GridLine = { tick: number; x: number; kind: 'measure' | 'beat' | 'subdivision' };

/**
 * Measure, beat, and subdivision grid lines (in px, via `tickToX`) for one
 * track's measures — the subdivision tier is generated from `snapGrid`
 * (the store's current snap duration, via `ticksFor`), so the grid stays
 * visually in sync with whatever the piano-roll toolbar's snap selector is
 * set to (spec §8: measure/beat/subdivision lines). A subdivision tick
 * that coincides with a measure or beat tick is skipped — every tick
 * appears at most once, at its strongest tier (measure > beat >
 * subdivision), never duplicated across kinds.
 */
export function computeGridLines(track: Track, ppq: number, zoomH: number, snapGrid: DurationName): GridLine[] {
  const lines: GridLine[] = [];
  const subdivisionTicks = ticksFor(snapGrid, ppq);

  for (const measure of track.measures) {
    const beatOffsets = new Set(beatBoundaries(measure.timeSignature, ppq));
    lines.push({ tick: measure.startTick, x: tickToX(measure.startTick, ppq, zoomH), kind: 'measure' });

    for (const offset of beatOffsets) {
      if (offset === 0) continue; // already covered by the measure line
      const tick = measure.startTick + offset;
      lines.push({ tick, x: tickToX(tick, ppq, zoomH), kind: 'beat' });
    }

    if (subdivisionTicks > 0) {
      for (let i = 1; ; i += 1) {
        const offset = Math.round(subdivisionTicks * i);
        if (offset >= measure.durationTicks) break;
        if (beatOffsets.has(offset)) continue; // dedupe: already a beat line, keep the stronger tier
        const tick = measure.startTick + offset;
        lines.push({ tick, x: tickToX(tick, ppq, zoomH), kind: 'subdivision' });
      }
    }
  }

  return lines;
}

/** Total px width spanned by `track`'s measures, for sizing the scrollable grid. */
export function trackWidthPx(track: Track, ppq: number, zoomH: number): number {
  const last = track.measures[track.measures.length - 1];
  if (!last) return 0;
  return tickToX(last.startTick + last.durationTicks, ppq, zoomH);
}

/** Tick length of one measure on `track` (uses its first measure's time signature; falls back to a 4/4 measure if the track has none). */
export function firstMeasureDurationTicks(track: Track, ppq: number): number {
  const first = track.measures[0];
  return first ? measureDurationTicks(first.timeSignature, ppq) : measureDurationTicks({ numerator: 4, denominator: 4 }, ppq);
}

// ---- preview-fragment note rects ---------------------------------------------------

export type PreviewNoteRect = BBox & { id: UUID; trackId: UUID };

/**
 * Positions a regeneration preview's note events (spec §8/§13:
 * "preview-fragment notes rendered distinctly") the same way
 * `computeNoteRects` positions committed notes, reading `fragment.ppq`
 * (rather than a `Score`'s) since a `ScoreFragment` carries its own.
 * `null`/no-fragment yields an empty array.
 */
export function computePreviewNoteRects(
  fragment: ScoreFragment | null,
  options: { zoomH: number; zoomV: number },
): PreviewNoteRect[] {
  if (!fragment) return [];
  const rects: PreviewNoteRect[] = [];

  for (const trackFragment of fragment.tracks) {
    for (const measure of trackFragment.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (!isNoteEvent(event)) continue;
          const note = event as NoteEvent;
          const midi = pitchToMidi(note.pitch);
          rects.push({
            id: note.id,
            trackId: trackFragment.trackId,
            x: tickToX(note.startTick, fragment.ppq, options.zoomH),
            y: midiToY(midi, options.zoomV),
            width: Math.max(1, tickToX(note.durationTicks, fragment.ppq, options.zoomH)),
            height: rowHeight(options.zoomV),
          });
        }
      }
    }
  }

  return rects;
}

// ---- overall canvas layout ---------------------------------------------------------

/** Total px height of the keyboard/note-grid area at the given vertical zoom (every key, `MIN_MIDI..MAX_MIDI`). */
export function keyboardHeightPx(zoomV: number): number {
  return (MAX_MIDI - MIN_MIDI + 1) * rowHeight(zoomV);
}

/** Total px height of the below-the-grid voice-lane strip for `voiceCount` lanes. */
export function voiceLaneStripHeight(voiceCount: number): number {
  return voiceCount * VOICE_LANE_ROW_HEIGHT;
}

/** Total px height of the piano-roll canvas: keyboard/grid + voice-lane strip + velocity lane. */
export function totalCanvasHeight(zoomV: number, voiceCount: number): number {
  return keyboardHeightPx(zoomV) + voiceLaneStripHeight(voiceCount) + VELOCITY_LANE_HEIGHT;
}

// ---- note culling (Task 17, spec §29 virtualization) ---------------------------------

/**
 * Every rect in `rects` whose box intersects `viewport` (reusing
 * `bboxesIntersect`'s exact-overlap test — a rect merely touching the
 * viewport's edge doesn't count, matching every other hit-test in this
 * module). Used to skip rendering DOM nodes for notes scrolled out of view
 * (spec §29 "virtualization for large track lists or long scores") — pure
 * and geometry-only, so it works the same for `NoteRect`s (`computeNoteRects`)
 * as for `PreviewNoteRect`s (`computePreviewNoteRects`).
 */
export function cullToViewport<T extends BBox>(rects: readonly T[], viewport: BBox): T[] {
  return rects.filter((r) => bboxesIntersect(r, viewport));
}

/**
 * Whether `a` and `b` contain exactly the same ids (set equality,
 * order-independent). Used by `PianoRollView` to decide whether a
 * freshly-`cullToViewport`-computed visible-note-id set actually differs
 * from the currently-applied one before committing a state update — a
 * scroll that doesn't change which notes are visible should never trigger
 * a re-render (spec §29: virtualization shouldn't itself become a
 * per-scroll-frame performance cost). Mirrors
 * `adapters/vexflow/layout.ts`'s `sameMeasureIndices` for the score
 * editor's analogous guard.
 */
export function sameIdSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}
