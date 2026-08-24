/**
 * The playback caret: the red line that follows the music, and the scrolling
 * that keeps it on screen.
 *
 * Its own module because it is its own *subscriber*. The engine reports
 * position at 30Hz, and while `ScoreEditorView` read that at its own top level
 * the entire view re-rendered thirty times a second during playback,
 * re-running every memo and rebuilding every callback — on the same thread the
 * audio schedules on. Keeping it here makes that separation structural rather
 * than a comment somebody has to notice.
 *
 * Two things in here are load-bearing and easy to undo by accident:
 * the caret **interpolates** between position reports rather than being driven
 * by them, and it writes a `transform` straight to the DOM rather than going
 * through React. Both have measurements behind them in the project's notes.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { TRACK_INFO_WIDTH, boxForMeasureIndex, caretPositionForTick } from '@sudobility/music_lib';
import { usePlaybackPosition } from '@/features/score-editor/usePlayback';
import { getMusicPosition } from '@sudobility/music_lib';
import { prefersReducedMotion } from '@/app/theme';
import type { LayoutPlan, Score } from '@sudobility/music_lib';
import { playbackScrollTarget } from '@/features/score-editor/playback-scroll';
import type { EditorStoreApi } from '@sudobility/music_lib';
import type { LayoutMode } from '@/features/score-editor/EditorToolbar';

/** How much clear space to keep between the caret and the edge it is nearing. */
const SCROLL_MARGIN = 40;

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
export function PlaybackCaret({
  store,
  plan,
  score,
  zoom,
  color,
  layoutMode,
  scrollBoxRef,
}: PlaybackCaretProps) {
  // From the bus, not the store — this is the ~30Hz value the whole split
  // exists to keep out of Zustand. Still isolated to this component for the
  // same reason it always was: reading it higher up re-renders the notation.
  const positionTick = usePlaybackPosition();
  const playbackState = store((s) => s.state);
  const elementRef = useRef<HTMLDivElement | null>(null);
  /*
    The one playhead. A module singleton, so this is stable for the component's
    life and safe in a dependency array; `useMemo` only keeps a test that
    resets the registry between cases from holding a dead instance.
  */
  const musicPosition = useMemo(() => getMusicPosition(), []);

  /*
    The fermata-aware tempo map is **not** derived here any more.

    The caret used to project through it itself, which meant this component
    had to know that a pause is expressed as a local slowing rather than as
    longer notes. That knowledge now sits with the playhead in music_lib,
    which is fed the rate the engine is actually running at — from
    `playbackPlan`'s own tempo conversion, so there is nothing left here to
    disagree with it.
  */

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

  useLayoutEffect(() => {
    // While playing, the loop below owns the caret; re-applying here would
    // snap it back to the last 30Hz sample between frames.
    if (playbackState !== 'playing') applyGeometry(musicPosition.tick);
  }, [positionTick, playbackState, applyGeometry, musicPosition]);

  /**
   * Repaints the caret every frame from the shared position.
   *
   * The smoothing itself is **not** here any more. The engine samples position
   * at 30Hz through Tone's lookahead scheduling loop, so its reports arrive in
   * clumps rather than evenly every 33ms, and something has to project between
   * them or the caret lurches. That projection now lives in music_lib's
   * `IMusicPosition` implementation, which is fed by the playback bus at the
   * moment the engine reports — so the elapsed time it measures is time since
   * the *audio clock*, not time since a React effect happened to run.
   *
   * That distinction is the bug this fixes. Interpolating here anchored on
   * receipt time, which folds in however long the event loop took to deliver
   * the report; the note highlighting and the piano keyboard read the engine's
   * sounding set directly and carry no such delay. Under load the caret
   * drifted ahead of the notes it was supposed to be pointing at. There is now
   * one playhead and every reader of it gets the same number.
   */
  useEffect(() => {
    if (playbackState !== 'playing') return;
    let frame = 0;
    const step = (): void => {
      applyGeometry(musicPosition.tick);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playbackState, applyGeometry, musicPosition]);

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
        applyGeometry(musicPosition.tick);
      });
    };
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      box.removeEventListener('scroll', onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
    // `musicPosition.tick` is read inside the scroll handler, not captured:
    // it is a live getter on a singleton, and listing it would re-attach the
    // listener on every position change to no purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const lastPlaybackStateRef = useRef(playbackState);
  /*
    Dev-only tracing for following playback.

    Position reports arrive ~30Hz, so an unconditional log would bury the one
    line that matters and put console work on the thread the scheduler runs on.
    Every line is therefore keyed by what it is *about* — the stage and the
    measure — and repeats of the same key are dropped: a decision taken once
    per measure logs once per measure, and a silent early return logs the first
    time it happens rather than thirty times a second.

    The early returns are logged at all because that is where following
    playback fails silently: each one leaves the sheet stationary and says
    nothing, which is indistinguishable from "no move was needed".
  */
  const lastTraceRef = useRef<string>('');
  const traceScroll = useCallback(
    (stage: string, detail: Record<string, unknown> = {}): void => {
      if (!import.meta.env.DEV) return;
      const key = `${stage}|${String(detail.measureIndex ?? detail.measureId ?? '')}|${playbackState}`;
      if (key === lastTraceRef.current) return;
      lastTraceRef.current = key;
      const box = scrollBoxRef.current;
      console.log(
        `[playback-scroll] ${stage}`,
        'position:',
        { tick: positionTick, state: playbackState, ...detail },
        'scroll:',
        box
          ? {
              top: Math.round(box.scrollTop),
              left: Math.round(box.scrollLeft),
              viewportH: box.clientHeight,
              viewportW: box.clientWidth,
            }
          : 'no scroll box',
      );
    },
    [positionTick, playbackState, scrollBoxRef],
  );
  useEffect(() => {
    if (score !== lastScrolledScoreRef.current) {
      lastScrolledScoreRef.current = score;
      lastScrolledMeasureRef.current = null;
    }
    /*
      Following the playhead is not only a playback behaviour.

      Dragging the scrubber moves the playhead exactly as playing does, and
      dragging it somewhere off screen and being left looking at the old page
      is the same failure as the sheet not following the music. So the rule is
      simply: when the playhead moves somewhere the reader cannot see, go
      there.

      The one exception is the transport *changing state*, which is not a
      navigation. Stopping homes the playhead to the beginning, and taking the
      page to bar 1 because playback ended would throw away the place of
      anybody who stopped in order to work on the bar they were listening to.
      Pausing is the same: it moves nothing and must move nothing. Starting is
      deliberately not excluded — a play is a request to be shown the music
      about to sound.
    */
    const transportChanged = lastPlaybackStateRef.current !== playbackState;
    lastPlaybackStateRef.current = playbackState;
    if (playbackState !== 'playing' && transportChanged) {
      lastScrolledMeasureRef.current = null;
      traceScroll('idle (transport changed)');
      return;
    }

    const scrollBox = scrollBoxRef.current;
    if (!scrollBox || !score || !plan) {
      traceScroll('skip: no scroll box, score or plan', {
        hasScrollBox: Boolean(scrollBox),
        hasScore: Boolean(score),
        hasPlan: Boolean(plan),
      });
      return;
    }
    const measureId = currentMeasureId(score, positionTick);
    if (!measureId) {
      traceScroll('skip: tick is in no measure');
      return;
    }
    if (measureId === lastScrolledMeasureRef.current) return;
    // Read off the memoized plan rather than the drawn window's bbox map, so
    // this still finds a measure lying outside the currently-drawn window.
    const measureIndex = score.tracks[0]?.measures.findIndex((m) => m.id === measureId) ?? -1;
    if (measureIndex === -1) {
      traceScroll('skip: measure not in track 0', { measureId });
      return;
    }
    const bbox = boxForMeasureIndex(plan, 0, measureIndex);
    if (!bbox) {
      traceScroll('skip: measure has no box in plan', { measureIndex });
      return;
    }

    // Deliberately not `bbox.y`: that is track 1's stave, so following playback
    // used to snap whatever track the reader was watching back off the top of
    // the viewport on every wrap.
    const target = playbackScrollTarget({
      plan,
      layoutMode,
      zoom,
      measureIndex,
      measureX: bbox.x,
      measureWidth: bbox.width,
      scrollLeft: scrollBox.scrollLeft,
      viewportWidth: scrollBox.clientWidth,
      scrollTop: scrollBox.scrollTop,
      viewportHeight: scrollBox.clientHeight,
      margin: SCROLL_MARGIN,
    });
    // Marked handled whether or not it produces a move: the decision is made
    // once per measure, and re-running it on every 30Hz position report would
    // put work back on the thread Tone.js schedules on.
    lastScrolledMeasureRef.current = measureId;
    if (!target) {
      traceScroll('no move needed', { measureIndex, layoutMode });
      return;
    }
    traceScroll('scrolling', {
      measureIndex,
      layoutMode,
      targetTop: Math.round(target.top),
      targetLeft: Math.round(target.left),
    });

    if (typeof scrollBox.scrollTo === 'function') {
      /*
        Animate a wrap; jump a relocation.

        Smooth scrolling is right for the ordinary case — one system to the
        next, a short hop the reader can follow with their eye. It is wrong
        for a move longer than the viewport, and the way it fails is the
        reported "playback stops following after the score reaches the end":
        stopping leaves the sheet at the last system, so the replay's first
        target is the whole score away. The animation eases over that
        distance, the next measure arrives before it lands and issues a fresh
        `scrollTo` that restarts it from wherever it had reached, and the
        target itself has moved on a system by then. Measured in the test
        beside this: the sheet covered a few dozen pixels per measure against
        a four-thousand-pixel deficit, so it never arrived and the music
        finished first.

        A move further than one viewport is not a wrap the reader is
        following, it is the page going somewhere else — which is what a jump
        is for, and what "play from here" already does.
      */
      const relocating =
        Math.abs(target.top - scrollBox.scrollTop) > scrollBox.clientHeight ||
        Math.abs(target.left - scrollBox.scrollLeft) > scrollBox.clientWidth;
      scrollBox.scrollTo({
        left: target.left,
        top: target.top,
        behavior: prefersReducedMotion() || relocating ? 'auto' : 'smooth',
      });
    }
  }, [score, positionTick, playbackState, plan, zoom, layoutMode, scrollBoxRef, traceScroll]);

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
