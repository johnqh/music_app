import { describe, expect, it } from 'vitest';
import { pitchToMidi, twinkleScore, twoTrackScore } from '@sudobility/music_lib';
import { isNoteEvent } from '@sudobility/music_types';
import type { NoteEvent, Score } from '@sudobility/music_types';
import { playingPitchesForTrack } from '@/features/piano-roll/playing-pitches';

function firstNote(score: Score, trackIndex = 0): NoteEvent {
  for (const measure of score.tracks[trackIndex].measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (isNoteEvent(event)) return event;
      }
    }
  }
  throw new Error('fixture has no notes');
}

describe('playingPitchesForTrack', () => {
  it('is empty when nothing is playing', () => {
    const score = twinkleScore();
    expect(playingPitchesForTrack(score, [], score.tracks[0].id).size).toBe(0);
  });

  it('is empty when there is no active track', () => {
    const score = twinkleScore();
    expect(playingPitchesForTrack(score, [firstNote(score).id], null).size).toBe(0);
  });

  it('returns the midi of a sounding note on the active track', () => {
    const score = twinkleScore();
    const note = firstNote(score);
    const pitches = playingPitchesForTrack(score, [note.id], score.tracks[0].id);
    expect(pitches.has(pitchToMidi(note.pitch))).toBe(true);
  });

  it('ignores sounding notes on other tracks', () => {
    const score = twoTrackScore();
    const trackOneNote = firstNote(score, 1);
    // Sounding on track 1, but track 0 is active — the key must stay dark.
    expect(playingPitchesForTrack(score, [trackOneNote.id], score.tracks[0].id).size).toBe(0);
  });

  it('picks out only the active track from a mixed sounding set', () => {
    const score = twoTrackScore();
    const zero = firstNote(score, 0);
    const one = firstNote(score, 1);
    const pitches = playingPitchesForTrack(score, [zero.id, one.id], score.tracks[0].id);
    expect(pitches.has(pitchToMidi(zero.pitch))).toBe(true);
    expect(pitches.size).toBe(1);
  });

  it('ignores ids that no longer resolve', () => {
    const score = twinkleScore();
    expect(playingPitchesForTrack(score, ['gone'], score.tracks[0].id).size).toBe(0);
  });
});
