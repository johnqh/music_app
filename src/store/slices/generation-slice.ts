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
 * new score. Kept as real state (not a read-time selector) so components
 * can read it without knowing the derivation rule — but the *write* is
 * this slice's own responsibility (`syncModeFromSelection`, below):
 * `selection-slice` calls that action after every selection change rather
 * than writing `state.mode` itself, so `generation-slice` stays the only
 * code that ever touches its own field.
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

  /** Recomputes `mode` from `selection` via `deriveGenerationMode`. Called by `selection-slice`'s mutators after every selection change; not normally called directly by UI code. */
  syncModeFromSelection: (selection: ScoreSelection) => void;
  /** Generates a brand-new score from `params` and adopts it (spec §39 items 3-5): validated/repaired via `sanitizeGeneratedScore`, then `setScore(..., { resetHistory: true })`. */
  generate: (params: GenerateScoreRequest) => Promise<void>;
  /** Requests 1-3 regeneration candidates for the current selection (spec §12 items 1-6); does not touch the committed score. Throws no further than setting `error` if the selection isn't regenerable or the provider rejects the request. */
  regenerate: (instruction: string, options?: PrepareRegenerationOptions) => Promise<void>;
  /** Selects which candidate is currently previewed (spec §13); also sets `activeCandidateId`, so this is the "accept target" as well as the overlay. */
  selectCandidate: (id: string | null) => void;
  /**
   * Overlays `fragment` (or clears the overlay, with `null`) without
   * touching `activeCandidateId` — the A/B "compare original vs candidate"
   * toggle (spec §13) uses this so switching the preview display back and
   * forth never changes which candidate `acceptCandidate()` would commit.
   * `selectCandidate` remains the only action that changes
   * `activeCandidateId`.
   */
  setPreviewFragment: (fragment: ScoreFragment | null) => void;
  /** Replaces the regenerated region with the active candidate as a single undoable command (spec §12 items 10-13), then clears candidate/preview state. No-op if there's no active candidate. */
  acceptCandidate: () => void;
  /** Discards every candidate without touching the score (spec §12 item 14). */
  rejectCandidates: () => void;
  /**
   * Aborts whichever `generate()`/`regenerate()` call is currently in
   * flight (the generation panel's "Cancel" button) and clears `pending`.
   * Does not touch `candidates`/`error`/`score` — a cancelled request
   * simply never gets to write its result; whatever was previewed/
   * committed before the cancelled call started is left exactly as it
   * was. A no-op if nothing is in flight.
   */
  cancel: () => void;
};

export const createGenerationSlice: StateCreator<
  AppState,
  [['zustand/immer', never]],
  [],
  GenerationSlice
> = (set, get) => {
  // `requestToken`/`abortController` guard against out-of-order responses:
  // `generate`/`regenerate` are async and there's nothing stopping a
  // component from firing a second call (a new prompt, a revised
  // instruction) before the first one's provider round-trip has settled.
  // Without this, the *older* call's `.then`/`.catch` can land after the
  // newer one and clobber its `pending`/`candidates`/`score` with stale
  // data. `beginRequest()` bumps `requestToken` and aborts+replaces
  // `abortController` every time either action starts, so:
  //  - the previous in-flight provider call gets an aborted `AbortSignal`
  //    (both `MusicGenerationProvider` methods accept one) and, once its
  //    promise actually settles, is silently discarded on the `token !==
  //    requestToken` check below — never writing over the newer call's
  //    state.
  //  - a real (non-abort) error from a since-superseded call is likewise
  //    discarded, not surfaced as `error` (only the *current* call's own
  //    outcome should ever reach the user).
  // One shared token/controller for both actions (rather than one each) is
  // deliberate: `generate` and `regenerate` both drive the same
  // `pending`/`error` fields, so starting either one should supersede
  // whatever async generation-panel request was previously in flight,
  // regardless of which action it was.
  let requestToken = 0;
  let abortController: AbortController | null = null;

  function beginRequest(): { token: number; signal: AbortSignal } {
    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;
    requestToken += 1;
    return { token: requestToken, signal: controller.signal };
  }

  return {
    mode: 'generate',
    pending: false,
    candidates: [],
    activeCandidateId: null,
    previewFragment: null,
    lastRequest: null,
    error: null,

    syncModeFromSelection: (selection) => {
      set((state) => {
        state.mode = deriveGenerationMode(selection);
      });
    },

    generate: async (params) => {
      const { token, signal } = beginRequest();
      set((state) => {
        state.pending = true;
        state.error = null;
      });
      try {
        const result = await getProvider().generateScore(params, signal);
        if (token !== requestToken) return; // superseded by a newer generate()/regenerate() call
        const { score } = sanitizeGeneratedScore(result.score);
        get().setScore(score, { resetHistory: true });
        set((state) => {
          state.pending = false;
          state.lastRequest = params;
        });
        get().markDirty();
      } catch (error) {
        if (token !== requestToken) return; // superseded; the newer call now owns pending/error
        if (isAbortError(error)) {
          set((state) => {
            state.pending = false;
          });
          return;
        }
        set((state) => {
          state.pending = false;
          state.error = errorMessage(error);
        });
      }
    },

    regenerate: async (instruction, options) => {
      const { token, signal } = beginRequest();
      const { score, selection } = get();

      if (!score) {
        set((state) => {
          state.pending = false;
          state.error = 'Cannot regenerate: no score is loaded.';
        });
        return;
      }
      if (!selectionIsRegenerable(score, selection)) {
        set((state) => {
          state.pending = false;
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
        const result = await getProvider().regenerateRegion(prepared, signal);
        if (token !== requestToken) return; // superseded by a newer generate()/regenerate() call
        const first = result.candidates[0] ?? null;
        set((state) => {
          state.pending = false;
          state.lastRequest = prepared;
          state.candidates = result.candidates;
          state.activeCandidateId = first?.id ?? null;
          state.previewFragment = first?.fragment ?? null;
        });
      } catch (error) {
        if (token !== requestToken) return; // superseded; the newer call now owns pending/error
        if (isAbortError(error)) {
          set((state) => {
            state.pending = false;
          });
          return;
        }
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

    setPreviewFragment: (fragment) => {
      set((state) => {
        state.previewFragment = fragment;
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

    cancel: () => {
      abortController?.abort();
      set((state) => {
        state.pending = false;
      });
    },
  };
};

/** True for the `AbortError` a `MusicGenerationProvider` call rejects with when its `AbortSignal` fires (both the mock provider's `throwIfAborted` and the DOM `fetch`/`AbortController` convention use this name). Cancellations from `beginRequest()` superseding an in-flight call are intentionally silent — never surfaced via `error` — since they reflect the *user* moving on to a newer request, not a failure. */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: unknown }).name === 'AbortError'
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof GenerationValidationError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
