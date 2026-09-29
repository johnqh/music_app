import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GenerationStatusStrip } from '@/components/layout/GenerationStatusStrip';

describe('GenerationStatusStrip', () => {
  it('says what is happening', () => {
    render(<GenerationStatusStrip onCancel={vi.fn()} />);
    expect(screen.getByText('Generating notes…')).toBeVisible();
  });

  it('says a recording is being transcribed, when that is the job', () => {
    // "Generating" over a recording somebody uploaded describes something
    // that is not happening.
    render(<GenerationStatusStrip status="transcribing" onCancel={vi.fn()} />);
    expect(screen.getByText('Transcribing the recording…')).toBeVisible();
    expect(screen.queryByText('Generating notes…')).not.toBeInTheDocument();
  });

  it('names the part a transcription is working on, and the separation before any', () => {
    const { rerender } = render(
      <GenerationStatusStrip
        status="transcribing"
        onCancel={vi.fn()}
        progress={{ stage: 'plan', label: 'Separation', done: 0, total: 8 }}
      />,
    );
    expect(screen.getByText(/^Separating 0 of 8/)).toBeVisible();
    rerender(
      <GenerationStatusStrip
        status="transcribing"
        onCancel={vi.fn()}
        progress={{ stage: 'part', label: 'Vocals', done: 2, total: 8 }}
      />,
    );
    expect(screen.getByText('Part 2 of 8: Vocals')).toBeVisible();
  });

  it('is a row, not a cover: the score above stays readable while the notes arrive', () => {
    // The old overlay covered the whole editor. With partials streamed into
    // the score, covering it would hide the one thing worth watching; what
    // stops an edit now is the store's lock and the read-only view.
    render(<GenerationStatusStrip onCancel={vi.fn()} />);
    const strip = screen.getByTestId('generation-status-strip');
    expect(strip.className).not.toContain('absolute');
    expect(strip.className).not.toContain('inset-0');
  });

  it("reports the stream's progress as a count the reader can follow", () => {
    render(
      <GenerationStatusStrip
        onCancel={vi.fn()}
        progress={{ stage: 'part', label: 'Bass', done: 2, total: 4 }}
      />,
    );
    expect(screen.getByText('Part 2 of 4: Bass')).toBeVisible();
  });

  it('mentions a troubled stream and nothing about a healthy one', () => {
    const { rerender } = render(<GenerationStatusStrip onCancel={vi.fn()} live="live" />);
    expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();
    rerender(<GenerationStatusStrip onCancel={vi.fn()} live="reconnecting" />);
    expect(screen.getByText('Reconnecting…')).toBeVisible();
    rerender(<GenerationStatusStrip onCancel={vi.fn()} live="fallback" />);
    expect(screen.getByText(/checking the project periodically/i)).toBeVisible();
  });

  it('offers Cancel and calls it', async () => {
    const onCancel = vi.fn();
    render(<GenerationStatusStrip onCancel={onCancel} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('announces itself to assistive tech', () => {
    render(<GenerationStatusStrip onCancel={vi.fn()} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows a job error when there is one, and no alert otherwise', () => {
    const { rerender } = render(<GenerationStatusStrip onCancel={vi.fn()} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    rerender(<GenerationStatusStrip onCancel={vi.fn()} error="provider exploded" />);
    expect(screen.getByRole('alert')).toHaveTextContent('provider exploded');
  });
});
