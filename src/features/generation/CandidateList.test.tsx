import { afterEach, describe, expect, it, vi } from 'vitest';
import { testStoreContext } from '@sudobility/music_lib';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@sudobility/music_lib';
import { twinkleScore } from '@sudobility/music_lib';
import { CandidateList } from '@/features/generation/CandidateList';
import type { GenerationStoreApi } from '@/features/generation/preview';

vi.mock('@sudobility/music_lib', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  playbackController: {
    playPreview: vi.fn(),
    stopPreview: vi.fn(),
  },
}));

import { playbackController } from '@sudobility/music_lib';

function makeStoreWithCandidates(): GenerationStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  return store;
}

async function seedCandidates(store: GenerationStoreApi, instruction = 'Simplify this passage') {
  const score = twinkleScore();
  store.getState().setScore(score);
  const measureId = score.tracks[0].measures[0].id;
  store.getState().selectMeasures([measureId]);
  await store.getState().regenerate(instruction);
  return score;
}

afterEach(async () => {
  // Explicit, not relying on `@testing-library/react`'s own auto-registered
  // `afterEach(cleanup)`: vitest (like Jest) runs `afterEach` hooks in
  // *reverse* registration order, so that auto-registered hook (registered
  // when `@testing-library/react` was first imported, above) actually runs
  // *after* this one — meaning `vi.clearAllMocks()` below would otherwise
  // reset counts *before* unmounting fires this file's components' cleanup
  // effects (which call `playbackController.stopPreview()`), leaking a
  // stray call into the next test. Calling `cleanup()` here first makes the
  // ordering (unmount, *then* clear mocks) deterministic.
  cleanup();
  vi.clearAllMocks();
});

function renderList(store: GenerationStoreApi) {
  render(<CandidateList store={store} />);
}

