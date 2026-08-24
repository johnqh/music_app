import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { twinkleScore } from '@sudobility/music_lib';
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
  afterEach(() => resetTestAppServices());

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

  it('shows a Share button carrying the URL', async () => {
    const user = userEvent.setup();
    renderPublished();
    await screen.findByText('My Song Version 1');
    await user.click(screen.getByRole('button', { name: /share/i }));
    expect(
      screen.getByText(new RegExp(window.location.href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
    ).toBeVisible();
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
