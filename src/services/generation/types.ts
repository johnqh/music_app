/**
 * Provider-independent AI generation API (spec §11): request/result types
 * and the `MusicGenerationProvider` interface every provider (the seeded
 * mock in `mock-provider.ts`, and eventually a real AI backend) must
 * implement. Kept free of React/MUI/VexFlow/Tone.js/Dexie and other
 * browser-only APIs so it stays runnable in both vitest/jsdom and node
 * (spec §3, §37) — a real provider's network calls are the only place
 * that needs a real browser/node fetch implementation, not this contract.
 */
import type { KeySignature, Score, TimeSignature, Track } from '@/domain/score/types';
import type { ScoreFragment } from '@/domain/score/fragment';
import type { ScoreRange } from '@/domain/selection/types';

export type GenerateScoreRequestTrack = {
  name: string;
  instrumentName: string;
  midiProgram: number;
  clef: Track['clef'];
  range?: { lowestMidi: number; highestMidi: number };
  maximumPolyphony?: number;
};

export type GenerateScoreRequest = {
  prompt: string;
  title?: string;
  style?: string;
  mood?: string;
  durationMeasures: number;
  tempo?: number;
  timeSignature?: TimeSignature;
  keySignature?: KeySignature;
  tracks: GenerateScoreRequestTrack[];
  complexity?: 'simple' | 'moderate' | 'complex';
};

/** Never a rendered/notation payload and never raw MIDI (spec §11): always a structured `Score`. */
export type GenerateScoreResult = { score: Score; warnings: string[] };

export type RegenerationConstraints = {
  preserveMeasureCount: true;
  preserveTimeSignatures: true;
  preserveTempoEvents: true;
  preserveBoundaryNotes?: boolean;
  preserveHarmony?: boolean;
  preserveRhythm?: boolean;
  preserveMelody?: boolean;
  maximumPolyphony?: number;
  allowedPitchRangeByTrack?: Record<string, { lowestMidi: number; highestMidi: number }>;
};

export type RegenerateRegionRequest = {
  scoreId: string;
  instruction: string;
  range: ScoreRange;
  precedingContext: ScoreFragment;
  selectedFragment: ScoreFragment;
  followingContext: ScoreFragment;
  constraints: RegenerationConstraints;
  candidateCount: number;
};

export type RegenerationCandidate = { id: string; label: string; fragment: ScoreFragment };

export type RegenerateRegionResult = { candidates: RegenerationCandidate[]; warnings: string[] };

export interface MusicGenerationProvider {
  id: string;
  name: string;
  generateScore(request: GenerateScoreRequest, signal?: AbortSignal): Promise<GenerateScoreResult>;
  regenerateRegion(request: RegenerateRegionRequest, signal?: AbortSignal): Promise<RegenerateRegionResult>;
}
