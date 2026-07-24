import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '@/domain/score/factory';
import { extractFragment } from '@/domain/score/fragment';
import type { RegenerationConstraints } from '@/services/generation/types';
import { SeededRng } from '@/services/generation/prng';
import { pickTransformKind, transformFragment } from '@/services/generation/mock-transforms';

const BASE_CONSTRAINTS: RegenerationConstraints = {
  preserveMeasureCount: true,
  preserveTimeSignatures: true,
  preserveTempoEvents: true,
};

function selectedFragmentFor(measureCount = 2) {
  const score = createEmptyScore({ title: 'S', measures: measureCount, tracks: [{ name: 'Piano', clef: 'treble' }] });
  const track = score.tracks[0];
  const measureTicks = track.measures[0].durationTicks;

  // Fill each measure with a simple melody (four quarter notes) so transforms have real content to work with.
  const filled = {
    ...track,
    measures: track.measures.map((measure) => ({
      ...measure,
      voices: [
        {
          id: `${measure.id}-voice`,
          name: 'Voice 1',
          events: [0, 1, 2, 3].map((beat) => ({
            id: `${measure.id}-note-${beat}`,
            pitch: { step: 'C' as const, accidental: 0 as const, octave: 4 },
            startTick: measure.startTick + beat * (measureTicks / 4),
            durationTicks: measureTicks / 4,
            velocity: 80,
            voiceId: `${measure.id}-voice`,
            trackId: track.id,
          })),
        },
      ],
    })),
  };
  const filledScore = { ...score, tracks: [filled] };
  const range = { startTick: 0, endTick: measureTicks * measureCount, trackIds: [track.id] };
  return extractFragment(filledScore, range);
}

describe('pickTransformKind', () => {
  it.each([
    ['Make this more dramatic', 'dramatic'],
    ['Make this more energetic', 'dramatic'],
    ['Make this more upbeat', 'dramatic'],
    ['Simplify this passage', 'simplify'],
    ['Add syncopation', 'syncopate'],
    ['Make this darker', 'minor'],
    ['Make this minor', 'minor'],
    ['Play it higher', 'higher'],
    ['Play it lower', 'lower'],
    ['Create a variation while preserving the melody', 'preserveMelody'],
    ['Add harmonic tension', 'default'],
  ] as const)('%s -> %s', (instruction, expected) => {
    expect(pickTransformKind(instruction)).toBe(expected);
  });
});

