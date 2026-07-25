import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_WIDTH,
  MAX_MIDI,
  MIN_MIDI,
  ROW_HEIGHT,
  VELOCITY_LANE_HEIGHT,
  VOICE_LANE_ROW_HEIGHT,
  computeGridLines,
  computeKeyboardRows,
  computeNoteRects,
  computePreviewNoteRects,
  cullToViewport,
  isBlackKey,
  isNearRightEdge,
  keyboardHeightPx,
  midiToY,
  noteLabel,
  rowHeight,
  sameIdSet,
  snapTick,
  tickToX,
  totalCanvasHeight,
  trackColor,
  voiceLaneStripHeight,
  xToTick,
  yToMidi,
} from '@/features/piano-roll/geometry';
import { twinkleScore, twoTrackScore } from '@sudobility/music_lib';
import { allNotes } from '@sudobility/music_lib';
import { pitchToMidi } from '@sudobility/music_lib';
import { extractFragment } from '@sudobility/music_lib';

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
    const lines = computeGridLines(track, score.ppq, 1, 'quarter');

    const measureLines = lines.filter((l) => l.kind === 'measure');
    const beatLines = lines.filter((l) => l.kind === 'beat');
    expect(measureLines.length).toBe(track.measures.length);
    expect(beatLines.length).toBeGreaterThan(0);
    expect(measureLines[0].x).toBe(0);
  });

  it('produces subdivision lines at every snapGrid-duration tick that is not already a beat/measure line', () => {
    const score = twinkleScore();
    const track = score.tracks[0];
    // eighth note @ ppq 480 = 240 ticks; the first measure (4/4, 1920
    // ticks) has beats at 0/480/960/1440, so eighth-grid subdivisions land
    // at 240/720/1200/1680 within that measure (the 0/480/960/1440 ticks
    // are already measure/beat lines, and must NOT also appear as
    // subdivision lines — see the dedup test below).
    const lines = computeGridLines(track, score.ppq, 1, 'eighth');
    const subdivisionTicksInFirstMeasure = lines
      .filter((l) => l.kind === 'subdivision' && l.tick < 1920)
      .map((l) => l.tick)
      .sort((a, b) => a - b);

    expect(subdivisionTicksInFirstMeasure).toEqual([240, 720, 1200, 1680]);
  });

  it('dedupes subdivision ticks that coincide with a beat/measure line to the stronger tier', () => {
    const score = twinkleScore();
    const track = score.tracks[0];
    // A quarter-note grid coincides exactly with every beat tick in 4/4 —
    // no tick should appear as both 'beat' and 'subdivision'.
    const lines = computeGridLines(track, score.ppq, 1, 'quarter');
    const beatTicks = new Set(lines.filter((l) => l.kind === 'beat').map((l) => l.tick));
    const subdivisionTicks = lines.filter((l) => l.kind === 'subdivision').map((l) => l.tick);

    expect(subdivisionTicks.every((t) => !beatTicks.has(t))).toBe(true);
    expect(subdivisionTicks.length).toBe(0); // quarter grid == beat grid in 4/4: nothing left over
  });

  it('produces a different line set when snapGrid changes', () => {
    const score = twinkleScore();
    const track = score.tracks[0];
    const eighthLines = computeGridLines(track, score.ppq, 1, 'eighth');
    const sixteenthLines = computeGridLines(track, score.ppq, 1, 'sixteenth');

    const eighthSubdivisionCount = eighthLines.filter((l) => l.kind === 'subdivision').length;
    const sixteenthSubdivisionCount = sixteenthLines.filter((l) => l.kind === 'subdivision').length;

    expect(sixteenthSubdivisionCount).toBeGreaterThan(eighthSubdivisionCount);
  });
});

describe('KEYBOARD_WIDTH', () => {
  it('is a positive constant', () => {
    expect(KEYBOARD_WIDTH).toBeGreaterThan(0);
  });
});

