/**
 * Canonical score-model types (spec §4).
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

export type Articulation = 'staccato' | 'accent' | 'tenuto' | 'marcato';

export type Clef = 'treble' | 'bass' | 'alto' | 'tenor' | 'percussion';

export type NoteEvent = {
  id: UUID;
  pitch: Pitch;
  startTick: number;
  durationTicks: number;
  velocity: number;
  voiceId: UUID;
  trackId: UUID;
  tieStart?: boolean;
  tieStop?: boolean;
  articulation?: Articulation;
};

export type RestEvent = {
  id: UUID;
  startTick: number;
  durationTicks: number;
  voiceId: UUID;
  trackId: UUID;
};

export type MusicalEvent = NoteEvent | RestEvent;

export type Voice = { id: UUID; name: string; events: MusicalEvent[] };

export type Measure = {
  id: UUID;
  index: number;
  startTick: number;
  durationTicks: number;
  timeSignature: TimeSignature;
  keySignature: KeySignature;
  voices: Voice[];
};

export type Track = {
  id: UUID;
  name: string;
  instrumentName: string;
  midiProgram: number;
  midiChannel: number;
  clef: Clef;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  measures: Measure[];
};

export type ScoreMetadata = {
  title: string;
  composer?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
};

export type Score = {
  id: UUID;
  version: number;
  ppq: number;
  metadata: ScoreMetadata;
  tempoMap: TempoEvent[];
  tracks: Track[];
};

/** True for `NoteEvent`s (distinguished from `RestEvent` by the `pitch` property). */
export function isNoteEvent(event: MusicalEvent): event is NoteEvent {
  return 'pitch' in event;
}

/** True for `RestEvent`s (distinguished from `NoteEvent` by lacking a `pitch` property). */
export function isRestEvent(event: MusicalEvent): event is RestEvent {
  return !('pitch' in event);
}
