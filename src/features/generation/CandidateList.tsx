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
 * `activeCandidateId` and the notation preview), but a card's
 * Accept button always explicitly selects-then-accepts *that* card
 * regardless of which one was previously active, so Accept is never
 * "accept whatever happens to still be selected" — it always does what
 * the button it came from says.
 *
 * Re-skinned onto Tailwind (T12 batch 4): MUI Card/CardContent/CardActions
 * become a plain `role="group"` div (same `Candidate card: <label>` name —
 * e2e specs assert on it directly), and the MUI ToggleButtonGroup A/B
 * toggle becomes two plain `aria-pressed` buttons.
 *
 * Adopts `@sudobility/components` controls (library sweep 2): every button
 * becomes the library `Button` (`aria-pressed`/`aria-label`/`disabled` all
 * forward through `ButtonHTMLAttributes`, so the label-select toggle, the
 * A/B compare toggle, and Play/Stop/Accept/Retry/Reject all keep their
 * exact roles and pressed-state semantics), and the retry field becomes
 * the library `Input`. The card itself stays a plain `role="group"` div
 * (no library card component carries that exact accessible-name
 * convention e2e specs assert on directly).
 */
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Button, Input, cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
import type { RegenerationCandidate } from '@sudobility/music_types';
import { playbackController } from '@sudobility/music_lib';
import {
  scoreWithCandidate,
  summarizeFragment,
  previewStartTick,
} from '@/features/generation/preview';
import type { GenerationStoreApi } from '@/features/generation/preview';
import { useAppStore } from '@sudobility/music_lib';

export type CandidateListProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: GenerationStoreApi;
};

function summaryLine(candidate: RegenerationCandidate): string {
  const { noteCount, pitchRangeLabel } = summarizeFragment(candidate.fragment);
  const noteWord = noteCount === 1 ? 'note' : 'notes';
  return pitchRangeLabel
    ? `${noteCount} ${noteWord}, ${pitchRangeLabel}`
    : `${noteCount} ${noteWord}`;
}

const TOGGLE_BUTTON_CLASS = cn(
  'px-2 py-1 text-xs',
  'aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:opacity-90',
);

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
    // from — otherwise the notation preview shows `candidate`
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
    const lastConstraints =
      lastRequest && 'constraints' in lastRequest ? lastRequest.constraints : undefined;
    const candidateCount =
      lastRequest && 'candidateCount' in lastRequest ? lastRequest.candidateCount : undefined;
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
            className={cn(variants.card.default.base(), 'rounded-md p-4')}
          >
            <div className="flex flex-col items-start gap-2">
              <Button
                type="button"
                variant="ghost"
                aria-pressed={isActive}
                onClick={() => handleSelect(candidate)}
                className="px-3 py-1.5 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
              >
                {candidate.label}
              </Button>
              <p className="text-sm text-theme-text-secondary">{summaryLine(candidate)}</p>
              {isActive && (
                <div
                  role="group"
                  aria-label="Compare candidate and original"
                  className="mt-1 flex gap-0.5"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Show candidate"
                    aria-pressed={!comparingOriginal}
                    onClick={() => handleCompareChange(candidate, false)}
                    className={TOGGLE_BUTTON_CLASS}
                  >
                    Candidate
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label="Show original"
                    aria-pressed={comparingOriginal}
                    onClick={() => handleCompareChange(candidate, true)}
                    className={TOGGLE_BUTTON_CLASS}
                  >
                    Original
                  </Button>
                </div>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              {isPlaying ? (
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Stop preview: ${candidate.label}`}
                  onClick={handleStop}
                  className="px-3 py-1.5"
                >
                  Stop
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`Play in context: ${candidate.label}`}
                  disabled={!score}
                  onClick={() => handlePlay(candidate)}
                  className="px-3 py-1.5"
                >
                  Play in context
                </Button>
              )}
              <Button
                type="button"
                variant="primary"
                aria-label={`Accept ${candidate.label}`}
                onClick={() => handleAccept(candidate)}
                className="px-3 py-1.5"
              >
                Accept
              </Button>
            </div>
          </div>
        );
      })}

      <div className="flex items-start gap-2">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-theme-text-secondary">
            Retry with a revised instruction
          </span>
          <Input
            type="text"
            aria-label="Retry instruction"
            value={retryInstruction}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setRetryInstruction(e.target.value)}
            className="w-full px-3 py-2 text-sm"
          />
        </label>
        <Button
          type="button"
          variant="outline"
          aria-label="Retry"
          disabled={pending || retryInstruction.trim() === ''}
          onClick={handleRetry}
          className="px-3 py-1.5"
        >
          Retry
        </Button>
      </div>

      <Button
        type="button"
        variant="destructive"
        aria-label="Reject all"
        onClick={handleRejectAll}
        className="self-start"
      >
        Reject all
      </Button>
    </div>
  );
}
