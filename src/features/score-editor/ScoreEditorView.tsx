/**
 * The interactive sheet-music editor (spec §7 + the canvas-notation-renderer
 * design): owns the `CanvasScoreRenderer` instance (kept in a React ref,
 * per spec §37.2 — never stored in Zustand), draws the visible window of
 * the score into a viewport-pinned canvas pair (notation + highlight
 * overlay) over a full-height interaction/spacer div, wires
 * click/shift-click, drag-box selection, click-to-seek and the playback
 * caret, and scrolls the active playback measure into view.
 *
 * There is no per-glyph DOM: ALL hit-testing is geometric, against the
 * drawn window's `idToBBox`/`measureIdToBBox` maps (`hit-test.ts`), which
 * works identically in jsdom (bboxes are computed from VexFlow's own
 * layout math, not the DOM) and real browsers. Drawing is the
 * virtualization: every scroll/resize frame re-renders exactly the
 * visible systems (O(visible)), so there is no visible-set state to
 * invalidate.
 *
 * Candidate preview (spec §13): while `generation-slice.previewFragment` is
 * set, the component draws `scoreWithCandidate(score, previewFragment)`
 * (`features/generation/preview.ts`) instead of the bare committed score —
 * see `displayScore`'s doc comment for why this is required, not just an
 * optimization. Clicking the canvas while previewing is a no-op (see
 * `handleClick`/`handlePointerUp`): the ids on screen may belong to the
 * spliced-in candidate rather than the committed score, so a click there
 * must never be allowed to drive a selection/edit.
 *
 * `renderTheme` (fed to VexFlow's canvas draw, so it needs real literal
 * color strings, not CSS custom properties) picks between two literal
 * `LIGHT_RENDER_THEME`/`DARK_RENDER_THEME` constants keyed off
 * `resolveColorScheme(themeMode)` (see that constant's doc comment for why
 * these particular values).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { CanvasScoreRenderer, paintHighlights, playbackController } from '@sudobility/music_lib';
import type { BBox, CanvasRenderResult, RenderTheme } from '@sudobility/music_lib';
import {
  boxForMeasureIndex,
  caretPositionForTick,
  computeLayout,
  tickForPoint,
} from '@sudobility/music_lib';
import type { ScoreFragment } from '@sudobility/music_lib';
import type { Score } from '@sudobility/music_types';
import { selectionSummaryLabel } from '@sudobility/music_lib';
import { prefersReducedMotion, resolveColorScheme } from '@/app/theme';
import { scoreWithCandidate } from '@/features/generation/preview';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { useEditorShortcuts } from '@/features/score-editor/useEditorShortcuts';
import { EditorToolbar } from '@/features/score-editor/EditorToolbar';
import type { LayoutMode } from '@/features/score-editor/EditorToolbar';
import {
  boxFromPoints,
  eventIdAtPoint,
  eventIdsInBox,
  measureIdAtPoint,
} from '@/features/score-editor/hit-test';
import type { Point } from '@/features/score-editor/hit-test';
import { selectMeasure } from '@/features/score-editor/editing';

export type ScoreEditorViewProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
};

const DEFAULT_WIDTH = 900;
const CONTAINER_MIN_HEIGHT = 400;
/** Pixels of pointer movement before a pointerdown-drag counts as a box-select rather than a plain click. */
const DRAG_THRESHOLD = 3;
/** Padding (px) kept between the scrolled-to measure and the viewport edge. */
const SCROLL_MARGIN = 40;

/**
 * VexFlow render colors (spec §7), one set per resolved light/dark color
 * scheme -- matching MUI's own former default `text.primary`/`success.main`/
 * `warning.main` palette values for each mode (the pre-T13 `theme.ts`'s
 * `createAppTheme` only overrode `primary`/`secondary`, so these two objects
 * are what MUI's `ThemeProvider` was actually resolving `useTheme()` to
 * before this file's T12 batch 6 Tailwind pass; kept as literals post-T13
 * MUI removal since VexFlow still needs real color strings, not CSS
 * variables). VexFlow draws straight to SVG attributes, not
 * CSS, so this deliberately stays literal color strings rather than reading
 * the app's `--color-*`/`--primary` custom properties (which jsdom's test
 * environment doesn't process CSS for anyway, and no test asserts an exact
 * rendered color -- `render()` itself is mocked/spied in every test that
 * touches this).
 */
