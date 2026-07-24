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

/** Whether `prev` ties directly into `next` (contiguous, same pitch, tie flags set on both ends). */
function tiesInto(prev: NoteEvent, next: NoteEvent): boolean {
  return (
    Boolean(prev.tieStart) &&
    Boolean(next.tieStop) &&
    prev.startTick + prev.durationTicks === next.startTick &&
    samePitch(prev.pitch, next.pitch)
  );
}

/**
 * Returns the full chain of tied note events (in tick order) that `noteId`
 * belongs to, searching within its voice across all of its track's
 * measures. A chain may span measure boundaries. Returns `[]` if `noteId`
 * does not exist or is not a note event; returns a single-element array
 * for a note with no ties.
 */
export function tieChainFor(score: Score, noteId: UUID): NoteEvent[] {
  const target = findEvent(score, noteId);
  if (!target || !isNoteEvent(target)) return [];

  const track = findTrack(score, target.trackId);
  if (!track) return [target];

  const voiceNotes: NoteEvent[] = [];
  for (const measure of track.measures) {
    for (const voice of measure.voices) {
      if (voice.id !== target.voiceId) continue;
      for (const event of voice.events) {
        if (isNoteEvent(event)) voiceNotes.push(event);
      }
    }
  }
  voiceNotes.sort((a, b) => a.startTick - b.startTick);

  const index = voiceNotes.findIndex((n) => n.id === target.id);
  if (index === -1) return [target];

  let start = index;
  while (start > 0 && tiesInto(voiceNotes[start - 1], voiceNotes[start])) {
    start -= 1;
  }

  let end = index;
  while (end < voiceNotes.length - 1 && tiesInto(voiceNotes[end], voiceNotes[end + 1])) {
    end += 1;
  }

  return voiceNotes.slice(start, end + 1);
}
