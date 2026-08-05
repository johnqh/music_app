import { describe, expect, it } from 'vitest';
import {
  AUTOSCROLL_EDGE_PX,
  AUTOSCROLL_MAX_PX_PER_FRAME,
  autoscrollDelta,
} from '@/features/score-editor/autoscroll';

const box = { width: 800, height: 600 };

describe('autoscrollDelta', () => {
  it('is zero well inside the box, in either layout mode', () => {
    expect(autoscrollDelta({ x: 400, y: 300, box, layoutMode: 'page' })).toEqual({ dx: 0, dy: 0 });
    expect(autoscrollDelta({ x: 400, y: 300, box, layoutMode: 'continuous' })).toEqual({
      dx: 0,
      dy: 0,
    });
  });

  it('scrolls down in page mode near the bottom edge', () => {
    const d = autoscrollDelta({ x: 400, y: 595, box, layoutMode: 'page' });
    expect(d.dy).toBeGreaterThan(0);
    expect(d.dx).toBe(0);
  });

  it('scrolls up in page mode near the top edge', () => {
    expect(autoscrollDelta({ x: 400, y: 3, box, layoutMode: 'page' }).dy).toBeLessThan(0);
  });

  it('scrolls right in continuous mode near the right edge', () => {
    const d = autoscrollDelta({ x: 795, y: 300, box, layoutMode: 'continuous' });
    expect(d.dx).toBeGreaterThan(0);
    expect(d.dy).toBe(0);
  });

  it('scrolls left in continuous mode near the left edge', () => {
    expect(autoscrollDelta({ x: 3, y: 300, box, layoutMode: 'continuous' }).dx).toBeLessThan(0);
  });

  it('ignores the off-axis edge', () => {
    expect(autoscrollDelta({ x: 795, y: 300, box, layoutMode: 'page' }).dy).toBe(0);
    expect(autoscrollDelta({ x: 400, y: 595, box, layoutMode: 'continuous' }).dx).toBe(0);
  });

  it('scrolls faster the deeper into the edge band the pointer is', () => {
    const shallow = autoscrollDelta({
      x: 400,
      y: 600 - AUTOSCROLL_EDGE_PX + 2,
      box,
      layoutMode: 'page',
    });
    const deep = autoscrollDelta({ x: 400, y: 600, box, layoutMode: 'page' });
    expect(deep.dy).toBeGreaterThan(shallow.dy);
  });

  it('clamps to the maximum rate past the edge', () => {
    const atEdge = autoscrollDelta({ x: 400, y: 600, box, layoutMode: 'page' });
    const beyond = autoscrollDelta({ x: 400, y: 900, box, layoutMode: 'page' });
    expect(atEdge.dy).toBe(AUTOSCROLL_MAX_PX_PER_FRAME);
    expect(beyond.dy).toBe(atEdge.dy);
  });

  it('is exactly zero at the band boundary, so there is no dead nudge', () => {
    expect(
      autoscrollDelta({ x: 400, y: 600 - AUTOSCROLL_EDGE_PX, box, layoutMode: 'page' }).dy,
    ).toBe(0);
  });
});