const LIGHT_RENDER_THEME: RenderTheme = {
  foreground: 'rgba(0, 0, 0, 0.87)',
  selection: '#1565c0',
  playback: '#2e7d32',
  preview: '#ed6c02',
};
const DARK_RENDER_THEME: RenderTheme = {
  foreground: '#ffffff',
  selection: '#90caf9',
  playback: '#66bb6a',
  preview: '#ffa726',
};

/** Every event id (note or rest) referenced by a preview fragment's measures, for the highlight overlay's `previewIds`. */
function previewEventIds(fragment: ScoreFragment | null): string[] {
  if (!fragment) return [];
  const ids: string[] = [];
  for (const trackFragment of fragment.tracks) {
    for (const measure of trackFragment.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) ids.push(event.id);
      }
    }
  }
  return ids;
}

/** The id of the measure `positionTick` currently falls in, read off the score's first track (every track shares the same measure grid — see `store/selectors.ts`'s `selectCurrentMeasureBeat`, same convention). */
function currentMeasureId(score: Score, positionTick: number): string | null {
  const track = score.tracks[0];
  if (!track || track.measures.length === 0) return null;
  const measure =
    track.measures.find(
      (m) => positionTick >= m.startTick && positionTick < m.startTick + m.durationTicks,
    ) ?? track.measures[track.measures.length - 1];
  return measure.id;
}

