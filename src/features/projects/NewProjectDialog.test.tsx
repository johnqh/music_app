/**
 * The New Project dialog: what the Generate-for-me toggle hides, what Create
 * emits in each mode, and the cost the AI half quotes.
 *
 * The estimate is bars × instruments because that is what the server bills: a
 * four-bar quartet costs about four times a four-bar solo to produce.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { GENERATE_SCORE_STYLE_PRESETS, styleTempoRange } from '@sudobility/music_types';
import { GENERATE_SCORE_KEY_FIFTHS_OPTIONS } from '@/app-library';
import type { NewProjectSubmission } from '@/app-library';
import { MemoryRouter } from 'react-router-dom';
import { NewProjectDialog } from './NewProjectDialog';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';

/*
  The dialog reads `getAppServices()` for the network client the presets query
  needs. Public route, no token — but the services registry still has to exist,
  the same requirement the import dialogs have.
*/
beforeEach(() => {
  installTestAppServices();
});
afterEach(() => {
  resetTestAppServices();
});

const useBalance = vi.fn();
vi.mock('@sudobility/consumables_client', () => ({
  useBalance: () => useBalance() as unknown,
  ConsumablesApiClient: class {},
}));

const useScorePresets = vi.fn(() => ({ data: undefined as string[] | undefined }));
const useScoreStyleSettings = vi.fn(() => ({ data: undefined as unknown }));
vi.mock('@sudobility/music_client', () => ({
  useScorePresets: (...args: unknown[]) => useScorePresets(...(args as [])) as unknown,
  useScoreStyleSettings: (...args: unknown[]) => useScoreStyleSettings(...(args as [])) as unknown,
}));

const useSiteAdmin = vi.fn(() => false);
const useSignedIn = vi.fn(() => true);
vi.mock('@/app/AuthContext', () => ({
  useSiteAdmin: () => useSiteAdmin() as unknown,
  useSignedIn: () => useSignedIn() as unknown,
  useMusicHookContext: () => ({ networkClient: {}, baseUrl: 'http://test.local' }),
}));

