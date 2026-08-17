/**
 * Which keyboard keys light up during playback: the MIDI pitches currently
 * sounding on the active track.
 *
 * The engine reports sounding notes with their track and pitch already
 * resolved — it knew both when it scheduled them — so this is a filter over
 * data it was handed. It used to take bare note ids and call `findEvent` for
 * each, which is a linear scan of every track, measure and voice in the score,
 * run twenty times a second. On a large score that alone was measurable CPU.
 */
import type { SoundingNote, UUID } from '@sudobility/music_types';

export function playingPitchesForTrack(
  sounding: readonly SoundingNote[],
  trackId: UUID | null,
): Set<number> {
  const pitches = new Set<number>();
  if (!trackId) return pitches;
  for (const note of sounding) {
    // Lighting a key for a note the user cannot see would be noise, not
    // information — the keyboard shows one track.
    if (note.trackId === trackId) pitches.add(note.midi);
  }
  return pitches;
}
