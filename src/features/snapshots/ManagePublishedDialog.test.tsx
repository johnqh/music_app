import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SnapshotSummary } from '@sudobility/music_types';
import { ManagePublishedDialog } from '@/features/snapshots/ManagePublishedDialog';

const summary = (over: Partial<SnapshotSummary>): SnapshotSummary => ({
  id: 'a',
  projectId: 'p',
  parentId: null,
  name: 'Version 1',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('ManagePublishedDialog', () => {
  it('lists published snapshots only', () => {
    render(
      <ManagePublishedDialog
        open
        snapshots={[
          summary({ id: 'a', name: 'Version 1', publicId: 'pub_1', publicName: 'My Song' }),
          summary({ id: 'b', name: 'Version 2' }),
        ]}
        onRename={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Public name for Version 1')).toHaveValue('My Song');
    expect(screen.queryByLabelText('Public name for Version 2')).toBeNull();
  });

  it('renames only what changed', async () => {
    // Re-publishing is what a rename costs, so an untouched row must not be
    // re-published just because Save was pressed.
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <ManagePublishedDialog
        open
        snapshots={[
          summary({ id: 'a', name: 'Version 1', publicId: 'pub_1', publicName: 'My Song' }),
          summary({ id: 'b', name: 'Version 2', publicId: 'pub_2', publicName: 'Other' }),
        ]}
        onRename={onRename}
        onClose={vi.fn()}
      />,
    );
    await user.clear(screen.getByLabelText('Public name for Version 1'));
    await user.type(screen.getByLabelText('Public name for Version 1'), 'Nocturne');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('a', 'Nocturne');
  });

  it('refuses to blank a public title', async () => {
    // A published page with no name at all.
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <ManagePublishedDialog
        open
        snapshots={[summary({ publicId: 'pub_1', publicName: 'My Song' })]}
        onRename={onRename}
        onClose={vi.fn()}
      />,
    );
    await user.clear(screen.getByLabelText('Public name for Version 1'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onRename).not.toHaveBeenCalled();
  });

  it('falls back to the version label for a row published before titles existed', () => {
    render(
      <ManagePublishedDialog
        open
        snapshots={[summary({ publicId: 'pub_1' })]}
        onRename={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Public name for Version 1')).toHaveValue('Version 1');
  });
});
