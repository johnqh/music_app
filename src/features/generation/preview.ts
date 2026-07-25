/**
 * Non-destructive preview helpers (spec §13, §37.9): turn a regeneration
 * candidate's `ScoreFragment` into things the UI can render/play/summarize
 * *without* ever writing to `score-slice`. `generation-slice`'s
 * `previewFragment` is the only piece of global state a candidate
 * contributes while it's being previewed (see that slice's doc comment);
 * everything here is pure, so components can call it freely on every
 * render without worrying about touching the committed score.
 */
import type { ScoreFragment } from '@/domain/score/fragment';
import { replaceFragment } from '@/domain/score/fragment';
import { isNoteEvent } from '@/domain/score/types';
import type { Score } from '@/domain/score/types';
import { midiToPitch, pitchToMidi, pitchToString } from '@/domain/pitch/pitch';
import type { createAppStore } from '@/store/useAppStore';

/** The store shape every `features/generation/*` component operates on (same convention as `services/playback/controller.ts`'s `PlaybackStoreApi` / `features/score-editor/editing.ts`'s `EditorStoreApi`). */
export type GenerationStoreApi = ReturnType<typeof createAppStore>;

/**
 * Splices `fragment` into `score` for preview rendering/playback only
 * (spec §37.9: "Regeneration previews must be non-destructive"). The
 * result must never be passed to `setScore`/`dispatchCommand` — it exists
 * purely so the editor, piano roll, and "play in context" can show/hear a
 * candidate as if it had already replaced the region, while
 * `score-slice.score` stays untouched. Callers that only need to *render*
 * an overlay (rather than play it) don't need this at all: the editor and
 * piano roll already read `previewFragment` directly and highlight it in
 * place (see `ScoreEditorView.tsx`/`PianoRollView.tsx`).
 */
export function scoreWithCandidate(score: Score, fragment: ScoreFragment): Score {
  return replaceFragment(score, fragment);
}

export type FragmentSummary = {
  /** Count of `NoteEvent`s (rests excluded) across every track/measure/voice in the fragment. */
  noteCount: number;
  /** `"<lowest>–<highest>"` (e.g. `"C3–G5"`), or `null` when the fragment has no notes to range over. */
  pitchRangeLabel: string | null;
};

/** A candidate card's "mini summary" (brief: "note count, pitch range"). Pure aggregation over `fragment`'s notes — ignores rests. */
export function summarizeFragment(fragment: ScoreFragment): FragmentSummary {
  let noteCount = 0;
  let lowestMidi = Infinity;
  let highestMidi = -Infinity;

  for (const track of fragment.tracks) {
    for (const measure of track.measures) {
      for (const voice of measure.voices) {
        for (const event of voice.events) {
          if (!isNoteEvent(event)) continue;
          noteCount += 1;
          const midi = pitchToMidi(event.pitch);
          lowestMidi = Math.min(lowestMidi, midi);
          highestMidi = Math.max(highestMidi, midi);
        }
      }
    }
  }

  if (noteCount === 0) return { noteCount, pitchRangeLabel: null };
  // No key signature to spell against here (a candidate summary is a quick
  // at-a-glance range, not notation) — `midiToPitch` defaults to sharp
  // spelling, which is fine for this purpose.
  return {
    noteCount,
    pitchRangeLabel: `${pitchToString(midiToPitch(lowestMidi))}–${pitchToString(midiToPitch(highestMidi))}`,
  };
}

/** The first tick the "play in context" transport should start at for `fragment` — the start of the regenerated region itself. */
export function previewStartTick(fragment: ScoreFragment): number {
  return fragment.range.startTick;
}
