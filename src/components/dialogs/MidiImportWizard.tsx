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
import { getAppServices } from '@/config/initialize';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import type { MidiSummary } from '@/app-library';
import { canImportMidi, defaultMidiImportOptions, patchMidiImportOptions } from '@/app-library';
import type { MidiImportOptions, MidiImportPatch } from '@/app-library';
import {
  CLEF_OPTIONS,
  MIDI_GRID_OPTIONS,
  NO_MARK,
  parseNumericDraft,
  type Clef,
  type DurationName,
  type NoteEvent,
} from '@sudobility/music_types';
import { allNotes, importScore } from '@/app-library';
import { reportError } from '@/app-library';
import type { MidiImportResult } from '@/app-library';
import { useAppStore } from '@/app-library';
import type { EditorStoreApi } from '@/app-library';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { FileImportModal } from '@/components/dialogs/FileImportModal';

/** The parse half of the wizard, injectable so tests can force a failure. */
export type MidiImportApi = {
  analyze(buffer: ArrayBuffer): Promise<MidiSummary>;
  import(buffer: ArrayBuffer, options: MidiImportOptions): Promise<MidiImportResult>;
};

export type MidiImportWizardProps = {
  open: boolean;
  onClose: () => void;
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /**
   * Defaults to the real parser. Tests inject a fake to drive the failure
   * branches without crafting corrupt MIDI bytes.
   *
   * This used to be a `MidiService`, whose job was to run the same two
   * functions on a worker thread. That worker was removed — parsing is a
   * one-shot action behind this modal, where the main thread is doing nothing
   * else — so the seam is now just the two functions, still promise-returning
   * because `handleFile` awaits the file read either way.
   */
  midiService?: MidiImportApi;
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

/** A short, human-readable preview of the first few notes (by start tick), e.g. "C4, E4, G4, C5, ...". */
function firstNotesPreview(notes: NoteEvent[], noNotes: string, limit = 12): string {
  const sorted = [...notes].sort((a, b) => a.startTick - b.startTick);
  const labels = sorted.slice(0, limit).map((n) => `${n.pitch.step}${n.pitch.octave}`);
  if (labels.length === 0) return noNotes;
  return labels.join(', ') + (sorted.length > limit ? ', ...' : '');
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

const SELECT_TRIGGER_CLASS = 'h-auto w-auto min-w-[8rem] px-2 py-1 text-sm';

const TEXT_INPUT_CLASS = 'w-auto px-2 py-1 text-sm';

/**
 * A number field that holds what was typed until it is left.
 *
 * The options store a number, and what the field may commit is
 * `patchMidiImportOptions`'s rule — but a field bound straight to that number
 * cannot be emptied: clearing the split point to type a new one would snap
 * straight back to the old value and append to it. So the text is a draft,
 * each keystroke commits what `parseNumericDraft` makes of it (`null` while
 * empty), and leaving the field shows what was actually stored.
 */
function NumberDraftInput({
  value,
  onCommit,
  ...input
}: {
  value: number;
  onCommit: (value: number | null) => void;
  min?: number;
  max?: number;
  'aria-label': string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      type="number"
      {...input}
      value={draft ?? String(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        onCommit(parseNumericDraft(e.target.value));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export function MidiImportWizard({
  open,
  onClose,
  store = useAppStore,
  midiService,
  onImportedNewProject,
  forceNewProject = false,
}: MidiImportWizardProps) {
  const { t } = useTranslation();
  const service = useMemo<MidiImportApi>(
    () =>
      midiService ?? {
        analyze: async (buffer) => getAppServices().io.analyzeMidi(buffer),
        import: async (buffer, options) => getAppServices().io.openMidi(buffer, options),
      },
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
      const notes = allNotes(result.score);
      setPreview({
        noteCount: notes.length,
        text: firstNotesPreview(notes, t('importMidi.previewNone')),
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
        importScore(store, result.score);
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
      reportError(err, { context: t('errors.midiImport'), store });
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

  /*
    Every change goes through `patchMidiImportOptions`, which owns the field
    rules — the split point clamped to MIDI 0-127 with 0 kept as a note, the
    minimum duration floored at 0 — shared with the native sheet.
  */
  const patchOptions = (patch: MidiImportPatch): void => {
    setOptions((prev) => (prev ? patchMidiImportOptions(prev, patch) : prev));
  };

  const patchTrackSelection = (
    sourceIndex: number,
    patch: Partial<{ include: boolean; clef: Clef }>,
  ): void => patchOptions({ track: { sourceIndex, ...patch } });

  return (
    <>
      <FileImportModal
        open={open}
        title={t('dashboard.importMidi')}
        accept=".mid,.midi,audio/midi"
        fileKind={t('importMidi.fileKind')}
        fileName={fileName}
        onFile={(file) => void handleFile(file)}
        busy={busy}
        busyLabel={t('import.readingFile')}
        error={error}
        canImport={Boolean(summary) && canImportMidi(options)}
        onImport={handleImportClick}
        onClose={handleClose}
        size="large"
        description={t('importMidi.description')}
      >
        {summary && options && (
          <>
            <div
              role="status"
              className="rounded-md bg-amber-600/10 px-3 py-2 text-sm text-amber-700"
            >
              {t('importMidi.performanceTiming')}
            </div>

            <p className="text-sm font-medium text-theme-text-primary">
              {t('importMidi.summaryLine', {
                count: summary.tracks.length,
                seconds: summary.durationSeconds.toFixed(1),
                ppq: summary.ppq,
              })}
            </p>

            <div className="overflow-x-auto rounded-md border border-theme-border">
              <table aria-label={t('importMidi.trackSummary')} className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-theme-border text-theme-text-secondary">
                    <th className="px-2 py-1.5 font-medium">{t('importMidi.colInclude')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('importMidi.colTrack')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('importMidi.colChannel')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('importMidi.colProgram')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('importMidi.colNotes')}</th>
                    <th className="px-2 py-1.5 font-medium">{t('importMidi.colClef')}</th>
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
                            label={t('importMidi.includeTrack', { name: track.name })}
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
                              aria-label={t('importMidi.clefOfTrack', { name: track.name })}
                              className={SELECT_TRIGGER_CLASS}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CLEF_OPTIONS.map((clef) => (
                                <SelectItem key={clef.value} value={clef.value}>
                                  {t(clef.labelKey)}
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
                <span className="text-xs text-theme-text-secondary">
                  {t('importMidi.quantizeGrid')}
                </span>
                <Select
                  value={options.quantizeGrid ?? NO_MARK}
                  onValueChange={(v) =>
                    patchOptions({ quantizeGrid: v === NO_MARK ? null : (v as DurationName) })
                  }
                >
                  <SelectTrigger
                    aria-label={t('importMidi.quantizeGrid')}
                    className={SELECT_TRIGGER_CLASS}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MIDI_GRID_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {t(opt.labelKey)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <Checkbox
                label={t('importMidi.tripletDetection')}
                checked={options.tripletDetection}
                onChange={(checked) => patchOptions({ tripletDetection: checked })}
              />

              <label className="flex flex-col gap-1">
                <span className="text-xs text-theme-text-secondary">
                  {t('importMidi.minDurationShort')}
                </span>
                <NumberDraftInput
                  min={0}
                  aria-label={t('importMidi.minDuration')}
                  value={options.minDurationTicks}
                  onCommit={(minDurationTicks) => patchOptions({ minDurationTicks })}
                  className={TEXT_INPUT_CLASS}
                />
              </label>

              <Checkbox
                label={t('importMidi.mergeDuplicates')}
                checked={options.mergeNearDuplicates}
                onChange={(checked) => patchOptions({ mergeNearDuplicates: checked })}
              />

              <label className="flex flex-col gap-1">
                <span className="text-xs text-theme-text-secondary">{t('importMidi.sustain')}</span>
                <Select
                  value={options.sustainPedal}
                  onValueChange={(v) => patchOptions({ sustainPedal: v as 'extend' | 'ignore' })}
                >
                  <SelectTrigger
                    aria-label={t('importMidi.sustain')}
                    className={SELECT_TRIGGER_CLASS}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="extend">{t('importMidi.sustainExtend')}</SelectItem>
                    <SelectItem value="ignore">{t('importMidi.sustainIgnore')}</SelectItem>
                  </SelectContent>
                </Select>
              </label>

              <Checkbox
                label={t('importMidi.pianoSplit')}
                checked={options.pianoStaffSplit}
                onChange={(checked) => patchOptions({ pianoStaffSplit: checked })}
              />

              {options.pianoStaffSplit && (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-theme-text-secondary">
                    {t('importMidi.splitPoint')}
                  </span>
                  <NumberDraftInput
                    min={0}
                    max={127}
                    aria-label={t('importMidi.splitPointLabel')}
                    value={options.splitPointMidi}
                    onCommit={(splitPointMidi) => patchOptions({ splitPointMidi })}
                    className={TEXT_INPUT_CLASS}
                  />
                </label>
              )}

              <Checkbox
                label={t('importMidi.detectKey')}
                checked={options.detectKey}
                onChange={(checked) => patchOptions({ detectKey: checked })}
              />
            </div>

            <Button
              type="button"
              variant="outline"
              aria-label={t('importMidi.previewImport')}
              disabled={busy}
              onClick={() => void handlePreview()}
              className="self-start px-3 py-1.5"
            >
              {t('importMidi.preview')}
            </Button>

            {preview && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-theme-text-primary">
                  {t('importMidi.previewCount', { count: preview.noteCount })}
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
        title={t('importXml.replaceTitle')}
        message={t('importMidi.replaceMessage')}
        confirmLabel={t('importXml.replace')}
        onCancel={() => setConfirmingReplace(false)}
        onConfirm={() => {
          setConfirmingReplace(false);
          void commitImport();
        }}
      />
    </>
  );
}
