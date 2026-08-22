import { describe, expect, it } from 'vitest';
import {
  bboxesIntersect,
  measureIndexAtGutterPoint,
  boxFromPoints,
  eventIdAtPoint,
  eventIdsAtPoint,
  eventIdsInBox,
  measureIdAtPoint,
  pointInBBox,
  pitchAtStavePoint,
  trackIdAtContentPoint,
  soundingPitchForDrawn,
} from '@/features/score-editor/hit-test';
import {
  STAVE_POSITION_HEIGHT,
  STAVE_TOP_LINE_OFFSET,
  changeMeasureClefCommand,
  computeLayout,
  isNoteEvent,
  testRenderTheme,
  toggleOttavaCommand,
  twinkleScore,
  twoTrackScore,
  pitchToMidi,
  trackWrittenTransposition,
} from '@sudobility/music_lib';
import type { BBox, LayoutPlan } from '@sudobility/music_lib';
import type { Pitch } from '@sudobility/music_types';

const box: BBox = { x: 10, y: 10, width: 20, height: 10 };

describe('pointInBBox', () => {
  it('is true for a point inside the box', () => {
    expect(pointInBBox(box, { x: 15, y: 15 })).toBe(true);
  });

  it('is true for a point exactly on an edge', () => {
    expect(pointInBBox(box, { x: 10, y: 10 })).toBe(true);
    expect(pointInBBox(box, { x: 30, y: 20 })).toBe(true);
  });

  it('is false for a point outside the box', () => {
    expect(pointInBBox(box, { x: 5, y: 15 })).toBe(false);
    expect(pointInBBox(box, { x: 15, y: 25 })).toBe(false);
  });
});

describe('bboxesIntersect', () => {
  it('is true for overlapping boxes', () => {
    const other: BBox = { x: 20, y: 15, width: 20, height: 10 };
    expect(bboxesIntersect(box, other)).toBe(true);
  });

  it('is false for disjoint boxes', () => {
    const other: BBox = { x: 100, y: 100, width: 5, height: 5 };
    expect(bboxesIntersect(box, other)).toBe(false);
  });

  it('is false for boxes that only touch at an edge (no area overlap)', () => {
    const other: BBox = { x: 30, y: 10, width: 10, height: 10 };
    expect(bboxesIntersect(box, other)).toBe(false);
  });
});

