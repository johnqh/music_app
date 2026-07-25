/**
 * Playback transport bar (spec §22): go-to-start, previous/next measure,
 * play/pause, stop, loop toggle, metronome toggle, current measure/beat,
 * tempo display+edit, playback speed, master volume, and a timeline
 * scrubber.
 *
 * Every control that actually moves the transport (play/pause/stop/seek/
 * loop/metronome/speed/volume) calls the `playbackController` singleton
 * directly (never `store.dispatchCommand` — playback is real-time device
 * control, not score history; see `services/playback/controller.ts`'s doc
 * comment). Tempo is the one exception: editing the BPM number *is* a
 * score edit (spec §22 "tempo control", persisted with the score, unlike
 * the ephemeral playback-speed multiplier), so it goes through
 * `changeTempoCommand`/`dispatchCommand` like any other score mutation.
 */
import { useMemo, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import type { SelectChangeEvent } from '@mui/material/Select';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { changeTempoCommand } from '@/domain/commands/structure-commands';
import { scoreEndTick } from '@/domain/score/queries';
import { playbackController } from '@/services/playback/controller';
import type { PlaybackStoreApi } from '@/services/playback/controller';
import { selectCurrentMeasureBeat } from '@/store/selectors';
import type { MeasureBeat } from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';

export type TransportBarProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: PlaybackStoreApi;
};

/** Spec §22: "Speeds: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x." */
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function formatMeasureBeat(mb: MeasureBeat | null): string {
  return mb ? `${mb.measureIndex}.${mb.beat}` : '-.-';
}

