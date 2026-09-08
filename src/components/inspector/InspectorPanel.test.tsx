import { afterEach, describe, expect, it } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { twinkleScore, twoTrackScore } from '@sudobility/music_lib';
import {
  allNotes,
  changeClefCommand,
  changeDynamicCommand,
  barNumberAt,
  changeBarlineCommand,
  repeatPlayOrder,
  changeMeasureClefCommand,
  setPickupCommand,
  changeTrackPropsCommand,
  setChordSymbolCommand,
  toGraceNoteCommand,
} from '@sudobility/music_lib';
import type { NoteEvent } from '@sudobility/music_types';
import { dragSlider } from '@/test/drag-slider';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';
import type { EditorStoreApi } from '@sudobility/music_lib';

function makeStore(score: ReturnType<typeof twinkleScore> = twinkleScore()): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(score);
  return store;
}

afterEach(async () => {});

describe('InspectorPanel', () => {
  it('opens on the track tab, which always has something to show', () => {
    // Track is the first tab and the default: there is always an active track,
    // where the note and measure tabs are an empty-state message until you
    // select something. It is also the only place tracks are edited now.
    const store = makeStore();
    render(<InspectorPanel store={store} />);

    expect(screen.getByRole('tab', { name: 'Track', selected: true })).toBeInTheDocument();
  });

  it('still shows the note placeholder once that tab is chosen', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    render(<InspectorPanel store={store} />);

    await user.click(screen.getByRole('tab', { name: 'Note' }));
    expect(screen.getByText('Select a note to inspect its properties.')).toBeInTheDocument();
  });

  it('single note selection shows its concrete pitch/velocity values', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    render(<InspectorPanel store={store} />);

    // Library sweep 1: the native <select> becomes @sudobility/components'
    // Radix-backed Select. Its closed trigger only ever renders the
    // currently-selected item's own text (unlike a native <select>, whose
    // textContent concatenates every <option> regardless of selection), and
    // it isn't a form element `toHaveValue` supports (the trigger is a
    // <button role="combobox">, not an <input>/<select>) -- so the
    // faithful equivalent of "what's currently selected" is now the
    // trigger's rendered text.
    expect(screen.getByRole('combobox', { name: 'Pitch step' })).toHaveTextContent(note.pitch.step);
    expect(screen.getByLabelText('Velocity')).toHaveValue(note.velocity);
  });

  it('multi-note selection with differing pitches shows "Mixed" for pitch step, not a concrete value', () => {
    const store = makeStore();
    const notes = allNotes(store.getState().score!) as NoteEvent[];
    // twinkleScore's melody moves between different pitch steps across
    // its first few notes -- pick two with different steps.
    const a = notes[0];
    const b = notes.find((n) => n.pitch.step !== a.pitch.step) ?? notes[1];
    expect(a.pitch.step).not.toBe(b.pitch.step);

    store.getState().setSelection({ eventIds: [a.id, b.id], measureIds: [], trackIds: [] });
    render(<InspectorPanel store={store} />);

    // Library sweep 1: the native <select> becomes @sudobility/components'
    // Radix-backed Select. Its closed trigger renders only the SelectValue
    // for whichever item is actually selected (the popover's other options,
    // "Mixed" included, aren't in the DOM at all while closed) -- unlike a
    // native <select>'s textContent, which always concatenates every
    // <option> regardless of selection -- so toHaveTextContent is now the
    // faithful equivalent of the old selectedOptions[0] check.
    const select = screen.getByRole('combobox', { name: 'Pitch step' });
    expect(select).toHaveTextContent('Mixed');
  });

  it('editing a mixed field applies the same new value to every selected note', async () => {
    const store = makeStore();
    const notes = allNotes(store.getState().score!) as NoteEvent[];
    const a = notes[0];
    const b = notes.find((n) => n.velocity !== a.velocity || n.id !== a.id) ?? notes[1];

    store.getState().setSelection({ eventIds: [a.id, b.id], measureIds: [], trackIds: [] });
    render(<InspectorPanel store={store} />);
    const user = userEvent.setup();

    const velocityField = screen.getByLabelText('Velocity');
    await user.clear(velocityField);
    await user.type(velocityField, '99');
    await user.tab(); // blur commits

    const updatedA = allNotes(store.getState().score!).find((n) => n.id === a.id) as NoteEvent;
    const updatedB = allNotes(store.getState().score!).find((n) => n.id === b.id) as NoteEvent;
    expect(updatedA.velocity).toBe(99);
    expect(updatedB.velocity).toBe(99);
  });

  it('track tab follows the active track, not the selection', async () => {
    // It used to read `selection.trackIds`, which any click on a note or the
    // stave wipes — so the panel emptied the moment you touched the music you
    // were inspecting. The active track is sticky, so it does not.
    const store = makeStore(twoTrackScore());
    const [treble, bass] = store.getState().score!.tracks;
    expect(treble.clef).not.toBe(bass.clef);

    store.getState().setActiveTrack(bass.id);
    const user = userEvent.setup();
    render(<InspectorPanel store={store} />);
    // The panel opens on Note. Radix tabs act on pointer events, so a bare
    // fireEvent.click does not switch them — same as its Select.
    await user.click(screen.getByRole('tab', { name: 'Track' }));
    expect(screen.getByRole('combobox', { name: 'Track clef' })).toHaveTextContent(bass.clef);
  });

  it('keeps showing a track after the selection is cleared', async () => {
    // The whole point of the change.
    const store = makeStore(twoTrackScore());
    const [treble] = store.getState().score!.tracks;
    store.getState().setActiveTrack(treble.id);
    const user = userEvent.setup();
    render(<InspectorPanel store={store} />);

    // Clearing the selection sends the panel back to the Note tab, so the
    // real flow is: clear, then return to Track. That is exactly the case
    // that used to show "Select a track to inspect its properties".
    act(() => store.getState().clearSelection());
    await user.click(screen.getByRole('tab', { name: 'Track' }));
    expect(screen.getByRole('combobox', { name: 'Track clef' })).toHaveTextContent(treble.clef);
    expect(screen.queryByText(/Select a track to inspect/i)).toBeNull();
  });

  it('dragging the track-tab volume slider dispatches exactly one command, not one per drag tick', async () => {
    const store = makeStore(twoTrackScore());
    const track = store.getState().score!.tracks[0];
    const originalVolume = track.volume;
    store.getState().setSelection({ eventIds: [], measureIds: [], trackIds: [track.id] });
    render(<InspectorPanel store={store} />);

    const slider = screen.getByRole('slider', { name: 'Track volume' });
    dragSlider(slider, [10, 40, 70, 100, 150]);

    await waitFor(() => expect(store.getState().score!.tracks[0].volume).not.toBe(originalVolume));
    expect(store.getState().canUndo).toBe(true);

    store.getState().undo();

    expect(store.getState().score!.tracks[0].volume).toBe(originalVolume);
    // One undo fully restoring the original value proves exactly one
    // command was dispatched for the whole drag, not one per tick.
    expect(store.getState().canUndo).toBe(false);
  });

  it('dragging the track-tab pan slider dispatches exactly one command, not one per drag tick', async () => {
    const store = makeStore(twoTrackScore());
    const track = store.getState().score!.tracks[0];
    const originalPan = track.pan;
    store.getState().setSelection({ eventIds: [], measureIds: [], trackIds: [track.id] });
    render(<InspectorPanel store={store} />);

    const slider = screen.getByRole('slider', { name: 'Track pan' });
    dragSlider(slider, [10, 40, 70, 100, 150]);

    await waitFor(() => expect(store.getState().score!.tracks[0].pan).not.toBe(originalPan));
    expect(store.getState().canUndo).toBe(true);

    store.getState().undo();

    expect(store.getState().score!.tracks[0].pan).toBe(originalPan);
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('written-pitch display', () => {
  function clarinetStore() {
    const store = createAppStore({ context: testStoreContext() });
    const base = twinkleScore();
    store.getState().setScore({
      ...base,
      tracks: base.tracks.map((t) => ({ ...t, midiProgram: 71 })),
    });
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    return store;
  }

  const stepTrigger = () => screen.getByRole('combobox', { name: 'Pitch step' });

  it('reads out the sounding pitch in concert mode', () => {
    const store = clarinetStore();
    render(<InspectorPanel store={store} />);
    expect(stepTrigger()).toHaveTextContent('C');
  });

  it('reads out the written pitch in written mode', () => {
    // A clarinet sounding C reads D.
    const store = clarinetStore();
    store.getState().setPitchDisplay('written');
    render(<InspectorPanel store={store} />);
    expect(stepTrigger()).toHaveTextContent('D');
  });

  it('stores the sounding pitch when a written one is entered', async () => {
    // The input half of the lens: choose E in written mode, store D. Driven
    // through the real Radix control rather than by calling the handler,
    // because that is where an earlier select bug hid.
    const user = userEvent.setup();
    const store = clarinetStore();
    store.getState().setPitchDisplay('written');
    render(<InspectorPanel store={store} />);

    await user.click(stepTrigger());
    await user.click(screen.getByRole('option', { name: 'E' }));

    expect(allNotes(store.getState().score!)[0].pitch.step).toBe('D');
  });
});

/**
 * The track tab absorbed the panel that used to sit beside the keyboard, so
 * what those tests covered is covered here now: choosing an instrument,
 * deleting a track, and the two mixer controls.
 */
describe('InspectorPanel: the track tab', () => {
  it('sets the program and the name together when an instrument is chosen', async () => {
    // The two have to move as one or the label drifts from the sound — which
    // is why the field is a picker over the catalogue rather than a text box.
    const user = userEvent.setup();
    const store = makeStore();
    render(<InspectorPanel store={store} />);

    await user.click(screen.getByRole('button', { name: 'Instrument' }));
    await user.click(screen.getByRole('option', { name: 'Violin' }));

    const track = store.getState().score!.tracks[0];
    expect(track.midiProgram).toBe(40);
    expect(track.instrumentName).toBe('Violin');
  });

  it('offers drum kits, not instruments, on a percussion track', async () => {
    // Program 40 is Violin *and* the Brush kit; a percussion track addresses
    // the kit table, so the melodic catalogue would name the wrong thing.
    const user = userEvent.setup();
    const store = makeStore();
    const trackId = store.getState().score!.tracks[0].id;
    act(() => {
      store.getState().dispatchCommand(changeClefCommand(trackId, 'percussion', 'Change clef'));
    });
    render(<InspectorPanel store={store} />);

    // The options are prefixed (`kit:0`), so a bare program number matches
    // nothing and the control renders empty while still selecting fine — the
    // reason this asserts what it *shows* and not only what it sets.
    const trigger = screen.getByRole('button', { name: /^Drum kit: / });
    expect(trigger).toHaveTextContent('Standard Kit');

    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'Jazz Kit' }));

    const track = store.getState().score!.tracks[0];
    expect(track.instrumentName).toBe('Jazz Kit');
  });

  it('deletes the track once the confirmation is accepted', async () => {
    const user = userEvent.setup();
    const store = makeStore(twoTrackScore());
    const [first, second] = store.getState().score!.tracks;
    render(<InspectorPanel store={store} />);

    await user.click(screen.getByRole('button', { name: 'Delete track' }));
    await user.click(screen.getAllByRole('button', { name: 'Delete track' }).at(-1)!);

    await waitFor(() => {
      expect(store.getState().score!.tracks.map((t) => t.id)).toEqual([second.id]);
    });
    expect(first).toBeDefined();
  });

  it('leaves the score alone when the confirmation is dismissed', async () => {
    const user = userEvent.setup();
    const store = makeStore(twoTrackScore());
    render(<InspectorPanel store={store} />);

    await user.click(screen.getByRole('button', { name: 'Delete track' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(store.getState().score!.tracks).toHaveLength(2);
  });

  it('refuses to delete the last track', () => {
    // A score with no tracks renders nothing and the editor has no empty
    // state for it, so the floor is one.
    const store = makeStore();
    render(<InspectorPanel store={store} />);

    expect(screen.getByRole('button', { name: 'Delete track' })).toBeDisabled();
  });

  it('reads pan out as a side and a distance, not a number', () => {
    const store = makeStore();
    act(() => {
      store
        .getState()
        .dispatchCommand(
          changeTrackPropsCommand(store.getState().score!.tracks[0].id, { pan: -0.4 }, 'Pan'),
        );
    });
    render(<InspectorPanel store={store} />);

    expect(screen.getByText('L40')).toBeInTheDocument();
  });

  it('commits a rename on blur, not on every keystroke', async () => {
    // A command per character would put one undo entry on the history per
    // character, which makes undo useless for anything else you did.
    const user = userEvent.setup();
    const store = makeStore();
    render(<InspectorPanel store={store} />);

    const field = screen.getByLabelText('Name');
    await user.clear(field);
    await user.type(field, 'Lead');
    expect(store.getState().score!.tracks[0].name).not.toBe('Lead');

    await user.tab();
    expect(store.getState().score!.tracks[0].name).toBe('Lead');
  });

  it('says why an instrument the part cannot fit was refused', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    act(() => {
      const score = store.getState().score!;
      // A part spanning five octaves fits no narrow instrument, so the change
      // is refused outright rather than half-applied.
      store.getState().setScore({
        ...score,
        tracks: score.tracks.map((track) => ({
          ...track,
          measures: track.measures.map((measure, index) =>
            index !== 0
              ? measure
              : {
                  ...measure,
                  voices: measure.voices.map((voice) => ({
                    ...voice,
                    events: voice.events.map((event, position) =>
                      position === 0 && 'pitch' in event
                        ? { ...event, pitch: { ...event.pitch, octave: 0 } }
                        : event,
                    ),
                  })),
                },
          ),
        })),
      });
    });
    render(<InspectorPanel store={store} />);

    await user.click(screen.getByRole('button', { name: 'Instrument' }));
    await user.click(screen.getByRole('option', { name: 'Piccolo' }));

    await waitFor(() => {
      expect(store.getState().toasts.at(-1)?.severity).toBe('error');
    });
    expect(store.getState().score!.tracks[0].midiProgram).not.toBe(72);
  });

  it('disables content editing while the transport plays, but not mixing', () => {
    // Mixing while listening is the point; the edit lock refuses the rest, so
    // those controls say so rather than looking live and doing nothing.
    const store = makeStore(twoTrackScore());
    act(() => {
      store.setState({ state: 'playing' });
    });
    render(<InspectorPanel store={store} />);

    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Instrument' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete track' })).toBeDisabled();
    expect(screen.getByLabelText('Track volume')).toBeEnabled();
    expect(screen.getByLabelText('Track pan')).toBeEnabled();
  });

  it('centres the pan through the store, not as NaN', async () => {
    // The reset button lives inside the wrapper that commits on pointer-up.
    // Reading `.value` off it would give `undefined`, and `Number(undefined)`
    // is NaN — which would reach the track as its pan.
    const user = userEvent.setup();
    const store = makeStore();
    act(() => {
      store
        .getState()
        .dispatchCommand(
          changeTrackPropsCommand(store.getState().score!.tracks[0].id, { pan: -0.6 }, 'Pan'),
        );
    });
    render(<InspectorPanel store={store} />);

    await user.click(screen.getByRole('button', { name: 'Center pan' }));

    const pan = store.getState().score!.tracks[0].pan;
    expect(pan).toBe(0);
    expect(Number.isNaN(pan)).toBe(false);
  });
});

