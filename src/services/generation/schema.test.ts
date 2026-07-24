import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '@/domain/score/factory';
import { extractFragment } from '@/domain/score/fragment';
import {
  generateScoreRequestSchema,
  generateScoreResultSchema,
  parseGenerateScoreRequest,
  parseRegenerateRegionRequest,
  regenerateRegionRequestSchema,
  regenerateRegionResultSchema,
  scoreFragmentSchema,
  scoreRangeSchema,
} from '@/services/generation/schema';
import type { GenerateScoreRequest, RegenerateRegionRequest } from '@/services/generation/types';

function validGenerateRequest(): GenerateScoreRequest {
  return {
    prompt: 'Create a gentle eight-measure piano melody in C major',
    durationMeasures: 8,
    tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
  };
}

describe('scoreRangeSchema / scoreFragmentSchema', () => {
  it('accepts a valid ScoreRange and ScoreFragment', () => {
    const score = createEmptyScore({ title: 'S', measures: 2, tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const range = { startTick: 0, endTick: track.measures[0].durationTicks, trackIds: [track.id] };
    const fragment = extractFragment(score, range);

    expect(scoreRangeSchema.safeParse(range).success).toBe(true);
    expect(scoreFragmentSchema.safeParse(fragment).success).toBe(true);
  });
});

describe('generateScoreRequestSchema', () => {
  it('accepts a minimal valid request', () => {
    const result = generateScoreRequestSchema.safeParse(validGenerateRequest());
    expect(result.success).toBe(true);
  });

  it('accepts an optional-fields-populated request', () => {
    const request: GenerateScoreRequest = {
      ...validGenerateRequest(),
      title: 'My Piece',
      style: 'jazz',
      mood: 'upbeat',
      tempo: 120,
      timeSignature: { numerator: 4, denominator: 4 },
      keySignature: { fifths: 0, mode: 'major' },
      complexity: 'complex',
      tracks: [
        {
          name: 'Piano',
          instrumentName: 'Piano',
          midiProgram: 0,
          clef: 'treble',
          range: { lowestMidi: 48, highestMidi: 84 },
          maximumPolyphony: 4,
        },
      ],
    };
    expect(generateScoreRequestSchema.safeParse(request).success).toBe(true);
  });

  it('rejects a non-positive durationMeasures', () => {
    const request = { ...validGenerateRequest(), durationMeasures: 0 };
    expect(generateScoreRequestSchema.safeParse(request).success).toBe(false);
  });

  it('rejects an invalid clef', () => {
    const request = {
      ...validGenerateRequest(),
      tracks: [{ name: 'X', instrumentName: 'X', midiProgram: 0, clef: 'soprano' }],
    };
    expect(generateScoreRequestSchema.safeParse(request).success).toBe(false);
  });

  it('parseGenerateScoreRequest throws on invalid input', () => {
    expect(() => parseGenerateScoreRequest({ prompt: 'x' })).toThrow();
  });

  it('parseGenerateScoreRequest returns a typed request on valid input', () => {
    const parsed = parseGenerateScoreRequest(validGenerateRequest());
    expect(parsed.durationMeasures).toBe(8);
  });
});

describe('generateScoreResultSchema', () => {
  it('accepts a Score + warnings result', () => {
    const score = createEmptyScore({ title: 'S' });
    const result = { score, warnings: ['note'] };
    expect(generateScoreResultSchema.safeParse(result).success).toBe(true);
  });
});

function validRegenerateRequest(): RegenerateRegionRequest {
  const score = createEmptyScore({ title: 'S', measures: 5, tracks: [{ name: 'Piano' }] });
  const track = score.tracks[0];
  const measureTicks = track.measures[0].durationTicks;
  const range = { startTick: measureTicks, endTick: 2 * measureTicks, trackIds: [track.id] };
  return {
    scoreId: score.id,
    instruction: 'Make this more dramatic',
    range,
    precedingContext: extractFragment(score, { startTick: 0, endTick: measureTicks, trackIds: [track.id] }),
    selectedFragment: extractFragment(score, range),
    followingContext: extractFragment(score, { startTick: 2 * measureTicks, endTick: 3 * measureTicks, trackIds: [track.id] }),
    constraints: { preserveMeasureCount: true, preserveTimeSignatures: true, preserveTempoEvents: true },
    candidateCount: 3,
  };
}

describe('regenerateRegionRequestSchema', () => {
  it('accepts a valid request', () => {
    expect(regenerateRegionRequestSchema.safeParse(validRegenerateRequest()).success).toBe(true);
  });

  it('accepts a request with optional constraint fields populated', () => {
    const request: RegenerateRegionRequest = {
      ...validRegenerateRequest(),
      constraints: {
        preserveMeasureCount: true,
        preserveTimeSignatures: true,
        preserveTempoEvents: true,
        preserveBoundaryNotes: true,
        preserveHarmony: false,
        preserveRhythm: true,
        preserveMelody: false,
        maximumPolyphony: 1,
        allowedPitchRangeByTrack: { 'track-1': { lowestMidi: 40, highestMidi: 80 } },
      },
    };
    expect(regenerateRegionRequestSchema.safeParse(request).success).toBe(true);
  });

  it('rejects a candidateCount of 0', () => {
    const request = { ...validRegenerateRequest(), candidateCount: 0 };
    expect(regenerateRegionRequestSchema.safeParse(request).success).toBe(false);
  });

  it('rejects preserveMeasureCount: false (constraints are always preserve=true per spec §12)', () => {
    const request = validRegenerateRequest();
    const invalid = { ...request, constraints: { ...request.constraints, preserveMeasureCount: false } };
    expect(regenerateRegionRequestSchema.safeParse(invalid).success).toBe(false);
  });

  it('parseRegenerateRegionRequest round-trips a valid request', () => {
    const request = validRegenerateRequest();
    expect(parseRegenerateRegionRequest(request).scoreId).toBe(request.scoreId);
  });
});

describe('regenerateRegionResultSchema', () => {
  it('accepts a candidates + warnings result', () => {
    const request = validRegenerateRequest();
    const result = {
      candidates: [{ id: 'c1', label: 'Variation 1', fragment: request.selectedFragment }],
      warnings: [],
    };
    expect(regenerateRegionResultSchema.safeParse(result).success).toBe(true);
  });
});
