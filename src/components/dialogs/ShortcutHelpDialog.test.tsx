import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShortcutHelpDialog } from '@/components/dialogs/ShortcutHelpDialog';

describe('ShortcutHelpDialog', () => {
  it('renders nothing meaningful when closed', () => {
    render(<ShortcutHelpDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Keyboard shortcuts')).not.toBeInTheDocument();
  });

  it('lists the spec §7 shortcut table when open', () => {
    render(<ShortcutHelpDialog open onClose={vi.fn()} />);

    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Play / pause')).toBeInTheDocument();
    expect(screen.getByText('Undo')).toBeInTheDocument();
    expect(screen.getByText('Ctrl/Cmd+Shift+Z')).toBeInTheDocument();
  });

  it('stacks alternative keys one per line', async () => {
    // Printed across, `Ctrl/Cmd+Home / Ctrl/Cmd+End` sets the key column's
    // width for all twenty-four rows and squeezes every description beside it.
    render(<ShortcutHelpDialog open onClose={vi.fn()} />);

    const row = screen.getByText('Ctrl/Cmd+Home').closest('tr')!;
    expect(within(row).getByText('Ctrl/Cmd+End')).toBeInTheDocument();
    // The separator is gone, which is what proves they are on separate lines
    // rather than in one run of text.
    expect(within(row).queryByText(/Ctrl\/Cmd\+Home \/ Ctrl\/Cmd\+End/)).toBeNull();
  });

  it('close button calls onClose', async () => {
    const onClose = vi.fn();
    render(<ShortcutHelpDialog open onClose={onClose} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('every interactive control has an accessible name (spec §27)', () => {
    render(<ShortcutHelpDialog open onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    for (const button of within(dialog).getAllByRole('button'))
      expect(button).toHaveAccessibleName();
  });
});
