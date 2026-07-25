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
 * with measure/beat lines, a playback cursor, loop-region shading,
 * preview-fragment notes, a below-the-grid "voice lane" strip (see
 * `interactions.ts`'s `commitVoiceChange` doc comment for why dropping a
 * note there reassigns its voice rather than its track), and a velocity
 * lane at the bottom with one draggable bar per note.
 *
 * Pointer interactions follow the score editor's click/shift-click/
 * drag-box precedent (Task 12's `ScoreEditorView`): one pointerdown/move/up
 * cycle on the grid container, hit-tested via `geometry.ts`, distinguishes
 * a plain click (select) from a real drag (move/resize/box-select) by a
 * pixel threshold, and commits at most one command on pointerup. Unlike
 * the VexFlow-rendered notation view, note positions here come straight
 * from `geometry.ts`'s own tick/pitch math (not a real SVG layout engine),
 * so — as documented in `geometry.ts` — these interactions are exercised
 * end-to-end in jsdom with real coordinates, no mocked bboxes needed.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { findEvent } from '@/domain/score/queries';
import { isNoteEvent } from '@/domain/score/types';
import type { UUID } from '@/domain/score/types';
import { pitchToMidi } from '@/domain/pitch/pitch';
import { ticksFor } from '@/domain/time/ticks';
import { useAppStore } from '@/store/useAppStore';
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
  eventIdAtPoint,
  eventIdsInBox,
  isNearRightEdge,
  keyboardHeightPx,
  rowHeight,
  snapTick,
  tickToX,
  totalCanvasHeight,
  trackColor,
  trackWidthPx,
  voiceLaneStripHeight,
  xToTick,
  yToMidi,
} from '@/features/piano-roll/geometry';
import type { NoteRect, Point } from '@/features/piano-roll/geometry';
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

export type PianoRollViewProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
};

const CONTAINER_MIN_HEIGHT = 400;
/** Pixels of pointer movement before a pointerdown-drag counts as a real drag rather than a plain click. */
const DRAG_THRESHOLD = 3;

type NoteOrigin = { startTick: number; durationTicks: number; midi: number };

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

export function PianoRollView({ store = useAppStore }: PianoRollViewProps) {
  const muiTheme = useTheme();

  const score = store((s) => s.score);
  const selection = store((s) => s.selection);
  const positionTick = store((s) => s.positionTick);
  const loopRange = store((s) => s.loopRange);
  const previewFragment = store((s) => s.previewFragment);

  const [zoomH, setZoomH] = useState(1);
  const [zoomV, setZoomV] = useState(1);
  const [visibleTrackIds, setVisibleTrackIds] = useState<Set<UUID> | null>(null);
  const [dragBox, setDragBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  const ppq = score?.ppq ?? 480;
  const referenceTrack = score?.tracks[0] ?? null;

  const noteRects = useMemo<NoteRect[]>(
    () => (score ? computeNoteRects(score, { visibleTrackIds, zoomH, zoomV }) : []),
    [score, visibleTrackIds, zoomH, zoomV],
  );
  const noteRectsById = useMemo(() => new Map(noteRects.map((r) => [r.id, r])), [noteRects]);
  const selectedIds = useMemo(() => new Set(selection.eventIds), [selection.eventIds]);

  const previewRects = useMemo(
    () => computePreviewNoteRects(previewFragment, { zoomH, zoomV }),
    [previewFragment, zoomH, zoomV],
  );

  const gridLines = useMemo(
    () => (referenceTrack ? computeGridLines(referenceTrack, ppq, zoomH) : []),
    [referenceTrack, ppq, zoomH],
  );
  const gridWidth = referenceTrack ? trackWidthPx(referenceTrack, ppq, zoomH) : 0;

  const voiceCount = score ? maxVoiceCount(score, visibleTrackIds) : 2;
  const kbHeight = keyboardHeightPx(zoomV);
  const voiceStripHeight = voiceLaneStripHeight(voiceCount);
  const velocityTop = kbHeight + voiceStripHeight;
  const totalHeight = totalCanvasHeight(zoomV, voiceCount);
  const keyboardRows = useMemo(() => computeKeyboardRows(zoomV), [zoomV]);

  const cursorX = tickToX(positionTick, ppq, zoomH);
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
              origins.set(id, { startTick: ev.startTick, durationTicks: ev.durationTicks, midi: pitchToMidi(ev.pitch) });
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
        dragStateRef.current = null;
        setDragBox(null);
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

      dragStateRef.current = null;
      setDragBox(null);
    },
    [store, noteRectsById, pointFromEvent, kbHeight, voiceStripHeight, ppq, zoomH, zoomV],
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
        role="region"
        aria-label="Piano roll"
        data-testid="piano-roll-scroll"
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
            role="group"
            aria-label="Piano roll grid"
            style={{ position: 'relative', width: gridWidth, height: totalHeight, flexShrink: 0 }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onDoubleClick={handleDoubleClick}
          >
            {/* grid lines */}
            {gridLines.map((line) => (
              <Box
                key={`${line.kind}-${line.tick}`}
                style={{ position: 'absolute', left: line.x, top: 0, width: line.kind === 'measure' ? 2 : 1, height: kbHeight }}
                sx={{ bgcolor: 'divider', opacity: line.kind === 'measure' ? 0.8 : 0.35 }}
              />
            ))}

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

            {/* playback cursor */}
            <Box
              data-testid="piano-roll-cursor"
              style={{ position: 'absolute', left: cursorX, top: 0, width: 2, height: kbHeight }}
              sx={{ bgcolor: 'success.main', pointerEvents: 'none' }}
            />

            {/* notes */}
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
                    border: selected ? `2px solid ${muiTheme.palette.primary.main}` : '1px solid rgba(0,0,0,0.35)',
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
