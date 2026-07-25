/**
 * Piano-roll toolbar (spec §8): independent horizontal/vertical zoom,
 * snap-grid select (shared with the notation view's `uiSlice.snapGrid`),
 * quantize, a per-track visibility filter, and "loop selection".
 *
 * Zoom is piano-roll-local view state (owned by `PianoRollView`, passed
 * down as props — same pattern as `ScoreEditorView`'s `layoutMode`): it's
 * display scale, not note data, so keeping it outside the store doesn't
 * violate the "no view-local note state" rule. Every control that mutates
 * the score routes through `interactions.ts` (never `store.dispatchCommand`
 * directly), matching the score editor's `EditorToolbar`.
 */
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import type { SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { DurationName, UUID } from '@/domain/score/types';
import { ticksFor } from '@/domain/time/ticks';
import { useAppStore } from '@/store/useAppStore';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { selectedNoteIds } from '@/features/score-editor/editing';
import { commitQuantize, loopFromSelection } from '@/features/piano-roll/interactions';

export type PianoRollToolbarProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  zoomH: number;
  zoomV: number;
  onZoomHChange: (zoom: number) => void;
  onZoomVChange: (zoom: number) => void;
  /** Track ids currently shown in the roll; `null` means "every track" (no filter applied). */
  visibleTrackIds: Set<UUID> | null;
  onVisibleTrackIdsChange: (ids: Set<UUID> | null) => void;
};

const SNAP_OPTIONS: DurationName[] = ['whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirtysecond'];

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function PianoRollToolbar({
  store = useAppStore,
  zoomH,
  zoomV,
  onZoomHChange,
  onZoomVChange,
  visibleTrackIds,
  onVisibleTrackIdsChange,
}: PianoRollToolbarProps) {
  const score = store((s) => s.score);
  const snapGrid = store((s) => s.snapGrid);
  const hasScore = score !== null;
  const trackIds = score?.tracks.map((t) => t.id) ?? [];
  const selectedTrackIds = visibleTrackIds ?? new Set(trackIds);

  const handleSnapChange = (event: SelectChangeEvent<DurationName>): void => {
    store.getState().setSnapGrid(event.target.value as DurationName);
  };

  const handleQuantize = (): void => {
    if (!score) return;
    const ids = selectedNoteIds(score, store.getState().selection);
    commitQuantize(store, ids, {
      grid: ticksFor(snapGrid, score.ppq),
      quantizeStarts: true,
      quantizeDurations: true,
    });
  };

  const handleLoopFromSelection = (): void => loopFromSelection(store);

  const handleTrackFilterChange = (event: SelectChangeEvent<UUID[]>): void => {
    const raw = event.target.value;
    const next = typeof raw === 'string' ? raw.split(',') : raw;
    onVisibleTrackIdsChange(next.length === trackIds.length ? null : new Set(next));
  };

  return (
    <Toolbar
      variant="dense"
      role="toolbar"
      aria-label="Piano roll toolbar"
      sx={{ flexWrap: 'wrap', gap: 1, borderBottom: 1, borderColor: 'divider' }}
    >
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Tooltip title="Zoom horizontal out">
          <span>
            <IconButton
              size="small"
              aria-label="Zoom horizontal out"
              onClick={() => onZoomHChange(clampZoom(zoomH / ZOOM_STEP))}
            >
              ↔−
            </IconButton>
          </span>
        </Tooltip>
        <Typography variant="body2" aria-label="Current horizontal zoom level" sx={{ minWidth: 40, textAlign: 'center' }}>
          {Math.round(zoomH * 100)}%
        </Typography>
        <Tooltip title="Zoom horizontal in">
          <span>
            <IconButton
              size="small"
              aria-label="Zoom horizontal in"
              onClick={() => onZoomHChange(clampZoom(zoomH * ZOOM_STEP))}
            >
              ↔+
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Tooltip title="Zoom vertical out">
          <span>
            <IconButton
              size="small"
              aria-label="Zoom vertical out"
              onClick={() => onZoomVChange(clampZoom(zoomV / ZOOM_STEP))}
            >
              ↕−
            </IconButton>
          </span>
        </Tooltip>
        <Typography variant="body2" aria-label="Current vertical zoom level" sx={{ minWidth: 40, textAlign: 'center' }}>
          {Math.round(zoomV * 100)}%
        </Typography>
        <Tooltip title="Zoom vertical in">
          <span>
            <IconButton
              size="small"
              aria-label="Zoom vertical in"
              onClick={() => onZoomVChange(clampZoom(zoomV * ZOOM_STEP))}
            >
              ↕+
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Divider orientation="vertical" flexItem />

      <Select
        size="small"
        value={snapGrid}
        onChange={handleSnapChange}
        inputProps={{ 'aria-label': 'Snap grid' }}
      >
        {SNAP_OPTIONS.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </Select>
      <Button size="small" aria-label="Quantize" disabled={!hasScore} onClick={handleQuantize}>
        Quantize
      </Button>

      <Divider orientation="vertical" flexItem />

      <Button size="small" aria-label="Loop selection" disabled={!hasScore} onClick={handleLoopFromSelection}>
        Loop selection
      </Button>

      <Box sx={{ flex: 1 }} />

      <Select
        size="small"
        multiple
        displayEmpty
        value={[...selectedTrackIds]}
        onChange={handleTrackFilterChange}
        renderValue={(selected) =>
          selected.length === trackIds.length ? 'All tracks' : `${selected.length} track(s)`
        }
        inputProps={{ 'aria-label': 'Track filter' }}
        disabled={!hasScore}
        sx={{ minWidth: 140 }}
      >
        {(score?.tracks ?? []).map((track) => (
          <MenuItem key={track.id} value={track.id}>
            <Checkbox size="small" checked={selectedTrackIds.has(track.id)} />
            <ListItemText primary={track.name} />
          </MenuItem>
        ))}
      </Select>
    </Toolbar>
  );
}
