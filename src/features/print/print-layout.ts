/**
 * The render options and per-system slices a print run needs.
 *
 * Pure over a layout plan — no DOM, no store — so the decisions about what
 * print *is* (page mode, light theme, no editing state, no gutter) are
 * testable without rendering anything, in the same shape as `tap-to-note.ts`
 * and `pitch-drag.ts`.
 */
import type { CanvasRenderOptions, LayoutPlan } from '@sudobility/music_lib';
import { LIGHT_RENDER_THEME } from '@/features/score-editor/render-theme';

/**
 * Logical width the score is laid out at.
 *
 * Not a paper width: each system canvas is displayed at `width: 100%`, so the
 * browser scales this onto whatever page the printer has. What this number
 * actually decides is how many measures fit on a line — wide enough to be
 * musical, narrow enough that the scaled-down result stays legible.
 */
export const PRINT_WIDTH = 1000;

/** Backing-store scale. Roughly 300dpi once scaled onto the page. */
export const PRINT_SCALE = 3;

export type PrintPage = {
  systemIndex: number;
  top: number;
  bottom: number;
  height: number;
};

/**
 * Render options for print: page mode, light theme, no gutter, no editing
 * state.
 *
 * Editing state is *omitted* rather than blanked — an absent `noteColors` is
 * how the renderer is told "everything is normal", and an empty map would say
 * the same thing less clearly.
 */
export function printRenderOptions(trackIds: string[]): Omit<CanvasRenderOptions, 'viewport'> {
  return {
    zoom: 1,
    // Never continuous: that is one system as wide as the piece, which on
    // paper is a single unreadable strip.
    layoutMode: 'page',
    width: PRINT_WIDTH,
    theme: LIGHT_RENDER_THEME,
    showTrackInfo: false,
    ...(trackIds.length > 0 ? { trackIds } : {}),
    devicePixelRatio: PRINT_SCALE,
  };
}

/**
 * One slice per system, each spanning its measure-number band to its bottom.
 *
 * `gutterTop`, not `yTop`: measure numbers are drawn above the stave, and
 * slicing at `yTop` would cut them off.
 */
export function printSystems(plan: LayoutPlan): PrintPage[] {
  return plan.systems.map((system, systemIndex) => ({
    systemIndex,
    top: system.gutterTop,
    bottom: system.yBottom,
    height: system.yBottom - system.gutterTop,
  }));
}
