/**
 * Region-regeneration panel (spec §12, §21): shown by the app shell (Task
 * 16) in place of `GenerationPanel` once `generation-slice.mode ===
 * 'regenerate'` (i.e. the selection carries content). Shows the selected
 * measure range/tracks (and the "expanded to full measures" explanation
 * when the selection didn't already fall on measure boundaries), an
 * instruction field with a preset-instruction menu (spec §12's exact
 * list), preservation checkboxes, a candidate-count field, and Generate
 * alternatives/Cancel. Renders `CandidateList` underneath for the resulting
 * preview cards.
 *
 * Every control that actually *requests* regeneration is disabled — and an
 * explanatory message shown instead of the range/track summary — whenever
 * `selectionIsRegenerable` is false (spec §21: "Disable generation when the
 * selection is invalid"), covering both "nothing selected" and a selection
 * that resolves to an out-of-bounds or dangling-track range.
 */
import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import LinearProgress from '@mui/material/LinearProgress';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { findTrack } from '@/domain/score/queries';
import type { Score } from '@/domain/score/types';
import type { ScoreRange } from '@/domain/selection/types';
import { selectionIsRegenerable } from '@/domain/selection/selection';
import { prepareRegenerationRequest } from '@/services/regeneration/controller';
import { useAppStore } from '@/store/useAppStore';
import type { GenerationStoreApi } from '@/features/generation/preview';
import { CandidateList } from '@/features/generation/CandidateList';

export type RegenerationPanelProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: GenerationStoreApi;
};

/** Spec §12, verbatim. */
const PRESET_INSTRUCTIONS: string[] = [
  'Make this more dramatic',
  'Simplify this passage',
  'Add rhythmic variation',
  'Make the melody more memorable',
  'Create a stronger transition',
  'Add harmonic tension',
  'Resolve the phrase',
  'Make this more upbeat',
  'Make this darker',
  'Create a variation while preserving the melody',
  'Preserve rhythm but change harmony',
  'Preserve harmony but change melody',
  'Add accompaniment',
  'Thin out the orchestration',
];

const MIN_CANDIDATE_COUNT = 1;
const MAX_CANDIDATE_COUNT = 3;
const DEFAULT_CANDIDATE_COUNT = 3;

/** `[firstMeasureIndex, lastMeasureIndex]` (0-based, spec §4 `Measure.index`) overlapping `range`, read off the score's first track (every track shares the same measure grid — same convention as `services/playback/controller.ts`'s `measureAt`). `null` if nothing overlaps. */
function measureIndexRange(score: Score, range: ScoreRange): [number, number] | null {
  const track = score.tracks[0];
  if (!track) return null;
  const overlapping = track.measures.filter(
    (m) => m.startTick < range.endTick && m.startTick + m.durationTicks > range.startTick,
  );
  if (overlapping.length === 0) return null;
  return [overlapping[0].index, overlapping[overlapping.length - 1].index];
}

function trackNamesLabel(score: Score, trackIds: string[]): string {
  if (trackIds.length === 0) return 'All tracks';
  const names = trackIds.map((id) => findTrack(score, id)?.name).filter((n): n is string => !!n);
  return names.length > 0 ? names.join(', ') : 'All tracks';
}

