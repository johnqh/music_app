/**
 * Natural-language prompt parsing for the generation panel (spec §11,
 * §21, §32): extracts key/tempo/meter/style/mood hints from a free-text
 * prompt so `MockGenerationProvider.generateScore` can honor prompts like
 * "Create a cinematic sixteen-measure theme in D minor" even when the
 * caller didn't also set the corresponding structured `GenerateScoreRequest`
 * fields. Any hint the request already sets explicitly takes precedence
 * (see mock-provider.ts) — this module only ever *suggests* values.
 */
import type { Accidental, KeySignature, PitchStep, TimeSignature } from '@/domain/score/types';
import { pitchToMidi } from '@/domain/pitch/pitch';
import { keySignatureForTonicPitchClass } from '@/services/generation/music-theory';

export type PromptHints = {
  keySignature?: KeySignature;
  timeSignature?: TimeSignature;
  tempo?: number;
  style?: string;
  mood?: string;
};

/** Recognizes "A minor", "C major", "F# major", "Bb minor", etc. */
const KEY_NAME_PATTERN = /\b([A-G])(#|b)?\s+(major|minor)\b/i;

/** Recognizes an explicit meter like "3/4" or "6 / 8". */
const METER_PATTERN = /\b(\d{1,2})\s*\/\s*(\d{1,2})\b/;

/** Recognizes an explicit tempo like "120 bpm" or "96bpm". */
const TEMPO_PATTERN = /\b(\d{2,3})\s*bpm\b/i;

const STYLES = ['waltz', 'jazz', 'pop', 'cinematic', 'ambient', 'battle'];
const MOODS = ['gentle', 'dark', 'upbeat', 'dramatic', 'calm', 'energetic'];

/** Converts a regex-captured note-name + accidental into a `KeySignature` for the given mode. */
function keySignatureFromNoteName(letter: string, accidentalToken: string | undefined, mode: 'major' | 'minor'): KeySignature {
  const step = letter.toUpperCase() as PitchStep;
  const accidental: Accidental = accidentalToken === '#' ? 1 : accidentalToken === 'b' ? -1 : 0;
  const pitchClass = (((pitchToMidi({ step, accidental, octave: 4 }) - 60) % 12) + 12) % 12;
  return keySignatureForTonicPitchClass(pitchClass, mode);
}

/**
 * Extracts whatever key/tempo/meter/style/mood hints can be recognized in
 * `prompt`'s free text. Fields with no match are omitted (never guessed).
 */
export function parsePrompt(prompt: string): PromptHints {
  const hints: PromptHints = {};
  const lower = prompt.toLowerCase();

  const keyMatch = KEY_NAME_PATTERN.exec(prompt);
  if (keyMatch) {
    const mode = keyMatch[3].toLowerCase() === 'minor' ? 'minor' : 'major';
    hints.keySignature = keySignatureFromNoteName(keyMatch[1], keyMatch[2], mode);
  }

  const meterMatch = METER_PATTERN.exec(prompt);
  if (meterMatch) {
    hints.timeSignature = { numerator: Number(meterMatch[1]), denominator: Number(meterMatch[2]) };
  }

  const tempoMatch = TEMPO_PATTERN.exec(prompt);
  if (tempoMatch) {
    hints.tempo = Number(tempoMatch[1]);
  }

  const style = STYLES.find((s) => lower.includes(s));
  if (style) hints.style = style;

  const mood = MOODS.find((m) => lower.includes(m));
  if (mood) hints.mood = mood;

  return hints;
}
