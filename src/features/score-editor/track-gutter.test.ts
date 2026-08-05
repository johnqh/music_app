import { describe, expect, it } from 'vitest';
import { TRACK_INFO_WIDTH } from '@sudobility/music_lib';
import type { LayoutPlan } from '@sudobility/music_lib';
import { trackIdAtGutterPoint } from '@/features/score-editor/track-gutter';

/** Two tracks, two systems: staves at y 28/148 (system 0) and 268/388 (system 1), each 100 tall. */
function plan(): LayoutPlan {
  return {
    tracks: [{ id: 't0' }, { id: 't1' }],
    systems: [
      { measureIndices: [0, 1], xLeft: 230, xRight: 630, gutterTop: 10, yTop: 28, yBottom: 248 },
      { measureIndices: [2, 3], xLeft: 230, xRight: 630, gutterTop: 250, yTop: 268, yBottom: 488 },
    ],
    trackLayouts: [
      {
        track: { id: 't0' },
        measures: [
          {
            measureIndex: 0,
            isFirstInSystem: true,
            box: { x: 230, y: 28, width: 200, height: 100 },
          },
          {
            measureIndex: 2,
            isFirstInSystem: true,
            box: { x: 230, y: 268, width: 200, height: 100 },
          },
        ],
      },
      {
        track: { id: 't1' },
        measures: [
          {
            measureIndex: 0,
            isFirstInSystem: true,
            box: { x: 230, y: 148, width: 200, height: 100 },
          },
          {
            measureIndex: 2,
            isFirstInSystem: true,
            box: { x: 230, y: 388, width: 200, height: 100 },
          },
        ],
      },
    ],
    totalWidth: 700,
    totalHeight: 520,
  } as unknown as LayoutPlan;
}

describe('trackIdAtGutterPoint', () => {
  it('finds the track whose band contains the point', () => {
    expect(trackIdAtGutterPoint(plan(), 1, 0, { x: 20, y: 60 })).toBe('t0');
    expect(trackIdAtGutterPoint(plan(), 1, 0, { x: 20, y: 180 })).toBe('t1');
  });

  it('returns null to the right of the gutter, where the staves are', () => {
    expect(trackIdAtGutterPoint(plan(), 1, 0, { x: TRACK_INFO_WIDTH + 5, y: 60 })).toBeNull();
  });

  it('resolves bands in a later system, since the gutter repeats', () => {
    // System 1's first stave is at content y 268; scrolled to 240 it sits at 28.
    expect(trackIdAtGutterPoint(plan(), 1, 240, { x: 20, y: 60 })).toBe('t0');
    expect(trackIdAtGutterPoint(plan(), 1, 240, { x: 20, y: 180 })).toBe('t1');
  });

  it('accounts for the scroll position', () => {
    expect(trackIdAtGutterPoint(plan(), 1, 20, { x: 20, y: 40 })).toBe('t0');
  });

  it('scales the hit region by zoom', () => {
    // At 2x the gutter is twice as wide and the bands twice as tall.
    expect(trackIdAtGutterPoint(plan(), 2, 0, { x: TRACK_INFO_WIDTH + 5, y: 120 })).toBe('t0');
    expect(trackIdAtGutterPoint(plan(), 2, 0, { x: TRACK_INFO_WIDTH * 2 + 5, y: 120 })).toBeNull();
  });

  it('returns null in the gap between staves', () => {
    // Between t0's band (28-128) and t1's (148-248).
    expect(trackIdAtGutterPoint(plan(), 1, 0, { x: 20, y: 138 })).toBeNull();
  });

  it('returns null for an empty plan', () => {
    const empty = {
      tracks: [],
      systems: [],
      trackLayouts: [],
      totalWidth: 0,
      totalHeight: 0,
    } as unknown as LayoutPlan;
    expect(trackIdAtGutterPoint(empty, 1, 0, { x: 20, y: 60 })).toBeNull();
  });
});
