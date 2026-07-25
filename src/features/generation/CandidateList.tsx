/**
 * Regeneration candidate preview cards (spec §12 steps 7-15, §13): one card
 * per candidate (label, note-count/pitch-range summary, play-in-context,
 * A/B compare, Accept), plus list-level Reject all and a retry-with-a-
 * revised-instruction field. Rendered by `RegenerationPanel` below its
 * instruction form whenever `generation-slice.candidates` is non-empty.
 *
 * Selection vs. acceptance are deliberately decoupled from each other:
 * clicking a card's label button (or its Play-in-context button) makes
 * that candidate the *previewed* one (`selectCandidate` — sets both
 * `activeCandidateId` and the editor/piano-roll overlay), but a card's
 * Accept button always explicitly selects-then-accepts *that* card
 * regardless of which one was previously active, so Accept is never
 * "accept whatever happens to still be selected" — it always does what
 * the button it came from says.
 *
 * Re-skinned onto Tailwind (T12 batch 4): MUI Card/CardContent/CardActions
 * become a plain `role="group"` div (same `Candidate card: <label>` name —
 * e2e specs assert on it directly), and the MUI ToggleButtonGroup A/B
 * toggle becomes two plain `aria-pressed` buttons.
 */
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { RegenerationCandidate } from '@sudobility/music_types';
import { playbackController } from '@sudobility/music_lib';
import { scoreWithCandidate, summarizeFragment, previewStartTick } from '@/features/generation/preview';
import type { GenerationStoreApi } from '@/features/generation/preview';
import { useAppStore } from '@sudobility/music_lib';

export type CandidateListProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: GenerationStoreApi;
};

function summaryLine(candidate: RegenerationCandidate): string {
  const { noteCount, pitchRangeLabel } = summarizeFragment(candidate.fragment);
  const noteWord = noteCount === 1 ? 'note' : 'notes';
  return pitchRangeLabel ? `${noteCount} ${noteWord}, ${pitchRangeLabel}` : `${noteCount} ${noteWord}`;
}

const TEXT_BUTTON_CLASS =
  'rounded-md border border-theme-border px-3 py-1.5 text-sm text-theme-text-primary hover:bg-theme-hover-bg disabled:cursor-not-allowed disabled:opacity-40';

const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';

const TOGGLE_BUTTON_CLASS =
  'rounded-md px-2 py-1 text-xs font-medium text-theme-text-primary hover:bg-theme-hover-bg aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:opacity-90';

