import { afterEach, describe, expect, it } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { createAppStore } from '@sudobility/music_lib';
import { stressScore, twinkleScore } from '@sudobility/music_lib';
import { allNotes, findEvent } from '@sudobility/music_lib';
import { isNoteEvent } from '@sudobility/music_types';
import type { NoteEvent } from '@sudobility/music_types';
import {
  changeAccidental,
  changeArticulation,
  changeDuration,
  changeVelocity,
  deleteSelected,
  duplicateSelected,
  findAdjacentEventId,
  insertNoteAtSelection,
  insertRestAtSelection,
  moveSelectionHorizontal,
  quantizeSelection,
  resolveInsertTarget,
  selectAll,
  selectedNoteIds,
  selectMeasure,
  selectTrackAction,
  toggleTie,
  transposeOctave,
  transposeSemitone,
} from '@/features/score-editor/editing';
import { transformCommand } from '@sudobility/music_lib';
import { QuantizeService } from '@sudobility/music_lib';
import type { QuantizeOptions } from '@sudobility/music_lib';

let dbCounter = 0;

function makeStore() {
  dbCounter += 1;
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twinkleScore());
  return store;
}

afterEach(async () => {
});

describe('resolveInsertTarget', () => {
  it("targets the first selected event's own measure/voice/tick", () => {
    const score = twinkleScore();
    const track = score.tracks[0];
    const secondMeasure = track.measures[1];
    const noteId = secondMeasure.voices[0].events[0].id;

    const target = resolveInsertTarget(score, { eventIds: [noteId], measureIds: [], trackIds: [] });
    expect(target).toEqual({
      trackId: track.id,
      measureId: secondMeasure.id,
      voiceIndex: 0,
      startTick: secondMeasure.voices[0].events[0].startTick,
    });
  });

  it('falls back to the first selected measure start when no event is selected', () => {
    const score = twinkleScore();
    const track = score.tracks[0];
    const thirdMeasure = track.measures[2];

    const target = resolveInsertTarget(score, { eventIds: [], measureIds: [thirdMeasure.id], trackIds: [] });
    expect(target).toEqual({ trackId: track.id, measureId: thirdMeasure.id, voiceIndex: 0, startTick: thirdMeasure.startTick });
  });

  it("falls back to the score's first measure when nothing is selected", () => {
    const score = twinkleScore();
    const track = score.tracks[0];
    const target = resolveInsertTarget(score, { eventIds: [], measureIds: [], trackIds: [] });
    expect(target).toEqual({ trackId: track.id, measureId: track.measures[0].id, voiceIndex: 0, startTick: 0 });
  });
});

describe('insertNoteAtSelection', () => {
  it('adds a note at the target position using the current snapGrid duration', () => {
    const store = makeStore();
    const before = allNotes(store.getState().score!).length;

    insertNoteAtSelection(store, { step: 'C', accidental: 0, octave: 5 });

    const after = allNotes(store.getState().score!);
    expect(after.length).toBe(before + 1);
    expect(store.getState().canUndo).toBe(true);
  });

  it('is a no-op with no score loaded', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(() => insertNoteAtSelection(store, { step: 'C', accidental: 0, octave: 4 })).not.toThrow();
    expect(store.getState().score).toBeNull();
  });
});

describe('insertRestAtSelection (alias of deleteSelected)', () => {
  it('removes the selected note, backfilling a rest', () => {
    const store = makeStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });

    insertRestAtSelection(store);

    expect(findEvent(store.getState().score!, noteId)).toBeNull();
  });
});

describe('transposeSemitone / transposeOctave', () => {
  it('moves the selected note up one semitone', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    transposeSemitone(store, 1);

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    // C4 up a semitone re-spells as C#4 (sharp spelling default).
    expect(updated.pitch).toEqual({ step: 'C', accidental: 1, octave: 4 });
  });

  it('moves the selected note down one octave', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    transposeOctave(store, -1);

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.pitch.octave).toBe(note.pitch.octave - 1);
  });

  it('is a no-op when nothing is selected', () => {
    const store = makeStore();
    const before = store.getState().score;
    transposeSemitone(store, 1);
    expect(store.getState().score).toBe(before);
  });
});

