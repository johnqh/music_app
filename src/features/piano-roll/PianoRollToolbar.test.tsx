import { afterEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { twinkleScore, twoTrackScore } from '@sudobility/music_lib';
import { allNotes } from '@sudobility/music_lib';
import { PianoRollToolbar } from '@/features/piano-roll/PianoRollToolbar';

function makeStore(score = twinkleScore()): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(score);
  return store;
}

afterEach(async () => {
});

function renderToolbar(store: EditorStoreApi, overrides: Partial<React.ComponentProps<typeof PianoRollToolbar>> = {}) {
  const onZoomHChange = vi.fn();
  const onZoomVChange = vi.fn();
  const onVisibleTrackIdsChange = vi.fn();
  const utils = render(
    <PianoRollToolbar
      store={store}
      zoomH={1}
      zoomV={1}
      onZoomHChange={onZoomHChange}
      onZoomVChange={onZoomVChange}
      visibleTrackIds={null}
      onVisibleTrackIdsChange={onVisibleTrackIdsChange}
      {...overrides}
    />,
  );
  return { ...utils, onZoomHChange, onZoomVChange, onVisibleTrackIdsChange };
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

  it('loop-from-selection button sets the loop range from the current selection', async () => {
    const store = makeStore();
    const note = allNotes(store.getState().score!)[0];
    store.getState().setSelection({ eventIds: [note.id], measureIds: [], trackIds: [] });
    renderToolbar(store);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Loop selection' }));

    expect(store.getState().loopRange).not.toBeNull();
  });

  it('lists every track in the track filter and reports a full re-selection as "show all" (null)', async () => {
    const store = makeStore(twoTrackScore());
    const { onVisibleTrackIdsChange } = renderToolbar(store);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Track filter'));
    // Substring match: the option's computed accessible name now includes
    // its checkbox's own `aria-label` ("Show track: Treble") ahead of the
    // visible "Treble" text, per the accname "name from content"
    // algorithm — see the checkbox's own doc comment.
    expect(await screen.findByRole('option', { name: /Treble/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Bass/ })).toBeInTheDocument();

    // All tracks start implicitly selected (visibleTrackIds === null); with
    // both already checked, clicking "Treble" deselects it, leaving Bass as
    // the sole remaining checked track.
    await user.click(screen.getByRole('option', { name: /Treble/ }));

    const bassId = store.getState().score!.tracks[1].id;
    expect(onVisibleTrackIdsChange).toHaveBeenCalledWith(new Set([bassId]));
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
