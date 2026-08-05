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
} from '@/features/score-editor/hit-test';
import type { BBox, LayoutPlan } from '@sudobility/music_lib';

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
