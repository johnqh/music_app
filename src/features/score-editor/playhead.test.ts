import { describe, expect, it } from 'vitest';
import { computeLayout, twinkleScore } from '@sudobility/music_lib';
import { caretPositionForTick, tickForPoint } from '@/features/score-editor/playhead';

const THEME = { foreground: '#000', selection: '#00f', playback: '#f00', preview: '#999' };

function plan(score = twinkleScore()) {
  return computeLayout(score, { zoom: 1, layoutMode: 'page', width: 900, theme: THEME });
}

describe('caretPositionForTick', () => {
  it('places tick 0 at the first measure left edge, spanning the first system', () => {
    const score = twinkleScore();
    const p = plan(score);
    const caret = caretPositionForTick(p, score, 0)!;
    const firstMeasure = p.trackLayouts[0].measures[0];
    expect(caret.x).toBe(firstMeasure.box.x);
    expect(caret.yTop).toBe(p.systems[0].yTop);
    expect(caret.yBottom).toBe(p.systems[0].yBottom);
  });

  it('interpolates linearly within a measure', () => {
    const score = twinkleScore();
    const p = plan(score);
    const m0 = score.tracks[0].measures[0];
    const halfway = m0.startTick + m0.durationTicks / 2;
    const caret = caretPositionForTick(p, score, halfway)!;
    const box = p.trackLayouts[0].measures[0].box;
    expect(caret.x).toBeCloseTo(box.x + box.width / 2, 5);
  });

  it('clamps ticks past the end of the score to the final measure right edge', () => {
    const score = twinkleScore();
    const p = plan(score);
    const caret = caretPositionForTick(p, score, Number.MAX_SAFE_INTEGER)!;
    const lastLayout = p.trackLayouts[0].measures.at(-1)!;
    expect(caret.x).toBe(lastLayout.box.x + lastLayout.box.width);
  });
});

describe('tickForPoint', () => {
  it('round-trips with caretPositionForTick inside a measure', () => {
    const score = twinkleScore();
    const p = plan(score);
    const m1 = score.tracks[0].measures[1];
    const targetTick = m1.startTick + Math.round(m1.durationTicks / 4);
    const caret = caretPositionForTick(p, score, targetTick)!;
    const tick = tickForPoint(p, score, caret.x, (caret.yTop + caret.yBottom) / 2);
    expect(tick).toBe(targetTick);
  });

  it('clamps clicks left of the first measure (clef area) to the system start tick', () => {
    const score = twinkleScore();
    const p = plan(score);
    const system = p.systems[0];
    const tick = tickForPoint(p, score, 0, (system.yTop + system.yBottom) / 2);
    const firstIndex = Math.min(...system.measureIndices);
    expect(tick).toBe(score.tracks[0].measures[firstIndex].startTick);
  });

  it('returns null in the dead space between systems', () => {
    const score = twinkleScore();
    const p = plan(score);
    if (p.systems.length < 2) return; // layout wrapped into a single system; nothing between
    const gapY = (p.systems[0].yBottom + p.systems[1].yTop) / 2;
    expect(tickForPoint(p, score, 100, gapY)).toBeNull();
  });
});