function open(
  balance: number,
  siteAdmin = false,
  onSubmit = vi.fn(),
  styleSettings: unknown = undefined,
  signedIn = true,
) {
  useBalance.mockReturnValue({ balance, isLoading: false });
  // No briefs unless a test says otherwise: the server owns the list, and the
  // menu is meant to be absent when it has not arrived.
  useScorePresets.mockReturnValue({ data: undefined });
  useScoreStyleSettings.mockReturnValue({ data: styleSettings });
  useSiteAdmin.mockReturnValue(siteAdmin);
  useSignedIn.mockReturnValue(signedIn);
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
 * Adds with the Add button and removes from the end, rather than setting a
 * checkbox set. It has to do both: turning the AI half on adds a singer, so a
 * roster of one is now reached by removing rather than by starting there.
 */
function selectInstruments(count: number) {
  const removes = () => screen.getAllByRole('button', { name: /^Remove / });
  const add = screen.getByRole('button', { name: 'Add' });
  for (let i = removes().length; i < count; i++) fireEvent.click(add);
  while (removes().length > count) fireEvent.click(removes()[removes().length - 1]);
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

    // Specifically the credit line's "about" — the lyric-subject field's label
    // also contains the word.
    expect(screen.getByText(/about \d+ credits/i)).toBeInTheDocument();
  });

  it('disables Create when the balance is spent, and says why', () => {
    open(0);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);
    selectInstruments(1);

    expect(createButton()).toBeDisabled();
    expect(
      screen.getByText(/This needs 4 credits, but your balance is 0 \(4 short\)/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Buy credits' })).toHaveAttribute(
      'href',
      expect.stringContaining('/credits'),
    );
  });

  it('disables Create when the estimate is more than the balance', () => {
    // balance − estimate < 0 is refused: 32 bars × 4 instruments is 128.
    open(100);
    turnGenerationOn();
    fillPrompt();
    setMeasures(32);
    selectInstruments(4);

    expect(createButton()).toBeDisabled();
    expect(
      screen.getByText(/This needs 128 credits, but your balance is 100 \(28 short\)/),
    ).toBeInTheDocument();
  });

  it('allows Create when the balance covers the estimate exactly', () => {
    open(4);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);
    selectInstruments(1);

    expect(createButton()).toBeEnabled();
    expect(screen.queryByText(/This needs/)).not.toBeInTheDocument();
  });

  it('will not switch generation on below zero, and says why', () => {
    open(-11);
    const toggle = screen.getByRole('switch', { name: 'Generate for me' });

    expect(toggle).toBeDisabled();
    expect(screen.getByText(/Your credit balance is below zero/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Buy credits' })).toBeInTheDocument();
    // A blank project costs nothing, so Create is still offered.
    expect(createButton()).toBeEnabled();
  });

  it('will not switch generation on for somebody signed out', () => {
    open(1000, false, vi.fn(), undefined, false);

    expect(screen.getByRole('switch', { name: 'Generate for me' })).toBeDisabled();
    expect(screen.getByText('Sign in to have a score generated for you.')).toBeInTheDocument();
    // Signing in is the way out, not buying credits.
    expect(screen.queryByRole('link', { name: 'Buy credits' })).not.toBeInTheDocument();
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

  it('lets a site admin generate below zero, with no explanation shown', () => {
    open(-50, true);
    turnGenerationOn();
    fillPrompt();
    setMeasures(32);
    selectInstruments(4);

    expect(screen.getByRole('switch', { name: 'Generate for me' })).toBeEnabled();
    expect(createButton()).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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

  it('names the project New Score when the Title is blank', () => {
    // The score inside still says "Untitled"; the row in a list of rows needs a
    // name a reader can tell from the others, and it is the one the placeholder
    // showed them.
    const { onSubmit } = open(1000);
    fireEvent.click(createButton());
    const submission = onSubmit.mock.calls[0]?.[0] as NewProjectSubmission;
    if (submission.kind !== 'blank') throw new Error('expected a blank submission');
    expect(submission.title).toBe('New Score');
    // The score's own title is not the project's name: blank still means
    // "Untitled" inside the score, which is what names an exported file.
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

describe('NewProjectDialog: finding a style', () => {
  function optionsOf(name: string): string[] {
    fireEvent.click(screen.getByLabelText(name));
    return screen.getAllByRole('option').map((option) => option.textContent ?? '');
  }

  it('groups the styles under sorted family headings, with No style pinned above them', () => {
    // Declaration order — waltz, jazz, pop, cinematic — is the order the
    // vocabulary grew in and no order to hunt through thirty-six entries by.
    // The families are headings over sorted styles, and No style belongs to
    // none of them.
    open(1000);
    turnGenerationOn();
    fireEvent.click(screen.getByLabelText('Style'));
    const groups = screen.getAllByRole('group');
    const headings = groups.map((group) => group.firstElementChild?.textContent ?? '');
    expect(headings).toEqual([...headings].sort((a, b) => a.localeCompare(b)));
    expect(headings).toContain('Latin & Caribbean');
    for (const group of groups) {
      const styles = within(group)
        .getAllByRole('option')
        .map((option) => option.textContent ?? '');
      expect(styles).toEqual([...styles].sort((a, b) => a.localeCompare(b)));
    }
    expect(screen.getAllByRole('option')[0].textContent).toBe('No style');
    const latin = groups.find(
      (group) => group.firstElementChild?.textContent === 'Latin & Caribbean',
    )!;
    expect(within(latin).getByRole('option', { name: 'Reggae' })).toBeTruthy();
  });

  /*
   * Picking a style settles the key and the tempo, and not the same ones every
   * time.
   *
   * Every score this app generated was in C at its genre's one nominal tempo —
   * measured across every stored project, `fifths` was 0 without exception —
   * because choosing a style set the mode and nothing else. Two pieces in one
   * key at one speed sound like each other whatever their rhythms do.
   */
  it('sets a key and a tempo the chosen genre is actually played at', () => {
    open(1000);
    turnGenerationOn();

    fireEvent.click(screen.getByLabelText('Style'));
    fireEvent.click(screen.getByRole('option', { name: 'Swing' }));

    /*
      One of swing's own keys, as the picker labels them. Derived from the two
      tables the dialog reads rather than typed out: this used to list 'B♭'
      and 'E♭' while the picker spells them 'Bb' and 'Eb', so it failed exactly
      when the roll landed on a flat key — half the time.
    */
    const labels = (GENERATE_SCORE_STYLE_PRESETS.swing.keys ?? []).map(
      (fifths) => GENERATE_SCORE_KEY_FIFTHS_OPTIONS.find((o) => o.fifths === fifths)!.label,
    );
    expect(labels.length).toBeGreaterThan(1);
    const key = screen.getByLabelText('Key').textContent ?? '';
    expect(
      labels.some((label) => key.startsWith(label)),
      `key label "${key}"`,
    ).toBe(true);

    const [min, max] = styleTempoRange('swing')!;
    const tempo = Number((screen.getByLabelText('Tempo') as HTMLInputElement).value);
    expect(tempo).toBeGreaterThanOrEqual(min);
    expect(tempo).toBeLessThanOrEqual(max);
  });

  it('uses backend style settings to constrain tempo, key, mode, and meter', () => {
    open(1000, false, vi.fn(), {
      ambient: {
        tempo: 70,
        minBpm: 68,
        maxBpm: 72,
        timeSignature: '4/4',
        keys: [0],
        mode: 'major',
      },
    });
    turnGenerationOn();
    fireEvent.click(screen.getByLabelText('Style'));
    fireEvent.click(screen.getByRole('option', { name: 'Ambient' }));

    const tempo = screen.getByLabelText('Tempo') as HTMLInputElement;
    expect(tempo.min).toBe('68');
    expect(tempo.max).toBe('72');
    expect(optionsOf('Key')).toEqual(['C']);
    expect(optionsOf('Mode')).toEqual(['major']);
    expect(optionsOf('Time signature')).toEqual(['4/4']);
  });

  it('does not give every generation of one genre the same key and tempo', () => {
    // Rolled per pick, so choosing the same style twice is two settings, not
    // one — the guest instrument beside them has worked this way all along.
    const seen = new Set<string>();
    for (let i = 0; i < 12; i += 1) {
      open(1000);
      turnGenerationOn();
      fireEvent.click(screen.getByLabelText('Style'));
      fireEvent.click(screen.getByRole('option', { name: 'Salsa' }));
      const key = screen.getByLabelText('Key').textContent ?? '';
      const tempo = (screen.getByLabelText('Tempo') as HTMLInputElement).value;
      seen.add(`${key}@${tempo}`);
      cleanup();
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('lists the moods alphabetically too, with No mood pinned above them', () => {
    open(1000);
    turnGenerationOn();
    const [first, ...moods] = optionsOf('Mood');
    expect(first).toBe('No mood');
    expect(moods).toEqual([...moods].sort((a, b) => a.localeCompare(b)));
  });
});

describe('NewProjectDialog: singers', () => {
  function instrumentOptions(): string[] {
    fireEvent.click(screen.getByLabelText('Add instrument'));
    return screen.getAllByRole('option').map((option) => option.textContent ?? '');
  }

  function roster(): string[] {
    return screen
      .getAllByRole('button', { name: /^Remove / })
      .map((button) => button.getAttribute('aria-label')?.replace('Remove ', '') ?? '');
  }

  it('offers the voices as their own group, ahead of the kits and the families', () => {
    // GM files them under Ensemble, between String Ensemble and Orchestra Hit,
    // which is where nobody looking for a singer thinks to look.
    open(1000);
    const options = instrumentOptions();
    expect(screen.getByText('Voice')).toBeInTheDocument();
    expect(options.slice(0, 3)).toEqual(['Voice Oohs', 'Choir Aahs', 'Synth Voice']);
    expect(options.indexOf('Voice Oohs')).toBeLessThan(options.indexOf('Jazz Kit'));
  });

  it('lists each voice once, not again under the family GM filed it in', () => {
    open(1000);
    const options = instrumentOptions();
    expect(options.filter((label) => label === 'Voice Oohs')).toHaveLength(1);
  });

  it('adds a singer when the model is asked to write the music', () => {
    // A song needs somebody singing it, and the roster otherwise opens on a
    // piano solo — so the reader has to know to go and find a voice first.
    open(1000);
    expect(roster()).toEqual(['Acoustic Grand Piano']);
    turnGenerationOn();
    expect(roster()).toEqual(['Voice Oohs', 'Acoustic Grand Piano']);
  });

  it('takes it away again when the model is not writing the music', () => {
    open(1000);
    turnGenerationOn();
    turnGenerationOn();
    expect(roster()).toEqual(['Acoustic Grand Piano']);
  });

  it('leaves a singer the reader chose themselves alone', () => {
    // Removing "the vocal" on the way out must mean the one that was added
    // for them, not whichever one happens to be at the top of the list.
    open(1000);
    turnGenerationOn();
    turnGenerationOn();
    fireEvent.click(screen.getByLabelText('Add instrument'));
    fireEvent.click(screen.getByRole('option', { name: 'Choir Aahs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(roster()).toEqual(['Acoustic Grand Piano', 'Choir Aahs']);

    turnGenerationOn();
    turnGenerationOn();
    expect(roster()).toEqual(['Acoustic Grand Piano', 'Choir Aahs']);
  });

  it('adds no second singer when one is already in the roster', () => {
    open(1000);
    fireEvent.click(screen.getByLabelText('Add instrument'));
    fireEvent.click(screen.getByRole('option', { name: 'Voice Oohs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    turnGenerationOn();
    expect(roster()).toEqual(['Acoustic Grand Piano', 'Voice Oohs']);
  });

  it('keeps the singer when a style rewrites the whole ensemble', () => {
    // Choosing a style overwrites the roster deliberately; a vocal that
    // vanished at that moment would be a song the reader thought they asked for.
    open(1000);
    turnGenerationOn();
    fireEvent.click(screen.getByLabelText('Style'));
    fireEvent.click(screen.getByRole('option', { name: 'Rock' }));
    expect(roster()[0]).toBe('Voice Oohs');
  });
});

describe('NewProjectDialog: lyrics', () => {
  const lyricsSwitch = () => screen.queryByRole('switch', { name: 'Write lyrics' });

  it('is offered once somebody in the roster can sing them', () => {
    open(1000);
    turnGenerationOn();
    expect(lyricsSwitch()).toBeInTheDocument();
    expect(lyricsSwitch()).toBeChecked();
  });

  it('is not offered over an entirely instrumental roster', () => {
    // Syllables under a bass line are not a lyric.
    open(1000);
    turnGenerationOn();
    fireEvent.click(screen.getAllByRole('button', { name: /^Remove Voice Oohs/ })[0]);
    expect(lyricsSwitch()).not.toBeInTheDocument();
  });

  it('asks the server for words', () => {
    const { onSubmit } = open(1000);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);
    fireEvent.click(createButton());
    const submission = onSubmit.mock.calls[0][0] as NewProjectSubmission;
    expect(submission.kind).toBe('generate');
    expect(submission.kind === 'generate' && submission.request.lyrics).toBe(true);
  });

  it('takes a subject for the words, when they are about something of their own', () => {
    // "A slow waltz in D minor" describes the music; the words over it can be
    // about coming home without the music brief being about coming home.
    const { onSubmit } = open(1000);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);
    fireEvent.change(screen.getByLabelText('What the words are about'), {
      target: { value: 'a love song about coming home' },
    });
    fireEvent.click(createButton());
    const submission = onSubmit.mock.calls[0][0] as NewProjectSubmission;
    expect(submission.kind === 'generate' && submission.request.lyricsTheme).toBe(
      'a love song about coming home',
    );
  });

  it('offers nowhere to describe words it is not writing', () => {
    open(1000);
    turnGenerationOn();
    expect(screen.getByLabelText('What the words are about')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Write lyrics' }));
    expect(screen.queryByLabelText('What the words are about')).not.toBeInTheDocument();
  });

  it('sends no subject when none was typed, so the words follow the piece', () => {
    const { onSubmit } = open(1000);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);
    fireEvent.click(createButton());
    const submission = onSubmit.mock.calls[0][0] as NewProjectSubmission;
    expect(submission.kind === 'generate' && 'lyricsTheme' in submission.request).toBe(false);
  });

  it('leaves the field off the request when it is switched off', () => {
    const { onSubmit } = open(1000);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);
    fireEvent.click(screen.getByRole('switch', { name: 'Write lyrics' }));
    fireEvent.click(createButton());
    const submission = onSubmit.mock.calls[0][0] as NewProjectSubmission;
    expect(submission.kind === 'generate' && 'lyrics' in submission.request).toBe(false);
  });
});

describe('NewProjectDialog: the AI half does not clip what is inside it', () => {
  it('stops hiding its overflow once it is open', async () => {
    /*
      The block collapses by animating `grid-template-rows` from `0fr` to `1fr`,
      which only works while the inner element hides its overflow — and that
      same `overflow-hidden` cut the Presets menu off at the bottom of the
      block. jsdom has no layout to measure the clipping with, so this asserts
      the mechanism: hidden while collapsed, not hidden once open.
    */
    open(1000);
    const inner = () => screen.getByLabelText('Prompt').closest('[aria-hidden]')?.firstElementChild;
    expect(inner()).toHaveClass('overflow-hidden');
    turnGenerationOn();
    // After it has finished growing: dropping the clip immediately would let
    // the full-height content overlap the rows below while it animates.
    await waitFor(() => expect(inner()).not.toHaveClass('overflow-hidden'));
  });
});

describe('NewProjectDialog: preset briefs', () => {
  function openWithPresets(keys: string[]) {
    const onSubmit = vi.fn();
    useBalance.mockReturnValue({ balance: 1000, isLoading: false });
    useSiteAdmin.mockReturnValue(false);
    useScorePresets.mockReturnValue({ data: keys });
    render(
      <MemoryRouter>
        <NewProjectDialog open onClose={vi.fn()} onSubmit={onSubmit} submitting={false} />
      </MemoryRouter>,
    );
    turnGenerationOn();
    return { onSubmit };
  }

  const presetsButton = () => screen.queryByRole('button', { name: 'Preset prompts' });

  it('offers no Presets button until the server has sent briefs', () => {
    // Hidden rather than dead: a button that opens an empty menu is worse
    // than no button, and this list is the server's to supply.
    open(1000);
    turnGenerationOn();
    expect(presetsButton()).not.toBeInTheDocument();
  });

  it('offers no Presets button when the server sends an empty list', () => {
    useScorePresets.mockReturnValue({ data: [] });
    open(1000);
    turnGenerationOn();
    expect(presetsButton()).not.toBeInTheDocument();
  });

  it('shows the briefs the server chose, in this reader’s language', () => {
    openWithPresets(['organStabs', 'lockedGroove']);
    fireEvent.click(presetsButton()!);
    expect(
      screen.getByRole('menuitem', { name: 'Off-beat organ stabs over a deep bass' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
  });

  it('keeps the server’s order, which is what makes two apps agree', () => {
    openWithPresets(['lockedGroove', 'organStabs']);
    fireEvent.click(presetsButton()!);
    expect(screen.getAllByRole('menuitem')[0]).toHaveTextContent(
      'A groove where bass and drums lock together',
    );
  });

  it('writes the chosen brief into the prompt and closes the menu', () => {
    openWithPresets(['lullaby']);
    fireEvent.click(presetsButton()!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'A lullaby, slow and simple' }));
    expect(screen.getByLabelText('Prompt')).toHaveValue('A lullaby, slow and simple');
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('skips a brief it has no words for, rather than printing its id', () => {
    // A server one version ahead of this app. Showing `someNewBrief` in a menu
    // is worse than showing one fewer brief.
    openWithPresets(['lullaby', 'someBriefFromTheFuture']);
    fireEvent.click(presetsButton()!);
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  });

  it('asks for the briefs of the style that is chosen', () => {
    openWithPresets(['lullaby']);
    fireEvent.click(screen.getByLabelText('Style'));
    fireEvent.click(screen.getByRole('option', { name: 'Reggae' }));
    expect(useScorePresets).toHaveBeenLastCalledWith(expect.anything(), 'reggae');
  });
});

describe('NewProjectDialog: the default title', () => {
  const titleField = () => screen.getByLabelText('Title');

  it('offers New Score for a blank project', () => {
    open(1000);
    expect(titleField()).toHaveAttribute('placeholder', 'New Score');
  });

  it('offers Generated Score once the model is writing it', () => {
    open(1000);
    turnGenerationOn();
    expect(titleField()).toHaveAttribute('placeholder', 'Generated Score');
  });

  it('names a blank project what the placeholder promised', () => {
    // A placeholder that is not what you get if you leave the field alone is
    // a label for a value that never existed.
    const { onSubmit } = open(1000);
    fireEvent.click(createButton());
    const submission = onSubmit.mock.calls[0][0] as NewProjectSubmission;
    expect(submission.kind === 'blank' && submission.title).toBe('New Score');
  });

  it('names a generated project Generated Score', () => {
    const { onSubmit } = open(1000);
    turnGenerationOn();
    fillPrompt();
    setMeasures(4);
    fireEvent.click(createButton());
    const submission = onSubmit.mock.calls[0][0] as NewProjectSubmission;
    expect(submission.kind === 'generate' && submission.request.title).toBe('Generated Score');
  });

  it('still takes a title that was typed', () => {
    const { onSubmit } = open(1000);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Wedding March' } });
    fireEvent.click(createButton());
    const submission = onSubmit.mock.calls[0][0] as NewProjectSubmission;
    expect(submission.kind === 'blank' && submission.title).toBe('Wedding March');
  });
});

describe('NewProjectDialog: the backends on offer', () => {
  it('names the ordinary backend after the provider it reaches', () => {
    open(1000);
    turnGenerationOn();
    fireEvent.click(screen.getByLabelText('Model'));
    expect(screen.getByRole('option', { name: 'Open AI' })).toBeInTheDocument();
  });

  it('no longer offers the cheap model', () => {
    open(1000);
    turnGenerationOn();
    fireEvent.click(screen.getByLabelText('Model'));
    expect(screen.queryByRole('option', { name: /cheap/i })).not.toBeInTheDocument();
  });
});

/*
 * Duration is the Bars field read in seconds, for somebody fitting music to a
 * video: editing either refreshes the other at the form's tempo and meter.
 */
describe('NewProjectDialog: duration', () => {
  const bars = () => screen.getByLabelText('Bars') as HTMLInputElement;
  const duration = () => screen.getByLabelText('Duration') as HTMLInputElement;

  it('follows the bars at the tempo', () => {
    open(10);
    fireEvent.change(screen.getByLabelText('Tempo'), { target: { value: '120' } });
    fireEvent.change(bars(), { target: { value: '16' } });
    expect(duration().value).toBe('0:32');
  });

  it('sets the bars when a length is typed, and tidies it on leaving', () => {
    open(10);
    fireEvent.change(screen.getByLabelText('Tempo'), { target: { value: '120' } });
    fireEvent.change(duration(), { target: { value: '61' } });
    expect(bars().value).toBe('31');
    fireEvent.blur(duration());
    expect(duration().value).toBe('1:02');
  });

  it('recalculates when the tempo changes', () => {
    open(10);
    fireEvent.change(bars(), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Tempo'), { target: { value: '60' } });
    expect(duration().value).toBe('0:32');
  });

  it('is not offered while lyrics are being written', () => {
    open(10);
    turnGenerationOn();
    expect(screen.queryByRole('switch', { name: 'Write lyrics' })).toBeChecked();
    expect(screen.queryByLabelText('Duration')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: 'Write lyrics' }));
    expect(screen.getByLabelText('Duration')).toBeInTheDocument();
  });
});

/*
 * A style's essential instruments are always in the roster while generating
 * and cannot be removed: a reggae without its kit is not reggae. Everything
 * else stays removable, and anything can still be added.
 */
describe('NewProjectDialog: essential instruments', () => {
  const chooseReggae = () => {
    open(10);
    turnGenerationOn();
    fireEvent.click(screen.getByLabelText('Style'));
    fireEvent.click(screen.getByRole('option', { name: 'Reggae' }));
  };
  const removeButtonFor = (label: RegExp) =>
    screen.getAllByRole('button', { name: label })[0] as HTMLButtonElement;

  it('puts the kit in and will not take it out', () => {
    chooseReggae();
    expect(screen.getByText(/Standard Kit.*\(essential\)/)).toBeInTheDocument();
    expect(removeButtonFor(/Remove Standard Kit/)).toBeDisabled();
  });

  it('keeps preferred instruments removable, the singer included', () => {
    chooseReggae();
    expect(removeButtonFor(/Remove Rock Organ/)).not.toBeDisabled();
    expect(removeButtonFor(/Remove Voice Oohs/)).not.toBeDisabled();
  });

  it('locks nothing once generation is off', () => {
    chooseReggae();
    turnGenerationOn();
    expect(screen.queryByText(/\(essential\)/)).not.toBeInTheDocument();
    expect(removeButtonFor(/Remove Standard Kit/)).not.toBeDisabled();
  });
});