describe('computePreviewNoteRects', () => {
  it('returns an empty array for a null fragment', () => {
    expect(computePreviewNoteRects(null, { zoomH: 1, zoomV: 1 })).toEqual([]);
  });

  it('positions preview notes the same way as computeNoteRects, via the fragment ppq', () => {
    const score = twinkleScore();
    const track = score.tracks[0];
    const range = { startTick: 0, endTick: track.measures[0].durationTicks, trackIds: [track.id] };
    const fragment = extractFragment(score, range);

    const rects = computePreviewNoteRects(fragment, { zoomH: 1, zoomV: 1 });

    expect(rects.length).toBeGreaterThan(0);
    const firstNote = track.measures[0].voices[0].events[0];
    const rect = rects.find((r) => r.id === firstNote.id)!;
    expect(rect.x).toBeCloseTo(tickToX(firstNote.startTick, score.ppq, 1));
    expect(rect.trackId).toBe(track.id);
  });
});

describe('keyboardHeightPx / voiceLaneStripHeight / totalCanvasHeight', () => {
  it('keyboardHeightPx spans every key at the given zoom', () => {
    expect(keyboardHeightPx(1)).toBe((MAX_MIDI - MIN_MIDI + 1) * ROW_HEIGHT);
  });

  it('voiceLaneStripHeight scales with voice count', () => {
    expect(voiceLaneStripHeight(2)).toBe(2 * VOICE_LANE_ROW_HEIGHT);
  });

  it('totalCanvasHeight sums the keyboard, voice-lane, and velocity-lane heights', () => {
    const zoomV = 1;
    const voiceCount = 2;
    expect(totalCanvasHeight(zoomV, voiceCount)).toBe(
      keyboardHeightPx(zoomV) + voiceLaneStripHeight(voiceCount) + VELOCITY_LANE_HEIGHT,
    );
  });
});

describe('cullToViewport (Task 17, spec §29 virtualization)', () => {
  const rect = (id: string, x: number, y: number, width = 10, height = 10) => ({ id, x, y, width, height });

  it('keeps only rects whose box intersects the viewport', () => {
    const rects = [rect('inside', 5, 5), rect('outside', 1000, 1000)];
    const viewport = { x: 0, y: 0, width: 100, height: 100 };
    expect(cullToViewport(rects, viewport).map((r) => r.id)).toEqual(['inside']);
  });

  it('excludes a rect that merely touches the viewport edge (matches bboxesIntersect: overlap must be nonzero)', () => {
    const rects = [rect('touching', 100, 0)]; // starts exactly where a 100-wide viewport ends
    const viewport = { x: 0, y: 0, width: 100, height: 100 };
    expect(cullToViewport(rects, viewport)).toEqual([]);
  });

  it('returns an empty array for an empty input', () => {
    expect(cullToViewport([], { x: 0, y: 0, width: 100, height: 100 })).toEqual([]);
  });

  it('returns every rect for a viewport covering all of them', () => {
    const rects = [rect('a', 0, 0), rect('b', 500, 500)];
    expect(cullToViewport(rects, { x: 0, y: 0, width: 1000, height: 1000 })).toEqual(rects);
  });
});

describe('sameIdSet (Task 17, spec §29 scroll-throttle guard)', () => {
  it('is true for two sets with the same members, regardless of insertion order', () => {
    expect(sameIdSet(new Set(['a', 'b', 'c']), new Set(['c', 'b', 'a']))).toBe(true);
  });

  it('is true for the identical reference', () => {
    const s = new Set(['a', 'b']);
    expect(sameIdSet(s, s)).toBe(true);
  });

  it('is false for sets of different size', () => {
    expect(sameIdSet(new Set(['a', 'b']), new Set(['a', 'b', 'c']))).toBe(false);
  });

  it('is false for same-size sets with different members', () => {
    expect(sameIdSet(new Set(['a', 'b', 'c']), new Set(['a', 'b', 'd']))).toBe(false);
  });

  it('is true for two empty sets', () => {
    expect(sameIdSet(new Set(), new Set())).toBe(true);
  });
});