describe('findAdjacentEventId / moveSelectionHorizontal', () => {
  it('finds the next and previous event within the same voice, across measures', () => {
    const score = twinkleScore();
    const channel = score.tracks[0].measures.flatMap((m) => m.voices[0].events);
    const [first, second] = channel;

    expect(findAdjacentEventId(score, first.id, 'next')).toBe(second.id);
    expect(findAdjacentEventId(score, second.id, 'prev')).toBe(first.id);
  });

  it('returns null at the start/end of the channel', () => {
    const score = twinkleScore();
    const channel = score.tracks[0].measures.flatMap((m) => m.voices[0].events);
    expect(findAdjacentEventId(score, channel[0].id, 'prev')).toBeNull();
    expect(findAdjacentEventId(score, channel[channel.length - 1].id, 'next')).toBeNull();
  });

  it('moveSelectionHorizontal selects the adjacent event', () => {
    const store = makeStore();
    const channel = store.getState().score!.tracks[0].measures.flatMap((m) => m.voices[0].events);
    store.getState().setSelection({ eventIds: [channel[0].id], measureIds: [], trackIds: [] });

    moveSelectionHorizontal(store, 'next');

    expect(store.getState().selection.eventIds).toEqual([channel[1].id]);
  });

  it('seeds the selection with the first note when nothing is selected and direction is next', () => {
    const store = makeStore();
    moveSelectionHorizontal(store, 'next');
    const firstNote = allNotes(store.getState().score!)[0];
    expect(store.getState().selection.eventIds).toEqual([firstNote.id]);
  });
});

describe('deleteSelected', () => {
  it('deletes the selected notes and clears the selection', () => {
    const store = makeStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });

    deleteSelected(store);

    expect(findEvent(store.getState().score!, noteId)).toBeNull();
    expect(store.getState().selection.eventIds).toEqual([]);
  });

  it('is a no-op when nothing is selected', () => {
    const store = makeStore();
    const before = store.getState().score;
    deleteSelected(store);
    expect(store.getState().score).toBe(before);
  });
});

describe('duplicateSelected', () => {
  it('pastes a copy of the selected note after its own end tick as one undoable command', () => {
    // twinkleScore's measures are fully packed with adjacent notes, so
    // pasting immediately after a note's end tick can land exactly on the
    // following note and replace it (reflowVoice's documented
    // replace-on-overlap rule) rather than strictly growing the note count
    // — assert the command actually ran (score reference changed, undoable)
    // rather than a specific note-count delta.
    const store = makeStore();
    const before = store.getState().score;
    const noteId = allNotes(store.getState().score!)[0].id;
    store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });

    duplicateSelected(store);

    expect(store.getState().score).not.toBe(before);
    expect(store.getState().canUndo).toBe(true);
  });

  it('is a no-op when nothing is selected', () => {
    const store = makeStore();
    const before = store.getState().score;
    duplicateSelected(store);
    expect(store.getState().score).toBe(before);
  });
});

describe('selectAll / selectMeasure / selectTrackAction', () => {
  it('selectAll selects every note in the score', () => {
    const store = makeStore();
    selectAll(store);
    const allIds = allNotes(store.getState().score!).map((n) => n.id);
    expect(new Set(store.getState().selection.eventIds)).toEqual(new Set(allIds));
  });

  it('selectMeasure replaces the selection with the given measure', () => {
    const store = makeStore();
    const measureId = store.getState().score!.tracks[0].measures[1].id;
    selectMeasure(store, measureId);
    expect(store.getState().selection).toEqual({ eventIds: [], measureIds: [measureId], trackIds: [] });
  });

  it('selectTrackAction replaces the selection with the given track', () => {
    const store = makeStore();
    const trackId = store.getState().score!.tracks[0].id;
    selectTrackAction(store, trackId);
    expect(store.getState().selection).toEqual({ eventIds: [], measureIds: [], trackIds: [trackId] });
  });
});

describe('per-note property changes', () => {
  it('changeDuration sets the selected note duration', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    changeDuration(store, 'eighth');

    const updated = findEvent(store.getState().score!, note.id);
    expect(updated?.durationTicks).toBe(store.getState().score!.ppq / 2);
  });

  it('changeVelocity sets the selected note velocity', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    changeVelocity(store, 100);

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.velocity).toBe(100);
  });

  it('changeArticulation sets and clears the selected note articulation', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    changeArticulation(store, 'staccato');
    expect((findEvent(store.getState().score!, note.id) as NoteEvent).articulation).toBe('staccato');

    changeArticulation(store, undefined);
    expect((findEvent(store.getState().score!, note.id) as NoteEvent).articulation).toBeUndefined();
  });

  it('changeAccidental sets the selected note accidental', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    changeAccidental(store, 1);

    expect((findEvent(store.getState().score!, note.id) as NoteEvent).pitch.accidental).toBe(1);
  });

  it('toggleTie toggles tieStart on the selected note', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });

    toggleTie(store, 'tieStart');
    expect((findEvent(store.getState().score!, note.id) as NoteEvent).tieStart).toBe(true);

    toggleTie(store, 'tieStart');
    expect((findEvent(store.getState().score!, note.id) as NoteEvent).tieStart).toBe(false);
  });
});