export function ScoreEditorView({ store = useAppStore }: ScoreEditorViewProps) {
  useEditorShortcuts(store);

  const score = store((s) => s.score);
  const selection = store((s) => s.selection);
  const zoom = store((s) => s.zoom);
  const activeNoteIds = store((s) => s.activeNoteIds);
  const previewFragment = store((s) => s.previewFragment);
  const playbackState = store((s) => s.state);
  const positionTick = store((s) => s.positionTick);
  const themeMode = store((s) => s.themeMode);

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
  /** The two viewport-sized drawing surfaces (spec: canvas-notation-renderer): notation glyphs, and the highlight/caret-free overlay painted by `paintHighlights`. */
  const scoreCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CanvasScoreRenderer | null>(null);
  if (!rendererRef.current) rendererRef.current = new CanvasScoreRenderer();
  const resultRef = useRef<CanvasRenderResult | null>(null);
  const dragStateRef = useRef<{ start: Point; moved: boolean; additive: boolean } | null>(null);
  const suppressNextClickRef = useRef(false);
  const lastScrolledMeasureRef = useRef<string | null>(null);
  const lastScrolledScoreRef = useRef<Score | null>(null);
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

  const renderTheme: RenderTheme = useMemo(
    () => (resolveColorScheme(themeMode) === 'dark' ? DARK_RENDER_THEME : LIGHT_RENDER_THEME),
    [themeMode],
  );

  const previewIds = useMemo(() => previewEventIds(previewFragment), [previewFragment]);

  /**
   * The score actually drawn: the committed score, or — while a
   * regeneration candidate is being previewed (spec §13) — the committed
   * score with the candidate's fragment spliced in via
   * `features/generation/preview.ts`'s `scoreWithCandidate`. Splicing is
   * required, not optional: a fragment's event/measure ids are always
   * freshly generated (`mock-transforms.ts`'s `rng.id(...)`), so they exist
   * only inside *this* spliced score's render result — rendering the
   * committed score and merely asking the highlight overlay to color
   * `previewIds` (the old, broken behavior — Task 19 review C1) can never
   * find a matching element, since none of those ids appear anywhere in
   * the committed score to begin with. Memoized on exactly `score`/
   * `previewFragment` so switching which candidate is active (or clearing
   * the preview) doesn't rebuild this on every unrelated render (e.g. a
   * selection-only change elsewhere).
   */
  const displayScore = useMemo(() => {
    if (!score || !previewFragment) return score;
    return scoreWithCandidate(score, previewFragment);
  }, [score, previewFragment]);

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
    return computeLayout(displayScore, { zoom, layoutMode, width: viewWidth, theme: renderTheme });
  }, [displayScore, zoom, layoutMode, renderTheme, viewWidth]);

  /**
   * The playback caret's position (spec follow-up: "caret on the track
   * view"): a vertical line at `positionTick`, spanning the system that
   * tick falls in. Present from the very first render (positionTick starts
   * at 0 — the caret sits at the score's start before playback ever runs)
   * and follows both live playback and seeks, since the engine reports all
   * of them back through the store's `positionTick`.
   */
  const caret = useMemo(() => {
    if (!layoutPlan || !displayScore) return null;
    return caretPositionForTick(layoutPlan, displayScore, positionTick);
  }, [layoutPlan, displayScore, positionTick]);

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

    for (const canvas of [scoreCanvasRef.current, overlayCanvasRef.current]) {
      if (!canvas) return false;
      const bw = Math.max(1, Math.floor(w * dpr));
      const bh = Math.max(1, Math.floor(h * dpr));
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    return true;
  }, []);

  /**
   * Repaints the highlight overlay (selection / playback active notes /
   * preview) for the current drawn window. Cheap: strokes a handful of
   * rects on the viewport-sized overlay canvas -- never touches the
   * notation canvas, preserving the SVG era's "highlight changes don't
   * re-render notation" property via layering instead of DOM styles.
   */
  const drawOverlay = useCallback(() => {
    const box = scrollBoxRef.current;
    const ctx = overlayCanvasRef.current?.getContext('2d');
    const result = resultRef.current;
    if (!box || !ctx || !result) return;
    // Highlight state is read from the store at call time (not closed
    // over): this keeps `drawOverlay`'s identity stable across selection/
    // playback changes, so `draw` (which depends on it) doesn't get a new
    // identity — and the notation canvas doesn't redraw — every time a
    // highlight changes. The overlay effect below subscribes to the
    // reactive values and re-invokes this on each change.
    const state = store.getState();
    paintHighlights(
      ctx,
      result,
      {
        selectedIds: state.selection.eventIds,
        playingIds: state.activeNoteIds,
        previewIds: previewEventIds(state.previewFragment),
      },
      {
        viewportTop: box.scrollTop,
        viewportLeft: box.scrollLeft,
        devicePixelRatio: window.devicePixelRatio || 1,
      },
    );
  }, [store]);

  /**
   * Draws the visible window of `displayScore` into the score canvas, then
   * repaints the overlay. Drawing IS the virtualization now: each call
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
      theme: renderTheme,
      viewport,
      devicePixelRatio: window.devicePixelRatio || 1,
    });
    drawOverlay();
  }, [displayScore, zoom, layoutMode, renderTheme, drawOverlay, viewWidth]);

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

  // Overlay-only repaint: selection/playback/preview changes never redraw
  // notation (drawOverlay is store-stable; these subscribed values are the
  // reactive triggers).
  useEffect(() => {
    drawOverlay();
  }, [drawOverlay, selection, activeNoteIds, previewIds]);

  // Scroll the active playback measure into view (spec §7 item 13).
  //
  // `lastScrolledMeasureRef` is reset whenever playback isn't actively
  // `'playing'` (and whenever `score` itself changes, e.g. a fresh
  // generation/import/undo swaps the score object) rather than only being
  // written on a successful scroll. Without the reset, stopping playback,
  // scrolling away manually, and restarting on the *same* measure would
  // silently no-op forever (the ref would already equal that measure's id
  // from the earlier playback run) and the active measure would never
  // re-enter view.
  useEffect(() => {
    if (score !== lastScrolledScoreRef.current) {
      lastScrolledScoreRef.current = score;
      lastScrolledMeasureRef.current = null;
    }

    if (playbackState !== 'playing') {
      lastScrolledMeasureRef.current = null;
      return;
    }

    const scrollBox = scrollBoxRef.current;
    if (!scrollBox || !score) return;
    const measureId = currentMeasureId(score, positionTick);
    if (!measureId || measureId === lastScrolledMeasureRef.current) return;

    // Computed straight from the memoized `layoutPlan` (not
    // `resultRef.current.measureIdToBBox`) so this still finds the target
    // measure's position even when it lies outside the currently-drawn
    // window — e.g. jumping to a measure several systems below the current
    // scroll position. Scrolling there fires `onScroll` -> `draw()`, which
    // renders that measure's window. The scroll target is the scroll box
    // (the element that actually owns the scrollbar).
    const measureIndex = score.tracks[0]?.measures.findIndex((m) => m.id === measureId) ?? -1;
    if (measureIndex === -1 || !layoutPlan) return;
    const bbox = boxForMeasureIndex(layoutPlan, 0, measureIndex);
    if (!bbox) return;

    lastScrolledMeasureRef.current = measureId;
    if (typeof scrollBox.scrollTo === 'function') {
      scrollBox.scrollTo({
        left: Math.max(0, bbox.x * zoom - SCROLL_MARGIN),
        top: Math.max(0, bbox.y * zoom - SCROLL_MARGIN),
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
  }, [score, positionTick, playbackState, layoutPlan, zoom]);

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
      if (previewFragment) return;

      // Geometric hit-testing (canvas has no per-glyph DOM): resolve the
      // click point in content coordinates against the drawn window's bbox
      // maps — note first (topmost wins), then measure stave, then seek.
      const container = containerRef.current;
      const result = resultRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const point: Point = { x: event.clientX - rect.left, y: event.clientY - rect.top };

      const noteId = result ? eventIdAtPoint(result.idToBBox, point) : null;
      if (noteId) {
        // A note/rest click is an editing gesture: select only, don't yank
        // the playhead out from under an edit in progress.
        const state = store.getState();
        if (event.shiftKey) state.toggleEvent(noteId);
        else state.setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
        return;
      }

      const measureId = result ? measureIdAtPoint(result.measureIdToBBox, point) : null;
      if (measureId) {
        selectMeasure(store, measureId);
      }
      // Any other track click — stave background, barlines, or empty canvas
      // inside a system — moves the playback position there.
      seekToEventPoint(event);
    },
    [store, previewFragment, seekToEventPoint],
  );

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
      dragStateRef.current = { start: point, moved: false, additive: event.shiftKey };
      containerRef.current?.setPointerCapture?.(event.pointerId);
    },
    [pointFromEvent],
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
      if (drag.moved) setDragBox(boxFromPoints(drag.start, point));
    },
    [pointFromEvent],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      containerRef.current?.releasePointerCapture?.(event.pointerId);

      if (drag.moved) {
        suppressNextClickRef.current = true;
        // Same preview guard as `handleClick`: a drag-box selection while
        // previewing would otherwise select against the spliced-in
        // candidate's ids rather than the committed score's.
        if (!previewFragment) {
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
      }

      setDragBox(null);
      dragStateRef.current = null;
    },
    [pointFromEvent, store, previewFragment],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorToolbar store={store} layoutMode={layoutMode} onLayoutModeChange={setLayoutMode} />
      <div
        ref={scrollBoxRef}
        data-testid="score-editor-scroll"
        onScroll={handleScroll}
        className="relative flex-1 overflow-auto"
        style={{ minHeight: CONTAINER_MIN_HEIGHT }}
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
          aria-label={`Score notation. ${selectionSummaryLabel(selection)}.`}
          tabIndex={0}
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className="relative w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          style={{
            height: Math.max((layoutPlan?.totalHeight ?? 0) * zoom, CONTAINER_MIN_HEIGHT),
            // Horizontal scroll extent: continuous mode's single system is
            // (much) wider than the viewport — the spacer must span it so
            // the scroll box scrolls horizontally (trackpad swipe included).
            // In page mode totalWidth ≈ the measured view width, so this is
            // a no-op there.
            minWidth: (layoutPlan?.totalWidth ?? 0) * zoom,
          }}
        >
          {/* Viewport-pinned drawing surfaces: a ZERO-SIZED sticky anchor
              (first child, so its static position is the content origin)
              that pins to the scrollport's top-left corner in BOTH axes;
              the canvases hang off it via overflow. `pointer-events-none`
              keeps every click landing on the interaction div itself. */}
          <div
            className="pointer-events-none sticky left-0 top-0 z-0 h-0 w-0 overflow-visible"
            aria-hidden="true"
          >
            <canvas ref={scoreCanvasRef} data-testid="score-canvas" />
            <canvas
              ref={overlayCanvasRef}
              data-testid="overlay-canvas"
              className="absolute left-0 top-0"
            />
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
        {caret && (
          <div
            data-testid="playback-caret"
            aria-hidden="true"
            style={{
              left: caret.x * zoom,
              top: caret.yTop * zoom,
              height: (caret.yBottom - caret.yTop) * zoom,
            }}
            className="pointer-events-none absolute w-0.5 -translate-x-1/2 bg-primary"
          />
        )}
      </div>
    </div>
  );
}
