/**
 * Left-hand track panel (spec §6, §20): one row per track — editable name,
 * instrument, mute/solo toggles, volume/pan sliders, a clef chip — plus
 * add/delete track (delete confirmed) and click-to-select-track.
 *
 * Mute/solo dispatch `changeTrackPropsCommand` (a real, undoable, persisted
 * score edit) rather than any engine-only override: the live playback
 * engine reseeds its per-track mute/solo state straight from `Track` on
 * every `loadScore` (any edit, undo/redo, import, generation accept), so
 * an engine-only override would silently revert on the next unrelated
 * edit. Routing through the score is also what makes mute/solo undoable
 * and persisted with the project, matching every other track property.
 */
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import type { SelectChangeEvent } from '@mui/material/Select';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { Clef, Track, UUID } from '@/domain/score/types';
import { addTrackCommand, changeClefCommand, changeTrackPropsCommand, deleteTrackCommand } from '@/domain/commands/structure-commands';
import { useAppStore } from '@/store/useAppStore';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';

export type TrackPanelProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
};

const CLEF_OPTIONS: Clef[] = ['treble', 'bass', 'alto', 'tenor', 'percussion'];

function TrackRow({
  track,
  selected,
  onSelect,
  onPatch,
  onChangeClef,
  onDelete,
}: {
  track: Track;
  selected: boolean;
  onSelect: () => void;
  onPatch: (patch: Partial<Pick<Track, 'name' | 'instrumentName' | 'volume' | 'pan' | 'muted' | 'solo'>>) => void;
  onChangeClef: (clef: Clef) => void;
  onDelete: () => void;
}) {
  const [nameDraft, setNameDraft] = useState(track.name);
  // Local drag drafts (spec §22-adjacent slider convention, also used by
  // InspectorPanel's track sliders): MUI's Slider fires `onChange` on every
  // pointer-move tick during a drag, not just at the end. Dispatching a
  // ScoreCommand per tick would flood undo history (one drag = dozens of
  // entries) and re-run validateScore/markDirty that often; the command is
  // dispatched once, from `onChangeCommitted` (pointer-up/keyboard-commit),
  // while these drafts keep the thumb tracking the drag live. Synced back to
  // the track's real value on any external change (undo/redo, another
  // client, the commit itself echoing back).
  const [volumeDraft, setVolumeDraft] = useState(track.volume);
  const [panDraft, setPanDraft] = useState(track.pan);

  useEffect(() => setVolumeDraft(track.volume), [track.volume]);
  useEffect(() => setPanDraft(track.pan), [track.pan]);

  const commitName = (): void => {
    if (nameDraft.trim() !== '' && nameDraft !== track.name) onPatch({ name: nameDraft.trim() });
    else setNameDraft(track.name);
  };

  return (
    <Box
      role="listitem"
      aria-label={`Track: ${track.name}`}
      onClick={onSelect}
      sx={{
        p: 1,
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: selected ? 'action.selected' : undefined,
        cursor: 'pointer',
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <InputBase
          value={nameDraft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNameDraft(e.target.value)}
          onBlur={commitName}
          slotProps={{ input: { 'aria-label': `Track name: ${track.name}` } }}
          sx={{ flex: 1, font: 'inherit', fontWeight: 600 }}
        />
        <Chip size="small" label={track.clef} aria-label={`Clef: ${track.clef}`} />
        <Tooltip title="Delete track">
          <span>
            <IconButton
              size="small"
              aria-label={`Delete track: ${track.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              ✕
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Typography variant="caption" color="text.secondary">
        {track.instrumentName}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }} onClick={(e) => e.stopPropagation()}>
        <ToggleButton
          size="small"
          value="mute"
          selected={track.muted}
          aria-label={`Mute: ${track.name}`}
          onChange={() => onPatch({ muted: !track.muted })}
        >
          M
        </ToggleButton>
        <ToggleButton
          size="small"
          value="solo"
          selected={track.solo}
          aria-label={`Solo: ${track.name}`}
          onChange={() => onPatch({ solo: !track.solo })}
        >
          S
        </ToggleButton>
        <Select
          size="small"
          value={track.clef}
          onChange={(e: SelectChangeEvent) => onChangeClef(e.target.value as Clef)}
          inputProps={{ 'aria-label': `Clef select: ${track.name}` }}
          sx={{ minWidth: 90 }}
        >
          {CLEF_OPTIONS.map((clef) => (
            <MenuItem key={clef} value={clef}>
              {clef}
            </MenuItem>
          ))}
        </Select>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }} onClick={(e) => e.stopPropagation()}>
        <Typography variant="caption" sx={{ minWidth: 30 }}>
          Vol
        </Typography>
        <Slider
          size="small"
          min={0}
          max={1}
          step={0.01}
          value={volumeDraft}
          aria-label={`Volume: ${track.name}`}
          onChange={(_e, v) => setVolumeDraft(Array.isArray(v) ? v[0] : v)}
          onChangeCommitted={(_e, v) => onPatch({ volume: Array.isArray(v) ? v[0] : v })}
        />
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
        <Typography variant="caption" sx={{ minWidth: 30 }}>
          Pan
        </Typography>
        <Slider
          size="small"
          min={-1}
          max={1}
          step={0.01}
          value={panDraft}
          aria-label={`Pan: ${track.name}`}
          onChange={(_e, v) => setPanDraft(Array.isArray(v) ? v[0] : v)}
          onChangeCommitted={(_e, v) => onPatch({ pan: Array.isArray(v) ? v[0] : v })}
        />
      </Stack>
    </Box>
  );
}

export function TrackPanel({ store = useAppStore }: TrackPanelProps) {
  const score = store((s) => s.score);
  const selectedTrackIds = store((s) => s.selection.trackIds);
  const [pendingDeleteId, setPendingDeleteId] = useState<UUID | null>(null);

  if (!score) return null;
  const tracks = score.tracks;
  const pendingDeleteTrack = tracks.find((t) => t.id === pendingDeleteId) ?? null;

  const handleAddTrack = (): void => {
    store.getState().dispatchCommand(addTrackCommand({ name: `Track ${tracks.length + 1}`, clef: 'treble' }));
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <Stack direction="row" sx={{ alignItems: 'center', p: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Tracks
        </Typography>
        <Tooltip title="Add track">
          <IconButton size="small" aria-label="Add track" onClick={handleAddTrack}>
            +
          </IconButton>
        </Tooltip>
      </Stack>

      <Box role="list" aria-label="Track list">
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            selected={selectedTrackIds.includes(track.id)}
            onSelect={() => store.getState().selectTrack(track.id)}
            onPatch={(patch) => store.getState().dispatchCommand(changeTrackPropsCommand(track.id, patch))}
            onChangeClef={(clef) => store.getState().dispatchCommand(changeClefCommand(track.id, clef))}
            onDelete={() => setPendingDeleteId(track.id)}
          />
        ))}
      </Box>

      <ConfirmDialog
        open={pendingDeleteTrack !== null}
        title="Delete track"
        message={pendingDeleteTrack ? `Delete "${pendingDeleteTrack.name}"? This cannot be undone after saving.` : ''}
        confirmLabel="Delete"
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteId) store.getState().dispatchCommand(deleteTrackCommand(pendingDeleteId));
          setPendingDeleteId(null);
        }}
      />
    </Box>
  );
}