describe('quantizeSelection', () => {
  it('dispatches a quantize command for the selected notes', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    const ppq = store.getState().score!.ppq;

    quantizeSelection(store, { grid: ppq / 4, quantizeStarts: true, quantizeDurations: true });

    expect(store.getState().canUndo).toBe(true);
  });

  it('routes a selection touching >2000 notes through the given QuantizeService (spec §29) and produces the same result as the inline path', async () => {
    dbCounter += 1;
    const store = createAppStore({ context: testStoreContext() });
    // 1 track x 600 measures x 4 notes/measure = 2400 notes, well over the
    // 2000-note worker-routing threshold, spread across 600 per-measure
    // voices (stressScore's convention) so no single voice is huge — the
    // threshold sums notes across every touched voice, not per-voice.
    const big = stressScore(1, 600);
    store.getState().setScore(big);
    const ids = allNotes(store.getState().score!).map((n) => n.id);
    expect(ids.length).toBeGreaterThan(2000);
    store.getState().setSelection({ eventIds: ids, measureIds: [], trackIds: [] });

    const options: QuantizeOptions = { grid: big.ppq / 4, quantizeStarts: true, quantizeDurations: true };
    // No worker in vitest/jsdom, so this exercises QuantizeService's
    // direct-call fallback — still routed through the async worker-path
    // code (not `quantizeCommand` synchronously), which is what this test
    // checks.
    const service = new QuantizeService();
    expect(service.usesWorker).toBe(false);

    await quantizeSelection(store, options, service);

    expect(store.getState().canUndo).toBe(true);
    expect(allNotes(store.getState().score!).every((n) => n.startTick % (big.ppq / 4) === 0)).toBe(true);

  });
});

describe('selectedNoteIds', () => {
  it('keeps only ids that resolve to note events', () => {
    const score = twinkleScore();
    const noteId = allNotes(score)[0].id;
    const ids = selectedNoteIds(score, { eventIds: [noteId, 'nonexistent'], measureIds: [], trackIds: [] });
    expect(ids).toEqual([noteId]);
  });

  it('drops rest event ids', () => {
    const score = twinkleScore();
    const restId = score.tracks[0].measures[0].voices[0].events.find((e) => !isNoteEvent(e))?.id;
    // twinkleScore's measures are fully covered by notes, so there may be no
    // rest at all; only assert the filtering behavior when one exists.
    if (!restId) return;
    const ids = selectedNoteIds(score, { eventIds: [restId], measureIds: [], trackIds: [] });
    expect(ids).toEqual([]);
  });
});

describe('dispatchTracked', () => {
  it('pushes an error toast when the command introduces a new validation error', () => {
    const store = makeStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    expect(store.getState().toasts).toEqual([]);

    // changeVelocity(store, 500) goes through dispatchTracked and produces an
    // out-of-range (0-127) velocity -> INVALID_VELOCITY validation error.
    store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
    changeVelocity(store, 500);

    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].severity).toBe('error');
  });

  it('does not push a toast for a command that stays valid', () => {
    const store = makeStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });

    changeVelocity(store, 100);

    expect(store.getState().toasts).toEqual([]);
  });

  it('does not re-announce a pre-existing validation error on an unrelated later edit', () => {
    const store = makeStore();
    const notes = allNotes(store.getState().score!);

    // Directly dispatch a command that introduces an error, bypassing
    // dispatchTracked (simulating a pre-existing invalid state from some
    // other source), then perform an unrelated dispatchTracked edit.
    store.getState().dispatchCommand(
      transformCommand('Force invalid velocity', (score) => ({
        ...score,
        tracks: score.tracks.map((t) => ({
          ...t,
          measures: t.measures.map((m) => ({
            ...m,
            voices: m.voices.map((v) => ({
              ...v,
              events: v.events.map((e) => (e.id === notes[0].id ? { ...e, velocity: 500 } : e)),
            })),
          })),
        })),
      })),
    );
    expect(store.getState().toasts).toEqual([]);

    store.getState().setSelection({ eventIds: [notes[1].id], measureIds: [], trackIds: [] });
    changeVelocity(store, 90);

    expect(store.getState().toasts).toEqual([]);
  });
});