describe('CandidateList', () => {
  it('renders nothing when there are no candidates', () => {
    const store = makeStoreWithCandidates();
    store.getState().setScore(twinkleScore());
    const { container } = render(<CandidateList store={store} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one card per candidate with its label and a note-count/pitch-range summary', async () => {
    const store = makeStoreWithCandidates();
    await seedCandidates(store);
    renderList(store);

    const candidates = store.getState().candidates;
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const card = screen.getByRole('group', { name: `Candidate card: ${candidate.label}` });
      expect(within(card).getByText(candidate.label)).toBeInTheDocument();
      expect(within(card).getByText(/notes?/)).toBeInTheDocument();
    }
  });

  it('clicking a card label selects it as the active/previewed candidate', async () => {
    const store = makeStoreWithCandidates();
    await seedCandidates(store);
    renderList(store);
    const user = userEvent.setup();
    const candidates = store.getState().candidates;
    expect(candidates.length).toBeGreaterThan(1);
    const other = candidates[1];

    await user.click(screen.getByText(other.label));

    expect(store.getState().activeCandidateId).toBe(other.id);
    expect(store.getState().previewFragment).toEqual(other.fragment);
  });

  it('Play in context plays the candidate spliced into the committed score, starting at the region start; Stop stops it', async () => {
    const store = makeStoreWithCandidates();
    const originalScore = await seedCandidates(store);
    renderList(store);
    const user = userEvent.setup();
    const [active] = store.getState().candidates;

    await user.click(screen.getByRole('button', { name: `Play in context: ${active.label}` }));

    expect(playbackController.playPreview).toHaveBeenCalledTimes(1);
    const [playedScore, fromTick] = vi.mocked(playbackController.playPreview).mock.calls[0];
    expect(fromTick).toBe(active.fragment.range.startTick);
    expect(playedScore).not.toBe(originalScore); // a spliced copy, not the committed score
    // The committed score itself is referentially unchanged by previewing (spec §37.9).
    expect(store.getState().score).toBe(originalScore);

    await user.click(screen.getByRole('button', { name: `Stop preview: ${active.label}` }));
    expect(playbackController.stopPreview).toHaveBeenCalledTimes(1);
  });

  it('switching the active candidate while a preview plays stops the stale audio, so it never desyncs from the overlay', async () => {
    const store = makeStoreWithCandidates();
    await seedCandidates(store);
    renderList(store);
    const user = userEvent.setup();
    const candidates = store.getState().candidates;
    expect(candidates.length).toBeGreaterThan(1);
    const [candidateA, candidateB] = candidates;

    await user.click(screen.getByRole('button', { name: `Play in context: ${candidateA.label}` }));
    expect(screen.getByRole('button', { name: `Stop preview: ${candidateA.label}` })).toBeInTheDocument();

    // Switch to candidate B by clicking its label while A is still "playing".
    await user.click(screen.getByText(candidateB.label));

    expect(playbackController.stopPreview).toHaveBeenCalledTimes(1); // stale audio for A stopped
    expect(store.getState().activeCandidateId).toBe(candidateB.id); // overlay now shows B
    expect(store.getState().previewFragment).toEqual(candidateB.fragment);
    // A's card is back to "Play in context" (playingId cleared), not "Stop".
    expect(screen.getByRole('button', { name: `Play in context: ${candidateA.label}` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Stop preview: ${candidateA.label}` })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: `Stop preview: ${candidateB.label}` })).not.toBeInTheDocument();
  });

  it('selecting a different candidate while nothing plays does not call stopPreview', async () => {
    const store = makeStoreWithCandidates();
    await seedCandidates(store);
    renderList(store);
    const user = userEvent.setup();
    const candidates = store.getState().candidates;
    const other = candidates[1];

    await user.click(screen.getByText(other.label));

    expect(playbackController.stopPreview).not.toHaveBeenCalled();
    expect(store.getState().activeCandidateId).toBe(other.id);
  });

  it('the A/B compare toggle only appears for the active candidate, and toggling to Original clears the overlay without changing activeCandidateId', async () => {
    const store = makeStoreWithCandidates();
    await seedCandidates(store);
    renderList(store);
    const user = userEvent.setup();
    const [active] = store.getState().candidates;

    const activeCard = screen.getByRole('group', { name: `Candidate card: ${active.label}` });
    expect(within(activeCard).getByRole('button', { name: 'Show original' })).toBeInTheDocument();

    await user.click(within(activeCard).getByRole('button', { name: 'Show original' }));
    expect(store.getState().previewFragment).toBeNull();
    expect(store.getState().activeCandidateId).toBe(active.id);

    await user.click(within(activeCard).getByRole('button', { name: 'Show candidate' }));
    expect(store.getState().previewFragment).toEqual(active.fragment);
    expect(store.getState().activeCandidateId).toBe(active.id);
  });

  it('Accept on a non-active card selects and accepts that candidate as a single undoable command, clearing preview state', async () => {
    const store = makeStoreWithCandidates();
    const originalScore = await seedCandidates(store);
    renderList(store);
    const user = userEvent.setup();
    const candidates = store.getState().candidates;
    expect(candidates.length).toBeGreaterThan(1);
    const target = candidates[1];
    expect(store.getState().activeCandidateId).not.toBe(target.id);

    await user.click(screen.getByRole('button', { name: `Accept ${target.label}` }));

    const state = store.getState();
    expect(state.score).not.toBe(originalScore);
    expect(state.canUndo).toBe(true);
    expect(state.candidates).toEqual([]);
    expect(state.activeCandidateId).toBeNull();
    expect(state.previewFragment).toBeNull();
  });

  it('Reject all clears every candidate without touching the score, and stops any playing preview', async () => {
    const store = makeStoreWithCandidates();
    const originalScore = await seedCandidates(store);
    renderList(store);
    const user = userEvent.setup();
    const [active] = store.getState().candidates;
    await user.click(screen.getByRole('button', { name: `Play in context: ${active.label}` }));

    await user.click(screen.getByRole('button', { name: 'Reject all' }));

    expect(playbackController.stopPreview).toHaveBeenCalled();
    const state = store.getState();
    expect(state.candidates).toEqual([]);
    expect(state.score).toBe(originalScore);
    expect(state.canUndo).toBe(false);
  });

  it('Retry regenerates with the revised instruction', async () => {
    const store = makeStoreWithCandidates();
    await seedCandidates(store, 'Simplify this passage');
    renderList(store);
    const user = userEvent.setup();

    const retryField = screen.getByRole('textbox', { name: 'Retry instruction' });
    await user.clear(retryField);
    await user.type(retryField, 'Add rhythmic variation');
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await vi.waitFor(() => {
      const lastRequest = store.getState().lastRequest;
      expect(lastRequest && 'instruction' in lastRequest ? lastRequest.instruction : null).toBe(
        'Add rhythmic variation',
      );
    });
    expect(store.getState().candidates.length).toBeGreaterThan(0);
  });

  it('stops a playing preview on unmount', async () => {
    const store = makeStoreWithCandidates();
    await seedCandidates(store);
    const { unmount } = render(<CandidateList store={store} />);
    const user = userEvent.setup();
    const [active] = store.getState().candidates;
    await user.click(screen.getByRole('button', { name: `Play in context: ${active.label}` }));

    unmount();

    expect(playbackController.stopPreview).toHaveBeenCalled();
  });

  it('every interactive control has an accessible name', async () => {
    const store = makeStoreWithCandidates();
    await seedCandidates(store);
    renderList(store);

    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAccessibleName();
    }
  });
});
