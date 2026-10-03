/**
 * The rule every async CTA in the app follows: while the work it started is
 * running, the button itself is a spinner, says it is busy, and a second press
 * does nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PendingButton } from '@/components/controls/PendingButton';
import { usePendingAction } from '@/hooks/usePendingAction';

afterEach(cleanup);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Harness({ work }: { work: () => Promise<void> }) {
  const [pending, run] = usePendingAction();
  return (
    <PendingButton pending={pending} pendingLabel="Saving…" onClick={() => void run(work)}>
      Save
    </PendingButton>
  );
}

describe('PendingButton', () => {
  it('spins, says it is busy and refuses a press while pending', () => {
    const onClick = vi.fn();
    render(
      <PendingButton pending pendingLabel="Saving…" onClick={onClick}>
        Save
      </PendingButton>,
    );
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('button-spinner')).toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('replaces an icon button glyph with the spinner and keeps its name', () => {
    render(
      <PendingButton pending aria-label="Quantize">
        <svg data-testid="glyph" />
      </PendingButton>,
    );
    expect(screen.getByRole('button', { name: 'Quantize' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('glyph')).toBeNull();
    expect(screen.getByTestId('button-spinner')).toBeInTheDocument();
  });

  it('is an ordinary button when not pending', () => {
    render(<PendingButton pendingLabel="Saving…">Save</PendingButton>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-busy');
    expect(screen.queryByTestId('button-spinner')).toBeNull();
  });
});

describe('usePendingAction', () => {
  it('holds the button pending until the work settles, and runs it once for two presses', async () => {
    const gate = deferred();
    const work = vi.fn(() => gate.promise);
    render(<Harness work={work} />);

    const button = screen.getByRole('button', { name: 'Save' });
    // Two presses in the same tick: the second lands before React has
    // re-rendered the button disabled, so only the ref guard can refuse it.
    act(() => {
      button.click();
      button.click();
    });
    expect(work).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('clears pending when the work fails', async () => {
    const failing = vi.fn(() => Promise.reject(new Error('no')));
    function Failing() {
      const [pending, run] = usePendingAction();
      return (
        <PendingButton
          pending={pending}
          pendingLabel="Saving…"
          onClick={() => void run(failing).catch(() => {})}
        >
          Save
        </PendingButton>
      );
    }
    render(<Failing />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(failing).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
