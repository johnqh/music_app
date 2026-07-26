import { afterEach, describe, expect, it } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { twinkleScore, twoTrackScore } from '@sudobility/music_lib';
import { allNotes } from '@sudobility/music_lib';
import type { NoteEvent } from '@sudobility/music_types';
import { dragSlider } from '@/test/drag-slider';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';
import type { EditorStoreApi } from '@/features/score-editor/editing';

function makeStore(score: ReturnType<typeof twinkleScore> = twinkleScore()): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(score);
  return store;
}

afterEach(async () => {});

describe('InspectorPanel', () => {
  it('shows a placeholder when nothing is selected', () => {
    const store = makeStore();
    render(<InspectorPanel store={store} />);

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

  it('track tab shows "Mixed" when selected tracks have different clefs, and a single track shows its concrete clef', () => {
    const store = makeStore(twoTrackScore());
    const [treble, bass] = store.getState().score!.tracks;
    expect(treble.clef).not.toBe(bass.clef);

    store.getState().setSelection({ eventIds: [], measureIds: [], trackIds: [treble.id, bass.id] });
    render(<InspectorPanel store={store} />);

    // Same Radix-Select equivalence as the pitch-step "Mixed" case above.
    const select = screen.getByRole('combobox', { name: 'Track clef' });
    expect(select).toHaveTextContent('Mixed');
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
