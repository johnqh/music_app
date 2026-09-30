import { commandLabel } from '@/app-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@/app-library';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@/app-library';
import { twinkleScore, twoTrackScore } from '@/app-library';
import { allNotes, findEvent } from '@/app-library';
import { addMeasureCommand, deleteMeasureCommand } from '@/app-library';
import type { NoteEvent } from '@sudobility/music_types';
import { getMusicPosition } from '@sudobility/music_types';
import { EditorToolbar } from '@/features/score-editor/EditorToolbar';
import type { EditorStoreApi } from '@/app-library';

function makeStore(withScore = true): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  if (withScore) store.getState().setScore(twinkleScore());
  return store;
}

afterEach(async () => {});

function renderToolbar(
  store: EditorStoreApi,
  layoutModeOrOverrides:
    'page' | 'continuous' | Partial<React.ComponentProps<typeof EditorToolbar>> = 'page',
) {
  const overrides =
    typeof layoutModeOrOverrides === 'string'
      ? { layoutMode: layoutModeOrOverrides }
      : layoutModeOrOverrides;
  const onLayoutModeChange = vi.fn();
  render(
    <EditorToolbar
      store={store}
      layoutMode="page"
      onLayoutModeChange={onLayoutModeChange}
      {...overrides}
    />,
  );
  return { onLayoutModeChange };
}

/** Opens the overflow menu and picks one of its items. */
async function chooseMoreAction(label: string) {
  await userEvent.click(screen.getByLabelText('More actions'));
  await userEvent.click(screen.getByRole('option', { name: label }));
}

/** Same render, but handing back the container so the DOM can be swept. */
function renderToolbarContainer(store: EditorStoreApi) {
  const onLayoutModeChange = vi.fn();
  return render(
    <EditorToolbar store={store} layoutMode="page" onLayoutModeChange={onLayoutModeChange} />,
  );
}

