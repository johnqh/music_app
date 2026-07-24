import { describe, expect, it } from 'vitest';
import { createEmptyScore } from '@/domain/score/factory';
import {
  ensureVoiceAtIndex,
  insertNoteIntoTrack,
  reflowVoice,
  removeNotesFromTrack,
  touchMetadata,
} from '@/domain/commands/reflow';
import { isNoteEvent } from '@/domain/score/types';
import type { Measure, NoteEvent, Track } from '@/domain/score/types';

const PITCH = { step: 'C' as const, accidental: 0 as const, octave: 4 };

function noteAt(startTick: number, durationTicks: number, voiceId: string, trackId: string, id = `n-${startTick}`): NoteEvent {
  return { id, pitch: PITCH, startTick, durationTicks, velocity: 80, voiceId, trackId };
}

/** A single 1920-tick (4/4 @ 480ppq) measure whose voice 0 has just `events`. */
function measureWith(events: NoteEvent[], voiceId = 'v1'): Measure {
  return {
    id: 'm1',
    index: 0,
    startTick: 0,
    durationTicks: 1920,
    timeSignature: { numerator: 4, denominator: 4 },
    keySignature: { fifths: 0, mode: 'major' },
    voices: [{ id: voiceId, name: 'Voice 1', events }],
  };
}

describe('reflowVoice', () => {
  it('fills a trailing gap with a rest', () => {
    const measure = measureWith([noteAt(0, 480, 'v1', 't1')]);
    const result = reflowVoice(measure, 'v1', 't1');
    const events = result.voices[0].events;

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ startTick: 0, durationTicks: 480 });
    expect(isNoteEvent(events[0])).toBe(true);
    expect(events[1]).toMatchObject({ startTick: 480, durationTicks: 1440 });
    expect(isNoteEvent(events[1])).toBe(false);
  });

  it('fills a leading gap and a gap between two notes', () => {
    const measure = measureWith([noteAt(480, 240, 'v1', 't1', 'a'), noteAt(960, 240, 'v1', 't1', 'b')]);
    const result = reflowVoice(measure, 'v1', 't1');
    const events = result.voices[0].events;

    expect(events.map((e) => [e.startTick, e.durationTicks, isNoteEvent(e)])).toEqual([
      [0, 480, false],
      [480, 240, true],
      [720, 240, false],
      [960, 240, true],
      [1200, 720, false],
    ]);
  });

  it('trims a note extending past the measure end (and rests the leading gap before it)', () => {
    const measure = measureWith([noteAt(1800, 1000, 'v1', 't1')]);
    const result = reflowVoice(measure, 'v1', 't1');
    const events = result.voices[0].events;

    expect(events).toEqual([
      expect.objectContaining({ startTick: 0, durationTicks: 1800 }),
      expect.objectContaining({ startTick: 1800, durationTicks: 120 }),
    ]);
  });

  it('drops a note that starts at or after the measure end and rests the whole measure', () => {
    const measure = measureWith([noteAt(1920, 100, 'v1', 't1')]);
    const result = reflowVoice(measure, 'v1', 't1');
    const events = result.voices[0].events;

    expect(events).toHaveLength(1);
    expect(isNoteEvent(events[0])).toBe(false);
    expect(events[0]).toMatchObject({ startTick: 0, durationTicks: 1920 });
  });

  it('drops any pre-existing rests and regenerates them from scratch', () => {
    const measure: Measure = {
      ...measureWith([noteAt(0, 480, 'v1', 't1')]),
    };
    measure.voices[0].events.push({ id: 'stale-rest', startTick: 480, durationTicks: 1440, voiceId: 'v1', trackId: 't1' });
    const result = reflowVoice(measure, 'v1', 't1');
    expect(result.voices[0].events.find((e) => e.id === 'stale-rest')).toBeUndefined();
    expect(result.voices[0].events).toHaveLength(2);
  });

  it('returns the measure unchanged when no voice matches the given id', () => {
    const measure = measureWith([noteAt(0, 480, 'v1', 't1')]);
    expect(reflowVoice(measure, 'missing', 't1')).toBe(measure);
  });

  it('rests the whole measure when the voice has no notes left', () => {
    const measure = measureWith([]);
    const result = reflowVoice(measure, 'v1', 't1');
    expect(result.voices[0].events).toEqual([expect.objectContaining({ startTick: 0, durationTicks: 1920 })]);
  });
});

