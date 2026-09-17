/**
 * React bindings for `PlaybackBus`.
 *
 * Position and sounding notes are no longer in the store (see music_lib's
 * `services/playback/bus.ts`), so this is how a component reads them. Each hook
 * subscribes to one channel, which is the point: a readout that wants the
 * playhead must not re-render when a note starts, and the piano keyboard must
 * not re-render thirty times a second.
 *
 * `useSyncExternalStore` rather than `useState` + an effect: it is the API
 * built for exactly this, and it keeps the value consistent across a
 * concurrent render rather than tearing between two subscribers.
 *
 * **Still isolate these.** Putting `usePlaybackPosition()` at a large
 * component's top level costs that whole subtree a render per engine report,
 * exactly as `store((s) => s.positionTick)` used to. The difference is that it
 * is now a deliberate act rather than an ordinary-looking one.
 */
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { playbackController, playingPitchesForTrack, samePitchSet } from '@/app-library';

/** The playhead, as the engine last reported it. ~30Hz while playing, silent otherwise. */
export function usePlaybackPosition(): number {
  const subscribe = useCallback(
    (onChange: () => void) => playbackController.bus.onPosition(onChange),
    [],
  );
  const get = useCallback(() => playbackController.bus.positionTick, []);
  return useSyncExternalStore(subscribe, get, get);
}

/**
 * Text derived from the playhead, re-rendering only when the text changes.
 *
 * Position reports arrive thirty times a second, and a readout shows far less
 * than that: a bar and beat changes a few times a second and a timecode ten.
 * `useSyncExternalStore` compares snapshots, so handing it the *formatted* text
 * rather than the tick lets React skip every report that would print the same
 * thing. `format` is read at render, so a new score or tempo applies at once.
 */
export function usePlaybackReadout(format: (tick: number) => string): string {
  const subscribe = useCallback(
    (onChange: () => void) => playbackController.bus.onPosition(onChange),
    [],
  );
  const get = () => format(playbackController.bus.positionTick);
  return useSyncExternalStore(subscribe, get, get);
}

/**
 * The keys the active track is sounding, kept as the same set until one of
 * them changes.
 *
 * The bus reports on every note of every track, and a keyboard shows one: read
 * as the raw sounding notes, the whole row of keys re-rendered for notes it
 * does not show — on a dense multi-track score, most of them. `samePitchSet`
 * decides whether anything this keyboard draws moved.
 *
 * The notes arrive with their track and pitch already resolved by the
 * scheduler, so this is a filter rather than a search of the score.
 */
export function usePlayingPitches(activeTrackId: string | null): ReadonlySet<number> {
  const subscribe = useCallback(
    (onChange: () => void) => playbackController.bus.onSounding(onChange),
    [],
  );
  const kept = useRef<ReadonlySet<number>>(NO_PITCHES);
  const get = useCallback(() => {
    const next = playingPitchesForTrack(playbackController.bus.sounding, activeTrackId);
    if (!samePitchSet(next, kept.current)) kept.current = next;
    return kept.current;
  }, [activeTrackId]);
  return useSyncExternalStore(subscribe, get, get);
}

const NO_PITCHES: ReadonlySet<number> = new Set();
