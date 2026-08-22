/**
 * The interactive sheet-music editor (spec §7 + the canvas-notation-renderer
 * design): owns the `CanvasScoreRenderer` instance (kept in a React ref,
 * per spec §37.2 — never stored in Zustand), draws the visible window of
 * the score into a single viewport-pinned canvas over a full-height
 * interaction/spacer div, wires the caret-anchored click model (click,
 * shift-click, cmd-click range, measure gutter), drag-box selection with
 * edge autoscroll, and scrolls the active playback measure into view.
 *
 * There is no per-glyph DOM: ALL hit-testing is geometric, against the
 * drawn window's `idToBBox`/`measureIdToBBox` maps (`hit-test.ts`), which
 * works identically in jsdom (bboxes are computed from VexFlow's own
 * layout math, not the DOM) and real browsers. Drawing is the
 * virtualization: every scroll/resize frame re-renders exactly the
 * visible systems (O(visible)), so there is no visible-set state to
 * invalidate.
 *
 * `renderTheme` picks between `LIGHT_RENDER_THEME`/`DARK_RENDER_THEME`
 * (`render-theme.ts`) off `resolveColorScheme(themeMode)`.
 */
import { selectionSummaryCopy } from '@/i18n/lib-copy';
import { commandLabel } from '@/features/score-editor/command-labels';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type React from 'react';
import {
  CanvasScoreRenderer,
  playbackController,
  selectActiveTrackId,
  selectVisibleTrackIds,
} from '@sudobility/music_lib';
import type { BBox, CanvasRenderResult, RenderTheme } from '@sudobility/music_lib';
import { computeLayout, tickForPoint } from '@sudobility/music_lib';
import type { LayoutPlan } from '@sudobility/music_lib';
import { isNoteEvent } from '@sudobility/music_types';
import type { GenerateScoreRequest, Pitch, SoundingNote } from '@sudobility/music_types';
import {
  changePitchCommand,
  findEvent,
  relocateNotesCommand,
  selectionSummaryLabel,
  shiftDiatonic,
  ticksFor,
  ottavaScore,
  writtenScore,
} from '@sudobility/music_lib';
import { resolveColorScheme } from '@/app/theme';
import { GenerateTrackDialog } from '@/components/dialogs/GenerateTrackDialog';
import type { InstrumentChoice } from '@sudobility/music_lib';
import { collisionForEditMode, resolveDrop } from '@/features/score-editor/note-drag';
import type { DropTarget } from '@/features/score-editor/note-drag';
import { useAppStore } from '@sudobility/music_lib';
import {
  caretToBar,
  deleteSelected,
  insertNoteAtCaret,
  selectAll,
} from '@/features/score-editor/editing';
import { GoToBarDialog } from '@/features/score-editor/GoToBarDialog';
import { LyricEntryBar } from '@/features/score-editor/LyricEntryBar';
import { ScoreContextMenu } from '@/features/score-editor/ScoreContextMenu';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { useEditorShortcuts } from '@/features/score-editor/useEditorShortcuts';
import { useClipboardPrompts } from '@/features/score-editor/useClipboardPrompts';
import { ChoiceDialog } from '@/components/dialogs/ChoiceDialog';
import { EditorToolbar } from '@/features/score-editor/EditorToolbar';
import type { LayoutMode } from '@/features/score-editor/EditorToolbar';
import {
  boxFromPoints,
  eventIdAtPoint,
  eventIdsAtPoint,
  eventIdsInBox,
  measureIdAtPoint,
  pitchAtStavePoint,
  measureIndexAtGutterPoint,
  soundingPitchForDrawn,
} from '@/features/score-editor/hit-test';
import type { Point } from '@/features/score-editor/hit-test';
import { buildNoteColors } from '@/features/score-editor/note-colors';
import { DARK_RENDER_THEME, LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';
import { noteIdsInTickRange } from '@sudobility/music_lib';
import { autoscrollDelta } from '@/features/score-editor/autoscroll';
import { trackIdAtGutterPoint } from '@/features/score-editor/track-gutter';
import { scoreWithPitch, stepsForDrag } from '@sudobility/music_lib';
import { PlaybackCaret } from '@/features/score-editor/PlaybackCaret';

export type ScoreEditorViewProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /** Inspector visibility, forwarded to the toolbar, which owns the toggle. Optional so tests can render the view alone. */
  inspectorOpen?: boolean;
  onToggleInspector?: () => void;
  /** Opens the audio-transcription dialog, which `AppLayout` owns. */
  /**
   * Submits a new-track generation as a background job. `AppLayout` owns the
   * job hook, the same one the Replace buttons use.
   */
  onGenerateTrackJob?: (request: GenerateScoreRequest) => Promise<void>;
};

const DEFAULT_WIDTH = 900;
const CONTAINER_MIN_HEIGHT = 400;
/** Pixels of pointer movement before a pointerdown-drag counts as a box-select rather than a plain click. */
const DRAG_THRESHOLD = 3;
/** The id of the measure `positionTick` currently falls in, read off the score's first track (every track shares the same measure grid — see `store/selectors.ts`'s `selectCurrentMeasureBeat`, same convention). */

