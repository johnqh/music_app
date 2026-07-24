/**
 * Derived-data selectors over `AppState` (spec §9, §10, §37.13): plain
 * `(state: AppState) => T` functions meant to be passed straight to
 * `useAppStore(selector)`, so a component only re-renders when the
 * specific derived value it reads actually changes (shallow-equal at the
 * leaf, not the whole store). Pure and read-only — no selector here
 * mutates the store or reaches outside `AppState`.
 */
import { findEvent } from '@/domain/score/queries';
import { selectionToRange } from '@/domain/selection/selection';
import type { ScoreRange } from '@/domain/selection/types';
import type { NoteEvent } from '@/domain/score/types';
import { isNoteEvent } from '@/domain/score/types';
import { beatDurationTicks } from '@/domain/time/ticks';
import type { AppState } from '@/store/useAppStore';

/** Every `NoteEvent` named by `state.selection.eventIds` that still resolves in `state.score` (rests and stale ids are skipped). */
export function selectSelectedNotes(state: AppState): NoteEvent[] {
  const { score, selection } = state;
  if (!score) return [];
  return selection.eventIds
    .map((id) => findEvent(score, id))
    .filter((event): event is NoteEvent => event !== null && isNoteEvent(event));
}

/** How many note events are currently selected (spec §9). */
export function selectSelectedNoteCount(state: AppState): number {
  return selectSelectedNotes(state).length;
}

/** The current selection's tick/track span (spec §9's `ScoreRange`), aligned to full measures — `null` if the selection has no resolvable tick extent or there's no score loaded. */
export function selectSelectedMeasureRange(state: AppState): ScoreRange | null {
  const { score, selection } = state;
  if (!score) return null;
  return selectionToRange(score, selection);
}

export type MeasureBeat = { measureIndex: number; beat: number };

/**
 * The 1-based measure index and 1-based beat that `state.positionTick`
 * falls in (spec §10/§22, playback cursor), read off the score's first
 * track (every track shares the same measure grid once
 * `rebuildMeasureTicks` has run — see `domain/score/factory.ts`).
 * `null` if there's no score, or the score has no measures.
 */
export function selectCurrentMeasureBeat(state: AppState): MeasureBeat | null {
  const { score, positionTick } = state;
  if (!score) return null;
  const track = score.tracks[0];
  if (!track || track.measures.length === 0) return null;

  const measure =
    track.measures.find(
      (m) => positionTick >= m.startTick && positionTick < m.startTick + m.durationTicks,
    ) ?? track.measures[track.measures.length - 1];

  const beatTicks = beatDurationTicks(measure.timeSignature, score.ppq);
  const beat = Math.floor((positionTick - measure.startTick) / beatTicks) + 1;
  return { measureIndex: measure.index + 1, beat };
}
