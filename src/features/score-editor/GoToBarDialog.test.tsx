/**
 * Go to bar hands over what was typed, and stays open on a bar that does not exist.
 *
 * What the text *means* is `goToBarFromInput` in music_editing — by the number
 * a reader sees, so on a score with a pickup bar 1 is the second measure. The
 * prompt used to parse the number itself and pass it to `caretToBar`, which
 * counted `index + 1` and landed one bar early on every score with an
 * anacrusis.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GoToBarDialog } from '@/features/score-editor/GoToBarDialog';

function open(onGo: (text: string) => boolean) {
  const onClose = vi.fn();
  render(<GoToBarDialog open barCount={8} onClose={onClose} onGo={onGo} />);
  return { onClose };
}

describe('GoToBarDialog', () => {
  it('passes the typed text through and closes when the bar exists', async () => {
    const onGo = vi.fn(() => true);
    const { onClose } = open(onGo);

    await userEvent.type(screen.getByLabelText('Bar number'), ' 3 {Enter}');

    expect(onGo).toHaveBeenCalledWith(' 3 ');
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open and says so when the bar does not exist', async () => {
    const { onClose } = open(() => false);

    await userEvent.type(screen.getByLabelText('Bar number'), 'abc{Enter}');

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('This score has bars 1 to 8.')).toBeInTheDocument();
  });
});
