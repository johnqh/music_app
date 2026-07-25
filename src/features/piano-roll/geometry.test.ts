import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_WIDTH,
  MAX_MIDI,
  MIN_MIDI,
  ROW_HEIGHT,
  computeGridLines,
  computeKeyboardRows,
  computeNoteRects,
  isBlackKey,
  isNearRightEdge,
  midiToY,
  noteLabel,
  rowHeight,
  snapTick,
  tickToX,
  trackColor,
  xToTick,
  yToMidi,
} from '@/features/piano-roll/geometry';
import { twinkleScore, twoTrackScore } from '@/test/fixtures';
import { allNotes } from '@/domain/score/queries';
import { pitchToMidi } from '@/domain/pitch/pitch';

describe('tickToX / xToTick', () => {
  it('is 0 at tick 0', () => {
    expect(tickToX(0, 480, 1)).toBe(0);
  });

  it('scales linearly with zoomH', () => {
    const x1 = tickToX(480, 480, 1);
    const x2 = tickToX(480, 480, 2);
    expect(x2).toBeCloseTo(x1 * 2);
  });

  it('round-trips through xToTick', () => {
    const ppq = 480;
    const zoomH = 1.5;
    const tick = 960;
    const x = tickToX(tick, ppq, zoomH);
    expect(xToTick(x, ppq, zoomH)).toBeCloseTo(tick, 5);
  });
});

describe('midiToY / yToMidi', () => {
  it('places a higher pitch above (smaller y than) a lower pitch', () => {
    const yHigh = midiToY(72, 1);
    const yLow = midiToY(60, 1);
    expect(yHigh).toBeLessThan(yLow);
  });

  it('separates adjacent semitones by exactly one row height', () => {
    const y1 = midiToY(60, 1);
    const y2 = midiToY(61, 1);
    expect(y1 - y2).toBeCloseTo(rowHeight(1));
  });

  it('scales row height with zoomV', () => {
    expect(rowHeight(2)).toBeCloseTo(ROW_HEIGHT * 2);
  });

  it('round-trips through yToMidi', () => {
    for (const midi of [21, 40, 60, 61, 72, 108]) {
      const y = midiToY(midi, 1);
      expect(yToMidi(y, 1)).toBe(midi);
    }
  });

  it('clamps yToMidi to the keyboard range', () => {
    expect(yToMidi(-1000, 1)).toBe(MAX_MIDI);
    expect(yToMidi(1000000, 1)).toBe(MIN_MIDI);
  });
});

describe('snapTick', () => {
  it('rounds to the nearest grid multiple', () => {
    expect(snapTick(110, 100)).toBe(100);
    expect(snapTick(160, 100)).toBe(200);
  });

  it('clamps to non-negative', () => {
    expect(snapTick(-50, 100)).toBe(0);
  });

  it('is a no-op passthrough (rounded) when gridTicks is 0', () => {
    expect(snapTick(123.6, 0)).toBe(124);
  });
});

describe('isBlackKey', () => {
  it('identifies the five black keys per octave', () => {
    // C4=60 white, C#4=61 black, D4=62 white, D#4=63 black, E4=64 white,
    // F4=65 white, F#4=66 black, G4=67 white, G#4=68 black, A4=69 white,
    // A#4=70 black, B4=71 white.
    const expected = [false, true, false, true, false, false, true, false, true, false, true, false];
    for (let i = 0; i < 12; i += 1) {
      expect(isBlackKey(60 + i)).toBe(expected[i]);
    }
  });
});

describe('noteLabel', () => {
  it('formats a midi number as a pitch string', () => {
    expect(noteLabel(60)).toBe('C4');
    expect(noteLabel(69)).toBe('A4');
  });
});

describe('isNearRightEdge', () => {
  const rect = { x: 0, y: 0, width: 40, height: 10 };

  it('is true within the handle tolerance of the right edge', () => {
    expect(isNearRightEdge(rect, { x: 38, y: 5 }, 6)).toBe(true);
    expect(isNearRightEdge(rect, { x: 41, y: 5 }, 6)).toBe(true);
  });

  it('is false far from the right edge', () => {
    expect(isNearRightEdge(rect, { x: 5, y: 5 }, 6)).toBe(false);
  });

  it('is false outside the vertical band, even near the edge horizontally', () => {
    expect(isNearRightEdge(rect, { x: 38, y: 50 }, 6)).toBe(false);
  });
});

describe('trackColor', () => {
  it('is deterministic for a given index', () => {
    expect(trackColor(0)).toBe(trackColor(0));
  });

  it('cycles through a fixed palette', () => {
    expect(trackColor(0)).not.toBe(trackColor(1));
  });
});

describe('computeKeyboardRows', () => {
  it('spans the full MIN_MIDI..MAX_MIDI range, high to low', () => {
    const rows = computeKeyboardRows(1);
    expect(rows.length).toBe(MAX_MIDI - MIN_MIDI + 1);
    expect(rows[0].midi).toBe(MAX_MIDI);
    expect(rows[rows.length - 1].midi).toBe(MIN_MIDI);
  });

  it('marks black/white keys and y positions consistent with midiToY', () => {
    const rows = computeKeyboardRows(1);
    const row = rows.find((r) => r.midi === 61)!;
    expect(row.isBlack).toBe(true);
    expect(row.y).toBe(midiToY(61, 1));
  });
});

describe('computeNoteRects', () => {
  it('produces one rect per visible note, positioned via tickToX/midiToY', () => {
    const score = twinkleScore();
    const notes = allNotes(score);
    const rects = computeNoteRects(score, { visibleTrackIds: null, zoomH: 1, zoomV: 1 });

    expect(rects.length).toBe(notes.length);
    const first = rects.find((r) => r.id === notes[0].id)!;
    expect(first.x).toBeCloseTo(tickToX(notes[0].startTick, score.ppq, 1));
    expect(first.y).toBeCloseTo(midiToY(pitchToMidi(notes[0].pitch), 1));
    expect(first.width).toBeCloseTo(tickToX(notes[0].durationTicks, score.ppq, 1));
    expect(first.trackId).toBe(notes[0].trackId);
    expect(first.velocity).toBe(notes[0].velocity);
  });

  it('filters to only the visible track ids when given a non-null set', () => {
    const score = twoTrackScore();
    const [treble, bass] = score.tracks;
    const rects = computeNoteRects(score, { visibleTrackIds: new Set([treble.id]), zoomH: 1, zoomV: 1 });

    expect(rects.every((r) => r.trackId === treble.id)).toBe(true);
    expect(rects.some((r) => r.trackId === bass.id)).toBe(false);
    expect(rects.length).toBeGreaterThan(0);
  });
});

describe('computeGridLines', () => {
  it('produces measure and beat lines for a 4/4 track', () => {
    const score = twinkleScore();
    const track = score.tracks[0];
    const lines = computeGridLines(track, score.ppq, 1);

    const measureLines = lines.filter((l) => l.kind === 'measure');
    const beatLines = lines.filter((l) => l.kind === 'beat');
    expect(measureLines.length).toBe(track.measures.length);
    expect(beatLines.length).toBeGreaterThan(0);
    expect(measureLines[0].x).toBe(0);
  });
});

describe('KEYBOARD_WIDTH', () => {
  it('is a positive constant', () => {
    expect(KEYBOARD_WIDTH).toBeGreaterThan(0);
  });
});
