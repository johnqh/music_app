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
 * Dialog becomes `@sudobility/components`' Dialog with an inner
 * `role="dialog"` + labelled heading (same pattern as `ConfirmDialog`/
 * `MusicXmlImportDialog`), the MUI Table becomes a plain `<table>` (same
 * "MIDI track summary" accessible name via `aria-label`), MUI Selects
 * become native `<select>`s, and MUI Checkboxes become native
 * `<input type="checkbox">`s — same roles/labels/accessible names as
 * before, so no test assertions changed.
 */
import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Dialog } from '@sudobility/components';
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

const TEXT_BUTTON_CLASS = 'rounded-md px-4 py-2 text-sm text-theme-text-secondary hover:bg-theme-hover-bg';

const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

const SECONDARY_BUTTON_CLASS =
  'rounded-md border border-theme-border px-3 py-1.5 text-sm text-theme-text-primary hover:bg-theme-hover-bg disabled:cursor-not-allowed disabled:opacity-50';

const SELECT_CLASS = 'rounded-md border border-theme-border bg-theme-bg-primary px-2 py-1 text-sm text-theme-text-primary';

const TEXT_INPUT_CLASS = 'rounded-md border border-theme-border bg-theme-bg-primary px-2 py-1 text-sm text-theme-text-primary';

const CHECKBOX_LABEL_CLASS = 'flex items-center gap-2 text-sm text-theme-text-primary';