describe('InspectorPanel: dynamics', () => {
  it('marks the selected note, and says the marking runs from here', async () => {
    // A dynamic is set on the note a level begins at, not on every note in
    // the passage — the hint is what tells the reader that.
    const user = userEvent.setup();
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    act(() => {
      store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    });
    render(<InspectorPanel store={store} />);

    await user.click(screen.getByRole('combobox', { name: 'Dynamic' }));
    await user.click(screen.getByRole('option', { name: 'ff' }));

    const updated = allNotes(store.getState().score!).find((n) => n.id === note.id) as NoteEvent;
    expect(updated.dynamic).toBe('ff');
    expect(screen.getByText(/until the next marking/i)).toBeInTheDocument();
  });

  it('clears the marking again', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    act(() => {
      store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
      store.getState().dispatchCommand(changeDynamicCommand([note.id], 'pp', 'Dynamic'));
    });
    render(<InspectorPanel store={store} />);

    await user.click(screen.getByRole('combobox', { name: 'Dynamic' }));
    await user.click(screen.getByRole('option', { name: 'None' }));

    const updated = allNotes(store.getState().score!).find((n) => n.id === note.id) as NoteEvent;
    expect(updated.dynamic).toBeUndefined();
  });
});

describe('InspectorPanel: grace notes', () => {
  it('turns the selected note into an ornament on the next one', async () => {
    // The bar still adds up afterwards: the note leaves a rest behind, which
    // is why grace notes hang off their principal instead of being events.
    const user = userEvent.setup();
    const store = makeStore();
    const voice = store.getState().score!.tracks[0].measures[0].voices[0];
    const before = voice.events.reduce((sum, e) => sum + e.durationTicks, 0);
    const [first, second] = voice.events.filter((e) => 'pitch' in e) as NoteEvent[];
    act(() => {
      store.getState().setSelection({ eventIds: [first.id], measureIds: [], trackIds: [] });
    });
    render(<InspectorPanel store={store} />);

    await user.click(screen.getByRole('button', { name: /grace note of the next/i }));

    const after = store.getState().score!.tracks[0].measures[0].voices[0];
    const principal = after.events.find((e) => e.id === second.id) as NoteEvent;
    expect(principal.graceNotes).toHaveLength(1);
    expect(after.events.reduce((sum, e) => sum + e.durationTicks, 0)).toBe(before);
  });

  it('offers removal only once a note carries one', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    const voice = store.getState().score!.tracks[0].measures[0].voices[0];
    const [first, second] = voice.events.filter((e) => 'pitch' in e) as NoteEvent[];
    act(() => {
      store.getState().setSelection({ eventIds: [second.id], measureIds: [], trackIds: [] });
    });
    const view = render(<InspectorPanel store={store} />);

    expect(screen.queryByRole('button', { name: /remove .* grace/i })).not.toBeInTheDocument();

    act(() => {
      store.getState().dispatchCommand(toGraceNoteCommand(first.id, 'Grace'));
    });
    view.rerender(<InspectorPanel store={store} />);

    await user.click(screen.getByRole('button', { name: /remove 1 grace note/i }));

    const principal = store
      .getState()
      .score!.tracks[0].measures[0].voices[0].events.find((e) => e.id === second.id) as NoteEvent;
    expect(principal.graceNotes).toBeUndefined();
  });
});