export function RegenerationPanel({ store = useAppStore }: RegenerationPanelProps) {
  const score = store((s) => s.score);
  const selection = store((s) => s.selection);
  const pending = store((s) => s.pending);
  const error = store((s) => s.error);

  const [instruction, setInstruction] = useState('');
  const [preserveBoundaryNotes, setPreserveBoundaryNotes] = useState(false);
  const [preserveHarmony, setPreserveHarmony] = useState(false);
  const [preserveRhythm, setPreserveRhythm] = useState(false);
  const [preserveMelody, setPreserveMelody] = useState(false);
  const [candidateCount, setCandidateCount] = useState(String(DEFAULT_CANDIDATE_COUNT));
  const [presetAnchor, setPresetAnchor] = useState<HTMLElement | null>(null);

  const regenerable = score !== null && selectionIsRegenerable(score, selection);

  // Pure and side-effect-free (`prepareRegenerationRequest` only reads
  // `score`/`selection`; `instruction` is just carried through into the
  // returned object, unused by the range/track/expansion fields this panel
  // displays) — safe to recompute on every relevant render purely for
  // display, without waiting for "Generate alternatives".
  const prepared = useMemo(() => {
    if (!score || !regenerable) return null;
    try {
      return prepareRegenerationRequest(score, selection, instruction);
    } catch {
      return null;
    }
  }, [score, selection, instruction, regenerable]);

  const parsedCandidateCount = Number(candidateCount);
  const canGenerate =
    regenerable &&
    !pending &&
    instruction.trim() !== '' &&
    Number.isInteger(parsedCandidateCount) &&
    parsedCandidateCount >= MIN_CANDIDATE_COUNT &&
    parsedCandidateCount <= MAX_CANDIDATE_COUNT;

  const handlePresetSelect = (text: string): void => {
    setInstruction(text);
    setPresetAnchor(null);
  };

  const handleGenerate = (): void => {
    if (!canGenerate) return;
    void store.getState().regenerate(instruction, {
      candidateCount: parsedCandidateCount,
      constraints: { preserveBoundaryNotes, preserveHarmony, preserveRhythm, preserveMelody },
    });
  };

  const handleCancel = (): void => {
    store.getState().cancel();
  };

  const measureRange = score && prepared ? measureIndexRange(score, prepared.range) : null;

  return (
    <Stack spacing={2} sx={{ p: 2 }} aria-label="Regeneration panel">
      <Typography variant="subtitle1">Regenerate selection</Typography>

      {!regenerable && (
        <Alert severity="info">Select a region of the score to regenerate.</Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}

      {regenerable && score && prepared && (
        <Box>
          {measureRange && (
            <Typography variant="body2">
              Measures {measureRange[0] + 1}–{measureRange[1] + 1}
            </Typography>
          )}
          <Typography variant="body2">Tracks: {trackNamesLabel(score, prepared.range.trackIds)}</Typography>
          {prepared.expandedToFullMeasures && (
            <Alert severity="info" sx={{ mt: 1 }}>
              The selection didn't fall on measure boundaries, so it was expanded to cover whole measures —
              regeneration always replaces complete measures.
            </Alert>
          )}
        </Box>
      )}

      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <TextField
          multiline
          minRows={2}
          fullWidth
          label="Regeneration instruction"
          value={instruction}
          disabled={!regenerable}
          onChange={(e) => setInstruction(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Regeneration instruction' } }}
        />
        <Button
          size="small"
          aria-label="Preset instructions"
          disabled={!regenerable}
          onClick={(e) => setPresetAnchor(e.currentTarget)}
        >
          Presets
        </Button>
        <Menu anchorEl={presetAnchor} open={presetAnchor !== null} onClose={() => setPresetAnchor(null)}>
          {PRESET_INSTRUCTIONS.map((text) => (
            <MenuItem key={text} onClick={() => handlePresetSelect(text)}>
              {text}
            </MenuItem>
          ))}
        </Menu>
      </Stack>

      <Box role="group" aria-label="Preservation options">
        <Typography variant="body2">Preserve</Typography>
        <FormGroup row>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                disabled={!regenerable}
                checked={preserveBoundaryNotes}
                onChange={(e) => setPreserveBoundaryNotes(e.target.checked)}
                slotProps={{ input: { 'aria-label': 'Preserve boundary notes' } }}
              />
            }
            label="Boundary notes"
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                disabled={!regenerable}
                checked={preserveHarmony}
                onChange={(e) => setPreserveHarmony(e.target.checked)}
                slotProps={{ input: { 'aria-label': 'Preserve harmony' } }}
              />
            }
            label="Harmony"
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                disabled={!regenerable}
                checked={preserveRhythm}
                onChange={(e) => setPreserveRhythm(e.target.checked)}
                slotProps={{ input: { 'aria-label': 'Preserve rhythm' } }}
              />
            }
            label="Rhythm"
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                disabled={!regenerable}
                checked={preserveMelody}
                onChange={(e) => setPreserveMelody(e.target.checked)}
                slotProps={{ input: { 'aria-label': 'Preserve melody' } }}
              />
            }
            label="Melody"
          />
        </FormGroup>
      </Box>

      <TextField
        size="small"
        type="number"
        label="Candidate count"
        value={candidateCount}
        disabled={!regenerable}
        onChange={(e) => setCandidateCount(e.target.value)}
        slotProps={{ htmlInput: { 'aria-label': 'Candidate count', min: MIN_CANDIDATE_COUNT, max: MAX_CANDIDATE_COUNT } }}
        sx={{ width: 160 }}
      />

      {pending && <LinearProgress aria-label="Regenerating" />}

      <Stack direction="row" spacing={1}>
        <Button variant="contained" aria-label="Generate alternatives" disabled={!canGenerate} onClick={handleGenerate}>
          Generate alternatives
        </Button>
        {pending && (
          <Button aria-label="Cancel" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </Stack>

      <CandidateList store={store} />
    </Stack>
  );
}
