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
import type { PlaybackBus } from '@/app-library';

/**
 * The playhead, as the engine last reported it. ~30Hz while playing, silent
 * otherwise.
 *
 * `bus` defaults to the app-wide `playbackController` singleton's — evaluated
 * lazily (an ordinary JS default parameter, only read when the caller omits
 * the argument), because merely *accessing* that singleton lazily constructs
 * a `PlaybackAdapter` bound to the real app-wide store, which throws where
 * that store was never initialized. A host with its own player and no
 * `PlaybackAdapter` (the published-snapshot page's `TransportBar`) passes the
 * raw player's own `bus` instead — a store-agnostic passthrough either way.
 */
export function usePlaybackPosition(bus: PlaybackBus = playbackController.bus): number {
  const subscribe = useCallback((onChange: () => void) => bus.onPosition(onChange), [bus]);
  const get = useCallback(() => bus.positionTick, [bus]);
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
 *
 * `bus` defaults the same way `usePlaybackPosition`'s does.
 */
export function usePlaybackReadout(
  format: (tick: number) => string,
  bus: PlaybackBus = playbackController.bus,
): string {
  const subscribe = useCallback((onChange: () => void) => bus.onPosition(onChange), [bus]);
  const get = () => format(bus.positionTick);
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
 *
 * `bus` defaults the same way `usePlaybackPosition`'s does.
 */
export function usePlayingPitches(
  activeTrackId: string | null,
  bus: PlaybackBus = playbackController.bus,
): ReadonlySet<number> {
  const subscribe = useCallback((onChange: () => void) => bus.onSounding(onChange), [bus]);
  const kept = useRef<ReadonlySet<number>>(NO_PITCHES);
  const get = useCallback(() => {
    const next = playingPitchesForTrack(bus.sounding, activeTrackId);
    if (!samePitchSet(next, kept.current)) kept.current = next;
    return kept.current;
  }, [bus, activeTrackId]);
  return useSyncExternalStore(subscribe, get, get);
}

const NO_PITCHES: ReadonlySet<number> = new Set();

function sameIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

const NO_TRACK_IDS: ReadonlySet<string> = new Set();

/**
 * Every track id with an active note right now — what the Spatial 3D view
 * (`@sudobility/music_spatial`) lights up. Same shape as
 * `usePlayingPitches`, collecting distinct `trackId`s across every track
 * rather than pitches for one — the Spatial view is meant to be looked at
 * with everything visible, not filtered to an active track the way the
 * piano keyboard is.
 *
 * `bus` defaults the same way `usePlaybackPosition`'s does. This package
 * (music_spatial) never reads the player itself — this is that boundary's
 * app-side half, the "caller supplies `soundingTrackIds`" its spec calls for.
 */
export function useSoundingTrackIds(
  bus: PlaybackBus = playbackController.bus,
): ReadonlySet<string> {
  const subscribe = useCallback((onChange: () => void) => bus.onSounding(onChange), [bus]);
  const kept = useRef<ReadonlySet<string>>(NO_TRACK_IDS);
  const get = useCallback(() => {
    if (bus.sounding.length === 0) {
      if (kept.current.size !== 0) kept.current = NO_TRACK_IDS;
      return kept.current;
    }
    const next = new Set<string>();
    for (const note of bus.sounding) next.add(note.trackId);
    if (!sameIdSet(next, kept.current)) kept.current = next;
    return kept.current;
  }, [bus]);
  return useSyncExternalStore(subscribe, get, get);
}