describe('InspectorPanel: chord symbols', () => {
  it('writes what the player typed, whatever dialect it is in', async () => {
    // A lead sheet's vocabulary is wider than any picker could offer, so the
    // field is free text and nothing is rewritten.
    const user = userEvent.setup();
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    act(() => {
      store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    });
    render(<InspectorPanel store={store} />);

    const field = screen.getByLabelText('Chord symbol');
    await user.type(field, 'Bb7#11');
    await user.tab();

    const updated = allNotes(store.getState().score!).find((n) => n.id === note.id) as NoteEvent;
    expect(updated.chordSymbol).toBe('Bb7#11');
  });

  it('commits on blur, not per keystroke', async () => {
    // Otherwise "Cmaj7(add13)" is eleven undo entries.
    const user = userEvent.setup();
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    act(() => {
      store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    });
    render(<InspectorPanel store={store} />);

    await user.type(screen.getByLabelText('Chord symbol'), 'Am7');
    const midway = allNotes(store.getState().score!).find((n) => n.id === note.id) as NoteEvent;
    expect(midway.chordSymbol).toBeUndefined();

    await user.tab();
    const after = allNotes(store.getState().score!).find((n) => n.id === note.id) as NoteEvent;
    expect(after.chordSymbol).toBe('Am7');
  });

  it('clears the symbol when the field is emptied', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    act(() => {
      store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
      store.getState().dispatchCommand(setChordSymbolCommand(note.id, 'G7', 'Chord'));
    });
    render(<InspectorPanel store={store} />);

    await user.clear(screen.getByLabelText('Chord symbol'));
    await user.tab();

    const after = allNotes(store.getState().score!).find((n) => n.id === note.id) as NoteEvent;
    expect(after.chordSymbol).toBeUndefined();
  });
});

