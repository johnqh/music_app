/**
 * Following playback across the end of the score.
 *
 * The reported bug: play to the end, the position resets to 0, and on the next
 * press the sheet no longer follows. The scroll arithmetic
 * (`playback-scroll.ts`) is unit-tested on its own and is correct for that
 * case, so this drives the real component through the real sequence — engine
 * position reports on the bus, transport state in the store — against a stub
 * scroll box, and asserts on what it actually asks the box to do.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import {
  createAppStore,
  computeLayout,
  twinkleScore,
  playbackController,
  resetMusicPosition,
  testStoreContext,
} from '@sudobility/music_lib';
import { getMusicPositionSource } from '@sudobility/music_types';
import type { Score } from '@sudobility/music_types';
import { LIGHT_RENDER_THEME } from '@sudobility/music_drawing';
import { ScoreEditorView } from './ScoreEditorView';
import { installTestAppServices } from '@/test/app-services';

/*
  The same stub the AppLayout suite uses: a real `PlaybackBus` so position
  reports travel exactly as the engine sends them, with the transport itself
  inert. Constructing the genuine controller here would build a soundfont
  engine, which is neither available nor the thing under test.
*/
vi.mock('@sudobility/music_lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sudobility/music_lib')>();
  return {
    ...actual,
    playbackController: {
      bus: new actual.PlaybackBus(),
      togglePlay: vi.fn(),
      stop: vi.fn(),
      seek: vi.fn(),
    },
  };
});

/** A tall multi-system score: several systems, so following it has somewhere to go. */
function longScore(): Score {
  const base = twinkleScore();
  const track = base.tracks[0];
  const template = track.measures;
  const measures: Score['tracks'][number]['measures'] = [];
  for (let repeat = 0; repeat < 12; repeat += 1) {
    for (const measure of template) {
      const index = measures.length;
      const startTick = index * measure.durationTicks;
      const delta = startTick - measure.startTick;
      measures.push({
        ...measure,
        id: `${measure.id}-r${repeat}`,
        index,
        startTick,
        voices: measure.voices.map((voice) => ({
          ...voice,
          id: `${voice.id}-r${repeat}`,
          events: voice.events.map((event) => ({
            ...event,
            id: `${event.id}-r${repeat}`,
            startTick: event.startTick + delta,
            voiceId: `${voice.id}-r${repeat}`,
          })),
        })),
      });
    }
  }
  return { ...base, tracks: [{ ...track, measures }] };
}

/** What the editor lays out with in jsdom once the box reports 900px wide. */
const OPTS = {
  zoom: 1,
  layoutMode: 'page' as const,
  width: 900,
  theme: LIGHT_RENDER_THEME,
};

type AppStore = ReturnType<typeof createAppStore>;

/**
 * The transport changing state, as the player writes it: the store for the
 * toolbar and the edit lock, the shared position for everything that follows
 * the music — the playback binding among them.
 */
function setTransport(store: AppStore, state: 'playing' | 'stopped'): void {
  store.getState().setPlaybackState(state);
  getMusicPositionSource().setPlaying(state === 'playing');
}

/**
 * The editor over a stub scroll box: a 900x300 view whose `scrollTop` is a
 * plain number. `scrollTo` is supplied per test, and every scroll it makes
 * fires the box's `scroll` event, as a browser does — that event is how the
 * canvas learns where the view is.
 */
function renderEditor(
  store: AppStore,
  scrollTo: (opts: { top: number; behavior?: string }, current: number) => number,
) {
  const view = render(<ScoreEditorView store={store} />);
  const box = view.getByTestId('score-editor-scroll');
  Object.defineProperty(box, 'clientHeight', { value: 300, configurable: true });
  Object.defineProperty(box, 'clientWidth', { value: 900, configurable: true });
  let scrollTop = 0;
  Object.defineProperty(box, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v;
    },
    configurable: true,
  });
  Object.defineProperty(box, 'scrollLeft', { value: 0, configurable: true });
  box.scrollTo = ((opts: { top: number; behavior?: string }) => {
    scrollTop = scrollTo(opts, scrollTop);
    fireEvent.scroll(box);
  }) as never;
  fireEvent.scroll(box);
  return { box, scrollTop: () => scrollTop };
}

