/**
 * The interactive sheet-music editor (spec §7): owns the `VexFlowScoreRenderer`
 * instance (kept in a React ref, per spec §37.2 — never stored in Zustand),
 * renders the score into a container `<div>`, wires click/shift-click and
 * drag-box selection, re-paints selection/playback/preview highlights
 * without a full re-render (`applyHighlights`), and scrolls the active
 * playback measure into view.
 *
 * Click/shift-click hit-testing resolves the clicked DOM element's nearest
 * `id^="vf-"` ancestor (VexFlow's own id-prefixing convention — see
 * `adapters/vexflow/id-map.ts`) rather than bbox math: this works
 * correctly in jsdom (no real SVG layout) as well as real browsers, since
 * it only needs DOM element identity, not geometry. Drag-box selection
 * genuinely needs geometry (`idToBBox` intersection, `hit-test.ts`), which
 * jsdom cannot lay out — that logic is exercised via `hit-test.test.ts`'s
 * pure-math tests and this component wires it straightforwardly.
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
 * Re-skinned onto Tailwind (T12 batch 6): the wrapping MUI `Box`es become
 * plain `div`s, and `renderTheme` (fed to VexFlow's SVG renderer, so it
 * needs real literal color strings, not CSS custom properties) no longer
 * reads MUI's `useTheme()` -- it now picks between two literal
 * `LIGHT_RENDER_THEME`/`DARK_RENDER_THEME` constants keyed off
 * `resolveColorScheme(themeMode)` (see that constant's doc comment for why
 * these particular values).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { applyHighlights, VexFlowScoreRenderer } from '@sudobility/music_lib';
import type { BBox, RenderResult, RenderTheme } from '@sudobility/music_lib';
import { boxForMeasureIndex, computeLayout, sameMeasureIndices, visibleSystemMeasureIndices } from '@sudobility/music_lib';
import type { LayoutPlan } from '@sudobility/music_lib';
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
import { boxFromPoints, eventIdsInBox } from '@/features/score-editor/hit-test';
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
 * Screen-pixel buffer (pre-zoom) added on both sides of the measured
 * scroll viewport before culling systems (spec §26/§29 virtualization):
 * lets one extra system's worth of content stay rendered just off-screen
 * so a small scroll doesn't flash blank staves before the next render
 * pass catches up.
 */
const VIRTUALIZATION_OVERSCAN_PX = 400;

