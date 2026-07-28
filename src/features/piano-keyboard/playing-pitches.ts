/**
 * Which keyboard keys light up during playback: the MIDI pitches currently
 * sounding on the active track.
 *
 * `activeNoteIds` from the playback engine spans every track, so this filters
 * to the one the piano roll actually shows — lighting a key for a note the
 * user can't see would be noise, not information.
 */
import { findEvent, pitchToMidi } from '@sudobility/music_lib';
import { isNoteEvent } from '@sudobility/music_types';
import type { Score, UUID } from '@sudobility/music_types';

export function playingPitchesForTrack(
  score: Score,
  activeNoteIds: readonly string[],
  trackId: UUID | null,
): Set<number> {
  const pitches = new Set<number>();
  if (!trackId) return pitches;
  for (const id of activeNoteIds) {
    const event = findEvent(score, id);
    if (!event || !isNoteEvent(event) || event.trackId !== trackId) continue;
    pitches.add(pitchToMidi(event.pitch));
  }
  return pitches;
}
