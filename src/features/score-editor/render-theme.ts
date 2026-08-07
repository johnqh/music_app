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
 * `noteInactive` is the one value that does NOT clear 4.5:1 — it sits at ~3:1,
 * deliberately. It marks the tracks you are *not* editing, and its whole job is
 * to recede; at 4.5:1 against the same background it was indistinguishable from
 * `noteNormal` and the active track stopped standing out at all. The music it
 * draws stays legible (large glyphs, not body text), and no state is carried by
 * it alone: a note you need to act on is selected, regenerated or playing, and
 * those keep their full-contrast colours on every track.
 *
 * Its own module rather than a `ScoreEditorView` export: both editors draw
 * from this one palette, so a note means the same thing in either, and a
 * component file exporting shared constants breaks Fast Refresh.
 */
import type { RenderTheme } from '@sudobility/music_lib';

export const LIGHT_RENDER_THEME: RenderTheme = {
  foreground: '#3f3f46',
  noteNormal: '#3f3f46',
  noteInactive: '#8e8e97',
  noteSelected: '#6d28d9',
  noteRegenerated: '#8b5a2b',
  notePlaying: '#1565c0',
  staveActive: '#000000',
  staveInactive: '#71717a',
  caret: '#d32f2f',
};

export const DARK_RENDER_THEME: RenderTheme = {
  foreground: '#d4d4d8',
  noteNormal: '#d4d4d8',
  noteInactive: '#82828c',
  noteSelected: '#a78bfa',
  noteRegenerated: '#d9a066',
  notePlaying: '#64b5f6',
  staveActive: '#ffffff',
  staveInactive: '#8a8a93',
  caret: '#ef5350',
};