describe('the measure clef field', () => {
  /** Selects `index` on the first track and opens the Measure tab. */
  async function openMeasure(store: EditorStoreApi, index: number) {
    const user = userEvent.setup();
    const measure = store.getState().score!.tracks[0].measures[index];
    act(() => {
      store.getState().setSelection({ eventIds: [], measureIds: [measure.id], trackIds: [] });
    });
    render(<InspectorPanel store={store} />);
    await user.click(screen.getByRole('tab', { name: 'Bar' }));
    return { user, measure };
  }

  it('shows the clef in force rather than a blank, on a bar that sets none', async () => {
    // The same rule the tempo field follows: never blank, never a lie.
    const store = makeStore();
    await openMeasure(store, 1);

    expect(screen.getByLabelText('Clef from here')).toHaveTextContent(/Inherit \(treble\)/);
  });

  it('writes a clef change onto the selected bar', async () => {
    const store = makeStore();
    const { user } = await openMeasure(store, 1);

    await user.click(screen.getByLabelText('Clef from here'));
    await user.click(await screen.findByRole('option', { name: 'bass' }));

    await waitFor(() => {
      expect(store.getState().score!.tracks[0].measures[1].clef).toBe('bass');
    });
    // And only that bar — the change is a boundary, not a property of a span.
    expect(store.getState().score!.tracks[0].measures[2].clef).toBeUndefined();
  });

  it('offers Inherit to clear a change, and clearing restores the previous clef', async () => {
    const store = makeStore();
    const trackId = store.getState().score!.tracks[0].id;
    act(() => {
      store.getState().dispatchCommand(changeMeasureClefCommand(trackId, 1, 'bass', 'Clef'));
    });
    const { user } = await openMeasure(store, 1);

    await user.click(screen.getByLabelText('Clef from here'));
    await user.click(await screen.findByRole('option', { name: /Inherit/ }));

    await waitFor(() => {
      expect(store.getState().score!.tracks[0].measures[1].clef).toBeUndefined();
    });
  });

  it('edits the part clef on bar 1, where a clef is established rather than changed', async () => {
    // Bar 1 offers no Inherit: there is nothing before it to inherit from.
    const store = makeStore();
    const { user } = await openMeasure(store, 0);

    expect(screen.queryByRole('option', { name: /Inherit/ })).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Clef from here'));
    await user.click(await screen.findByRole('option', { name: 'bass' }));

    await waitFor(() => {
      expect(store.getState().score!.tracks[0].clef).toBe('bass');
    });
    expect(store.getState().score!.tracks[0].measures[0].clef).toBeUndefined();
  });
});

