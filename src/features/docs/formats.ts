/**
 * The format list is `@sudobility/music_editing`'s.
 *
 * Both apps document these formats, and what this product can open is a fact
 * about the product rather than about a web page — so the list lives beside
 * `docs-content.ts`, and a second copy cannot go stale against the first.
 *
 * Re-exported rather than imported at each call site so the move is invisible
 * to this app's own pages and its `formats` test.
 */
export { EXPORT_FORMATS, IMPORT_FORMATS } from '@sudobility/music_editing';
export type { FormatEntry } from '@sudobility/music_editing';
