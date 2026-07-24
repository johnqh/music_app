/**
 * Shared low-level, pure Measure/Track mutation helpers used by the note-
 * and structure-editing command factories (Task 5 brief). Every function
 * here returns new objects; none mutate their inputs.
 */
import { createId } from '@/domain/score/ids';
import type { Measure, MusicalEvent, NoteEvent, ScoreMetadata, Track, UUID } from '@/domain/score/types';
import { isNoteEvent } from '@/domain/score/types';

/** Returns `metadata` with `updatedAt` refreshed to now. */
export function touchMetadata(metadata: ScoreMetadata): ScoreMetadata {
  return { ...metadata, updatedAt: new Date().toISOString() };
}

/**
 * Rebuilds the voice at `voiceId` within `measure` so its note content is
 * exactly what was already there (existing `RestEvent`s are discarded and
 * regenerated) but gap-filled with fresh rests and trimmed to fit the
 * measure: notes are sorted by `startTick`, clipped to the measure's span,
 * and any silent gap between/after them (up to the measure's end) is
 * filled with a new `RestEvent`. A note that would end up with zero
 * remaining duration after clipping is dropped. Returns `measure`
 * unchanged (referentially) if it has no voice with `voiceId`.
 *
 * `trackId` is taken as an explicit parameter (rather than read off an
 * existing event) so this still works when the voice's note content is
 * completely empty (e.g. after deleting every note in it).
 */
export function reflowVoice(measure: Measure, voiceId: UUID, trackId: UUID): Measure {
  const voiceIndex = measure.voices.findIndex((v) => v.id === voiceId);
  if (voiceIndex === -1) return measure;
  const voice = measure.voices[voiceIndex];

  const measureStart = measure.startTick;
  const measureEnd = measure.startTick + measure.durationTicks;
  const notes = voice.events
    .filter(isNoteEvent)
    .slice()
    .sort((a, b) => a.startTick - b.startTick);

  const events: MusicalEvent[] = [];
  let cursor = measureStart;

  for (const note of notes) {
    const start = Math.max(note.startTick, cursor, measureStart);
    const end = Math.min(note.startTick + note.durationTicks, measureEnd);
    if (end <= start) continue;

    if (start > cursor) {
      events.push({ id: createId(), startTick: cursor, durationTicks: start - cursor, voiceId, trackId });
    }
    events.push({ ...note, startTick: start, durationTicks: end - start, voiceId, trackId });
    cursor = end;
  }

  if (cursor < measureEnd) {
    events.push({ id: createId(), startTick: cursor, durationTicks: measureEnd - cursor, voiceId, trackId });
  }

  const voices = measure.voices.map((v, i) => (i === voiceIndex ? { ...v, events } : v));
  return { ...measure, voices };
}

/**
 * Returns `measure` with a voice guaranteed to exist at ordinal position
 * `voiceIndex` in `measure.voices` (per the Task 3 voice-identity
 * convention: voices correlate across measures by ordinal index, not id).
 * Missing intermediate voices (and `voiceIndex` itself, if absent) are
 * created as fresh, fully-rested voices. Returns `measure` unchanged
 * (referentially) if a voice already exists at that index.
 */
export function ensureVoiceAtIndex(measure: Measure, voiceIndex: number, trackId: UUID): Measure {
  if (measure.voices[voiceIndex]) return measure;

  const voices = measure.voices.slice();
  while (voices.length <= voiceIndex) {
    const voiceId = createId();
    voices.push({
      id: voiceId,
      name: `Voice ${voices.length + 1}`,
      events: [
        {
          id: createId(),
          startTick: measure.startTick,
          durationTicks: measure.durationTicks,
          voiceId,
          trackId,
        },
      ],
    });
  }
  return { ...measure, voices };
}

/**
 * Removes every note event whose id is in `eventIds` from `track`,
 * reflowing (rest-backfilling) each voice that actually lost a note.
 * Measures/voices with nothing removed are returned unchanged
 * (referentially), so unaffected structure is preserved.
 */
export function removeNotesFromTrack(track: Track, eventIds: ReadonlySet<UUID>): Track {
  const measures = track.measures.map((measure) => {
    let nextMeasure = measure;
    let changed = false;

    for (const voice of measure.voices) {
      if (!voice.events.some((e) => eventIds.has(e.id))) continue;
      changed = true;
      const remainingNotes = voice.events.filter(isNoteEvent).filter((e) => !eventIds.has(e.id));
      const withRemoved = {
        ...nextMeasure,
        voices: nextMeasure.voices.map((v) => (v.id === voice.id ? { ...v, events: remainingNotes } : v)),
      };
      nextMeasure = reflowVoice(withRemoved, voice.id, track.id);
    }

    return changed ? nextMeasure : measure;
  });

  return { ...track, measures };
}

/**
 * Inserts `note` into `track` at the measure whose span contains
 * `note.startTick`, in the voice at ordinal position `voiceIndex`
 * (created if necessary via `ensureVoiceAtIndex`), then reflows that
 * voice. `note` is expected to already fit entirely within one measure's
 * span (the caller — e.g. a note-move that crosses a measure boundary —
 * is responsible for splitting it first, per Task 3's
 * `splitNoteAcrossMeasures`). If no measure contains `note.startTick`,
 * `track` is returned unchanged.
 */
export function insertNoteIntoTrack(track: Track, note: NoteEvent, voiceIndex: number): Track {
  const measures = track.measures.map((measure) => {
    if (note.startTick < measure.startTick || note.startTick >= measure.startTick + measure.durationTicks) {
      return measure;
    }

    const ensured = ensureVoiceAtIndex(measure, voiceIndex, track.id);
    const voice = ensured.voices[voiceIndex];
    const existingNotes = voice.events.filter(isNoteEvent);
    const withInserted = {
      ...ensured,
      voices: ensured.voices.map((v, i) =>
        i === voiceIndex
          ? { ...v, events: [...existingNotes, { ...note, voiceId: v.id, trackId: track.id }] }
          : v,
      ),
    };
    return reflowVoice(withInserted, voice.id, track.id);
  });

  return { ...track, measures };
}
