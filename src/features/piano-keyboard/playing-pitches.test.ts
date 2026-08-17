import { describe, expect, it } from 'vitest';
import type { SoundingNote } from '@sudobility/music_types';
import { playingPitchesForTrack } from '@/features/piano-keyboard/playing-pitches';

const sounding = (noteId: string, trackId: string, midi: number): SoundingNote => ({
  noteId,
  trackId,
  midi,
});

describe('playingPitchesForTrack', () => {
  it('is empty when nothing is playing', () => {
    expect(playingPitchesForTrack([], 'track-0').size).toBe(0);
  });

  it('is empty when there is no active track', () => {
    expect(playingPitchesForTrack([sounding('n1', 'track-0', 60)], null).size).toBe(0);
  });

  it('returns the midi of a sounding note on the active track', () => {
    const pitches = playingPitchesForTrack([sounding('n1', 'track-0', 67)], 'track-0');
    expect(pitches.has(67)).toBe(true);
  });

  it('ignores sounding notes on other tracks', () => {
    // Sounding on track 1, but track 0 is active — the key must stay dark.
    expect(playingPitchesForTrack([sounding('n1', 'track-1', 60)], 'track-0').size).toBe(0);
  });

  it('picks out only the active track from a mixed sounding set', () => {
    const pitches = playingPitchesForTrack(
      [sounding('a', 'track-0', 60), sounding('b', 'track-1', 72)],
      'track-0',
    );
    expect(pitches.has(60)).toBe(true);
    expect(pitches.size).toBe(1);
  });

  it('collapses two voices sounding the same pitch on one track', () => {
    const pitches = playingPitchesForTrack(
      [sounding('a', 'track-0', 60), sounding('b', 'track-0', 60)],
      'track-0',
    );
    expect(pitches.size).toBe(1);
  });
});