describe('the pickup field', () => {
  async function openFirstMeasure(store: EditorStoreApi) {
    const user = userEvent.setup();
    const measure = store.getState().score!.tracks[0].measures[0];
    act(() => {
      store.getState().setSelection({ eventIds: [], measureIds: [measure.id], trackIds: [] });
    });
    render(<InspectorPanel store={store} />);
    await user.click(screen.getByRole('tab', { name: 'Bar' }));
    return user;
  }

  it('reads None on a score that opens with a full bar', async () => {
    const store = makeStore();
    await openFirstMeasure(store);
    expect(screen.getByLabelText('Pickup bar')).toHaveTextContent('None');
  });

  it('shortens the first bar and stops it being counted as bar 1', async () => {
    const store = makeStore();
    const user = await openFirstMeasure(store);

    await user.click(screen.getByLabelText('Pickup bar'));
    await user.click(await screen.findByRole('option', { name: '1 beat' }));

    await waitFor(() => {
      expect(store.getState().score!.tracks[0].measures[0].pickup).toBe(true);
    });
    const measures = store.getState().score!.tracks[0].measures;
    expect(measures[0].durationTicks).toBeLessThan(measures[1].durationTicks);
    // The visible consequence: the next bar is bar 1.
    expect(barNumberAt(measures, 0)).toBeNull();
    expect(barNumberAt(measures, 1)).toBe(1);
  });

  it('applies to every track, since the measure grid is shared', async () => {
    const store = makeStore(twoTrackScore());
    const user = await openFirstMeasure(store);

    await user.click(screen.getByLabelText('Pickup bar'));
    await user.click(await screen.findByRole('option', { name: '1 beat' }));

    await waitFor(() => {
      expect(store.getState().score!.tracks[0].measures[0].pickup).toBe(true);
    });
    expect(store.getState().score!.tracks[1].measures[0].pickup).toBe(true);
    expect(store.getState().score!.tracks[1].measures[0].durationTicks).toBe(
      store.getState().score!.tracks[0].measures[0].durationTicks,
    );
  });

  it('restores a full bar when set back to None', async () => {
    const store = makeStore();
    act(() => {
      store.getState().dispatchCommand(setPickupCommand(1, 'Pickup'));
    });
    const user = await openFirstMeasure(store);

    await user.click(screen.getByLabelText('Pickup bar'));
    await user.click(await screen.findByRole('option', { name: 'None' }));

    await waitFor(() => {
      expect(store.getState().score!.tracks[0].measures[0].pickup).toBeUndefined();
    });
    const measures = store.getState().score!.tracks[0].measures;
    expect(measures[0].durationTicks).toBe(measures[1].durationTicks);
  });
});

