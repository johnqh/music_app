/**
 * Which tracks are drawn, from the inspector's Track tab.
 *
 * The only control in the app that hides a track, so what is pinned is that
 * it hides one, brings one back, and cannot hide them all.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createAppStore,
  selectVisibleTrackIds,
  testStoreContext,
  twinkleScore,
  twoTrackScore,
} from '@/app-library';
import type { EditorStoreApi } from '@/app-library';
import { VisibleTracksField } from './VisibleTracksField';

function makeStore(score = twoTrackScore()): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(score);
  return store;
}

function trackIds(store: EditorStoreApi): string[] {
  return store.getState().score!.tracks.map((track) => track.id);
}

describe('VisibleTracksField', () => {
  it('lists every track, ticked, under one name', () => {
    const store = makeStore();
    render(<VisibleTracksField store={store} />);
    const group = screen.getByRole('group', { name: 'Visible tracks' });
    expect(group).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(trackIds(store).length);
    for (const box of boxes) expect(box).toBeChecked();
  });

  it('is absent with one track, where nothing could be hidden', () => {
    const store = makeStore(twinkleScore());
    render(<VisibleTracksField store={store} />);
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('hides a track, and brings it back', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    const [first, second] = trackIds(store);
    render(<VisibleTracksField store={store} />);

    await user.click(screen.getAllByRole('checkbox')[1]!);
    expect(selectVisibleTrackIds(store.getState())).toEqual([first]);

    await user.click(screen.getAllByRole('checkbox')[1]!);
    expect(selectVisibleTrackIds(store.getState())).toEqual([first, second]);
  });

  it('keeps the list in score order, whatever order it was ticked in', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    const [first, second] = trackIds(store);
    render(<VisibleTracksField store={store} />);

    await user.click(screen.getAllByRole('checkbox')[0]!);
    expect(selectVisibleTrackIds(store.getState())).toEqual([second]);
    await user.click(screen.getAllByRole('checkbox')[0]!);
    expect(selectVisibleTrackIds(store.getState())).toEqual([first, second]);
  });

  it('will not hide the last track showing', async () => {
    // A score with nothing drawn is a blank page with no way to say why.
    const user = userEvent.setup();
    const store = makeStore();
    const [first] = trackIds(store);
    render(<VisibleTracksField store={store} />);

    await user.click(screen.getAllByRole('checkbox')[1]!);
    const last = screen.getAllByRole('checkbox')[0]!;
    expect(last).toBeDisabled();
    await user.click(last);
    expect(selectVisibleTrackIds(store.getState())).toEqual([first]);
  });
});
