/**
 * Playback controller (spec §10, §22, Task 13 brief): the single bridge
 * between the Zustand store and a `PlaybackEngine`. `playback-slice` is
 * data-only (see its own doc comment) — this module is where that data
 * actually becomes sound, and where engine callbacks flow back into the
 * store.
 *
 * `createPlaybackController(engine, store)` is the testable factory
 * (matching `features/score-editor/editing.ts`'s `EditorStoreApi` DI
 * convention); `playbackController` is the ready-made singleton the app
 * uses, wired to a real `TonePlaybackEngine` and the app-wide
 * `useAppStore`. Every mutating method here is meant to be called
 * directly by UI (`components/transport/TransportBar.tsx`), not dispatched
 * as a store action — playback is real-time device control, not score
 * history.
 */
import { TonePlaybackEngine } from '@/adapters/tone/tone-engine';
import type { PlaybackEngine } from '@/services/playback/types';
import { scoreEndTick } from '@/domain/score/queries';
import { selectionToRange } from '@/domain/selection/selection';
import type { ScoreRange } from '@/domain/selection/types';
import type { Score } from '@/domain/score/types';
import { useAppStore } from '@/store/useAppStore';
import type { createAppStore } from '@/store/useAppStore';

/** The store shape this module operates on: same type `useAppStore`/`createAppStore()` produce (matches `features/score-editor/editing.ts`'s `EditorStoreApi`). */
export type PlaybackStoreApi = ReturnType<typeof createAppStore>;

/** The measure a domain tick falls in, on the score's first track (every track shares the same measure grid once `rebuildMeasureTicks` has run — same convention as `store/selectors.ts`). `null` if the score has no measures. */
function measureAt(score: Score, tick: number) {
  const track = score.tracks[0];
  if (!track || track.measures.length === 0) return null;
  return (
    track.measures.find((m) => tick >= m.startTick && tick < m.startTick + m.durationTicks) ??
    track.measures[track.measures.length - 1]
  );
}

export class PlaybackController {
  private readonly unsubscribe: () => void;
  /**
   * Bumped by every `handleScoreChange` call and by `dispose()`. Rapid
   * successive score changes (e.g. two edits dispatched back-to-back) each
   * start their own `handleScoreChange`, and since `engine.loadScore`/
   * `engine.play` are async, an *older* call's continuation can still be
   * in flight when a *newer* one starts. Each call captures its own
   * generation and checks it again after `await engine.loadScore(...)`;
   * a stale (superseded) call aborts before its final `engine.play(...)` —
   * the load itself is left to complete (harmless: the next, newer call's
   * `loadScore` immediately overwrites it), but only the newest call is
   * allowed to resume playback, so a burst of edits produces exactly one
   * `engine.play()` reflecting the final score, not one per edit.
   */
  private scoreChangeGeneration = 0;
  /**
   * Set while a burst of one or more overlapping `handleScoreChange` calls
   * owes a resume once the *last* of them finishes loading. Captured
   * explicitly rather than re-derived from `store.getState().state`/
   * `positionTick` after the fact: the real engine's `stop()` synchronously
   * fires `onStateChange('stopped')`/`onPositionTick(0)` through this
   * controller's own observer wiring, so a second `handleScoreChange` call
   * arriving right after the first one's `engine.stop()` would otherwise
   * see `state: 'stopped'`/`positionTick: 0` and wrongly conclude nothing
   * needs to resume (see `handleScoreChange`'s doc for the full story).
   */
  private pendingResume: { tick: number } | null = null;

  constructor(
    private readonly engine: PlaybackEngine,
    private readonly store: PlaybackStoreApi,
  ) {
    engine.setObserver({
      onPositionTick: (tick) => this.store.getState().setPositionTick(tick),
      onActiveNotes: (ids) => this.store.getState().setActiveNoteIds(ids),
      onStateChange: (state) => this.store.getState().setPlaybackState(state),
    });

    let lastScore: Score | null = this.store.getState().score;
    // Routed through the same guarded `handleScoreChange` path as every
    // later change (try/catch -> error toast on a rejected loadScore),
    // rather than a bare fire-and-forget `engine.loadScore(...)` — a
    // corrupt initial score must not surface as an unhandled rejection.
    if (lastScore) void this.handleScoreChange(lastScore);

    this.unsubscribe = this.store.subscribe((state) => {
      if (state.score !== lastScore) {
        lastScore = state.score;
        if (lastScore) void this.handleScoreChange(lastScore);
      }
    });
  }

  /** Releases the store subscription and disposes the engine; only meaningful for a controller that isn't the app-wide singleton (e.g. tests). */
  dispose(): void {
    this.scoreChangeGeneration++; // invalidate any handleScoreChange still in flight so it won't call engine.play() post-dispose
    this.pendingResume = null;
    this.unsubscribe();
    this.engine.dispose();
  }

  // ---- transport ---------------------------------------------------------

  togglePlay(): void {
    const { state, score } = this.store.getState();
    if (!score) return;
    if (state === 'playing') {
      this.engine.pause();
    } else {
      this.engine.play().catch((error: unknown) => this.reportError('Playback failed to start', error));
    }
  }

  stop(): void {
    this.engine.stop();
  }

