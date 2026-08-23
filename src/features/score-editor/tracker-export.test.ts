/**
 * Score -> module -> bytes -> module -> score.
 *
 * The tracker export spec's strongest automated check, and it costs nothing
 * because both halves already exist. Round-tripping the *module* (music_io's
 * `xm-write.test.ts`) proves the byte layout; this proves the musical
 * conversion either side of it, which is where a grid or channel mistake would
 * hide.
 *
 * It lives in music_app rather than beside the writer because it needs
 * music_lib *and* music_io at once. Those two are mutually dependent as dev
 * dependencies, so a test inside either one pins the other to a version that
 * has not been published yet — which breaks the release order. music_app
 * depends on both and is released last, so it is the one place this can sit.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  scoreToTracker,
  trackerToScore,
  threeTrackScore,
  pitchToMidi,
  decodeTracker,
  encodeTracker,
} from '@sudobility/music_lib';
import type { Score } from '@sudobility/music_types';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';

function midiNotes(score: Score): number[] {
  const out: number[] = [];
  for (const track of score.tracks) {
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if ('pitch' in event) out.push(pitchToMidi(event.pitch));
        }
      }
    }
  }
  return out.sort((a, b) => a - b);
}

describe('XM export round trip', () => {
  beforeEach(() => installTestAppServices());
  afterEach(() => resetTestAppServices());

  const original = threeTrackScore();

  const roundTrip = (): {
    returned: Score;
    report: ReturnType<typeof scoreToTracker>['report'];
  } => {
    const { module, report } = scoreToTracker(original, { format: 'xm' });
    return {
      returned: trackerToScore(decodeTracker(encodeTracker(module))),
      report,
    };
  };

  it('loses nothing on the way out', () => {
    // If this fails the rest of the comparison is meaningless — a lossy export
    // is allowed, but this fixture is meant to fit XM exactly.
    expect(roundTrip().report).toEqual({
      clampedNotes: 0,
      droppedVoices: 0,
      droppedShortNotes: 0,
      quantisedNotes: 0,
    });
  });

  it('brings back every note at its original pitch', () => {
    expect(midiNotes(roundTrip().returned)).toEqual(midiNotes(original));
  });

  it('brings back one track per instrument', () => {
    expect(roundTrip().returned.tracks).toHaveLength(original.tracks.length);
  });

  it('keeps the instrument names, which is what the empty slots carry', () => {
    expect(
      roundTrip()
        .returned.tracks.map((t) => t.name)
        .sort(),
    ).toEqual(original.tracks.map((t) => t.instrumentName).sort());
  });

  it('keeps the tempo, which lives in cells rather than the header', () => {
    // trackerToScore reads speed/bpm only from cells; a header-only tempo would
    // come back as the 125 BPM default.
    expect(roundTrip().returned.tempoMap[0].bpm).toBe(original.tempoMap[0].bpm);
  });
});
