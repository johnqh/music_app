import { afterEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { twinkleScore, twoTrackScore } from '@sudobility/music_lib';
import { allNotes } from '@sudobility/music_lib';

// The toolbar's Loop button routes through the app-wide playbackController
// singleton, which eagerly builds a real Tone.js engine on import -- mocked
// here, same as ScoreEditorView's and AppLayout's suites do.
vi.mock('@sudobility/music_lib', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  playbackController: { setLoopFromSelection: vi.fn() },
}));

import { playbackController } from '@sudobility/music_lib';
import { PianoRollToolbar } from '@/features/piano-roll/PianoRollToolbar';

function makeStore(score = twinkleScore()): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(score);
  return store;
}

afterEach(() => {
  vi.mocked(playbackController.setLoopFromSelection).mockClear();
});

function renderToolbar(
  store: EditorStoreApi,
  overrides: Partial<React.ComponentProps<typeof PianoRollToolbar>> = {},
) {
  const onZoomHChange = vi.fn();
  const onZoomVChange = vi.fn();
  const utils = render(
    <PianoRollToolbar
      store={store}
      zoomH={1}
      zoomV={1}
      onZoomHChange={onZoomHChange}
      onZoomVChange={onZoomVChange}
      collapsed={false}
      onToggleCollapsed={() => undefined}
      {...overrides}
    />,
  );
  return { ...utils, onZoomHChange, onZoomVChange };
}

describe('PianoRollToolbar', () => {
  it('renders without a score loaded', () => {
    const store = createAppStore({ context: testStoreContext() });
    expect(() => renderToolbar(store)).not.toThrow();
  });

  it('zoom-in/out buttons call the zoom change callbacks with a larger/smaller value', async () => {
    const store = makeStore();
    const { onZoomHChange, onZoomVChange } = renderToolbar(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Zoom horizontal in' }));
    expect(onZoomHChange).toHaveBeenCalledWith(expect.any(Number));
    expect(onZoomHChange.mock.calls[0][0]).toBeGreaterThan(1);

    await user.click(screen.getByRole('button', { name: 'Zoom vertical out' }));
    expect(onZoomVChange).toHaveBeenCalledWith(expect.any(Number));
    expect(onZoomVChange.mock.calls[0][0]).toBeLessThan(1);
  });

  it('changing the snap grid select updates the store snapGrid', async () => {
    const store = makeStore();
    renderToolbar(store);
    const user = userEvent.setup();

    // Library sweep 1: the native <select> becomes @sudobility/components'
    // Radix-backed Select -- its trigger has role="combobox" (not a real
    // <select>), so `selectOptions` no longer applies; open it and click
    // the resulting role="option" instead.
    await user.click(screen.getByLabelText('Snap grid'));
    await user.click(await screen.findByRole('option', { name: 'eighth' }));

    expect(store.getState().snapGrid).toBe('eighth');
  });

  it('quantize button quantizes the selected notes', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    renderToolbar(store);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Quantize' }));

    expect(store.getState().canUndo).toBe(true);
  });

  it('loop-from-selection drives the playback controller, not just the store', async () => {
    // Asserting the controller call rather than `store.loopRange`: looping
    // has to reach the engine, and writing the store alone was the bug this
    // replaced (the Loop button lit up while playback didn't loop). The
    // controller owns both halves and is bound to the app-wide store, so an
    // isolated test store would never see the write anyway.
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    renderToolbar(store);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Loop selection' }));

    expect(playbackController.setLoopFromSelection).toHaveBeenCalledTimes(1);
  });

  it('has no track filter: the roll always follows the active track', () => {
    renderToolbar(makeStore(twoTrackScore()));
    expect(screen.queryByLabelText('Track filter')).not.toBeInTheDocument();
  });

  it('has no view switch: notation and piano roll are shown at the same time', () => {
    renderToolbar(makeStore());
    expect(screen.queryByRole('group', { name: 'Editor view' })).not.toBeInTheDocument();
  });

  it('the collapse control toggles and renames itself', async () => {
    const onToggleCollapsed = vi.fn();
    renderToolbar(makeStore(), { onToggleCollapsed });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Collapse piano roll' }));
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('offers Expand while collapsed, so the panel is never unreachable', () => {
    renderToolbar(makeStore(), { collapsed: true });
    expect(screen.getByRole('button', { name: 'Expand piano roll' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse piano roll' })).not.toBeInTheDocument();
  });
});

describe('accessibility (spec §27)', () => {
  it('every interactive control has an accessible name', () => {
    const store = makeStore();
    renderToolbar(store);
    const toolbar = screen.getByRole('toolbar');
    for (const button of within(toolbar).getAllByRole('button')) {
      expect(button).toHaveAccessibleName();
    }
    for (const combobox of within(toolbar).getAllByRole('combobox')) {
      expect(combobox).toHaveAccessibleName();
    }
  });
});
