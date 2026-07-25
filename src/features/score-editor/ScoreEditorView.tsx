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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import { applyHighlights, VexFlowScoreRenderer } from '@/adapters/vexflow/renderer';
import type { BBox, RenderResult, RenderTheme } from '@/adapters/vexflow/types';
import { boxForMeasureIndex, computeLayout, visibleSystemMeasureIndices } from '@/adapters/vexflow/layout';
import type { ScoreFragment } from '@/domain/score/fragment';
import type { Score } from '@/domain/score/types';
import { useAppStore } from '@/store/useAppStore';
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

/** Spec §27 (reduced-motion support): `true` when the user's OS/browser prefers reduced motion. Guarded for jsdom/SSR, where `matchMedia` doesn't exist. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function ScoreEditorView({ store = useAppStore }: ScoreEditorViewProps) {
  useEditorShortcuts(store);
  const muiTheme = useTheme();

  const score = store((s) => s.score);
  const selection = store((s) => s.selection);
  const zoom = store((s) => s.zoom);
  const activeNoteIds = store((s) => s.activeNoteIds);
  const previewFragment = store((s) => s.previewFragment);
  const playbackState = store((s) => s.state);
  const positionTick = store((s) => s.positionTick);

  const [layoutMode, setLayoutMode] = useState<LayoutMode>('page');
  const [dragBox, setDragBox] = useState<BBox | null>(null);
  // Screen-pixel scroll viewport of the scrollable ancestor (`scrollBoxRef`),
  // used to cull off-screen systems (spec §26/§29). `null` means "not yet
  // measured" (or unmeasurable, e.g. jsdom's `clientHeight` is always 0) —
  // treated as "render everything" rather than guessing an empty viewport;
  // see `visibleMeasureIndices` below.
  const [viewport, setViewport] = useState<{ top: number; bottom: number } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollBoxRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<VexFlowScoreRenderer | null>(null);
  if (!rendererRef.current) rendererRef.current = new VexFlowScoreRenderer();
  const resultRef = useRef<RenderResult | null>(null);
  const dragStateRef = useRef<{ start: Point; moved: boolean; additive: boolean } | null>(null);
  const suppressNextClickRef = useRef(false);
  const lastScrolledMeasureRef = useRef<string | null>(null);
  const lastScrolledScoreRef = useRef<Score | null>(null);

  const renderTheme: RenderTheme = useMemo(
    () => ({
      foreground: muiTheme.palette.text.primary,
      selection: muiTheme.palette.primary.main,
      playback: muiTheme.palette.success.main,
      preview: muiTheme.palette.warning.main,
    }),
    [muiTheme],
  );

  const previewIds = useMemo(() => previewEventIds(previewFragment), [previewFragment]);

  /**
   * Re-measures `scrollBoxRef`'s scroll position/height into `viewport`
   * (spec §26/§29 virtualization). A `clientHeight <= 0` (jsdom, or a
   * container that hasn't been laid out yet) leaves `viewport` at its
   * current value rather than recording a bogus zero-height range — see
   * `viewport`'s doc comment.
   */
  const measureViewport = useCallback(() => {
    const el = scrollBoxRef.current;
    if (!el || el.clientHeight <= 0) return;
    setViewport({ top: el.scrollTop, bottom: el.scrollTop + el.clientHeight });
  }, []);

  // Re-measure once after every score/zoom/layoutMode change (a fresh score
  // may reset scroll position, and zoom/layoutMode change what a given
  // scrollTop range actually covers) — real browsers get an accurate
  // viewport for the very first render, not just after the user's first
  // scroll.
  useEffect(() => {
    measureViewport();
  }, [measureViewport, score, zoom, layoutMode]);

  /**
   * Which measures to actually draw (spec §26 "Render only visible systems
   * where practical"; §29 virtualization for long scores): `undefined`
   * (render every measure) until `viewport` has been measured at least
   * once, then every measure belonging to a system whose logical-unit span
   * intersects the scrolled viewport (plus overscan), per
   * `layout.ts`'s `visibleSystemMeasureIndices`. Recomputing `computeLayout`
   * here is cheap (pure geometry, no VexFlow/DOM work) relative to the
   * actual draw it lets `render()` skip.
   */
  const visibleMeasureIndices = useMemo(() => {
    if (!score || !viewport) return undefined;
    const width = containerRef.current?.clientWidth || DEFAULT_WIDTH;
    const plan = computeLayout(score, { zoom, layoutMode, width, theme: renderTheme });
    const overscan = VIRTUALIZATION_OVERSCAN_PX / zoom;
    return visibleSystemMeasureIndices(plan, { top: viewport.top / zoom, bottom: viewport.bottom / zoom }, overscan);
  }, [score, viewport, zoom, layoutMode, renderTheme]);

  // Full render: only on score/zoom/layoutMode/theme/visible-window changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !score) return;
    const width = container.clientWidth || DEFAULT_WIDTH;
    const result = rendererRef.current!.render(score, container, {
      zoom,
      layoutMode,
      width,
      theme: renderTheme,
      visibleMeasureIndices,
    });
    resultRef.current = result;
    applyHighlights(result, { selectedIds: selection.eventIds, playingIds: activeNoteIds, previewIds });
    // selection/activeNoteIds/previewIds are intentionally excluded here —
    // the effect below re-paints highlights on their own change without
    // triggering this full re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, zoom, layoutMode, renderTheme, visibleMeasureIndices]);

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

    // Computed straight from layout (not `resultRef.current.measureIdToBBox`)
    // so this still finds the target measure's position even when
    // virtualization (spec §26/§29) hasn't rendered it yet — e.g. jumping
    // to a measure several systems below the current scroll position.
    // Scrolling there will itself update `viewport` (via the scroll
    // handler), which brings that measure into the rendered/culled window
    // on the next pass.
    const measureIndex = score.tracks[0]?.measures.findIndex((m) => m.id === measureId) ?? -1;
    if (measureIndex === -1) return;
    const width = container.clientWidth || DEFAULT_WIDTH;
    const plan = computeLayout(score, { zoom, layoutMode, width, theme: renderTheme });
    const bbox = boxForMeasureIndex(plan, 0, measureIndex);
    if (!bbox) return;

    lastScrolledMeasureRef.current = measureId;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({
        left: Math.max(0, bbox.x * zoom - SCROLL_MARGIN),
        top: Math.max(0, bbox.y * zoom - SCROLL_MARGIN),
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
  }, [score, positionTick, playbackState, zoom, layoutMode, renderTheme]);

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

      if (result.idToElement.has(rawId)) {
        const state = store.getState();
        if (event.shiftKey) state.toggleEvent(rawId);
        else state.setSelection({ eventIds: [rawId], measureIds: [], trackIds: [] });
      } else if (result.measureIdToBBox.has(rawId)) {
        selectMeasure(store, rawId);
      }
    },
    [store],
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

      setDragBox(null);
      dragStateRef.current = null;
    },
    [pointFromEvent, store],
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <EditorToolbar store={store} layoutMode={layoutMode} onLayoutModeChange={setLayoutMode} />
      <Box
        ref={scrollBoxRef}
        data-testid="score-editor-scroll"
        onScroll={measureViewport}
        sx={{ position: 'relative', flex: 1, overflow: 'auto', minHeight: CONTAINER_MIN_HEIGHT }}
      >
        <Box
          ref={containerRef}
          data-testid="score-editor-canvas"
          role="region"
          aria-label="Score notation"
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          sx={{ width: '100%', height: '100%' }}
        />
        {dragBox && (
          <Box
            data-testid="drag-selection-box"
            sx={{
              position: 'absolute',
              left: dragBox.x,
              top: dragBox.y,
              width: dragBox.width,
              height: dragBox.height,
              border: '1px dashed',
              borderColor: 'primary.main',
              backgroundColor: 'action.selected',
              pointerEvents: 'none',
            }}
          />
        )}
      </Box>
    </Box>
  );
}
