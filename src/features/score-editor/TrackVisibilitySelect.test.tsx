import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createAppStore,
  testStoreContext,
  threeTrackScore,
  twinkleScore,
} from '@sudobility/music_lib';
import type { EditorStoreApi } from '@sudobility/music_lib';
import { TrackVisibilitySelect } from '@/features/score-editor/TrackVisibilitySelect';

function makeStore(score = threeTrackScore()): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(score);
  return store;
}

const trackNames = (store: EditorStoreApi) => store.getState().score!.tracks.map((t) => t.name);
const trackIds = (store: EditorStoreApi) => store.getState().score!.tracks.map((t) => t.id);

describe('TrackVisibilitySelect', () => {
  it('shows the active track on the trigger', () => {
    const store = makeStore();
    render(<TrackVisibilitySelect store={store} />);
    expect(screen.getByLabelText('Visible tracks')).toHaveTextContent(trackNames(store)[0]);
  });

  it('unticking a track hides it', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    render(<TrackVisibilitySelect store={store} />);

    await user.click(screen.getByLabelText('Visible tracks'));
    await user.click(screen.getByRole('checkbox', { name: `Show ${trackNames(store)[1]}` }));

    expect(store.getState().visibleTrackIds).not.toContain(trackIds(store)[1]);
    expect(store.getState().visibleTrackIds).toContain(trackIds(store)[0]);
  });

  it('choosing a hidden track reveals it and makes it active', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    const [first, second] = trackIds(store);
    store.getState().setVisibleTracks([first]);
    render(<TrackVisibilitySelect store={store} />);

    await user.click(screen.getByLabelText('Visible tracks'));
    await user.click(screen.getByRole('option', { name: new RegExp(trackNames(store)[1]) }));

    expect(store.getState().visibleTrackIds).toContain(second);
    expect(store.getState().activeTrackId).toBe(second);
  });

  it('locks the last visible track so the score cannot go blank', async () => {
    const user = userEvent.setup();
    const store = makeStore();
    store.getState().setVisibleTracks([trackIds(store)[0]]);
    render(<TrackVisibilitySelect store={store} />);

    await user.click(screen.getByLabelText('Visible tracks'));
    expect(screen.getByRole('checkbox', { name: `Show ${trackNames(store)[0]}` })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: `Show ${trackNames(store)[1]}` })).toBeEnabled();
  });

  it('renders nothing when the score has one track', () => {
    // With one track there is nothing to choose between and nothing that could
    // be hidden, so the control would be a permanently-disabled no-op.
    const store = makeStore(twinkleScore());
    render(<TrackVisibilitySelect store={store} />);
    expect(screen.queryByLabelText('Visible tracks')).toBeNull();
  });

  it('renders nothing with no score', () => {
    const store = createAppStore({ context: testStoreContext() }) as EditorStoreApi;
    render(<TrackVisibilitySelect store={store} />);
    expect(screen.queryByLabelText('Visible tracks')).toBeNull();
  });
});