export function CandidateList({ store = useAppStore }: CandidateListProps) {
  const candidates = store((s) => s.candidates);
  const activeCandidateId = store((s) => s.activeCandidateId);
  const score = store((s) => s.score);
  const pending = store((s) => s.pending);
  const lastRequest = store((s) => s.lastRequest);

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [comparingOriginal, setComparingOriginal] = useState(false);
  const [retryInstruction, setRetryInstruction] = useState(
    lastRequest && 'instruction' in lastRequest ? lastRequest.instruction : '',
  );

  // Any candidate preview still playing when the list unmounts (panel
  // closed, region deselected, etc.) must not keep sounding.
  useEffect(() => () => playbackController.stopPreview(), []);

  // A freshly-selected candidate always starts out showing itself, not the
  // A/B "original" comparison from whatever was previously active.
  useEffect(() => {
    setComparingOriginal(false);
  }, [activeCandidateId]);

  if (candidates.length === 0) return null;

  const handleSelect = (candidate: RegenerationCandidate): void => {
    // Switching which candidate is active must not leave stale audio
    // playing for whichever candidate the overlay just switched *away*
    // from — otherwise the editor/piano-roll overlay shows `candidate`
    // while the engine keeps sounding the previously-active one. Simplest,
    // most predictable fix (matching `handleAccept`/`handleRejectAll`,
    // which already do this): stop the preview outright on switch, rather
    // than trying to seamlessly hand the engine off to the new candidate.
    if (playingId && playingId !== candidate.id) handleStop();
    store.getState().selectCandidate(candidate.id);
  };

  const handlePlay = (candidate: RegenerationCandidate): void => {
    if (!score) return;
    if (activeCandidateId !== candidate.id) store.getState().selectCandidate(candidate.id);
    const previewScore = scoreWithCandidate(score, candidate.fragment);
    setPlayingId(candidate.id);
    void playbackController.playPreview(previewScore, previewStartTick(candidate.fragment));
  };

  const handleStop = (): void => {
    playbackController.stopPreview();
    setPlayingId(null);
  };

  const handleCompareChange = (candidate: RegenerationCandidate, showOriginal: boolean): void => {
    setComparingOriginal(showOriginal);
    store.getState().setPreviewFragment(showOriginal ? null : candidate.fragment);
  };

  const handleAccept = (candidate: RegenerationCandidate): void => {
    if (playingId) handleStop();
    store.getState().selectCandidate(candidate.id);
    store.getState().acceptCandidate();
  };

  const handleRejectAll = (): void => {
    if (playingId) handleStop();
    store.getState().rejectCandidates();
  };

  const handleRetry = (): void => {
    const instruction = retryInstruction.trim();
    if (!instruction) return;
    const lastConstraints = lastRequest && 'constraints' in lastRequest ? lastRequest.constraints : undefined;
    const candidateCount = lastRequest && 'candidateCount' in lastRequest ? lastRequest.candidateCount : undefined;
    void store.getState().regenerate(instruction, {
      candidateCount,
      constraints: lastConstraints && {
        preserveBoundaryNotes: lastConstraints.preserveBoundaryNotes,
        preserveHarmony: lastConstraints.preserveHarmony,
        preserveRhythm: lastConstraints.preserveRhythm,
        preserveMelody: lastConstraints.preserveMelody,
      },
    });
  };

  return (
    <div aria-label="Regeneration candidates" className="flex flex-col gap-4">
      {candidates.map((candidate) => {
        const isActive = candidate.id === activeCandidateId;
        const isPlaying = playingId === candidate.id;
        return (
          <div
            key={candidate.id}
            role="group"
            aria-label={`Candidate card: ${candidate.label}`}
            className="rounded-md border border-theme-border bg-theme-bg-secondary p-4"
          >
            <div className="flex flex-col items-start gap-2">
              <button
                type="button"
                aria-pressed={isActive}
                onClick={() => handleSelect(candidate)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-theme-text-primary hover:bg-theme-hover-bg'
                }`}
              >
                {candidate.label}
              </button>
              <p className="text-sm text-theme-text-secondary">{summaryLine(candidate)}</p>
              {isActive && (
                <div role="group" aria-label="Compare candidate and original" className="mt-1 flex gap-0.5">
                  <button
                    type="button"
                    aria-label="Show candidate"
                    aria-pressed={!comparingOriginal}
                    onClick={() => handleCompareChange(candidate, false)}
                    className={TOGGLE_BUTTON_CLASS}
                  >
                    Candidate
                  </button>
                  <button
                    type="button"
                    aria-label="Show original"
                    aria-pressed={comparingOriginal}
                    onClick={() => handleCompareChange(candidate, true)}
                    className={TOGGLE_BUTTON_CLASS}
                  >
                    Original
                  </button>
                </div>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              {isPlaying ? (
                <button type="button" aria-label={`Stop preview: ${candidate.label}`} onClick={handleStop} className={TEXT_BUTTON_CLASS}>
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={`Play in context: ${candidate.label}`}
                  disabled={!score}
                  onClick={() => handlePlay(candidate)}
                  className={TEXT_BUTTON_CLASS}
                >
                  Play in context
                </button>
              )}
              <button
                type="button"
                aria-label={`Accept ${candidate.label}`}
                onClick={() => handleAccept(candidate)}
                className={PRIMARY_BUTTON_CLASS}
              >
                Accept
              </button>
            </div>
          </div>
        );
      })}

      <div className="flex items-start gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-theme-text-secondary">Retry with a revised instruction</span>
          <input
            type="text"
            aria-label="Retry instruction"
            value={retryInstruction}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setRetryInstruction(e.target.value)}
            className="w-full rounded-md border border-theme-border bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary"
          />
        </label>
        <button
          type="button"
          aria-label="Retry"
          disabled={pending || retryInstruction.trim() === ''}
          onClick={handleRetry}
          className={TEXT_BUTTON_CLASS}
        >
          Retry
        </button>
      </div>

      <button
        type="button"
        aria-label="Reject all"
        onClick={handleRejectAll}
        className="self-start rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
      >
        Reject all
      </button>
    </div>
  );
}
