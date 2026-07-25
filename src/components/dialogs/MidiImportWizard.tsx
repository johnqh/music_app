/**
 * MIDI import wizard (spec §15): file pick, per-track summary (name/
 * channel/program/note count/duration) with include + target-clef
 * controls, quantization/cleanup controls, a performance-timing warning
 * (spec §15: "Show a warning that MIDI contains performance timing rather
 * than complete notation semantics"), a text preview of the would-be
 * import, and a single-command Import.
 *
 * Import always lands as exactly one undoable command (spec §15: "Import
 * must be one undoable operation"): when no project is open yet (the
 * dashboard's "Import MIDI" button), a brand-new project is created with
 * the imported score already committed (nothing to confirm — there's no
 * existing work to lose); when a project is already open (the app bar's
 * import menu), replacing its score is a destructive edit and is
 * confirmed first, then dispatched via `importScoreCommand`.
 */
import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import type { SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { MidiSummary } from '@/adapters/midi/analyze';
import { defaultMidiImportOptions } from '@/adapters/midi/import-options';
import type { MidiImportOptions } from '@/adapters/midi/import-options';
import type { Clef, DurationName, NoteEvent } from '@/domain/score/types';
import { isNoteEvent } from '@/domain/score/types';
import { importScoreCommand } from '@/domain/commands/region-commands';
import { reportError } from '@/services/errors';
import { MidiService } from '@/services/import-export/midi-service';
import { useAppStore } from '@/store/useAppStore';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';

export type MidiImportWizardProps = {
  open: boolean;
  onClose: () => void;
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /** Defaults to a fresh `MidiService`; tests inject a fake to avoid depending on Worker/file-parsing internals. */
  midiService?: Pick<MidiService, 'analyze' | 'import'>;
  /** Called after a successful import that created a brand-new project (no project was open), with the new project's id -- e.g. the dashboard navigates to `/project/:id`. */
  onImportedNewProject?: (projectId: string) => void;
};

const CLEF_OPTIONS: Clef[] = ['treble', 'bass', 'alto', 'tenor', 'percussion'];
const QUANTIZE_GRID_OPTIONS: Array<{ value: DurationName | 'none'; label: string }> = [
  { value: 'none', label: 'No quantization' },
  { value: 'whole', label: 'Whole' },
  { value: 'half', label: 'Half' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'eighth', label: 'Eighth' },
  { value: 'sixteenth', label: 'Sixteenth' },
  { value: 'thirtysecond', label: 'Thirty-second' },
];

/** A short, human-readable preview of the first few notes (by start tick), e.g. "C4, E4, G4, C5, ...". */
function firstNotesPreview(notes: NoteEvent[], limit = 12): string {
  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick);
  const labels = sorted.slice(0, limit).map((n) => `${n.pitch.step}${n.pitch.octave}`);
  if (labels.length === 0) return '(no notes)';
  return labels.join(', ') + (sorted.length > limit ? ', ...' : '');
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

export function MidiImportWizard({
  open,
  onClose,
  store = useAppStore,
  midiService,
  onImportedNewProject,
}: MidiImportWizardProps) {
  const service = useMemo(() => midiService ?? new MidiService(), [midiService]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [summary, setSummary] = useState<MidiSummary | null>(null);
  const [options, setOptions] = useState<MidiImportOptions | null>(null);
  const [preview, setPreview] = useState<{ noteCount: number; text: string; warnings: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState(false);

  const reset = (): void => {
    setFileName(null);
    setFileBuffer(null);
    setSummary(null);
    setOptions(null);
    setPreview(null);
    setError(null);
    setBusy(false);
  };

  const handleClose = (): void => {
    reset();
    onClose();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const buffer = await readFileAsArrayBuffer(file);
      const parsedSummary = await service.analyze(buffer);
      setFileName(file.name);
      setFileBuffer(buffer);
      setSummary(parsedSummary);
      setOptions(defaultMidiImportOptions(parsedSummary));
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePreview = async (): Promise<void> => {
    if (!fileBuffer || !options) return;
    setBusy(true);
    setError(null);
    try {
      const result = await service.import(fileBuffer, options);
      const notes = result.score.tracks.flatMap((t) => t.measures.flatMap((m) => m.voices.flatMap((v) => v.events.filter(isNoteEvent))));
      setPreview({ noteCount: notes.length, text: firstNotesPreview(notes), warnings: result.warnings });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const commitImport = async (): Promise<void> => {
    if (!fileBuffer || !options) return;
    setBusy(true);
    setError(null);
    try {
      const result = await service.import(fileBuffer, options);
      const hasProject = store.getState().projectId !== null;
      if (hasProject) {
        store.getState().dispatchCommand(importScoreCommand(result.score));
        handleClose();
      } else {
        await store.getState().newProject({ name: fileName ?? result.score.metadata.title, score: result.score });
        const projectId = store.getState().projectId;
        handleClose();
        if (projectId) onImportedNewProject?.(projectId);
      }
    } catch (err) {
      reportError(err, { context: 'MIDI import failed', store });
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleImportClick = (): void => {
    if (store.getState().projectId !== null) {
      setConfirmingReplace(true);
    } else {
      void commitImport();
    }
  };

  const patchOptions = (patch: Partial<MidiImportOptions>): void => {
    setOptions((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const patchTrackSelection = (sourceIndex: number, patch: Partial<{ include: boolean; clef: Clef }>): void => {
    setOptions((prev) =>
      prev
        ? {
            ...prev,
            trackSelections: prev.trackSelections.map((sel) => (sel.sourceIndex === sourceIndex ? { ...sel, ...patch } : sel)),
          }
        : prev,
    );
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} aria-labelledby="midi-import-title" maxWidth="md" fullWidth>
        <DialogTitle id="midi-import-title">Import MIDI</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Button component="label" variant="outlined" aria-label="Choose MIDI file">
              {fileName ?? 'Choose MIDI file...'}
              <input
                ref={fileInputRef}
                type="file"
                accept=".mid,.midi,audio/midi"
                hidden
                aria-label="MIDI file input"
                onChange={(e) => void handleFileChange(e)}
              />
            </Button>

            {error && <Alert severity="error">{error}</Alert>}

            {summary && options && (
              <>
                <Alert severity="warning">
                  MIDI stores performance timing, not complete notation semantics -- imported notation is an
                  approximation. Review the settings below and preview before importing.
                </Alert>

                <Typography variant="subtitle2">
                  {summary.tracks.length} track(s), {summary.durationSeconds.toFixed(1)}s, {summary.ppq} PPQ
                </Typography>

                <Table size="small" aria-label="MIDI track summary">
                  <TableHead>
                    <TableRow>
                      <TableCell>Include</TableCell>
                      <TableCell>Track</TableCell>
                      <TableCell>Channel</TableCell>
                      <TableCell>Program</TableCell>
                      <TableCell>Notes</TableCell>
                      <TableCell>Clef</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {summary.tracks.map((track) => {
                      const selection = options.trackSelections.find((s) => s.sourceIndex === track.index);
                      if (!selection) return null;
                      return (
                        <TableRow key={track.index}>
                          <TableCell>
                            <Checkbox
                              size="small"
                              checked={selection.include}
                              onChange={(e) => patchTrackSelection(track.index, { include: e.target.checked })}
                              slotProps={{ input: { 'aria-label': `Include track: ${track.name}` } }}
                            />
                          </TableCell>
                          <TableCell>{track.name}</TableCell>
                          <TableCell>{track.channel}</TableCell>
                          <TableCell>{track.program}</TableCell>
                          <TableCell>{track.noteCount}</TableCell>
                          <TableCell>
                            <Select
                              size="small"
                              value={selection.clef}
                              onChange={(e: SelectChangeEvent) => patchTrackSelection(track.index, { clef: e.target.value as Clef })}
                              inputProps={{ 'aria-label': `Clef: ${track.name}` }}
                            >
                              {CLEF_OPTIONS.map((clef) => (
                                <MenuItem key={clef} value={clef}>
                                  {clef}
                                </MenuItem>
                              ))}
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap', gap: 2 }}>
                  <Select
                    size="small"
                    value={options.quantizeGrid ?? 'none'}
                    onChange={(e: SelectChangeEvent) =>
                      patchOptions({ quantizeGrid: e.target.value === 'none' ? null : (e.target.value as DurationName) })
                    }
                    inputProps={{ 'aria-label': 'Quantize grid' }}
                  >
                    {QUANTIZE_GRID_OPTIONS.map((opt) => (
                      <MenuItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </MenuItem>
                    ))}
                  </Select>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={options.tripletDetection}
                        onChange={(e) => patchOptions({ tripletDetection: e.target.checked })}
                        slotProps={{ input: { 'aria-label': 'Triplet detection' } }}
                      />
                    }
                    label="Triplet detection"
                  />
                  <TextField
                    size="small"
                    type="number"
                    label="Min. note duration (ticks)"
                    value={options.minDurationTicks}
                    onChange={(e) => patchOptions({ minDurationTicks: Math.max(0, Number(e.target.value) || 0) })}
                    slotProps={{ htmlInput: { 'aria-label': 'Minimum note duration (ticks)', min: 0 } }}
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={options.mergeNearDuplicates}
                        onChange={(e) => patchOptions({ mergeNearDuplicates: e.target.checked })}
                        slotProps={{ input: { 'aria-label': 'Merge near-duplicate notes' } }}
                      />
                    }
                    label="Merge near-duplicates"
                  />
                  <Select
                    size="small"
                    value={options.sustainPedal}
                    onChange={(e: SelectChangeEvent) => patchOptions({ sustainPedal: e.target.value as 'extend' | 'ignore' })}
                    inputProps={{ 'aria-label': 'Sustain pedal handling' }}
                  >
                    <MenuItem value="extend">Extend notes through sustain</MenuItem>
                    <MenuItem value="ignore">Ignore sustain pedal</MenuItem>
                  </Select>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={options.pianoStaffSplit}
                        onChange={(e) => patchOptions({ pianoStaffSplit: e.target.checked })}
                        slotProps={{ input: { 'aria-label': 'Piano staff split' } }}
                      />
                    }
                    label="Piano staff split"
                  />
                  {options.pianoStaffSplit && (
                    <TextField
                      size="small"
                      type="number"
                      label="Split point (MIDI note)"
                      value={options.splitPointMidi}
                      onChange={(e) => patchOptions({ splitPointMidi: Number(e.target.value) || 60 })}
                      slotProps={{ htmlInput: { 'aria-label': 'Split point (MIDI note number)', min: 0, max: 127 } }}
                    />
                  )}
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={options.detectKey}
                        onChange={(e) => patchOptions({ detectKey: e.target.checked })}
                        slotProps={{ input: { 'aria-label': 'Detect key' } }}
                      />
                    }
                    label="Detect key"
                  />
                </Stack>

                <Button size="small" aria-label="Preview import" disabled={busy} onClick={() => void handlePreview()}>
                  Preview
                </Button>

                {preview && (
                  <Box>
                    <Typography variant="body2">{preview.noteCount} notes after import.</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {preview.text}
                    </Typography>
                    {preview.warnings.map((w) => (
                      <Alert key={w} severity="warning" sx={{ mt: 1 }}>
                        {w}
                      </Alert>
                    ))}
                  </Box>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            variant="contained"
            aria-label="Import"
            disabled={!summary || !options || busy}
            onClick={handleImportClick}
          >
            Import
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmingReplace}
        title="Replace current score"
        message="Importing this MIDI file will replace the current project's score. This can be undone with Undo."
        confirmLabel="Replace"
        onCancel={() => setConfirmingReplace(false)}
        onConfirm={() => {
          setConfirmingReplace(false);
          void commitImport();
        }}
      />
    </>
  );
}