/**
 * VexFlow render colors (spec §7), one set per resolved light/dark color
 * scheme -- matching MUI's own default `text.primary`/`success.main`/
 * `warning.main` palette values for each mode (`theme.ts`'s `createAppTheme`
 * only overrides `primary`/`secondary`, so these two objects are what MUI's
 * `ThemeProvider` was actually resolving `useTheme()` to before this file's
 * T12 batch 6 Tailwind pass). VexFlow draws straight to SVG attributes, not
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

/** Every event id (note or rest) referenced by a preview fragment's measures, for `applyHighlights`' `previewIds`. */
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
    track.measures.find((m) => positionTick >= m.startTick && positionTick < m.startTick + m.durationTicks) ??
    track.measures[track.measures.length - 1];
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
  // Which measures to actually draw (spec §26 "Render only visible systems
  // where practical"; §29 virtualization for long scores): `undefined`
  // (render every measure) until the viewport has been measured at least
  // once (or is unmeasurable, e.g. jsdom's `clientHeight` is always 0),
  // then every measure belonging to a system whose logical-unit span
  // intersects the scrolled viewport (plus overscan) — see
  // `measureViewport`. Held directly as state (rather than a separate
  // `{top, bottom}` viewport + derived memo) so `measureViewport` can bail
  // out of the state update entirely via `sameMeasureIndices` when a scroll
  // doesn't actually change the visible set, without a stale second value
  // to keep in sync.
  const [visibleMeasureIndices, setVisibleMeasureIndices] = useState<Set<number> | undefined>(undefined);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<VexFlowScoreRenderer | null>(null);
  if (!rendererRef.current) rendererRef.current = new VexFlowScoreRenderer();
  const resultRef = useRef<RenderResult | null>(null);
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
   * only inside *this* spliced score's `RenderResult` — rendering the
   * committed score and merely asking `applyHighlights` to color
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
    const width = containerRef.current?.clientWidth || DEFAULT_WIDTH;
    return computeLayout(displayScore, { zoom, layoutMode, width, theme: renderTheme });
  }, [displayScore, zoom, layoutMode, renderTheme]);

  /** Which measures of `plan` intersect the scrollable ancestor's current scroll position (grid-local/logical units, padded by `VIRTUALIZATION_OVERSCAN_PX`), or `undefined` if the container isn't measurable right now (`clientHeight <= 0` — jsdom, or not yet laid out). Pure w.r.t. its arguments; reads live DOM geometry off `scrollBoxRef`, not React state, so it's safe to call synchronously from either an effect or a callback without worrying about state staleness. */
  const measureVisibleIndices = useCallback(
    (plan: LayoutPlan): Set<number> | undefined => {
      const el = scrollBoxRef.current;
      if (!el || el.clientHeight <= 0) return undefined;
      const overscan = VIRTUALIZATION_OVERSCAN_PX / zoom;
      return visibleSystemMeasureIndices(
        plan,
        { top: el.scrollTop / zoom, bottom: (el.scrollTop + el.clientHeight) / zoom },
        overscan,
      );
    },
    [zoom],
  );

  /**
   * Re-measures the viewport against `layoutPlan` and updates
   * `visibleMeasureIndices` — but only when the freshly-computed
   * visible-measure set actually differs (by value, via `sameMeasureIndices`)
   * from the currently-applied one. Returning the *same* object reference
   * from a state updater is a standard React bail-out: no re-render (and so
   * no re-run of the draw effect below) happens for a scroll that stays
   * within the same system(s) plus overscan (Task 17 review finding).
   * Used by `handleScroll` (below) for scroll-driven updates; the *initial*
   * measurement for a brand-new `layoutPlan` (mount, or a score/zoom/
   * layoutMode/theme change) is instead handled inline by the draw effect
   * itself — see `measuredForPlanRef`'s doc comment for why a separate
   * "measure on mount" effect can't reliably avoid a wasted first draw.
   */
  const measureViewport = useCallback(() => {
    if (!layoutPlan) return;
    const next = measureVisibleIndices(layoutPlan);
    if (next === undefined) return;
    setVisibleMeasureIndices((prev) => (prev && sameMeasureIndices(prev, next) ? prev : next));
  }, [layoutPlan, measureVisibleIndices]);

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

  /**
   * Which `layoutPlan` the draw effect below has already measured a fresh
   * `visibleMeasureIndices` for (a plain ref, deliberately *not* mirrored
   * into React state — see below). `null` initially (nothing measured
   * yet).
   *
   * Why this exists: a naive separate "measure on mount/layout-change"
   * `useLayoutEffect` calling `setVisibleMeasureIndices` does *not*
   * actually prevent the draw effect's first invocation from running with
   * the pre-measurement value — React runs a commit's own passive effects
   * (`useEffect`, including the draw effect) using *that commit's*
   * committed state, even when an earlier `useLayoutEffect` in the same
   * commit already queued a state update; the update only takes effect on
   * the *next* commit's effects, so the draw effect still fires once with
   * `undefined` (i.e. "render everything") before a second, corrected
   * commit's draw effect run catches up (confirmed empirically while
   * building this fix — the two effects do not coalesce). The fix is for
   * the draw effect to measure *itself*, inline, synchronously, whenever
   * it notices `layoutPlan` changed since the last measurement — so its
   * very first `render()` call for a new plan already uses a fresh,
   * correct value instead of a stale or absent one.
   *
   * Critically, this inline measurement is tracked only via this ref, not
   * by also calling `setVisibleMeasureIndices` (which — since
   * `visibleMeasureIndices` is itself one of this effect's own
   * dependencies — would schedule a second commit whose draw effect run
   * (now satisfying `measuredForPlanRef.current === layoutPlan`) draws
   * again with the *same* value: correct, but a second wasted `render()`
   * call, the exact per-mount waste this fix exists to eliminate).
   * `visibleMeasureIndices` state remains reserved for exactly one thing:
   * `measureViewport`'s scroll-driven updates (Task 17 review finding 2)
   * — a genuine visible-set change from scrolling should trigger a redraw
   * via state changing, but the effect's own first-run-per-plan
   * measurement should not roundtrip through state to render correctly.
   */
  const measuredForPlanRef = useRef<LayoutPlan | null>(null);

  // Full render: only on score/zoom/layoutMode/theme/visible-window changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !displayScore) return;

    // See `measuredForPlanRef`'s doc comment: if `layoutPlan` changed since
    // the last measurement (mount, or a score/zoom/layoutMode/theme
    // change), `visibleMeasureIndices` state is either stale (measured
    // against a *previous* plan) or was never set at all — measure fresh,
    // right here (ref-only, not persisted to state), so this draw call
    // already reflects a real viewport whenever one is measurable, without
    // waiting for a second, corrective render.
    let effectiveVisibleMeasureIndices = visibleMeasureIndices;
    if (layoutPlan && measuredForPlanRef.current !== layoutPlan) {
      effectiveVisibleMeasureIndices = measureVisibleIndices(layoutPlan);
      measuredForPlanRef.current = layoutPlan;
    }

    const width = container.clientWidth || DEFAULT_WIDTH;
    // `displayScore` (committed score, or committed+candidate while
    // previewing) is what's actually drawn, so the preview fragment's ids
    // land in this `RenderResult` and `previewIds` below has something to
    // highlight (spec §13 — see `displayScore`'s doc comment).
    const result = rendererRef.current!.render(displayScore, container, {
      zoom,
      layoutMode,
      width,
      theme: renderTheme,
      visibleMeasureIndices: effectiveVisibleMeasureIndices,
    });
    resultRef.current = result;
    applyHighlights(result, { selectedIds: selection.eventIds, playingIds: activeNoteIds, previewIds });
    // selection/activeNoteIds/previewIds are intentionally excluded here —
    // the effect below re-paints highlights on their own change without
    // triggering this full re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayScore, zoom, layoutMode, renderTheme, layoutPlan, measureVisibleIndices, visibleMeasureIndices]);

  // Highlight-only repaint: selection/playback/preview changes never re-render.
  useEffect(() => {
    const result = resultRef.current;
    if (!result) return;
    applyHighlights(result, { selectedIds: selection.eventIds, playingIds: activeNoteIds, previewIds });
  }, [selection, activeNoteIds, previewIds]);

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

    const container = containerRef.current;
    if (!container || !score) return;
    const measureId = currentMeasureId(score, positionTick);
    if (!measureId || measureId === lastScrolledMeasureRef.current) return;

    // Computed straight from the memoized `layoutPlan` (not
    // `resultRef.current.measureIdToBBox`) so this still finds the target
    // measure's position even when virtualization (spec §26/§29) hasn't
    // rendered it yet — e.g. jumping to a measure several systems below the
    // current scroll position. Scrolling there will itself fire `onScroll`
    // (`handleScroll` -> `measureViewport`), which brings that measure into
    // the rendered/culled window on the next pass.
    const measureIndex = score.tracks[0]?.measures.findIndex((m) => m.id === measureId) ?? -1;
    if (measureIndex === -1 || !layoutPlan) return;
    const bbox = boxForMeasureIndex(layoutPlan, 0, measureIndex);
    if (!bbox) return;

    lastScrolledMeasureRef.current = measureId;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({
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

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      const target = event.target as Element;
      const group = target.closest('[id^="vf-"]');
      if (!group?.id) return;
      const rawId = group.id.slice('vf-'.length);
      const result = resultRef.current;
      if (!result) return;

      // While a regeneration candidate is being previewed (spec §13),
      // `displayScore` (and so this click's `result`) is the committed
      // score with the candidate spliced in — clicking anywhere in the
      // canvas must not dispatch a selection/edit against ids that may not
      // even exist in the committed score (the fragment's own fresh ids
      // never do). Simplest safe rule: ignore canvas clicks entirely while
      // previewing; accepting/rejecting/switching candidates is done from
      // the generation panel, not by clicking the notation.
      if (previewFragment) return;

      if (result.idToElement.has(rawId)) {
        const state = store.getState();
        if (event.shiftKey) state.toggleEvent(rawId);
        else state.setSelection({ eventIds: [rawId], measureIds: [], trackIds: [] });
      } else if (result.measureIdToBBox.has(rawId)) {
        selectMeasure(store, rawId);
      }
    },
    [store, previewFragment],
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
      const target = event.target as Element;
      if (target.closest('[id^="vf-"]')) return; // a direct note/measure click; handleClick owns it
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
            const nextIds = drag.additive ? Array.from(new Set([...state.selection.eventIds, ...hitIds])) : hitIds;
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
          className="h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        />
        {dragBox && (
          <div
            data-testid="drag-selection-box"
            style={{ left: dragBox.x, top: dragBox.y, width: dragBox.width, height: dragBox.height }}
            className="pointer-events-none absolute border border-dashed border-primary bg-theme-hover-bg"
          />
        )}
      </div>
    </div>
  );
}