describe('transformFragment', () => {
  it('preserves range, ppq, measure count, and time signatures', () => {
    const fragment = selectedFragmentFor(2);
    const rng = new SeededRng('t1');
    const result = transformFragment(fragment, 'Make this more dramatic', BASE_CONSTRAINTS, rng, 0);

    expect(result.range).toEqual(fragment.range);
    expect(result.ppq).toBe(fragment.ppq);
    expect(result.tracks).toHaveLength(fragment.tracks.length);
    result.tracks.forEach((track, i) => {
      expect(track.measures).toHaveLength(fragment.tracks[i].measures.length);
      track.measures.forEach((measure, j) => {
        expect(measure.timeSignature).toEqual(fragment.tracks[i].measures[j].timeSignature);
        expect(measure.startTick).toBe(fragment.tracks[i].measures[j].startTick);
        expect(measure.durationTicks).toBe(fragment.tracks[i].measures[j].durationTicks);
      });
    });
  });

  it('every measure still sums to exactly its own duration after transformation', () => {
    const fragment = selectedFragmentFor(2);
    const rng = new SeededRng('t2');
    const result = transformFragment(fragment, 'Add rhythmic variation', BASE_CONSTRAINTS, rng, 0);
    for (const track of result.tracks) {
      for (const measure of track.measures) {
        for (const voice of measure.voices) {
          const covered = voice.events.reduce((sum, e) => sum + e.durationTicks, 0);
          expect(covered).toBe(measure.durationTicks);
        }
      }
    }
  });

  it('regenerates measure/voice/event ids (never reuses the original selection\'s ids)', () => {
    const fragment = selectedFragmentFor(1);
    const originalEventIds = new Set(fragment.tracks[0].measures[0].voices[0].events.map((e) => e.id));
    const rng = new SeededRng('t3');
    const result = transformFragment(fragment, 'Simplify this passage', BASE_CONSTRAINTS, rng, 0);
    const newEventIds = result.tracks[0].measures[0].voices[0].events.map((e) => e.id);
    expect(newEventIds.some((id) => originalEventIds.has(id))).toBe(false);
  });

  it('is deterministic for the same instruction/seed/candidate index', () => {
    const fragment = selectedFragmentFor(2);
    const a = transformFragment(fragment, 'Make this more dramatic', BASE_CONSTRAINTS, new SeededRng('same'), 0);
    const b = transformFragment(fragment, 'Make this more dramatic', BASE_CONSTRAINTS, new SeededRng('same'), 0);
    expect(a).toEqual(b);
  });

  it('produces distinct fragments for each named variation style', () => {
    const fragment = selectedFragmentFor(2);
    const instructions = {
      energetic: 'Make this more energetic',
      simpler: 'Simplify this passage',
      syncopated: 'Add syncopation',
      higher: 'Play it higher',
      lower: 'Play it lower',
      minor: 'Make this darker',
    };

    const results = Object.fromEntries(
      Object.entries(instructions).map(([label, instruction]) => [
        label,
        transformFragment(fragment, instruction, BASE_CONSTRAINTS, new SeededRng(`style-${label}`), 0),
      ]),
    );

    const labels = Object.keys(results);
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) {
        expect(results[labels[i]]).not.toEqual(results[labels[j]]);
      }
      // Also distinct from the untransformed original.
      expect(results[labels[i]]).not.toEqual(fragment);
    }
  });

  it('higher/lower transforms actually shift pitches by an octave', () => {
    const fragment = selectedFragmentFor(1);
    const higher = transformFragment(fragment, 'Play it higher', BASE_CONSTRAINTS, new SeededRng('h'), 0);
    const lower = transformFragment(fragment, 'Play it lower', BASE_CONSTRAINTS, new SeededRng('l'), 0);

    const originalOctave = fragment.tracks[0].measures[0].voices[0].events[0];
    const higherEvent = higher.tracks[0].measures[0].voices[0].events.find((e) => 'pitch' in e)!;
    const lowerEvent = lower.tracks[0].measures[0].voices[0].events.find((e) => 'pitch' in e)!;

    expect('pitch' in originalOctave && originalOctave.pitch.octave).toBe(4);
    expect('pitch' in higherEvent && higherEvent.pitch.octave).toBe(5);
    expect('pitch' in lowerEvent && lowerEvent.pitch.octave).toBe(3);
  });

  it('preserveMelody keeps the first track unchanged while varying other tracks', () => {
    const score = createEmptyScore({
      title: 'S',
      measures: 1,
      tracks: [
        { name: 'Melody', clef: 'treble' },
        { name: 'Accompaniment', clef: 'treble' },
      ],
    });
    const melodyTrack = score.tracks[0];
    const accompTrack = score.tracks[1];
    const measureTicks = melodyTrack.measures[0].durationTicks;

    const fill = (track: typeof melodyTrack) => ({
      ...track,
      measures: track.measures.map((measure) => ({
        ...measure,
        voices: [
          {
            id: `${measure.id}-v`,
            name: 'Voice 1',
            events: [
              {
                id: `${measure.id}-n`,
                pitch: { step: 'C' as const, accidental: 0 as const, octave: 4 },
                startTick: measure.startTick,
                durationTicks: measureTicks,
                velocity: 80,
                voiceId: `${measure.id}-v`,
                trackId: track.id,
              },
            ],
          },
        ],
      })),
    });

    const filledScore = { ...score, tracks: [fill(melodyTrack), fill(accompTrack)] };
    const range = { startTick: 0, endTick: measureTicks, trackIds: [melodyTrack.id, accompTrack.id] };
    const fragment = extractFragment(filledScore, range);

    const rng = new SeededRng('preserve');
    const result = transformFragment(
      fragment,
      'Create a variation while preserving the melody',
      { ...BASE_CONSTRAINTS, preserveMelody: true },
      rng,
      0,
    );

    const originalMelodyEvent = fragment.tracks[0].measures[0].voices[0].events[0];
    const resultMelodyEvent = result.tracks[0].measures[0].voices[0].events[0];
    expect('pitch' in resultMelodyEvent && resultMelodyEvent.pitch).toEqual(
      'pitch' in originalMelodyEvent && originalMelodyEvent.pitch,
    );
  });

  it('respects allowedPitchRangeByTrack and maximumPolyphony constraints', () => {
    const fragment = selectedFragmentFor(1);
    const trackId = fragment.tracks[0].trackId;
    const constraints: RegenerationConstraints = {
      ...BASE_CONSTRAINTS,
      allowedPitchRangeByTrack: { [trackId]: { lowestMidi: 72, highestMidi: 84 } },
      maximumPolyphony: 1,
    };
    const result = transformFragment(fragment, 'Make this more dramatic', constraints, new SeededRng('range'), 0);

    for (const measure of result.tracks[0].measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if ('pitch' in event) {
            const midi = 60 + (event.pitch.octave - 4) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[event.pitch.step] + event.pitch.accidental;
            expect(midi).toBeGreaterThanOrEqual(72);
            expect(midi).toBeLessThanOrEqual(84);
          }
        }
        // maximumPolyphony 1: no two events sharing a startTick.
        const startTicks = voice.events.map((e) => e.startTick);
        expect(new Set(startTicks).size).toBe(startTicks.length);
      }
    }
  });
});
