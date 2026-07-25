import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { ScoreSmithDb } from '@sudobility/music_lib';
import { twinkleScore } from '@sudobility/music_lib';
import { allNotes, findEvent } from '@sudobility/music_lib';
import type { NoteEvent } from '@sudobility/music_types';
import { useEditorShortcuts } from '@/features/score-editor/useEditorShortcuts';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import type { PlaybackToggle } from '@/features/score-editor/useEditorShortcuts';

// useEditorShortcuts defaults its `controller` param to the app-wide
// `playbackController` singleton, which eagerly constructs a real Tone.js
// engine on import — every test below instead passes its own fake
// `PlaybackToggle`, so this module is never imported for real here.
vi.mock('@sudobility/music_lib', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  playbackController: { togglePlay: vi.fn() },
}));

let db: ScoreSmithDb;
let dbCounter = 0;

function makeStore(): EditorStoreApi {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-shortcuts-${dbCounter}`);
  const store = createAppStore({ db });
  store.getState().setScore(twinkleScore());
  return store;
}

afterEach(async () => {
  await db?.delete();
});

function Harness({ store, controller }: { store: EditorStoreApi; controller?: PlaybackToggle }) {
  useEditorShortcuts(store, controller);
  return (
    <div>
      <input aria-label="text field" />
    </div>
  );
}

describe('useEditorShortcuts', () => {
  it('Space calls the playback controller\'s togglePlay() (real play/pause is the controller\'s job, not a store toggle)', async () => {
    const store = makeStore();
    const controller: PlaybackToggle = { togglePlay: vi.fn() };
    render(<Harness store={store} controller={controller} />);
    const user = userEvent.setup();

    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(1);
    await user.keyboard(' ');
    expect(controller.togglePlay).toHaveBeenCalledTimes(2);
  });

  it('Escape clears the selection', async () => {
    const store = makeStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
    render(<Harness store={store} />);
    const user = userEvent.setup();

    await user.keyboard('{Escape}');

    expect(store.getState().selection.eventIds).toEqual([]);
  });

  it('Delete dispatches the delete command for the selected note', async () => {
    const store = makeStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
    render(<Harness store={store} />);
    const user = userEvent.setup();

    await user.keyboard('{Delete}');

    expect(findEvent(store.getState().score!, noteId)).toBeNull();
    expect(store.getState().canUndo).toBe(true);
  });

  it('ArrowUp transposes the selected note up a semitone; Shift+ArrowUp transposes an octave', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    render(<Harness store={store} />);
    const user = userEvent.setup();

    await user.keyboard('{ArrowUp}');
    let updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.pitch).toEqual({ step: 'C', accidental: 1, octave: 4 });

    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
    updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.pitch.octave).toBe(note.pitch.octave + 1);
  });

  it('ArrowDown transposes down a semitone', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[1] as NoteEvent; // second note, avoid going below octave 0
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    render(<Harness store={store} />);
    const user = userEvent.setup();

    await user.keyboard('{ArrowDown}');

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.pitch).not.toEqual(note.pitch);
  });

  it('ArrowRight/ArrowLeft move the selection to the next/previous event in the voice', async () => {
    const store = makeStore();
    const channel = store.getState().score!.tracks[0].measures.flatMap((m) => m.voices[0].events);
    store.getState().setSelection({ eventIds: [channel[0].id], measureIds: [], trackIds: [] });
    render(<Harness store={store} />);
    const user = userEvent.setup();

    await user.keyboard('{ArrowRight}');
    expect(store.getState().selection.eventIds).toEqual([channel[1].id]);

    await user.keyboard('{ArrowLeft}');
    expect(store.getState().selection.eventIds).toEqual([channel[0].id]);
  });

  it('Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z redoes', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    render(<Harness store={store} />);
    const user = userEvent.setup();

    await user.keyboard('{ArrowUp}');
    expect(store.getState().canUndo).toBe(true);

    await user.keyboard('{Control>}z{/Control}');
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(true);

    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(store.getState().canRedo).toBe(false);
    expect(store.getState().canUndo).toBe(true);
  });

  it('Ctrl/Cmd+C, +X, +V copy/cut/paste the selection', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    render(<Harness store={store} />);
    const user = userEvent.setup();

    await user.keyboard('{Control>}c{/Control}');
    expect(store.getState().clipboard?.events).toHaveLength(1);

    const beforeCut = allNotes(store.getState().score!).length;
    await user.keyboard('{Control>}x{/Control}');
    expect(allNotes(store.getState().score!).length).toBe(beforeCut - 1);
    expect(store.getState().clipboard?.events).toHaveLength(1);

    const beforePaste = allNotes(store.getState().score!).length;
    await user.keyboard('{Control>}v{/Control}');
    expect(allNotes(store.getState().score!).length).toBeGreaterThanOrEqual(beforePaste);
  });

  it('ignores every shortcut while focus is inside a text input', async () => {
    const store = makeStore();
    const noteId = allNotes(store.getState().score!)[0].id;
    store.getState().setSelection({ eventIds: [noteId], measureIds: [], trackIds: [] });
    render(<Harness store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('text field'));
    await user.keyboard('{Delete}');
    await user.keyboard('{Escape}');

    // Selection and score are both untouched: the input consumed the keys.
    expect(store.getState().selection.eventIds).toEqual([noteId]);
    expect(findEvent(store.getState().score!, noteId)).not.toBeNull();
  });

  it('invalid edit (out-of-range transpose) shows an error toast', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent; // C4, midi 60
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    render(<Harness store={store} />);
    const user = userEvent.setup();

    // 6 octave-downs = -72 semitones; 60 - 72 = -12, below MIDI 0 -> INVALID_PITCH_RANGE.
    for (let i = 0; i < 6; i += 1) {
      await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    }

    const errorToasts = store.getState().toasts.filter((t) => t.severity === 'error');
    expect(errorToasts.length).toBeGreaterThan(0);
  });
});
