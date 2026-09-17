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
import { libraryCopy } from '@/i18n/library-copy';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { InfoBox, Stack, Text } from '@sudobility/components';
import { FileImportModal } from '@/components/dialogs/FileImportModal';
import { importScore } from '@/app-library';
import { allNotes } from '@/app-library';
import { reportError } from '@/app-library';
import type { MusicXmlImportResult } from '@/app-library';
import { useAppStore } from '@/app-library';
import type { EditorStoreApi } from '@/app-library';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { getAppServices } from '@/config/initialize';

export type MusicXmlImportDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /**
   * Defaults to `io.openMusicXml`; tests inject a fake.
   *
   * The dialog no longer builds a service around `io.xmlParser` — music_io owns
   * that pairing now, so `xmlParser` has left the app's field of view.
   */
  musicXmlService?: { import(text: string): Promise<MusicXmlImportResult> };
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
  const { t } = useTranslation();
  const service = musicXmlService ?? {
    import: (text: string) =>
      getAppServices().io.openMusicXml(text, libraryCopy.musicXmlWarnings()),
  };

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

  const handleFile = async (file: File): Promise<void> => {
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
    }
  };

  const commitImport = (): void => {
    if (!result) return;
    const hasProject = !forceNewProject && store.getState().projectId !== null;
    if (hasProject) {
      importScore(store, result.score);
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
      .catch((err: unknown) => reportError(err, { context: t('errors.musicXmlImport'), store }));
  };

  const handleImportClick = (): void => {
    if (!forceNewProject && store.getState().projectId !== null) setConfirmingReplace(true);
    else commitImport();
  };

  return (
    <>
      <FileImportModal
        open={open}
        title={t('dashboard.importMusicXml')}
        accept=".musicxml,.xml,application/vnd.recordare.musicxml+xml"
        fileKind={t('importXml.fileKind')}
        fileName={fileName}
        onFile={(file) => void handleFile(file)}
        busy={busy}
        busyLabel={t('importXml.reading')}
        error={error}
        canImport={Boolean(result)}
        onImport={handleImportClick}
        onClose={handleClose}
        description={t('importXml.description')}
      >
        {result && (
          <>
            <Text size="sm" weight="medium">
              {t('importXml.summary', {
                tracks: result.score.tracks.length,
                notes: allNotes(result.score).length,
              })}
            </Text>

            {result.warnings.length > 0 ? (
              <>
                <Text as="p" size="sm" color="muted">
                  {t('importXml.skipped')}
                </Text>
                <Stack direction="vertical" spacing="xs" aria-label={t('importXml.warnings')}>
                  {result.warnings.map((warning) => (
                    <InfoBox key={warning} variant="warning" size="sm">
                      {warning}
                    </InfoBox>
                  ))}
                </Stack>
              </>
            ) : (
              // `InfoBox`, not a hand-mixed green: the status colours it used
              // were literal `green-600`/`green-700`, which ignore the theme
              // tokens entirely and stay the same in dark mode.
              <InfoBox variant="success" size="sm">
                {t('importXml.allSupported')}
              </InfoBox>
            )}
          </>
        )}
      </FileImportModal>

      <ConfirmDialog
        open={confirmingReplace}
        title={t('importXml.replaceTitle')}
        message={t('importXml.replaceMessage')}
        confirmLabel={t('importXml.replace')}
        onCancel={() => setConfirmingReplace(false)}
        onConfirm={() => {
          setConfirmingReplace(false);
          commitImport();
        }}
      />
    </>
  );
}
