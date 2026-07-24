import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '@/domain/score/factory';
import { validateScore } from '@/domain/validation/validator';
import { isNoteEvent } from '@/domain/score/types';
import type { Pitch } from '@/domain/score/types';
import { ticksFor } from '@/domain/time/ticks';
import {
  addNoteCommand,
  changeAccidentalCommand,
  changeArticulationCommand,
  changeDurationCommand,
  changePitchCommand,
  changeVelocityCommand,
  changeVoiceCommand,
  deleteEventsCommand,
  moveNotesCommand,
  resizeNotesCommand,
  toggleTieCommand,
} from '@/domain/commands/note-commands';

const PITCH: Pitch = { step: 'C', accidental: 0, octave: 4 };

function baseScore() {
  return createEmptyScore({ title: 'S', measures: 2, tracks: [{ name: 'Piano' }] });
}

/** Adds a single 480-tick C4 note at startTick 0 of measure 0/voice 0, returning the resulting score. */
function withOneNote(score = baseScore()) {
  const track = score.tracks[0];
  return addNoteCommand({
    trackId: track.id,
    measureId: track.measures[0].id,
    voiceIndex: 0,
    pitch: PITCH,
    startTick: 0,
    durationTicks: 480,
  }).execute(score);
}

function firstNoteId(score: ReturnType<typeof withOneNote>) {
  const note = score.tracks[0].measures[0].voices[0].events.find(isNoteEvent);
  if (!note) throw new Error('expected a note in measure 0');
  return note.id;
}

describe('addNoteCommand', () => {
  it('adds a note and backfills the remaining rest, keeping the measure valid', () => {
    const score = baseScore();
    const next = withOneNote(score);

    const events = next.tracks[0].measures[0].voices[0].events;
    expect(events.filter(isNoteEvent)).toHaveLength(1);
    expect(validateScore(next)).toEqual([]);
  });

  it('execute then undo returns a deep-equal score', () => {
    const score = baseScore();
    const track = score.tracks[0];
    const cmd = addNoteCommand({
      trackId: track.id,
      measureId: track.measures[0].id,
      voiceIndex: 0,
      pitch: PITCH,
      startTick: 0,
      durationTicks: 480,
    });
    const next = cmd.execute(score);
    expect(cmd.undo(next)).toEqual(score);
  });

  it('is a no-op when trackId/measureId do not match anything in the score', () => {
    const score = baseScore();
    const cmd = addNoteCommand({
      trackId: 'missing-track',
      measureId: 'missing-measure',
      voiceIndex: 0,
      pitch: PITCH,
      startTick: 0,
      durationTicks: 480,
    });
    const next = cmd.execute(score);
    expect(next.tracks).toEqual(score.tracks);
  });
});