export function ScoreEditorView({
  store = useAppStore,
  inspectorOpen,
  onToggleInspector,
  onGenerateTrackJob,
}: ScoreEditorViewProps) {
  const { t } = useTranslation();
  const clipboard = useClipboardPrompts(store);
  useEditorShortcuts(store, playbackController, clipboard);

  const score = store((s) => s.score);
  const selection = store((s) => s.selection);
  const zoom = store((s) => s.zoom);
  const themeMode = store((s) => s.themeMode);
  const pitchDisplay = store((s) => s.pitchDisplay);
  const editMode = store((s) => s.editMode);
  const snapGrid = store((s) => s.snapGrid);
  const selectionRegenerated = store((s) => s.selectionRegenerated);
  const activeTrackId = store(selectActiveTrackId);
  const visibleTrackIds = store(selectVisibleTrackIds);

  const [layoutMode, setLayoutMode] = useState<LayoutMode>('page');
  const [dragBox, setDragBox] = useState<BBox | null>(null);
  /**
   * The scroll box's measured client width — REACTIVE state, not an ad-hoc
   * `ref.current?.clientWidth` read. `layoutPlan` below (caret geometry,
   * click-to-seek, auto-scroll, spacer height) and `draw()` (the renderer's
   * own cached plan) must wrap systems at the SAME width: when this memo
   * read the ref directly it ran before first mount attached it, fell back
   * to DEFAULT_WIDTH, and never re-measured — the caret then traveled along
   * a 900px-wrapped layout while the canvas wrapped at the real width,
   * overshooting each drawn line's end before jumping to the next system.
   * `sizeCanvases` (mount effect + ResizeObserver) keeps this current.
   */
  const [viewWidth, setViewWidth] = useState(DEFAULT_WIDTH);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  /** The single viewport-sized drawing surface. There used to be a second, overlay canvas for selection/playback rectangles; notes carry their own color now, and the caret and drag box are DOM divs, so one canvas is enough. */
  const scoreCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CanvasScoreRenderer | null>(null);
  if (!rendererRef.current) rendererRef.current = new CanvasScoreRenderer();
  const resultRef = useRef<CanvasRenderResult | null>(null);
  const dragStateRef = useRef<{ start: Point; moved: boolean; additive: boolean } | null>(null);
  /**
   * A pitch drag in progress: the single selected note being dragged, its
   * pitch when the drag began, and how many staff positions the pointer has
   * moved it.
   *
   * `steps` is React state, not a ref, because the preview has to redraw when
   * it changes — but it only changes once per staff position crossed, roughly
   * ten times in a drag rather than sixty times a second, so rebuilding the
   * previewed score there is affordable in a way that doing it per pointermove
   * would not be (a new score identity invalidates the cached layout).
   */
  const pitchDragRef = useRef<{ eventId: string; pitch: Pitch; startY: number } | null>(null);
  const noteDragRef = useRef<{ anchorId: string; anchorTick: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [generateTrackOpen, setGenerateTrackOpen] = useState(false);
  const [generateTrackPending, setGenerateTrackPending] = useState(false);
  const [generateTrackError, setGenerateTrackError] = useState<string | null>(null);

  /**
   * Generates one track and appends it, matched to the score already open.
   *
   * The whole-score `generate` action replaces the score, which is the wrong
   * verb here — so this calls the provider directly and merges with
   * `appendTrackCommand`, which re-homes the result onto this score's grid and
   * makes the whole thing one undo step.
   */
  /**
   * Builds the request for a new track and hands it to the job runner.
   *
   * A **job**, not a direct call to the provider that this modal waits on.
   * Generating a track takes as long as any other generation, and the modal
   * held the user there for all of it — unable to look at another project, and
   * losing the work entirely if they navigated away. Replace Notes/Measures/
   * Track already went through the server-side runner for exactly that reason;
   * this is the same route, and the backend has always understood the
   * `generate-track` kind (it appends the result with `appendTrackCommand`).
   *
   * The dialog closes as soon as the job is accepted. What happens next is the
   * overlay, which covers the whole editing area and survives leaving and
   * coming back.
   */
  const generateTrack = useCallback(
    async (prompt: string, instrument: InstrumentChoice) => {
      const current = store.getState().score;
      if (!current || !onGenerateTrackJob) return;

      setGenerateTrackPending(true);
      setGenerateTrackError(null);
      try {
        const first = current.tracks[0];
        const { midiProgram, instrumentName, clef } = instrument;
        await onGenerateTrackJob({
          prompt,
          // Matched to the open score, or the new track will not line up
          // with the music it is meant to accompany.
          durationMeasures: first?.measures.length ?? 8,
          ...(first?.measures[0]
            ? {
                timeSignature: first.measures[0].timeSignature,
                keySignature: first.measures[0].keySignature,
              }
            : {}),
          ...(current.tempoMap[0] ? { tempo: current.tempoMap[0].bpm } : {}),
          tracks: [
            {
              name: instrumentName,
              instrumentName,
              midiProgram,
              // Chosen with the instrument, not derived from its program: a
              // drum kit is not a GM program, so the percussion clef is the
              // only thing that distinguishes it.
              clef,
            },
          ],
        });
        setGenerateTrackOpen(false);
      } catch (err) {
        setGenerateTrackError(err instanceof Error ? err.message : 'Generation failed');
      } finally {
        setGenerateTrackPending(false);
      }
    },
    [store, onGenerateTrackJob],
  );

  /**
   * The same value as `dropTarget`, for the pointer handlers to read.
   *
   * `handlePointerUp` is memoized on deps that deliberately exclude anything
   * changing per pointer-move, so reading the state there would capture
   * whatever it was when the handler was built — null. Same split as
   * `pitchDragRef` vs `pitchDragSteps`.
   */
  const dropTargetRef = useRef<DropTarget | null>(null);
  const setDropTargetBoth = useCallback((target: DropTarget | null) => {
    dropTargetRef.current = target;
    setDropTarget(target);
  }, []);
  const [pitchDragSteps, setPitchDragSteps] = useState(0);
  const suppressNextClickRef = useRef(false);
  /**
   * Throttling bookkeeping for `handleScroll`'s `requestAnimationFrame`-
   * scheduled `measureViewport` call: `scrollFrameScheduledRef` is the
   * actual "is one already pending" guard, set `true` *before*
   * `requestAnimationFrame` is called and back to `false` inside the
   * callback; `scrollRafIdRef` separately holds the frame id purely so
   * the unmount cleanup can `cancelAnimationFrame` it. These are
   * deliberately two separate refs rather than one "id, or null" ref:
   * a single ref set to the return value of `requestAnimationFrame`
   * *after* the call would be wrong if the callback itself could ever run
   * synchronously (which real browsers never do, but a test double or a
   * polyfill might) — the callback's own `= null` reset would run before
   * the post-call assignment, leaving the guard permanently "stuck"
   * scheduled. Keeping the guard's own write strictly before the
   * `requestAnimationFrame` call sidesteps that ordering hazard entirely.
   */
  const scrollFrameScheduledRef = useRef(false);
  const scrollRafIdRef = useRef<number | null>(null);
  /** Pending rAF for a colour-only repaint (see the repaint effect below). */
  const colorFrameRef = useRef<number | null>(null);
  /** Live rAF id for drag autoscroll, and the last pointer position in scroll-box coordinates. */
  const autoscrollRafRef = useRef<number | null>(null);
  const autoscrollPointRef = useRef<{ x: number; y: number } | null>(null);

  const renderTheme: RenderTheme = useMemo(
    () => (resolveColorScheme(themeMode) === 'dark' ? DARK_RENDER_THEME : LIGHT_RENDER_THEME),
    [themeMode],
  );

  /**
   * Per-note colors from the *low-frequency* inputs only.
   *
   * `activeNoteIds` is deliberately absent. It changes on every note-on and
   * note-off, and reading it here re-rendered this whole component twice per
   * note — measured at 16 renders against 8 note events in four seconds, which
   * cost the playback caret a frame each time and made it lurch at every note.
   * The sounding notes are merged in by the subscription below instead, which
   * repaints the canvas without going through React at all.
   *
   * The `regenerated` role survives the removal of candidate previews:
   * `selectionRegenerated` still marks material a generation just produced.
   */
  const noteColors = useMemo(
    () =>
      buildNoteColors({
        selectedIds: selection.eventIds,
        playingIds: [],
        regenerated: selectionRegenerated,
      }),
    [selection.eventIds, selectionRegenerated],
  );

  /**
   * The colours actually painted: `noteColors` with the sounding notes merged
   * over it.
   *
   * **Only the active track's sounding notes light up.** Every track's used to,
   * on the reasoning that a state colour marks a note as needing attention
   * wherever it is — which is right for selection, where cmd-shift-click spans
   * tracks deliberately. It is wrong for playback: on a large score the lit
   * notes then scatter across whichever parts happen to be sounding, which
   * reads as random rather than as a playhead, and the one track you are
   * actually reading goes dark whenever it rests. The keyboard already showed
   * the active track alone; this makes the notation agree with it.
   */
  const colorsWithPlaying = useCallback(
    (sounding: readonly SoundingNote[]) =>
      buildNoteColors({
        selectedIds: selection.eventIds,
        playingIds: sounding.filter((n) => n.trackId === activeTrackId).map((n) => n.noteId),
        regenerated: selectionRegenerated,
      }),
    [selection.eventIds, selectionRegenerated, activeTrackId],
  );

  const selectedMeasureIds = useMemo(() => new Set(selection.measureIds), [selection.measureIds]);

  // Mirrors of the two colour inputs, so `draw` can read the latest values
  // without taking them as dependencies (see the `draw` call site).
  const noteColorsRef = useRef(noteColors);
  noteColorsRef.current = noteColors;
  const selectedMeasureIdsRef = useRef(selectedMeasureIds);
  selectedMeasureIdsRef.current = selectedMeasureIds;

  /**
   * The score actually drawn.
   *
   * Memoized on `score` plus the pitch-drag and written-pitch state, so an
   * unrelated render (a selection-only change) does not rebuild it — a new
   * score identity invalidates `computeLayout`'s cache.
   */
  const displayScore = useMemo(() => {
    const previewed = score;
    // Live feedback for a pitch drag: the note is drawn where it would land, so
    // the reader aims at a staff position rather than guessing.
    const dragged =
      previewed && pitchDragRef.current && pitchDragSteps !== 0
        ? scoreWithPitch(
            previewed,
            pitchDragRef.current.eventId,
            shiftDiatonic(pitchDragRef.current.pitch, pitchDragSteps),
          )
        : previewed;

    // Written pitch goes on **last**, over everything above. The drag preview
    // splices in a *sounding* pitch (it comes from the stored score, so the
    // command it will dispatch is right), and transposing afterwards moves the
    // dragged note with the rest of the staff. Applying the lens first would
    // draw that one note an instrument's transposition too low.
    //
    // `writtenScore` returns its input object in concert mode and for a score
    // with nothing transposing, so `computeLayout`'s identity cache below is
    // untouched unless the lens is actually doing something.
    /*
      Octave brackets are a *display* instruction — the model stores sounding
      pitch, and an `8va` says the notes were written an octave lower to keep
      them on the stave. So the lens moves them there, and it applies in every
      mode: unlike an instrument's transposition, a bracket is part of the
      notation itself rather than a way of reading it.

      Before `writtenScore`, so a transposing instrument's bracket moves with
      the staff rather than against it. Both return their input unchanged when
      they have nothing to do, so the layout cache is untouched by a score with
      neither.
    */
    const bracketed = dragged ? ottavaScore(dragged) : dragged;
    if (!bracketed || pitchDisplay !== 'written') return bracketed;
    return writtenScore(bracketed);
  }, [score, pitchDragSteps, pitchDisplay]);

  /**
   * The current score's system/measure geometry (spec §26), memoized on
   * exactly the inputs that actually change it — deliberately *not* the
   * scroll viewport, so scrolling never recomputes layout (Task 17 review
   * finding: a naive `computeLayout` call inside the viewport-dependent
   * memo re-ran on every scroll frame). Both `measureViewport` (culling)
   * and the playback scroll-into-view effect read this same memoized plan,
   * instead of each computing their own. Built from `displayScore` (not
   * `score`) so a preview's spliced-in measures get real geometry too.
   */
  const layoutPlan = useMemo(() => {
    if (!displayScore) return null;
    return computeLayout(displayScore, {
      zoom,
      layoutMode,
      width: viewWidth,
      theme: renderTheme,
      // `computeLayout` already lays out a subset and already drops ids that
      // do not resolve, so hiding a track costs one option rather than a code
      // path. The track-info gutter follows for free, since it iterates the
      // plan. `visibleTrackIds` is a memoized selector, so it is
      // reference-stable and will not re-run this on unrelated store updates.
      trackIds: visibleTrackIds,
    });
  }, [displayScore, zoom, layoutMode, renderTheme, viewWidth, visibleTrackIds]);

  /**
   * Sizes both canvas backing stores to the scroll box's client size x the
   * devicePixelRatio (CSS size via style), so glyphs stay crisp on retina
   * displays at any zoom. Returns false when the box is unmeasurable
   * (jsdom's clientWidth/Height are 0 -- the DEFAULT_WIDTH /
   * CONTAINER_MIN_HEIGHT fallbacks keep tests deterministic).
   */
  const sizeCanvases = useCallback((): boolean => {
    const box = scrollBoxRef.current;
    if (!box) return false;
    const dpr = window.devicePixelRatio || 1;
    const w = box.clientWidth || DEFAULT_WIDTH;
    const h = box.clientHeight || CONTAINER_MIN_HEIGHT;
    setViewWidth(w); // keep layoutPlan wrapping at the width the canvas actually draws with

    const canvas = scoreCanvasRef.current;
    if (!canvas) return false;
    const bw = Math.max(1, Math.floor(w * dpr));
    const bh = Math.max(1, Math.floor(h * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    return true;
  }, []);

  /**
   * Draws the visible window of `displayScore` into the score canvas.
   * Drawing IS the virtualization now: each call
   * renders exactly the systems intersecting the live scroll position
   * (`CanvasScoreRenderer` is O(visible) per call and caches the
   * full-score layout, so a viewport change never recomputes layout) --
   * there is no visible-set state machine to keep in sync; the scroll
   * handler and ResizeObserver simply call this again. `displayScore`
   * (committed score, or committed+candidate while previewing) is what's
   * actually drawn, so the preview fragment's ids land in this result and
   * `previewIds` has something to highlight (spec S13 -- see
   * `displayScore`'s doc comment).
   */
  const draw = useCallback(() => {
    const box = scrollBoxRef.current;
    const ctx = scoreCanvasRef.current?.getContext('2d');
    if (!box || !ctx || !displayScore) return;
    // left/right window the draw horizontally — continuous mode is one giant
    // system, so without them every frame would draw the whole score (and
    // horizontal scrolling would show blank canvas past the first window).
    const viewport = {
      top: box.scrollTop / zoom,
      bottom: (box.scrollTop + (box.clientHeight || CONTAINER_MIN_HEIGHT)) / zoom,
      left: box.scrollLeft / zoom,
      right: (box.scrollLeft + (box.clientWidth || DEFAULT_WIDTH)) / zoom,
    };
    resultRef.current = rendererRef.current!.render(displayScore, ctx, {
      zoom,
      layoutMode,
      // Same width as `layoutPlan` (see `viewWidth`'s doc) — the caret and
      // the drawn systems must wrap lines at identical points.
      width: viewWidth,
      // And the same track list, for the same reason: the renderer computes
      // its own plan from these options, so leaving this out would draw every
      // track against geometry the caret was placed in without them.
      trackIds: visibleTrackIds,
      theme: renderTheme,
      viewport,
      devicePixelRatio: window.devicePixelRatio || 1,
      // Read through refs, not closed over: colours change on every note
      // boundary, and a new `draw` identity on each would re-fire the mount
      // effect below instead of going through the coalesced path.
      noteColors: noteColorsRef.current,
      activeTrackId,
      selectedMeasureIds: selectedMeasureIdsRef.current,
    });
  }, [displayScore, zoom, layoutMode, renderTheme, viewWidth, activeTrackId, visibleTrackIds]);

  /**
   * Repaints after a colour change, coalesced to one draw per animation frame
   * and skipped entirely when nothing *visible* changed.
   *
   * Both guards matter. A redraw is not cheap: `CanvasScoreRenderer` caches
   * the layout plan but still rebuilds and re-formats every VexFlow object in
   * the window, measured at ~5ms. `activeNoteIds` fires on every note-on AND
   * note-off, so an unguarded redraw put tens of those per second on the same
   * thread Tone.js schedules from — which was audible as hesitation.
   *
   * - Coalescing caps it at one redraw per frame however many notes change.
   * - The visible-set check drops the rest: a note starting or ending outside
   *   the drawn window changes no pixel, and during a held chord nothing
   *   changes at all.
   */
  const paintedColorsRef = useRef<string>('');

  /**
   * Repaints for a colour change, coalesced to one draw per animation frame
   * and skipped when nothing *visible* changed.
   *
   * Takes the colour map as an argument rather than reading render state, so
   * the subscription below can drive it without a React render.
   */
  const repaintColors = useCallback(
    (colors: Map<string, unknown>) => {
      const result = resultRef.current;
      // Before the first draw there is no window to compare against; the mount
      // effect owns that paint.
      if (!result) return;

      let signature = '';
      for (const [id, role] of colors) {
        if (result.idToBBox.has(id)) signature += `${id}:${String(role)};`;
      }
      for (const id of selectedMeasureIdsRef.current) {
        if (result.measureIdToBBox.has(id)) signature += `m${id};`;
      }
      if (signature === paintedColorsRef.current) return;
      paintedColorsRef.current = signature;

      noteColorsRef.current = colors as typeof noteColorsRef.current;
      if (colorFrameRef.current !== null) return;
      colorFrameRef.current = requestAnimationFrame(() => {
        colorFrameRef.current = null;
        draw();
      });
    },
    [draw],
  );

  // Selection and measure changes are low-frequency, so they can ride the
  // normal render path.
  useEffect(() => {
    repaintColors(colorsWithPlaying(playbackController.bus.sounding));
  }, [noteColors, selectedMeasureIds, repaintColors, colorsWithPlaying]);

  /**
   * Sounding notes, straight off the store — never through React.
   *
   * This is the same rule the transport readouts and the caret follow:
   * `activeNoteIds` fires on every note-on and note-off, and rendering this
   * component for each one cost the caret a frame and made it lurch at every
   * note. Subscribing here keeps the repaint (1-5ms of canvas work) without
   * the re-render (the expensive part).
   */
  useEffect(
    () =>
      playbackController.bus.onSounding((notes) => {
        repaintColors(colorsWithPlaying(notes));
      }),
    [repaintColors, colorsWithPlaying],
  );

  const stopAutoscroll = useCallback(() => {
    if (autoscrollRafRef.current !== null) {
      cancelAnimationFrame(autoscrollRafRef.current);
      autoscrollRafRef.current = null;
    }
    autoscrollPointRef.current = null;
  }, []);

  /**
   * Runs while a drag-box selection is in flight: each frame, nudges the
   * scroll box if the pointer sits inside an edge band, so a selection can
   * extend past what's currently on screen.
   *
   * The scroll itself fires `onScroll` -> `draw()`, so the newly-exposed
   * window repaints with no extra wiring here, and the drag box keeps
   * extending correctly because `pointFromEvent` already tracks content
   * (not viewport) coordinates.
   */
  const stepAutoscroll = useCallback(() => {
    const box = scrollBoxRef.current;
    const point = autoscrollPointRef.current;
    if (!box || !point) {
      autoscrollRafRef.current = null;
      return;
    }
    const { dx, dy } = autoscrollDelta({
      x: point.x,
      y: point.y,
      box: {
        width: box.clientWidth || DEFAULT_WIDTH,
        height: box.clientHeight || CONTAINER_MIN_HEIGHT,
      },
      layoutMode,
    });
    if (dx !== 0) box.scrollLeft += dx;
    if (dy !== 0) box.scrollTop += dy;
    autoscrollRafRef.current = requestAnimationFrame(stepAutoscroll);
  }, [layoutMode]);

  /** `onScroll` handler: throttles `draw` to at most once per animation frame; trailing-edge, so a burst of scroll events collapses into one redraw at the frame's final position. */
  const handleScroll = useCallback(() => {
    if (scrollFrameScheduledRef.current) return;
    scrollFrameScheduledRef.current = true;
    scrollRafIdRef.current = requestAnimationFrame(() => {
      scrollFrameScheduledRef.current = false;
      scrollRafIdRef.current = null;
      draw();
    });
  }, [draw]);

  useEffect(() => {
    return () => {
      if (scrollRafIdRef.current !== null) {
        cancelAnimationFrame(scrollRafIdRef.current);
        scrollRafIdRef.current = null;
      }
      scrollFrameScheduledRef.current = false;
      if (autoscrollRafRef.current !== null) {
        cancelAnimationFrame(autoscrollRafRef.current);
        autoscrollRafRef.current = null;
      }
      autoscrollPointRef.current = null;
      if (colorFrameRef.current !== null) {
        cancelAnimationFrame(colorFrameRef.current);
        colorFrameRef.current = null;
      }
    };
  }, []);

  // Full draw on score/zoom/layoutMode/theme changes -- sizing first, so
  // the first draw after mount (or a layout settle) has real backing stores.
  useEffect(() => {
    sizeCanvases();
    draw();
  }, [sizeCanvases, draw]);

  /**
   * Container-size-driven redraw (successor of the refresh-render fix):
   * when the scroll box settles to its real size after an async project
   * load -- or the window/panels resize -- re-size the backing stores and
   * redraw the (now different) visible window. Guarded for jsdom, where
   * ResizeObserver doesn't exist.
   */
  useEffect(() => {
    const el = scrollBoxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      sizeCanvases();
      draw();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [sizeCanvases, draw]);

  // A selection/playback/preview change now redraws notation, because the
  // color lives on the glyphs themselves. That is cheap and deliberate:
  // `computeLayout` is cached and NOT invalidated by a color change, so a
  // redraw is just the visible window — the same work a scroll frame already
  // does at 60fps. `activeNoteIds` also changes only on note boundaries, not
  // per frame; the 30Hz `positionTick` moves the caret div, not the canvas.
  //
  // (The dedicated `draw` effect above already depends on `noteColors` /
  // `activeTrackId` / `selectedMeasureIds`, so no separate effect is needed.)

  useEffect(() => {
    const renderer = rendererRef.current;
    return () => {
      renderer?.dispose();
    };
  }, []);

  /**
   * Dev/e2e-only introspection handle: with no per-glyph DOM left to
   * query, Playwright resolves note/measure ids to click coordinates
   * through the live render result's bbox maps (e2e/helpers.ts). Gated so
   * production builds ship nothing; getters keep the handle live without
   * re-registering per render.
   */
  useEffect(() => {
    if (!import.meta.env.DEV && import.meta.env.VITE_E2E !== '1') return;
    const handle = {
      get result() {
        return resultRef.current;
      },
      get scrollBox() {
        return scrollBoxRef.current;
      },
    };
    const w = window as unknown as Record<string, unknown>;
    w.__scoresmith = handle;
    return () => {
      if (w.__scoresmith === handle) delete w.__scoresmith;
    };
  }, []);

  /**
   * Click-to-seek: moves the playback position (and so the caret and the
   * transport's position scrubber, both driven by the same store
   * `positionTick` the engine reports back through `seek`) to the tick
   * under a canvas click. Clicking left of a system's first measure (the
   * clef/key area) clamps to that system's start; clicks in the dead space
   * between systems are ignored (`tickForPoint` returns null).
   */
  const seekToEventPoint = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || !layoutPlan || !displayScore) return;
      const rect = container.getBoundingClientRect();
      const x = (event.clientX - rect.left) / zoom;
      const y = (event.clientY - rect.top) / zoom;
      const tick = tickForPoint(layoutPlan, displayScore, x, y);
      if (tick !== null) playbackController.seek(tick);
    },
    [layoutPlan, displayScore, zoom],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }

      // While a regeneration candidate is being previewed (spec §13),
      // `displayScore` (and so this click's `result`) is the committed
      // score with the candidate spliced in — clicking anywhere in the
      // canvas must not dispatch a selection/edit against ids that may not
      // even exist in the committed score (the fragment's own fresh ids
      // never do), and seeking the main transport would fight the preview
      // playback that currently owns the engine. Simplest safe rule:
      // ignore canvas clicks entirely while previewing;
      // accepting/rejecting/switching candidates is done from the
      // generation panel, not by clicking the notation.
      // Geometric hit-testing (canvas has no per-glyph DOM): everything below
      // resolves the click point in content coordinates against the drawn
      // window's bbox maps and the layout plan.
      const container = containerRef.current;
      const result = resultRef.current;
      const state = store.getState();
      if (!container || !state.score) return;
      const rect = container.getBoundingClientRect();
      const point: Point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const logical = { x: point.x / zoom, y: point.y / zoom };
      const rangeModifier = event.metaKey || event.ctrlKey;

      // ---- track gutter: left of everything else, so it wins first.
      //
      // Viewport coordinates, not the content-space `point` above: the gutter is
      // pinned to the viewport's left edge, so a content-space hit region would
      // only be right at scroll position zero.
      const scrollBox = scrollBoxRef.current;
      if (layoutPlan && scrollBox) {
        const boxRect = scrollBox.getBoundingClientRect();
        const trackId = trackIdAtGutterPoint(layoutPlan, zoom, scrollBox.scrollTop, {
          x: event.clientX - boxRect.left,
          y: event.clientY - boxRect.top,
        });
        if (trackId) {
          // Not a timeline position, so the caret stays put.
          state.setActiveTrack(trackId);
          state.selectTrack(trackId);
          return;
        }
      }

      // ---- measure gutter: the one gesture that still selects measures,
      // which is what keeps regeneration's "select bars 3-4" workflow alive
      // now that a stave click sets the caret. Never moves the caret.
      if (layoutPlan) {
        const gutterIndex = measureIndexAtGutterPoint(layoutPlan, logical);
        if (gutterIndex !== null) {
          const tracks =
            rangeModifier && event.shiftKey
              ? state.score.tracks
              : state.score.tracks.filter((t) => t.id === activeTrackId);

          /*
            Shift extends from the bar clicked last, so "bars 3 to 12" is two
            clicks rather than ten. Regeneration and Replace Measures both work
            on a span, and picking one out was the slowest part of using them.

            The anchor is the *first* bar of the current selection, so
            extending twice from the same anchor grows and shrinks the range
            rather than walking it — the behaviour of every list that does
            this.
          */
          const anchorIndex = event.shiftKey && !rangeModifier ? measureAnchorRef.current : null;
          const from = anchorIndex === null ? gutterIndex : Math.min(anchorIndex, gutterIndex);
          const to = anchorIndex === null ? gutterIndex : Math.max(anchorIndex, gutterIndex);

          const measureIds = tracks.flatMap((t) => t.measures.slice(from, to + 1).map((m) => m.id));
          if (measureIds.length > 0) {
            state.selectMeasures(measureIds);
            if (anchorIndex === null) measureAnchorRef.current = gutterIndex;
          }
          return;
        }
      }

      // ---- cmd-click: select from the caret to here. Deliberately does NOT
      // move the caret, so the same anchor can be extended repeatedly.
      if (rangeModifier) {
        if (!layoutPlan || !displayScore) return;
        const clickedTick = tickForPoint(layoutPlan, displayScore, logical.x, logical.y);
        if (clickedTick === null) return;

        const scopeTrackIds = event.shiftKey
          ? state.score.tracks.map((t) => t.id)
          : activeTrackId
            ? [activeTrackId]
            : [];
        state.setSelection({
          eventIds: noteIdsInTickRange(state.score, state.caretTick, clickedTick, scopeTrackIds),
          measureIds: [],
          trackIds: [],
          // The explicit range matters: regenerating a span of empty measures
          // must still work, and `selectionToRange` can't derive a span from
          // an empty eventIds list.
          range: {
            startTick: Math.min(state.caretTick, clickedTick),
            endTick: Math.max(state.caretTick, clickedTick),
            trackIds: scopeTrackIds,
          },
        });
        return;
      }

      // ---- click on a note.
      const noteId = result ? eventIdAtPoint(result.idToBBox, point) : null;
      if (noteId) {
        // Shift-click stays a pure additive toggle, exactly as before: it
        // composes fine with cmd-click range (different modifier) and it is
        // the only way to build a non-contiguous selection, so the caret
        // rework has no reason to take it away. Deliberately does NOT move
        // the caret or the active track — yanking the playhead on every
        // toggle while assembling a selection would be hostile.
        if (event.shiftKey) {
          state.toggleEvent(noteId);
          return;
        }
        // Plain click: caret to the note's start, select the whole chord.
        //
        // The whole chord, not one arbitrary member: every note in a chord
        // shares one bounding box, so "which note did you click" is not a
        // question the geometry can answer. Adding and removing individual
        // notes is the piano keyboard's job.
        const note = findEvent(state.score, noteId);
        const chordIds = result ? eventIdsAtPoint(result.idToBBox, point) : [];
        state.setSelection({
          eventIds: chordIds.length > 0 ? chordIds : [noteId],
          measureIds: [],
          trackIds: [],
        });
        if (note) {
          state.setActiveTrack(note.trackId);
          playbackController.seek(note.startTick);
        }
        return;
      }

      // ---- note input: a click on a stave writes a note there.
      //
      // Only in the mode, because the caret is how everything else is aimed and
      // the two gestures cannot share a click. Placed by going through the
      // caret — seek, then insert at it — so target resolution, the edit lock
      // and the caret advance are the same code the toolbar and the piano
      // keyboard already use.
      if (state.noteInput && layoutPlan && displayScore && !rangeModifier) {
        const hit = pitchAtStavePoint(layoutPlan, state.score, logical);
        const clickedTick = tickForPoint(layoutPlan, displayScore, logical.x, logical.y);
        if (hit && clickedTick !== null) {
          state.setActiveTrack(hit.trackId);
          state.clearSelection();
          playbackController.seek(clickedTick);
          // `hit.pitch` is what is *drawn* there, and the drawing has been
          // through the display lenses. Storing it raw wrote a note an octave
          // out inside an `8va`, and a transposition out on a written-pitch
          // part — silently, since the note then drew exactly where it was
          // clicked and only sounded wrong.
          insertNoteAtCaret(
            store,
            soundingPitchForDrawn(state.score, hit.trackId, clickedTick, hit.pitch, pitchDisplay),
            { advanceCaret: true },
          );
          return;
        }
      }

      // ---- plain click anywhere else inside a system: caret + active track.
      // The selection is cleared so the caret becomes the anchor for the next
      // cmd-click range.
      const measureId = result ? measureIdAtPoint(result.measureIdToBBox, point) : null;
      if (measureId) {
        const owner = state.score.tracks.find((t) => t.measures.some((m) => m.id === measureId));
        if (owner) state.setActiveTrack(owner.id);
      }
      state.clearSelection();
      seekToEventPoint(event);
    },
    [store, seekToEventPoint, layoutPlan, displayScore, zoom, activeTrackId, pitchDisplay],
  );

  /**
   * Where a right-click opened the context menu, in viewport coordinates.
   * `null` when it is closed.
   */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [goToBarOpen, setGoToBarOpen] = useState(false);
  /**
   * The bar a shift-extended measure selection grows from.
   *
   * A ref rather than state: it is read inside the click handler and changing
   * it must never re-render, which reading it from state would cause on every
   * gutter click.
   */
  const measureAnchorRef = useRef<number | null>(null);
  /**
   * Lyric entry walks the *active track's* notes in tick order, starting at
   * the one nearest the caret — so "start writing words here" means what it
   * looks like.
   */
  const [lyricStart, setLyricStart] = useState<number | null>(null);

  const lyricNotes = useMemo(() => {
    if (!score || !activeTrackId) return [];
    const track = score.tracks.find((t) => t.id === activeTrackId);
    if (!track) return [];
    return track.measures
      .flatMap((m) => m.voices.flatMap((v) => v.events))
      .filter(isNoteEvent)
      .sort((a, b) => a.startTick - b.startTick);
  }, [score, activeTrackId]);

  const beginLyricEntry = useCallback(() => {
    if (lyricNotes.length === 0) return;
    const caret = store.getState().caretTick;
    const at = lyricNotes.findIndex((n) => n.startTick >= caret);
    setLyricStart(at === -1 ? 0 : at);
  }, [lyricNotes, store]);

  const handleContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const pointFromEvent = useCallback((event: React.PointerEvent<HTMLDivElement>): Point | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return {
      x: event.clientX - rect.left + container.scrollLeft,
      y: event.clientY - rect.top + container.scrollTop,
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      // Every left press starts drag-tracking (no per-glyph DOM to exclude
      // any more): a press that never crosses DRAG_THRESHOLD stays a plain
      // click (handleClick runs; `suppressNextClickRef` is only set for
      // real drags), so note/measure clicks behave exactly as before.
      const point = pointFromEvent(event);
      if (!point) return;

      // Exactly one note selected, and the press landed on it: this is a pitch
      // drag, not a selection box. Requiring the note to be selected first is
      // what keeps an ordinary click-and-drag on the staff a box select.
      const state = store.getState();
      const result = resultRef.current;

      // Option/Alt starts a move. Checked before the pitch-drag branch,
      // because the same press on the same note would otherwise start a pitch
      // drag — the modifier is the whole disambiguation.
      if (event.altKey && result) {
        const hitId = eventIdAtPoint(result.idToBBox, point);
        const hitEvent = hitId && state.score ? findEvent(state.score, hitId) : null;
        if (hitId && hitEvent && isNoteEvent(hitEvent)) {
          // Works on any note: an explicit modifier leaves no ambiguity with
          // box select, so requiring a prior selection would be friction for
          // nothing.
          if (!state.selection.eventIds.includes(hitId)) {
            store.getState().setSelection({ eventIds: [hitId], measureIds: [], trackIds: [] });
          }
          noteDragRef.current = { anchorId: hitId, anchorTick: hitEvent.startTick };
          setDropTargetBoth(null);
          containerRef.current?.setPointerCapture?.(event.pointerId);
          return;
        }
      }

      const onlySelected =
        state.selection.eventIds.length === 1 ? state.selection.eventIds[0] : null;
      if (onlySelected && result) {
        const hit = eventIdAtPoint(result.idToBBox, point);
        const hitEvent = state.score ? findEvent(state.score, onlySelected) : null;
        // A rest has no pitch to drag.
        if (hit === onlySelected && hitEvent && isNoteEvent(hitEvent)) {
          pitchDragRef.current = { eventId: onlySelected, pitch: hitEvent.pitch, startY: point.y };
          setPitchDragSteps(0);
          containerRef.current?.setPointerCapture?.(event.pointerId);
          return;
        }
      }

      dragStateRef.current = { start: point, moved: false, additive: event.shiftKey };
      containerRef.current?.setPointerCapture?.(event.pointerId);
    },
    // Deps are narrow on purpose: anything read in here that changes per frame
    // goes through a ref (`pitchDragRef`, `dropTargetRef`). Listing the rule's
    // suggestions captures a stale value instead — that shipped as a bug once,
    // and only the e2e caught it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pointFromEvent, setDropTargetBoth],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const noteDrag = noteDragRef.current;
      if (noteDrag) {
        const point = pointFromEvent(event);
        const currentScore = store.getState().score;
        if (!point || !layoutPlan || !currentScore) return;
        // Recomputed per move but only re-renders the indicator when the
        // resolved track or tick actually changes; it never touches the score,
        // so nothing relayouts.
        setDropTargetBoth(
          resolveDrop(
            layoutPlan,
            currentScore,
            noteDrag,
            point,
            ticksFor(snapGrid, currentScore.ppq),
          ),
        );
        return;
      }

      const pitchDrag = pitchDragRef.current;
      if (pitchDrag) {
        const point = pointFromEvent(event);
        if (!point) return;
        // Only re-renders when the step count actually changes -- about ten
        // times in a drag, not once per pointermove.
        setPitchDragSteps(stepsForDrag(point.y - pitchDrag.startY, zoom));
        return;
      }

      const drag = dragStateRef.current;
      if (!drag) return;
      const point = pointFromEvent(event);
      if (!point) return;
      if (!drag.moved) {
        const dx = Math.abs(point.x - drag.start.x);
        const dy = Math.abs(point.y - drag.start.y);
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) drag.moved = true;
      }
      if (!drag.moved) return;
      setDragBox(boxFromPoints(drag.start, point));

      const box = scrollBoxRef.current;
      if (!box) return;
      const boxRect = box.getBoundingClientRect();
      autoscrollPointRef.current = {
        x: event.clientX - boxRect.left,
        y: event.clientY - boxRect.top,
      };
      if (autoscrollRafRef.current === null) {
        autoscrollRafRef.current = requestAnimationFrame(stepAutoscroll);
      }
    },
    // Deps are narrow on purpose: anything read in here that changes per frame
    // goes through a ref (`pitchDragRef`, `dropTargetRef`). Listing the rule's
    // suggestions captures a stale value instead — that shipped as a bug once,
    // and only the e2e caught it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pointFromEvent, stepAutoscroll, layoutPlan, snapGrid, setDropTargetBoth],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const noteDrag = noteDragRef.current;
      if (noteDrag) {
        containerRef.current?.releasePointerCapture?.(event.pointerId);
        noteDragRef.current = null;
        const target = dropTargetRef.current;
        setDropTargetBoth(null);

        const state = store.getState();
        const anchor = state.score ? findEvent(state.score, noteDrag.anchorId) : null;
        const fromTrackId = anchor && isNoteEvent(anchor) ? anchor.trackId : null;
        const ids = state.selection.eventIds;
        // A drop that changes neither track nor tick is not worth an undo entry.
        const changed =
          target !== null && (target.deltaTicks !== 0 || target.trackId !== fromTrackId);

        if (target && changed && ids.length > 0) {
          suppressNextClickRef.current = true;
          // One command for the whole gesture, so undo restores both the
          // source and the destination in a single step.
          store.getState().dispatchCommand(
            relocateNotesCommand(
              [...ids],
              {
                targetTrackId: target.trackId,
                deltaTicks: target.deltaTicks,
                collision: collisionForEditMode(editMode),
              },
              commandLabel('relocateNotes'),
            ),
          );
        }
        return;
      }

      const pitchDrag = pitchDragRef.current;
      if (pitchDrag) {
        containerRef.current?.releasePointerCapture?.(event.pointerId);
        const steps = pitchDragSteps;
        pitchDragRef.current = null;
        setPitchDragSteps(0);
        if (steps !== 0) {
          // One command for the whole gesture, so undo restores the pitch the
          // note had before the drag rather than stepping back through it.
          suppressNextClickRef.current = true;
          store
            .getState()
            .dispatchCommand(
              changePitchCommand(
                [pitchDrag.eventId],
                shiftDiatonic(pitchDrag.pitch, steps),
                commandLabel('changePitch'),
              ),
            );
        }
        return;
      }

      const drag = dragStateRef.current;
      if (!drag) return;
      stopAutoscroll();
      containerRef.current?.releasePointerCapture?.(event.pointerId);

      if (drag.moved) {
        suppressNextClickRef.current = true;
        const point = pointFromEvent(event) ?? drag.start;
        const box = boxFromPoints(drag.start, point);
        const result = resultRef.current;
        if (result) {
          const hitIds = eventIdsInBox(result.idToBBox, box);
          const state = store.getState();
          const nextIds = drag.additive
            ? Array.from(new Set([...state.selection.eventIds, ...hitIds]))
            : hitIds;
          state.setSelection({ eventIds: nextIds, measureIds: [], trackIds: [] });
        }
      }

      setDragBox(null);
      dragStateRef.current = null;
    },
    [pointFromEvent, store, stopAutoscroll, pitchDragSteps, editMode, setDropTargetBoth],
  );

  /**
   * A cancelled pointer (touch takeover, alt-tab, the browser stealing
   * capture) must not leave the autoscroll loop running against a stale
   * pointer position — that would scroll forever with no way to stop it.
   * Drops the drag without committing any selection.
   */
  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      stopAutoscroll();
      containerRef.current?.releasePointerCapture?.(event.pointerId);
      setDragBox(null);
      dragStateRef.current = null;
    },
    [stopAutoscroll],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChoiceDialog
        open={clipboard.pendingCut}
        title={t('editor.cutTitle')}
        message={t('editor.cutMessage')}
        choices={[
          {
            value: 'silence' as const,
            label: t('editor.leaveSilence'),
            detail: 'The rest of the track stays where it is',
            primary: true,
          },
          {
            value: 'close' as const,
            label: t('editor.closeGap'),
            detail: 'Later notes on this track move earlier to fill it',
          },
        ]}
        onChoose={clipboard.resolveCut}
        onCancel={clipboard.cancel}
      />
      <ChoiceDialog
        open={clipboard.pendingPaste}
        title={t('editor.pasteTitle')}
        message={t('editor.pasteMessage')}
        choices={[
          {
            value: 'replace' as const,
            label: t('replace.action'),
            detail: 'What is there now is removed',
            primary: true,
          },
          {
            value: 'insert' as const,
            label: t('editor.insert'),
            detail: 'What is there now moves later on this track',
          },
        ]}
        onChoose={clipboard.resolvePaste}
        onCancel={clipboard.cancel}
      />
      {contextMenu ? (
        <ScoreContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          hasSelection={selection.eventIds.length > 0}
          hasClipboard={store.getState().clipboard !== null}
          canEdit={store.getState().state !== 'playing'}
          onClose={() => setContextMenu(null)}
          onAction={(action) => {
            const state = store.getState();
            if (action === 'copy') state.copySelection();
            else if (action === 'cut') clipboard.requestCut();
            else if (action === 'paste') clipboard.requestPaste();
            else if (action === 'delete') deleteSelected(store);
            else selectAll(store);
          }}
        />
      ) : null}
      {lyricStart !== null ? (
        <LyricEntryBar
          store={store}
          notes={lyricNotes}
          startIndex={lyricStart}
          onClose={() => setLyricStart(null)}
        />
      ) : null}
      <GoToBarDialog
        open={goToBarOpen}
        barCount={score?.tracks[0]?.measures.length ?? 0}
        onClose={() => setGoToBarOpen(false)}
        onGo={(bar) => caretToBar(store, bar)}
      />
      <EditorToolbar
        store={store}
        onEnterLyrics={beginLyricEntry}
        onGoToBar={() => setGoToBarOpen(true)}
        onCut={clipboard.requestCut}
        onPaste={clipboard.requestPaste}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        inspectorOpen={inspectorOpen}
        onToggleInspector={onToggleInspector}
        onGenerateTrack={() => {
          setGenerateTrackError(null);
          setGenerateTrackOpen(true);
        }}
      />

      <GenerateTrackDialog
        open={generateTrackOpen}
        pending={generateTrackPending}
        error={generateTrackError}
        onGenerate={(prompt, instrument) => void generateTrack(prompt, instrument)}
        onClose={() => setGenerateTrackOpen(false)}
      />
      <div
        ref={scrollBoxRef}
        data-testid="score-editor-scroll"
        onScroll={handleScroll}
        // No min-height: this box lives in a height-bounded flex column
        // (notation, then the keyboard panel, then the transport), and a
        // hard 400px floor made it overflow its row once the piano roll took
        // its 280px — the roll then painted on top of the notation and
        // swallowed its clicks. CONTAINER_MIN_HEIGHT survives only as the
        // canvas-sizing fallback for jsdom, where clientHeight is 0.
        // Page mode wraps every system to the viewport, so there is nothing to
        // its right to reach: `overflow-x-hidden` keeps a stray pixel of
        // rounding from producing a scrollbar that would only ever slide the
        // sheet under the pinned gutter. Continuous mode is one wide system and
        // scrolls horizontally by definition.
        className={`relative min-h-0 flex-1 overscroll-contain ${
          layoutMode === 'continuous' ? 'overflow-auto' : 'overflow-y-auto overflow-x-hidden'
        }`}
      >
        {/* Interaction surface doubling as the scroll spacer: spans the full
            content size (so the scroll box gets both scrollbars), is
            transparent, and receives all pointer events in document-content
            coordinates — exactly the role the SVG container played. Keeps
            its testid + aria contract. It also HOSTS the sticky canvas
            wrapper: a sticky element can only stick within its containing
            block, so `left-0` sticking (continuous mode's horizontal
            scrolling) requires a parent that spans the full scrollable
            width — this div — not the viewport-wide scroll box. */}
        <div
          ref={containerRef}
          data-testid="score-editor-canvas"
          role="application"
          aria-label={t('editor.scoreNotation', {
            summary: selectionSummaryLabel(selection, selectionSummaryCopy(), selectionRegenerated),
          })}
          tabIndex={0}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          className="relative w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          style={{
            height: Math.max((layoutPlan?.totalHeight ?? 0) * zoom, CONTAINER_MIN_HEIGHT),
            // Horizontal scroll extent: continuous mode's single system is
            // (much) wider than the viewport — the spacer must span it so
            // the scroll box scrolls horizontally (trackpad swipe included).
            // Page mode lays out to exactly the viewport width, so asking for
            // it here would only risk a sub-pixel overflow.
            minWidth:
              layoutMode === 'continuous' ? (layoutPlan?.totalWidth ?? 0) * zoom : undefined,
          }}
        >
          {/* Viewport-pinned drawing surface: a ZERO-SIZED sticky anchor
              (first child, so its static position is the content origin)
              that pins to the scrollport's top-left corner in BOTH axes;
              the canvas hangs off it via overflow. `pointer-events-none`
              keeps every click landing on the interaction div itself. */}
          <div
            className="pointer-events-none sticky left-0 top-0 z-0 h-0 w-0 overflow-visible"
            aria-hidden="true"
          >
            <canvas ref={scoreCanvasRef} data-testid="score-canvas" />
          </div>
        </div>
        {dragBox && (
          <div
            data-testid="drag-selection-box"
            style={{
              left: dragBox.x,
              top: dragBox.y,
              width: dragBox.width,
              height: dragBox.height,
            }}
            className="pointer-events-none absolute border border-dashed border-primary bg-theme-hover-bg"
          />
        )}
        {dropTarget && layoutPlan && (
          <DropIndicator plan={layoutPlan} target={dropTarget} zoom={zoom} />
        )}
        <PlaybackCaret
          store={store}
          plan={layoutPlan}
          score={displayScore}
          zoom={zoom}
          color={renderTheme.caret}
          layoutMode={layoutMode}
          scrollBoxRef={scrollBoxRef}
        />
      </div>
    </div>
  );
}

/**
 * Where an Option+drag would land: the target stave tinted.
 *
 * Deliberately not a preview of the notes themselves. Splicing notes into
 * another track's measures changes those measures' contents and forces a full
 * relayout — the per-frame cost the playback work exists to avoid. This draws
 * from geometry the plan already has, and never touches the score.
 */
function DropIndicator({
  plan,
  target,
  zoom,
}: {
  plan: LayoutPlan;
  target: DropTarget;
  zoom: number;
}) {
  const trackLayout = plan.trackLayouts.find((t) => t.track.id === target.trackId);
  const box = trackLayout?.measures[0]?.box;
  if (!box) return null;

  return (
    <div
      data-testid="drop-indicator"
      aria-hidden
      className="pointer-events-none absolute bg-sky-400/20 ring-1 ring-sky-500"
      style={{
        left: box.x * zoom,
        top: box.y * zoom,
        width: box.width * zoom,
        height: box.height * zoom,
      }}
    />
  );
}
