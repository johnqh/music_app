import { describe, expect, it } from 'vitest';
import { TRACK_INFO_WIDTH, computeLayout, stressScore, testRenderTheme } from '@sudobility/music_lib';
import type { LayoutPlan } from '@sudobility/music_lib';
import { playbackScrollTarget } from '@/features/score-editor/playback-scroll';

/** A 4-track score, tall enough per system that a reader must pick a track to watch. */
function plan(layoutMode: 'page' | 'continuous' = 'page'): LayoutPlan {
  return computeLayout(stressScore(4, 24), {
    zoom: 1,
    layoutMode,
    width: 900,
    theme: testRenderTheme(),
  });
}

const BASE = { zoom: 1, measureX: 0, margin: 40 };

describe('playbackScrollTarget: page mode', () => {
  it('keeps the same track at the top of the viewport across a wrap', () => {
    // The bug this exists for: following playback scrolled to track 1's stave,
    // so whatever track the reader was watching was thrown off the top of the
    // viewport every time the music wrapped to the next system.
    const p = plan();
    const [first, second] = p.systems;
    expect(second).toBeDefined();

    // Reader has scrolled so track 3 sits at the top of the viewport.
    const track3 = p.trackLayouts[2].measures.find((m) => m.measureIndex === first.measureIndices[0])!;
    const scrollTop = track3.box.y;

    const target = playbackScrollTarget({
      ...BASE,
      plan: p,
      layoutMode: 'page',
      measureIndex: second.measureIndices[0],
      scrollTop,
    })!;

    // Track 3 of the *new* system now sits where track 3 of the old one did.
    const nextTrack3 = p.trackLayouts[2].measures.find(
      (m) => m.measureIndex === second.measureIndices[0],
    )!;
    expect(target.top).toBeCloseTo(nextTrack3.box.y, 5);
  });

  it('leaves the scroll alone while the music stays in one system', () => {
    const p = plan();
    const system = p.systems[0];
    expect(system.measureIndices.length).toBeGreaterThan(1);

    const target = playbackScrollTarget({
      ...BASE,
      plan: p,
      layoutMode: 'page',
      measureIndex: system.measureIndices[1],
      scrollTop: 137,
    })!;

    expect(target.top).toBe(137);
  });

  it('scales the preserved offset with zoom', () => {
    const p = plan();
    const [first, second] = p.systems;
    const zoom = 1.5;
    const offset = 60;

    const target = playbackScrollTarget({
      ...BASE,
      plan: p,
      zoom,
      layoutMode: 'page',
      measureIndex: second.measureIndices[0],
      scrollTop: first.yTop * zoom + offset,
    })!;

    expect(target.top).toBeCloseTo(second.yTop * zoom + offset, 5);
  });

  it('never returns a negative scroll position', () => {
    const p = plan();
    const target = playbackScrollTarget({
      ...BASE,
      plan: p,
      layoutMode: 'page',
      measureIndex: p.systems[1].measureIndices[0],
      scrollTop: 0,
    })!;

    expect(target.top).toBeGreaterThanOrEqual(0);
  });
});

describe('playbackScrollTarget: continuous mode', () => {
  it('never moves vertically, however far the music travels', () => {
    // Continuous mode is one very wide system; following the music is purely
    // horizontal, so any vertical move is the caller fighting the reader.
    const p = plan('continuous');
    const lastMeasure = p.trackLayouts[0].measures.at(-1)!;

    const target = playbackScrollTarget({
      ...BASE,
      plan: p,
      layoutMode: 'continuous',
      measureIndex: lastMeasure.measureIndex,
      measureX: lastMeasure.box.x,
      scrollTop: 421,
    })!;

    expect(target.top).toBe(421);
    expect(target.left).toBeGreaterThan(0);
  });
});

describe('playbackScrollTarget: page mode never scrolls horizontally', () => {
  it('returns a zero left however far into the score the music is', () => {
    // Page mode wraps every system to the viewport, so horizontal following
    // would only slide the sheet under the pinned gutter — and with horizontal
    // scrolling disabled there, the reader could not bring it back.
    const p = plan();
    const lastSystem = p.systems.at(-1)!;
    const measure = p.trackLayouts[0].measures.find(
      (m) => m.measureIndex === lastSystem.measureIndices.at(-1),
    )!;

    const target = playbackScrollTarget({
      ...BASE,
      plan: p,
      layoutMode: 'page',
      measureIndex: measure.measureIndex,
      measureX: measure.box.x,
      scrollTop: 0,
    })!;

    expect(target.left).toBe(0);
  });
});

describe('playbackScrollTarget: horizontal following', () => {
  it('leaves the playing measure clear of the pinned track-info gutter', () => {
    // The gutter is painted over the sheet at the viewport's left edge, so
    // scrolling the measure to just `margin` parked it — and the caret
    // crossing it — behind the track info for most of every measure.
    const p = plan('continuous');
    const measure = p.trackLayouts[0].measures[6];

    const target = playbackScrollTarget({
      ...BASE,
      plan: p,
      layoutMode: 'continuous',
      measureIndex: measure.measureIndex,
      measureX: measure.box.x,
      scrollTop: 0,
    })!;

    const measureOnScreen = measure.box.x - target.left;
    expect(measureOnScreen).toBeGreaterThanOrEqual(TRACK_INFO_WIDTH);
    expect(target.left).toBeCloseTo(Math.max(0, measure.box.x - TRACK_INFO_WIDTH - 40), 5);
  });

  it('scales the gutter allowance with zoom', () => {
    const p = plan('continuous');
    const measure = p.trackLayouts[0].measures[6];
    const zoom = 1.5;

    const target = playbackScrollTarget({
      ...BASE,
      plan: p,
      zoom,
      layoutMode: 'continuous',
      measureIndex: measure.measureIndex,
      measureX: measure.box.x,
      scrollTop: 0,
    })!;

    expect(measure.box.x * zoom - target.left).toBeGreaterThanOrEqual(TRACK_INFO_WIDTH * zoom);
  });

  it('returns null for a measure outside the plan rather than scrolling somewhere arbitrary', () => {
    expect(
      playbackScrollTarget({
        ...BASE,
        plan: plan(),
        layoutMode: 'page',
        measureIndex: 9999,
        scrollTop: 0,
      }),
    ).toBeNull();
  });
});
