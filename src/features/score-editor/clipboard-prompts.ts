/**
 * When cut and paste need to ask, and what they are asking about.
 *
 * Pure over the score — no store, no DOM — because the interesting part is the
 * rule for *not* asking. Both prompts follow the export dialog's precedent:
 * ask only when the answers would differ. A dialog whose options do the same
 * thing is a click the user cannot get wrong, so it should not appear.
 */
import type { NoteEvent, Score } from '@sudobility/music_types';

/** Notes on `trackId` that start at or after `tick`. */
function notesAfter(score: Score, trackId: string, tick: number): NoteEvent[] {
  const track = score.tracks.find((t) => t.id === trackId);
  if (!track) return [];
  const found: NoteEvent[] = [];
  for (const measure of track.measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if ('pitch' in event && event.startTick >= tick) found.push(event as NoteEvent);
      }
    }
  }
  return found;
}

/**
 * Whether cutting `notes` should ask "leave silence, or close the gap?".
 *
 * Only when something actually follows the cut on that track: with nothing
 * after it, sliding the rest of the track up moves nothing, so the two answers
 * produce identical scores.
 *
 * A cut spanning several tracks never asks. Closing a gap in one track while
 * the others stay put is exactly the desynchronisation `insert` mode exists
 * for, and doing it to several at once by accident would be worse than not
 * offering it.
 */
export function cutNeedsPrompt(score: Score, notes: readonly NoteEvent[]): boolean {
  if (notes.length === 0) return false;

  const trackId = notes[0].trackId;
  if (!notes.every((note) => note.trackId === trackId)) return false;

  const cutIds = new Set(notes.map((note) => note.id));
  const cutEnd = Math.max(...notes.map((note) => note.startTick + note.durationTicks));

  return notesAfter(score, trackId, cutEnd).some((note) => !cutIds.has(note.id));
}

/**
 * Whether pasting `span` ticks at `anchorTick` on `trackId` should ask
 * "replace, or insert?".
 *
 * Only when the target span already holds something: pasting into empty time
 * replaces nothing and displaces nothing, so both answers land the same notes
 * in the same place.
 */
export function pasteNeedsPrompt(
  score: Score,
  trackId: string,
  anchorTick: number,
  span: number,
): boolean {
  const track = score.tracks.find((t) => t.id === trackId);
  if (!track) return false;

  for (const measure of track.measures) {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (!('pitch' in event)) continue;
        const note = event as NoteEvent;
        const overlaps =
          note.startTick < anchorTick + span && note.startTick + note.durationTicks > anchorTick;
        if (overlaps) return true;
      }
    }
  }
  return false;
}

/** The tick span the clipboard occupies, measured from its own earliest start. */
export function clipboardSpan(events: readonly NoteEvent[]): number {
  if (events.length === 0) return 0;
  const start = Math.min(...events.map((e) => e.startTick));
  const end = Math.max(...events.map((e) => e.startTick + e.durationTicks));
  return end - start;
}
