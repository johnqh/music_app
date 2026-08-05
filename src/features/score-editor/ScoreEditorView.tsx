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
 * Candidate preview (spec §13): while `generation-slice.previewFragment` is
 * set, the component draws `scoreWithCandidate(score, previewFragment)`
 * (`features/generation/preview.ts`) instead of the bare committed score —
 * see `displayScore`'s doc comment for why this is required, not just an
 * optimization. Clicking the canvas while previewing is a no-op (see
 * `handleClick`/`handlePointerUp`): the ids on screen may belong to the
 * spliced-in candidate rather than the committed score, so a click there
 * must never be allowed to drive a selection/edit.
 *
 * `renderTheme` picks between `LIGHT_RENDER_THEME`/`DARK_RENDER_THEME`
 * (`render-theme.ts`) off `resolveColorScheme(themeMode)`.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import {
  CanvasScoreRenderer,
  TRACK_INFO_WIDTH,
  TempoMap,
  playbackController,
  selectActiveTrackId,
  selectVisibleTrackIds,
} from '@sudobility/music_lib';
import type { BBox, CanvasRenderResult, RenderTheme } from '@sudobility/music_lib';
import {
  boxForMeasureIndex,
  caretPositionForTick,
  computeLayout,
  tickForPoint,
} from '@sudobility/music_lib';
import type { LayoutPlan, ScoreFragment } from '@sudobility/music_lib';
import { isNoteEvent } from '@sudobility/music_types';
import type { Pitch, Score } from '@sudobility/music_types';
import {
  changePitchCommand,
  findEvent,
  selectionSummaryLabel,
  shiftDiatonic,
} from '@sudobility/music_lib';
import { prefersReducedMotion, resolveColorScheme } from '@/app/theme';
import { scoreWithCandidate } from '@/features/generation/preview';
import { useAppStore } from '@sudobility/music_lib';
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
  measureIndexAtGutterPoint,
} from '@/features/score-editor/hit-test';
import type { Point } from '@/features/score-editor/hit-test';
import { buildNoteColors } from '@/features/score-editor/note-colors';
import { DARK_RENDER_THEME, LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';
import { noteIdsInTickRange } from '@/features/score-editor/range-select';
import { autoscrollDelta } from '@/features/score-editor/autoscroll';
import { trackIdAtGutterPoint } from '@/features/score-editor/track-gutter';
import { scoreWithPitch, stepsForDrag } from '@/features/score-editor/pitch-drag';
import { playbackScrollTarget } from '@/features/score-editor/playback-scroll';

export type ScoreEditorViewProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /** Inspector visibility, forwarded to the toolbar, which owns the toggle. Optional so tests can render the view alone. */
  inspectorOpen?: boolean;
  onToggleInspector?: () => void;
};

const DEFAULT_WIDTH = 900;
const CONTAINER_MIN_HEIGHT = 400;
/** Pixels of pointer movement before a pointerdown-drag counts as a box-select rather than a plain click. */
const DRAG_THRESHOLD = 3;
/** Padding (px) kept between the scrolled-to measure and the viewport edge. */
const SCROLL_MARGIN = 40;

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

type PlaybackCaretProps = {
  store: EditorStoreApi;
  plan: LayoutPlan | null;
  score: Score | null;
  zoom: number;
  color: string;
  /** Which way the score wraps, which decides how following playback scrolls. */
  layoutMode: LayoutMode;
  scrollBoxRef: React.RefObject<HTMLDivElement | null>;
};

/**
 * The playback caret, and the ONLY part of the editor that subscribes to
 * `positionTick`.
 *
 * The isolation is the whole point. The engine reports position at 30Hz, and
 * while `ScoreEditorView` read that at its own top level the entire view
 * re-rendered 30 times a second during playback, re-running every memo and
 * rebuilding every callback. Tone.js schedules on this same thread, so the
 * work turned into audible hesitation and a caret that stuttered rather than
 * glided. Same pattern the piano roll used for its own cursor.
 *
 * Scroll-into-view lives here for the same reason: it is driven by position
 * and needs nothing from the parent's render.
 */
