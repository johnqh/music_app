import { rebuildMeasureTicks } from '@/domain/score/factory';
import { measuresInRange } from '@/domain/score/queries';
import type { Measure, Score, UUID } from '@/domain/score/types';
import type { ScoreRange } from '@/domain/selection/types';

/**
 * A snapshot of a tick range of a score: the measures overlapping that
 * range, per track. Used to hand a region to (and receive one back from)
 * AI generation, and for copy/paste. Measures are shared by reference with
 * the source score (a snapshot, not a deep clone).
 */
export type ScoreFragment = {
  range: ScoreRange;
  ppq: number;
  tracks: Array<{ trackId: UUID; measures: Measure[] }>;
};

/** Captures the measures overlapping `range` (per track named in `range.trackIds`, or all tracks if empty). */
export function extractFragment(score: Score, range: ScoreRange): ScoreFragment {
  return {
    range,
    ppq: score.ppq,
    tracks: measuresInRange(score, range),
  };
}

/** Whether a measure's span overlaps `[range.startTick, range.endTick)`. */
function overlapsRange(measure: Measure, range: ScoreRange): boolean {
  return measure.startTick < range.endTick && measure.startTick + measure.durationTicks > range.startTick;
}

/**
 * Splices `fragment`'s measures into `score`, one track at a time. For each
 * track named in `fragment.tracks`, the contiguous block of that track's
 * existing measures overlapping `fragment.range` is replaced by the
 * fragment's measures for that track (deep-replacing their voices); tracks
 * with no measures overlapping the range are left untouched. Track ids
 * named in the fragment but absent from the score are ignored.
 *
 * Every replaced event's `trackId`/`voiceId` is renumbered to match its
 * new, actual track and voice (never trusted from the incoming fragment),
 * so a regenerated fragment's placeholder ids never leak into the score.
 *
 * Measure `index`/`startTick` for every track are then recomputed via
 * `rebuildMeasureTicks`, which leaves measures outside the edited region
 * referentially unchanged.
 */
export function replaceFragment(score: Score, fragment: ScoreFragment): Score {
  const replacementsByTrackId = new Map(fragment.tracks.map((t) => [t.trackId, t.measures]));

  const tracks = score.tracks.map((track) => {
    const replacementMeasures = replacementsByTrackId.get(track.id);
    if (!replacementMeasures) return track;

    const firstIndex = track.measures.findIndex((m) => overlapsRange(m, fragment.range));
    if (firstIndex === -1) return track;

    let lastIndex = firstIndex;
    while (lastIndex < track.measures.length && overlapsRange(track.measures[lastIndex], fragment.range)) {
      lastIndex += 1;
    }

    const normalizedMeasures = replacementMeasures.map((measure) => ({
      ...measure,
      voices: measure.voices.map((voice) => ({
        ...voice,
        events: voice.events.map((event) => ({ ...event, trackId: track.id, voiceId: voice.id })),
      })),
    }));

    return {
      ...track,
      measures: [
        ...track.measures.slice(0, firstIndex),
        ...normalizedMeasures,
        ...track.measures.slice(lastIndex),
      ],
    };
  });

  return rebuildMeasureTicks({ ...score, tracks });
}
