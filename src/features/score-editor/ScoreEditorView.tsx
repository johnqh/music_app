/**
 * The interactive sheet-music editor (spec §7 + the canvas-notation-renderer
 * design): draws the visible window of the score into a single
 * viewport-pinned canvas over a full-height interaction/spacer div, wires the
 * caret-anchored click model (click, shift-click, cmd-click range, measure
 * gutter), drag-box selection with edge autoscroll, and follows playback.
 *
 * **This view computes no canvas geometry.** It owns one `ScoreCanvas`
 * (music_drawing, `docs/score-canvas.md`) for its life, tells it what is drawn
 * — the display score, the view size, zoom, scroll, active track, selection —
 * and asks it every geometric question: what is under a pointer, which tick a
 * point means, where the caret goes, how large the content is. The web and
 * React Native apps used to each answer those themselves and disagreed (the
 * caret's zoom scaling, the gutter clip, which units a viewport is in); now
 * both ask the same object, and this file keeps only the *policies* — what a
 * click with a modifier means, note input mode, the drags. Pixels reach the
 * screen through `web-canvas-surface.ts`, and playback drives the canvas
 * through music_drawing's shared `bindPlaybackToCanvas`.
 *
 * There is no per-glyph DOM: ALL hit-testing is geometric, against the drawn
 * window's bbox maps and the layout plan, which works identically in jsdom
 * (bboxes come from VexFlow's own layout math, not the DOM) and real browsers.
 * Drawing is the virtualization: every scroll/resize re-renders exactly the
 * visible systems (O(visible)).
 *
 * `renderTheme` picks between `LIGHT_RENDER_THEME`/`DARK_RENDER_THEME`
 * (`render-theme.ts`) off `useResolvedColorScheme(themeMode)`, which follows
 * the OS while the app is set to system.
 */
