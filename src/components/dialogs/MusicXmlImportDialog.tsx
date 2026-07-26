/**
 * MusicXML import dialog (spec §17): file pick + an import summary
 * including the ignored-elements report (`MusicXmlImportResult.warnings`
 * -- unsupported-but-valid elements are always skipped safely and
 * reported, per spec §17, never silently dropped or blocking import).
 * Import lands as one undoable command, via the same new-project-or-
 * confirmed-replace flow `MidiImportWizard` uses.
 *
 * Adopts the library `Button` (library sweep 2) for Cancel/Import. The
 * "Choose MusicXML file" label + hidden file input stay exactly as-is
 * (same reasoning as `MidiImportWizard`'s file picker): a native `<label>`
 * wrapping a hidden `<input type="file">` is how the browser's own file
 * picker gets triggered by a click, and `Button` renders a `<button>`, not
 * a `<label>`, so it can't reproduce that association without extra
 * plumbing for no behavioral benefit.
 */
import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { Button, Dialog, cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
import { importScoreCommand } from '@sudobility/music_lib';
import { allNotes } from '@sudobility/music_lib';
import { reportError } from '@sudobility/music_lib';
import { MusicXmlService } from '@sudobility/music_lib';
import type { MusicXmlImportResult } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';

export type MusicXmlImportDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /** Defaults to a fresh `MusicXmlService`; tests inject a fake. */
  musicXmlService?: Pick<MusicXmlService, 'import'>;
  /** Called after a successful import that created a brand-new project (no project was open), with the new project's id. */
  onImportedNewProject?: (projectId: string) => void;
  /** Always takes the "create a new project" path, even if `store` still has a `projectId` set from a previously-open project (see `MidiImportWizard`'s identical prop for why). Defaults to `false`. */
  forceNewProject?: boolean;
};

export function MusicXmlImportDialog({
  open,
  onClose,
  store = useAppStore,
  musicXmlService,
  onImportedNewProject,
  forceNewProject = false,
}: MusicXmlImportDialogProps) {
  const service = musicXmlService ?? new MusicXmlService();

  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<MusicXmlImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState(false);

  const reset = (): void => {
    setFileName(null);
    setResult(null);
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
      const text = await file.text();
      const imported = await service.import(text);
      setFileName(file.name);
      setResult(imported);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  };

  const commitImport = (): void => {
    if (!result) return;
    const hasProject = !forceNewProject && store.getState().projectId !== null;
    if (hasProject) {
      store.getState().dispatchCommand(importScoreCommand(result.score));
      handleClose();
      return;
    }
    void store
      .getState()
      .newProject({ name: fileName ?? result.score.metadata.title, score: result.score })
      .then(() => {
        const projectId = store.getState().projectId;
        handleClose();
        if (projectId) onImportedNewProject?.(projectId);
      })
      .catch((err: unknown) => reportError(err, { context: 'MusicXML import failed', store }));
  };

  const handleImportClick = (): void => {
    if (!forceNewProject && store.getState().projectId !== null) setConfirmingReplace(true);
    else commitImport();
  };

  return (
    <>
      <Dialog isOpen={open} onClose={handleClose} size="sm" showCloseButton={false}>
        <div role="dialog" aria-labelledby="musicxml-import-title" className="p-6">
          <h2 id="musicxml-import-title" className="text-lg font-semibold text-theme-text-primary">
            Import MusicXML
          </h2>

          <div className="mt-4 flex flex-col gap-3">
            <label
              role="button"
              tabIndex={0}
              aria-label="Choose MusicXML file"
              className={cn(
                variants.button.outline.default(),
                'cursor-pointer px-3 py-2 text-center',
              )}
            >
              {fileName ?? 'Choose MusicXML file...'}
              <input
                type="file"
                accept=".musicxml,.xml,application/vnd.recordare.musicxml+xml"
                className="sr-only"
                aria-label="MusicXML file input"
                onChange={(e) => void handleFileChange(e)}
              />
            </label>

            {error && (
              <div role="alert" className="rounded-md bg-red-600/10 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            {result && (
              <>
                <p className="text-sm font-medium text-theme-text-primary">
                  {result.score.tracks.length} track(s), {allNotes(result.score).length} notes
                </p>

                {result.warnings.length > 0 ? (
                  <>
                    <p className="text-sm text-theme-text-secondary">
                      Unsupported elements were skipped and are reported below (import still
                      proceeds safely):
                    </p>
                    <ul aria-label="Import warnings" className="flex flex-col gap-1">
                      {result.warnings.map((warning) => (
                        <li
                          key={warning}
                          className="rounded-md bg-theme-bg-secondary px-3 py-1.5 text-sm text-theme-text-primary"
                        >
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div
                    role="status"
                    className="rounded-md bg-green-600/10 px-3 py-2 text-sm text-green-700"
                  >
                    No unsupported elements were found.
                  </div>
                )}
              </>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              aria-label="Import"
              disabled={!result || busy}
              onClick={handleImportClick}
            >
              Import
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmingReplace}
        title="Replace current score"
        message="Importing this MusicXML file will replace the current project's score. This can be undone with Undo."
        confirmLabel="Replace"
        onCancel={() => setConfirmingReplace(false)}
        onConfirm={() => {
          setConfirmingReplace(false);
          commitImport();
        }}
      />
    </>
  );
}
