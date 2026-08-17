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
import { useCallback, useSyncExternalStore } from 'react';
import { playbackController } from '@sudobility/music_lib';
import type { SoundingNote } from '@sudobility/music_types';

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
 * The notes currently sounding, with their track and pitch already resolved.
 *
 * Resolved by the scheduler, which knew them when it queued the notes. Reading
 * only ids meant every consumer searched the whole score to get them back:
 * `playingPitchesForTrack` was an O(score) scan per sounding note, twenty times
 * a second.
 */
export function useSoundingNotes(): readonly SoundingNote[] {
  const subscribe = useCallback(
    (onChange: () => void) => playbackController.bus.onSounding(onChange),
    [],
  );
  const get = useCallback(() => playbackController.bus.sounding, []);
  return useSyncExternalStore(subscribe, get, get);
}
