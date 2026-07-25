/**
 * Score editor toolbar (spec §6 editor region, §7 editing operations):
 * note-duration palette, accidental toggle, articulation menu, tie toggle,
 * insert note/rest, quantize button + grid select, zoom controls, layout
 * mode toggle, and the notation/piano-roll view switch.
 *
 * Every control that mutates the score routes through `editing.ts` (never
 * `store.dispatchCommand` directly), and every interactive control carries
 * an explicit `aria-label` (spec §27: ARIA labels, don't rely on
 * icon/color alone).
 */
import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import type { SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { findEvent } from '@sudobility/music_lib';
import { isNoteEvent } from '@sudobility/music_types';
import type { Accidental, Articulation, DurationName, Pitch } from '@sudobility/music_types';
import { ticksFor } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import {
  changeAccidental,
  changeArticulation,
  changeDuration,
  insertNoteAtSelection,
  insertRestAtSelection,
  quantizeSelection,
  selectAll,
  toggleTie,
} from '@/features/score-editor/editing';

export type LayoutMode = 'page' | 'continuous';

export type EditorToolbarProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  layoutMode: LayoutMode;
  onLayoutModeChange: (mode: LayoutMode) => void;
};

const DURATION_OPTIONS: Array<{ value: DurationName; label: string; ariaLabel: string }> = [
  { value: 'whole', label: '𝅝', ariaLabel: 'Whole note' },
  { value: 'half', label: '𝅗𝅥', ariaLabel: 'Half note' },
  { value: 'quarter', label: '♩', ariaLabel: 'Quarter note' },
  { value: 'eighth', label: '♪', ariaLabel: 'Eighth note' },
  { value: 'sixteenth', label: '𝅘𝅥𝅯', ariaLabel: 'Sixteenth note' },
  { value: 'thirtysecond', label: '𝅘𝅥𝅰', ariaLabel: 'Thirty-second note' },
];

const ACCIDENTAL_OPTIONS: Array<{ value: Accidental; label: string; ariaLabel: string }> = [
  { value: -2, label: '𝄫', ariaLabel: 'Double flat' },
  { value: -1, label: '♭', ariaLabel: 'Flat' },
  { value: 0, label: '♮', ariaLabel: 'Natural' },
  { value: 1, label: '♯', ariaLabel: 'Sharp' },
  { value: 2, label: '𝄪', ariaLabel: 'Double sharp' },
];

const ARTICULATION_OPTIONS: Array<{ value: Articulation | undefined; label: string }> = [
  { value: undefined, label: 'None' },
  { value: 'staccato', label: 'Staccato' },
  { value: 'accent', label: 'Accent' },
  { value: 'tenuto', label: 'Tenuto' },
  { value: 'marcato', label: 'Marcato' },
];

const QUANTIZE_GRID_OPTIONS: DurationName[] = ['quarter', 'eighth', 'sixteenth', 'thirtysecond'];

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** The pitch a freshly-inserted note should use: the first selected note's own pitch, else middle C. */
function defaultInsertPitch(store: EditorStoreApi): Pitch {
  const { score, selection } = store.getState();
  if (score) {
    for (const id of selection.eventIds) {
      const event = findEvent(score, id);
      if (event && isNoteEvent(event)) return event.pitch;
    }
  }
  return { step: 'C', accidental: 0, octave: 4 };
}

