/**
 * The piano-roll editor (spec §8): a synchronized alternate view of the
 * same score/selection the notation view (`ScoreEditorView`, Task 12)
 * edits — no view-local note state, every mutation routes through
 * `interactions.ts`'s command-dispatching helpers, and selection lives in
 * the shared `selection-slice` (spec §9), so dragging a note here and
 * switching to the notation view shows the identical result.
 *
 * Rendered as absolutely-positioned divs inside one scrollable container
 * (no canvas, per the brief): a sticky left keyboard column, a note grid
 * with measure/beat/subdivision lines, a playback cursor, loop-region
 * shading, preview-fragment notes, a below-the-grid "voice lane" strip
 * (see `interactions.ts`'s `commitVoiceChange` doc comment for why
 * dropping a note there reassigns its voice rather than its track), and a
 * velocity lane at the bottom with one draggable bar per note.
 *
 * Pointer interactions follow the score editor's click/shift-click/
 * drag-box precedent (Task 12's `ScoreEditorView`): one pointerdown/move/up
 * cycle on the grid container, hit-tested via `geometry.ts`, distinguishes
 * a plain click (select) from a real drag (move/resize/box-select) by a
 * pixel threshold, and commits at most one command on pointerup. A
 * `pointercancel`/`lostpointercapture` (touch takeover, alt-tab, etc.)
 * resets the in-flight drag without dispatching anything — see
 * `handlePointerCancel`/`handleVelocityPointerCancel`. Unlike the
 * VexFlow-rendered notation view, note positions here come straight from
 * `geometry.ts`'s own tick/pitch math (not a real SVG layout engine), so —
 * as documented in `geometry.ts` — these interactions are exercised
 * end-to-end in jsdom with real coordinates, no mocked bboxes needed.
 *
 * The playback cursor is isolated into its own `PlaybackCursor`
 * subcomponent, which alone subscribes to `positionTick`: this view's own
 * top level does not, so a playback frame (positionTick changing many
 * times a second) re-renders only the cursor line, not the note/grid
 * layers (`NoteLayer`/`GridLinesLayer`, both `React.memo`'d besides).
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { findEvent } from '@sudobility/music_lib';
import { isNoteEvent } from '@sudobility/music_types';
import type { UUID } from '@sudobility/music_types';
import { ticksFor } from '@sudobility/music_lib';
import { selectionSummaryLabel } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import {
  KEYBOARD_WIDTH,
  RESIZE_HANDLE_PX,
  VELOCITY_LANE_HEIGHT,
  VOICE_LANE_ROW_HEIGHT,
  boxFromPoints,
  computeGridLines,
  computeKeyboardRows,
  computeNoteRects,
  computePreviewNoteRects,
  cullToViewport,
  eventIdAtPoint,
  eventIdsInBox,
  isNearRightEdge,
  keyboardHeightPx,
  rowHeight,
  sameIdSet,
  snapTick,
  tickToX,
  totalCanvasHeight,
  trackColor,
  trackWidthPx,
  voiceLaneStripHeight,
  xToTick,
  yToMidi,
} from '@/features/piano-roll/geometry';
import type { GridLine, NoteRect, Point } from '@/features/piano-roll/geometry';
import {
  addNoteAtCell,
  commitMove,
  commitResize,
  commitVelocity,
  commitVoiceChange,
  maxVoiceCount,
  resolveActiveTrackId,
} from '@/features/piano-roll/interactions';
import { PianoRollToolbar } from '@/features/piano-roll/PianoRollToolbar';
import { recordNoteLayerRender } from '@/features/piano-roll/render-counters';

export type PianoRollViewProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
};

const CONTAINER_MIN_HEIGHT = 400;
/** Pixels of pointer movement before a pointerdown-drag counts as a real drag rather than a plain click. */
const DRAG_THRESHOLD = 3;
/** Screen-pixel buffer added on every side of the measured scroll viewport before culling notes (spec §29 virtualization), so a small scroll doesn't flash a blank grid before the next render pass catches up. */
const VIRTUALIZATION_OVERSCAN_PX = 200;

