import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReplacementRegion } from '@sudobility/music_lib';
import { ReplaceMusicDialog } from '@/features/generation/ReplaceMusicDialog';

function region(over: Partial<ReplacementRegion> = {}): ReplacementRegion {
  return {
    range: { startTick: 0, endTick: 1920, trackIds: ['trk-1'] },
    measureAligned: true,
    noteCount: 4,
    unselectedNoteCount: 0,
    ...over,
  };
}

describe('ReplaceMusicDialog', () => {
  it('is titled for its scope', () => {
    const { rerender } = render(
      <ReplaceMusicDialog
        open
        scope="notes"
        region={region()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Replace notes' })).toBeInTheDocument();

    rerender(
      <ReplaceMusicDialog
        open
        scope="measures"
        region={region()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Replace bars' })).toBeInTheDocument();

    rerender(
      <ReplaceMusicDialog
        open
        scope="track"
        region={region()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Replace track' })).toBeInTheDocument();
  });

  it('states exactly what will be replaced', () => {
    render(
      <ReplaceMusicDialog
        open
        scope="notes"
        region={region({ noteCount: 4 })}
        trackLabel="Piano"
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/4 notes on track "Piano"/)).toBeVisible();
  });

  it('warns when the span includes notes the user did not select', () => {
    render(
      <ReplaceMusicDialog
        open
        scope="notes"
        region={region({ noteCount: 4, unselectedNoteCount: 2 })}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/2 of them are not selected/)).toBeVisible();
  });

  it('says nothing about unselected notes when there are none', () => {
    render(
      <ReplaceMusicDialog
        open
        scope="measures"
        region={region({ unselectedNoteCount: 0 })}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByText(/not selected/)).not.toBeInTheDocument();
  });

  it('cannot submit without an instruction', async () => {
    render(
      <ReplaceMusicDialog
        open
        scope="track"
        region={region()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Replace' })).toBeDisabled();
  });

  it('cannot submit when there is no region', async () => {
    render(
      <ReplaceMusicDialog open scope="notes" region={null} onClose={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Replace' })).toBeDisabled();
  });

  it('submits the instruction and the complexity default', async () => {
    const onSubmit = vi.fn();
    render(
      <ReplaceMusicDialog
        open
        scope="track"
        region={region()}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.type(screen.getByLabelText('Instruction'), 'make it swing');
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: 'make it swing', complexity: 'moderate' }),
    );
  });

  it('omits style and mood when left unset, rather than sending a sentinel', async () => {
    const onSubmit = vi.fn();
    render(
      <ReplaceMusicDialog
        open
        scope="track"
        region={region()}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.type(screen.getByLabelText('Instruction'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));

    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted).not.toHaveProperty('style');
    expect(submitted).not.toHaveProperty('mood');
  });

  it('defaults to DeepSeek and sends the chosen backend with the submission', async () => {
    // Replacing a bar is the cheapest thing in the system to run twice and
    // compare by ear, so the backend is chosen here rather than fixed.
    const onSubmit = vi.fn();
    render(
      <ReplaceMusicDialog
        open
        scope="track"
        region={region()}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText('Model')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Instruction'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));

    expect(onSubmit.mock.calls[0][0].variant).toBe('deepseek');
  });

  it('submits the preservation constraints', async () => {
    const onSubmit = vi.fn();
    render(
      <ReplaceMusicDialog
        open
        scope="notes"
        region={region()}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.type(screen.getByLabelText('Instruction'), 'x');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Preserve melody' }));
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({ preserveMelody: true, preserveHarmony: false }),
      }),
    );
  });

  it('fills the instruction from a preset', async () => {
    const onSubmit = vi.fn();
    render(
      <ReplaceMusicDialog
        open
        scope="notes"
        region={region()}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Preset instructions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Simplify this passage' }));

    expect(screen.getByLabelText('Instruction')).toHaveValue('Simplify this passage');
  });

  it('offers no candidate-count field', () => {
    render(
      <ReplaceMusicDialog
        open
        scope="notes"
        region={region()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/candidate/i)).not.toBeInTheDocument();
  });

  it('offers none of the fields the region already fixes', () => {
    render(
      <ReplaceMusicDialog
        open
        scope="notes"
        region={region()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    for (const name of [/bars/i, /tempo/i, /time signature/i, /key/i]) {
      expect(screen.queryByLabelText(name)).not.toBeInTheDocument();
    }
  });

  it('clears a stale instruction when reopened, so it cannot apply to different music', async () => {
    const { rerender } = render(
      <ReplaceMusicDialog
        open
        scope="notes"
        region={region()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText('Instruction'), 'for the old selection');

    rerender(
      <ReplaceMusicDialog
        open={false}
        scope="notes"
        region={region()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    rerender(
      <ReplaceMusicDialog
        open
        scope="notes"
        region={region()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Instruction')).toHaveValue('');
  });

  it('names its close button distinctly from the footer Cancel', () => {
    render(
      <ReplaceMusicDialog
        open
        scope="notes"
        region={region()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Close dialog' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});
