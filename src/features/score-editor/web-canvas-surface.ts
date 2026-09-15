/**
 * The web half of the score canvas: pixels, a DOM caret and a scroll box.
 *
 * `ScoreCanvas` in music_drawing owns every geometric decision — the layout,
 * the units, where the cursor is at a tick, what is under a point, where
 * following playback scrolls — and asks a platform *surface* only to put the
 * result on screen (see music_drawing's `docs/score-canvas.md`). This is that
 * surface for a browser. It deliberately knows nothing about ticks, bars or
 * zoom beyond replaying what it is handed: the web and native apps used to each
 * compute the caret themselves and drifted apart, and a surface that computes
 * nothing has nothing to drift.
 *
 * Three jobs:
 *
 * - **paint** renders with one long-lived `CanvasScoreRenderer` into the score
 *   canvas's 2D context. Long-lived because its column cache is what makes a
 *   repaint of the same window cheap. It paints in two layers
 *   (`createLayeredPaint`): everything but the active track's notes goes to an
 *   offscreen canvas kept until something other than the lit notes changes,
 *   and each frame copies that in and draws the active track over it — so a
 *   change of lit notes during playback draws one track, not the window.
 * - **showCursor** moves the caret `<div>` along the path it is given. The
 *   div is an absolutely positioned child of the scroll box, so it lives in
 *   content coordinates and scrolls with the sheet; it is moved by `transform`
 *   rather than `left`/`top`, because a layout property forced a layout pass on
 *   every frame of playback.
 * - **scrollTo** follows the music, animated only when the canvas says the move
 *   is short enough to follow with the eye and the reader has not asked for
 *   reduced motion.
 */
import {
  CanvasScoreRenderer,
  createLayeredPaint,
  cursorTickAt,
  cursorVisible,
  cursorXAt,
} from '@sudobility/music_drawing';
import type {
  CanvasScheduler,
  CursorMotion,
  CursorPath,
  ScoreCanvasSurface,
} from '@sudobility/music_drawing';
import { prefersReducedMotion } from '@/app/theme';

export type WebCanvasSurfaceOptions = {
  /** Read lazily: React attaches the elements after the surface is built. */
  canvas: () => HTMLCanvasElement | null;
  caret: () => HTMLElement | null;
  scrollBox: () => HTMLElement | null;
};

export type WebCanvasSurface = ScoreCanvasSurface & {
  /**
   * The view scrolled: re-evaluate whether a *held* caret is under the gutter.
   *
   * The canvas calls `showCursor` only when the path or the motion changes, and
   * a scroll changes neither — but whether the line is hidden behind the pinned
   * track info depends on the scroll offset. While the caret moves, its frame
   * loop re-evaluates that every frame anyway; while paused nothing else would,
   * and a caret left sitting over the track labels would stay there.
   */
  scrolled(): void;
  dispose(): void;
};

export function createWebCanvasSurface({
  canvas,
  caret,
  scrollBox,
}: WebCanvasSurfaceOptions): WebCanvasSurface {
  const renderer = new CanvasScoreRenderer();
  const layeredPaint = createLayeredPaint<HTMLCanvasElement>(renderer, {
    record(draw, previous) {
      const visible = canvas();
      const layer = previous ?? document.createElement('canvas');
      // Matched to the visible canvas's backing store, which a resize or a
      // change of pixel ratio moves.
      if (visible && layer.width !== visible.width) layer.width = visible.width;
      if (visible && layer.height !== visible.height) layer.height = visible.height;
      const context = layer.getContext('2d');
      if (context) draw(context);
      return layer;
    },
    present(base, drawOverlay) {
      const context = canvas()?.getContext('2d');
      if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, context.canvas.width, context.canvas.height);
      context.drawImage(base, 0, 0);
      drawOverlay(context);
    },
  });
  let path: CursorPath | null = null;
  let motion: CursorMotion = { tick: 0, atMs: 0, ticksPerSecond: 0 };
  let loop: number | null = null;

  const stopLoop = () => {
    if (loop !== null) {
      cancelAnimationFrame(loop);
      loop = null;
    }
  };

  /** One placement of the line, from the path and the clock. */
  const place = () => {
    const el = caret();
    if (!el) return;
    if (!path) {
      el.style.visibility = 'hidden';
      return;
    }
    const x = cursorXAt(path, cursorTickAt(motion, performance.now()));
    // Read the scroll offset BEFORE writing any style: reading it after a write
    // in the same frame forces a synchronous layout, on the loop that has to
    // stay smooth during playback.
    const scrollLeft = scrollBox()?.scrollLeft ?? 0;
    if (!cursorVisible(path, x, scrollLeft)) {
      el.style.visibility = 'hidden';
      return;
    }
    el.style.visibility = '';
    el.style.transform = `translate(${x}px, ${path.top}px) translateX(-50%)`;
    // Changes only when the caret crosses into a system of another height.
    const height = `${path.height}px`;
    if (el.style.height !== height) el.style.height = height;
  };

  return {
    paint(score, options, frame) {
      if (!canvas()?.getContext('2d')) return null;
      return layeredPaint(score, options, frame);
    },

    prepare: (score, options) => renderer.prepare(score, options),

    showCursor(nextPath, nextMotion) {
      path = nextPath;
      motion = nextMotion;
      stopLoop();
      place();
      if (!path || motion.ticksPerSecond <= 0) return;
      // The canvas describes the motion rather than a position per frame; this
      // replays it. It hands over a new path itself when the line reaches the
      // next system, so the loop never has to know where a system ends.
      const step = () => {
        place();
        loop = requestAnimationFrame(step);
      };
      loop = requestAnimationFrame(step);
    },

    scrollTo(target, how) {
      const box = scrollBox();
      // jsdom has no `Element.scrollTo`; nothing else in this path needs a guard.
      if (!box || typeof box.scrollTo !== 'function') return;
      box.scrollTo({
        left: target.left,
        top: target.top,
        behavior: how === 'smooth' && !prefersReducedMotion() ? 'smooth' : 'auto',
      });
    },

    scrolled() {
      if (loop === null) place();
    },

    dispose() {
      stopLoop();
      renderer.dispose();
    },
  };
}

/**
 * Frames and time for the canvas, from the browser.
 *
 * The globals are read at call time rather than captured, so a test that stubs
 * `requestAnimationFrame` is honoured.
 */
export const webCanvasScheduler: CanvasScheduler = {
  frame(callback) {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  },
  timeout(callback, ms) {
    const id = setTimeout(callback, ms);
    return () => clearTimeout(id);
  },
  now: () => performance.now(),
};