type NoteOrigin = { startTick: number; durationTicks: number };

type DragState =
  | { mode: 'select'; start: Point; moved: boolean; additive: boolean }
  | {
      mode: 'move' | 'resize';
      start: Point;
      moved: boolean;
      additive: boolean;
      noteId: UUID;
      ids: UUID[];
      origins: Map<UUID, NoteOrigin>;
    };

// ---- isolated playback cursor ------------------------------------------------------------

type PlaybackCursorProps = { store: EditorStoreApi; ppq: number; zoomH: number; height: number };

/** The only part of the piano roll that subscribes to `positionTick` — kept as its own component precisely so a playback frame doesn't re-render `PianoRollView`'s note/grid layers (see the module doc comment above). */
function PlaybackCursor({ store, ppq, zoomH, height }: PlaybackCursorProps) {
  const positionTick = store((s) => s.positionTick);
  const x = tickToX(positionTick, ppq, zoomH);
  return (
    <Box
      data-testid="piano-roll-cursor"
      style={{ position: 'absolute', left: x, top: 0, width: 2, height }}
      sx={{ bgcolor: 'success.main', pointerEvents: 'none' }}
    />
  );
}

// ---- isolated, memoized grid-line and note layers ------------------------------------------

type GridLinesLayerProps = { lines: GridLine[]; height: number };

const GRID_LINE_OPACITY: Record<GridLine['kind'], number> = { measure: 0.8, beat: 0.35, subdivision: 0.15 };

const GridLinesLayer = memo(function GridLinesLayer({ lines, height }: GridLinesLayerProps) {
  return (
    <>
      {lines.map((line) => (
        <Box
          key={`${line.kind}-${line.tick}`}
          style={{ position: 'absolute', left: line.x, top: 0, width: line.kind === 'measure' ? 2 : 1, height }}
          sx={{ bgcolor: 'divider', opacity: GRID_LINE_OPACITY[line.kind] }}
        />
      ))}
    </>
  );
});

type NoteLayerProps = { noteRects: NoteRect[]; selectedIds: ReadonlySet<UUID>; selectionColor: string };

const NoteLayer = memo(function NoteLayer({ noteRects, selectedIds, selectionColor }: NoteLayerProps) {
  recordNoteLayerRender();
  return (
    <>
      {noteRects.map((r) => {
        const selected = selectedIds.has(r.id);
        const velocityFraction = Math.max(0, Math.min(127, r.velocity)) / 127;
        return (
          <Box
            key={r.id}
            data-testid={`pr-note-${r.id}`}
            style={{ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height }}
            sx={{
              bgcolor: trackColor(r.trackIndex),
              opacity: 0.35 + 0.65 * velocityFraction,
              border: selected ? `2px solid ${selectionColor}` : '1px solid rgba(0,0,0,0.35)',
              boxSizing: 'border-box',
              cursor: 'grab',
            }}
          >
            {/* inner velocity bar */}
            <Box
              style={{ position: 'absolute', bottom: 0, left: 0, width: `${velocityFraction * 100}%` }}
              sx={{ height: 2, bgcolor: 'rgba(255,255,255,0.85)', pointerEvents: 'none' }}
            />
          </Box>
        );
      })}
    </>
  );
});

