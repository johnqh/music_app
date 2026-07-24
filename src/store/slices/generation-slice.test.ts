import { afterEach, describe, expect, it } from 'vitest';
import { createAppStore } from '@/store/useAppStore';
import { resetProvider } from '@/services/generation/registry';
import { twinkleScore } from '@/test/fixtures';
import type { GenerateScoreRequest } from '@/services/generation/types';

const REQUEST: GenerateScoreRequest = {
  prompt: 'Create a gentle eight-measure piano piece in A minor',
  durationMeasures: 4,
  tracks: [{ name: 'Piano', instrumentName: 'Piano', midiProgram: 0, clef: 'treble' }],
};

afterEach(() => {
  resetProvider();
});

describe('generation-slice', () => {
  describe('generate', () => {
    it('adopts the provider-generated score, resets history, and marks the project dirty', async () => {
      const store = createAppStore();

      await store.getState().generate(REQUEST);

      const state = store.getState();
      expect(state.score).not.toBeNull();
      expect(state.score!.tracks).toHaveLength(1);
      expect(state.pending).toBe(false);
      expect(state.error).toBeNull();
      expect(state.lastRequest).toEqual(REQUEST);
      expect(state.canUndo).toBe(false); // fresh history, not an undoable edit
      expect(state.dirty).toBe(true);
    });

    it('sets pending while the request is in flight', async () => {
      const store = createAppStore();
      const promise = store.getState().generate(REQUEST);
      expect(store.getState().pending).toBe(true);
      await promise;
      expect(store.getState().pending).toBe(false);
    });
  });

  describe('regenerate', () => {
    function seedRegenerableSelection() {
      const store = createAppStore();
      const score = twinkleScore();
      store.getState().setScore(score);
      const measureId = score.tracks[0].measures[0].id;
      store.getState().selectMeasures([measureId]);
      return store;
    }

    it('produces non-destructive preview candidates without touching the committed score', async () => {
      const store = seedRegenerableSelection();
      const originalScore = store.getState().score;

      await store.getState().regenerate('Make this more dramatic');

      const state = store.getState();
      expect(state.pending).toBe(false);
      expect(state.error).toBeNull();
      expect(state.candidates.length).toBeGreaterThan(0);
      expect(state.candidates.length).toBeLessThanOrEqual(3);
      expect(state.activeCandidateId).toBe(state.candidates[0].id);
      expect(state.previewFragment).toEqual(state.candidates[0].fragment);
      expect(state.score).toBe(originalScore); // untouched
      expect(state.canUndo).toBe(false); // nothing committed yet
    });

    it('sets an error and does nothing when there is no score', async () => {
      const store = createAppStore();
      await store.getState().regenerate('Make this more dramatic');
      const state = store.getState();
      expect(state.error).toMatch(/no score/i);
      expect(state.candidates).toEqual([]);
    });

    it('sets an error and does nothing when the selection is not regenerable (nothing selected)', async () => {
      const store = createAppStore();
      store.getState().setScore(twinkleScore());
      await store.getState().regenerate('Make this more dramatic');
      const state = store.getState();
      expect(state.error).toMatch(/select a region/i);
      expect(state.candidates).toEqual([]);
    });
  });

  describe('selectCandidate / acceptCandidate / rejectCandidates', () => {
    async function seedCandidates() {
      const store = createAppStore();
      const score = twinkleScore();
      store.getState().setScore(score);
      const measureId = score.tracks[0].measures[0].id;
      store.getState().selectMeasures([measureId]);
      await store.getState().regenerate('Simplify this passage');
      return store;
    }

    it('selectCandidate switches the active candidate/preview, and null clears it', async () => {
      const store = await seedCandidates();
      const candidates = store.getState().candidates;
      expect(candidates.length).toBeGreaterThan(1);

      store.getState().selectCandidate(candidates[1].id);
      expect(store.getState().activeCandidateId).toBe(candidates[1].id);
      expect(store.getState().previewFragment).toEqual(candidates[1].fragment);

      store.getState().selectCandidate(null);
      expect(store.getState().activeCandidateId).toBeNull();
      expect(store.getState().previewFragment).toBeNull();
    });

    it('acceptCandidate replaces the region as one undoable command and clears preview state, preserving the selection', async () => {
      const store = await seedCandidates();
      const originalScore = store.getState().score;
      const selectionBefore = store.getState().selection;

      store.getState().acceptCandidate();

      const state = store.getState();
      expect(state.score).not.toBe(originalScore);
      expect(state.canUndo).toBe(true);
      expect(state.undoLabel).toMatch(/regenerate measures/i);
      expect(state.candidates).toEqual([]);
      expect(state.activeCandidateId).toBeNull();
      expect(state.previewFragment).toBeNull();
      expect(state.selection).toEqual(selectionBefore);
    });

    it('acceptCandidate is a no-op when there is no active candidate', async () => {
      const store = createAppStore();
      store.getState().setScore(twinkleScore());
      store.getState().acceptCandidate();
      expect(store.getState().canUndo).toBe(false);
    });

    it('rejectCandidates discards every candidate without touching the score', async () => {
      const store = await seedCandidates();
      const scoreBefore = store.getState().score;

      store.getState().rejectCandidates();

      const state = store.getState();
      expect(state.candidates).toEqual([]);
      expect(state.activeCandidateId).toBeNull();
      expect(state.previewFragment).toBeNull();
      expect(state.score).toBe(scoreBefore);
      expect(state.canUndo).toBe(false);
    });
  });
});
