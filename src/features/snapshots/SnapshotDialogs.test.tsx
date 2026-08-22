import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateSnapshotDialog, OpenSnapshotDialog } from '@/features/snapshots/SnapshotDialogs';
import { snapshotTree } from '@sudobility/music_lib';

describe('CreateSnapshotDialog', () => {
  it('defaults the name to the next global version number', () => {
    // Global, not per-branch: "Version 4" off "Version 2" beats "Version 2.1.1".
    render(<CreateSnapshotDialog open snapshotCount={3} onCreate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Snapshot name')).toHaveValue('Version 4');
  });

  it('lets the name be replaced', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<CreateSnapshotDialog open snapshotCount={0} onCreate={onCreate} onClose={vi.fn()} />);
    await user.clear(screen.getByLabelText('Snapshot name'));
    await user.type(screen.getByLabelText('Snapshot name'), 'Before the coda');
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));
    // Second argument is the publisher name: undefined unless publishing.
    expect(onCreate).toHaveBeenCalledWith('Before the coda', undefined);
  });

  it('refuses an empty name', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<CreateSnapshotDialog open snapshotCount={0} onCreate={onCreate} onClose={vi.fn()} />);
    await user.clear(screen.getByLabelText('Snapshot name'));
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('OpenSnapshotDialog', () => {
  const nodes = () =>
    snapshotTree(
      [
        {
          id: 'a',
          projectId: 'p',
          parentId: null,
          name: 'Version 1',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      'a',
    );

  it('warns that current work will be replaced', () => {
    render(
      <OpenSnapshotDialog
        open
        nodes={[]}
        onOpen={vi.fn()}
        onSnapshotFirst={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/current work will be replaced/i)).toBeVisible();
  });

  it('offers to snapshot the current work first', async () => {
    // The destructive path always has a non-destructive escape.
    const user = userEvent.setup();
    const onSnapshotFirst = vi.fn();
    render(
      <OpenSnapshotDialog
        open
        nodes={[]}
        onOpen={vi.fn()}
        onSnapshotFirst={onSnapshotFirst}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /snapshot current work first/i }));
    expect(onSnapshotFirst).toHaveBeenCalled();
  });

  it('does not offer the live node as something to open', () => {
    // Opening "where you already are" is a no-op that reads as if it might
    // destroy something.
    render(
      <OpenSnapshotDialog
        open
        nodes={nodes()}
        onOpen={vi.fn()}
        onSnapshotFirst={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Version 1' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Current work/ })).toBeNull();
  });

  it('opens the snapshot that was picked', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <OpenSnapshotDialog
        open
        nodes={nodes()}
        onOpen={onOpen}
        onSnapshotFirst={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Version 1' }));
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('does nothing when Open is pressed with nothing picked', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <OpenSnapshotDialog
        open
        nodes={nodes()}
        onOpen={onOpen}
        onSnapshotFirst={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('CreateSnapshotDialog publishing', () => {
  it('offers a Publish checkbox, off by default', () => {
    render(<CreateSnapshotDialog open snapshotCount={0} onCreate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: /publish/i })).not.toBeChecked();
  });

  it('asks for a publisher name only when publishing', async () => {
    const user = userEvent.setup();
    render(<CreateSnapshotDialog open snapshotCount={0} onCreate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Publisher name')).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: /publish/i }));
    expect(screen.getByLabelText('Publisher name')).toBeVisible();
  });

  it('reports the publisher name alongside the snapshot name', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <CreateSnapshotDialog
        open
        snapshotCount={0}
        defaultPublisherName="Jane"
        onCreate={onCreate}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: /publish/i }));
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));
    expect(onCreate).toHaveBeenCalledWith('Version 1', 'Jane');
  });

  it('will not publish without a publisher name', async () => {
    // An unattributable row on a public page.
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<CreateSnapshotDialog open snapshotCount={0} onCreate={onCreate} onClose={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: /publish/i }));
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('still creates an unpublished snapshot with no publisher name', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(<CreateSnapshotDialog open snapshotCount={0} onCreate={onCreate} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Create snapshot' }));
    expect(onCreate).toHaveBeenCalledWith('Version 1', undefined);
  });
});