export function PianoRollView({ store = useAppStore }: PianoRollViewProps) {
  const muiTheme = useTheme();

  const score = store((s) => s.score);
  const selection = store((s) => s.selection);
  const loopRange = store((s) => s.loopRange);
  const previewFragment = store((s) => s.previewFragment);
  const snapGrid = store((s) => s.snapGrid);

  const [zoomH, setZoomH] = useState(1);
  const [zoomV, setZoomV] = useState(1);
  const [visibleTrackIds, setVisibleTrackIds] = useState<Set<UUID> | null>(null);
  const [dragBox, setDragBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // The ids of the notes currently within the scroll viewport (spec §29
  // virtualization) — a three-state value, deliberately distinguishing
  // "not yet measured" from "measured, but unusable":
  //   - `undefined`: no measurement attempt has happened yet (true initial
  //     mount, before any effect has run). Renders an EMPTY note layer for
  //     this pass — see `visibleNoteRects` — rather than every note,
  //     because a real browser's very first commit for a fresh mount
  //     *does* have a real viewport available by the time the very next
  //     (pre-paint) layout effect runs; there is no reason to pay for
  //     mounting (and immediately discarding) up to tens of thousands of
  //     note `Box` elements just because that measurement hasn't landed
  //     yet (Task 17 review finding 1).
  //   - `'unmeasurable'`: a measurement was attempted (`measureViewport`
  //     ran) but `clientHeight <= 0` (jsdom, which never lays anything
  //     out, or a container that genuinely isn't laid out for some other
  //     reason) — falls back to rendering every note, exactly like the
  //     pre-fix behavior, so jsdom-based tests and any other environment
  //     that can never produce a real measurement still work.
  //   - a `Set<UUID>`: a real measurement succeeded; renders exactly that
  //     culled set.
  // Held as a resolved id set (rather than a raw `{x,y,width,height}`
  // viewport + a separately memoized filter) so `measureViewport` can bail
  // out of the state update entirely via `sameIdSet` when a scroll doesn't
  // actually change which notes are visible, without a second value to
  // keep in sync.
  const [visibleNoteIds, setVisibleNoteIds] = useState<ReadonlySet<UUID> | 'unmeasurable' | undefined>(undefined);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  /**
   * Throttling bookkeeping for `handleScroll`'s `requestAnimationFrame`-
   * scheduled `measureViewport` call — see `ScoreEditorView.tsx`'s
   * identical fields for why this is two separate refs (a `true`-before-
   * scheduling guard flag, plus the frame id purely for unmount cleanup)
   * rather than one "id, or null" ref.
   */
  const scrollFrameScheduledRef = useRef(false);
  const scrollRafIdRef = useRef<number | null>(null);

  const ppq = score?.ppq ?? 480;
  const referenceTrack = score?.tracks[0] ?? null;

  const noteRects = useMemo<NoteRect[]>(
    () => (score ? computeNoteRects(score, { visibleTrackIds, zoomH, zoomV }) : []),
    [score, visibleTrackIds, zoomH, zoomV],
  );
  // Hit-testing (`eventIdAtPoint`/`eventIdsInBox`/drag origins below) always
  // uses the full, uncalled `noteRects` — culling (`visibleNoteRects`,
  // below) only decides what's actually drawn, not what's interactable, so
  // interaction behavior is identical regardless of scroll position.
  const noteRectsById = useMemo(() => new Map(noteRects.map((r) => [r.id, r])), [noteRects]);

  /** The ids of `rects` intersecting the scrollable ancestor's current scroll position (grid-local coordinates: sticky keyboard column's width subtracted out, padded by `VIRTUALIZATION_OVERSCAN_PX`), or `undefined` if the container isn't measurable right now (`clientHeight <= 0` — jsdom, or not yet laid out). Reads live DOM geometry off `scrollRef`, not React state. */
  const measureVisibleIds = useCallback((rects: NoteRect[]): Set<UUID> | undefined => {
    const el = scrollRef.current;
    if (!el || el.clientHeight <= 0) return undefined;
    const rect = {
      x: el.scrollLeft - KEYBOARD_WIDTH - VIRTUALIZATION_OVERSCAN_PX,
      y: el.scrollTop - VIRTUALIZATION_OVERSCAN_PX,
      width: el.clientWidth + VIRTUALIZATION_OVERSCAN_PX * 2,
      height: el.clientHeight + VIRTUALIZATION_OVERSCAN_PX * 2,
    };
    return new Set(cullToViewport(rects, rect).map((r) => r.id));
  }, []);

  /**
   * Culled to the scroll viewport (spec §29): `[]` while `visibleNoteIds`
   * is `undefined` (no measurement attempt has landed yet — see
   * `visibleNoteIds`'s doc comment for why this is empty, not "every
   * note"), every `noteRects` entry unfiltered once it's known the
   * viewport genuinely can't be measured (`'unmeasurable'`), or exactly
   * the culled set once a real measurement has succeeded.
   *
   * Unlike `ScoreEditorView.tsx`'s draw effect (which can measure and
   * paint inline within the same imperative `useEffect`, entirely
   * bypassing state for its own first pass — see that file's
   * `measuredForPlanRef` doc comment), this component's "draw" *is* its
   * render output — a `useMemo`, evaluated during the render phase,
   * before any commit has happened and before `scrollRef.current` can
   * possibly be non-null. So the very first commit for a brand-new
   * `noteRects` cannot itself measure (there is nothing yet to measure
   * against) — rendering empty here, rather than everything, is what
   * keeps that unavoidable first commit cheap; the `useLayoutEffect`
   * below then resolves `visibleNoteIds` to its real value (a culled set,
   * or `'unmeasurable'`) synchronously, before the browser's next paint.
   */
  const visibleNoteRects = useMemo(() => {
    if (visibleNoteIds === undefined) return [];
    if (visibleNoteIds === 'unmeasurable') return noteRects;
    return noteRects.filter((r) => visibleNoteIds.has(r.id));
  }, [noteRects, visibleNoteIds]);

  const selectedIds = useMemo(() => new Set(selection.eventIds), [selection.eventIds]);

  /**
   * Re-measures `scrollRef`'s scroll position/size and updates
   * `visibleNoteIds` — but only when the freshly-computed visible-note-id
   * set actually differs (by value, via `sameIdSet`) from the currently-
   * applied one. Returning the *same* object reference from a state
   * updater is a standard React bail-out: no re-render (and so no
   * re-filter/re-render of `NoteLayer`) happens for a scroll that doesn't
   * change which notes are visible (Task 17 review finding). A
   * `clientHeight <= 0` (jsdom, or a container not yet laid out) records
   * the `'unmeasurable'` sentinel (see `visibleNoteIds`'s doc comment) —
   * once, not on every failed attempt — rather than leaving state
   * unchanged forever.
   */
  const measureViewport = useCallback(() => {
    const next = measureVisibleIds(noteRects);
    if (next === undefined) {
      setVisibleNoteIds((prev) => (prev === 'unmeasurable' ? prev : 'unmeasurable'));
      return;
    }
    setVisibleNoteIds((prev) => (prev instanceof Set && sameIdSet(prev, next) ? prev : next));
  }, [noteRects, measureVisibleIds]);

  /**
   * `onScroll` handler: throttles `measureViewport` to at most once per
   * animation frame (Task 17 review finding — every raw scroll event would
   * otherwise trigger a measurement, and potentially a re-render, per
   * event rather than per frame). Trailing-edge: multiple scroll events
   * within one frame collapse into a single measurement using the
   * position at the time the frame actually fires.
   */
  const handleScroll = useCallback(() => {
    if (scrollFrameScheduledRef.current) return;
    scrollFrameScheduledRef.current = true;
    scrollRafIdRef.current = requestAnimationFrame(() => {
      scrollFrameScheduledRef.current = false;
      scrollRafIdRef.current = null;
      measureViewport();
    });
  }, [measureViewport]);

  useEffect(() => {
    return () => {
      if (scrollRafIdRef.current !== null) {
        cancelAnimationFrame(scrollRafIdRef.current);
        scrollRafIdRef.current = null;
      }
      scrollFrameScheduledRef.current = false;
    };
  }, []);

  // Resolves `visibleNoteIds` from its initial `undefined` (renders an
  // empty note layer — see `visibleNoteIds`'s doc comment) to its real
  // value before the browser paints (Task 17 review finding 1).
  // `useLayoutEffect` runs after DOM mutations but before paint, so
  // `scrollRef.current` is now attached and measurable (in a real
  // browser), and its `setState` call is flushed synchronously (still
  // pre-paint) — so the very first thing the browser actually paints for
  // a fresh mount is either the correctly culled set (real viewport) or
  // every note (genuinely unmeasurable, e.g. jsdom), never an
  // intermediate empty-then-corrected flash, and — the actual fix this
  // finding wanted — never an initial commit that mounted every note into
  // real DOM only to immediately discard most of them. `measureViewport`
  // itself already depends on `noteRects` (which depends on `score`/
  // `zoomH`/`zoomV`/`visibleTrackIds`), so depending on it alone here
  // covers all of those changes too.
  useLayoutEffect(() => {
    measureViewport();
  }, [measureViewport]);

  const previewRects = useMemo(
    () => computePreviewNoteRects(previewFragment, { zoomH, zoomV }),
    [previewFragment, zoomH, zoomV],
  );

  const gridLines = useMemo(
    () => (referenceTrack ? computeGridLines(referenceTrack, ppq, zoomH, snapGrid) : []),
    [referenceTrack, ppq, zoomH, snapGrid],
  );
  const gridWidth = referenceTrack ? trackWidthPx(referenceTrack, ppq, zoomH) : 0;

  const voiceCount = score ? maxVoiceCount(score, visibleTrackIds) : 2;
  const kbHeight = keyboardHeightPx(zoomV);
  const voiceStripHeight = voiceLaneStripHeight(voiceCount);
  const velocityTop = kbHeight + voiceStripHeight;
  const totalHeight = totalCanvasHeight(zoomV, voiceCount);
  const keyboardRows = useMemo(() => computeKeyboardRows(zoomV), [zoomV]);

  const loopRect = useMemo(() => {
    if (!loopRange) return null;
    const x = tickToX(loopRange.startTick, ppq, zoomH);
    const width = Math.max(0, tickToX(loopRange.endTick - loopRange.startTick, ppq, zoomH));
    return { x, width };
  }, [loopRange, ppq, zoomH]);

  const pointFromEvent = useCallback((event: { clientX: number; clientY: number }): Point | null => {
    const el = gridRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const resetDrag = useCallback(() => {
    dragStateRef.current = null;
    setDragBox(null);
  }, []);

  // ---- note select / move / resize / voice-lane drop -----------------------------------

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const point = pointFromEvent(event);
      if (!point) return;

      const hitId = eventIdAtPoint(noteRectsById, point);
      if (hitId) {
        const rect = noteRectsById.get(hitId)!;
        const mode: 'move' | 'resize' = isNearRightEdge(rect, point, RESIZE_HANDLE_PX) ? 'resize' : 'move';
        const currentSelection = store.getState().selection;
        const ids = currentSelection.eventIds.includes(hitId) ? currentSelection.eventIds : [hitId];

        const origins = new Map<UUID, NoteOrigin>();
        const currentScore = store.getState().score;
        if (currentScore) {
          for (const id of ids) {
            const ev = findEvent(currentScore, id);
            if (ev && isNoteEvent(ev)) {
              origins.set(id, { startTick: ev.startTick, durationTicks: ev.durationTicks });
            }
          }
        }

        dragStateRef.current = { mode, start: point, moved: false, additive: event.shiftKey, noteId: hitId, ids, origins };
      } else {
        dragStateRef.current = { mode: 'select', start: point, moved: false, additive: event.shiftKey };
      }

      gridRef.current?.setPointerCapture?.(event.pointerId);
    },
    [noteRectsById, pointFromEvent, store],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const point = pointFromEvent(event);
      if (!point) return;

      if (!drag.moved) {
        const dx = Math.abs(point.x - drag.start.x);
        const dy = Math.abs(point.y - drag.start.y);
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) drag.moved = true;
      }

      // Only the box-select overlay needs live visual feedback; move/resize
      // commit a single command from the final pointerup position (spec
      // §8: "ONE moveNotesCommand on pointer-up"), so no per-move work is
      // needed for those modes.
      if (drag.mode === 'select' && drag.moved) {
        setDragBox(boxFromPoints(drag.start, point));
      }
    },
    [pointFromEvent],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      gridRef.current?.releasePointerCapture?.(event.pointerId);
      const point = pointFromEvent(event) ?? drag.start;

      if (!drag.moved) {
        // A plain click: select (or shift-toggle) the hit note; clicking
        // empty space with no movement leaves the selection untouched
        // (matches ScoreEditorView's drag-box precedent).
        if (drag.mode !== 'select') {
          if (drag.additive) store.getState().toggleEvent(drag.noteId);
          else store.getState().setSelection({ eventIds: [drag.noteId], measureIds: [], trackIds: [] });
        }
        resetDrag();
        return;
      }

      if (drag.mode === 'select') {
        const box = boxFromPoints(drag.start, point);
        const hitIds = eventIdsInBox(noteRectsById, box);
        const current = store.getState().selection;
        const nextIds = drag.additive ? Array.from(new Set([...current.eventIds, ...hitIds])) : hitIds;
        store.getState().setSelection({ eventIds: nextIds, measureIds: [], trackIds: [] });
      } else if (drag.mode === 'move') {
        const laneTop = kbHeight;
        const laneBottom = kbHeight + voiceStripHeight;
        if (point.y >= laneTop && point.y < laneBottom) {
          const targetVoiceIndex = Math.max(0, Math.floor((point.y - laneTop) / VOICE_LANE_ROW_HEIGHT));
          commitVoiceChange(store, drag.ids, targetVoiceIndex);
        } else {
          const origin = drag.origins.get(drag.noteId);
          if (origin) {
            const gridTicks = ticksFor(store.getState().snapGrid, ppq);
            const rawTick = origin.startTick + xToTick(point.x - drag.start.x, ppq, zoomH);
            const snappedTick = snapTick(rawTick, gridTicks);
            const deltaTicks = snappedTick - origin.startTick;
            const deltaRows = Math.round((point.y - drag.start.y) / rowHeight(zoomV));
            const deltaSemitones = -deltaRows;
            commitMove(store, drag.ids, { deltaTicks, deltaSemitones });
          }
        }
      } else if (drag.mode === 'resize') {
        const origin = drag.origins.get(drag.noteId);
        if (origin) {
          const gridTicks = ticksFor(store.getState().snapGrid, ppq);
          const rawDuration = origin.durationTicks + xToTick(point.x - drag.start.x, ppq, zoomH);
          const snappedDuration = snapTick(rawDuration, gridTicks);
          commitResize(store, drag.ids, snappedDuration);
        }
      }

      resetDrag();
    },
    [store, noteRectsById, pointFromEvent, resetDrag, kbHeight, voiceStripHeight, ppq, zoomH, zoomV],
  );

  /**
   * `pointercancel` (touch takeover, alt-tab, browser-initiated capture
   * loss, etc.) aborts the in-flight drag without dispatching anything —
   * unlike `handlePointerUp`, which always commits a real drag. Also
   * wired to `onLostPointerCapture` (fires whenever this element loses
   * pointer capture for any reason) as a second line of defense, so a
   * capture loss that doesn't also deliver a `pointercancel` event still
   * can't leave `dragStateRef`/the drag-box overlay stuck.
   */
  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      gridRef.current?.releasePointerCapture?.(event.pointerId);
      resetDrag();
    },
    [resetDrag],
  );

  // ---- double-click empty cell: add note ------------------------------------------------

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!score) return;
      const point = pointFromEvent(event);
      if (!point) return;
      if (eventIdAtPoint(noteRectsById, point)) return; // clicked an existing note: no-op
      if (point.y >= kbHeight) return; // clicked the voice/velocity lane, not a pitch cell

      const tick = xToTick(point.x, ppq, zoomH);
      const midi = yToMidi(point.y, zoomV);
      const trackId = resolveActiveTrackId(score, selection, visibleTrackIds);
      if (!trackId) return;
      addNoteAtCell(store, { trackId, tick, midi });
    },
    [score, selection, visibleTrackIds, noteRectsById, kbHeight, ppq, zoomH, zoomV, pointFromEvent, store],
  );

  // ---- velocity lane bar drag ------------------------------------------------------------

  const handleVelocityPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }, []);

  const handleVelocityPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, noteId: UUID) => {
      event.stopPropagation();
      (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
      const point = pointFromEvent(event);
      if (!point) return;
      const relativeY = Math.max(0, Math.min(VELOCITY_LANE_HEIGHT, point.y - velocityTop));
      const velocity = Math.round(((VELOCITY_LANE_HEIGHT - relativeY) / VELOCITY_LANE_HEIGHT) * 127);
      commitVelocity(store, [noteId], velocity);
    },
    [pointFromEvent, velocityTop, store],
  );

  /** Mirrors `handlePointerCancel`: releases capture only, never commits a velocity change. */
  const handleVelocityPointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    (event.currentTarget as Element).releasePointerCapture?.(event.pointerId);
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <PianoRollToolbar
        store={store}
        zoomH={zoomH}
        zoomV={zoomV}
        onZoomHChange={setZoomH}
        onZoomVChange={setZoomV}
        visibleTrackIds={visibleTrackIds}
        onVisibleTrackIdsChange={setVisibleTrackIds}
      />
      <Box
        ref={scrollRef}
        role="region"
        aria-label="Piano roll"
        data-testid="piano-roll-scroll"
        onScroll={handleScroll}
        sx={{ flex: 1, overflow: 'auto', minHeight: CONTAINER_MIN_HEIGHT, position: 'relative' }}
      >
        <Box sx={{ display: 'flex', width: KEYBOARD_WIDTH + gridWidth }}>
          <Box
            data-testid="piano-roll-keyboard"
            sx={{
              position: 'sticky',
              left: 0,
              zIndex: 2,
              flexShrink: 0,
              width: KEYBOARD_WIDTH,
              bgcolor: 'background.paper',
              borderRight: 1,
              borderColor: 'divider',
            }}
            style={{ height: kbHeight }}
          >
            <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
              {keyboardRows.map((row) => (
                <Box
                  key={row.midi}
                  style={{ position: 'absolute', top: row.y, left: 0, width: '100%', height: rowHeight(zoomV) }}
                  sx={{
                    bgcolor: row.isBlack ? 'action.selected' : 'background.paper',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                  }}
                >
                  {row.label && (
                    <Typography
                      variant="caption"
                      sx={{ position: 'absolute', right: 4, top: 0, lineHeight: `${rowHeight(zoomV)}px`, fontSize: 9 }}
                    >
                      {row.label}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          </Box>

          <Box
            ref={gridRef}
            data-testid="piano-roll-grid"
            role="application"
            aria-label={`Piano roll grid. ${selectionSummaryLabel(selection)}.`}
            tabIndex={0}
            style={{ position: 'relative', width: gridWidth, height: totalHeight, flexShrink: 0 }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={handlePointerCancel}
            onDoubleClick={handleDoubleClick}
            sx={{ '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 } }}
          >
            {/* grid lines */}
            <GridLinesLayer lines={gridLines} height={kbHeight} />

            {/* loop-region shading */}
            {loopRect && (
              <Box
                data-testid="piano-roll-loop-region"
                style={{ position: 'absolute', left: loopRect.x, top: 0, width: loopRect.width, height: totalHeight }}
                sx={{ bgcolor: 'info.main', opacity: 0.12, pointerEvents: 'none' }}
              />
            )}

            {/* preview-fragment notes, rendered distinctly (dashed, warning color, non-interactive) */}
            {previewRects.map((r) => (
              <Box
                key={`preview-${r.id}`}
                data-testid={`pr-preview-${r.id}`}
                style={{ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height }}
                sx={{
                  border: '1px dashed',
                  borderColor: 'warning.main',
                  bgcolor: 'warning.main',
                  opacity: 0.25,
                  pointerEvents: 'none',
                }}
              />
            ))}

            {/* playback cursor (isolated: only this subscribes to positionTick) */}
            <PlaybackCursor store={store} ppq={ppq} zoomH={zoomH} height={kbHeight} />

            {/* notes (culled to the scroll viewport, spec §29) */}
            <NoteLayer noteRects={visibleNoteRects} selectedIds={selectedIds} selectionColor={muiTheme.palette.primary.main} />

            {/* voice-lane strip */}
            <Box
              data-testid="piano-roll-voice-lanes"
              style={{ position: 'absolute', left: 0, top: kbHeight, width: '100%', height: voiceStripHeight }}
            >
              {Array.from({ length: voiceCount }, (_, i) => (
                <Box
                  key={i}
                  data-testid={`voice-lane-${i}`}
                  style={{ position: 'absolute', left: 0, top: i * VOICE_LANE_ROW_HEIGHT, width: '100%', height: VOICE_LANE_ROW_HEIGHT }}
                  sx={{ borderTop: '1px dashed', borderColor: 'divider', bgcolor: i % 2 === 0 ? 'action.hover' : 'transparent' }}
                >
                  <Typography variant="caption" sx={{ pl: 0.5, opacity: 0.7 }}>
                    Voice {i + 1}
                  </Typography>
                </Box>
              ))}
            </Box>

            {/* velocity lane */}
            <Box
              data-testid="piano-roll-velocity-lane"
              style={{ position: 'absolute', left: 0, top: velocityTop, width: '100%', height: VELOCITY_LANE_HEIGHT }}
              sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.default' }}
            >
              {noteRects.map((r) => {
                const velocityFraction = Math.max(0, Math.min(127, r.velocity)) / 127;
                const barHeight = velocityFraction * VELOCITY_LANE_HEIGHT;
                return (
                  <Box
                    key={r.id}
                    data-testid={`pr-velocity-${r.id}`}
                    onPointerDown={handleVelocityPointerDown}
                    onPointerUp={(e) => handleVelocityPointerUp(e, r.id)}
                    onPointerCancel={handleVelocityPointerCancel}
                    onLostPointerCapture={handleVelocityPointerCancel}
                    style={{ position: 'absolute', left: r.x, top: 0, width: Math.max(6, Math.min(10, r.width)), height: VELOCITY_LANE_HEIGHT }}
                    sx={{ cursor: 'ns-resize', touchAction: 'none' }}
                  >
                    <Box
                      style={{ position: 'absolute', bottom: 0, left: 0, height: barHeight, width: '100%' }}
                      sx={{ bgcolor: trackColor(r.trackIndex), pointerEvents: 'none' }}
                    />
                  </Box>
                );
              })}
            </Box>

            {/* drag-box selection overlay */}
            {dragBox && (
              <Box
                data-testid="piano-roll-drag-box"
                style={{ position: 'absolute', left: dragBox.x, top: dragBox.y, width: dragBox.width, height: dragBox.height }}
                sx={{ border: '1px dashed', borderColor: 'primary.main', bgcolor: 'action.selected', pointerEvents: 'none' }}
              />
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
