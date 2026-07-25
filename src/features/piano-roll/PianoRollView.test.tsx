import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { createAppStore } from '@/store/useAppStore';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ScoreSmithDb } from '@/services/persistence/db';
import { twinkleScore } from '@/test/fixtures';
import { allNotes, findEvent } from '@/domain/score/queries';
import type { NoteEvent } from '@/domain/score/types';
import { extractFragment } from '@/domain/score/fragment';
import {
  VELOCITY_LANE_HEIGHT,
  keyboardHeightPx,
  midiToY,
  tickToX,
  voiceLaneStripHeight,
} from '@/features/piano-roll/geometry';
import { PianoRollView } from '@/features/piano-roll/PianoRollView';

let db: ScoreSmithDb;
let dbCounter = 0;

function makeStore(): EditorStoreApi {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-piano-roll-view-${dbCounter}`);
  const store = createAppStore({ db });
  store.getState().setScore(twinkleScore());
  return store;
}

afterEach(async () => {
  await db?.delete();
});

function noteRect(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testid="pr-note-${id}"]`);
  if (!el) throw new Error(`No rendered rect for note ${id}`);
  return el;
}

describe('PianoRollView', () => {
  it('renders without a score loaded (empty state)', () => {
    const store = createAppStore({ db: new ScoreSmithDb('scoresmith-test-piano-roll-view-empty') });
    expect(() => render(<PianoRollView store={store} />)).not.toThrow();
  });

  it('renders one rect per fixture note', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const notes = allNotes(store.getState().score!);
    for (const note of notes) {
      expect(container.querySelector(`[data-testid="pr-note-${note.id}"]`)).not.toBeNull();
    }
  });

  it('clicking a note selects it, and shift-clicking a second note adds it', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const [first, second] = allNotes(store.getState().score!) as NoteEvent[];
    const ppq = store.getState().score!.ppq;

    // Hit-testing here is coordinate-based (geometry.ts), not DOM-id-based
    // like ScoreEditorView's VexFlow click handler, so the fired
    // clientX/clientY must land on each note's own computed rect — not
    // just target its DOM element (which jsdom's zeroed
    // getBoundingClientRect() would make indistinguishable anyway).
    const firstX = tickToX(first.startTick, ppq, 1) + 5;
    const secondX = tickToX(second.startTick, ppq, 1) + 5;
    const y = midiToY(60, 1) + 7; // both notes are C4 in this fixture measure

    fireEvent.pointerDown(noteRect(container, first.id), { clientX: firstX, clientY: y, button: 0, pointerId: 1 });
    fireEvent.pointerUp(noteRect(container, first.id), { clientX: firstX, clientY: y, pointerId: 1 });
    expect(store.getState().selection.eventIds).toEqual([first.id]);

    fireEvent.pointerDown(noteRect(container, second.id), {
      clientX: secondX,
      clientY: y,
      button: 0,
      pointerId: 2,
      shiftKey: true,
    });
    fireEvent.pointerUp(noteRect(container, second.id), { clientX: secondX, clientY: y, pointerId: 2, shiftKey: true });
    expect(store.getState().selection.eventIds).toEqual([first.id, second.id]);
  });

  it('double-clicking an empty cell adds a note via addNoteCommand', () => {
    const store = makeStore();
    const { getByTestId } = render(<PianoRollView store={store} />);
    const before = allNotes(store.getState().score!).length;
    const grid = getByTestId('piano-roll-grid');

    // tick ~200 (raw; addNoteAtCell snaps internally), midi 84 (C6) — well
    // above the fixture's own octave-4 melody, so this cell is guaranteed
    // empty.
    const x = tickToX(200, store.getState().score!.ppq, 1);
    const y = midiToY(84, 1);
    fireEvent.doubleClick(grid, { clientX: x, clientY: y, button: 0 });

    const after = allNotes(store.getState().score!);
    expect(after.length).toBe(before + 1);
    expect(store.getState().canUndo).toBe(true);
  });

  it('double-clicking directly on an existing note is a no-op (does not add a duplicate)', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const [first] = allNotes(store.getState().score!);
    const before = store.getState().score;

    fireEvent.doubleClick(noteRect(container, first.id), { clientX: 5, clientY: 679, button: 0 });

    expect(store.getState().score).toBe(before);
  });

  it('dragging a note horizontally and vertically dispatches a single moveNotesCommand on pointer-up', () => {
    const store = makeStore();
    const { container, getByTestId } = render(<PianoRollView store={store} />);
    const [first] = allNotes(store.getState().score!) as NoteEvent[];
    const grid = getByTestId('piano-roll-grid');

    // note[0]: startTick 0, C4 (midi 60), quarter (480 ticks @ ppq 480) ->
    // rect x=0 y=672 w=60 h=14 (see geometry.ts's tickToX/midiToY math).
    fireEvent.pointerDown(noteRect(container, first.id), { clientX: 5, clientY: 679, button: 0, pointerId: 3 });
    fireEvent.pointerMove(grid, { clientX: 65, clientY: 665, pointerId: 3 });
    fireEvent.pointerUp(grid, { clientX: 65, clientY: 665, pointerId: 3 });

    const updated = findEvent(store.getState().score!, first.id) as NoteEvent;
    // +480 ticks (one quarter note, snapped to the default quarter grid)
    // and +1 semitone (one row up: C4 -> C#4, sharp-spelled in C major).
    expect(updated.startTick).toBe(480);
    expect(updated.pitch).toEqual({ step: 'C', accidental: 1, octave: 4 });
    expect(store.getState().canUndo).toBe(true);
  });

  it('a plain pointerdown/up on a note with no movement only selects it (no move command)', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    const [first] = allNotes(store.getState().score!) as NoteEvent[];
    const before = store.getState().score;

    fireEvent.pointerDown(noteRect(container, first.id), { clientX: 5, clientY: 679, button: 0, pointerId: 4 });
    fireEvent.pointerUp(noteRect(container, first.id), { clientX: 5, clientY: 679, pointerId: 4 });

    expect(store.getState().score).toBe(before);
    expect(store.getState().selection.eventIds).toEqual([first.id]);
  });

  it('dragging the right edge of a note resizes it via resizeNotesCommand', () => {
    const store = makeStore();
    store.getState().setSnapGrid('eighth'); // 240 ticks @ ppq 480: an exact, achievable shrink target
    const { container, getByTestId } = render(<PianoRollView store={store} />);
    const [first] = allNotes(store.getState().score!);
    const grid = getByTestId('piano-roll-grid');

    // Right edge of note[0]'s rect is at x=60. Drag it to x=30 (-30px =
    // -240 ticks) to shrink from 480 to 240 ticks — a pure shrink, so no
    // overlap-with-neighbor ambiguity.
    fireEvent.pointerDown(noteRect(container, first.id), { clientX: 60, clientY: 679, button: 0, pointerId: 6 });
    fireEvent.pointerMove(grid, { clientX: 30, clientY: 679, pointerId: 6 });
    fireEvent.pointerUp(grid, { clientX: 30, clientY: 679, pointerId: 6 });

    const updated = findEvent(store.getState().score!, first.id);
    expect(updated?.durationTicks).toBe(240);
  });

  it('dragging a note into the voice-lane strip dispatches changeVoiceCommand instead of a move', () => {
    const store = makeStore();
    const { container, getByTestId } = render(<PianoRollView store={store} />);
    const [first] = allNotes(store.getState().score!);
    const grid = getByTestId('piano-roll-grid');
    const voiceLaneTop = keyboardHeightPx(1); // top of the voice-lane strip at zoomV=1
    // Row height is 20px (VOICE_LANE_ROW_HEIGHT); targeting +25px lands in
    // lane index 1 — the note already starts in voice 0, so targeting lane
    // 0 would be an observably-inert no-op.
    const targetY = voiceLaneTop + 25;

    fireEvent.pointerDown(noteRect(container, first.id), { clientX: 5, clientY: 679, button: 0, pointerId: 7 });
    fireEvent.pointerMove(grid, { clientX: 5, clientY: targetY, pointerId: 7 });
    fireEvent.pointerUp(grid, { clientX: 5, clientY: targetY, pointerId: 7 });

    const score = store.getState().score!;
    const track = score.tracks[0];
    const measure = track.measures.find((m) => m.voices.some((v) => v.events.some((e) => e.id === first.id)))!;
    expect(measure.voices[0]?.events.some((e) => e.id === first.id)).toBe(false);
    expect(measure.voices[1]?.events.some((e) => e.id === first.id)).toBe(true);
  });

  it('dragging a note velocity-lane bar dispatches changeVelocityCommand', () => {
    const store = makeStore();
    const { getByTestId } = render(<PianoRollView store={store} />);
    const [first] = allNotes(store.getState().score!) as NoteEvent[];
    const bar = getByTestId(`pr-velocity-${first.id}`);
    const voiceLaneTop = keyboardHeightPx(1);
    const velocityTop = voiceLaneTop + voiceLaneStripHeight(2); // twinkleScore has 1 voice/measure -> floor of 2 lanes

    const relativeY = 10; // near the top of the lane -> a high velocity
    fireEvent.pointerDown(bar, { clientX: 0, clientY: velocityTop + relativeY, button: 0, pointerId: 8 });
    fireEvent.pointerUp(bar, { clientX: 0, clientY: velocityTop + relativeY, pointerId: 8 });

    const expectedVelocity = Math.round(((VELOCITY_LANE_HEIGHT - relativeY) / VELOCITY_LANE_HEIGHT) * 127);
    const updated = findEvent(store.getState().score!, first.id) as NoteEvent;
    expect(updated.velocity).toBe(expectedVelocity);
  });

  it('renders preview-fragment notes distinctly from committed notes', () => {
    const store = makeStore();
    const score = store.getState().score!;
    const track = score.tracks[0];
    const range = { startTick: 0, endTick: track.measures[0].durationTicks, trackIds: [track.id] };
    const fragment = extractFragment(score, range);
    store.setState((state) => {
      state.previewFragment = fragment;
    });

    const { container } = render(<PianoRollView store={store} />);
    const firstFragmentNote = track.measures[0].voices[0].events[0];

    expect(container.querySelector(`[data-testid="pr-preview-${firstFragmentNote.id}"]`)).not.toBeNull();
  });

  it('renders a playback cursor line positioned from positionTick', () => {
    const store = makeStore();
    store.getState().setPositionTick(480);
    const { getByTestId } = render(<PianoRollView store={store} />);
    const cursor = getByTestId('piano-roll-cursor');
    expect(cursor.style.left).toBe(`${tickToX(480, store.getState().score!.ppq, 1)}px`);
  });

  it('renders loop-region shading when a loop range is set', () => {
    const store = makeStore();
    const score = store.getState().score!;
    store.getState().setLoopRange({ startTick: 0, endTick: 1920, trackIds: [score.tracks[0].id] });
    const { getByTestId } = render(<PianoRollView store={store} />);
    expect(getByTestId('piano-roll-loop-region')).toBeInTheDocument();
  });

  it('renders the keyboard column with octave-labeled C rows', () => {
    const store = makeStore();
    const { container } = render(<PianoRollView store={store} />);
    expect(container.querySelector('[data-testid="piano-roll-keyboard"]')).not.toBeNull();
    expect(container.textContent).toContain('C4');
  });
});
