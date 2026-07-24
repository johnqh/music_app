/**
 * Canonical score-model types (spec §4).
 *
 * NOTE: This file is intentionally minimal for now. It contains only the
 * types consumed by the time/fraction/tick and pitch utilities built in
 * Task 2 (`Fraction`, `TimeSignature`, `TempoEvent`, `Pitch`,
 * `KeySignature`, `DurationName`), plus the small set of supporting types
 * those directly depend on (`UUID`, `PitchStep`, `Accidental`). Task 3
 * completes this file with the remaining score-model types (`NoteEvent`,
 * `RestEvent`, `MusicalEvent`, `Voice`, `Measure`, `Track`,
 * `ScoreMetadata`, `Score`) per spec §4. Import paths (`@/domain/score/types`)
 * are stable across that change.
 *
 * Domain code must remain independent of React, MUI, VexFlow, Tone.js,
 * @tonejs/midi, Dexie, and browser-only APIs (spec §3, §37).
 */

export type UUID = string;

export type Fraction = { numerator: number; denominator: number };

export type PitchStep = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

/** -2 = double flat, -1 = flat, 0 = natural, 1 = sharp, 2 = double sharp. */
export type Accidental = -2 | -1 | 0 | 1 | 2;

export type Pitch = { step: PitchStep; accidental: Accidental; octave: number };

export type TimeSignature = { numerator: number; denominator: number };

export type KeySignature = { fifths: number; mode: 'major' | 'minor' };

export type TempoEvent = { id: UUID; tick: number; bpm: number };

/**
 * Renderable note-duration names: base values (whole down to thirty-second),
 * their dotted (1.5x) variants, and their triplet (2/3x) variants. Used by
 * `src/domain/time/ticks.ts`'s `DURATIONS` map and `ticksFor`.
 */
export type DurationName =
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | 'sixteenth'
  | 'thirtysecond'
  | 'dotted-whole'
  | 'dotted-half'
  | 'dotted-quarter'
  | 'dotted-eighth'
  | 'dotted-sixteenth'
  | 'dotted-thirtysecond'
  | 'triplet-whole'
  | 'triplet-half'
  | 'triplet-quarter'
  | 'triplet-eighth'
  | 'triplet-sixteenth'
  | 'triplet-thirtysecond';
