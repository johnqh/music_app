/**
 * Generation slice (spec §11, §12, §13, §37.8/9/10): drives the seeded mock
 * provider (via `getProvider()`, `services/generation/registry.ts`)
 * through both whole-score generation and region regeneration, and holds
 * the non-destructive preview state (spec §13) for regeneration candidates
 * — the committed `score` (in `score-slice`) is never touched until
 * `acceptCandidate()` dispatches a single `replaceRegionCommand` (spec §12
 * item 13 / §37.10).
 */
import type { StateCreator } from 'zustand';
import { applyCandidate, prepareRegenerationRequest } from '@/services/regeneration/controller';
import type {
  PrepareRegenerationOptions,
  PreparedRegenerationRequest,
} from '@/services/regeneration/controller';
import { getProvider } from '@/services/generation/registry';
import {
  sanitizeGeneratedScore,
  GenerationValidationError,
} from '@/services/generation/validate-response';
import type { GenerateScoreRequest, RegenerationCandidate } from '@/services/generation/types';
import type { ScoreFragment } from '@/domain/score/fragment';
import { selectionIsRegenerable } from '@/domain/selection/selection';
import type { ScoreSelection } from '@/domain/selection/types';
import type { AppState } from '@/store/useAppStore';

export type GenerationMode = 'generate' | 'regenerate';

/**
 * `mode` reflects the current selection (spec: "mode ... derived from
 * selection non-empty"): a selection carrying actual content (selected
 * events/measures, or an explicit tick range) puts the generation panel in
 * "regenerate" mode; an empty selection (including a bare track-only
 * selection, which has no tick extent of its own) means "generate" a whole
 * new score. Exported so `selection-slice` can recompute it, in the same
 * `set()` call, every time the selection changes — kept as real state
 * (not a selector) so components can read it without knowing the
 * derivation rule.
 */
export function deriveGenerationMode(selection: ScoreSelection): GenerationMode {
  const hasContent =
    selection.eventIds.length > 0 ||
    selection.measureIds.length > 0 ||
    selection.range !== undefined;
  return hasContent ? 'regenerate' : 'generate';
}

export type GenerationSlice = {
  mode: GenerationMode;
  pending: boolean;
  candidates: RegenerationCandidate[];
  activeCandidateId: string | null;
  previewFragment: ScoreFragment | null;
  lastRequest: GenerateScoreRequest | PreparedRegenerationRequest | null;
  error: string | null;

  /** Generates a brand-new score from `params` and adopts it (spec §39 items 3-5): validated/repaired via `sanitizeGeneratedScore`, then `setScore(..., { resetHistory: true })`. */
  generate: (params: GenerateScoreRequest) => Promise<void>;
  /** Requests 1-3 regeneration candidates for the current selection (spec §12 items 1-6); does not touch the committed score. Throws no further than setting `error` if the selection isn't regenerable or the provider rejects the request. */
  regenerate: (instruction: string, options?: PrepareRegenerationOptions) => Promise<void>;
  /** Selects which candidate is currently previewed (spec §13). */
  selectCandidate: (id: string | null) => void;
  /** Replaces the regenerated region with the active candidate as a single undoable command (spec §12 items 10-13), then clears candidate/preview state. No-op if there's no active candidate. */
  acceptCandidate: () => void;
  /** Discards every candidate without touching the score (spec §12 item 14). */
  rejectCandidates: () => void;
};

export const createGenerationSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  GenerationSlice
> = (set, get) => ({
  mode: 'generate',
  pending: false,
  candidates: [],
  activeCandidateId: null,
  previewFragment: null,
  lastRequest: null,
  error: null,

  generate: async (params) => {
    set((state) => {
      state.pending = true;
      state.error = null;
    });
    try {
      const result = await getProvider().generateScore(params);
      const { score } = sanitizeGeneratedScore(result.score);
      get().setScore(score, { resetHistory: true });
      set((state) => {
        state.pending = false;
        state.lastRequest = params;
      });
      get().markDirty();
    } catch (error) {
      set((state) => {
        state.pending = false;
        state.error = errorMessage(error);
      });
    }
  },

  regenerate: async (instruction, options) => {
    const { score, selection } = get();
    if (!score) {
      set((state) => {
        state.error = 'Cannot regenerate: no score is loaded.';
      });
      return;
    }
    if (!selectionIsRegenerable(score, selection)) {
      set((state) => {
        state.error = 'Select a region of the score before regenerating.';
      });
      return;
    }

    set((state) => {
      state.pending = true;
      state.error = null;
      state.candidates = [];
      state.activeCandidateId = null;
      state.previewFragment = null;
    });

    try {
      const prepared = prepareRegenerationRequest(score, selection, instruction, options);
      const result = await getProvider().regenerateRegion(prepared);
      const first = result.candidates[0] ?? null;
      set((state) => {
        state.pending = false;
        state.lastRequest = prepared;
        state.candidates = result.candidates;
        state.activeCandidateId = first?.id ?? null;
        state.previewFragment = first?.fragment ?? null;
      });
    } catch (error) {
      set((state) => {
        state.pending = false;
        state.error = errorMessage(error);
      });
    }
  },

  selectCandidate: (id) => {
    set((state) => {
      const candidate = id === null ? null : (state.candidates.find((c) => c.id === id) ?? null);
      state.activeCandidateId = candidate?.id ?? null;
      state.previewFragment = candidate?.fragment ?? null;
    });
  },

  acceptCandidate: () => {
    const { score, candidates, activeCandidateId } = get();
    if (!score) return;
    const candidate = candidates.find((c) => c.id === activeCandidateId);
    if (!candidate) return;

    const command = applyCandidate(score, candidate);
    get().dispatchCommand(command);

    set((state) => {
      state.candidates = [];
      state.activeCandidateId = null;
      state.previewFragment = null;
    });
  },

  rejectCandidates: () => {
    set((state) => {
      state.candidates = [];
      state.activeCandidateId = null;
      state.previewFragment = null;
    });
  },
});

function errorMessage(error: unknown): string {
  if (error instanceof GenerationValidationError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
