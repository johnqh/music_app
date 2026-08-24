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

const useSiteAdmin = vi.fn(() => false);
vi.mock('@/app/AuthContext', () => ({
  useSiteAdmin: () => useSiteAdmin() as unknown,
}));

function open(balance: number, siteAdmin = false) {
  useBalance.mockReturnValue({ balance, isLoading: false });
  useSiteAdmin.mockReturnValue(siteAdmin);
  // Inside a router: the out-of-credits message links to the store, and the
  // dialog is always rendered within the app's router in production.
  return render(
    <MemoryRouter>
      <GenerateScoreDialog open onClose={vi.fn()} onSubmit={vi.fn()} submitting={false} />
    </MemoryRouter>,
  );
}

/**
 * Brings the ensemble to exactly `count` instruments.
 *
 * The dialog starts with one (Piano) and refuses to drop below one, so this
 * adds the remainder with the Add button rather than setting a checkbox set.
 */
function selectInstruments(count: number) {
  const add = screen.getByRole('button', { name: 'Add' });
  const current = screen.getAllByRole('button', { name: /^Remove / }).length;
  for (let i = current; i < count; i++) fireEvent.click(add);
}

function setMeasures(n: number) {
  fireEvent.change(screen.getByLabelText(/measures/i), { target: { value: String(n) } });
}

function setTempo(value: string) {
  fireEvent.change(screen.getByLabelText(/tempo/i), { target: { value } });
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

  it('disables Generate for a fractional measure count', () => {
    open(1000);
    fillPrompt();
    setMeasures(1.5);

    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();
  });

  it('disables Generate for a non-positive tempo', () => {
    open(1000);
    fillPrompt();
    setMeasures(4);
    setTempo('0');

    expect(screen.getByRole('button', { name: /generate/i })).toBeDisabled();
  });
});

describe('GenerateScoreDialog instrumentation', () => {
  it('starts as a piano solo and refuses to go empty', () => {
    open(1000);
    const removes = screen.getAllByRole('button', { name: /^Remove / });
    expect(removes).toHaveLength(1);
    // The floor is one: `canGenerate` requires a track, so an empty ensemble
    // would be a form you cannot submit from.
    expect(removes[0]).toBeDisabled();
  });

  it('offers the whole catalogue, kits included', () => {
    open(1000);
    fireEvent.click(screen.getByLabelText('Add instrument'));
    // A kit, a melodic program from the far end of the table, and a family
    // heading — the three things the old six-checkbox list could not show.
    expect(screen.getByRole('option', { name: 'Jazz Kit' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gunshot' })).toBeInTheDocument();
    expect(screen.getByText('Sound Effects')).toBeInTheDocument();
  });

  it('marks the first non-percussion track as the one carrying the melody', () => {
    // `classifyTrackRole` gives melody to the first treble-clef track, so the
    // label has to follow that rule rather than simply meaning "first".
    open(1000);
    expect(screen.getByText(/1\. Acoustic Grand Piano \(melody\)/)).toBeInTheDocument();
  });

  it('adds the chosen instrument, and can add the same one twice', () => {
    open(1000);
    const add = screen.getByRole('button', { name: 'Add' });
    fireEvent.click(add);
    fireEvent.click(add);
    // Two violins is a real ensemble, so repeats are allowed rather than
    // silently collapsed the way a Set would.
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(3);
  });

  it('removes the instrument that was asked for', () => {
    open(1000);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: /^Remove / })[1]);
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(1);
  });
});

describe('GenerateScoreDialog: site admins', () => {
  it('lets a site admin generate at a balance of zero', () => {
    // The server charges them nothing and checks no balance, so gating them
    // here would refuse work `POST /jobs` would have accepted — and they sit
    // at zero permanently, because nothing grants or spends their credits.
    open(0, true);
    fillPrompt();
    setMeasures(4);

    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled();
  });

  it('still refuses an ordinary user at zero', () => {
    open(0, false);
    fillPrompt();
    setMeasures(4);

    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
  });
});