import { libraryCopy } from '@/i18n/library-copy';
import { getMusicPosition, getMusicPositionSource } from '@sudobility/music_types';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type React from 'react';
import { useClipboardPrompts } from '@sudobility/music_editing';
import {
  playbackController,
  selectActiveTrackId,
  selectVisibleTrackIds,
  routeScorePress,
  selectForContextMenu,
  startPointerGesture,
  applyBoxSelection,
  scoreContextMenuModel,
  runScoreContextAction,
  beginLyricEntry as beginLyricEntryAt,
  goToBarFromInput,
} from '@sudobility/music_lib';
import type { BBox, RenderTheme } from '@sudobility/music_lib';
import type { LayoutPlan } from '@sudobility/music_lib';
import { isNoteEvent } from '@sudobility/music_types';
import type { GenerateScoreRequest, NoteEvent, Pitch } from '@sudobility/music_types';
import {
  findEvent,
  selectionSummaryLabel,
  shiftDiatonic,
  ticksFor,
  // Aliased: the memo below is itself called `displayScore`, and the comments
  // around it name that.
  displayScore as applyDisplayLenses,
} from '@sudobility/music_lib';
import { useResolvedColorScheme } from '@/app/theme';
import { GenerateTrackDialog } from '@/components/dialogs/GenerateTrackDialog';
import {
  buildGenerateTrackRequest,
  estimateGenerateTrackCredits,
  withGenerationVariant,
} from '@sudobility/music_lib';
import type { InstrumentChoice } from '@sudobility/music_lib';
import { resolveDrop } from '@sudobility/music_drawing';
import type { DropTarget } from '@sudobility/music_drawing';
import { useAppStore } from '@sudobility/music_lib';
import {
  relocateNotes,
  commitPitchDrag,
  collisionForEditMode,
  selectEffectiveEditMode,
  barCount,
} from '@sudobility/music_lib';
import { GoToBarDialog } from '@/features/score-editor/GoToBarDialog';
import { LyricEntryBar } from '@/features/score-editor/LyricEntryBar';
import { ScoreContextMenu } from '@/features/score-editor/ScoreContextMenu';
import type { EditorStoreApi } from '@sudobility/music_lib';
import { useEditorShortcuts } from '@/features/score-editor/useEditorShortcuts';
import { ChoiceDialog } from '@/components/dialogs/ChoiceDialog';
import { EditorToolbar } from '@/features/score-editor/EditorToolbar';
import type { LayoutMode } from '@sudobility/music_types';
import { ScoreCanvas, bindPlaybackToCanvas, boxFromPoints } from '@sudobility/music_drawing';
import type { Point, ViewPoint } from '@sudobility/music_drawing';
import { DARK_RENDER_THEME, LIGHT_RENDER_THEME } from '@sudobility/music_drawing';
import { autoscrollDelta } from '@/features/score-editor/autoscroll';
import { scoreWithPitch, stepsForDrag } from '@sudobility/music_lib';
import { STAVE_POSITION_HEIGHT } from '@sudobility/music_drawing';
import { outOfRangeNoteIds } from '@sudobility/music_types';
import {
  createWebCanvasSurface,
  webCanvasScheduler,
} from '@/features/score-editor/web-canvas-surface';
import type { WebCanvasSurface } from '@/features/score-editor/web-canvas-surface';

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
  const snapGrid = store((s) => s.snapGrid);
  const selectionRegenerated = store((s) => s.selectionRegenerated);
  const activeTrackId = store(selectActiveTrackId);
  const visibleTrackIds = store(selectVisibleTrackIds);

  const [layoutMode, setLayoutMode] = useState<LayoutMode>('page');
  const [dragBox, setDragBox] = useState<BBox | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  /** The single viewport-sized drawing surface. There used to be a second, overlay canvas for selection/playback rectangles; notes carry their own color now, and the caret and drag box are DOM divs, so one canvas is enough. */
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  /** The playback caret: a DOM line the surface moves, never React. */
  const caretRef = useRef<HTMLDivElement | null>(null);

  /*
    The score canvas and its web surface, one of each for the view's life.

    Built in a ref rather than state or a memo: nothing about them is render
    output, and they must survive every render — the surface's renderer keeps a
    column cache that is what makes a repaint of the same window cheap, and the
    canvas keeps the colour signature that lets an invisible change skip the
    paint. The surface reads its elements lazily, since React attaches them
    after this runs.
  */
  const canvasModelRef = useRef<{ canvas: ScoreCanvas; surface: WebCanvasSurface } | null>(null);
  if (!canvasModelRef.current) {
    const surface = createWebCanvasSurface({
      canvas: () => canvasElementRef.current,
      caret: () => caretRef.current,
      scrollBox: () => scrollBoxRef.current,
    });
    canvasModelRef.current = {
      surface,
      canvas: new ScoreCanvas({ surface, scheduler: webCanvasScheduler }),
    };
  }
  const { canvas: scoreCanvas, surface } = canvasModelRef.current;

  /**
   * What React needs back from the canvas: the plan (for the drop indicator
   * and the drags) and the content size (for the spacer that gives the scroll
   * box its extent).
   *
   * State, because the spacer's size is render output — but only ever *copied*
   * from the canvas after it has laid out, never computed here. The spacer used
   * to be sized from a plan this view computed itself, and when that plan
   * wrapped at a different width from the one the canvas drew with, the caret
   * travelled along one layout while the page showed another.
   */
  const [layout, setLayout] = useState<{
    plan: LayoutPlan | null;
    width: number;
    height: number;
  }>({ plan: null, width: 0, height: 0 });
  const layoutPlan = layout.plan;

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
    async (prompt: string, instrument: InstrumentChoice, variant: string) => {
      const current = store.getState().score;
      if (!current || !onGenerateTrackJob) return;

      setGenerateTrackPending(true);
      /*
        No catch: the job runner (`useProjectGeneration().start`) never throws —
        it reports a refused start through its own error and paywall paths, which
        the layout renders. The catch that used to sit here could not fire, and
        its English fallback message was the one string it would have shown.
      */
      try {
        // Built by music_lib, which takes everything the track has to agree
        // with — length, time signature, key, tempo — from the score itself.
        await onGenerateTrackJob(
          withGenerationVariant(buildGenerateTrackRequest(current, prompt, instrument), variant),
        );
        setGenerateTrackOpen(false);
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
  /** Live rAF id for drag autoscroll, and the last pointer position in scroll-box coordinates. */
  const autoscrollRafRef = useRef<number | null>(null);
  const autoscrollPointRef = useRef<{ x: number; y: number } | null>(null);

  /*
    The scheme is read through a hook that re-renders when the OS flips, not
    resolved from `themeMode` once: VexFlow paints literal colours, and in
    system mode `themeMode` does not change when the OS does — so the page went
    dark around a sheet still drawn in light colours.
  */
  const colorScheme = useResolvedColorScheme(themeMode);
  const renderTheme: RenderTheme = useMemo(
    () => (colorScheme === 'dark' ? DARK_RENDER_THEME : LIGHT_RENDER_THEME),
    [colorScheme],
  );

  /**
   * Notes the instrument cannot play, scanned from the score itself.
   *
   * Keyed on the score's identity: every mutation returns a new object, so an
   * unchanged reference is an unchanged score — and a selection change must
   * not re-walk it, since colours repaint far more often than notes move.
   */
  const outOfRangeIds = useMemo(() => outOfRangeNoteIds(score).ids, [score]);

  /**
   * The score actually drawn.
   *
   * Memoized on `score` plus the pitch-drag and written-pitch state, so an
   * unrelated render (a selection-only change) does not rebuild it — a new
   * score identity invalidates the canvas's cached layout.
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

    /*
      Both display lenses, in music_types' own order: the octave bracket first
      and in every mode, the instrument's transposition last and only in
      written mode. The composition is a rule about music rather than about
      this app, so it is declared once upstream and the native app applies the
      same one — see `displayScore`.

      Applied to `dragged`, after the preview, deliberately. The drag splices
      in a *sounding* pitch (it comes from the stored score, so the command it
      will dispatch is right), and transposing afterwards moves the dragged
      note with the rest of the staff; lensing first would draw that one note
      an instrument's transposition too low. `displayScore` returns its input
      object when neither lens has anything to do, so the layout cache is
      untouched unless a lens is really doing something.
    */
    return dragged ? applyDisplayLenses(dragged, pitchDisplay) : dragged;
  }, [score, pitchDragSteps, pitchDisplay]);

  /*
    The inputs to the view, for code that runs outside a render (the scroll
    handler, the resize observer) to read without taking them as dependencies —
    a scroll must not need a fresh callback every time the theme changes.
  */
  const viewInputsRef = useRef({ zoom, layoutMode, renderTheme, visibleTrackIds });
  viewInputsRef.current = { zoom, layoutMode, renderTheme, visibleTrackIds };

  /**
   * Tells the canvas the view's size and scroll, as the DOM measures them now,
   * and sizes the canvas's backing store to match.
   *
   * The backing store is the client size × devicePixelRatio (CSS size via
   * style), so glyphs stay crisp on retina displays at any zoom. jsdom reports
   * a client size of 0, which the DEFAULT_WIDTH / CONTAINER_MIN_HEIGHT
   * fallbacks turn into something deterministic for tests.
   *
   * Everything here is DOM measurement; what the numbers *mean* is the
   * canvas's business. Setting an unchanged view or scroll is free — the
   * canvas compares and does nothing.
   */
  const syncView = useCallback(() => {
    const box = scrollBoxRef.current;
    if (!box) return;
    const dpr = window.devicePixelRatio || 1;
    const width = box.clientWidth || DEFAULT_WIDTH;
    const height = box.clientHeight || CONTAINER_MIN_HEIGHT;

    const element = canvasElementRef.current;
    if (element) {
      const bw = Math.max(1, Math.floor(width * dpr));
      const bh = Math.max(1, Math.floor(height * dpr));
      if (element.width !== bw) element.width = bw;
      if (element.height !== bh) element.height = bh;
      element.style.width = `${width}px`;
      element.style.height = `${height}px`;
    }

    const inputs = viewInputsRef.current;
    scoreCanvas.setView({
      width,
      height,
      zoom: inputs.zoom,
      layoutMode: inputs.layoutMode,
      theme: inputs.renderTheme,
      // The canvas lays out a subset and drops ids that do not resolve, so
      // hiding a track costs one option rather than a code path. The gutter,
      // the caret and hit-testing all follow, since they read the same plan.
      trackIds: inputs.visibleTrackIds,
      devicePixelRatio: dpr,
    });
    scoreCanvas.setScroll(box.scrollLeft, box.scrollTop);
  }, [scoreCanvas]);

  /**
   * Copies the canvas's layout back into React, when it changed.
   *
   * Compared before setting, because this runs from the scroll handler and a
   * state write per scroll event would re-render the whole editor at scroll
   * rate for nothing.
   */
  const publishLayout = useCallback(() => {
    const plan = scoreCanvas.plan;
    const size = scoreCanvas.contentSize();
    setLayout((previous) =>
      previous.plan === plan && previous.width === size.width && previous.height === size.height
        ? previous
        : { plan, width: size.width, height: size.height },
    );
  }, [scoreCanvas]);

  /*
    What colours the notation, handed to the canvas as it changes.

    Layout effects, and declared before the paint below, so the first paint
    after mount already carries them rather than drawing plain and recolouring
    a frame later. After that each is an ordinary low-frequency change, and the
    canvas coalesces the repaint to one per frame and skips it when nothing in
    the drawn window would change colour — measured, a redraw rebuilds and
    re-formats every VexFlow object in the window (~5ms), on the same thread
    the audio schedules from.

    **Only the active track's sounding notes light up**, and that rule is the
    canvas's now (it receives the sounding notes from the playback binding
    below). Every track's used to, which on a large score scattered colour
    across whichever parts happened to be sounding.
  */
  useLayoutEffect(() => {
    scoreCanvas.setActiveTrack(activeTrackId ?? null);
  }, [scoreCanvas, activeTrackId]);

  useLayoutEffect(() => {
    // `regenerated` survives the removal of candidate previews:
    // `selectionRegenerated` still marks material a generation just produced.
    scoreCanvas.setSelectedNotes(selection.eventIds, { regenerated: selectionRegenerated });
  }, [scoreCanvas, selection.eventIds, selectionRegenerated]);

  useLayoutEffect(() => {
    scoreCanvas.setSelectedMeasures(selection.measureIds);
  }, [scoreCanvas, selection.measureIds]);

  useLayoutEffect(() => {
    scoreCanvas.setOutOfRangeNotes(outOfRangeIds);
  }, [scoreCanvas, outOfRangeIds]);

  /*
    What is drawn, and at what size: painted immediately rather than on the
    next frame.

    Immediately because the spacer's size is read back from the result in the
    same commit — deferring the paint would render one frame of the scroll box
    at the previous layout's extent — and because a layout change (score, zoom,
    mode, theme, visible tracks) is a deliberate, low-frequency act where a
    frame's latency buys nothing.
  */
  useLayoutEffect(() => {
    scoreCanvas.setScore(displayScore);
    syncView();
    scoreCanvas.paintNow();
    publishLayout();
  }, [
    scoreCanvas,
    displayScore,
    zoom,
    layoutMode,
    renderTheme,
    visibleTrackIds,
    syncView,
    publishLayout,
  ]);

  /**
   * Playback drives the canvas through the one binding both apps share.
   *
   * It watches the shared playhead and the player's sounding notes and calls
   * the canvas's cursor, playing-note and follow methods — the caret's
   * motion, following once per bar, not scrolling when the transport stops,
   * jumping rather than animating a long move. Those rules used to live here
   * and separately in the native app's caret, and disagreed.
   *
   * Rebound when the stored score changes, so following starts afresh on a
   * new score rather than believing it already showed a bar of the old one.
   * The bus's sounding subscription is never React: `activeNoteIds` fires on
   * every note-on and note-off, and rendering this view for each cost the
   * caret a frame and made it lurch at every note.
   *
   * `defer` is a microtask: the engine reports a stop as two notifications in
   * one call (home to 0, then stopped), and the binding decides once the burst
   * is over so a stop is not read as a jump to bar 1.
   */
  useEffect(
    () =>
      bindPlaybackToCanvas(scoreCanvas, {
        position: getMusicPosition(),
        defer: (work) => queueMicrotask(work),
        onSounding: (listener) => playbackController.bus.onSounding(listener),
        // The lit notes are published as far ahead as this canvas measures
        // drawing them takes, so they land with the sound.
        setSoundingRenderDelay: (seconds) => playbackController.setSoundingRenderDelay(seconds),
        now: () => performance.now(),
      }),
    [scoreCanvas, score],
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
   * The scroll itself fires `onScroll`, so the newly-exposed window repaints
   * with no extra wiring here, and the drag box keeps extending correctly
   * because `pointFromEvent` tracks content (not viewport) coordinates.
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

  /**
   * `onScroll`: the new window is painted in the handler itself.
   *
   * Not coalesced to a later frame, because a browser already delivers scroll
   * events at most once per frame — a second layer of coalescing only showed
   * the previous window for one more frame. The caret is re-evaluated too:
   * whether it hides behind the pinned gutter depends on the scroll offset,
   * and while paused nothing else would move it.
   */
  const handleScroll = useCallback(() => {
    syncView();
    scoreCanvas.paintNow();
    surface.scrolled();
    publishLayout();
  }, [scoreCanvas, surface, syncView, publishLayout]);

  useEffect(() => {
    return () => {
      if (autoscrollRafRef.current !== null) {
        cancelAnimationFrame(autoscrollRafRef.current);
        autoscrollRafRef.current = null;
      }
      autoscrollPointRef.current = null;
    };
  }, []);

  /**
   * Container-size-driven redraw (successor of the refresh-render fix):
   * when the scroll box settles to its real size after an async project
   * load -- or the window/panels resize -- re-size the backing store and
   * redraw the (now different) visible window. Guarded for jsdom, where
   * ResizeObserver doesn't exist.
   */
  useEffect(() => {
    const el = scrollBoxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      syncView();
      scoreCanvas.paintNow();
      publishLayout();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scoreCanvas, syncView, publishLayout]);

  useEffect(
    () => () => {
      scoreCanvas.dispose();
      surface.dispose();
    },
    [scoreCanvas, surface],
  );

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
        return scoreCanvas.frame;
      },
      get scrollBox() {
        return scrollBoxRef.current;
      },
      /**
       * Move the caret from a spec.
       *
       * The caret is the shared position, not a store field, so a test cannot
       * reach it through `__SCORESMITH_STORE__` any more. Exposed here rather
       * than reaching for the singleton through a bundled module, which a
       * spec has no honest way to import.
       */
      seek(tick: number) {
        getMusicPositionSource().moveTo(tick);
      },
    };
    const w = window as unknown as Record<string, unknown>;
    w.__scoresmith = handle;
    return () => {
      if (w.__scoresmith === handle) delete w.__scoresmith;
    };
  }, [scoreCanvas]);

  /**
   * A pointer event as a view point: relative to the scroll box's visible
   * top-left, scroll not added. The canvas does every conversion from there —
   * adding the scroll, dividing by zoom, and testing the pinned gutter in view
   * space where the rest is content space.
   */
  const viewPointFromEvent = useCallback(
    (event: { clientX: number; clientY: number }): ViewPoint | null => {
      const box = scrollBoxRef.current;
      if (!box) return null;
      const rect = box.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    },
    [],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }

      // Every question about where the click landed goes to the canvas, in view
      // coordinates — gutter first, then the measure-number band, then a note,
      // then a stave. What the click *does* is music_editing's
      // `routeScorePress`, shared with the native tap:
      //
      // - track gutter: active + selected, caret stays (not a timeline position);
      // - bar number: select that bar; Shift extends from the anchor (so "bars 3
      //   to 12" is two clicks), Cmd+Shift is the same bar on every track;
      // - Cmd anywhere else: select from the caret to the point *without* moving
      //   the caret, so one anchor extends repeatedly — to the canvas's `tickAt`
      //   for the point, which answers between systems where a hit has none;
      // - note: Shift toggles one note and leaves the caret; otherwise the whole
      //   chord is selected (one bounding box holds every note at that tick) and
      //   the caret aimed at it;
      // - stave: in note input, write the *sounding* pitch there (the drawn one
      //   has been through the display lenses); otherwise caret + active track,
      //   and the selection clears so the caret anchors the next range.
      const point = viewPointFromEvent(event);
      if (!point || !store.getState().score) return;
      measureAnchorRef.current = routeScorePress(store, scoreCanvas.hitTest(point), {
        shift: event.shiftKey,
        // Cmd on macOS, Ctrl elsewhere.
        mod: event.metaKey || event.ctrlKey,
        noteInput: store.getState().noteInput,
        pitchDisplay,
        anchor: measureAnchorRef.current,
        pointTick: scoreCanvas.tickAt(point),
      });
    },
    [store, scoreCanvas, viewPointFromEvent, pitchDisplay],
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
   * Lyric entry in progress: the *active track's* notes in tick order, as they
   * were when entry began, and the note at or after the caret to start on — so
   * "start writing words here" means what it looks like. `beginLyricEntry`
   * (music_editing) decides both, and answers null with nothing to write under
   * or while the transport plays.
   */
  const [lyricEntry, setLyricEntry] = useState<{ notes: NoteEvent[]; startIndex: number } | null>(
    null,
  );

  const beginLyricEntry = useCallback(() => {
    const entry = beginLyricEntryAt(store);
    if (entry) setLyricEntry({ notes: entry.notes, startIndex: entry.startIndex });
  }, [store]);

  /**
   * Right-click selects what is under the pointer, then opens the menu on it
   * (`selectForContextMenu`, shared with the native long press).
   *
   * The menu names the object it acts on and Delete means three different edits
   * depending on which, so opening it over one thing while it targets another
   * is the one failure it must not have. Same hit test as an ordinary click —
   * track gutter, then measure gutter, then a note — so the two gestures cannot
   * come to disagree about what is where. A bare stave selects nothing: the menu
   * then acts on the selection already there.
   *
   * **A click inside an existing selection keeps it.** Right-clicking one of
   * four selected bars means "these four", not "this one"; narrowing to the
   * clicked object is the classic way a context menu throws away the selection
   * somebody just built.
   */
  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const point = viewPointFromEvent(event);
      measureAnchorRef.current = selectForContextMenu(
        store,
        point ? scoreCanvas.hitTest(point) : null,
        measureAnchorRef.current,
      );
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    [store, scoreCanvas, viewPointFromEvent],
  );

  /**
   * A pointer in content coordinates — view plus scroll — for what this view
   * draws itself in the scroll box's content (the drag box) and for anchoring a
   * gesture that must survive the box autoscrolling under it.
   */
  const pointFromEvent = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): Point | null => {
      const view = viewPointFromEvent(event);
      const box = scrollBoxRef.current;
      if (!view || !box) return null;
      return { x: view.x + box.scrollLeft, y: view.y + box.scrollTop };
    },
    [viewPointFromEvent],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      // Every left press starts drag-tracking (no per-glyph DOM to exclude
      // any more): a press that never crosses DRAG_THRESHOLD stays a plain
      // click (handleClick runs; `suppressNextClickRef` is only set for
      // real drags), so note/measure clicks behave exactly as before.
      const point = pointFromEvent(event);
      const view = viewPointFromEvent(event);
      if (!point || !view) return;

      /*
        What the press starts is music_editing's (`startPointerGesture`, shared
        with the native app):

        - Option/Alt on a note is a **move** — checked before the pitch drag,
          because the same press on the same selected note would otherwise start
          one; the modifier is the whole disambiguation. It works on any note
          (an explicit modifier leaves no ambiguity with a box select) and, off
          the selection, selects the pressed chord first — only the selection,
          never the caret or the active track.
        - A press on the *one* selected note is a **pitch drag**. Requiring it
          to be selected first is what keeps an ordinary click-and-drag on the
          staff a box select. A rest has no pitch to drag.
        - Anything else is a **box**, additive with Shift; one that never
          crosses DRAG_THRESHOLD stays a plain click.
      */
      const gesture = startPointerGesture(store, scoreCanvas.hitTest(view), {
        alt: event.altKey,
        shift: event.shiftKey,
      });
      containerRef.current?.setPointerCapture?.(event.pointerId);

      if (gesture.kind === 'move') {
        noteDragRef.current = { anchorId: gesture.anchorId, anchorTick: gesture.anchorTick };
        setDropTargetBoth(null);
        return;
      }
      if (gesture.kind === 'pitchDrag') {
        pitchDragRef.current = { eventId: gesture.eventId, pitch: gesture.pitch, startY: point.y };
        setPitchDragSteps(0);
        return;
      }
      dragStateRef.current = { start: point, moved: false, additive: gesture.additive };
    },
    // Deps are narrow on purpose: anything read in here that changes per frame
    // goes through a ref (`pitchDragRef`, `dropTargetRef`). Listing the rule's
    // suggestions captures a stale value instead — that shipped as a bug once,
    // and only the e2e caught it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pointFromEvent, viewPointFromEvent, scoreCanvas, setDropTargetBoth],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const noteDrag = noteDragRef.current;
      if (noteDrag) {
        const point = pointFromEvent(event);
        const currentScore = store.getState().score;
        // Read from the canvas at the moment of the move, not from a plan
        // captured when this handler was built: the canvas's plan is the one
        // the page is drawn against right now.
        const plan = scoreCanvas.plan;
        if (!point || !plan || !currentScore) return;
        // Recomputed per move but only re-renders the indicator when the
        // resolved track or tick actually changes; it never touches the score,
        // so nothing relayouts.
        setDropTargetBoth(
          resolveDrop(plan, currentScore, noteDrag, point, ticksFor(snapGrid, currentScore.ppq)),
        );
        return;
      }

      const pitchDrag = pitchDragRef.current;
      if (pitchDrag) {
        const point = pointFromEvent(event);
        if (!point) return;
        // Only re-renders when the step count actually changes -- about ten
        // times in a drag, not once per pointermove.
        setPitchDragSteps(
          // The pixels-per-staff-position is the RENDERER's fact, so the
          // renderer's constant is passed in rather than the editing engine
          // importing a drawing package it must not depend on.
          stepsForDrag(point.y - pitchDrag.startY, zoom, STAVE_POSITION_HEIGHT),
        );
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

      autoscrollPointRef.current = viewPointFromEvent(event);
      if (autoscrollRafRef.current === null) {
        autoscrollRafRef.current = requestAnimationFrame(stepAutoscroll);
      }
    },
    // Deps are narrow on purpose: anything read in here that changes per frame
    // goes through a ref (`pitchDragRef`, `dropTargetRef`). Listing the rule's
    // suggestions captures a stale value instead — that shipped as a bug once,
    // and only the e2e caught it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pointFromEvent, viewPointFromEvent, stepAutoscroll, scoreCanvas, snapGrid, setDropTargetBoth],
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
          relocateNotes(store, [...ids], {
            targetTrackId: target.trackId,
            deltaTicks: target.deltaTicks,
            // Read at the point of writing, like chord entry and paste: stack
            // on a part that cannot play a chord is replace.
            collision: collisionForEditMode(selectEffectiveEditMode(store.getState())),
          });
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
          commitPitchDrag(store, pitchDrag.eventId, pitchDrag.pitch, steps);
        }
        return;
      }

      const drag = dragStateRef.current;
      if (!drag) return;
      stopAutoscroll();
      containerRef.current?.releasePointerCapture?.(event.pointerId);

      if (drag.moved) {
        suppressNextClickRef.current = true;
        const view = viewPointFromEvent(event);
        const box = scrollBoxRef.current;
        if (view && box) {
          // The press was anchored in content coordinates so an autoscroll
          // during the drag could not move it; it goes back to view
          // coordinates against the scroll as it is now, which is the scroll
          // the canvas holds.
          const start = { x: drag.start.x - box.scrollLeft, y: drag.start.y - box.scrollTop };
          // Replaces the selection, or joins it with Shift; leaves the caret
          // and the active track alone — a box is about which notes.
          applyBoxSelection(store, scoreCanvas.noteIdsInRect(start, view), drag.additive);
        }
      }

      setDragBox(null);
      dragStateRef.current = null;
    },
    [viewPointFromEvent, scoreCanvas, store, stopAutoscroll, pitchDragSteps, setDropTargetBoth],
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
            detail: t('editor.leaveSilenceDetail'),
            primary: true,
          },
          {
            value: 'close' as const,
            label: t('editor.closeGap'),
            detail: t('editor.closeGapDetail'),
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
            detail: t('editor.replaceDetail'),
            primary: true,
          },
          {
            value: 'insert' as const,
            label: t('editor.insert'),
            detail: t('editor.insertDetail'),
          },
        ]}
        onChoose={clipboard.resolvePaste}
        onCancel={clipboard.cancel}
      />
      {contextMenu ? (
        <ScoreContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          model={scoreContextMenuModel({
            selection,
            clipboard: store.getState().clipboard,
            playing: store.getState().state === 'playing',
            score,
          })}
          onClose={() => setContextMenu(null)}
          // Re-checked against the store as it is now, so an entry chosen after
          // the transport started is refused rather than trusted to the flag.
          // Cut and paste ask the same question the shortcuts do.
          onAction={(action) => {
            runScoreContextAction(store, action, {
              requestCut: clipboard.requestCut,
              requestPaste: clipboard.requestPaste,
            });
          }}
        />
      ) : null}
      {lyricEntry !== null ? (
        <LyricEntryBar
          store={store}
          notes={lyricEntry.notes}
          startIndex={lyricEntry.startIndex}
          onClose={() => setLyricEntry(null)}
        />
      ) : null}
      <GoToBarDialog
        open={goToBarOpen}
        barCount={barCount(score)}
        onClose={() => setGoToBarOpen(false)}
        onGo={(text) => goToBarFromInput(store, text)}
      />
      <EditorToolbar
        store={store}
        onEnterLyrics={beginLyricEntry}
        onGoToBar={() => setGoToBarOpen(true)}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        inspectorOpen={inspectorOpen}
        onToggleInspector={onToggleInspector}
        onGenerateTrack={() => setGenerateTrackOpen(true)}
      />

      <GenerateTrackDialog
        open={generateTrackOpen}
        pending={generateTrackPending}
        estimatedCredits={score ? estimateGenerateTrackCredits(score) : 0}
        onGenerate={(prompt, instrument, variant) =>
          void generateTrack(prompt, instrument, variant)
        }
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
            summary: selectionSummaryLabel(
              selection,
              libraryCopy.selection(),
              selectionRegenerated,
            ),
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
            // The canvas's own content size, copied back after it laid out
            // (see `layout`) — never the plan's size times zoom worked out here.
            height: Math.max(layout.height, CONTAINER_MIN_HEIGHT),
            // Horizontal scroll extent: continuous mode's single system is
            // (much) wider than the viewport — the spacer must span it so
            // the scroll box scrolls horizontally (trackpad swipe included).
            // Page mode lays out to exactly the viewport width, so asking for
            // it here would only risk a sub-pixel overflow.
            minWidth: layoutMode === 'continuous' ? layout.width : undefined,
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
            <canvas ref={canvasElementRef} data-testid="score-canvas" />
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
        {/* The playback caret. Positioned at the origin and moved entirely by
            the surface's `transform` writes (see `web-canvas-surface.ts`), so
            nothing about it changes per render; hidden until the canvas has
            a path to put it on. An abspos child of the scroll box, so it lives
            in content coordinates and scrolls with the sheet. */}
        <div
          ref={caretRef}
          data-testid="playback-caret"
          aria-hidden="true"
          style={{ left: 0, top: 0, backgroundColor: renderTheme.caret }}
          className="pointer-events-none absolute w-0.5"
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