  seek(tick: number): void {
    if (!this.store.getState().score) return;
    this.engine.seek(Math.max(0, tick));
  }

  seekToMeasure(measureIndex: number): void {
    const score = this.store.getState().score;
    const measure = score?.tracks[0]?.measures.find((m) => m.index === measureIndex);
    if (!measure) return;
    this.seek(measure.startTick);
  }

  goToStart(): void {
    this.seek(0);
  }

  previousMeasure(): void {
    const { score, positionTick } = this.store.getState();
    if (!score) return;
    const current = measureAt(score, positionTick);
    if (!current) return;
    this.seekToMeasure(Math.max(0, current.index - 1));
  }

  nextMeasure(): void {
    const { score, positionTick } = this.store.getState();
    if (!score) return;
    const current = measureAt(score, positionTick);
    if (!current) return;
    const lastIndex = score.tracks[0].measures.length - 1;
    this.seekToMeasure(Math.min(lastIndex, current.index + 1));
  }

  // ---- loop ---------------------------------------------------------------

  private setLoop(range: ScoreRange | null): void {
    this.store.getState().setLoopRange(range);
    this.engine.setLoop(range);
  }

  /** Sets the loop range from the current selection (spec §22); a no-op if the selection has no resolvable tick extent. */
  setLoopFromSelection(): void {
    const { score, selection } = this.store.getState();
    if (!score) return;
    const range = selectionToRange(score, selection);
    if (!range) return;
    this.setLoop(range);
  }

  clearLoop(): void {
    this.setLoop(null);
  }

  /** The transport's single "loop toggle" control (spec §22): clears an active loop, or sets one (from the selection, falling back to the whole score) when none is active. */
  toggleLoop(): void {
    const { score, loopRange, selection } = this.store.getState();
    if (loopRange) {
      this.clearLoop();
      return;
    }
    if (!score) return;
    const range = selectionToRange(score, selection) ?? { startTick: 0, endTick: scoreEndTick(score), trackIds: [] };
    this.setLoop(range);
  }

  // ---- tempo / metronome / volume ------------------------------------------

  setTempoMultiplier(multiplier: number): void {
    this.store.getState().setTempoMultiplier(multiplier);
    this.engine.setTempoMultiplier(multiplier);
  }

  setMetronome(enabled: boolean): void {
    this.store.getState().setMetronome(enabled);
    this.engine.setMetronome(enabled);
  }

  setMasterVolume(volume: number): void {
    this.store.getState().setMasterVolume(volume);
    this.engine.setMasterVolume(volume);
  }

  // ---- internals ------------------------------------------------------------

  /**
   * Reschedules the engine after the store's `score` reference changes
   * (any edit, undo/redo, MIDI/MusicXML import, generation accept, or a
   * freshly opened project — `score-slice`'s `dispatchCommand`/`undo`/
   * `redo`/`setScore` all produce a new `Score` object). If playback was
   * in progress, this is a "stop, reload, seek back, resume" so the
   * rebuilt schedule reflects the edit cleanly rather than leaving stale
   * Transport events or stuck voices from the old score (spec §10:
   * "reschedule safely after edits").
   *
   * Resume intent is captured into `pendingResume` up front, *before*
   * `engine.stop()` runs, and only consumed (cleared + turned into
   * `engine.play(tick)`) by whichever call is still current once its
   * `loadScore` resolves — never re-derived from the store afterward. Two
   * things would otherwise go wrong for a burst of rapid score changes: (1)
   * the real engine's `stop()` synchronously flips the store's `state`/
   * `positionTick` back to `'stopped'`/`0` via the observer wiring, so a
   * second call reading the store *after* the first call's `stop()` would
   * wrongly conclude nothing was playing and silently drop the resume
   * entirely; (2) `scoreChangeGeneration`'s own doc explains why a stale
   * call must not act on an old score — but the resume it was carrying
   * still needs to reach the call that *does* end up current, which is
   * exactly what leaving `pendingResume` set (rather than clearing it) on
   * an aborted/superseded call accomplishes.
   */
  private async handleScoreChange(score: Score): Promise<void> {
    const generation = ++this.scoreChangeGeneration;

    const shouldResume = this.pendingResume !== null || this.store.getState().state === 'playing';
    if (shouldResume && !this.pendingResume) {
      this.pendingResume = { tick: this.store.getState().positionTick };
    }

    try {
      if (shouldResume) this.engine.stop();
      await this.engine.loadScore(score);
      if (generation !== this.scoreChangeGeneration) return; // superseded by a newer score change; that newer call (not this one) owns consuming pendingResume
      if (this.pendingResume) {
        const { tick } = this.pendingResume;
        this.pendingResume = null;
        await this.engine.play(tick);
      }
    } catch (error) {
      this.reportError('Failed to load the score for playback', error);
    }
  }

  private reportError(message: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    this.store.getState().pushToast({ message: `${message}: ${detail}`, severity: 'error' });
  }
}

export function createPlaybackController(engine: PlaybackEngine, store: PlaybackStoreApi): PlaybackController {
  return new PlaybackController(engine, store);
}

/** The app's single running controller, wired to the real Tone engine and the app-wide store. */
export const playbackController: PlaybackController = createPlaybackController(new TonePlaybackEngine(), useAppStore);
