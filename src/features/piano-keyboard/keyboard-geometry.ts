/**
 * Physical piano-keyboard layout. Pure arithmetic — no React, no store — so
 * the key positions are unit-testable on their own.
 *
 * The piano roll modelled pitch as one uniform row per semitone. A real
 * keyboard cannot: white keys tile edge to edge and each black key straddles
 * the boundary *between* two whites, overlapping both.
 *
 *   ┌─┬─┬─┬─┬─┬─┬─┐
 *   │ │█│ │█│ │ │█│    white: x = whiteIndex * w
 *   │ └┬┘ └┬┘ │ └┬┘    black: x = (whiteIndex + 1) * w - blackWidth / 2
 *   │C │D │E │F │G │
 *   └──┴──┴──┴──┴──┘
 */
import { midiToPitch, pitchToString } from '@sudobility/music_lib';

/** A0 — the lowest key on a standard 88-key piano. */
export const KEYBOARD_MIN_MIDI = 21;
/** C8 — the highest. */
export const KEYBOARD_MAX_MIDI = 108;
/** The 88 keys span 52 whites; the blacks overlay them and add no width. */
export const WHITE_KEY_COUNT = 52;

/**
 * The keyboard is drawn over a caller-chosen range, not always all 88 keys:
 * the active track's instrument decides it, so a piccolo part does not present
 * three octaves of keys that will never sound.
 */
export type KeyboardRange = { min: number; max: number };

export const FULL_RANGE: KeyboardRange = { min: KEYBOARD_MIN_MIDI, max: KEYBOARD_MAX_MIDI };

/**
 * Widens `range` so it begins and ends on a white key, and clamps it to the
 * 88-key piano.
 *
 * A keyboard whose first or last key is black looks broken — a black key has no
 * white neighbour to hang off on that side, so it would float. Widening is
 * always safe: it only ever adds a key the instrument nearly reaches.
 */
export function snapToWhiteKeys(range: KeyboardRange): KeyboardRange {
  let min = Math.max(KEYBOARD_MIN_MIDI, Math.min(range.min, range.max));
  let max = Math.min(KEYBOARD_MAX_MIDI, Math.max(range.min, range.max));
  while (min > KEYBOARD_MIN_MIDI && isBlackKey(min)) min -= 1;
  while (max < KEYBOARD_MAX_MIDI && isBlackKey(max)) max += 1;
  // If clamping left an edge black (the very ends of the piano), step inward.
  while (isBlackKey(min) && min < max) min += 1;
  while (isBlackKey(max) && max > min) max -= 1;
  return { min, max };
}

/** How many white keys a range spans, which is what sets the keyboard's width. */
export function whiteKeyCount(range: KeyboardRange = FULL_RANGE): number {
  let count = 0;
  for (let midi = range.min; midi <= range.max; midi += 1) if (!isBlackKey(midi)) count += 1;
  return count;
}

/**
 * Below this the keys stop shrinking and the keyboard scrolls horizontally
 * instead — 52 × 14 = 728px, so any narrower panel scrolls.
 */
export const MIN_WHITE_KEY_WIDTH = 14;

/** Black-key size, as a fraction of a white key. */
export const BLACK_KEY_WIDTH_RATIO = 0.6;
export const BLACK_KEY_HEIGHT_RATIO = 0.62;

export type PianoKey = {
  midi: number;
  isBlack: boolean;
  /** Left edge in px, from the keyboard's own origin. */
  x: number;
  width: number;
  height: number;
  /**
   * Set on each C and F (`C4`, `F4`), left null elsewhere.
   *
   * Those two are the landmarks of the black-key groups — C sits left of the
   * group of two, F left of the group of three — so with both labelled no white
   * key is ever more than two steps from a reference. Labelling all seven per
   * octave is legible only while the keys are wide, and this keyboard shrinks.
   */
  label: string | null;
};

/** True for the five black keys per octave (pitch classes 1, 3, 6, 8, 10). */
export function isBlackKey(midi: number): boolean {
  const pitchClass = ((midi % 12) + 12) % 12;
  return [1, 3, 6, 8, 10].includes(pitchClass);
}

/** A midi number as a pitch string, e.g. `C4`, `F#3` — sharp spelling, since a keyboard has no key signature to spell against. */
export function noteLabel(midi: number): string {
  return pitchToString(midiToPitch(midi));
}

/** Total width of the keyboard at a given white-key width. */
export function keyboardWidth(whiteKeyWidth: number, range: KeyboardRange = FULL_RANGE): number {
  return whiteKeyCount(range) * whiteKeyWidth;
}

/**
 * Every key, whites first and blacks second.
 *
 * That order IS the z-order: a caller can render the array straight through
 * and the blacks land on top of the whites they overlap, with no z-index
 * bookkeeping.
 */
export function computeKeys(
  whiteKeyWidth: number,
  whiteKeyHeight: number,
  range: KeyboardRange = FULL_RANGE,
): PianoKey[] {
  const whites: PianoKey[] = [];
  const blacks: PianoKey[] = [];
  const blackWidth = whiteKeyWidth * BLACK_KEY_WIDTH_RATIO;
  const blackHeight = whiteKeyHeight * BLACK_KEY_HEIGHT_RATIO;

  // `whiteIndex` counts only the whites seen so far, which is what positions
  // both kinds: a white sits at its own index, and a black hangs off the
  // boundary after the white that precedes it.
  let whiteIndex = 0;
  for (let midi = range.min; midi <= range.max; midi += 1) {
    const pitch = midiToPitch(midi);
    const isLandmark = pitch.accidental === 0 && (pitch.step === 'C' || pitch.step === 'F');
    const label = isLandmark ? noteLabel(midi) : null;

    if (isBlackKey(midi)) {
      blacks.push({
        midi,
        isBlack: true,
        x: whiteIndex * whiteKeyWidth - blackWidth / 2,
        width: blackWidth,
        height: blackHeight,
        label: null, // a black key is never a landmark
      });
    } else {
      whites.push({
        midi,
        isBlack: false,
        x: whiteIndex * whiteKeyWidth,
        width: whiteKeyWidth,
        height: whiteKeyHeight,
        label,
      });
      whiteIndex += 1;
    }
  }

  return [...whites, ...blacks];
}