describe('boxFromPoints', () => {
  it('normalizes to non-negative width/height regardless of drag direction', () => {
    expect(boxFromPoints({ x: 5, y: 5 }, { x: 25, y: 15 })).toEqual({
      x: 5,
      y: 5,
      width: 20,
      height: 10,
    });
    expect(boxFromPoints({ x: 25, y: 15 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 20,
      height: 10,
    });
  });

  it('produces a zero-size box for a click with no drag', () => {
    expect(boxFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });
});

describe('eventIdAtPoint', () => {
  it('finds the id whose bbox contains the point', () => {
    const map = new Map<string, BBox>([
      ['a', { x: 0, y: 0, width: 10, height: 10 }],
      ['b', { x: 20, y: 0, width: 10, height: 10 }],
    ]);
    expect(eventIdAtPoint(map, { x: 25, y: 5 })).toBe('b');
  });

  it('returns null when nothing matches', () => {
    const map = new Map<string, BBox>([['a', { x: 0, y: 0, width: 10, height: 10 }]]);
    expect(eventIdAtPoint(map, { x: 50, y: 50 })).toBeNull();
  });
});

describe('eventIdsInBox', () => {
  it('returns every id whose bbox intersects the drag box', () => {
    const map = new Map<string, BBox>([
      ['a', { x: 0, y: 0, width: 10, height: 10 }],
      ['b', { x: 15, y: 0, width: 10, height: 10 }],
      ['c', { x: 100, y: 100, width: 10, height: 10 }],
    ]);
    const drag: BBox = { x: 5, y: 0, width: 20, height: 10 };
    expect(eventIdsInBox(map, drag)).toEqual(['a', 'b']);
  });

  it('returns an empty array when the box misses everything', () => {
    const map = new Map<string, BBox>([['a', { x: 0, y: 0, width: 10, height: 10 }]]);
    expect(eventIdsInBox(map, { x: 100, y: 100, width: 5, height: 5 })).toEqual([]);
  });
});

describe('topmost-wins hit-testing and measureIdAtPoint', () => {
  const boxes = new Map([
    ['under', { x: 10, y: 10, width: 20, height: 20 }],
    ['over', { x: 15, y: 15, width: 20, height: 20 }],
  ]);

  it('returns the id whose bbox contains the point', () => {
    expect(eventIdAtPoint(boxes, { x: 11, y: 11 })).toBe('under');
    expect(measureIdAtPoint(boxes, { x: 11, y: 11 })).toBe('under');
  });

  it('prefers the later-inserted (topmost) id when bboxes overlap', () => {
    expect(eventIdAtPoint(boxes, { x: 20, y: 20 })).toBe('over');
  });

  it('returns null outside every bbox', () => {
    expect(eventIdAtPoint(boxes, { x: 500, y: 500 })).toBeNull();
    expect(measureIdAtPoint(boxes, { x: 500, y: 500 })).toBeNull();
  });
});

describe('measureIndexAtGutterPoint', () => {
  // A hand-built two-measure, one-system plan: only the fields the hit test
  // reads, so the expectations stay readable.
  const plan = {
    systems: [
      {
        measureIndices: [0, 1],
        xLeft: 10,
        xRight: 410,
        gutterTop: 10,
        yTop: 28,
        yBottom: 128,
      },
    ],
    trackLayouts: [
      {
        measures: [
          {
            measureIndex: 0,
            isFirstInSystem: true,
            box: { x: 10, y: 28, width: 200, height: 100 },
          },
          {
            measureIndex: 1,
            isFirstInSystem: false,
            box: { x: 210, y: 28, width: 200, height: 100 },
          },
        ],
      },
    ],
  } as unknown as LayoutPlan;

  it('finds the measure under a point inside the gutter band', () => {
    expect(measureIndexAtGutterPoint(plan, { x: 50, y: 20 })).toBe(0);
    expect(measureIndexAtGutterPoint(plan, { x: 250, y: 20 })).toBe(1);
  });

  it('returns null below the band, where the stave itself starts', () => {
    expect(measureIndexAtGutterPoint(plan, { x: 50, y: 60 })).toBeNull();
  });

  it('returns null above the band', () => {
    expect(measureIndexAtGutterPoint(plan, { x: 50, y: 2 })).toBeNull();
  });

  it('returns null horizontally past the last measure', () => {
    expect(measureIndexAtGutterPoint(plan, { x: 500, y: 20 })).toBeNull();
  });

  it('returns null left of the first measure', () => {
    expect(measureIndexAtGutterPoint(plan, { x: 2, y: 20 })).toBeNull();
  });

  it('treats the band as half-open at the stave top, so yTop belongs to the stave', () => {
    expect(measureIndexAtGutterPoint(plan, { x: 50, y: 28 })).toBeNull();
    expect(measureIndexAtGutterPoint(plan, { x: 50, y: 27 })).toBe(0);
  });
});

describe('eventIdsAtPoint', () => {
  const box: BBox = { x: 10, y: 10, width: 20, height: 20 };

  it('returns every id sharing a box, which is what a chord is', () => {
    // Every note of a chord is drawn as one VexFlow StaveNote, so the renderer
    // maps them all to the same box. Returning one of them is what made a
    // chord impossible to select.
    const map = new Map([
      ['c', box],
      ['e', box],
      ['g', box],
    ]);
    expect(eventIdsAtPoint(map, { x: 15, y: 15 }).sort()).toEqual(['c', 'e', 'g']);
  });

  it('returns only the ids under the point', () => {
    const map = new Map<string, BBox>([
      ['hit', box],
      ['elsewhere', { x: 100, y: 100, width: 5, height: 5 }],
    ]);
    expect(eventIdsAtPoint(map, { x: 15, y: 15 })).toEqual(['hit']);
  });

  it('returns an empty list when nothing is under the point', () => {
    expect(eventIdsAtPoint(new Map([['a', box]]), { x: 0, y: 0 })).toEqual([]);
  });
});

describe('trackIdAtContentPoint', () => {
  const twoTrackPlan = () =>
    computeLayout(twoTrackScore(), {
      zoom: 1,
      layoutMode: 'page',
      width: 1200,
      theme: testRenderTheme(),
    });

  it('finds the track whose stave band contains the point', () => {
    const plan = twoTrackPlan();
    const [a, b] = plan.trackLayouts;
    const boxA = a.measures[0].box;
    const boxB = b.measures[0].box;

    expect(trackIdAtContentPoint(plan, { x: boxA.x + 10, y: boxA.y + boxA.height / 2 })).toBe(
      a.track.id,
    );
    expect(trackIdAtContentPoint(plan, { x: boxB.x + 10, y: boxB.y + boxB.height / 2 })).toBe(
      b.track.id,
    );
  });

  it('is null above the first stave', () => {
    expect(trackIdAtContentPoint(twoTrackPlan(), { x: 100, y: -500 })).toBeNull();
  });

  it('works anywhere across the width, unlike the gutter hit test', () => {
    // `trackIdAtGutterPoint` is x-constrained to the gutter and reads viewport
    // coordinates, because the gutter is pinned to the viewport. A drop can
    // land anywhere on the staff, in content coordinates.
    const plan = twoTrackPlan();
    const box = plan.trackLayouts[1].measures[0].box;
    expect(trackIdAtContentPoint(plan, { x: box.x + box.width - 5, y: box.y + 5 })).toBe(
      plan.trackLayouts[1].track.id,
    );
  });
});

describe('pitchAtStavePoint with a clef change', () => {
  it('reads the bar in the clef actually in force, not the track clef', () => {
    // The failure this prevents is silent and looks like a rounding error: the
    // renderer draws the changed bar in bass, the hit test resolves it in
    // treble, and a click places a note a sixth from the line under the
    // pointer. Both sides go through `effectiveClef` so they cannot diverge.
    const score = twinkleScore();
    const trackId = score.tracks[0].id;
    const changed = changeMeasureClefCommand(trackId, 1, 'bass', 'Clef').execute(score);

    const plan = computeLayout(changed, {
      zoom: 1,
      layoutMode: 'page',
      width: 1200,
      theme: testRenderTheme(),
    });
    const trackLayout = plan.trackLayouts[0];
    const first = trackLayout.measures.find((m) => m.measureIndex === 0);
    const changedBar = trackLayout.measures.find((m) => m.measureIndex === 1);
    expect(first).toBeTruthy();
    expect(changedBar).toBeTruthy();

    // The same staff position in each bar, so the clef is the only difference.
    const at = (m: NonNullable<typeof first>) =>
      pitchAtStavePoint(plan, changed, {
        x: m.box.x + m.box.width / 2,
        y: m.box.y + STAVE_TOP_LINE_OFFSET + STAVE_POSITION_HEIGHT * 2,
      });

    const inTreble = at(first!);
    const inBass = at(changedBar!);

    expect(inTreble?.pitch).toBeTruthy();
    expect(inBass?.pitch).toBeTruthy();
    expect(inBass!.pitch).not.toEqual(inTreble!.pitch);
  });
});

describe('soundingPitchForDrawn — inverting the display lenses', () => {
  it('is a no-op in concert mode with no bracket', () => {
    // Almost every call. The stored pitch must be exactly what was clicked.
    const score = twinkleScore();
    const drawn: Pitch = { step: 'C', accidental: 0, octave: 4 };
    expect(soundingPitchForDrawn(score, score.tracks[0].id, 0, drawn, 'concert')).toEqual(drawn);
  });

  it('adds the octave back inside an 8va, in concert mode too', () => {
    // The bracket is part of the notation, not a way of reading it, so
    // `ottavaScore` applies in every mode — and so must its inverse.
    const score = twinkleScore();
    const trackId = score.tracks[0].id;
    // Two notes, not one: `toggleOttavaCommand` refuses a bracket that has
    // nowhere to reach, exactly as the slur and hairpin commands do.
    const line = score.tracks[0].measures[0].voices[0].events.filter(isNoteEvent);
    const first = line[0];
    const marked = toggleOttavaCommand([first.id, line[1].id], '8va', 'Ottava').execute(score);

    const drawn: Pitch = { step: 'C', accidental: 0, octave: 4 };
    const stored = soundingPitchForDrawn(marked, trackId, first.startTick, drawn, 'concert');
    // 8va: the notes were written an octave low, so what sounds is an octave up.
    expect(stored.octave).toBe(5);
    expect(stored.step).toBe('C');
  });

  it('undoes a transposing instrument in written mode', () => {
    // A B-flat clarinet reads a whole tone above what it sounds, so a click on
    // the line drawn as E stores D.
    const base = twinkleScore();
    const score = {
      ...base,
      tracks: base.tracks.map((t) => ({ ...t, midiProgram: 71 })),
    };
    const drawn: Pitch = { step: 'E', accidental: 0, octave: 5 };
    const stored = soundingPitchForDrawn(score, score.tracks[0].id, 0, drawn, 'written');
    expect(stored).not.toEqual(drawn);
    expect(stored.step).toBe('D');
    expect(stored.octave).toBe(5);
  });

  it('leaves a transposing instrument alone in concert mode', () => {
    // The lens was not applied, so neither is its inverse — getting this
    // backwards would break the common case to fix the rare one.
    const base = twinkleScore();
    const score = {
      ...base,
      tracks: base.tracks.map((t) => ({ ...t, midiProgram: 71 })),
    };
    const drawn: Pitch = { step: 'E', accidental: 0, octave: 5 };
    expect(soundingPitchForDrawn(score, score.tracks[0].id, 0, drawn, 'concert')).toEqual(drawn);
  });

  it('round-trips: a note stored from a click draws back where it was clicked', () => {
    // The property that makes this correct rather than merely different — the
    // whole point is that the reader gets the note they aimed at.
    const base = twinkleScore();
    const score = {
      ...base,
      tracks: base.tracks.map((t) => ({ ...t, midiProgram: 71 })),
    };
    const track = score.tracks[0];
    const semitones = trackWrittenTransposition(track);
    expect(semitones).not.toBe(0);
    for (const step of ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const) {
      const drawn: Pitch = { step, accidental: 0, octave: 5 };
      const stored = soundingPitchForDrawn(score, track.id, 0, drawn, 'written');
      // Compared as pitch, not as spelling: written-to-sounding preserves the
      // sound exactly and respells freely, which is measured and deliberate.
      expect(pitchToMidi(stored) + semitones).toBe(pitchToMidi(drawn));
    }
  });
});