describe('the editor follows playback across the end of the score', () => {
  beforeEach(() => {
    installTestAppServices();
    // The playhead is a singleton, and the bus reads its reported tick through
    // it — so a position left behind by the previous case is still there, and
    // publishing that same value again is not a change and re-renders nothing.
    resetMusicPosition();
  });

  it('scrolls again on the play after the score has run to the end', async () => {
    const score = longScore();
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(score, { resetHistory: true });

    const scrollTo = vi.fn();
    renderEditor(store, (opts) => {
      scrollTo(opts);
      return opts.top;
    });

    const ticksPerMeasure = score.tracks[0].measures[0].durationTicks;
    const measureCount = score.tracks[0].measures.length;
    const playThrough = async () => {
      for (let i = 0; i < measureCount; i += 1) {
        await act(async () => {
          playbackController.bus.publishPosition(i * ticksPerMeasure);
        });
      }
    };

    await act(async () => {
      setTransport(store, 'playing');
    });
    await playThrough();
    const firstPass = scrollTo.mock.calls.length;
    expect(firstPass).toBeGreaterThan(0);

    // End of playback, exactly as the engine reports it: position home, then stopped.
    await act(async () => {
      playbackController.bus.publishPosition(0);
      setTransport(store, 'stopped');
    });

    scrollTo.mockClear();
    await act(async () => {
      setTransport(store, 'playing');
    });
    await playThrough();

    expect(scrollTo.mock.calls.length).toBeGreaterThan(0);
  });

  /*
    The reported bug, end to end: play to the end, let the transport stop and
    reset to tick 0, then play again — and watch whether the sheet comes back
    to the music.

    `scrollTo` here moves only part way per call, which is what `behavior:
    'smooth'` does in a browser and what the plain stub above cannot show. It
    is the whole mechanism: with a whole score to travel, an animated scroll is
    still in flight when the next measure re-issues it, and the sheet crawls
    while the music runs away from it.
  */
  it('brings the sheet back to the music when replaying after the end', async () => {
    const score = longScore();
    const plan = computeLayout(score, OPTS);
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(score, { resetHistory: true });

    const VIEWPORT = 300;
    // An animated scroll covers ground gradually; an instant one lands.
    const SMOOTH_STEP = 60;
    const editor = renderEditor(store, (opts, current) => {
      if (opts.behavior !== 'smooth') return opts.top;
      const delta = opts.top - current;
      return current + Math.sign(delta) * Math.min(Math.abs(delta), SMOOTH_STEP);
    });

    const ticksPerMeasure = score.tracks[0].measures[0].durationTicks;
    const measures = score.tracks[0].measures;
    const play = async (from: number, to: number) => {
      for (let i = from; i < to; i += 1) {
        await act(async () => {
          playbackController.bus.publishPosition(i * ticksPerMeasure);
        });
      }
    };

    await act(async () => {
      setTransport(store, 'playing');
    });
    await play(0, measures.length);
    expect(editor.scrollTop()).toBeGreaterThan(VIEWPORT);

    // Exactly what the engine does at the end: home the position, then stop.
    await act(async () => {
      playbackController.bus.publishPosition(0);
      setTransport(store, 'stopped');
    });

    await act(async () => {
      setTransport(store, 'playing');
    });
    await play(0, 3);

    // The music is in the first system, so the first system must be on screen.
    const firstSystem = plan.systems[0];
    expect(editor.scrollTop()).toBeLessThanOrEqual(firstSystem.yBottom);
  });

  /*
    Dragging the scrubber is a navigation, and the sheet has to go where it
    points. Following the playhead used to be gated on the transport actually
    playing, so scrubbing to a bar off screen moved the playhead there and left
    the reader looking at the page they were already on.
  */
  it('follows the playhead when the scrubber moves it off screen while stopped', async () => {
    const score = longScore();
    const plan = computeLayout(score, OPTS);
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(score, { resetHistory: true });

    const editor = renderEditor(store, (opts) => opts.top);

    // The transport never starts: this is somebody dragging the slider.
    expect(store.getState().state).not.toBe('playing');
    const measures = score.tracks[0].measures;
    const lastMeasure = measures[measures.length - 1];

    await act(async () => {
      playbackController.bus.publishPosition(lastMeasure.startTick);
    });

    const lastSystem = plan.systems[plan.systems.length - 1];
    expect(editor.scrollTop()).toBeGreaterThan(0);
    expect(editor.scrollTop() + 300).toBeGreaterThanOrEqual(lastSystem.yTop);
  });

  /*
    Stopping is not a navigation. It homes the playhead to the beginning, and
    taking the page with it would lose the place of anybody who stopped in
    order to work on the bar they had been listening to.
  */
  it('stays put when the transport stops and homes the playhead', async () => {
    const score = longScore();
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(score, { resetHistory: true });

    const editor = renderEditor(store, (opts) => opts.top);

    const measures = score.tracks[0].measures;
    // Separately, as they arrive in life: the transport starts, then reports
    // come in. Batching both into one update hides which of them scrolled.
    await act(async () => {
      setTransport(store, 'playing');
    });
    await act(async () => {
      playbackController.bus.publishPosition(measures[measures.length - 1].startTick);
    });
    const whereTheReaderWas = editor.scrollTop();
    expect(whereTheReaderWas).toBeGreaterThan(0);

    await act(async () => {
      playbackController.bus.publishPosition(0);
      setTransport(store, 'stopped');
    });

    expect(editor.scrollTop()).toBe(whereTheReaderWas);
  });
});
