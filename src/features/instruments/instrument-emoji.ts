/**
 * Re-export of the catalogue's glyph table.
 *
 * The table itself lives in `music_lib` beside the GM catalogue, because the
 * canvas renderer draws it into the track gutter too — one source beats passing
 * a per-track glyph map into the renderer as an option. This module stays so
 * app code has a local name for it, and so the emoji-vs-SVG decision has one
 * documented home (see `gm-icon.ts`).
 */
export { gmInstrumentEmoji as instrumentEmoji } from '@sudobility/music_lib';
