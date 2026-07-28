/**
 * Builds the `eventId -> NoteColorRole` map the canvas renderer colors notes
 * from (spec: note state is the notehead's own color; there is no highlight
 * overlay). Pure and store-free so the precedence is unit-testable without
 * rendering anything.
 *
 * A map holds one role per id, so precedence is applied by write order:
 * selected/regenerated first, then playing overwrites. That is a different
 * problem from the renderer's own `resolveNoteColorRole`, which resolves one
 * VexFlow note standing for *several* event ids (a chord, or one segment of
 * a duration-decomposed long note).
 */
import type { NoteColorRole } from '@sudobility/music_lib';

export type BuildNoteColorsParams = {
  selectedIds: readonly string[];
  playingIds: readonly string[];
  /** When true, selected notes color as `regenerated` rather than `selected`. */
  regenerated: boolean;
};

export function buildNoteColors({
  selectedIds,
  playingIds,
  regenerated,
}: BuildNoteColorsParams): Map<string, NoteColorRole> {
  const colors = new Map<string, NoteColorRole>();
  const selectedRole: NoteColorRole = regenerated ? 'regenerated' : 'selected';
  for (const id of selectedIds) colors.set(id, selectedRole);
  for (const id of playingIds) colors.set(id, 'playing');
  return colors;
}
