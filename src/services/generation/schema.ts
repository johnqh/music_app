/**
 * Zod schemas for the generation API (spec §11): validates untrusted
 * request/response JSON at the provider boundary (e.g. before trusting a
 * real AI backend's response, or before replaying a request logged for
 * diagnostics — spec §33). Mirrors `types.ts`, the same way
 * `domain/score/schema.ts` mirrors `domain/score/types.ts`.
 */
import { z } from 'zod';
import { clefSchema, keySignatureSchema, measureSchema, scoreSchema, timeSignatureSchema } from '@/domain/score/schema';
import type {
  GenerateScoreRequest,
  GenerateScoreResult,
  RegenerateRegionRequest,
  RegenerateRegionResult,
  RegenerationCandidate,
} from '@/services/generation/types';

export const midiRangeSchema = z.object({
  lowestMidi: z.number().int().min(0).max(127),
  highestMidi: z.number().int().min(0).max(127),
});

export const scoreRangeSchema = z.object({
  startTick: z.number().int().nonnegative(),
  endTick: z.number().int().nonnegative(),
  trackIds: z.array(z.string().min(1)),
});

export const scoreFragmentSchema = z.object({
  range: scoreRangeSchema,
  ppq: z.number().int().positive(),
  tracks: z.array(z.object({ trackId: z.string().min(1), measures: z.array(measureSchema) })),
});

export const generateScoreRequestTrackSchema = z.object({
  name: z.string(),
  instrumentName: z.string(),
  midiProgram: z.number().int().min(0).max(127),
  clef: clefSchema,
  range: midiRangeSchema.optional(),
  maximumPolyphony: z.number().int().positive().optional(),
});

export const generateScoreRequestSchema = z.object({
  prompt: z.string(),
  title: z.string().optional(),
  style: z.string().optional(),
  mood: z.string().optional(),
  durationMeasures: z.number().int().positive(),
  tempo: z.number().positive().optional(),
  timeSignature: timeSignatureSchema.optional(),
  keySignature: keySignatureSchema.optional(),
  tracks: z.array(generateScoreRequestTrackSchema),
  complexity: z.enum(['simple', 'moderate', 'complex']).optional(),
});

export const generateScoreResultSchema = z.object({
  score: scoreSchema,
  warnings: z.array(z.string()),
});

export const regenerationConstraintsSchema = z.object({
  preserveMeasureCount: z.literal(true),
  preserveTimeSignatures: z.literal(true),
  preserveTempoEvents: z.literal(true),
  preserveBoundaryNotes: z.boolean().optional(),
  preserveHarmony: z.boolean().optional(),
  preserveRhythm: z.boolean().optional(),
  preserveMelody: z.boolean().optional(),
  maximumPolyphony: z.number().int().positive().optional(),
  allowedPitchRangeByTrack: z.record(z.string(), midiRangeSchema).optional(),
});

export const regenerateRegionRequestSchema = z.object({
  scoreId: z.string().min(1),
  instruction: z.string(),
  range: scoreRangeSchema,
  precedingContext: scoreFragmentSchema,
  selectedFragment: scoreFragmentSchema,
  followingContext: scoreFragmentSchema,
  constraints: regenerationConstraintsSchema,
  candidateCount: z.number().int().positive(),
});

export const regenerationCandidateSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  fragment: scoreFragmentSchema,
});

export const regenerateRegionResultSchema = z.object({
  candidates: z.array(regenerationCandidateSchema),
  warnings: z.array(z.string()),
});

/** Parses and validates untrusted JSON as a `GenerateScoreRequest`. Throws `ZodError` on invalid input. */
export function parseGenerateScoreRequest(json: unknown): GenerateScoreRequest {
  return generateScoreRequestSchema.parse(json) as GenerateScoreRequest;
}

/** Parses and validates untrusted JSON as a `GenerateScoreResult`. Throws `ZodError` on invalid input. */
export function parseGenerateScoreResult(json: unknown): GenerateScoreResult {
  return generateScoreResultSchema.parse(json) as GenerateScoreResult;
}

/** Parses and validates untrusted JSON as a `RegenerateRegionRequest`. Throws `ZodError` on invalid input. */
export function parseRegenerateRegionRequest(json: unknown): RegenerateRegionRequest {
  return regenerateRegionRequestSchema.parse(json) as RegenerateRegionRequest;
}

/** Parses and validates untrusted JSON as a `RegenerateRegionResult`. Throws `ZodError` on invalid input. */
export function parseRegenerateRegionResult(json: unknown): RegenerateRegionResult {
  return regenerateRegionResultSchema.parse(json) as RegenerateRegionResult;
}

/** Parses and validates untrusted JSON as a `RegenerationCandidate`. Throws `ZodError` on invalid input. */
export function parseRegenerationCandidate(json: unknown): RegenerationCandidate {
  return regenerationCandidateSchema.parse(json) as RegenerationCandidate;
}
