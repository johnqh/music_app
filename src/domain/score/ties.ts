import { createId } from '@/domain/score/ids';
import { findEvent, findTrack } from '@/domain/score/queries';
import type { MusicalEvent, NoteEvent, Pitch, Score, UUID } from '@/domain/score/types';
import { isNoteEvent } from '@/domain/score/types';
import { splitAtBoundaries } from '@/domain/time/durations';

/** Whether two pitches have identical spelling (step, accidental, and octave). */
function samePitch(a: Pitch, b: Pitch): boolean {
  return a.step === b.step && a.accidental === b.accidental && a.octave === b.octave;
}

/**
 * Splits a note at every measure boundary that falls strictly inside its
 * span, returning contiguous tied segments that together cover the
 * original note. The first segment keeps the original id and any incoming
 * tie (`tieStop`); the last keeps any outgoing tie (`tieStart`); segments
 * in between are tied on both sides. Returns `[note]` unchanged if no
 * boundary falls inside its span.
 *
 * Every returned segment inherits `note`'s `voiceId`/`trackId` verbatim.
 * This function has no `Score`/`Measure` context, so it cannot know which
 * voice a later segment will actually land in once inserted into the
 * score — the caller (which does have that context) is responsible for
 * reassigning each segment's `voiceId` to its destination measure's voice
 * before/while inserting it (the same normalization `fragment.ts`'s
 * `replaceFragment` performs).
 */
export function splitNoteAcrossMeasures(note: NoteEvent, measureBoundaries: number[]): NoteEvent[] {
  const segments = splitAtBoundaries(note.startTick, note.durationTicks, measureBoundaries);
  if (segments.length <= 1) {
    return [note];
  }

  return segments.map((segment, i) => {
    const isFirst = i === 0;
    const isLast = i === segments.length - 1;
    return {
      ...note,
      id: isFirst ? note.id : createId(),
      startTick: segment.startTick,
      durationTicks: segment.durationTicks,
      tieStart: isLast ? note.tieStart : true,
      tieStop: isFirst ? note.tieStop : true,
    };
  });
}

/**
 * Merges runs of contiguous, same-pitch, tie-linked note events (a note
 * with `tieStart` immediately followed in the array by a same-pitch note
 * with `tieStop`) into single notes spanning the combined duration. Rests
 * and non-tied notes pass through unchanged. Assumes `events` are already
 * in ascending `startTick` order (e.g. one voice's events).
 */
export function joinTiedNotes(events: MusicalEvent[]): MusicalEvent[] {
  const result: MusicalEvent[] = [];
  let i = 0;

  while (i < events.length) {
    const event = events[i];
    if (!isNoteEvent(event) || !event.tieStart) {
      result.push(event);
      i += 1;
      continue;
    }

    let merged: NoteEvent = event;
    let j = i + 1;
    while (j < events.length) {
      const next = events[j];
      if (
        !isNoteEvent(next) ||
        !next.tieStop ||
        next.startTick !== merged.startTick + merged.durationTicks ||
        !samePitch(next.pitch, merged.pitch)
      ) {
        break;
      }
      merged = { ...merged, durationTicks: merged.durationTicks + next.durationTicks, tieStart: next.tieStart };
      j += 1;
    }

    result.push(merged);
    i = j;
  }

  return result;
}

/** A note event annotated with the index of the measure (within its track) it came from. */
type ChainCandidate = { event: NoteEvent; measureIndex: number };

/**
 * Whether `prev` ties directly into `next` (contiguous, same pitch, tie
 * flags set on both ends). Voice-id equality is required only when both
 * candidates fall in the *same* measure (where each measure's voice ids
 * are freshly generated and thus meaningful/unique — see module note
 * below); across a measure boundary voice ids are not compared, since
 * nothing in this codebase keeps a voice's id stable from one measure to
 * the next (voice re-allocation per measure is expected, spec §25), so
 * gating on it there would silently truncate real cross-barline chains.
 */
function tiesInto(prev: ChainCandidate, next: ChainCandidate): boolean {
  const voiceCompatible =
    prev.measureIndex !== next.measureIndex || prev.event.voiceId === next.event.voiceId;
  return (
    voiceCompatible &&
    Boolean(prev.event.tieStart) &&
    Boolean(next.event.tieStop) &&
    prev.event.startTick + prev.event.durationTicks === next.event.startTick &&
    samePitch(prev.event.pitch, next.event.pitch)
  );
}

/**
 * Returns the full chain of tied note events (in tick order) that `noteId`
 * belongs to, searching across all of its track's measures. A chain may
 * span measure boundaries. Returns `[]` if `noteId` does not exist or is
 * not a note event; returns a single-element array for a note with no
 * ties.
 *
 * Cross-measure matching does *not* require a shared `voiceId`: measures
 * are built independently (each with its own freshly generated voice
 * ids — see `factory.ts`/`fixtures.ts`), so a voice id is only meaningful
 * as an identifier *within* a single measure, never as a stable "voice
 * slot" across measures. Chain membership across a measure boundary is
 * instead determined purely by track + tick-contiguity + same pitch +
 * tie flags, which is also more faithful to spec §25 (voice allocation
 * may reassign voice numbers per measure).
 */
export function tieChainFor(score: Score, noteId: UUID): NoteEvent[] {
  const target = findEvent(score, noteId);
  if (!target || !isNoteEvent(target)) return [];

  const track = findTrack(score, target.trackId);
  if (!track) return [target];

  const candidates: ChainCandidate[] = [];
  track.measures.forEach((measure, measureIndex) => {
    for (const voice of measure.voices) {
      for (const event of voice.events) {
        if (isNoteEvent(event)) candidates.push({ event, measureIndex });
      }
    }
  });
  candidates.sort((a, b) => a.event.startTick - b.event.startTick);

  const index = candidates.findIndex((c) => c.event.id === target.id);
  if (index === -1) return [target];

  let start = index;
  while (start > 0 && tiesInto(candidates[start - 1], candidates[start])) {
    start -= 1;
  }

  let end = index;
  while (end < candidates.length - 1 && tiesInto(candidates[end], candidates[end + 1])) {
    end += 1;
  }

  return candidates.slice(start, end + 1).map((c) => c.event);
}
