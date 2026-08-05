import { describe, expect, it } from 'vitest';
import { computeLayout, twinkleScore } from '@sudobility/music_lib';
import { LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';
import {
  PRINT_SCALE,
  PRINT_WIDTH,
  printRenderOptions,
  printSystems,
} from '@/features/print/print-layout';

const plan = () =>
  computeLayout(twinkleScore(), {
    zoom: 1,
    layoutMode: 'page',
    width: PRINT_WIDTH,
    theme: LIGHT_RENDER_THEME,
    showTrackInfo: false,
  });

describe('printRenderOptions', () => {
  it('wraps to the page, never one long line', () => {
    // Continuous mode is one system as wide as the piece; on paper that is a
    // single unreadable strip.
    expect(printRenderOptions([]).layoutMode).toBe('page');
  });

  it('carries no editing state', () => {
    // A printed page shows the music, not what happened to be selected.
    const options = printRenderOptions([]);
    expect(options.noteColors).toBeUndefined();
    expect(options.activeTrackId ?? null).toBeNull();
    expect(options.selectedMeasureIds).toBeUndefined();
  });

  it('always uses the light theme, whatever the app is set to', () => {
    expect(printRenderOptions([]).theme).toBe(LIGHT_RENDER_THEME);
  });

  it('suppresses the track gutter', () => {
    expect(printRenderOptions([]).showTrackInfo).toBe(false);
  });

  it('passes a track filter through, and omits it when empty', () => {
    expect(printRenderOptions(['t1']).trackIds).toEqual(['t1']);
    expect(printRenderOptions([]).trackIds).toBeUndefined();
  });

  it('renders above screen resolution', () => {
    expect(printRenderOptions([]).devicePixelRatio).toBe(PRINT_SCALE);
    expect(PRINT_SCALE).toBeGreaterThanOrEqual(3);
  });
});

describe('printSystems', () => {
  it('returns one entry per system in the plan', () => {
    const p = plan();
    expect(printSystems(p)).toHaveLength(p.systems.length);
  });

  it('spans each system from its measure-number band to its bottom', () => {
    // gutterTop, not yTop: the measure numbers sit above the stave and would
    // be sliced off otherwise.
    const p = plan();
    const pages = printSystems(p);
    expect(pages[0].top).toBe(p.systems[0].gutterTop);
    expect(pages[0].bottom).toBe(p.systems[0].yBottom);
  });

  it('reports a positive height for every system', () => {
    for (const page of printSystems(plan())) {
      expect(page.height).toBeGreaterThan(0);
    }
  });

  it('keeps the systems in score order', () => {
    const tops = printSystems(plan()).map((p) => p.top);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  });

  it('covers every system without overlapping', () => {
    // Overlap would print the same music twice; a gap would drop some.
    const pages = printSystems(plan());
    for (let i = 1; i < pages.length; i++) {
      expect(pages[i].top).toBeGreaterThanOrEqual(pages[i - 1].bottom);
    }
  });
});