describe('EditorToolbar', () => {
  it('duration change dispatches changeDurationCommand for the selected note', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    renderToolbar(store);
    const user = userEvent.setup();

    // One control now, not six toggles: open it and pick.
    await user.click(screen.getByLabelText('Note duration'));
    await user.click(await screen.findByRole('option', { name: /Eighth/ }));

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.durationTicks).toBe(store.getState().score!.ppq / 2);
    expect(store.getState().canUndo).toBe(true);
    expect(store.getState().snapGrid).toBe('eighth');
  });

  it('duration change updates snapGrid even with nothing selected, without dispatching a command', async () => {
    const store = makeStore();
    renderToolbar(store);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Note duration'));
    await user.click(await screen.findByRole('option', { name: /16th/ }));

    expect(store.getState().snapGrid).toBe('sixteenth');
    expect(store.getState().canUndo).toBe(false);
  });

  it('shows the armed length when nothing is selected, and the note\u2019s own when one is', async () => {
    // The control answers a different question depending on the selection:
    // an instruction about the next note, or a readout of the current one.
    const store = makeStore();
    store.getState().setSnapGrid('whole');
    renderToolbar(store);
    const trigger = screen.getByLabelText('Note duration');
    // Nothing selected: the armed value.
    expect(within(trigger).getByTestId('duration-glyph')).toHaveAttribute('data-duration', 'whole');

    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    await act(async () => {
      store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    });

    // One selected: that note is a quarter, whatever is armed.
    expect(within(trigger).getByTestId('duration-glyph')).toHaveAttribute(
      'data-duration',
      'quarter',
    );
  });

  it('shows \u2026 when the selected notes are different lengths', async () => {
    // Not the first note's value and not the armed one: either would claim the
    // selection is something it is not, and re-picking it would look like a
    // no-op while rewriting every other note.
    const store = makeStore();
    const notes = allNotes(store.getState().score!) as NoteEvent[];
    const store2 = store;
    act(() => {
      store2.getState().setSelection({ eventIds: [notes[0].id], measureIds: [], trackIds: [] });
    });
    renderToolbar(store);
    const user = userEvent.setup();
    // Make the first note an eighth, then select it together with a quarter.
    await user.click(screen.getByLabelText('Note duration'));
    await user.click(await screen.findByRole('option', { name: /Eighth/ }));
    await act(async () => {
      store2.getState().setSelection({
        eventIds: [notes[0].id, notes[1].id],
        measureIds: [],
        trackIds: [],
      });
    });

    const trigger = screen.getByLabelText('Note duration');
    expect(within(trigger).queryByTestId('duration-glyph')).toBeNull();
    expect(trigger).toHaveTextContent('\u2026');
  });

  it('changes every selected note when one is picked, however many disagree', async () => {
    const store = makeStore();
    const notes = allNotes(store.getState().score!) as NoteEvent[];
    const ids = [notes[0].id, notes[1].id, notes[2].id];
    act(() => {
      store.getState().setSelection({ eventIds: ids, measureIds: [], trackIds: [] });
    });
    renderToolbar(store);
    const user = userEvent.setup();

    // Shorter, not longer: three quarters cannot all become halves inside one
    // 4/4 bar, and reflow would legitimately refuse — which would be a test
    // about measure capacity, not about the control reaching every note.
    await user.click(screen.getByLabelText('Note duration'));
    await user.click(await screen.findByRole('option', { name: /Eighth/ }));

    const ppq = store.getState().score!.ppq;
    for (const id of ids) {
      const updated = findEvent(store.getState().score!, id) as NoteEvent;
      expect(updated.durationTicks, id).toBe(ppq / 2);
    }
  });

  it('accidental button dispatches changeAccidentalCommand for the selected note', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    renderToolbar(store);
    const user = userEvent.setup();

    // Accidentals are one picker now, not five buttons.
    await user.click(screen.getByLabelText('Accidental'));
    await user.click(screen.getByRole('option', { name: 'Sharp' }));

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.pitch.accidental).toBe(1);
  });

  it('articulation picker dispatches changeArticulationCommand', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    renderToolbar(store);
    const user = userEvent.setup();

    // A Select now, not a hand-rolled menu: its content is portalled, which is
    // what stopped the toolbar's horizontal overflow clipping the options away.
    await user.click(screen.getByRole('combobox', { name: 'Articulation' }));
    await user.click(await screen.findByRole('option', { name: 'Staccato' }));

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.articulation).toBe('staccato');
  });

  it('tie toggle dispatches toggleTieCommand', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    renderToolbar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle tie' }));

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.tieStart).toBe(true);
  });

  it('insert note dispatches an undoable add-note command at middle C when nothing is selected', async () => {
    // twinkleScore's very first note is already a C4 quarter at tick 0, so
    // inserting another C4 quarter there lands exactly on top of it
    // (reflowVoice's replace-on-overlap rule swaps it in-place rather than
    // strictly growing the note count) — assert the command ran rather than
    // a specific count delta, matching duplicateSelected's test above.
    const store = makeStore();
    const before = store.getState().score;
    renderToolbar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Insert note' }));

    expect(store.getState().score).not.toBe(before);
    expect(store.getState().canUndo).toBe(true);
  });

  it('insert note steps the caret past what it wrote, so a second press continues the line', async () => {
    // A product decision both apps share: the web bar used to leave the caret
    // on the note, so pressing Insert Note twice stacked the second onto the
    // first instead of writing the next note of the line.
    const store = makeStore();
    renderToolbar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Insert note' }));

    expect(getMusicPosition().reportedTick).toBe(store.getState().score!.ppq);
  });

  it('insert rest deletes the selected note', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    renderToolbar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Insert rest' }));

    expect(findEvent(store.getState().score!, note.id)).toBeNull();
  });

  it('select all selects every note', async () => {
    const store = makeStore();
    renderToolbar(store);

    await chooseMoreAction('Select all notes');

    const allIds = allNotes(store.getState().score!).map((n) => n.id);
    expect(new Set(store.getState().selection.eventIds)).toEqual(new Set(allIds));
  });

  it('quantize dispatches a quantize command for the selected note', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    renderToolbar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Quantize' }));

    expect(store.getState().canUndo).toBe(true);
  });

  it('zoom in/out buttons change the store zoom level', async () => {
    const store = makeStore();
    renderToolbar(store);
    const user = userEvent.setup();

    const initialZoom = store.getState().zoom;
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(store.getState().zoom).toBeGreaterThan(initialZoom);

    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(store.getState().zoom).toBeLessThan(initialZoom);
  });

  it('layout mode toggle calls onLayoutModeChange', async () => {
    const store = makeStore();
    const { onLayoutModeChange } = renderToolbar(store, 'page');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Continuous layout' }));

    expect(onLayoutModeChange).toHaveBeenCalledWith('continuous');
  });

  it('switches the track info column between the whole thing and the icons alone', async () => {
    const store = makeStore();
    renderToolbar(store);
    const user = userEvent.setup();

    // The whole column until somebody says otherwise; the label names what
    // clicking does.
    const toIcons = screen.getByRole('button', { name: 'Instrument icons only' });
    expect(toIcons).toHaveAttribute('aria-pressed', 'false');
    await user.click(toIcons);
    expect(store.getState().trackInfo).toBe('icon');

    const toFull = screen.getByRole('button', { name: 'Full track info' });
    expect(toFull).toHaveAttribute('aria-pressed', 'true');
    await user.click(toFull);
    expect(store.getState().trackInfo).toBe('full');
  });

  it('has no view switch: notation and piano roll are shown at the same time', () => {
    renderToolbar(makeStore());
    expect(screen.queryByRole('group', { name: 'Editor view' })).not.toBeInTheDocument();
  });

  it('disables editing controls when no score is loaded', () => {
    const store = makeStore(false);
    renderToolbar(store);

    expect(screen.getByRole('button', { name: 'Insert note' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quantize' })).toBeDisabled();
    expect(screen.getByLabelText('Accidental')).toBeDisabled();
  });

  it('every control has a tooltip, so nothing on the bar is unexplained', () => {
    // The toolbar is dense and mostly glyphs; a control whose only explanation
    // is its icon is a control most people will not find.
    const store = makeStore();
    renderToolbar(store);
    const toolbar = screen.getByRole('toolbar');

    for (const button of within(toolbar).getAllByRole('button')) {
      // Tooltip wraps its trigger in a positioned element; a bare control has
      // the toolbar's own group as its parent instead.
      const wrapper = button.parentElement;
      expect(wrapper?.className, button.getAttribute('aria-label') ?? '').toContain('relative');
    }
  });

  it('every interactive control has an accessible name', () => {
    const store = makeStore();
    renderToolbar(store);
    const toolbar = screen.getByRole('toolbar');
    const buttons = within(toolbar).getAllByRole('button');
    for (const button of buttons) {
      expect(button).toHaveAccessibleName();
    }
  });
});

describe('inspector toggle', () => {
  it('is not rendered when no handler is given, so the view works standalone', () => {
    renderToolbar(makeStore());
    expect(
      screen.queryByRole('button', { name: 'Toggle inspector panel' }),
    ).not.toBeInTheDocument();
  });

  it('calls the handler and reflects the current state', async () => {
    const onToggleInspector = vi.fn();
    renderToolbar(makeStore(), { inspectorOpen: true, onToggleInspector });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Toggle inspector panel' }));

    expect(onToggleInspector).toHaveBeenCalledTimes(1);
  });

  it('sits outside the scrolling tool group, so it stays reachable on a narrow window', () => {
    // Inside the scroller the flex spacer collapses once the tools overflow and
    // the button lands past the right edge, reachable only by scrolling.
    renderToolbar(makeStore(), { inspectorOpen: true, onToggleInspector: vi.fn() });
    const toggle = screen.getByRole('button', { name: 'Toggle inspector panel' });
    expect(screen.getByRole('toolbar').contains(toggle)).toBe(false);
  });
});

describe('edit mode control', () => {
  it('shows replace as the active mode by default', () => {
    const store = makeStore();
    renderToolbar(store);
    expect(screen.getByLabelText('Replace mode')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Insert mode')).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches mode', async () => {
    const store = makeStore();
    renderToolbar(store);

    await userEvent.click(screen.getByLabelText('Insert mode'));
    expect(store.getState().editMode).toBe('insert');
    expect(screen.getByLabelText('Insert mode')).toHaveAttribute('aria-pressed', 'true');
  });

  it('disables stack on a monophonic instrument', () => {
    // Offering a mode that would refuse every edit is worse than not offering
    // it: the refusal only shows up after you have tried to play something.
    const store = makeStore();
    const score = store.getState().score!;
    store.getState().setScore({
      ...score,
      tracks: score.tracks.map((t) => ({ ...t, midiProgram: 56, instrumentName: 'Trumpet' })),
    });
    renderToolbar(store);

    expect(screen.getByLabelText('Stack mode')).toBeDisabled();
    expect(screen.getByLabelText('Replace mode')).toBeEnabled();
  });

  it('leaves stack available on a polyphonic instrument', () => {
    const store = makeStore();
    const score = store.getState().score!;
    store.getState().setScore({
      ...score,
      tracks: score.tracks.map((t) => ({ ...t, midiProgram: 0, instrumentName: 'Piano' })),
    });
    renderToolbar(store);

    expect(screen.getByLabelText('Stack mode')).toBeEnabled();
  });

  it('shows replace when the active track cannot play chords, leaving the stored choice alone', () => {
    // The mode is set before the track changes. The bar shows the mode a write
    // will actually use — every write reads `selectEffectiveEditMode` — while
    // the stored choice stays the person's, so a piano gives stack back.
    const store = makeStore();
    store.getState().setEditMode('stack');
    const score = store.getState().score!;
    store.getState().setScore({
      ...score,
      tracks: score.tracks.map((t) => ({ ...t, midiProgram: 56, instrumentName: 'Trumpet' })),
    });
    renderToolbar(store);

    expect(screen.getByLabelText('Stack mode')).toBeDisabled();
    expect(screen.getByLabelText('Stack mode')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Replace mode')).toHaveAttribute('aria-pressed', 'true');
    expect(store.getState().editMode).toBe('stack');
  });
});

describe('duration modifiers', () => {
  it('a plain duration shows neither modifier pressed', () => {
    const store = makeStore();
    store.getState().setSnapGrid('quarter');
    renderToolbar(store);
    expect(screen.getByLabelText('Dotted')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Triplet')).toHaveAttribute('aria-pressed', 'false');
  });

  it('dotting keeps the note value and lengthens it', async () => {
    const store = makeStore();
    store.getState().setSnapGrid('quarter');
    renderToolbar(store);

    await userEvent.click(screen.getByLabelText('Dotted'));

    expect(store.getState().snapGrid).toBe('dotted-quarter');
    // Still a quarter as far as the duration control is concerned: the
    // modifier is a separate axis and the two must not collapse into one.
    expect(screen.getByLabelText('Note duration')).toBeInTheDocument();
    expect(store.getState().snapGrid).toContain('quarter');
  });

  it('changing the note value keeps the modifier', async () => {
    const store = makeStore();
    store.getState().setSnapGrid('dotted-quarter');
    renderToolbar(store);

    await userEvent.click(screen.getByLabelText('Note duration'));
    await userEvent.click(await screen.findByRole('option', { name: /Eighth/ }));

    expect(store.getState().snapGrid).toBe('dotted-eighth');
  });

  it('the modifiers replace each other rather than stacking', async () => {
    // There is no dotted triplet in the model, so there must not be one here.
    const store = makeStore();
    store.getState().setSnapGrid('dotted-quarter');
    renderToolbar(store);

    await userEvent.click(screen.getByLabelText('Triplet'));

    expect(store.getState().snapGrid).toBe('triplet-quarter');
  });

  it('clicking an active modifier turns it off', async () => {
    const store = makeStore();
    store.getState().setSnapGrid('dotted-half');
    renderToolbar(store);

    await userEvent.click(screen.getByLabelText('Dotted'));

    expect(store.getState().snapGrid).toBe('half');
  });
});

describe('the overflow menu', () => {
  /*
    A slide is a span, so it needs two notes — and it belongs on the same menu
    in both apps. The web offered it in the inspector and on Shift+G alone,
    which is a different answer to "where is glissando?" from the one the
    native app gives.
  */
  it('slides between the selected notes', async () => {
    const store = makeStore();
    const notes = allNotes(store.getState().score!) as NoteEvent[];
    act(() => {
      store.getState().setSelection({
        eventIds: [notes[0].id, notes[1].id],
        measureIds: [],
        trackIds: [],
      });
    });
    renderToolbar(store);

    await chooseMoreAction('Glissando');

    const first = findEvent(store.getState().score!, notes[0].id) as NoteEvent;
    const second = findEvent(store.getState().score!, notes[1].id) as NoteEvent;
    expect(first.glissandoStart).toBe(true);
    expect(second.glissandoStop).toBe(true);
  });

  it('offers no slide with fewer than two notes selected', async () => {
    // One note has nothing to slide to, and a live control that quietly
    // returns is worse than one plainly unavailable.
    const store = makeStore();
    const notes = allNotes(store.getState().score!) as NoteEvent[];
    act(() => {
      store.getState().setSelection({
        eventIds: [notes[0].id],
        measureIds: [],
        trackIds: [],
      });
    });
    renderToolbar(store);

    await userEvent.click(screen.getByLabelText('More actions'));
    expect(await screen.findByRole('option', { name: 'Glissando' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('the overflow menu while playing', () => {
  it('locks the entries that change content, and keeps the ones that only read', async () => {
    // Lyrics, bars and a slide are all content, and the transport refuses every
    // one of them while it plays — an entry that opens an entry bar whose every
    // keystroke is then refused invites typing into nothing.
    const store = makeStore();
    act(() => store.getState().setPlaybackState('playing'));
    renderToolbar(store);

    await userEvent.click(screen.getByLabelText('More actions'));
    for (const name of ['Insert bars…', 'Delete bar at caret', 'Enter lyrics']) {
      expect(await screen.findByRole('option', { name }), name).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    }
    expect(screen.getByRole('option', { name: 'Select all notes' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('measure and delete controls', () => {
  it('adds a measure to every track', async () => {
    const store = makeStore();
    const before = store.getState().score!.tracks.map((t) => t.measures.length);
    renderToolbar(store);

    await chooseMoreAction('Insert bars…');

    const after = store.getState().score!.tracks.map((t) => t.measures.length);
    expect(after).toEqual(before.map((n) => n + 1));
  });

  it('removes the measure the caret is in', async () => {
    const store = makeStore();
    store.getState().dispatchCommand(addMeasureCommand(commandLabel('addMeasure')));
    const before = store.getState().score!.tracks[0].measures.length;
    renderToolbar(store);

    await chooseMoreAction('Delete bar at caret');

    expect(store.getState().score!.tracks[0].measures.length).toBe(before - 1);
  });

  it('refuses to remove the last measure', async () => {
    // A score with no measures has nothing to draw and nowhere for the caret
    // to sit, and no control left to get back except undo.
    const store = makeStore();
    while (store.getState().score!.tracks[0].measures.length > 1) {
      store.getState().dispatchCommand(deleteMeasureCommand(0, commandLabel('deleteMeasure')));
    }
    renderToolbar(store);

    await chooseMoreAction('Delete bar at caret');

    expect(store.getState().score!.tracks[0].measures.length).toBe(1);
    expect(store.getState().toasts.some((t) => /at least one bar/.test(t.message))).toBe(true);
  });

  /*
    Copy, Cut, Paste and Delete are the context menu's now — see
    `ScoreContextMenu.test.tsx`, which covers all four and the Clear that joined
    them. They were four permanently visible buttons for actions that only apply
    to a selection and could not name what they would act on.
  */
});

describe('accessible names are unambiguous', () => {
  it('no two controls in the toolbar share a name', () => {
    // A duplicate makes both impossible to address — by a screen reader, and
    // by a test. "Measures" once collided with the generation panel's own
    // Measures field and broke 18 e2e specs at once.
    const store = makeStore();
    const { container } = renderToolbarContainer(store);

    const labels = Array.from(container.querySelectorAll('[aria-label]')).map((el) =>
      el.getAttribute('aria-label'),
    );
    const duplicates = labels.filter((label, i) => labels.indexOf(label) !== i);
    expect(duplicates).toEqual([]);
  });
});

describe('selection-only controls say so', () => {
  const SELECTION_ONLY = ['Accidental', 'Articulation', 'Toggle tie', 'Quantize'];

  it('are disabled with a score open but nothing selected', () => {
    // They all return early when the selection is empty. Enabled, they invited
    // a click and did nothing — the worst of the three possible behaviours.
    const store = makeStore();
    renderToolbar(store);
    for (const name of SELECTION_ONLY) {
      expect(screen.getByLabelText(name), name).toBeDisabled();
    }
  });

  it('become available once something is selected', () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    renderToolbar(store);
    for (const name of SELECTION_ONLY) {
      expect(screen.getByLabelText(name), name).toBeEnabled();
    }
  });

  it('leaves entry controls available without a selection', () => {
    // Writing a note needs no selection, so these must not be gated on one.
    const store = makeStore();
    renderToolbar(store);
    expect(screen.getByLabelText('Insert note')).toBeEnabled();
    expect(screen.getByLabelText('Note duration')).toBeEnabled();
  });
});

describe('pitch display', () => {
  it('toggles between concert and written pitch', async () => {
    const user = userEvent.setup();
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    renderToolbar(store);

    await user.click(screen.getByRole('button', { name: 'Show written pitch' }));
    expect(store.getState().pitchDisplay).toBe('written');

    await user.click(screen.getByRole('button', { name: 'Show concert pitch' }));
    expect(store.getState().pitchDisplay).toBe('concert');
  });
});

describe('tracks group', () => {
  it('is the first group on the bar', () => {
    // Adding a part comes before anything that acts within one.
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    renderToolbar(store);

    const groups = screen.getAllByRole('group');
    expect(groups[0]).toHaveAccessibleName('Tracks');
  });

  it('has no track picker, however many tracks there are', () => {
    /*
      Clicking a staff makes its track the active one, so the bar no longer
      says it a second way. Which tracks are drawn moved to the inspector's
      Track tab — `VisibleTracksField.test.tsx` holds that half.
    */
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twoTrackScore());
    renderToolbar(store);

    expect(screen.queryByLabelText('Visible tracks')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('offers Blank Track and Generate Track', async () => {
    const user = userEvent.setup();
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    renderToolbar(store);

    await user.click(screen.getByRole('combobox', { name: 'Add Track' }));
    expect(screen.getByRole('option', { name: 'Blank Track' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Generate Track' })).toBeVisible();
  });

  it('Blank Track adds a track and makes it active', async () => {
    // Active immediately: you added it to work on it.
    const user = userEvent.setup();
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    const before = store.getState().score!.tracks.length;
    renderToolbar(store);

    await user.click(screen.getByRole('combobox', { name: 'Add Track' }));
    await user.click(screen.getByRole('option', { name: 'Blank Track' }));

    const tracks = store.getState().score!.tracks;
    expect(tracks).toHaveLength(before + 1);
    expect(store.getState().activeTrackId).toBe(tracks[tracks.length - 1].id);
  });

  it('Generate Track asks its host to open the modal', async () => {
    // The toolbar does not generate; the view owns the request and the merge.
    const user = userEvent.setup();
    const onGenerateTrack = vi.fn();
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore());
    renderToolbar(store, { onGenerateTrack });

    await user.click(screen.getByRole('combobox', { name: 'Add Track' }));
    await user.click(screen.getByRole('option', { name: 'Generate Track' }));
    expect(onGenerateTrack).toHaveBeenCalled();
  });

  it('cannot add a track with no score open', () => {
    const store = createAppStore({ context: testStoreContext() });
    renderToolbar(store);
    expect(screen.getByRole('combobox', { name: 'Add Track' })).toBeDisabled();
  });
});

describe('EditorToolbar: action buttons read as live, not disabled', () => {
  /*
    The library's `ghost` variant draws text in a muted grey. Beside a select
    trigger showing its value in ordinary near-black, that made Triplet look
    like the unavailable twin of Note duration one gap along — while the thing
    that actually marks a control unavailable, `disabled:opacity-50`, was doing
    its job unaffected.

    Asserted as "the same ink as the selector" rather than against a colour
    name, because that is the requirement: whatever the bar's text colour is,
    an action button and a selector must agree on it.
  */
  it('gives an action button the same ink as a selector beside it', () => {
    const store = createAppStore({ context: testStoreContext() });
    store.getState().setScore(twinkleScore(), { resetHistory: true });
    renderToolbar(store);

    const inkOf = (element: HTMLElement): string[] =>
      element.className.split(/\s+/).filter((name) => /^text-(?!sm$|xs$|base$|lg$)/.test(name));

    const action = screen.getByLabelText('Triplet');
    const selector = screen.getByLabelText('Note duration');

    expect(inkOf(action)).not.toEqual([]);
    expect(inkOf(action)).toEqual(inkOf(selector));
  });
});