export function TransportBar({ store = useAppStore }: TransportBarProps) {
  const score = store((s) => s.score);
  const playbackState = store((s) => s.state);
  const positionTick = store((s) => s.positionTick);
  const loopRange = store((s) => s.loopRange);
  const metronome = store((s) => s.metronome);
  const tempoMultiplier = store((s) => s.tempoMultiplier);
  const masterVolume = store((s) => s.masterVolume);
  const measureBeat = store(selectCurrentMeasureBeat);

  const hasScore = score !== null;
  const currentBpm = score?.tempoMap[0]?.bpm ?? 120;
  const maxTick = useMemo(() => (score ? Math.max(1, scoreEndTick(score)) : 1), [score]);

  const [tempoDraft, setTempoDraft] = useState('');
  const [editingTempo, setEditingTempo] = useState(false);

  const beginEditTempo = (): void => {
    if (!hasScore) return;
    setTempoDraft(String(currentBpm));
    setEditingTempo(true);
  };

  const commitTempo = (): void => {
    setEditingTempo(false);
    const bpm = Number(tempoDraft);
    if (!score || !Number.isFinite(bpm) || bpm <= 0) return;
    const firstEvent = score.tempoMap[0];
    store
      .getState()
      .dispatchCommand(changeTempoCommand({ tempoEventId: firstEvent?.id, tick: firstEvent?.tick ?? 0, bpm }));
  };

  const handleTempoKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      // Commit directly rather than delegating to onBlur: the field unmounts
      // immediately after (editingTempo -> false), so a real blur may never
      // reach the DOM/React in time to fire it.
      commitTempo();
    } else if (event.key === 'Escape') {
      setEditingTempo(false);
    }
  };

  const handleSpeedChange = (event: SelectChangeEvent<number>): void => {
    playbackController.setTempoMultiplier(Number(event.target.value));
  };

  const handleVolumeChange = (_event: Event, value: number | number[]): void => {
    playbackController.setMasterVolume(Array.isArray(value) ? value[0] : value);
  };

  const handleScrub = (event: ChangeEvent<HTMLInputElement>): void => {
    playbackController.seek(Number(event.target.value));
  };

  return (
    <Toolbar
      variant="dense"
      role="toolbar"
      aria-label="Playback transport"
      sx={{ flexWrap: 'wrap', gap: 1, borderBottom: 1, borderColor: 'divider' }}
    >
      <Tooltip title="Go to start">
        <span>
          <IconButton
            size="small"
            aria-label="Go to start"
            disabled={!hasScore}
            onClick={() => playbackController.goToStart()}
          >
            ◀◀
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Previous measure">
        <span>
          <IconButton
            size="small"
            aria-label="Previous measure"
            disabled={!hasScore}
            onClick={() => playbackController.previousMeasure()}
          >
            ◀
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={playbackState === 'playing' ? 'Pause' : 'Play'}>
        <span>
          <IconButton
            size="small"
            aria-label={playbackState === 'playing' ? 'Pause' : 'Play'}
            disabled={!hasScore}
            onClick={() => playbackController.togglePlay()}
          >
            {playbackState === 'playing' ? '❚❚' : '▶'}
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Stop">
        <span>
          <IconButton size="small" aria-label="Stop" disabled={!hasScore} onClick={() => playbackController.stop()}>
            ■
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Next measure">
        <span>
          <IconButton
            size="small"
            aria-label="Next measure"
            disabled={!hasScore}
            onClick={() => playbackController.nextMeasure()}
          >
            ▶
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title="Toggle loop">
        <span>
          <ToggleButton
            size="small"
            value="loop"
            selected={loopRange !== null}
            aria-label="Toggle loop"
            disabled={!hasScore}
            onClick={() => playbackController.toggleLoop()}
          >
            Loop
          </ToggleButton>
        </span>
      </Tooltip>

      <Tooltip title="Toggle metronome">
        <span>
          <ToggleButton
            size="small"
            value="metronome"
            selected={metronome}
            aria-label="Toggle metronome"
            disabled={!hasScore}
            onClick={() => playbackController.setMetronome(!metronome)}
          >
            Metronome
          </ToggleButton>
        </span>
      </Tooltip>

      <Typography variant="body2" aria-label="Current measure and beat" sx={{ minWidth: 40, textAlign: 'center' }}>
        {formatMeasureBeat(measureBeat)}
      </Typography>

      {editingTempo ? (
        <TextField
          size="small"
          type="number"
          value={tempoDraft}
          autoFocus
          onChange={(event) => setTempoDraft(event.target.value)}
          onBlur={commitTempo}
          onKeyDown={handleTempoKeyDown}
          slotProps={{ htmlInput: { 'aria-label': 'Tempo (BPM)' } }}
          sx={{ width: 84 }}
        />
      ) : (
        <Tooltip title="Edit tempo">
          <span>
            <Typography
              component="button"
              type="button"
              variant="body2"
              aria-label="Tempo (BPM)"
              disabled={!hasScore}
              onClick={beginEditTempo}
              sx={{
                border: 'none',
                background: 'none',
                font: 'inherit',
                color: 'inherit',
                cursor: hasScore ? 'pointer' : 'default',
                minWidth: 64,
              }}
            >
              {currentBpm} BPM
            </Typography>
          </span>
        </Tooltip>
      )}

      <Select
        size="small"
        value={tempoMultiplier}
        onChange={handleSpeedChange}
        inputProps={{ 'aria-label': 'Playback speed' }}
      >
        {SPEED_OPTIONS.map((speed) => (
          <MenuItem key={speed} value={speed}>
            {speed}x
          </MenuItem>
        ))}
      </Select>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', width: 120 }}>
        <Typography variant="body2">Vol</Typography>
        <Slider size="small" aria-label="Master volume" min={0} max={1} step={0.01} value={masterVolume} onChange={handleVolumeChange} />
      </Stack>

      <Box sx={{ flex: 1, minWidth: 120 }}>
        <input
          type="range"
          aria-label="Playback position"
          min={0}
          max={maxTick}
          value={Math.min(positionTick, maxTick)}
          disabled={!hasScore}
          onChange={handleScrub}
          style={{ width: '100%' }}
        />
      </Box>
    </Toolbar>
  );
}
