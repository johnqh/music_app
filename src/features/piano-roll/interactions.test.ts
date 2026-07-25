import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppStore } from '@/store/useAppStore';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ScoreSmithDb } from '@/services/persistence/db';
import { stressScore, twinkleScore, twoTrackScore } from '@/test/fixtures';
import { allNotes, findEvent } from '@/domain/score/queries';
import type { NoteEvent } from '@/domain/score/types';
import {
  addNoteAtCell,
  commitDelete,
  commitMove,
  commitQuantize,
  commitResize,
  commitVelocity,
  commitVoiceChange,
  findMeasureAtTick,
  loopFromSelection,
  maxVoiceCount,
  resolveActiveTrackId,
} from '@/features/piano-roll/interactions';
import { QuantizeService } from '@/services/quantization/quantize-service';

let db: ScoreSmithDb;
let dbCounter = 0;

function makeStore(score = twinkleScore()): EditorStoreApi {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-piano-roll-interactions-${dbCounter}`);
  const store = createAppStore({ db });
  store.getState().setScore(score);
  return store;
}

afterEach(async () => {
  await db?.delete();
});

describe('commitMove', () => {
  it('dispatches a moveNotesCommand and moves the note', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;

    commitMove(store, [note.id], { deltaTicks: 0, deltaSemitones: 2 });

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.pitch.octave === note.pitch.octave ? updated.pitch : updated).not.toEqual(note.pitch);
    expect(store.getState().canUndo).toBe(true);
  });

  it('is a no-op when deltaTicks and deltaSemitones are both zero', () => {
    const store = makeStore();
    const before = store.getState().score;
    const note = allNotes(before!)[0];

    commitMove(store, [note.id], { deltaTicks: 0, deltaSemitones: 0 });

    expect(store.getState().score).toBe(before);
  });

  it('is a no-op with no event ids', () => {
    const store = makeStore();
    const before = store.getState().score;
    commitMove(store, [], { deltaTicks: 10, deltaSemitones: 0 });
    expect(store.getState().score).toBe(before);
  });
});

describe('commitResize', () => {
  it('dispatches a resizeNotesCommand and updates duration', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    const ppq = store.getState().score!.ppq;

    commitResize(store, [note.id], ppq / 2);

    const updated = findEvent(store.getState().score!, note.id);
    expect(updated?.durationTicks).toBe(ppq / 2);
  });

  it('clamps duration to at least 1 tick', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];

    commitResize(store, [note.id], -50);

    const updated = findEvent(store.getState().score!, note.id);
    expect(updated?.durationTicks).toBeGreaterThanOrEqual(1);
  });
});

describe('commitVelocity', () => {
  it('dispatches a changeVelocityCommand', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];

    commitVelocity(store, [note.id], 100);

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.velocity).toBe(100);
  });

  it('clamps velocity to [0, 127]', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];

    commitVelocity(store, [note.id], 500);
    expect((findEvent(store.getState().score!, note.id) as NoteEvent).velocity).toBe(127);

    commitVelocity(store, [note.id], -20);
    expect((findEvent(store.getState().score!, note.id) as NoteEvent).velocity).toBe(0);
  });
});

describe('commitVoiceChange', () => {
  it('dispatches a changeVoiceCommand moving the note to a new voice', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];

    commitVoiceChange(store, [note.id], 1);

    expect(store.getState().canUndo).toBe(true);
    // The note now lives in voice index 1 of its measure.
    const score = store.getState().score!;
    const track = score.tracks.find((t) => t.id === note.trackId)!;
    const measure = track.measures.find((m) => m.voices.some((v) => v.events.some((e) => e.id === note.id)))!;
    expect(measure.voices[1]?.events.some((e) => e.id === note.id)).toBe(true);
  });
});

describe('commitDelete', () => {
  it('deletes the notes and clears the selection', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    commitDelete(store, [note.id]);

    expect(findEvent(store.getState().score!, note.id)).toBeNull();
    expect(store.getState().selection.eventIds).toEqual([]);
  });

  it('is a no-op with no event ids', () => {
    const store = makeStore();
    const before = store.getState().score;
    commitDelete(store, []);
    expect(store.getState().score).toBe(before);
  });
});

describe('commitQuantize', () => {
  it('dispatches a quantizeCommand', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    const ppq = store.getState().score!.ppq;

    commitQuantize(store, [note.id], { grid: ppq / 4, quantizeStarts: true, quantizeDurations: true });

    expect(store.getState().canUndo).toBe(true);
  });

  it('routes a selection touching >2000 notes through the given QuantizeService (spec §29)', async () => {
    const big = stressScore(1, 600); // 2400 notes, over the worker-routing threshold
    const store = makeStore(big);
    const ids = allNotes(store.getState().score!).map((n) => n.id);
    expect(ids.length).toBeGreaterThan(2000);

    const service = new QuantizeService(); // no worker in vitest/jsdom: exercises the fallback
    await commitQuantize(store, ids, { grid: big.ppq / 4, quantizeStarts: true, quantizeDurations: true }, service);

    expect(store.getState().canUndo).toBe(true);
  });
});

describe('findMeasureAtTick', () => {
  it('finds the measure containing a tick', () => {
    const score = twinkleScore();
    const track = score.tracks[0];
    const secondMeasure = track.measures[1];

    expect(findMeasureAtTick(track, secondMeasure.startTick)?.id).toBe(secondMeasure.id);
  });

  it('returns null past the end of the track', () => {
    const score = twinkleScore();
    const track = score.tracks[0];
    const lastMeasure = track.measures[track.measures.length - 1];
    expect(findMeasureAtTick(track, lastMeasure.startTick + lastMeasure.durationTicks)).toBeNull();
  });
});

describe('addNoteAtCell', () => {
  it('adds a note at the snapped tick using the current snapGrid duration', () => {
    const store = makeStore();
    const score = store.getState().score!;
    const track = score.tracks[0];
    const before = allNotes(score).length;

    // midi 72 (C5) differs from the fixture's own note at this tick (C4) so
    // the two form a genuine chord (see reflow.ts's `resolveOverlaps` doc
    // comment) rather than a same-pitch replace, which would leave the
    // note count unchanged instead of +1.
    addNoteAtCell(store, { trackId: track.id, tick: 5, midi: 72 });

    const after = allNotes(store.getState().score!);
    expect(after.length).toBe(before + 1);
    expect(store.getState().canUndo).toBe(true);
  });

  it('is a no-op for an unknown track', () => {
    const store = makeStore();
    const before = store.getState().score;
    addNoteAtCell(store, { trackId: 'nonexistent', tick: 0, midi: 60 });
    expect(store.getState().score).toBe(before);
  });

  it('is a no-op past the end of the track', () => {
    const store = makeStore();
    const score = store.getState().score!;
    const track = score.tracks[0];
    const last = track.measures[track.measures.length - 1];
    const before = store.getState().score;

    addNoteAtCell(store, { trackId: track.id, tick: last.startTick + last.durationTicks + 10000, midi: 60 });

    expect(store.getState().score).toBe(before);
  });
});

describe('resolveActiveTrackId', () => {
  it("prefers the first selected event's track", () => {
    const score = twoTrackScore();
    const bassNote = score.tracks[1].measures[0].voices[0].events[0];
    const result = resolveActiveTrackId(score, { eventIds: [bassNote.id], measureIds: [], trackIds: [] }, null);
    expect(result).toBe(score.tracks[1].id);
  });

  it('falls back to the first visible track when nothing is selected', () => {
    const score = twoTrackScore();
    const visible = new Set([score.tracks[1].id]);
    const result = resolveActiveTrackId(score, { eventIds: [], measureIds: [], trackIds: [] }, visible);
    expect(result).toBe(score.tracks[1].id);
  });

  it('skips a selected event on a filtered-out track', () => {
    const score = twoTrackScore();
    const trebleNote = score.tracks[0].measures[0].voices[0].events[0];
    const visible = new Set([score.tracks[1].id]);
    const result = resolveActiveTrackId(score, { eventIds: [trebleNote.id], measureIds: [], trackIds: [] }, visible);
    expect(result).toBe(score.tracks[1].id);
  });
});

describe('maxVoiceCount', () => {
  it('is at least 2 even for a single-voice score', () => {
    const score = twinkleScore();
    expect(maxVoiceCount(score, null)).toBeGreaterThanOrEqual(2);
  });
});

describe('loopFromSelection', () => {
  it('sets the loop range from the current selection', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    loopFromSelection(store);

    expect(store.getState().loopRange).not.toBeNull();
  });

  it('pushes a warning toast and leaves loopRange unset when nothing is selected', () => {
    const store = makeStore();

    loopFromSelection(store);

    expect(store.getState().loopRange).toBeNull();
    expect(store.getState().toasts.length).toBeGreaterThan(0);
  });
});
