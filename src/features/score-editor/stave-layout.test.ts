import { describe, expect, it } from 'vitest';
import type { LayoutPlan } from '@sudobility/music_lib';
import { staveRectsForViewport } from '@/features/score-editor/stave-layout';

/**
 * Two tracks, two systems. Only the fields the function reads, so the
 * expectations stay legible: system 0 staves at y 28 and 148, system 1 at
 * y 268 and 388, each 100 tall.
 */
function plan(): LayoutPlan {
  return {
    tracks: [{ id: 't0' }, { id: 't1' }],
    systems: [
      { measureIndices: [0, 1], xLeft: 10, xRight: 410, gutterTop: 10, yTop: 28, yBottom: 248 },
      { measureIndices: [2, 3], xLeft: 10, xRight: 410, gutterTop: 250, yTop: 268, yBottom: 488 },
    ],
    trackLayouts: [
      {
        track: { id: 't0' },
        measures: [
          { measureIndex: 0, isFirstInSystem: true, box: { x: 10, y: 28, width: 200, height: 100 } },
          { measureIndex: 2, isFirstInSystem: true, box: { x: 10, y: 268, width: 200, height: 100 } },
        ],
      },
      {
        track: { id: 't1' },
        measures: [
          { measureIndex: 0, isFirstInSystem: true, box: { x: 10, y: 148, width: 200, height: 100 } },
          { measureIndex: 2, isFirstInSystem: true, box: { x: 10, y: 388, width: 200, height: 100 } },
        ],
      },
    ],
    totalWidth: 420,
    totalHeight: 520,
  } as unknown as LayoutPlan;
}

describe('staveRectsForViewport', () => {
  it('returns one rect per track', () => {
    const rects = staveRectsForViewport(plan(), 1, 0, 0);
    expect(rects.map((r) => r.trackId)).toEqual(['t0', 't1']);
  });

  it('uses the topmost visible system', () => {
    // Scrolled to 0: system 0, staves at 28 and 148.
    expect(staveRectsForViewport(plan(), 1, 0, 0).map((r) => r.top)).toEqual([28, 148]);
    // Scrolled past system 0: system 1, staves at 268 and 388, minus the scroll.
    expect(staveRectsForViewport(plan(), 1, 260, 0).map((r) => r.top)).toEqual([8, 128]);
  });

  it('scales by zoom', () => {
    const rects = staveRectsForViewport(plan(), 2, 0, 0);
    expect(rects[0].top).toBe(56); // 28 * 2
    expect(rects[0].height).toBe(200); // 100 * 2
  });

  it('offsets into client coordinates by the box top', () => {
    const rects = staveRectsForViewport(plan(), 1, 0, 100);
    expect(rects[0].top).toBe(128); // 28 + 100
  });

  it('subtracts the scroll position', () => {
    const rects = staveRectsForViewport(plan(), 1, 20, 0);
    expect(rects[0].top).toBe(8); // 28 - 20
  });

  it('returns a positive height per rect', () => {
    for (const rect of staveRectsForViewport(plan(), 1, 0, 0)) {
      expect(rect.height).toBeGreaterThan(0);
    }
  });

  it('returns empty for a plan with no systems', () => {
    const empty = {
      tracks: [],
      systems: [],
      trackLayouts: [],
      totalWidth: 0,
      totalHeight: 0,
    } as unknown as LayoutPlan;
    expect(staveRectsForViewport(empty, 1, 0, 0)).toEqual([]);
  });

  it('falls back to the last system when scrolled past everything', () => {
    // Rather than returning nothing, which would blank the track panel at the
    // bottom of a long score.
    const rects = staveRectsForViewport(plan(), 1, 100_000, 0);
    expect(rects).toHaveLength(2);
  });
});
