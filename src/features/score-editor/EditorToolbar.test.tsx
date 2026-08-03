import { afterEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { twinkleScore } from '@sudobility/music_lib';
import { allNotes, findEvent } from '@sudobility/music_lib';
import type { NoteEvent } from '@sudobility/music_types';
import { EditorToolbar } from '@/features/score-editor/EditorToolbar';
import type { EditorStoreApi } from '@/features/score-editor/editing';

function makeStore(withScore = true): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  if (withScore) store.getState().setScore(twinkleScore());
  return store;
}

afterEach(async () => {});

function renderToolbar(
  store: EditorStoreApi,
  layoutModeOrOverrides:
    | 'page'
    | 'continuous'
    | Partial<React.ComponentProps<typeof EditorToolbar>> = 'page',
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

describe('EditorToolbar', () => {
  it('duration change dispatches changeDurationCommand for the selected note', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    renderToolbar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Eighth note' }));

    const updated = findEvent(store.getState().score!, note.id) as NoteEvent;
    expect(updated.durationTicks).toBe(store.getState().score!.ppq / 2);
    expect(store.getState().canUndo).toBe(true);
    expect(store.getState().snapGrid).toBe('eighth');
  });

  it('duration change updates snapGrid even with nothing selected, without dispatching a command', async () => {
    const store = makeStore();
    renderToolbar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sixteenth note' }));

    expect(store.getState().snapGrid).toBe('sixteenth');
    expect(store.getState().canUndo).toBe(false);
  });

  it('accidental button dispatches changeAccidentalCommand for the selected note', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0] as NoteEvent;
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    renderToolbar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sharp' }));

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
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Select all' }));

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

  it('has no view switch: notation and piano roll are shown at the same time', () => {
    renderToolbar(makeStore());
    expect(screen.queryByRole('group', { name: 'Editor view' })).not.toBeInTheDocument();
  });

  it('disables editing controls when no score is loaded', () => {
    const store = makeStore(false);
    renderToolbar(store);

    expect(screen.getByRole('button', { name: 'Insert note' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quantize' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sharp' })).toBeDisabled();
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
    expect(screen.queryByRole('button', { name: 'Toggle inspector panel' })).not.toBeInTheDocument();
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
