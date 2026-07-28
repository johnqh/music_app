import { afterEach, describe, expect, it } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { twoTrackScore } from '@sudobility/music_lib';
import { dragSlider } from '@/test/drag-slider';
import { TrackPanel } from '@/components/layout/TrackPanel';
import type { EditorStoreApi } from '@/features/score-editor/editing';

function makeStore(): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twoTrackScore());
  return store;
}

afterEach(async () => {});

describe('TrackPanel', () => {
  it('renders a row per track with its name and instrument', () => {
    const store = makeStore();
    render(<TrackPanel store={store} />);

    expect(screen.getByLabelText('Track: Treble')).toBeInTheDocument();
    expect(screen.getByLabelText('Track: Bass')).toBeInTheDocument();
  });

  it('clicking a track row selects that track', async () => {
    const store = makeStore();
    render(<TrackPanel store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Track: Bass'));

    const bassId = store.getState().score!.tracks[1].id;
    expect(store.getState().selection.trackIds).toEqual([bassId]);
  });

  it('mute toggle dispatches changeTrackPropsCommand (undoable, not an engine-only override)', async () => {
    const store = makeStore();
    render(<TrackPanel store={store} />);
    const user = userEvent.setup();

    const trebleId = store.getState().score!.tracks[0].id;
    await user.click(screen.getByLabelText('Mute: Treble'));

    expect(store.getState().score!.tracks.find((t) => t.id === trebleId)!.muted).toBe(true);
    expect(store.getState().canUndo).toBe(true);
  });

  it('solo toggle dispatches changeTrackPropsCommand', async () => {
    const store = makeStore();
    render(<TrackPanel store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText('Solo: Bass'));

    expect(store.getState().score!.tracks[1].solo).toBe(true);
  });

  it('dragging the volume slider dispatches exactly one command, not one per drag tick (a single undo fully restores the original value)', async () => {
    const store = makeStore();
    render(<TrackPanel store={store} />);
    const originalVolume = store.getState().score!.tracks[0].volume;

    const slider = screen.getByRole('slider', { name: 'Volume: Treble' });
    dragSlider(slider, [10, 40, 70, 100, 150]);

    await waitFor(() => expect(store.getState().score!.tracks[0].volume).not.toBe(originalVolume));
    expect(store.getState().canUndo).toBe(true);

    store.getState().undo();

    expect(store.getState().score!.tracks[0].volume).toBe(originalVolume);
    // If dragging had dispatched more than one command (one per tick, the
    // reported bug), a single undo would only pop the last one, leaving
    // canUndo true with earlier drag-tick commands still on the stack.
    expect(store.getState().canUndo).toBe(false);
  });

  it('dragging the pan slider dispatches exactly one command, not one per drag tick', async () => {
    const store = makeStore();
    render(<TrackPanel store={store} />);
    const originalPan = store.getState().score!.tracks[0].pan;

    const slider = screen.getByRole('slider', { name: 'Pan: Treble' });
    dragSlider(slider, [10, 40, 70, 100, 150]);

    await waitFor(() => expect(store.getState().score!.tracks[0].pan).not.toBe(originalPan));
    expect(store.getState().canUndo).toBe(true);

    store.getState().undo();

    expect(store.getState().score!.tracks[0].pan).toBe(originalPan);
    expect(store.getState().canUndo).toBe(false);
  });

  it('Add track appends a new track', async () => {
    const store = makeStore();
    render(<TrackPanel store={store} />);
    const user = userEvent.setup();

    const before = store.getState().score!.tracks.length;
    await user.click(screen.getByLabelText('Add track'));

    expect(store.getState().score!.tracks.length).toBe(before + 1);
  });

  it('Delete track requires confirmation before removing the track', async () => {
    const store = makeStore();
    render(<TrackPanel store={store} />);
    const user = userEvent.setup();

    const before = store.getState().score!.tracks.length;
    await user.click(screen.getByLabelText('Delete track: Bass'));

    // Confirmation dialog is open; the track isn't removed yet.
    const dialog = screen.getByRole('dialog');
    expect(store.getState().score!.tracks.length).toBe(before);

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(store.getState().score!.tracks.length).toBe(before - 1);
    expect(store.getState().score!.tracks.some((t) => t.name === 'Bass')).toBe(false);
  });

  it('changing the clef select dispatches changeClefCommand', async () => {
    const store = makeStore();
    render(<TrackPanel store={store} />);
    const user = userEvent.setup();

    // Library sweep 1: the native <select> becomes @sudobility/components'
    // Radix-backed Select -- its trigger has role="combobox" (not a real
    // <select>), so `selectOptions` no longer applies; open it and click
    // the resulting role="option" instead.
    await user.click(screen.getByLabelText('Clef select: Treble'));
    await user.click(await screen.findByRole('option', { name: 'alto' }));

    expect(store.getState().score!.tracks[0].clef).toBe('alto');
  });
});

describe('active track', () => {
  it('marks the first track active by default', () => {
    const store = makeStore();
    const { container } = render(<TrackPanel store={store} />);
    const score = store.getState().score!;
    expect(
      container.querySelector(`[data-testid="track-row-${score.tracks[0].id}"]`),
    ).toHaveAttribute('aria-current', 'true');
    expect(
      container.querySelector(`[data-testid="track-row-${score.tracks[1].id}"]`),
    ).not.toHaveAttribute('aria-current');
  });

  it('marks the explicitly-active track', () => {
    const store = makeStore();
    const score = store.getState().score!;
    act(() => store.getState().setActiveTrack(score.tracks[1].id));

    const { container } = render(<TrackPanel store={store} />);

    expect(
      container.querySelector(`[data-testid="track-row-${score.tracks[1].id}"]`),
    ).toHaveAttribute('aria-current', 'true');
  });

  it('clicking a row makes that track active', async () => {
    const store = makeStore();
    const score = store.getState().score!;
    const { container } = render(<TrackPanel store={store} />);
    const user = userEvent.setup();

    await user.click(container.querySelector(`[data-testid="track-row-${score.tracks[1].id}"]`)!);

    expect(store.getState().activeTrackId).toBe(score.tracks[1].id);
    // Still selects too — one gesture, both meanings, as before.
    expect(store.getState().selection.trackIds).toEqual([score.tracks[1].id]);
  });

  it('adjusting mute does not change the active track', async () => {
    const store = makeStore();
    const score = store.getState().score!;
    act(() => store.getState().setActiveTrack(score.tracks[0].id));
    render(<TrackPanel store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText(`Mute: ${score.tracks[1].name}`));

    expect(store.getState().activeTrackId).toBe(score.tracks[0].id);
  });
});