describe('the barline field', () => {
  async function openMeasure(store: EditorStoreApi, index: number) {
    const user = userEvent.setup();
    const measure = store.getState().score!.tracks[0].measures[index];
    act(() => {
      store.getState().setSelection({ eventIds: [], measureIds: [measure.id], trackIds: [] });
    });
    render(<InspectorPanel store={store} />);
    await user.click(screen.getByRole('tab', { name: 'Bar' }));
    return user;
  }

  it('reads Single on an ordinary bar', async () => {
    const store = makeStore();
    await openMeasure(store, 0);
    expect(screen.getByLabelText('Barline')).toHaveTextContent('Single');
  });

  it('writes a final barline onto the selected bar only', async () => {
    const store = makeStore();
    const user = await openMeasure(store, 1);

    await user.click(screen.getByLabelText('Barline'));
    await user.click(await screen.findByRole('option', { name: 'Final' }));

    await waitFor(() => {
      expect(store.getState().score!.tracks[0].measures[1].barline).toBe('final');
    });
    expect(store.getState().score!.tracks[0].measures[0].barline).toBeUndefined();
  });

  it('applies across every track, since the parts must agree', async () => {
    const store = makeStore(twoTrackScore());
    const user = await openMeasure(store, 0);

    await user.click(screen.getByLabelText('Barline'));
    await user.click(await screen.findByRole('option', { name: 'Double' }));

    await waitFor(() => {
      expect(store.getState().score!.tracks[0].measures[0].barline).toBe('double');
    });
    expect(store.getState().score!.tracks[1].measures[0].barline).toBe('double');
  });

  it('restores the ordinary barline when set back to Single', async () => {
    const store = makeStore();
    act(() => {
      store.getState().dispatchCommand(changeBarlineCommand(0, 'final', 'Barline'));
    });
    const user = await openMeasure(store, 0);

    await user.click(screen.getByLabelText('Barline'));
    await user.click(await screen.findByRole('option', { name: 'Single' }));

    await waitFor(() => {
      expect(store.getState().score!.tracks[0].measures[0].barline).toBeUndefined();
    });
  });
});

