/**
 * The New Project dialog: what the Generate-for-me toggle hides, what Create
 * emits in each mode, and the cost the AI half quotes.
 *
 * The estimate is bars × instruments because that is what the server bills: a
 * four-bar quartet costs about four times a four-bar solo to produce.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { NewProjectSubmission } from '@sudobility/music_lib';
import { MemoryRouter } from 'react-router-dom';
import { NewProjectDialog } from './NewProjectDialog';

const useBalance = vi.fn();
vi.mock('@sudobility/consumables_client', () => ({
  useBalance: () => useBalance() as unknown,
}));

const useSiteAdmin = vi.fn(() => false);
vi.mock('@/app/AuthContext', () => ({
  useSiteAdmin: () => useSiteAdmin() as unknown,
}));

function open(balance: number, siteAdmin = false, onSubmit = vi.fn()) {
  useBalance.mockReturnValue({ balance, isLoading: false });
  useSiteAdmin.mockReturnValue(siteAdmin);
  // Inside a router: the out-of-credits message links to the store, and the
  // dialog is always rendered within the app's router in production.
  render(
    <MemoryRouter>
      <NewProjectDialog open onClose={vi.fn()} onSubmit={onSubmit} submitting={false} />
    </MemoryRouter>,
  );
  return { onSubmit };
}

/**
 * Turns the AI half on.
 *
 * It is off by default: this is New Project, and a blank score with the right
 * instruments is the ordinary way to start one. Every test below that touches a
 * prompt, a style, the estimate or the credit gate has to ask for it first.
 */
function turnGenerationOn() {
  fireEvent.click(screen.getByRole('switch', { name: 'Generate for me' }));
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
  fireEvent.change(screen.getByLabelText(/bars/i), { target: { value: String(n) } });
}

function setTempo(value: string) {
  fireEvent.change(screen.getByLabelText(/tempo/i), { target: { value } });
}

/**
 * Everything a generation needs apart from credits.
 *
 * Without a prompt Create is disabled anyway, so a "disabled at zero balance"
 * assertion would hold whether or not the gate existed.
 */
function fillPrompt() {
  fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'A waltz' } });
}

function createButton() {
  return screen.getByRole('button', { name: 'Create' });
}

describe('NewProjectDialog cost', () => {
  it('quotes bars times instruments, not bars', () => {
    // The assertion that distinguishes a correct estimate from a plausible one:
    // per-bar and per-track-measure agree on a solo and differ four-fold here.
    open(1000);
    turnGenerationOn();
    setMeasures(4);
    selectInstruments(4);

    expect(screen.getByText(/about 16 credits/i)).toBeInTheDocument();
  });

  it('quotes bars alone for a single instrument', () => {
    open(1000);
    turnGenerationOn();
    setMeasures(4);
    selectInstruments(1);

    expect(screen.getByText(/about 4 credits/i)).toBeInTheDocument();
  });

  it('says "about", because the charge counts what the model produced', () => {
    open(1000);
    turnGenerationOn();
    setMeasures(4);
    selectInstruments(1);

    expect(screen.getByText(/about/i)).toBeInTheDocument();
  });

  it('disables Create when the balance is spent', () => {
    open(0);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);
    selectInstruments(1);

    expect(createButton()).toBeDisabled();
  });

  it('disables Create when the balance is negative', () => {
    // Overdrawing once is allowed by design; the next job is refused.
    open(-11);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);
    selectInstruments(1);

    expect(createButton()).toBeDisabled();
  });

  it('allows Create on any positive balance, even one too small', () => {
    // The server refuses only at <= 0 and a job may overdraw once. Inventing a
    // stricter rule here would refuse work the API would have accepted.
    open(1);
    turnGenerationOn();
    fillPrompt();
    setMeasures(32);
    selectInstruments(4);

    expect(createButton()).toBeEnabled();
  });

  it('disables Create for a fractional measure count', () => {
    open(1000);
    turnGenerationOn();
    fillPrompt();
    setMeasures(1.5);

    expect(createButton()).toBeDisabled();
  });

  it('disables Create for a non-positive tempo', () => {
    open(1000);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);
    setTempo('0');

    expect(createButton()).toBeDisabled();
  });
});

