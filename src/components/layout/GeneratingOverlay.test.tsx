import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GeneratingOverlay } from '@/components/layout/GeneratingOverlay';

describe('GeneratingOverlay', () => {
  it('says what is happening', () => {
    render(<GeneratingOverlay onCancel={vi.fn()} />);
    expect(screen.getByText('Generating notes…')).toBeVisible();
  });

  it('tells the user they can leave, which is the whole point of a job', () => {
    render(<GeneratingOverlay onCancel={vi.fn()} />);
    expect(screen.getByText(/work on another one/i)).toBeVisible();
  });

  it('offers Cancel and calls it', async () => {
    const onCancel = vi.fn();
    render(<GeneratingOverlay onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('covers its parent rather than merely dimming it', () => {
    // The project is immutable server-side while generating, so an edit made
    // underneath would 409 and be lost. The cover has to intercept pointers.
    render(<GeneratingOverlay onCancel={vi.fn()} />);

    const overlay = screen.getByTestId('generating-overlay');
    expect(overlay.className).toContain('absolute');
    expect(overlay.className).toContain('inset-0');
  });

  it('announces itself to assistive tech', () => {
    render(<GeneratingOverlay onCancel={vi.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows a job error when there is one', () => {
    render(<GeneratingOverlay onCancel={vi.fn()} error="provider exploded" />);
    expect(screen.getByRole('alert')).toHaveTextContent('provider exploded');
  });

  it('shows no alert when there is no error', () => {
    render(<GeneratingOverlay onCancel={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