describe('the navigation fields', () => {
  async function openMeasure(store: EditorStoreApi, index: number) {
    const user = userEvent.setup();
    const measure = store.getState().score!.tracks[0].measures[index];
    act(() => {
      store.getState().setSelection({ eventIds: [], measureIds: [measure.id], trackIds: [] });
    });
    render(<InspectorPanel store={store} />);
    await user.click(screen.getByRole('tab', { name: 'Bar' }));
    return user;
  }

  it('marks the segno on the selected bar', async () => {
    const store = makeStore();
    const user = await openMeasure(store, 1);

    await user.click(screen.getByLabelText('Segno'));

    await waitFor(() => {
      expect(store.getState().score!.tracks[0].measures[1].segno).toBe(true);
    });
    expect(store.getState().score!.tracks[0].measures[0].segno).toBeUndefined();
  });

  it('keeps the marks independent — setting one does not clear another', async () => {
    // A bar can carry the coda sign and a Fine at once.
    const store = makeStore();
    const user = await openMeasure(store, 1);

    // Fine first, then Coda: setting the *second* mark is what could clear
    // the first, so this order is the one that actually tests independence.
    await user.click(screen.getByLabelText('Fine'));
    await waitFor(() => {
      expect(store.getState().score!.tracks[0].measures[1].fine).toBe(true);
    });

    await user.click(screen.getByLabelText('Coda'));
    await waitFor(() => {
      expect(store.getState().score!.tracks[0].measures[1].coda).toBe(true);
    });
    expect(store.getState().score!.tracks[0].measures[1].fine).toBe(true);
  });

  it('sets a jump and changes the performed order', async () => {
    const store = makeStore();
    const user = await openMeasure(store, 1);

    await user.click(screen.getByLabelText('Jump'));
    await user.click(await screen.findByRole('option', { name: 'D.C.' }));

    await waitFor(() => {
      expect(store.getState().score!.tracks[0].measures[1].jump).toBe('da-capo');
    });
    // The point of the mark: the piece is now performed differently.
    const order = repeatPlayOrder(store.getState().score!).map((p) => p.measureIndex);
    expect(order.length).toBeGreaterThan(store.getState().score!.tracks[0].measures.length);
  });

  it('applies across every track, so the parts navigate alike', async () => {
    const store = makeStore(twoTrackScore());
    const user = await openMeasure(store, 0);

    await user.click(screen.getByLabelText('Segno'));

    await waitFor(() => {
      expect(store.getState().score!.tracks[0].measures[0].segno).toBe(true);
    });
    expect(store.getState().score!.tracks[1].measures[0].segno).toBe(true);
  });
});