export function MidiImportWizard({
  open,
  onClose,
  store = useAppStore,
  midiService,
  onImportedNewProject,
  forceNewProject = false,
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
      const hasProject = !forceNewProject && store.getState().projectId !== null;
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
    if (!forceNewProject && store.getState().projectId !== null) {
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
      <Dialog isOpen={open} onClose={handleClose} size="lg" showCloseButton={false}>
        <div role="dialog" aria-labelledby="midi-import-title" className="flex max-h-[85vh] flex-col p-6">
          <h2 id="midi-import-title" className="text-lg font-semibold text-theme-text-primary">
            Import MIDI
          </h2>

          <div className="mt-4 flex flex-col gap-3 overflow-y-auto">
            <label
              role="button"
              tabIndex={0}
              aria-label="Choose MIDI file"
              className="cursor-pointer self-start rounded-md border border-theme-border px-3 py-2 text-sm text-theme-text-primary hover:bg-theme-hover-bg"
            >
              {fileName ?? 'Choose MIDI file...'}
              <input
                ref={fileInputRef}
                type="file"
                accept=".mid,.midi,audio/midi"
                className="sr-only"
                aria-label="MIDI file input"
                onChange={(e) => void handleFileChange(e)}
              />
            </label>

            {error && (
              <div role="alert" className="rounded-md bg-red-600/10 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            {summary && options && (
              <>
                <div role="status" className="rounded-md bg-amber-600/10 px-3 py-2 text-sm text-amber-700">
                  MIDI stores performance timing, not complete notation semantics -- imported notation is an
                  approximation. Review the settings below and preview before importing.
                </div>

                <p className="text-sm font-medium text-theme-text-primary">
                  {summary.tracks.length} track(s), {summary.durationSeconds.toFixed(1)}s, {summary.ppq} PPQ
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
                        const selection = options.trackSelections.find((s) => s.sourceIndex === track.index);
                        if (!selection) return null;
                        return (
                          <tr key={track.index} className="border-b border-theme-border text-theme-text-primary last:border-b-0">
                            <td className="px-2 py-1.5">
                              <input
                                type="checkbox"
                                aria-label={`Include track: ${track.name}`}
                                checked={selection.include}
                                onChange={(e) => patchTrackSelection(track.index, { include: e.target.checked })}
                                className="h-4 w-4 rounded border-theme-border"
                              />
                            </td>
                            <td className="px-2 py-1.5">{track.name}</td>
                            <td className="px-2 py-1.5">{track.channel}</td>
                            <td className="px-2 py-1.5">{track.program}</td>
                            <td className="px-2 py-1.5">{track.noteCount}</td>
                            <td className="px-2 py-1.5">
                              <select
                                aria-label={`Clef: ${track.name}`}
                                value={selection.clef}
                                onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                                  patchTrackSelection(track.index, { clef: e.target.value as Clef })
                                }
                                className={SELECT_CLASS}
                              >
                                {CLEF_OPTIONS.map((clef) => (
                                  <option key={clef} value={clef}>
                                    {clef}
                                  </option>
                                ))}
                              </select>
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
                    <select
                      aria-label="Quantize grid"
                      value={options.quantizeGrid ?? 'none'}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                        patchOptions({ quantizeGrid: e.target.value === 'none' ? null : (e.target.value as DurationName) })
                      }
                      className={SELECT_CLASS}
                    >
                      {QUANTIZE_GRID_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className={CHECKBOX_LABEL_CLASS}>
                    <input
                      type="checkbox"
                      aria-label="Triplet detection"
                      checked={options.tripletDetection}
                      onChange={(e) => patchOptions({ tripletDetection: e.target.checked })}
                      className="h-4 w-4 rounded border-theme-border"
                    />
                    Triplet detection
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-theme-text-secondary">Min. note duration (ticks)</span>
                    <input
                      type="number"
                      min={0}
                      aria-label="Minimum note duration (ticks)"
                      value={options.minDurationTicks}
                      onChange={(e) => patchOptions({ minDurationTicks: Math.max(0, Number(e.target.value) || 0) })}
                      className={TEXT_INPUT_CLASS}
                    />
                  </label>

                  <label className={CHECKBOX_LABEL_CLASS}>
                    <input
                      type="checkbox"
                      aria-label="Merge near-duplicate notes"
                      checked={options.mergeNearDuplicates}
                      onChange={(e) => patchOptions({ mergeNearDuplicates: e.target.checked })}
                      className="h-4 w-4 rounded border-theme-border"
                    />
                    Merge near-duplicates
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-theme-text-secondary">Sustain pedal handling</span>
                    <select
                      aria-label="Sustain pedal handling"
                      value={options.sustainPedal}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) =>
                        patchOptions({ sustainPedal: e.target.value as 'extend' | 'ignore' })
                      }
                      className={SELECT_CLASS}
                    >
                      <option value="extend">Extend notes through sustain</option>
                      <option value="ignore">Ignore sustain pedal</option>
                    </select>
                  </label>

                  <label className={CHECKBOX_LABEL_CLASS}>
                    <input
                      type="checkbox"
                      aria-label="Piano staff split"
                      checked={options.pianoStaffSplit}
                      onChange={(e) => patchOptions({ pianoStaffSplit: e.target.checked })}
                      className="h-4 w-4 rounded border-theme-border"
                    />
                    Piano staff split
                  </label>

                  {options.pianoStaffSplit && (
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-theme-text-secondary">Split point (MIDI note)</span>
                      <input
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

                  <label className={CHECKBOX_LABEL_CLASS}>
                    <input
                      type="checkbox"
                      aria-label="Detect key"
                      checked={options.detectKey}
                      onChange={(e) => patchOptions({ detectKey: e.target.checked })}
                      className="h-4 w-4 rounded border-theme-border"
                    />
                    Detect key
                  </label>
                </div>

                <button
                  type="button"
                  aria-label="Preview import"
                  disabled={busy}
                  onClick={() => void handlePreview()}
                  className={`self-start ${SECONDARY_BUTTON_CLASS}`}
                >
                  Preview
                </button>

                {preview && (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-theme-text-primary">{preview.noteCount} notes after import.</p>
                    <p className="font-mono text-sm text-theme-text-secondary">{preview.text}</p>
                    {preview.warnings.map((w) => (
                      <div key={w} role="status" className="rounded-md bg-amber-600/10 px-3 py-2 text-sm text-amber-700">
                        {w}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button type="button" onClick={handleClose} className={TEXT_BUTTON_CLASS}>
              Cancel
            </button>
            <button
              type="button"
              aria-label="Import"
              disabled={!summary || !options || busy}
              onClick={handleImportClick}
              className={PRIMARY_BUTTON_CLASS}
            >
              Import
            </button>
          </div>
        </div>
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
