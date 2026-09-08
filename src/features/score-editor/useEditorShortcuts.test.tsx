import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMusicPosition, getMusicPositionSource } from '@sudobility/music_types';
import { testStoreContext } from '@sudobility/music_lib';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { twinkleScore } from '@sudobility/music_lib';
import { allNotes, findEvent } from '@sudobility/music_lib';
import type { NoteEvent } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { useEditorShortcuts } from '@/features/score-editor/useEditorShortcuts';
import type { EditorStoreApi } from '@sudobility/music_lib';
import type { PlaybackToggle } from '@/features/score-editor/useEditorShortcuts';

// useEditorShortcuts defaults its `controller` param to the app-wide
// `playbackController` singleton, which eagerly constructs a real Tone.js
// engine on import — every test below instead passes its own fake
// `PlaybackToggle`, so this module is never imported for real here.
vi.mock('@sudobility/music_lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sudobility/music_lib')>();
  return {
    ...actual,
    playbackController: {
      // A real bus: playback position and sounding notes live on it now.
      bus: new actual.PlaybackBus(),
      togglePlay: vi.fn(),
      // Note entry steps the caret past what it wrote, and that goes through
      // the controller rather than the store.
      seek: vi.fn(),
    },
  };
});

function makeStore(): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twinkleScore());
  return store;
}

afterEach(async () => {});

function Harness({ store, controller }: { store: EditorStoreApi; controller?: PlaybackToggle }) {
  useEditorShortcuts(store, controller);
  return (
    <div>
      <input aria-label="text field" />
    </div>
  );
}

