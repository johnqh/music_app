/**
 * VexFlow render colors, one set per resolved light/dark color scheme.
 *
 * Literal color strings, not CSS custom properties: VexFlow draws straight to
 * the canvas context, which never resolves `var(--...)` (and jsdom doesn't
 * process CSS for tests anyway).
 *
 * Note *state* is carried by these colors — the highlight overlay and its
 * second canvas are gone, so `noteNormal`/`noteSelected`/`noteRegenerated`/
 * `notePlaying` are what a reader actually reads state from. Each value
 * clears 4.5:1 against its mode's stave background. (Color is not the *only*
 * cue: `noteEmphasisFor` thickens and haloes non-normal notes, and the piano
 * roll thickens their borders — spec §27.)
 *
 * Its own module rather than a `ScoreEditorView` export: both editors draw
 * from this one palette, so a note means the same thing in either, and a
 * component file exporting shared constants breaks Fast Refresh.
 */
import type { RenderTheme } from '@sudobility/music_lib';

export const LIGHT_RENDER_THEME: RenderTheme = {
  foreground: '#3f3f46',
  noteNormal: '#3f3f46',
  noteSelected: '#000000',
  noteRegenerated: '#8b5a2b',
  notePlaying: '#1565c0',
  staveActive: '#000000',
  staveInactive: '#71717a',
  caret: '#d32f2f',
};

export const DARK_RENDER_THEME: RenderTheme = {
  foreground: '#d4d4d8',
  noteNormal: '#d4d4d8',
  noteSelected: '#ffffff',
  noteRegenerated: '#d9a066',
  notePlaying: '#64b5f6',
  staveActive: '#ffffff',
  staveInactive: '#8a8a93',
  caret: '#ef5350',
};
