import { describe, expect, it } from 'vitest';
import {
  TRACK_INFO_WIDTH,
  computeLayout,
  stressScore,
  testRenderTheme,
} from '@sudobility/music_lib';
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

// A viewport shorter than one system of this 4-track score: the existing
// cases are all about a reader who cannot see a whole system at once, which
// is what makes carrying their offset across a wrap the right behaviour.
// `scrollLeft: 0` with a narrow viewport likewise puts the measures these
// tests pick well off the right-hand edge, so horizontal following applies.
const BASE = {
  zoom: 1,
  measureX: 0,
  measureWidth: 100,
  scrollLeft: 0,
  viewportWidth: 900,
  scrollTop: 0,
  margin: 40,
  viewportHeight: 200,
};

describe('playbackScrollTarget: page mode', () => {
  it('keeps the same track at the top of the viewport across a wrap', () => {
    // The bug this exists for: following playback scrolled to track 1's stave,
    // so whatever track the reader was watching was thrown off the top of the
    // viewport every time the music wrapped to the next system.
    const p = plan();
    const [first, second] = p.systems;
    expect(second).toBeDefined();

    // Reader has scrolled so track 3 sits at the top of the viewport.
    const track3 = p.trackLayouts[2].measures.find(
      (m) => m.measureIndex === first.measureIndices[0],
    )!;
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

    // `null`, not the current position: any scrollTo would cancel a smooth
    // scroll still in flight from the previous measure.
    expect(
      playbackScrollTarget({
        ...BASE,
        plan: p,
        layoutMode: 'page',
        measureIndex: system.measureIndices[1],
        scrollTop: 137,
      }),
    ).toBeNull();
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

describe('playbackScrollTarget: page mode only scrolls when it has to', () => {
  /** A single-track score, whose systems are short enough that several fit on screen. */
  function shortSystems(): LayoutPlan {
    return computeLayout(stressScore(1, 24), {
      zoom: 1,
      layoutMode: 'page',
      width: 900,
      theme: testRenderTheme(),
    });
  }

  it('does not move when the system being played is already fully on screen', () => {
    // The bug: crossing into the next system scrolled it to the top of the
    // viewport even when the reader could already see it, so a tall window
    // jumped a line ahead of the caret every wrap.
    const p = shortSystems();
    const [first, second] = p.systems;
    expect(second).toBeDefined();
    const viewportHeight = Math.ceil(second.yBottom) + 50; // both systems visible at once

    expect(
      playbackScrollTarget({
        ...BASE,
        viewportHeight,
        plan: p,
        layoutMode: 'page',
        measureIndex: second.measureIndices[0],
        scrollTop: 0,
      }),
    ).toBeNull();
    expect(first.yTop).toBe(p.systems[0].yTop); // sanity: reader is at the top
  });

  it('does scroll once the system being played has fallen off the bottom', () => {
    const p = shortSystems();
    const last = p.systems[p.systems.length - 1];
    expect(p.systems.length).toBeGreaterThan(2);

    const target = playbackScrollTarget({
      ...BASE,
      viewportHeight: 300,
      plan: p,
      layoutMode: 'page',
      measureIndex: last.measureIndices[0],
      scrollTop: 0,
    })!;

    expect(target.top).toBeGreaterThan(0);
  });

  it('still carries the offset when a system is taller than the viewport', () => {
    // Multi-track scores can never be "fully visible", and for them preserving
    // which track sits at the top is the whole point.
    const p = plan();
    const [first, second] = p.systems;
    const track3 = p.trackLayouts[2].measures.find(
      (m) => m.measureIndex === first.measureIndices[0],
    )!;

    const target = playbackScrollTarget({
      ...BASE,
      viewportHeight: 200,
      plan: p,
      layoutMode: 'page',
      measureIndex: second.measureIndices[0],
      scrollTop: track3.box.y,
    })!;

    const nextTrack3 = p.trackLayouts[2].measures.find(
      (m) => m.measureIndex === second.measureIndices[0],
    )!;
    expect(target.top).toBeCloseTo(nextTrack3.box.y, 5);
  });
});

describe('playbackScrollTarget: continuous mode follows the caret, not every measure', () => {
  it('does not move while the playing measure is comfortably on screen', () => {
    // Re-targeting every measure fought the reader for the scrollbar and
    // restarted the smooth-scroll animation before it had travelled anywhere.
    const p = plan('continuous');
    const measure = p.trackLayouts[0].measures[6];

    expect(
      playbackScrollTarget({
        ...BASE,
        plan: p,
        layoutMode: 'continuous',
        measureIndex: measure.measureIndex,
        measureX: measure.box.x,
        measureWidth: measure.box.width,
        // Scrolled so this measure sits in the middle of a wide viewport.
        scrollLeft: Math.max(0, measure.box.x - 600),
        viewportWidth: 1400,
        scrollTop: 0,
      }),
    ).toBeNull();
  });

  it('scrolls once the playing measure reaches the right-hand edge', () => {
    const p = plan('continuous');
    const measure = p.trackLayouts[0].measures[6];

    const target = playbackScrollTarget({
      ...BASE,
      plan: p,
      layoutMode: 'continuous',
      measureIndex: measure.measureIndex,
      measureX: measure.box.x,
      measureWidth: measure.box.width,
      // Viewport ends just as this measure starts: it is about to leave view.
      scrollLeft: Math.max(0, measure.box.x - 880),
      viewportWidth: 900,
      scrollTop: 0,
    })!;

    expect(target.left).toBeCloseTo(Math.max(0, measure.box.x - TRACK_INFO_WIDTH - 40), 5);
  });

  it('scrolls a measure that is hidden behind the pinned gutter, not just one off the right edge', () => {
    // The gutter is painted over the sheet, so "on screen" starts after it.
    const p = plan('continuous');
    const measure = p.trackLayouts[0].measures[6];

    const target = playbackScrollTarget({
      ...BASE,
      plan: p,
      layoutMode: 'continuous',
      measureIndex: measure.measureIndex,
      measureX: measure.box.x,
      measureWidth: measure.box.width,
      // Measure sits just inside the viewport's left edge — behind the gutter.
      scrollLeft: measure.box.x - 10,
      viewportWidth: 1400,
      scrollTop: 0,
    })!;

    expect(measure.box.x - target.left).toBeGreaterThanOrEqual(TRACK_INFO_WIDTH);
  });
});

describe('playbackScrollTarget: following never scrolls the music off the screen', () => {
  /**
   * The invariant that matters: wherever it scrolls to, the system being
   * played has to be somewhere in the viewport afterwards.
   */
  function assertPlayingSystemVisible(p: LayoutPlan, viewportHeight: number, startScrollTop = 0) {
    let scrollTop = startScrollTop;
    // The guarantee is about where *following* leaves the reader. A reader who
    // has scrolled the music off screen themselves is left alone deliberately,
    // so nothing is asserted until following has actually moved the box.
    let hasScrolled = false;
    const measureCount = p.systems.at(-1)!.measureIndices.at(-1)! + 1;
    for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
      const target = playbackScrollTarget({
        ...BASE,
        plan: p,
        layoutMode: 'page',
        measureIndex,
        viewportHeight,
        scrollTop,
      });
      if (target) {
        scrollTop = target.top;
        hasScrolled = true;
      }
      if (!hasScrolled) continue;

      const system = p.systems.find((s) => s.measureIndices.includes(measureIndex))!;
      const visibleTop = scrollTop;
      const visibleBottom = scrollTop + viewportHeight;
      const overlaps = system.yTop < visibleBottom && system.yBottom > visibleTop;
      expect(
        overlaps,
        `measure ${measureIndex}: line spans ${system.yTop}-${system.yBottom}, ` +
          `viewport shows ${visibleTop}-${visibleBottom}`,
      ).toBe(true);
    }
  }

  it('keeps the playing line on screen when the reader has scrolled off a system boundary', () => {
    // The bug, and why it needs a reader who has scrolled by hand: a scroll
    // position sitting in the gap *between* two systems makes
    // `systemAtViewportTop` answer with the system above, so the carried offset
    // came out nearly a whole system tall and the wrap overshot by a line —
    // leaving the music playing above the top of the viewport. A run that
    // starts at 0 never sees it, because every scroll it makes lands exactly on
    // a system top and stays aligned.
    const p = plan();
    const gap = Math.round((p.systems[0].yBottom + p.systems[1].yTop) / 2);
    assertPlayingSystemVisible(p, 500, gap);
  });

  it('keeps the playing line on screen from an aligned start too', () => {
    assertPlayingSystemVisible(plan(), 500);
  });

  it('keeps it on screen for a viewport shorter than one system', () => {
    assertPlayingSystemVisible(plan(), 300);
  });

  it('keeps it on screen for a viewport taller than several systems', () => {
    assertPlayingSystemVisible(
      computeLayout(stressScore(1, 24), {
        zoom: 1,
        layoutMode: 'page',
        width: 900,
        theme: testRenderTheme(),
      }),
      900,
    );
  });
});