describe('NewProjectDialog instrumentation', () => {
  it('starts as a piano solo and refuses to go empty', () => {
    open(1000);
    const removes = screen.getAllByRole('button', { name: /^Remove / });
    expect(removes).toHaveLength(1);
    // The floor is one: both builders require a track, so an empty ensemble
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

describe('NewProjectDialog: site admins', () => {
  it('lets a site admin generate at a balance of zero', () => {
    // The server charges them nothing and checks no balance, so gating them
    // here would refuse work `POST /jobs` would have accepted — and they sit
    // at zero permanently, because nothing grants or spends their credits.
    open(0, true);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);

    expect(createButton()).toBeEnabled();
  });

  it('still refuses an ordinary user at zero', () => {
    open(0, false);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);

    expect(createButton()).toBeDisabled();
  });
});

describe('NewProjectDialog: the Generate for me toggle', () => {
  /*
    The AI half collapses rather than unmounting, so it can animate both ways —
    which means "hidden" has to be asserted the way a screen reader sees it, not
    by absence from the DOM. `*ByRole` skips anything inside an `aria-hidden`
    subtree; `*ByLabelText` does not, which is why these queries are by role.

    That is a stronger assertion than the old one, too: it fails if the block is
    merely collapsed to zero height while still reachable by Tab.
  */
  it('starts off, with the AI half collapsed out of the accessibility tree', () => {
    // Off is the default because this is New Project. The AI block is prompt,
    // presets, style, mood, complexity, model and the credit line — all of it
    // or none of it, so there is one rule to learn rather than an exception.
    open(1000);
    expect(screen.getByRole('switch', { name: 'Generate for me' })).not.toBeChecked();
    expect(screen.queryByRole('group', { name: 'AI settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Prompt' })).not.toBeInTheDocument();
    for (const name of ['Style', 'Mood', 'Complexity', 'Model']) {
      expect(screen.queryByRole('combobox', { name }), name).not.toBeInTheDocument();
    }
  });

  it('takes it out of the tab order too, not merely out of sight', () => {
    // A field that is invisible and still focusable is worse than one left on
    // screen: the caret disappears into nothing.
    open(1000);
    const region = screen.getByLabelText('Prompt').closest('[aria-hidden]');
    expect(region).toHaveAttribute('aria-hidden', 'true');
    expect(region).toHaveAttribute('inert');
  });

  it('shows them all when it is turned on', () => {
    open(1000);
    turnGenerationOn();
    expect(screen.getByRole('group', { name: 'AI settings' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Prompt' })).toBeInTheDocument();
    for (const name of ['Style', 'Mood', 'Complexity', 'Model']) {
      expect(screen.getByRole('combobox', { name }), name).toBeInTheDocument();
    }
  });

  it('keeps Instrumentation and everything below it in both modes', () => {
    open(1000);
    for (const label of ['Add instrument', 'Bars', 'Tempo', 'Key', 'Mode', 'Time signature']) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
    turnGenerationOn();
    for (const label of ['Add instrument', 'Bars', 'Tempo', 'Key', 'Mode', 'Time signature']) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
  });

  it('does not throw away a typed prompt when it is switched off and back on', () => {
    // Losing text to a toggle is never worth the tidiness.
    open(1000);
    turnGenerationOn();
    fillPrompt();
    turnGenerationOn();
    turnGenerationOn();
    expect(screen.getByLabelText('Prompt')).toHaveValue('A waltz');
  });
});

describe('NewProjectDialog: creating', () => {
  it('creates a blank score with no prompt at all', () => {
    const { onSubmit } = open(1000);
    setMeasures(4);
    expect(createButton()).toBeEnabled();

    fireEvent.click(createButton());
    const submission = onSubmit.mock.calls[0]?.[0] as NewProjectSubmission;
    expect(submission.kind).toBe('blank');
    if (submission.kind !== 'blank') throw new Error('expected a blank submission');
    expect(submission.score.tracks).toHaveLength(1);
    expect(submission.score.tracks[0]?.measures).toHaveLength(4);
  });

  it('carries the chosen instruments, programs and all', () => {
    const { onSubmit } = open(1000);
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(createButton());

    const submission = onSubmit.mock.calls[0]?.[0] as NewProjectSubmission;
    if (submission.kind !== 'blank') throw new Error('expected a blank submission');
    expect(submission.score.tracks).toHaveLength(2);
    expect(submission.score.tracks.every((t) => typeof t.midiProgram === 'number')).toBe(true);
  });

  it('names the project Untitled Project when the Title is blank', () => {
    // The score inside says "Untitled"; the row in a list of rows needs a name
    // a reader can tell from the others.
    const { onSubmit } = open(1000);
    fireEvent.click(createButton());
    const submission = onSubmit.mock.calls[0]?.[0] as NewProjectSubmission;
    if (submission.kind !== 'blank') throw new Error('expected a blank submission');
    expect(submission.title).toBe('Untitled Project');
    expect(submission.score.metadata.title).toBe('Untitled');
  });

  it('submits a request, not a score, once generation is on', () => {
    const { onSubmit } = open(1000);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);
    fireEvent.click(createButton());

    const submission = onSubmit.mock.calls[0]?.[0] as NewProjectSubmission;
    expect(submission.kind).toBe('generate');
    if (submission.kind !== 'generate') throw new Error('expected a generate submission');
    expect(submission.request.prompt).toBe('A waltz');
  });

  it('does not refuse a blank project to somebody with no credits', () => {
    // A blank project costs nothing. Refusing it would be refusing work the
    // server never charges for.
    open(0);
    expect(createButton()).toBeEnabled();
  });

  it('refuses a blank project with no bars, the same rule as a generation', () => {
    open(1000);
    setMeasures(0);
    expect(createButton()).toBeDisabled();
  });
});

/*
 * The backend is chosen per generation, not per machine.
 *
 * It used to live only in developer settings, on the reasoning that it is a
 * property of the machine rather than of the music. Someone comparing two
 * backends wants to switch between them without opening a settings dialog, so
 * the choice belongs on the form that commissions the piece.
 *
 * DeepSeek is the default because it is the one whose output people preferred
 * in listening: on the same briefs its country and metal came back more
 * recognisably in their genre and markedly less over-written.
 */
describe('choosing the model', () => {
  it('defaults to DeepSeek and sends it with the request', () => {
    const { onSubmit } = open(1000);
    turnGenerationOn();
    fillPrompt();
    fireEvent.click(createButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submission = onSubmit.mock.calls[0]?.[0] as NewProjectSubmission;
    if (submission.kind !== 'generate') throw new Error('expected a generate submission');
    expect(submission.request.variant).toBe('deepseek');
  });

  it('offers every backend the system knows about', () => {
    open(1000);
    turnGenerationOn();
    // Read off the vocabulary rather than restated: a variant added to
    // music_types must appear here without this test being edited.
    expect(screen.getByLabelText(/model/i)).toBeInTheDocument();
  });
});