export function EditorToolbar({ store = useAppStore, layoutMode, onLayoutModeChange }: EditorToolbarProps) {
  const score = store((s) => s.score);
  const snapGrid = store((s) => s.snapGrid);
  const view = store((s) => s.view);
  const zoom = store((s) => s.zoom);
  const hasScore = score !== null;

  const [quantizeGrid, setQuantizeGrid] = useState<DurationName>('sixteenth');
  const [articulationAnchor, setArticulationAnchor] = useState<HTMLElement | null>(null);

  const zoomLabel = useMemo(() => `${Math.round(zoom * 100)}%`, [zoom]);

  const handleDurationChange = (_event: React.MouseEvent<HTMLElement>, value: DurationName | null): void => {
    if (!value) return;
    store.getState().setSnapGrid(value);
    changeDuration(store, value);
  };

  const handleAccidentalClick = (accidental: Accidental): void => {
    changeAccidental(store, accidental);
  };

  const handleArticulationSelect = (articulation: Articulation | undefined): void => {
    changeArticulation(store, articulation);
    setArticulationAnchor(null);
  };

  const handleInsertNote = (): void => {
    insertNoteAtSelection(store, defaultInsertPitch(store));
  };

  const handleInsertRest = (): void => {
    insertRestAtSelection(store);
  };

  const handleQuantizeGridChange = (event: SelectChangeEvent<DurationName>): void => {
    setQuantizeGrid(event.target.value as DurationName);
  };

  const handleQuantize = (): void => {
    if (!score) return;
    quantizeSelection(store, {
      grid: ticksFor(quantizeGrid, score.ppq),
      quantizeStarts: true,
      quantizeDurations: true,
    });
  };

  const handleZoomIn = (): void => store.getState().setZoom(clampZoom(zoom * ZOOM_STEP));
  const handleZoomOut = (): void => store.getState().setZoom(clampZoom(zoom / ZOOM_STEP));

  return (
    <Toolbar
      variant="dense"
      role="toolbar"
      aria-label="Score editor toolbar"
      sx={{ flexWrap: 'wrap', gap: 1, borderBottom: 1, borderColor: 'divider' }}
    >
      <Stack direction="row" spacing={0.5} role="group" aria-label="Note duration" sx={{ alignItems: 'center' }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={snapGrid}
          onChange={handleDurationChange}
          aria-label="Note duration"
        >
          {DURATION_OPTIONS.map((option) => (
            <ToggleButton key={option.value} value={option.value} aria-label={option.ariaLabel}>
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <Divider orientation="vertical" flexItem />

      <Stack direction="row" spacing={0.5} role="group" aria-label="Accidental" sx={{ alignItems: 'center' }}>
        {ACCIDENTAL_OPTIONS.map((option) => (
          <Tooltip key={option.value} title={option.ariaLabel}>
            <span>
              <IconButton
                size="small"
                aria-label={option.ariaLabel}
                disabled={!hasScore}
                onClick={() => handleAccidentalClick(option.value)}
              >
                {option.label}
              </IconButton>
            </span>
          </Tooltip>
        ))}
      </Stack>

      <Divider orientation="vertical" flexItem />

      <Button
        size="small"
        aria-label="Articulation"
        disabled={!hasScore}
        onClick={(e) => setArticulationAnchor(e.currentTarget)}
      >
        Articulation
      </Button>
      <Menu
        anchorEl={articulationAnchor}
        open={articulationAnchor !== null}
        onClose={() => setArticulationAnchor(null)}
      >
        {ARTICULATION_OPTIONS.map((option) => (
          <MenuItem key={option.label} onClick={() => handleArticulationSelect(option.value)}>
            {option.label}
          </MenuItem>
        ))}
      </Menu>

      <Tooltip title="Toggle tie">
        <span>
          <IconButton
            size="small"
            aria-label="Toggle tie"
            disabled={!hasScore}
            onClick={() => toggleTie(store, 'tieStart')}
          >
            ⌣
          </IconButton>
        </span>
      </Tooltip>

      <Divider orientation="vertical" flexItem />

      <Button size="small" aria-label="Insert note" disabled={!hasScore} onClick={handleInsertNote}>
        Insert note
      </Button>
      <Button size="small" aria-label="Insert rest" disabled={!hasScore} onClick={handleInsertRest}>
        Insert rest
      </Button>
      <Button size="small" aria-label="Select all" disabled={!hasScore} onClick={() => selectAll(store)}>
        Select all
      </Button>

      <Divider orientation="vertical" flexItem />

      <Select
        size="small"
        value={quantizeGrid}
        onChange={handleQuantizeGridChange}
        inputProps={{ 'aria-label': 'Quantize grid' }}
      >
        {QUANTIZE_GRID_OPTIONS.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </Select>
      <Button size="small" aria-label="Quantize" disabled={!hasScore} onClick={handleQuantize}>
        Quantize
      </Button>

      <Divider orientation="vertical" flexItem />

      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Tooltip title="Zoom out">
          <span>
            <IconButton size="small" aria-label="Zoom out" onClick={handleZoomOut}>
              −
            </IconButton>
          </span>
        </Tooltip>
        <Typography variant="body2" aria-label="Current zoom level" sx={{ minWidth: 40, textAlign: 'center' }}>
          {zoomLabel}
        </Typography>
        <Tooltip title="Zoom in">
          <span>
            <IconButton size="small" aria-label="Zoom in" onClick={handleZoomIn}>
              +
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Divider orientation="vertical" flexItem />

      <ToggleButtonGroup
        size="small"
        exclusive
        value={layoutMode}
        onChange={(_e, value: LayoutMode | null) => value && onLayoutModeChange(value)}
        aria-label="Layout mode"
      >
        <ToggleButton value="page" aria-label="Page layout">
          Page
        </ToggleButton>
        <ToggleButton value="continuous" aria-label="Continuous layout">
          Continuous
        </ToggleButton>
      </ToggleButtonGroup>

      <Box sx={{ flex: 1 }} />

      <ToggleButtonGroup
        size="small"
        exclusive
        value={view}
        onChange={(_e, value: 'notation' | 'piano-roll' | null) => value && store.getState().setView(value)}
        aria-label="Editor view"
      >
        <ToggleButton value="notation" aria-label="Notation view">
          Notation
        </ToggleButton>
        <ToggleButton value="piano-roll" aria-label="Piano roll view">
          Piano roll
        </ToggleButton>
      </ToggleButtonGroup>
    </Toolbar>
  );
}
