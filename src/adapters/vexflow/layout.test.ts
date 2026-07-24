import { describe, expect, it } from 'vitest';
import { computeLayout } from '@/adapters/vexflow/layout';
import type { RenderTheme } from '@/adapters/vexflow/types';
import { chordScore, twinkleScore, twoTrackScore } from '@/test/fixtures';

const theme: RenderTheme = { foreground: '#000', selection: '#00f', playback: '#f00', preview: '#999' };

function options(overrides: Partial<Parameters<typeof computeLayout>[1]> = {}) {
  return { zoom: 1, layoutMode: 'page' as const, width: 900, theme, ...overrides };
}

describe('computeLayout', () => {
  it('lays out every measure of every track, one box each', () => {
    const score = twinkleScore();
    const plan = computeLayout(score, options());

    expect(plan.trackLayouts).toHaveLength(1);
    expect(plan.trackLayouts[0].measures).toHaveLength(score.tracks[0].measures.length);
    for (const m of plan.trackLayouts[0].measures) {
      expect(m.box.width).toBeGreaterThan(0);
      expect(m.box.height).toBeGreaterThan(0);
    }
  });

  it('wraps measures into multiple systems in page mode when they exceed the available width', () => {
    const score = twinkleScore(); // 8 measures
    const plan = computeLayout(score, options({ width: 300 }));
    expect(plan.systems.length).toBeGreaterThan(1);
    // Every measure is accounted for exactly once across systems.
    const allIndices = plan.systems.flatMap((s) => s.measureIndices);
    expect(allIndices).toEqual(score.tracks[0].measures.map((_, i) => i));
  });

  it('keeps every measure in a single system in continuous mode regardless of width', () => {
    const score = twinkleScore();
    const plan = computeLayout(score, options({ layoutMode: 'continuous', width: 300 }));
    expect(plan.systems).toHaveLength(1);
    expect(plan.systems[0].measureIndices).toHaveLength(score.tracks[0].measures.length);
  });

  it('gives the first measure of each system extra width for clef/key/time', () => {
    const score = twinkleScore();
    const plan = computeLayout(score, options({ width: 650 }));
    const measures = plan.trackLayouts[0].measures;
    const firstOfFirstSystem = measures.find((m) => m.isFirstInSystem);
    const nonFirst = measures.find((m) => !m.isFirstInSystem);
    expect(firstOfFirstSystem).toBeDefined();
    expect(nonFirst).toBeDefined();
    expect(firstOfFirstSystem!.box.width).toBeGreaterThan(nonFirst!.box.width);
  });

  it('stacks multiple tracks vertically within the same system', () => {
    const score = twoTrackScore();
    const plan = computeLayout(score, options());
    expect(plan.trackLayouts).toHaveLength(2);
    const trebleY = plan.trackLayouts[0].measures[0].box.y;
    const bassY = plan.trackLayouts[1].measures[0].box.y;
    expect(bassY).toBeGreaterThan(trebleY);
    // Same measure index shares x/width across tracks in the same system.
    expect(plan.trackLayouts[0].measures[0].box.x).toBe(plan.trackLayouts[1].measures[0].box.x);
    expect(plan.trackLayouts[0].measures[0].box.width).toBe(plan.trackLayouts[1].measures[0].box.width);
  });

  it('honors trackIds filtering and ordering', () => {
    const score = twoTrackScore();
    const [treble, bass] = score.tracks;
    const plan = computeLayout(score, options({ trackIds: [bass.id, treble.id] }));
    expect(plan.tracks.map((t) => t.id)).toEqual([bass.id, treble.id]);
  });

  it('scales measure width with zoom', () => {
    const score = chordScore();
    const small = computeLayout(score, options({ zoom: 0.5 }));
    const large = computeLayout(score, options({ zoom: 2 }));
    const smallWidth = small.trackLayouts[0].measures[1].box.width;
    const largeWidth = large.trackLayouts[0].measures[1].box.width;
    expect(largeWidth).toBeGreaterThan(smallWidth);
  });

  it('produces a positive total width and height', () => {
    const score = chordScore();
    const plan = computeLayout(score, options());
    expect(plan.totalWidth).toBeGreaterThan(0);
    expect(plan.totalHeight).toBeGreaterThan(0);
  });
});
