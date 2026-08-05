import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChoiceDialog } from '@/components/dialogs/ChoiceDialog';

const CHOICES = [
  { value: 'a' as const, label: 'Do A', detail: 'the first way', primary: true },
  { value: 'b' as const, label: 'Do B', detail: 'the other way' },
];

function renderDialog(overrides = {}) {
  const onChoose = vi.fn();
  const onCancel = vi.fn();
  render(
    <ChoiceDialog
      open
      title="A question"
      message="Something is true."
      choices={CHOICES}
      onChoose={onChoose}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onChoose, onCancel };
}

describe('ChoiceDialog', () => {
  it('shows the question and every answer', () => {
    renderDialog();
    expect(screen.getByText('A question')).toBeInTheDocument();
    expect(screen.getByText('Something is true.')).toBeInTheDocument();
    expect(screen.getByLabelText('Do A')).toBeInTheDocument();
    expect(screen.getByLabelText('Do B')).toBeInTheDocument();
  });

  it('reports the chosen value', async () => {
    const user = userEvent.setup();
    const { onChoose } = renderDialog();
    await user.click(screen.getByLabelText('Do B'));
    expect(onChoose).toHaveBeenCalledWith('b');
  });

  it('cancels without choosing', async () => {
    const user = userEvent.setup();
    const { onChoose, onCancel } = renderDialog();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByText('A question')).toBeNull();
  });
});
