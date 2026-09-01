/**
 * The half of the hit-test suite that needs music_lib.
 *
 * `hit-test.ts` itself moved to music_drawing when the React Native app needed
 * it too — see that file. These cases stayed behind because they set up their
 * scores with **commands** (`changeMeasureClefCommand`, `toggleOttavaCommand`)
 * and read `soundingPitchForDrawn`, all of which live in music_lib, which sits
 * above music_drawing. Constructing the same states by hand there would be a
 * second, unverified copy of what those commands do.
 */
import { describe, expect, it } from 'vitest';
import {
  changeMeasureClefCommand,
  computeLayout,
  isNoteEvent,
  soundingPitchForDrawn,
  testRenderTheme,
  toggleOttavaCommand,
  twinkleScore,
  pitchToMidi,
  trackWrittenTransposition,
} from '@sudobility/music_lib';
import {
  STAVE_POSITION_HEIGHT,
  STAVE_TOP_LINE_OFFSET,
  pitchAtStavePoint,
} from '@sudobility/music_drawing';
import type { Pitch } from '@sudobility/music_types';

describe('pitchAtStavePoint with a clef change', () => {
  it('reads the bar in the clef actually in force, not the track clef', () => {
    // The failure this prevents is silent and looks like a rounding error: the
    // renderer draws the changed bar in bass, the hit test resolves it in
    // treble, and a click places a note a sixth from the line under the
    // pointer. Both sides go through `effectiveClef` so they cannot diverge.
    const score = twinkleScore();
    const trackId = score.tracks[0].id;
    const changed = changeMeasureClefCommand(trackId, 1, 'bass', 'Clef').execute(score);

    const plan = computeLayout(changed, {
      zoom: 1,
      layoutMode: 'page',
      width: 1200,
      theme: testRenderTheme(),
    });
    const trackLayout = plan.trackLayouts[0];
    const first = trackLayout.measures.find((m) => m.measureIndex === 0);
    const changedBar = trackLayout.measures.find((m) => m.measureIndex === 1);
    expect(first).toBeTruthy();
    expect(changedBar).toBeTruthy();

    // The same staff position in each bar, so the clef is the only difference.
    const at = (m: NonNullable<typeof first>) =>
      pitchAtStavePoint(plan, changed, {
        x: m.box.x + m.box.width / 2,
        y: m.box.y + STAVE_TOP_LINE_OFFSET + STAVE_POSITION_HEIGHT * 2,
      });

    const inTreble = at(first!);
    const inBass = at(changedBar!);

    expect(inTreble?.pitch).toBeTruthy();
    expect(inBass?.pitch).toBeTruthy();
    expect(inBass!.pitch).not.toEqual(inTreble!.pitch);
  });
});

describe('soundingPitchForDrawn — inverting the display lenses', () => {
  it('is a no-op in concert mode with no bracket', () => {
    // Almost every call. The stored pitch must be exactly what was clicked.
    const score = twinkleScore();
    const drawn: Pitch = { step: 'C', accidental: 0, octave: 4 };
    expect(soundingPitchForDrawn(score, score.tracks[0].id, 0, drawn, 'concert')).toEqual(drawn);
  });

  it('adds the octave back inside an 8va, in concert mode too', () => {
    // The bracket is part of the notation, not a way of reading it, so
    // `ottavaScore` applies in every mode — and so must its inverse.
    const score = twinkleScore();
    const trackId = score.tracks[0].id;
    // Two notes, not one: `toggleOttavaCommand` refuses a bracket that has
    // nowhere to reach, exactly as the slur and hairpin commands do.
    const line = score.tracks[0].measures[0].voices[0].events.filter(isNoteEvent);
    const first = line[0];
    const marked = toggleOttavaCommand([first.id, line[1].id], '8va', 'Ottava').execute(score);

    const drawn: Pitch = { step: 'C', accidental: 0, octave: 4 };
    const stored = soundingPitchForDrawn(marked, trackId, first.startTick, drawn, 'concert');
    // 8va: the notes were written an octave low, so what sounds is an octave up.
    expect(stored.octave).toBe(5);
    expect(stored.step).toBe('C');
  });

  it('undoes a transposing instrument in written mode', () => {
    // A B-flat clarinet reads a whole tone above what it sounds, so a click on
    // the line drawn as E stores D.
    const base = twinkleScore();
    const score = {
      ...base,
      tracks: base.tracks.map((t) => ({ ...t, midiProgram: 71 })),
    };
    const drawn: Pitch = { step: 'E', accidental: 0, octave: 5 };
    const stored = soundingPitchForDrawn(score, score.tracks[0].id, 0, drawn, 'written');
    expect(stored).not.toEqual(drawn);
    expect(stored.step).toBe('D');
    expect(stored.octave).toBe(5);
  });

  it('leaves a transposing instrument alone in concert mode', () => {
    // The lens was not applied, so neither is its inverse — getting this
    // backwards would break the common case to fix the rare one.
    const base = twinkleScore();
    const score = {
      ...base,
      tracks: base.tracks.map((t) => ({ ...t, midiProgram: 71 })),
    };
    const drawn: Pitch = { step: 'E', accidental: 0, octave: 5 };
    expect(soundingPitchForDrawn(score, score.tracks[0].id, 0, drawn, 'concert')).toEqual(drawn);
  });

  it('round-trips: a note stored from a click draws back where it was clicked', () => {
    // The property that makes this correct rather than merely different — the
    // whole point is that the reader gets the note they aimed at.
    const base = twinkleScore();
    const score = {
      ...base,
      tracks: base.tracks.map((t) => ({ ...t, midiProgram: 71 })),
    };
    const track = score.tracks[0];
    const semitones = trackWrittenTransposition(track);
    expect(semitones).not.toBe(0);
    for (const step of ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const) {
      const drawn: Pitch = { step, accidental: 0, octave: 5 };
      const stored = soundingPitchForDrawn(score, track.id, 0, drawn, 'written');
      // Compared as pitch, not as spelling: written-to-sounding preserves the
      // sound exactly and respells freely, which is measured and deliberate.
      expect(pitchToMidi(stored) + semitones).toBe(pitchToMidi(drawn));
    }
  });
});
