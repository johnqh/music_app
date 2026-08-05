import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExportScopeDialog } from '@/components/dialogs/ExportScopeDialog';

describe('ExportScopeDialog', () => {
  it('says how many tracks are hidden', () => {
    render(<ExportScopeDialog open hiddenCount={6} onChoose={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/6 hidden tracks/)).toBeInTheDocument();
  });

  it('says it in the singular for one', () => {
    render(<ExportScopeDialog open hiddenCount={1} onChoose={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/1 hidden track\b/)).toBeInTheDocument();
  });

  it('reports the whole-score choice', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<ExportScopeDialog open hiddenCount={2} onChoose={onChoose} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Whole score' }));
    expect(onChoose).toHaveBeenCalledWith('all');
  });

  it('reports the visible-only choice', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<ExportScopeDialog open hiddenCount={2} onChoose={onChoose} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Visible tracks only' }));
    expect(onChoose).toHaveBeenCalledWith('visible');
  });

  it('cancels without choosing', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onCancel = vi.fn();
    render(<ExportScopeDialog open hiddenCount={2} onChoose={onChoose} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(
      <ExportScopeDialog open={false} hiddenCount={2} onChoose={() => {}} onCancel={() => {}} />,
    );
    expect(screen.queryByText('Export hidden tracks?')).toBeNull();
  });
});
