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
 */
import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { RegenerationCandidate } from '@/services/generation/types';
import { playbackController } from '@/services/playback/controller';
import { scoreWithCandidate, summarizeFragment, previewStartTick } from '@/features/generation/preview';
import type { GenerationStoreApi } from '@/features/generation/preview';
import { useAppStore } from '@/store/useAppStore';

export type CandidateListProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: GenerationStoreApi;
};

function summaryLine(candidate: RegenerationCandidate): string {
  const { noteCount, pitchRangeLabel } = summarizeFragment(candidate.fragment);
  const noteWord = noteCount === 1 ? 'note' : 'notes';
  return pitchRangeLabel ? `${noteCount} ${noteWord}, ${pitchRangeLabel}` : `${noteCount} ${noteWord}`;
}

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

  const handleCompareChange = (candidate: RegenerationCandidate, value: 'candidate' | 'original' | null): void => {
    if (!value) return;
    const showOriginal = value === 'original';
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
    <Stack spacing={2} aria-label="Regeneration candidates">
      {candidates.map((candidate) => {
        const isActive = candidate.id === activeCandidateId;
        const isPlaying = playingId === candidate.id;
        return (
          <Card key={candidate.id} variant="outlined" role="group" aria-label={`Candidate card: ${candidate.label}`}>
            <CardContent>
              <Button
                variant={isActive ? 'contained' : 'text'}
                aria-pressed={isActive}
                onClick={() => handleSelect(candidate)}
              >
                {candidate.label}
              </Button>
              <Typography variant="body2" color="text.secondary">
                {summaryLine(candidate)}
              </Typography>
              {isActive && (
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={comparingOriginal ? 'original' : 'candidate'}
                  onChange={(_e, value: 'candidate' | 'original' | null) => handleCompareChange(candidate, value)}
                  aria-label="Compare candidate and original"
                  sx={{ mt: 1 }}
                >
                  <ToggleButton value="candidate" aria-label="Show candidate">
                    Candidate
                  </ToggleButton>
                  <ToggleButton value="original" aria-label="Show original">
                    Original
                  </ToggleButton>
                </ToggleButtonGroup>
              )}
            </CardContent>
            <CardActions>
              {isPlaying ? (
                <Button size="small" aria-label={`Stop preview: ${candidate.label}`} onClick={handleStop}>
                  Stop
                </Button>
              ) : (
                <Button
                  size="small"
                  aria-label={`Play in context: ${candidate.label}`}
                  disabled={!score}
                  onClick={() => handlePlay(candidate)}
                >
                  Play in context
                </Button>
              )}
              <Button
                size="small"
                variant="contained"
                aria-label={`Accept ${candidate.label}`}
                onClick={() => handleAccept(candidate)}
              >
                Accept
              </Button>
            </CardActions>
          </Card>
        );
      })}

      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          size="small"
          fullWidth
          label="Retry with a revised instruction"
          value={retryInstruction}
          onChange={(e) => setRetryInstruction(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Retry instruction' } }}
        />
        <Button
          aria-label="Retry"
          disabled={pending || retryInstruction.trim() === ''}
          onClick={handleRetry}
        >
          Retry
        </Button>
      </Stack>

      <Button aria-label="Reject all" color="error" onClick={handleRejectAll}>
        Reject all
      </Button>
    </Stack>
  );
}
