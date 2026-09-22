import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { getMusicPlayer } from '@sudobility/music_player/core';
import type { MockMusicPlayer } from '@sudobility/music_player/mocks';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CanvasScoreRenderer, twinkleScore } from '@/app-library';
import {
  getMusicPosition,
  getMusicPositionSource,
  resetMusicPosition,
} from '@sudobility/music_types';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import { getAppServices, setAppServices } from '@/config/initialize';
import { CommunityPage } from '@/features/community/CommunityPage';
import { PublishedView } from '@/features/community/PublishedView';

const score = twinkleScore();

const published = {
  publicId: 'pub_x',
  name: 'Version 1',
  publicName: 'My Song Version 1',
  publisherName: 'Jane',
  score,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/** Stubs just the two public calls on the shared services object. */
function stubPublicCalls() {
  const services = getAppServices();
  setAppServices({
    ...services,
    musicClient: {
      ...services.musicClient,
      listCommunity: vi.fn().mockResolvedValue([published]),
      getPublishedSnapshot: vi.fn().mockResolvedValue(published),
    } as never,
  });
}

describe('CommunityPage', () => {
  beforeEach(() => {
    installTestAppServices();
    stubPublicCalls();
  });
  afterEach(() => resetTestAppServices());

  it('lists what has been shared, with its publisher', async () => {
    render(
      <MemoryRouter initialEntries={['/en/community']}>
        <Routes>
          <Route path="/:lang/community" element={<CommunityPage />} />
        </Routes>
      </MemoryRouter>,
    );
    // The public title, not the owner's version label: "Version 1" means
    // nothing to a stranger.
    expect(await screen.findByText('My Song Version 1')).toBeVisible();
    expect(screen.queryByText('Version 1')).toBeNull();
    expect(screen.getByText(/by Jane/)).toBeVisible();
  });
});

describe('PublishedView', () => {
  beforeEach(() => {
    installTestAppServices();
    stubPublicCalls();
  });
  afterEach(() => {
    resetTestAppServices();
    resetMusicPosition();
  });

  const renderPublished = () =>
    render(
      <MemoryRouter initialEntries={['/en/p/pub_x']}>
        <Routes>
          <Route path="/:lang/p/:publicId" element={<PublishedView />} />
        </Routes>
      </MemoryRouter>,
    );

  it('offers no way to edit', async () => {
    // The rule the page exists to keep, asserted by the absence of every
    // affordance rather than by a read-only flag somebody could flip.
    renderPublished();
    await screen.findByText('My Song Version 1');
    for (const name of [/print/i, /export/i, /save/i, /undo/i, /delete/i, /import/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('can play', async () => {
    renderPublished();
    expect(await screen.findByRole('button', { name: /play/i })).toBeEnabled();
  });

  it('draws the track-name gutter, so a reader can tell which track plays which instrument', async () => {
    // This used to draw with `printRenderOptions`, which sets `showTrackInfo:
    // false` to save page width — the reason a reader here could not tell
    // which track played which instrument. Reusing ScoreEditorView (screen
    // render mode, `showTrackInfo` true by default) fixes that.
    const renderSpy = vi.spyOn(CanvasScoreRenderer.prototype, 'render');
    renderPublished();
    await screen.findByText('My Song Version 1');
    await waitFor(() => expect(renderSpy).toHaveBeenCalled());
    const opts = renderSpy.mock.calls.at(-1)![2];
    expect(opts.showTrackInfo).not.toBe(false);
  });

  it('plays the published score, not the score open in the editor', async () => {
    // It used to press the app-wide transport, which is bound to the app-wide
    // store: a visitor with a project open heard *that* project, and one with
    // none heard nothing at all (or, as here with no app store, threw).
    const player = getMusicPlayer() as MockMusicPlayer;
    const user = userEvent.setup();
    renderPublished();
    await waitFor(() => expect(player.loadedScore).toBe(score));
    await user.click(await screen.findByRole('button', { name: /play/i }));
    expect(player.calls).toContain('play');
    expect(player.loadedScore).toBe(score);
    // The button follows the transport the player reports, not a local guess.
    player.emitTransport('playing');
    expect(await screen.findByRole('button', { name: /pause/i })).toBeVisible();
  });

  it('stops the transport when the page is left', async () => {
    const player = getMusicPlayer() as MockMusicPlayer;
    const view = renderPublished();
    await waitFor(() => expect(player.loadedScore).toBe(score));
    view.unmount();
    expect(player.calls).toContain('stop');
  });

  it("plays from its own start and hands the editor's caret back on leaving", async () => {
    // One playhead serves the whole app. The page starts its piece at the
    // beginning — which moves that playhead — so it has to put the editor's
    // caret back, or following a published link loses the reader's place.
    const player = getMusicPlayer() as MockMusicPlayer;
    getMusicPositionSource().moveTo(960);
    const view = renderPublished();
    await waitFor(() => expect(player.loadedScore).toBe(score));
    expect(getMusicPosition().tick).toBe(0);

    getMusicPositionSource().report(240); // the page's own playback moved it

    view.unmount();
    expect(getMusicPosition().tick).toBe(960);
  });

  it('shows a Share button carrying the shareable address', async () => {
    const user = userEvent.setup();
    renderPublished();
    await screen.findByText('My Song Version 1');
    await user.click(screen.getByRole('button', { name: /share/i }));
    // The route's own address, built the way the native app builds it — not
    // whatever query string or trailing path the visitor arrived with.
    expect(screen.getByText(`${window.location.origin}/en/p/pub_x`)).toBeVisible();
  });

  it('says so when the link is no longer shared', async () => {
    const services = getAppServices();
    setAppServices({
      ...services,
      musicClient: {
        ...services.musicClient,
        getPublishedSnapshot: vi.fn().mockRejectedValue(new Error('404')),
      } as never,
    });
    renderPublished();
    expect(await screen.findByText(/no longer shared/i)).toBeVisible();
  });
});
