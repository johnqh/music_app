import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppStore } from '@/store/useAppStore';
import { ScoreSmithDb } from '@/services/persistence/db';
import { twinkleScore, twoTrackScore } from '@/test/fixtures';
import { addMeasureCommand } from '@/domain/commands/structure-commands';
import { createPlaybackController, PlaybackController } from '@/services/playback/controller';
import type { PlaybackStoreApi } from '@/services/playback/controller';
import type { PlaybackEngine, PlaybackObserver } from '@/services/playback/types';

let db: ScoreSmithDb;
let dbCounter = 0;

function makeStore(): PlaybackStoreApi {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-controller-${dbCounter}`);
  return createAppStore({ db });
}

afterEach(async () => {
  await db?.delete();
});

/** A fully-spied `PlaybackEngine` fake — no Tone.js/real engine involved; the engine's own behavior is tested in `tone-engine.test.ts`. This suite only exercises the controller's orchestration. */
function createFakeEngine(): PlaybackEngine {
  return {
    initialize: vi.fn(async () => {}),
    loadScore: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setTempoMultiplier: vi.fn(),
    setLoop: vi.fn(),
    setTrackMute: vi.fn(),
    setTrackSolo: vi.fn(),
    setMetronome: vi.fn(),
    setMasterVolume: vi.fn(),
    setObserver: vi.fn(),
    dispose: vi.fn(),
  };
}

function observerOf(engine: PlaybackEngine): PlaybackObserver {
  const call = (engine.setObserver as ReturnType<typeof vi.fn>).mock.calls[0];
  return call[0] as PlaybackObserver;
}

/** Drains every pending microtask (safer than a fixed number of `await Promise.resolve()` hops when multiple overlapping async chains are in flight). */
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

let controller: PlaybackController | null = null;

afterEach(() => {
  controller?.dispose();
  controller = null;
});

describe('PlaybackController: construction and score subscription', () => {
  it('eagerly loads an already-present score at construction', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();

    controller = createPlaybackController(engine, store);

    expect(engine.loadScore).toHaveBeenCalledTimes(1);
    expect(engine.loadScore).toHaveBeenCalledWith(store.getState().score);
  });

  it('loads a score set after construction via the store subscription', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    expect(engine.loadScore).not.toHaveBeenCalled();

    store.getState().setScore(twinkleScore());

    expect(engine.loadScore).toHaveBeenCalledTimes(1);
  });

  it('does not reload for store changes that leave `score` untouched', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    vi.mocked(engine.loadScore).mockClear();

    store.getState().setMasterVolume(0.5);

    expect(engine.loadScore).not.toHaveBeenCalled();
  });

  it('reschedules with stop -> loadScore -> play(resumeTick) when the score changes while playing', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    vi.mocked(engine.loadScore).mockClear();

    store.getState().setPlaybackState('playing');
    store.getState().setPositionTick(960);
    const callOrder: string[] = [];
    vi.mocked(engine.stop).mockImplementation(() => callOrder.push('stop'));
    vi.mocked(engine.loadScore).mockImplementation(async () => {
      callOrder.push('loadScore');
    });
    vi.mocked(engine.play).mockImplementation(async (fromTick) => {
      callOrder.push(`play:${fromTick}`);
    });

    store.getState().dispatchCommand(addMeasureCommand());
    await Promise.resolve();
    await Promise.resolve();

    expect(callOrder).toEqual(['stop', 'loadScore', 'play:960']);
  });

  it('does not stop/resume when the score changes while stopped', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    vi.mocked(engine.loadScore).mockClear();

    store.getState().dispatchCommand(addMeasureCommand());

    expect(engine.loadScore).toHaveBeenCalledTimes(1);
    expect(engine.stop).not.toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
  });

  it('a rejected loadScore for the initial (already-present) score pushes an error toast, not an unhandled rejection', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    vi.mocked(engine.loadScore).mockRejectedValueOnce(new Error('corrupt score'));

    controller = createPlaybackController(engine, store);
    await flushAsync();

    const toast = store.getState().toasts.at(-1);
    expect(toast?.severity).toBe('error');
    expect(toast?.message).toContain('corrupt score');
  });

  it('two rapid score changes while playing produce exactly one resume, reflecting only the final score', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    await flushAsync();
    vi.mocked(engine.loadScore).mockClear();
    vi.mocked(engine.stop).mockClear();
    vi.mocked(engine.play).mockClear();

    store.getState().setPlaybackState('playing');
    store.getState().setPositionTick(480);

    // Two score changes dispatched back-to-back, before either's loadScore() has resolved.
    store.getState().dispatchCommand(addMeasureCommand());
    const scoreA = store.getState().score;
    store.getState().dispatchCommand(addMeasureCommand());
    const scoreB = store.getState().score;

    await flushAsync();

    expect(engine.loadScore).toHaveBeenCalledTimes(2);
    expect(engine.loadScore).toHaveBeenNthCalledWith(1, scoreA);
    expect(engine.loadScore).toHaveBeenNthCalledWith(2, scoreB);
    // Only the newest (scoreB) change is allowed to resume playback — the
    // stale scoreA continuation aborts after noticing a newer generation.
    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(engine.play).toHaveBeenCalledWith(480);
  });
});

describe('PlaybackController: observer wiring', () => {
  it('forwards onPositionTick/onActiveNotes/onStateChange into the store', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);
    const observer = observerOf(engine);

    observer.onPositionTick(480);
    observer.onActiveNotes(['note-1', 'note-2']);
    observer.onStateChange('playing');

    expect(store.getState().positionTick).toBe(480);
    expect(store.getState().activeNoteIds).toEqual(['note-1', 'note-2']);
    expect(store.getState().state).toBe('playing');
  });
});

describe('PlaybackController: play/pause/stop', () => {
  it('togglePlay calls engine.play() when stopped', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.togglePlay();

    expect(engine.play).toHaveBeenCalledTimes(1);
    expect(engine.pause).not.toHaveBeenCalled();
  });

  it('togglePlay calls engine.pause() when playing', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    store.getState().setPlaybackState('playing');
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.togglePlay();

    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(engine.play).not.toHaveBeenCalled();
  });

  it('togglePlay is a no-op with no score loaded', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.togglePlay();

    expect(engine.play).not.toHaveBeenCalled();
  });

  it('pushes an error toast if engine.play() rejects', async () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    vi.mocked(engine.play).mockRejectedValue(new Error('no audio device'));
    controller = createPlaybackController(engine, store);

    controller.togglePlay();
    await Promise.resolve();
    await Promise.resolve();

    const toast = store.getState().toasts.at(-1);
    expect(toast?.severity).toBe('error');
    expect(toast?.message).toContain('no audio device');
  });

  it('stop() delegates to the engine', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.stop();

    expect(engine.stop).toHaveBeenCalledTimes(1);
  });
});

describe('PlaybackController: seeking', () => {
  it('seek() delegates to the engine when a score is loaded', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.seek(123);

    expect(engine.seek).toHaveBeenCalledWith(123);
  });

  it('seek() is a no-op without a score', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.seek(123);

    expect(engine.seek).not.toHaveBeenCalled();
  });

  it('seekToMeasure() seeks to the measure start tick', () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.seekToMeasure(2);

    expect(engine.seek).toHaveBeenCalledWith(score.tracks[0].measures[2].startTick);
  });

  it('goToStart() seeks to tick 0', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.goToStart();

    expect(engine.seek).toHaveBeenCalledWith(0);
  });

  it('nextMeasure()/previousMeasure() step by one measure, clamped to the score bounds', () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    store.getState().setPositionTick(score.tracks[0].measures[1].startTick);
    controller.nextMeasure();
    expect(engine.seek).toHaveBeenLastCalledWith(score.tracks[0].measures[2].startTick);

    store.getState().setPositionTick(score.tracks[0].measures[1].startTick);
    controller.previousMeasure();
    expect(engine.seek).toHaveBeenLastCalledWith(score.tracks[0].measures[0].startTick);

    // clamps at the first measure
    store.getState().setPositionTick(0);
    controller.previousMeasure();
    expect(engine.seek).toHaveBeenLastCalledWith(score.tracks[0].measures[0].startTick);

    // clamps at the last measure
    const lastMeasure = score.tracks[0].measures.at(-1)!;
    store.getState().setPositionTick(lastMeasure.startTick);
    controller.nextMeasure();
    expect(engine.seek).toHaveBeenLastCalledWith(lastMeasure.startTick);
  });
});

describe('PlaybackController: loop', () => {
  it('setLoopFromSelection sets the loop from a resolvable selection', () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    const firstNoteId = score.tracks[0].measures[0].voices[0].events[0].id;
    store.getState().setSelection({ eventIds: [firstNoteId], measureIds: [], trackIds: [] });
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.setLoopFromSelection();

    expect(store.getState().loopRange).not.toBeNull();
    expect(engine.setLoop).toHaveBeenCalledWith(store.getState().loopRange);
  });

  it('setLoopFromSelection is a no-op when nothing is selected', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.setLoopFromSelection();

    expect(store.getState().loopRange).toBeNull();
    expect(engine.setLoop).not.toHaveBeenCalled();
  });

  it('toggleLoop sets a whole-score loop with nothing selected, then clears it', () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.toggleLoop();
    expect(store.getState().loopRange).toEqual({ startTick: 0, endTick: expect.any(Number), trackIds: [] });

    controller.toggleLoop();
    expect(store.getState().loopRange).toBeNull();
    expect(engine.setLoop).toHaveBeenLastCalledWith(null);
  });
});

describe('PlaybackController: tempo / metronome / master volume', () => {
  it('setTempoMultiplier updates the store and the engine', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.setTempoMultiplier(1.5);

    expect(store.getState().tempoMultiplier).toBe(1.5);
    expect(engine.setTempoMultiplier).toHaveBeenCalledWith(1.5);
  });

  it('setMetronome updates the store and the engine', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.setMetronome(true);

    expect(store.getState().metronome).toBe(true);
    expect(engine.setMetronome).toHaveBeenCalledWith(true);
  });

  it('setMasterVolume updates the store and the engine', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    controller = createPlaybackController(engine, store);

    controller.setMasterVolume(0.6);

    expect(store.getState().masterVolume).toBe(0.6);
    expect(engine.setMasterVolume).toHaveBeenCalledWith(0.6);
  });
});

describe('PlaybackController.dispose', () => {
  it('disposes the engine and stops reacting to further score changes', () => {
    const store = makeStore();
    const engine = createFakeEngine();
    const c = createPlaybackController(engine, store);

    c.dispose();
    store.getState().setScore(twoTrackScore());

    expect(engine.dispose).toHaveBeenCalledTimes(1);
    expect(engine.loadScore).not.toHaveBeenCalled();
  });
});
