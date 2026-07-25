/**
 * MusicXML import dialog (spec §17): file pick + an import summary
 * including the ignored-elements report (`MusicXmlImportResult.warnings`
 * -- unsupported-but-valid elements are always skipped safely and
 * reported, per spec §17, never silently dropped or blocking import).
 * Import lands as one undoable command, via the same new-project-or-
 * confirmed-replace flow `MidiImportWizard` uses.
 */
import { useState } from 'react';
import type { ChangeEvent } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
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
      <Dialog open={open} onClose={handleClose} aria-labelledby="musicxml-import-title" maxWidth="sm" fullWidth>
        <DialogTitle id="musicxml-import-title">Import MusicXML</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Button component="label" variant="outlined" aria-label="Choose MusicXML file">
              {fileName ?? 'Choose MusicXML file...'}
              <input
                type="file"
                accept=".musicxml,.xml,application/vnd.recordare.musicxml+xml"
                hidden
                aria-label="MusicXML file input"
                onChange={(e) => void handleFileChange(e)}
              />
            </Button>

            {error && <Alert severity="error">{error}</Alert>}

            {result && (
              <>
                <Typography variant="subtitle2">
                  {result.score.tracks.length} track(s), {allNotes(result.score).length} notes
                </Typography>

                {result.warnings.length > 0 ? (
                  <>
                    <Typography variant="body2" color="text.secondary">
                      Unsupported elements were skipped and are reported below (import still proceeds safely):
                    </Typography>
                    <List dense aria-label="Import warnings">
                      {result.warnings.map((warning) => (
                        <ListItem key={warning}>
                          <ListItemText primary={warning} />
                        </ListItem>
                      ))}
                    </List>
                  </>
                ) : (
                  <Alert severity="success">No unsupported elements were found.</Alert>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button variant="contained" aria-label="Import" disabled={!result || busy} onClick={handleImportClick}>
            Import
          </Button>
        </DialogActions>
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