function PlaybackCaret({
  store,
  plan,
  score,
  zoom,
  color,
  layoutMode,
  scrollBoxRef,
}: PlaybackCaretProps) {
  const positionTick = store((s) => s.positionTick);
  const playbackState = store((s) => s.state);
  const tempoMultiplier = store((s) => s.tempoMultiplier);
  const elementRef = useRef<HTMLDivElement | null>(null);

  const tempoMap = useMemo(() => (score ? new TempoMap(score.tempoMap, score.ppq) : null), [score]);

  /**
   * Writes the caret's geometry straight to the DOM, bypassing React.
   *
   * `transform`, not `left`/`top`: moving the caret through layout
   * properties forced a layout pass on every update. A transform stays on
   * the compositor. `height` only changes when the caret crosses into a new
   * system, so it is written only when it actually differs.
   *
   * The caret is an absolutely-positioned child of the scroll box, so it sits
   * in content coordinates *above* the canvas — including above the track-info
   * gutter, which the renderer pins to the viewport's left edge and paints over
   * the sheet. Left to itself the caret slid across the track info as though
   * the labels were part of the music, which is also what made it obvious that
   * the sheet continues underneath them. It hides there instead.
   */
  const applyGeometry = useCallback(
    (tick: number) => {
      const el = elementRef.current;
      if (!el || !plan || !score) return;
      const caret = caretPositionForTick(plan, score, tick);
      if (!caret) {
        el.style.visibility = 'hidden';
        return;
      }

      // Read the scroll offset BEFORE writing any style below. Reading it
      // after a write in the same frame would force a synchronous layout, on
      // the frame loop that has to stay smooth during playback.
      const scrollLeft = scrollBoxRef.current?.scrollLeft ?? 0;
      const x = caret.x * zoom;
      if (x - scrollLeft < TRACK_INFO_WIDTH * zoom) {
        el.style.visibility = 'hidden';
        return;
      }

      el.style.visibility = '';
      el.style.transform = `translate(${x}px, ${caret.yTop * zoom}px) translateX(-50%)`;
      const height = `${(caret.yBottom - caret.yTop) * zoom}px`;
      if (el.style.height !== height) el.style.height = height;
    },
    [plan, score, zoom, scrollBoxRef],
  );

  /**
   * The last position the engine reported, and when it arrived — the anchor
   * the animation loop dead-reckons from.
   */
  const anchorRef = useRef<{ tick: number; at: number }>({ tick: positionTick, at: 0 });
  useLayoutEffect(() => {
    anchorRef.current = { tick: positionTick, at: performance.now() };
    // While playing, the loop below owns the caret; re-applying here would
    // snap it back to the last 30Hz sample between frames.
    if (playbackState !== 'playing') applyGeometry(positionTick);
  }, [positionTick, playbackState, applyGeometry]);

  /**
   * Interpolates the caret between engine reports.
   *
   * The engine samples position at 30Hz through `Transport.scheduleRepeat`,
   * and those callbacks fire from Tone's lookahead scheduling loop rather
   * than a wall clock — so they arrive in clumps, not evenly every 33ms.
   * Driving the caret straight off them made it lurch. This projects the
   * position forward from the most recent anchor using elapsed real time and
   * the score's own tempo map, repainting every animation frame, so motion is
   * smooth and even however unevenly the anchors land. Each new anchor
   * silently corrects any drift.
   *
   * `tempoMultiplier` converts real elapsed time to score time: the engine
   * divides logical seconds by it, so one real second is `multiplier` logical
   * seconds.
   */
  useEffect(() => {
    if (playbackState !== 'playing' || !tempoMap) return;
    let frame = 0;
    const step = (): void => {
      const { tick, at } = anchorRef.current;
      const elapsedSeconds = (performance.now() - at) / 1000;
      applyGeometry(
        tempoMap.secondsToTicks(tempoMap.ticksToSeconds(tick) + elapsedSeconds * tempoMultiplier),
      );
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playbackState, tempoMap, tempoMultiplier, applyGeometry]);

  /**
   * Re-evaluate the caret when the reader scrolls while paused.
   *
   * Whether the caret is hidden behind the pinned gutter depends on the scroll
   * offset, and while paused nothing else re-runs `applyGeometry` — a caret
   * left sitting over the track info would stay there. During playback the
   * animation loop already re-evaluates every frame, so this stands down.
   */
  useEffect(() => {
    const box = scrollBoxRef.current;
    if (!box || playbackState === 'playing') return;
    let frame: number | null = null;
    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        applyGeometry(anchorRef.current.tick);
      });
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      box.removeEventListener('scroll', onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [applyGeometry, playbackState, scrollBoxRef]);

  // Scroll the active playback measure into view (spec §7 item 13).
  //
  // `lastScrolledMeasureRef` resets whenever playback isn't actively
  // `'playing'` (and whenever `score` itself changes) rather than only being
  // written on a successful scroll. Without the reset, stopping playback,
  // scrolling away manually, and restarting on the *same* measure would
  // silently no-op forever and the active measure would never re-enter view.
  const lastScrolledMeasureRef = useRef<string | null>(null);
  const lastScrolledScoreRef = useRef<Score | null>(null);
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
    if (!scrollBox || !score || !plan) return;
    const measureId = currentMeasureId(score, positionTick);
    if (!measureId || measureId === lastScrolledMeasureRef.current) return;

    // Read off the memoized plan rather than the drawn window's bbox map, so
    // this still finds a measure lying outside the currently-drawn window.
    const measureIndex = score.tracks[0]?.measures.findIndex((m) => m.id === measureId) ?? -1;
    if (measureIndex === -1) return;
    const bbox = boxForMeasureIndex(plan, 0, measureIndex);
    if (!bbox) return;

    // Deliberately not `bbox.y`: that is track 1's stave, so following playback
    // used to snap whatever track the reader was watching back off the top of
    // the viewport on every wrap.
    const target = playbackScrollTarget({
      plan,
      layoutMode,
      zoom,
      measureIndex,
      measureX: bbox.x,
      scrollTop: scrollBox.scrollTop,
      margin: SCROLL_MARGIN,
    });
    if (!target) return;

    lastScrolledMeasureRef.current = measureId;
    if (typeof scrollBox.scrollTo === 'function') {
      scrollBox.scrollTo({
        left: target.left,
        top: target.top,
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
  }, [score, positionTick, playbackState, plan, zoom, layoutMode, scrollBoxRef]);

  if (!plan || !score) return null;
  return (
    <div
      ref={elementRef}
      data-testid="playback-caret"
      aria-hidden="true"
      // Positioned at the origin and moved entirely by `transform`, which
      // `applyGeometry` writes; nothing here changes per frame.
      style={{ left: 0, top: 0, backgroundColor: color }}
      className="pointer-events-none absolute w-0.5"
    />
  );
}

export function ScoreEditorView({
  store = useAppStore,
  inspectorOpen,
  onToggleInspector,
}: ScoreEditorViewProps) {
  const clipboard = useClipboardPrompts(store);
  useEditorShortcuts(store, playbackController, clipboard);

  const score = store((s) => s.score);
  const selection = store((s) => s.selection);
  const zoom = store((s) => s.zoom);
  const activeNoteIds = store((s) => s.activeNoteIds);
  const previewFragment = store((s) => s.previewFragment);
  const themeMode = store((s) => s.themeMode);
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

  const previewIds = useMemo(() => previewEventIds(previewFragment), [previewFragment]);

  /**
   * Per-note colors for this frame. Preview-candidate ids color as
   * `regenerated` alongside a genuinely-regenerated selection: an unaccepted
   * candidate is the same "this is generated material" signal, and without
   * it a preview would be indistinguishable from committed notes (the old
   * dotted overlay stroke used to carry that).
   */
  const noteColors = useMemo(
    () =>
      buildNoteColors({
        selectedIds: [...selection.eventIds, ...previewIds],
        playingIds: activeNoteIds,
        regenerated: selectionRegenerated || previewIds.length > 0,
      }),
    [selection.eventIds, previewIds, activeNoteIds, selectionRegenerated],
  );

  const selectedMeasureIds = useMemo(() => new Set(selection.measureIds), [selection.measureIds]);

  // Mirrors of the two colour inputs, so `draw` can read the latest values
  // without taking them as dependencies (see the `draw` call site).
  const noteColorsRef = useRef(noteColors);
  noteColorsRef.current = noteColors;
  const selectedMeasureIdsRef = useRef(selectedMeasureIds);
  selectedMeasureIdsRef.current = selectedMeasureIds;

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
    const previewed = score && previewFragment ? scoreWithCandidate(score, previewFragment) : score;
    if (!previewed || !pitchDragRef.current || pitchDragSteps === 0) return previewed;
    // Live feedback for a pitch drag: the note is drawn where it would land, so
    // the reader aims at a staff position rather than guessing.
    return scoreWithPitch(
      previewed,
      pitchDragRef.current.eventId,
      shiftDiatonic(pitchDragRef.current.pitch, pitchDragSteps),
    );
  }, [score, previewFragment, pitchDragSteps]);

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
  useEffect(() => {
    const result = resultRef.current;
    // Before the first draw there is no window to compare against; the mount
    // effect above owns that paint.
    if (!result) return;

    let signature = '';
    for (const [id, role] of noteColors) {
      if (result.idToBBox.has(id)) signature += `${id}:${role};`;
    }
    for (const id of selectedMeasureIds) {
      if (result.measureIdToBBox.has(id)) signature += `m${id};`;
    }
    if (signature === paintedColorsRef.current) return;
    paintedColorsRef.current = signature;

    if (colorFrameRef.current !== null) return;
    colorFrameRef.current = requestAnimationFrame(() => {
      colorFrameRef.current = null;
      draw();
    });
  }, [noteColors, selectedMeasureIds, draw]);

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
      if (previewFragment) return;

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
          const measureIds = tracks
            .map((t) => t.measures[gutterIndex]?.id)
            .filter((id): id is string => id !== undefined);
          if (measureIds.length > 0) state.selectMeasures(measureIds);
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
          eventIds: noteIdsInTickRange(state.score, state.positionTick, clickedTick, scopeTrackIds),
          measureIds: [],
          trackIds: [],
          // The explicit range matters: regenerating a span of empty measures
          // must still work, and `selectionToRange` can't derive a span from
          // an empty eventIds list.
          range: {
            startTick: Math.min(state.positionTick, clickedTick),
            endTick: Math.max(state.positionTick, clickedTick),
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
    [store, previewFragment, seekToEventPoint, layoutPlan, displayScore, zoom, activeTrackId],
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

      // Exactly one note selected, and the press landed on it: this is a pitch
      // drag, not a selection box. Requiring the note to be selected first is
      // what keeps an ordinary click-and-drag on the staff a box select.
      const state = store.getState();
      const onlySelected =
        state.selection.eventIds.length === 1 ? state.selection.eventIds[0] : null;
      const result = resultRef.current;
      if (onlySelected && result && !previewFragment) {
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
    [pointFromEvent],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
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
    [pointFromEvent, stepAutoscroll],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
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
              changePitchCommand([pitchDrag.eventId], shiftDiatonic(pitchDrag.pitch, steps)),
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
    [pointFromEvent, store, previewFragment, stopAutoscroll, pitchDragSteps],
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
        title="Cut these notes"
        message="There is more music after them on this track."
        choices={[
          {
            value: 'silence' as const,
            label: 'Leave silence',
            detail: 'The rest of the track stays where it is',
            primary: true,
          },
          {
            value: 'close' as const,
            label: 'Close the gap',
            detail: 'Later notes on this track move earlier to fill it',
          },
        ]}
        onChoose={clipboard.resolveCut}
        onCancel={clipboard.cancel}
      />
      <ChoiceDialog
        open={clipboard.pendingPaste}
        title="Paste over this music"
        message="There is already something where this would land."
        choices={[
          {
            value: 'replace' as const,
            label: 'Replace',
            detail: 'What is there now is removed',
            primary: true,
          },
          {
            value: 'insert' as const,
            label: 'Insert',
            detail: 'What is there now moves later on this track',
          },
        ]}
        onChoose={clipboard.resolvePaste}
        onCancel={clipboard.cancel}
      />
      <EditorToolbar
        store={store}
        onCut={clipboard.requestCut}
        onPaste={clipboard.requestPaste}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        inspectorOpen={inspectorOpen}
        onToggleInspector={onToggleInspector}
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
          aria-label={`Score notation. ${selectionSummaryLabel(selection, selectionRegenerated)}.`}
          tabIndex={0}
          onClick={handleClick}
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
