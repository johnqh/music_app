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
 *
 * Re-skinned onto Tailwind + @sudobility/components (T12 batch 5): the MUI
 * Dialog becomes `@sudobility/components`' `FormModal`, which owns the title,
 * the scrolling body and the Cancel/Import footer (same pattern as every other
 * dialog here), the MUI Table becomes a plain `<table>` (same
 * "MIDI track summary" accessible name via `aria-label`), MUI Selects
 * become native `<select>`s, and MUI Checkboxes become native
 * `<input type="checkbox">`s — same roles/labels/accessible names as
 * before, so no test assertions changed.
 *
 * Adopts `@sudobility/components` controls (library sweep 2): the per-track
 * clef/quantize-grid/sustain-pedal `<select>`s become the library's
 * Radix-backed `Select`, the min-duration/split-point fields become the
 * library `Input`, Preview/Cancel/Import become the library `Button`, and
 * every checkbox becomes the library `Checkbox` -- still a real native
 * `<input type="checkbox">`, so no interaction-style test changes. Two of
 * those checkboxes get a *visible* text change from adopting `Checkbox`'s
 * `label` prop (the only way to give it an accessible name, since it has
 * no `aria-label` prop): the per-track "Include" checkbox had no visible
 * text at all before (aria-label only), and "Merge near-duplicates"
 * becomes "Merge near-duplicate notes" (its own aria-label already said
 * "notes"; `label` must supply that exact string to keep the accessible
 * name, and `label` is what's rendered on screen). The "Choose MIDI file"
 * label + hidden file input stay exactly as-is: `Button` renders a
 * `<button>`, not a `<label>`, so it can't drive a hidden native file
 * input's picker the way a real `<label>` wrapping it does.
 */
import { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sudobility/components';
import type { MidiSummary } from '@sudobility/music_lib';
import { defaultMidiImportOptions } from '@sudobility/music_lib';
import type { MidiImportOptions } from '@sudobility/music_lib';
import type { Clef, DurationName, NoteEvent } from '@sudobility/music_types';
import { isNoteEvent } from '@sudobility/music_types';
import { importScoreCommand } from '@sudobility/music_lib';
import { reportError } from '@sudobility/music_lib';
import { MidiService } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { FileImportModal } from '@/components/dialogs/FileImportModal';
import { getAppServices } from '@/config/initialize';

export type MidiImportWizardProps = {
  open: boolean;
  onClose: () => void;
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /** Defaults to a fresh `MidiService`; tests inject a fake to avoid depending on Worker/file-parsing internals. */
  midiService?: Pick<MidiService, 'analyze' | 'import'>;
  /** Called after a successful import that created a brand-new project (no project was open), with the new project's id -- e.g. the dashboard navigates to `/project/:id`. */
  onImportedNewProject?: (projectId: string) => void;
  /**
   * Always takes the "create a new project" path, even if `store` still has
   * a `projectId` set from a previously-open project (e.g. the dashboard's
   * import buttons: the shared app-wide store's last-open project lingers
   * after navigating back to `/`, but the dashboard has no "current
   * project" to confirm replacing). Defaults to `false` (the app bar's
   * import menu, used from inside an already-open project, wants the
   * normal confirm-then-replace behavior).
   */
  forceNewProject?: boolean;
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

const SELECT_TRIGGER_CLASS = 'h-auto w-auto min-w-[8rem] px-2 py-1 text-sm';

const TEXT_INPUT_CLASS = 'w-auto px-2 py-1 text-sm';

export function MidiImportWizard({
  open,
  onClose,
  store = useAppStore,
  midiService,
  onImportedNewProject,
  forceNewProject = false,
}: MidiImportWizardProps) {
  const service = useMemo(
    () => midiService ?? new MidiService(getAppServices().io.midiCodec),
    [midiService],
  );

  const [fileName, setFileName] = useState<string | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [summary, setSummary] = useState<MidiSummary | null>(null);
  const [options, setOptions] = useState<MidiImportOptions | null>(null);
  const [preview, setPreview] = useState<{
    noteCount: number;
    text: string;
    warnings: string[];
  } | null>(null);
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

  const handleFile = async (file: File): Promise<void> => {
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
    }
  };

  const handlePreview = async (): Promise<void> => {
    if (!fileBuffer || !options) return;
    setBusy(true);
    setError(null);
    try {
      const result = await service.import(fileBuffer, options);
      const notes = result.score.tracks.flatMap((t) =>
        t.measures.flatMap((m) => m.voices.flatMap((v) => v.events.filter(isNoteEvent))),
      );
      setPreview({
        noteCount: notes.length,
        text: firstNotesPreview(notes),
        warnings: result.warnings,
      });
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
      const hasProject = !forceNewProject && store.getState().projectId !== null;
      if (hasProject) {
        store.getState().dispatchCommand(importScoreCommand(result.score));
        handleClose();
      } else {
        await store
          .getState()
          .newProject({ name: fileName ?? result.score.metadata.title, score: result.score });
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
    if (!forceNewProject && store.getState().projectId !== null) {
      setConfirmingReplace(true);
    } else {
      void commitImport();
    }
  };

  const patchOptions = (patch: Partial<MidiImportOptions>): void => {
    setOptions((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const patchTrackSelection = (
    sourceIndex: number,
    patch: Partial<{ include: boolean; clef: Clef }>,
  ): void => {
    setOptions((prev) =>
      prev
        ? {
            ...prev,
            trackSelections: prev.trackSelections.map((sel) =>
              sel.sourceIndex === sourceIndex ? { ...sel, ...patch } : sel,
            ),
          }
        : prev,
    );
  };

  return (
    <>
      <FileImportModal
        open={open}
        title="Import MIDI"
        accept=".mid,.midi,audio/midi"
        fileKind="MIDI file"
        fileName={fileName}
        onFile={(file) => void handleFile(file)}
        busy={busy}
        busyLabel="Reading the file…"
        error={error}
        canImport={Boolean(summary && options)}
        onImport={handleImportClick}
        onClose={handleClose}
        size="large"
        description="Opens a MIDI file as a new project. Choose which tracks to bring and how to read their timing below."
      >
        {summary && options && (
          <>
            <div
              role="status"
              className="rounded-md bg-amber-600/10 px-3 py-2 text-sm text-amber-700"
            >
              MIDI stores performance timing, not complete notation semantics -- imported notation
              is an approximation. Review the settings below and preview before importing.
            </div>

            <p className="text-sm font-medium text-theme-text-primary">
              {summary.tracks.length} track(s), {summary.durationSeconds.toFixed(1)}s, {summary.ppq}{' '}
              PPQ
            </p>

            <div className="overflow-x-auto rounded-md border border-theme-border">
              <table aria-label="MIDI track summary" className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-theme-border text-theme-text-secondary">
                    <th className="px-2 py-1.5 font-medium">Include</th>
                    <th className="px-2 py-1.5 font-medium">Track</th>
                    <th className="px-2 py-1.5 font-medium">Channel</th>
                    <th className="px-2 py-1.5 font-medium">Program</th>
                    <th className="px-2 py-1.5 font-medium">Notes</th>
                    <th className="px-2 py-1.5 font-medium">Clef</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.tracks.map((track) => {
                    const selection = options.trackSelections.find(
                      (s) => s.sourceIndex === track.index,
                    );
                    if (!selection) return null;
                    return (
                      <tr
                        key={track.index}
                        className="border-b border-theme-border text-theme-text-primary last:border-b-0"
                      >
                        <td className="px-2 py-1.5">
                          <Checkbox
                            label={`Include track: ${track.name}`}
                            checked={selection.include}
                            onChange={(checked) =>
                              patchTrackSelection(track.index, { include: checked })
                            }
                          />
                        </td>
                        <td className="px-2 py-1.5">{track.name}</td>
                        <td className="px-2 py-1.5">{track.channel}</td>
                        <td className="px-2 py-1.5">{track.program}</td>
                        <td className="px-2 py-1.5">{track.noteCount}</td>
                        <td className="px-2 py-1.5">
                          <Select
                            value={selection.clef}
                            onValueChange={(v) =>
                              patchTrackSelection(track.index, { clef: v as Clef })
                            }
                          >
                            <SelectTrigger
                              aria-label={`Clef: ${track.name}`}
                              className={SELECT_TRIGGER_CLASS}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CLEF_OPTIONS.map((clef) => (
                                <SelectItem key={clef} value={clef}>
                                  {clef}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-theme-text-secondary">Quantize grid</span>
                <Select
                  value={options.quantizeGrid ?? 'none'}
                  onValueChange={(v) =>
                    patchOptions({ quantizeGrid: v === 'none' ? null : (v as DurationName) })
                  }
                >
                  <SelectTrigger aria-label="Quantize grid" className={SELECT_TRIGGER_CLASS}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUANTIZE_GRID_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <Checkbox
                label="Triplet detection"
                checked={options.tripletDetection}
                onChange={(checked) => patchOptions({ tripletDetection: checked })}
              />

              <label className="flex flex-col gap-1">
                <span className="text-xs text-theme-text-secondary">
                  Min. note duration (ticks)
                </span>
                <Input
                  type="number"
                  min={0}
                  aria-label="Minimum note duration (ticks)"
                  value={options.minDurationTicks}
                  onChange={(e) =>
                    patchOptions({ minDurationTicks: Math.max(0, Number(e.target.value) || 0) })
                  }
                  className={TEXT_INPUT_CLASS}
                />
              </label>

              <Checkbox
                label="Merge near-duplicate notes"
                checked={options.mergeNearDuplicates}
                onChange={(checked) => patchOptions({ mergeNearDuplicates: checked })}
              />

              <label className="flex flex-col gap-1">
                <span className="text-xs text-theme-text-secondary">Sustain pedal handling</span>
                <Select
                  value={options.sustainPedal}
                  onValueChange={(v) => patchOptions({ sustainPedal: v as 'extend' | 'ignore' })}
                >
                  <SelectTrigger
                    aria-label="Sustain pedal handling"
                    className={SELECT_TRIGGER_CLASS}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="extend">Extend notes through sustain</SelectItem>
                    <SelectItem value="ignore">Ignore sustain pedal</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <Checkbox
                label="Piano staff split"
                checked={options.pianoStaffSplit}
                onChange={(checked) => patchOptions({ pianoStaffSplit: checked })}
              />

              {options.pianoStaffSplit && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-theme-text-secondary">Split point (MIDI note)</span>
                  <Input
                    type="number"
                    min={0}
                    max={127}
                    aria-label="Split point (MIDI note number)"
                    value={options.splitPointMidi}
                    onChange={(e) => patchOptions({ splitPointMidi: Number(e.target.value) || 60 })}
                    className={TEXT_INPUT_CLASS}
                  />
                </label>
              )}

              <Checkbox
                label="Detect key"
                checked={options.detectKey}
                onChange={(checked) => patchOptions({ detectKey: checked })}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              aria-label="Preview import"
              disabled={busy}
              onClick={() => void handlePreview()}
              className="self-start px-3 py-1.5"
            >
              Preview
            </Button>

            {preview && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-theme-text-primary">
                  {preview.noteCount} notes after import.
                </p>
                <p className="font-mono text-sm text-theme-text-secondary">{preview.text}</p>
                {preview.warnings.map((w) => (
                  <div
                    key={w}
                    role="status"
                    className="rounded-md bg-amber-600/10 px-3 py-2 text-sm text-amber-700"
                  >
                    {w}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </FileImportModal>

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
