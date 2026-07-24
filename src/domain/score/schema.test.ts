import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '@/domain/score/factory';
import { parseScore } from '@/domain/score/schema';
import { ZodError } from 'zod';

describe('parseScore', () => {
  it('accepts a valid score and round-trips it structurally', () => {
    const score = createEmptyScore({
      title: 'Twinkle',
      measures: 2,
      tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
    });
    expect(parseScore(score)).toEqual(score);
  });

  it('accepts a note event with velocity/midi fields at the edges of their valid ranges', () => {
    const score = createEmptyScore({ title: 'Edges', measures: 1, tracks: [{ name: 'Piano', midiProgram: 127, midiChannel: 15 }] });
    const track = score.tracks[0];
    const measure = track.measures[0];
    const voiceId = measure.voices[0].id;
    const withNote = {
      ...score,
      tracks: [
        {
          ...track,
          measures: [
            {
              ...measure,
              voices: [
                {
                  id: voiceId,
                  name: 'Voice 1',
                  events: [
                    {
                      id: 'n1',
                      pitch: { step: 'C', accidental: 2, octave: 9 },
                      startTick: 0,
                      durationTicks: 480,
                      velocity: 127,
                      voiceId,
                      trackId: track.id,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => parseScore(withNote)).not.toThrow();
  });

  it('rejects a note event with velocity above 127', () => {
    const score = createEmptyScore({ title: 'Bad', measures: 1, tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const bad = withSingleNoteEvent(score, track, { velocity: 128 });
    expect(() => parseScore(bad)).toThrow(ZodError);
  });

  it('rejects a note event with a negative velocity', () => {
    const score = createEmptyScore({ title: 'Bad', measures: 1, tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const bad = withSingleNoteEvent(score, track, { velocity: -1 });
    expect(() => parseScore(bad)).toThrow(ZodError);
  });

  it('rejects a track with midiProgram above 127', () => {
    const score = createEmptyScore({ title: 'Bad', tracks: [{ name: 'Piano' }] });
    const bad = { ...score, tracks: [{ ...score.tracks[0], midiProgram: 128 }] };
    expect(() => parseScore(bad)).toThrow(ZodError);
  });

  it('rejects a track with midiChannel above 15', () => {
    const score = createEmptyScore({ title: 'Bad', tracks: [{ name: 'Piano' }] });
    const bad = { ...score, tracks: [{ ...score.tracks[0], midiChannel: 16 }] };
    expect(() => parseScore(bad)).toThrow(ZodError);
  });

  it('rejects a non-positive or non-integer ppq', () => {
    const score = createEmptyScore({ title: 'Bad', tracks: [{ name: 'Piano' }] });
    expect(() => parseScore({ ...score, ppq: 0 })).toThrow(ZodError);
    expect(() => parseScore({ ...score, ppq: 480.5 })).toThrow(ZodError);
  });

  it('rejects an accidental outside -2..2', () => {
    const score = createEmptyScore({ title: 'Bad', measures: 1, tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const bad = withSingleNoteEvent(score, track, {}, { accidental: 3 });
    expect(() => parseScore(bad)).toThrow(ZodError);
  });

  it('rejects an octave outside -1..9', () => {
    const score = createEmptyScore({ title: 'Bad', measures: 1, tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const bad = withSingleNoteEvent(score, track, {}, { octave: 10 });
    expect(() => parseScore(bad)).toThrow(ZodError);
  });

  it('rejects malformed input missing required top-level fields', () => {
    expect(() => parseScore({ foo: 'bar' })).toThrow(ZodError);
  });

  it('distinguishes rest events (no pitch) from note events within a voice', () => {
    const score = createEmptyScore({ title: 'RestOnly', measures: 1, tracks: [{ name: 'Piano' }] });
    // The default measure is already filled with a single rest; it must round-trip.
    expect(() => parseScore(score)).not.toThrow();
    const parsed = parseScore(score);
    const event = parsed.tracks[0].measures[0].voices[0].events[0];
    expect('pitch' in event).toBe(false);
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withSingleNoteEvent(score: any, track: any, noteOverrides: Record<string, unknown>, pitchOverrides: Record<string, unknown> = {}) {
  const measure = track.measures[0];
  const voiceId = measure.voices[0].id;
  return {
    ...score,
    tracks: [
      {
        ...track,
        measures: [
          {
            ...measure,
            voices: [
              {
                id: voiceId,
                name: 'Voice 1',
                events: [
                  {
                    id: 'n1',
                    pitch: { step: 'C', accidental: 0, octave: 4, ...pitchOverrides },
                    startTick: 0,
                    durationTicks: 480,
                    velocity: 80,
                    voiceId,
                    trackId: track.id,
                    ...noteOverrides,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}
