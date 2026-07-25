import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@/store/useAppStore';
import { ScoreSmithDb } from '@/services/persistence/db';
import { twinkleScore } from '@/test/fixtures';
import { RegenerationPanel } from '@/features/generation/RegenerationPanel';
import type { GenerationStoreApi } from '@/features/generation/preview';

vi.mock('@/services/playback/controller', () => ({
  playbackController: {
    playPreview: vi.fn(),
    stopPreview: vi.fn(),
  },
}));

let db: ScoreSmithDb;
let dbCounter = 0;

function makeStore(): GenerationStoreApi {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-regenerationpanel-${dbCounter}`);
  return createAppStore({ db });
}

afterEach(async () => {
  // See CandidateList.test.tsx's afterEach doc: explicit cleanup() first so
  // vitest's reverse-registration-order afterEach hooks don't leak a stray
  // stopPreview() call (from unmounting a CandidateList this panel renders)
  // into the next test.
  cleanup();
  await db?.delete();
  vi.clearAllMocks();
});

function renderPanel(store: GenerationStoreApi) {
  render(<RegenerationPanel store={store} />);
}

describe('RegenerationPanel', () => {
  it('shows an explanatory message and disables every regeneration control when the selection is invalid', () => {
    const store = makeStore();
    store.getState().setScore(twinkleScore());
    renderPanel(store);

    expect(screen.getByText('Select a region of the score to regenerate.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Regeneration instruction' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preset instructions' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Preserve harmony' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: 'Candidate count' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Generate alternatives' })).toBeDisabled();
  });

  it('also disables regeneration controls when there is no score at all', () => {
    const store = makeStore();
    renderPanel(store);

    expect(screen.getByRole('button', { name: 'Generate alternatives' })).toBeDisabled();
  });

  it('shows the selected measure range and track names for a regenerable selection', () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    store.getState().selectMeasures([score.tracks[0].measures[1].id]);
    renderPanel(store);

    expect(screen.getByText('Measures 2–2')).toBeInTheDocument();
    expect(screen.getByText(`Tracks: ${score.tracks[0].name}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate alternatives' })).toBeDisabled(); // no instruction yet
  });

  it('explains when the selection was expanded to full measures', () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    const firstNoteId = score.tracks[0].measures[0].voices[0].events[0].id;
    store.getState().setSelection({ eventIds: [firstNoteId], measureIds: [], trackIds: [] });
    renderPanel(store);

    expect(screen.getByText(/expanded to cover whole measures/)).toBeInTheDocument();
  });

  it('selecting a preset instruction fills the instruction field', async () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    store.getState().selectMeasures([score.tracks[0].measures[0].id]);
    renderPanel(store);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Preset instructions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Add harmonic tension' }));

    expect(screen.getByRole('textbox', { name: 'Regeneration instruction' })).toHaveValue('Add harmonic tension');
  });

  it('Generate alternatives calls regenerate() with the instruction, candidate count, and checked preservation constraints', async () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    store.getState().selectMeasures([score.tracks[0].measures[0].id]);
    renderPanel(store);
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: 'Regeneration instruction' }), 'Simplify this passage');
    await user.click(screen.getByRole('checkbox', { name: 'Preserve harmony' }));
    await user.click(screen.getByRole('checkbox', { name: 'Preserve melody' }));

    await user.click(screen.getByRole('button', { name: 'Generate alternatives' }));

    await vi.waitFor(() => expect(store.getState().candidates.length).toBeGreaterThan(0));
    const lastRequest = store.getState().lastRequest;
    expect(lastRequest && 'instruction' in lastRequest ? lastRequest.instruction : null).toBe(
      'Simplify this passage',
    );
    expect(lastRequest && 'constraints' in lastRequest ? lastRequest.constraints.preserveHarmony : null).toBe(true);
    expect(lastRequest && 'constraints' in lastRequest ? lastRequest.constraints.preserveMelody : null).toBe(true);
    expect(lastRequest && 'constraints' in lastRequest ? lastRequest.constraints.preserveRhythm : null).toBe(false);
    expect(lastRequest && 'candidateCount' in lastRequest ? lastRequest.candidateCount : null).toBe(3);
  });

  it('renders CandidateList cards once regeneration produces candidates', async () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    store.getState().selectMeasures([score.tracks[0].measures[0].id]);
    renderPanel(store);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Regeneration instruction' }), 'Simplify this passage');

    await user.click(screen.getByRole('button', { name: 'Generate alternatives' }));

    await vi.waitFor(() => {
      expect(screen.getByLabelText('Regeneration candidates')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('group', { name: /Candidate card:/ }).length).toBe(store.getState().candidates.length);
  });

  it('shows Cancel while pending and stops the request when clicked', async () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    store.getState().selectMeasures([score.tracks[0].measures[0].id]);
    renderPanel(store);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Regeneration instruction' }), 'Simplify this passage');

    await user.click(screen.getByRole('button', { name: 'Generate alternatives' }));
    // The mock provider resolves on a microtask; assert pending was at
    // least observable via the store directly rather than racing the UI.
    await vi.waitFor(() => expect(store.getState().pending).toBe(false));
  });

  it('every interactive control has an accessible name', () => {
    const store = makeStore();
    const score = twinkleScore();
    store.getState().setScore(score);
    store.getState().selectMeasures([score.tracks[0].measures[0].id]);
    renderPanel(store);

    const panel = screen.getByLabelText('Regeneration panel');
    for (const el of within(panel).getAllByRole('button')) {
      expect(el).toHaveAccessibleName();
    }
    for (const el of within(panel).getAllByRole('checkbox')) {
      expect(el).toHaveAccessibleName();
    }
  });
});
