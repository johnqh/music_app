/**
 * Copy/paste, quantize, and transpose command factories (spec §7, §14,
 * §24). Each factory wraps a pure `(Score) => Score` transform via
 * `transformCommand`.
 */
import { createId } from '@/domain/score/ids';
import { splitNoteAcrossMeasures } from '@/domain/score/ties';
import type { MusicalEvent, NoteEvent, Score, UUID } from '@/domain/score/types';
import { isNoteEvent } from '@/domain/score/types';
import { transposePitch } from '@/domain/pitch/transpose';
import { quantizeEvents } from '@/domain/quantization/quantize';
import type { QuantizeOptions } from '@/domain/quantization/options';
import type { ScoreCommand } from '@/domain/commands/types';
import { transformCommand } from '@/domain/commands/snapshot';
import { insertNoteIntoTrack, reflowVoice, withTracks } from '@/domain/commands/reflow';

// ---- pasteEventsCommand -----------------------------------------------------------

export type PasteDestination = { trackId: UUID; voiceIndex: number; anchorTick: number };

function pasteEvents(score: Score, notes: readonly NoteEvent[], destination: PasteDestination): Score {
  const track = score.tracks.find((t) => t.id === destination.trackId);
  if (!track || notes.length === 0) return score;

  const originStart = Math.min(...notes.map((n) => n.startTick));
  const boundaries = track.measures.map((m) => m.startTick);

  let working = track;
  for (const note of notes) {
    const startTick = destination.anchorTick + (note.startTick - originStart);
    const placeholder: NoteEvent = {
      ...note,
      id: createId(),
      startTick,
      trackId: destination.trackId,
      tieStart: undefined,
      tieStop: undefined,
    };
    const segments = splitNoteAcrossMeasures(placeholder, boundaries);
    for (const segment of segments) {
      working = insertNoteIntoTrack(working, segment, destination.voiceIndex);
    }
  }

  const tracks = score.tracks.map((t) => (t.id === track.id ? working : t));
  return withTracks(score, tracks);
}

/**
 * Pastes a copied list of note events (e.g. from a prior "copy" of a
 * selection) into `destination.trackId`/`voiceIndex`, anchored so the
 * earliest-starting pasted note lands at `destination.anchorTick` and
 * every other note keeps its relative offset. A pasted note that ends up
 * crossing a measure boundary is split into tied segments, matching
 * `moveNotesCommand`. Ids are regenerated so pasted notes never collide
 * with their source.
 */
export function pasteEventsCommand(notes: NoteEvent[], destination: PasteDestination): ScoreCommand {
  return transformCommand('Paste notes', (score) => pasteEvents(score, notes, destination));
}

// ---- quantizeCommand -----------------------------------------------------------

/** Clips `event` to fit within `measure`'s span, or returns `null` if that leaves no positive duration. */
function clipToMeasure(event: MusicalEvent, measureStart: number, measureEnd: number): MusicalEvent | null {
  const start = Math.max(event.startTick, measureStart);
  const end = Math.min(event.startTick + event.durationTicks, measureEnd);
  if (end <= start) return null;
  return { ...event, startTick: start, durationTicks: end - start };
}

/**
 * Quantizes the voice(s) containing any of `eventIds`, one measure at a
 * time: only that voice's *note* events (not the synthetic rests
 * `reflowVoice` fills gaps with — feeding those into `quantizeEvents`
 * alongside real notes could snap a filler rest's start independently of
 * its neighboring note and corrupt the measure) are passed through Task
 * 4's `quantizeEvents`, clipped back to the measure's span, and then
 * `reflowVoice` regenerates the voice's rests around the result. This
 * keeps quantization measure-local (no cross-measure re-splitting), a
 * deliberate Task 5 scope limitation documented in the brief.
 */
function quantize(score: Score, eventIds: readonly UUID[], options: QuantizeOptions): Score {
  const idSet = new Set(eventIds);
  const tracks = score.tracks.map((track) => {
    const measures = track.measures.map((measure) => {
      let nextMeasure = measure;
      let changed = false;
      for (const voice of measure.voices) {
        if (!voice.events.some((e) => idSet.has(e.id))) continue;
        changed = true;
        const measureEnd = measure.startTick + measure.durationTicks;
        const notes = voice.events.filter(isNoteEvent);
        const quantizedNotes = quantizeEvents(notes, options)
          .map((e) => clipToMeasure(e, measure.startTick, measureEnd))
          .filter((e): e is MusicalEvent => e !== null);
        const withQuantized = {
          ...nextMeasure,
          voices: nextMeasure.voices.map((v) => (v.id === voice.id ? { ...v, events: quantizedNotes } : v)),
        };
        nextMeasure = reflowVoice(withQuantized, voice.id, track.id);
      }
      return changed ? nextMeasure : measure;
    });
    const trackChanged = measures.some((m, i) => m !== track.measures[i]);
    return trackChanged ? { ...track, measures } : track;
  });
  return withTracks(score, tracks);
}

/** Quantizes every voice containing at least one of `eventIds`, per Task 4's reusable quantization engine. */
export function quantizeCommand(eventIds: UUID[], options: QuantizeOptions): ScoreCommand {
  return transformCommand('Quantize notes', (score) => quantize(score, eventIds, options));
}

// ---- transposeCommand -----------------------------------------------------------

function transpose(score: Score, eventIds: readonly UUID[], semitones: number): Score {
  const idSet = new Set(eventIds);
  const tracks = score.tracks.map((track) => {
    const measures = track.measures.map((measure) => {
      const voices = measure.voices.map((voice) => {
        if (!voice.events.some((e) => idSet.has(e.id))) return voice;
        return {
          ...voice,
          events: voice.events.map((event) =>
            isNoteEvent(event) && idSet.has(event.id)
              ? { ...event, pitch: transposePitch(event.pitch, semitones, measure.keySignature) }
              : event,
          ),
        };
      });
      const measureChanged = voices.some((v, i) => v !== measure.voices[i]);
      return measureChanged ? { ...measure, voices } : measure;
    });
    const trackChanged = measures.some((m, i) => m !== track.measures[i]);
    return trackChanged ? { ...track, measures } : track;
  });
  return withTracks(score, tracks);
}

/** Transposes the given notes by `semitones`, re-spelling each per its own measure's key signature. */
export function transposeCommand(eventIds: UUID[], semitones: number): ScoreCommand {
  return transformCommand('Transpose', (score) => transpose(score, eventIds, semitones));
}
