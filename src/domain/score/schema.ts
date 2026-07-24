import { z } from 'zod';
import type { Score } from '@/domain/score/types';

/**
 * Zod schemas mirroring the score-model types in `./types.ts` (spec §4),
 * with runtime constraints per Task 3 brief: velocity 0-127, midiProgram
 * 0-127, midiChannel 0-15, ppq positive int, accidental -2..2, octave
 * -1..9. Used to validate untrusted score JSON (AI generation responses,
 * imported/loaded projects) before it enters the app.
 *
 * `noteEventSchema`/`restEventSchema` are `.strict()` so an object with a
 * stray `pitch` field cannot be silently accepted as a rest (and vice
 * versa) via unknown-key stripping; every other schema stays permissive
 * (unknown keys stripped) to tolerate forward-compatible additions.
 */

export const uuidSchema = z.string().min(1);

export const pitchStepSchema = z.enum(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

export const accidentalSchema = z.union([
  z.literal(-2),
  z.literal(-1),
  z.literal(0),
  z.literal(1),
  z.literal(2),
]);

export const pitchSchema = z.object({
  step: pitchStepSchema,
  accidental: accidentalSchema,
  octave: z.number().int().min(-1).max(9),
});

export const timeSignatureSchema = z.object({
  numerator: z.number().int().positive(),
  denominator: z.number().int().positive(),
});

export const keySignatureSchema = z.object({
  fifths: z.number().int(),
  mode: z.enum(['major', 'minor']),
});

export const tempoEventSchema = z.object({
  id: uuidSchema,
  tick: z.number().int().nonnegative(),
  bpm: z.number().positive(),
});

export const articulationSchema = z.enum(['staccato', 'accent', 'tenuto', 'marcato']);

export const clefSchema = z.enum(['treble', 'bass', 'alto', 'tenor', 'percussion']);

export const noteEventSchema = z
  .object({
    id: uuidSchema,
    pitch: pitchSchema,
    startTick: z.number().int().nonnegative(),
    durationTicks: z.number().int().positive(),
    velocity: z.number().int().min(0).max(127),
    voiceId: uuidSchema,
    trackId: uuidSchema,
    tieStart: z.boolean().optional(),
    tieStop: z.boolean().optional(),
    articulation: articulationSchema.optional(),
  })
  .strict();

export const restEventSchema = z
  .object({
    id: uuidSchema,
    startTick: z.number().int().nonnegative(),
    durationTicks: z.number().int().positive(),
    voiceId: uuidSchema,
    trackId: uuidSchema,
  })
  .strict();

export const musicalEventSchema = z.union([noteEventSchema, restEventSchema]);

export const voiceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  events: z.array(musicalEventSchema),
});

export const measureSchema = z.object({
  id: uuidSchema,
  index: z.number().int().nonnegative(),
  startTick: z.number().int().nonnegative(),
  durationTicks: z.number().int().positive(),
  timeSignature: timeSignatureSchema,
  keySignature: keySignatureSchema,
  voices: z.array(voiceSchema),
});

export const trackSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  instrumentName: z.string(),
  midiProgram: z.number().int().min(0).max(127),
  midiChannel: z.number().int().min(0).max(15),
  clef: clefSchema,
  volume: z.number(),
  pan: z.number(),
  muted: z.boolean(),
  solo: z.boolean(),
  measures: z.array(measureSchema),
});

export const scoreMetadataSchema = z.object({
  title: z.string(),
  composer: z.string().optional(),
  description: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const scoreSchema = z.object({
  id: uuidSchema,
  version: z.number().int().nonnegative(),
  ppq: z.number().int().positive(),
  metadata: scoreMetadataSchema,
  tempoMap: z.array(tempoEventSchema),
  tracks: z.array(trackSchema),
});

/** Parses and validates untrusted JSON as a `Score`. Throws `ZodError` on invalid input. */
export function parseScore(json: unknown): Score {
  return scoreSchema.parse(json) as Score;
}