describe('deleteEventsCommand', () => {
  it('deletes a note and backfills a rest', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = deleteEventsCommand([noteId]);

    const next = cmd.execute(withNote);
    expect(next.tracks[0].measures[0].voices[0].events.filter(isNoteEvent)).toHaveLength(0);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('is a no-op for unknown event ids', () => {
    const withNote = withOneNote();
    const cmd = deleteEventsCommand(['missing']);
    expect(cmd.execute(withNote)).toEqual(withNote);
  });
});

describe('moveNotesCommand', () => {
  it('moves a note within the same measure by deltaTicks and transposes by deltaSemitones', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = moveNotesCommand([noteId], { deltaTicks: 240, deltaSemitones: 2 });

    const next = cmd.execute(withNote);
    const moved = next.tracks[0].measures[0].voices[0].events.find(isNoteEvent);
    expect(moved).toMatchObject({ startTick: 240, pitch: { step: 'D', accidental: 0, octave: 4 } });
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('splits a note into tied segments when the move crosses a measure boundary', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = moveNotesCommand([noteId], { deltaTicks: 1800, deltaSemitones: 0 });

    const next = cmd.execute(withNote);
    const m0Notes = next.tracks[0].measures[0].voices[0].events.filter(isNoteEvent);
    const m1Notes = next.tracks[0].measures[1].voices[0].events.filter(isNoteEvent);

    expect(m0Notes).toHaveLength(1);
    expect(m1Notes).toHaveLength(1);
    expect(m0Notes[0].tieStart).toBe(true);
    expect(m1Notes[0].tieStop).toBe(true);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('clamps movement so a note never moves past the end of the track', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = moveNotesCommand([noteId], { deltaTicks: 1_000_000, deltaSemitones: 0 });

    const next = cmd.execute(withNote);
    const track = next.tracks[0];
    const trackEnd = track.measures[track.measures.length - 1].startTick + track.measures[0].durationTicks;
    const notes = track.measures.flatMap((m) => m.voices.flatMap((v) => v.events.filter(isNoteEvent)));

    expect(notes).toHaveLength(1);
    expect(notes[0].startTick + notes[0].durationTicks).toBeLessThanOrEqual(trackEnd);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('is a no-op for unknown event ids', () => {
    const withNote = withOneNote();
    const cmd = moveNotesCommand(['missing'], { deltaTicks: 100, deltaSemitones: 1 });
    expect(cmd.execute(withNote)).toEqual(withNote);
  });
});

describe('resizeNotesCommand', () => {
  it('resizes a note and reflows the rest of the measure', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = resizeNotesCommand([noteId], 960);

    const next = cmd.execute(withNote);
    const resized = next.tracks[0].measures[0].voices[0].events.find(isNoteEvent);
    expect(resized?.durationTicks).toBe(960);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('clamps a resize that would exceed the measure boundary', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = resizeNotesCommand([noteId], 10_000);

    const next = cmd.execute(withNote);
    const resized = next.tracks[0].measures[0].voices[0].events.find(isNoteEvent);
    expect(resized?.durationTicks).toBe(next.tracks[0].measures[0].durationTicks);
    expect(validateScore(next)).toEqual([]);
  });
});

describe('changeDurationCommand', () => {
  it('converts a named duration to ticks using the score ppq', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = changeDurationCommand([noteId], 'half');

    const next = cmd.execute(withNote);
    const resized = next.tracks[0].measures[0].voices[0].events.find(isNoteEvent);
    expect(resized?.durationTicks).toBe(ticksFor('half', withNote.ppq));
    expect(cmd.undo(next)).toEqual(withNote);
  });
});

describe('changePitchCommand', () => {
  it('sets the note pitch and round-trips through undo', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const newPitch: Pitch = { step: 'G', accidental: 1, octave: 5 };
    const cmd = changePitchCommand([noteId], newPitch);

    const next = cmd.execute(withNote);
    expect(next.tracks[0].measures[0].voices[0].events.find(isNoteEvent)?.pitch).toEqual(newPitch);
    expect(cmd.undo(next)).toEqual(withNote);
  });
});

describe('changeVelocityCommand', () => {
  it('sets note velocity and round-trips through undo', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = changeVelocityCommand([noteId], 42);

    const next = cmd.execute(withNote);
    expect(next.tracks[0].measures[0].voices[0].events.find(isNoteEvent)?.velocity).toBe(42);
    expect(cmd.undo(next)).toEqual(withNote);
  });
});

describe('changeArticulationCommand', () => {
  it('sets an articulation and round-trips through undo', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = changeArticulationCommand([noteId], 'staccato');

    const next = cmd.execute(withNote);
    expect(next.tracks[0].measures[0].voices[0].events.find(isNoteEvent)?.articulation).toBe('staccato');
    expect(cmd.undo(next)).toEqual(withNote);
  });

  it('clears an articulation when given undefined', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const withArticulation = changeArticulationCommand([noteId], 'accent').execute(withNote);

    const cmd = changeArticulationCommand([noteId], undefined);
    const next = cmd.execute(withArticulation);
    expect(next.tracks[0].measures[0].voices[0].events.find(isNoteEvent)?.articulation).toBeUndefined();
    expect(cmd.undo(next)).toEqual(withArticulation);
  });
});

describe('changeAccidentalCommand', () => {
  it('sets pitch accidental, keeping step/octave, and round-trips through undo', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = changeAccidentalCommand([noteId], 1);

    const next = cmd.execute(withNote);
    expect(next.tracks[0].measures[0].voices[0].events.find(isNoteEvent)?.pitch).toEqual({
      step: 'C',
      accidental: 1,
      octave: 4,
    });
    expect(cmd.undo(next)).toEqual(withNote);
  });
});

describe('toggleTieCommand', () => {
  it('toggles tieStart on and back off, round-tripping through undo each time', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = toggleTieCommand([noteId], 'tieStart');

    const next = cmd.execute(withNote);
    expect(next.tracks[0].measures[0].voices[0].events.find(isNoteEvent)?.tieStart).toBe(true);
    expect(cmd.undo(next)).toEqual(withNote);
  });
});

describe('changeVoiceCommand', () => {
  it('moves a note into a new voice, backfilling both voices, and round-trips through undo', () => {
    const withNote = withOneNote();
    const noteId = firstNoteId(withNote);
    const cmd = changeVoiceCommand([noteId], 1);

    const next = cmd.execute(withNote);
    const measure = next.tracks[0].measures[0];
    expect(measure.voices).toHaveLength(2);
    expect(measure.voices[0].events.filter(isNoteEvent)).toHaveLength(0);
    expect(measure.voices[1].events.filter(isNoteEvent)).toHaveLength(1);
    expect(validateScore(next)).toEqual([]);
    expect(cmd.undo(next)).toEqual(withNote);
  });
});
