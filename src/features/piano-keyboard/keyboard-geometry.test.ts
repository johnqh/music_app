import { describe, expect, it } from 'vitest';
import {
  BLACK_KEY_HEIGHT_RATIO,
  BLACK_KEY_WIDTH_RATIO,
  KEYBOARD_MAX_MIDI,
  KEYBOARD_MIN_MIDI,
  WHITE_KEY_COUNT,
  computeKeys,
  isBlackKey,
  keyboardWidth,
  noteLabel,
} from '@/features/piano-keyboard/keyboard-geometry';

const W = 20;
const H = 100;

describe('isBlackKey', () => {
  it('is true for the five black pitch classes of an octave', () => {
    // C4 = 60, so 61 = C#4, 63 = D#4, 66 = F#4, 68 = G#4, 70 = A#4.
    for (const midi of [61, 63, 66, 68, 70]) expect(isBlackKey(midi)).toBe(true);
  });

  it('is false for the seven white pitch classes', () => {
    for (const midi of [60, 62, 64, 65, 67, 69, 71]) expect(isBlackKey(midi)).toBe(false);
  });
});

describe('noteLabel', () => {
  it('spells middle C and a sharp', () => {
    expect(noteLabel(60)).toBe('C4');
    expect(noteLabel(61)).toBe('C#4');
  });
});

describe('keyboardWidth', () => {
  it('is one white-key width per white key, unaffected by the blacks', () => {
    expect(keyboardWidth(W)).toBe(WHITE_KEY_COUNT * W);
  });
});

describe('computeKeys', () => {
  const keys = computeKeys(W, H);
  const whites = keys.filter((k) => !k.isBlack);
  const blacks = keys.filter((k) => k.isBlack);

  it('produces a standard 88-key piano', () => {
    expect(keys).toHaveLength(88);
    expect(whites).toHaveLength(52);
    expect(blacks).toHaveLength(36);
  });

  it('spans A0 to C8', () => {
    const midis = keys.map((k) => k.midi);
    expect(Math.min(...midis)).toBe(KEYBOARD_MIN_MIDI);
    expect(Math.max(...midis)).toBe(KEYBOARD_MAX_MIDI);
  });

  it('puts every white key before every black one, so blacks draw on top', () => {
    const firstBlack = keys.findIndex((k) => k.isBlack);
    expect(keys.slice(0, firstBlack).every((k) => !k.isBlack)).toBe(true);
    expect(keys.slice(firstBlack).every((k) => k.isBlack)).toBe(true);
  });

  it('tiles the white keys left to right with no gap and no overlap', () => {
    whites.forEach((key, i) => {
      expect(key.x).toBe(i * W);
      expect(key.width).toBe(W);
    });
    expect(whites.map((k) => k.midi)).toEqual([...whites.map((k) => k.midi)].sort((a, b) => a - b));
  });

  it('fills exactly the reported keyboard width', () => {
    const last = whites[whites.length - 1];
    expect(last.x + last.width).toBe(keyboardWidth(W));
  });

  it('straddles each black key over the boundary between its neighbouring whites', () => {
    for (const black of blacks) {
      // The white immediately below this black shares its left neighbour.
      const leftWhite = whites.filter((w) => w.midi < black.midi).at(-1)!;
      const boundary = leftWhite.x + leftWhite.width;
      expect(black.x + black.width / 2).toBeCloseTo(boundary, 6);
    }
  });

  it('makes black keys narrower and shorter than white ones', () => {
    for (const black of blacks) {
      expect(black.width).toBeCloseTo(W * BLACK_KEY_WIDTH_RATIO, 6);
      expect(black.height).toBeCloseTo(H * BLACK_KEY_HEIGHT_RATIO, 6);
      expect(black.width).toBeLessThan(W);
      expect(black.height).toBeLessThan(H);
    }
  });

  it('gives every white key the full height', () => {
    for (const white of whites) expect(white.height).toBe(H);
  });

  it('labels every C and F, and nothing else', () => {
    // C and F are the landmarks of the black-key groups -- C sits left of the
    // group of two, F left of the group of three -- so with both labelled no
    // white key is more than two steps from a reference. Labelling all seven
    // per octave is legible only while the keys are wide, and this shrinks.
    const labelled = keys.filter((k) => k.label !== null);
    expect(labelled.map((k) => k.label).slice(0, 6)).toEqual(['C1', 'F1', 'C2', 'F2', 'C3', 'F3']);
    for (const key of keys) {
      if (key.label === null) continue;
      expect([0, 5]).toContain(key.midi % 12); // pitch class C or F
      expect(key.isBlack).toBe(false);
    }
  });

  it('never places a black key at either extreme', () => {
    // A0 is white and C8 is white, so the keyboard begins and ends on a white.
    expect(isBlackKey(KEYBOARD_MIN_MIDI)).toBe(false);
    expect(isBlackKey(KEYBOARD_MAX_MIDI)).toBe(false);
  });

  it('scales with the given key size', () => {
    const bigger = computeKeys(W * 2, H * 2);
    const biggerWhites = bigger.filter((k) => !k.isBlack);
    expect(biggerWhites[1].x).toBe(whites[1].x * 2);
    expect(biggerWhites[0].height).toBe(H * 2);
  });
});
