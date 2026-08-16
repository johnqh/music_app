/**
 * The cost the Generate dialog quotes, and the gate it applies.
 *
 * The estimate is bars × instruments because that is what the server bills: a
 * four-bar quartet costs about four times a four-bar solo to produce.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GenerateScoreDialog } from './GenerateScoreDialog';

const useBalance = vi.fn();
vi.mock('@sudobility/consumables_client', () => ({
  useBalance: () => useBalance() as unknown,
}));

function open(balance: number) {
  useBalance.mockReturnValue({ balance, isLoading: false });
  // Inside a router: the out-of-credits message links to the store, and the
  // dialog is always rendered within the app's router in production.
  return render(
    <MemoryRouter>
      <GenerateScoreDialog open onClose={vi.fn()} onSubmit={vi.fn()} submitting={false} />
    </MemoryRouter>,
  );
}

/** Turns on `count` instrument checkboxes beyond whatever is on by default. */
function selectInstruments(count: number) {
  const boxes = screen.getAllByRole('checkbox');
  boxes.forEach((box) => {
    if ((box as HTMLInputElement).checked) fireEvent.click(box);
  });
  boxes.slice(0, count).forEach((box) => fireEvent.click(box));
}

function setMeasures(n: number) {
  fireEvent.change(screen.getByLabelText(/measures/i), { target: { value: String(n) } });
}

/**
 * Everything Generate needs apart from credits.
 *
 * Without a prompt the button is disabled anyway, so a "disabled at zero
 * balance" assertion would hold whether or not the gate existed.
 */
function fillPrompt() {
  fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A waltz' } });
}

describe('GenerateScoreDialog cost', () => {
  it('quotes bars times instruments, not bars', () => {
    // The assertion that distinguishes a correct estimate from a plausible one:
    // per-bar and per-track-measure agree on a solo and differ four-fold here.
    open(1000);
    setMeasures(4);
    selectInstruments(4);

    expect(screen.getByText(/about 16 credits/i)).toBeInTheDocument();
  });

  it('quotes bars alone for a single instrument', () => {
    open(1000);
    setMeasures(4);
    selectInstruments(1);

    expect(screen.getByText(/about 4 credits/i)).toBeInTheDocument();
  });

  it('says "about", because the charge counts what the model produced', () => {
    open(1000);
    setMeasures(4);
    selectInstruments(1);

    expect(screen.getByText(/about/i)).toBeInTheDocument();
  });

  it('disables Generate when the balance is spent', () => {
    open(0);
    fillPrompt();
    setMeasures(4);
    selectInstruments(1);

    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();
  });

  it('disables Generate when the balance is negative', () => {
    // Overdrawing once is allowed by design; the next job is refused.
    open(-11);
    fillPrompt();
    setMeasures(4);
    selectInstruments(1);

    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();
  });

  it('allows Generate on any positive balance, even one too small', () => {
    // The server refuses only at <= 0 and a job may overdraw once. Inventing a
    // stricter rule here would refuse work the API would have accepted.
    open(1);
    fillPrompt();
    setMeasures(32);
    selectInstruments(4);

    expect(screen.getByRole('button', { name: /generate/i })).toBeEnabled();
  });
});