describe('useEditorShortcuts', () => {
  it("Space calls the playback controller's togglePlay() (real play/pause is the controller's job, not a store toggle)", async () => {
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

    // The clipboard is tagged now — it can hold a track or a span of bars as
    // well — so a note assertion has to say which kind it expects.
    const copiedNotes = () => {
      const clip = store.getState().clipboard;
      return clip?.kind === 'notes' ? clip.events : null;
    };

    await user.keyboard('{Control>}c{/Control}');
    expect(copiedNotes()).toHaveLength(1);

    const beforeCut = allNotes(store.getState().score!).length;
    await user.keyboard('{Control>}x{/Control}');
    expect(allNotes(store.getState().score!).length).toBe(beforeCut - 1);
    expect(copiedNotes()).toHaveLength(1);

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

  describe('note entry', () => {
    function noteCount(store: EditorStoreApi): number {
      return allNotes(store.getState().score!).length;
    }

    it('writes a note where the caret is when a pitch letter is typed', async () => {
      const store = makeStore();
      render(<Harness store={store} />);
      const user = userEvent.setup();
      const before = noteCount(store);

      await user.keyboard('f');

      expect(noteCount(store)).toBe(before + 1);
    });

    it('advances the caret, so a run of letters lays out a melody', async () => {
      // Without this a run of taps would overwrite one position instead of
      // laying out a line.
      const store = makeStore();
      act(() => getMusicPositionSource().moveTo(0));
      render(<Harness store={store} />);
      const user = userEvent.setup();
      await user.keyboard('c');

      expect(getMusicPosition().reportedTick).toBeGreaterThan(0);
    });

    it('picks the note value from a digit', async () => {
      const store = makeStore();
      render(<Harness store={store} />);
      const user = userEvent.setup();

      await user.keyboard('1');
      expect(store.getState().snapGrid).toBe('whole');
      await user.keyboard('4');
      expect(store.getState().snapGrid).toBe('eighth');
    });

    it('dots the current value with a period, the way the toolbar does', async () => {
      const store = makeStore();
      render(<Harness store={store} />);
      const user = userEvent.setup();

      await user.keyboard('3');
      await user.keyboard('.');
      expect(store.getState().snapGrid).toBe('dotted-quarter');
    });

    it('writes at the chosen value: a digit then a letter', async () => {
      const store = makeStore();
      act(() => getMusicPositionSource().moveTo(0));
      render(<Harness store={store} />);
      const user = userEvent.setup();

      await user.keyboard('2'); // half
      await user.keyboard('e');

      const written = allNotes(store.getState().score!).find((n) => n.pitch.step === 'E');
      expect(written?.durationTicks).toBe(store.getState().score!.ppq * 2);
    });

    it('selects everything with the platform shortcut', async () => {
      const store = makeStore();
      render(<Harness store={store} />);
      const user = userEvent.setup();

      await user.keyboard('{Meta>}a{/Meta}');
      expect(store.getState().selection.eventIds.length).toBeGreaterThan(0);
    });

    it('never mistakes a browser shortcut for a note', async () => {
      // Cmd+E, Cmd+F and friends belong to the browser and the OS. Entry keys
      // take no modifier precisely so they cannot collide.
      const store = makeStore();
      render(<Harness store={store} />);
      const user = userEvent.setup();
      const before = noteCount(store);

      await user.keyboard('{Meta>}e{/Meta}');
      await user.keyboard('{Control>}g{/Control}');
      await user.keyboard('{Alt>}f{/Alt}');

      expect(noteCount(store)).toBe(before);
    });

    it('stays out of the way while typing in a text field', async () => {
      const store = makeStore();
      render(<Harness store={store} />);
      const user = userEvent.setup();
      const before = noteCount(store);

      await user.click(screen.getByLabelText('text field'));
      await user.keyboard('cage');

      expect(noteCount(store)).toBe(before);
      expect(screen.getByLabelText('text field')).toHaveValue('cage');
    });
  });

  describe('caret navigation', () => {
    it('steps the caret by the current note value', async () => {
      // The companion to typed entry: letters write at the caret, so going
      // back to fix the note before last must not need the pointer.
      const store = makeStore();
      act(() => {
        getMusicPositionSource().moveTo(0);
        store.getState().setSnapGrid('quarter');
      });
      render(<Harness store={store} />);
      await userEvent.setup().keyboard('{Alt>}{ArrowRight}{/Alt}');

      const ppq = store.getState().score!.ppq;
      expect(getMusicPosition().reportedTick).toBe(ppq);
    });

    it('does not run off the front of the score', async () => {
      const store = makeStore();
      act(() => getMusicPositionSource().moveTo(0));
      render(<Harness store={store} />);
      await userEvent.setup().keyboard('{Alt>}{ArrowLeft}{/Alt}');

      expect(getMusicPosition().reportedTick).toBe(0);
    });

    it('jumps to the edges of the bar, and of the score', async () => {
      const store = makeStore();
      const measures = store.getState().score!.tracks[0].measures;
      act(() => getMusicPositionSource().moveTo(measures[1].startTick + 10));
      render(<Harness store={store} />);
      const user = userEvent.setup();
      await user.keyboard('{Home}');
      expect(getMusicPosition().reportedTick).toBe(measures[1].startTick);

      await user.keyboard('{Meta>}{Home}{/Meta}');
      expect(getMusicPosition().reportedTick).toBe(0);

      await user.keyboard('{Meta>}{End}{/Meta}');
      const last = measures.at(-1)!;
      expect(getMusicPosition().reportedTick).toBe(last.startTick + last.durationTicks - 1);
    });

    it('leaves the selection alone, unlike the bare arrows', async () => {
      // Alt is the whole disambiguation: a bare arrow still moves or
      // transposes the selection.
      const store = makeStore();
      const note = allNotes(store.getState().score!)[2];
      act(() => {
        store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
      });
      render(<Harness store={store} />);

      await userEvent.setup().keyboard('{Alt>}{ArrowRight}{/Alt}');

      expect(store.getState().selection.eventIds).toEqual([note.id]);
    });
  });

  describe('slurs', () => {
    it('slurs the selected notes with S', async () => {
      const store = makeStore();
      const notes = allNotes(store.getState().score!).slice(0, 3);
      act(() => {
        store.getState().setSelection({
          eventIds: notes.map((n) => n.id),
          measureIds: [],
          trackIds: [],
        });
      });
      render(<Harness store={store} />);

      await userEvent.setup().keyboard('s');

      const after = allNotes(store.getState().score!);
      expect(after.find((n) => n.id === notes[0].id)?.slurStart).toBe(true);
      expect(after.find((n) => n.id === notes[2].id)?.slurStop).toBe(true);
    });

    it('does nothing with a single note, which cannot carry a phrase mark', async () => {
      const store = makeStore();
      const note = allNotes(store.getState().score!)[0];
      act(() => {
        store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
      });
      render(<Harness store={store} />);

      await userEvent.setup().keyboard('s');

      expect(allNotes(store.getState().score!).some((n) => n.slurStart)).toBe(false);
    });
  });
});

describe('marks on Shift', () => {
  /** Selects the first `n` notes and mounts the shortcut harness. */
  async function selected(store: EditorStoreApi, n: number) {
    const notes = allNotes(store.getState().score!).filter(isNoteEvent).slice(0, n) as NoteEvent[];
    act(() => {
      store
        .getState()
        .setSelection({ eventIds: notes.map((x) => x.id), measureIds: [], trackIds: [] });
    });
    render(<Harness store={store} />);
    return { user: userEvent.setup(), notes };
  }

  const noteById = (store: EditorStoreApi, id: string) =>
    findEvent(store.getState().score!, id) as NoteEvent;

  it('Shift+F puts a fermata on the selection', async () => {
    const store = makeStore();
    const { user, notes } = await selected(store, 2);

    await user.keyboard('{Shift>}F{/Shift}');

    expect(noteById(store, notes[0].id).fermata).toBe(true);
  });

  it('Shift+G slides, and does NOT write a G note', async () => {
    // The reason these are handled above the entry block: `Shift+G` arrives as
    // "G", which letter entry would otherwise happily write as a note.
    const store = makeStore();
    const before = allNotes(store.getState().score!).length;
    const { user, notes } = await selected(store, 2);

    await user.keyboard('{Shift>}G{/Shift}');

    expect(allNotes(store.getState().score!).length).toBe(before);
    expect(noteById(store, notes[0].id).glissandoStart).toBe(true);
  });

  it('the wedge keys write the wedge they look like', async () => {
    const store = makeStore();
    const { user, notes } = await selected(store, 3);

    await user.keyboard('{Shift>}<{/Shift}');
    expect(noteById(store, notes[0].id).hairpinStart).toBe('crescendo');

    await user.keyboard('{Shift>}>{/Shift}');
    expect(noteById(store, notes[0].id).hairpinStart).toBe('diminuendo');
  });

  it('Shift+O brackets the selection an octave up', async () => {
    const store = makeStore();
    const { user, notes } = await selected(store, 2);

    await user.keyboard('{Shift>}O{/Shift}');

    expect(noteById(store, notes[0].id).ottavaStart).toBe('8va');
  });

  it('a bare letter still writes a note', async () => {
    // The shortcuts must not have swallowed note entry.
    const store = makeStore();
    render(<Harness store={store} />);
    const before = allNotes(store.getState().score!).length;

    await userEvent.setup().keyboard('g');

    expect(allNotes(store.getState().score!).length).toBeGreaterThan(before);
  });
});