describe('ensureVoiceAtIndex', () => {
  it('returns the measure unchanged when a voice already exists at the index', () => {
    const measure = measureWith([]);
    expect(ensureVoiceAtIndex(measure, 0, 't1')).toBe(measure);
  });

  it('creates a fresh fully-rested voice at the requested index', () => {
    const measure = measureWith([]);
    const result = ensureVoiceAtIndex(measure, 1, 't1');
    expect(result.voices).toHaveLength(2);
    expect(result.voices[1].events).toEqual([
      expect.objectContaining({ startTick: 0, durationTicks: 1920, voiceId: result.voices[1].id, trackId: 't1' }),
    ]);
  });

  it('backfills intermediate missing voices when asked for a distant index', () => {
    const measure = measureWith([]);
    const result = ensureVoiceAtIndex(measure, 2, 't1');
    expect(result.voices).toHaveLength(3);
    // voices[0] is the pre-existing (fixture) voice, left untouched; the newly
    // created intermediate/target voices are each seeded with one full rest.
    expect(result.voices[1].events).toHaveLength(1);
    expect(result.voices[2].events).toHaveLength(1);
  });
});

describe('removeNotesFromTrack', () => {
  function trackWithMeasure(events: NoteEvent[]): Track {
    const score = createEmptyScore({ title: 'S', tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const voiceId = track.measures[0].voices[0].id;
    return {
      ...track,
      measures: [{ ...track.measures[0], voices: [{ id: voiceId, name: 'Voice 1', events }] }],
    };
  }

  it('removes the targeted note and backfills a rest', () => {
    const score = createEmptyScore({ title: 'S', tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const voiceId = track.measures[0].voices[0].id;
    const track2 = trackWithMeasure([noteAt(0, 480, voiceId, track.id, 'n1')]);

    const result = removeNotesFromTrack(track2, new Set(['n1']));
    const events = result.measures[0].voices[0].events;
    expect(events).toHaveLength(1);
    expect(isNoteEvent(events[0])).toBe(false);
    expect(events[0]).toMatchObject({ startTick: 0, durationTicks: 1920 });
  });

  it('leaves measures with no matching event unchanged (referentially)', () => {
    const track = trackWithMeasure([]);
    const result = removeNotesFromTrack(track, new Set(['nonexistent']));
    expect(result.measures[0]).toBe(track.measures[0]);
  });
});

describe('insertNoteIntoTrack', () => {
  it('inserts into the measure containing the note start tick, in the requested voice', () => {
    const score = createEmptyScore({ title: 'S', measures: 2, tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const measureTicks = track.measures[0].durationTicks;
    const note = noteAt(measureTicks + 100, 200, 'placeholder', track.id, 'new-note');

    const result = insertNoteIntoTrack(track, note, 0);
    const targetMeasure = result.measures[1];
    const events = targetMeasure.voices[0].events;
    const inserted = events.find((e) => e.id === 'new-note');
    expect(inserted).toBeDefined();
    expect(inserted).toMatchObject({ startTick: measureTicks + 100, durationTicks: 200, trackId: track.id });
    // voiceId is renumbered to the destination voice's actual id, not the placeholder.
    expect((inserted as NoteEvent).voiceId).toBe(targetMeasure.voices[0].id);
    expect(result.measures[0]).toBe(track.measures[0]); // untouched measure preserved by reference
  });

  it('creates the target voice if it does not exist yet', () => {
    const score = createEmptyScore({ title: 'S', tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const note = noteAt(0, 480, 'placeholder', track.id, 'new-note');

    const result = insertNoteIntoTrack(track, note, 1);
    expect(result.measures[0].voices).toHaveLength(2);
    expect(result.measures[0].voices[1].events.some((e) => e.id === 'new-note')).toBe(true);
  });

  it('returns the track unchanged when no measure contains the note start tick', () => {
    const score = createEmptyScore({ title: 'S', tracks: [{ name: 'Piano' }] });
    const track = score.tracks[0];
    const outOfRange = noteAt(1_000_000, 100, 'placeholder', track.id, 'oob');

    const result = insertNoteIntoTrack(track, outOfRange, 0);
    expect(result).toEqual(track);
  });
});

describe('touchMetadata', () => {
  it('refreshes updatedAt while preserving other fields', () => {
    const metadata = { title: 'T', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2020-01-01T00:00:00.000Z' };
    const result = touchMetadata(metadata);
    expect(result.title).toBe('T');
    expect(result.createdAt).toBe(metadata.createdAt);
    expect(typeof result.updatedAt).toBe('string');
  });
});
