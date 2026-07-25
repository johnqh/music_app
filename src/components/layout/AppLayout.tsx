/**
 * The app shell (spec §6): app bar (editable project title, save-state
 * chip, save/undo/redo, import/export menus, theme toggle, shortcut-help
 * and settings icons), a three-pane layout (track panel | main editor |
 * inspector + generation panel) with collapsible side panels, the
 * playback transport, a status bar (selection summary, validation issue
 * count with a click-to-navigate popover, position, zoom), toasts, and
 * every dialog this task owns.
 *
 * Rendered by `router.tsx` for the `/project/:id` route, once a project
 * is already open (it does not itself load one) -- see `App.tsx`/
 * `router.tsx` for how a project id gets opened before this mounts.
 */
import { useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';
import AppBar from '@mui/material/AppBar';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { exportMidi, safeFilename as midiSafeFilename } from '@sudobility/music_lib';
import { exportMusicXml, safeFilename as musicXmlSafeFilename } from '@sudobility/music_lib';
import { findEvent, findMeasure, findTrack } from '@sudobility/music_lib';
import { selectionSummaryLabel } from '@sudobility/music_lib';
import type { ValidationIssue } from '@sudobility/music_lib';
import { db as appDb } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import type { ScoreSmithDb } from '@sudobility/music_lib';
import { exportProjectJson, importProjectJson } from '@sudobility/music_lib';
import { downloadBlob } from '@sudobility/music_lib';
import { reportError } from '@sudobility/music_lib';
import { selectCurrentMeasureBeat } from '@sudobility/music_lib';
import { ScoreEditorView } from '@/features/score-editor/ScoreEditorView';
import { PianoRollView } from '@/features/piano-roll/PianoRollView';
import { GenerationPanel } from '@/features/generation/GenerationPanel';
import { RegenerationPanel } from '@/features/generation/RegenerationPanel';
import { TransportBar } from '@/components/transport/TransportBar';
import { TrackPanel } from '@/components/layout/TrackPanel';
import { Toasts } from '@/components/layout/Toasts';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { MidiImportWizard } from '@/components/dialogs/MidiImportWizard';
import { MusicXmlImportDialog } from '@/components/dialogs/MusicXmlImportDialog';
import { ShortcutHelpDialog } from '@/components/dialogs/ShortcutHelpDialog';
import { DeveloperSettingsDialog } from '@/components/dialogs/DeveloperSettingsDialog';

export type AppLayoutProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /** Defaults to the app-wide singleton's own db; tests inject the same `fake-indexeddb`-backed db the test's store was built with. */
  db?: ScoreSmithDb;
  /** Called after "Back to dashboard" is clicked, and after importing Project JSON opens a different project. Defaults to a no-op (tests/host apps that don't need navigation can omit it); `router.tsx` wires this to `useNavigate()`. */
  onNavigate?: (path: string) => void;
};

const SIDE_PANEL_WIDTH = 280;

const SAVE_STATE_LABEL: Record<string, string> = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved' };
const SAVE_STATE_COLOR: Record<string, 'success' | 'info' | 'warning'> = {
  saved: 'success',
  saving: 'info',
  unsaved: 'warning',
};

export function AppLayout({ store = useAppStore, db = appDb, onNavigate }: AppLayoutProps) {
  const projectName = store((s) => s.projectName);
  const saveState = store((s) => s.saveState);
  const canUndo = store((s) => s.canUndo);
  const canRedo = store((s) => s.canRedo);
  const undoLabel = store((s) => s.undoLabel);
  const redoLabel = store((s) => s.redoLabel);
  const view = store((s) => s.view);
  const zoom = store((s) => s.zoom);
  const themeMode = store((s) => s.themeMode);
  const developerMode = store((s) => s.developerMode);
  const dialogs = store((s) => s.dialogs);
  const selection = store((s) => s.selection);
  const score = store((s) => s.score);
  const validationIssues = store((s) => s.validationIssues);
  const generationMode = store((s) => s.mode);
  const measureBeat = store(selectCurrentMeasureBeat);

  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [importMenuAnchor, setImportMenuAnchor] = useState<HTMLElement | null>(null);
  const [exportMenuAnchor, setExportMenuAnchor] = useState<HTMLElement | null>(null);
  const [themeMenuAnchor, setThemeMenuAnchor] = useState<HTMLElement | null>(null);
  const [settingsMenuAnchor, setSettingsMenuAnchor] = useState<HTMLElement | null>(null);
  const [issuesAnchor, setIssuesAnchor] = useState<HTMLElement | null>(null);
  const [confirmingImportJson, setConfirmingImportJson] = useState<Record<string, unknown> | null>(null);
  const [trackPanelOpen, setTrackPanelOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const errorIssues = validationIssues.filter((i) => i.severity === 'error');

  const commitTitle = (): void => {
    if (titleDraft !== null && titleDraft.trim() !== '' && titleDraft !== projectName) {
      store.getState().renameProject(titleDraft.trim());
    }
    setTitleDraft(null);
  };

  const handleImportJsonFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text) as Record<string, unknown>;
      setConfirmingImportJson(json);
    } catch (err) {
      reportError(err, { context: 'Project JSON import failed', store });
    }
  };

  const commitImportJson = async (): Promise<void> => {
    const json = confirmingImportJson;
    setConfirmingImportJson(null);
    if (!json) return;
    try {
      const record = await importProjectJson(db, json);
      await store.getState().openProject(record.id);
      onNavigate?.(`/project/${record.id}`);
    } catch (err) {
      reportError(err, { context: 'Project JSON import failed', store });
    }
  };

  const handleExportMidi = (): void => {
    if (!score) return;
    try {
      const bytes = exportMidi(score);
      downloadBlob(`${midiSafeFilename(score.metadata.title)}.mid`, new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/midi' }));
    } catch (err) {
      reportError(err, { context: 'MIDI export failed', store });
    }
    setExportMenuAnchor(null);
  };

  const handleExportMusicXml = (): void => {
    if (!score) return;
    try {
      const xml = exportMusicXml(score);
      downloadBlob(`${musicXmlSafeFilename(score.metadata.title)}.musicxml`, new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }));
    } catch (err) {
      reportError(err, { context: 'MusicXML export failed', store });
    }
    setExportMenuAnchor(null);
  };

  const handleExportProjectJson = async (): Promise<void> => {
    const projectId = store.getState().projectId;
    if (!projectId) return;
    try {
      const blob = await exportProjectJson(db, projectId);
      downloadBlob(`${projectName || 'project'}.json`, blob);
    } catch (err) {
      reportError(err, { context: 'Project JSON export failed', store });
    }
    setExportMenuAnchor(null);
  };

  const navigateToIssue = (issue: ValidationIssue): void => {
    if (!score) return;
    if (issue.objectId && findEvent(score, issue.objectId)) {
      store.getState().setSelection({ eventIds: [issue.objectId], measureIds: [], trackIds: [] });
    } else if (issue.measureId && findMeasure(score, issue.measureId)) {
      store.getState().selectMeasures([issue.measureId]);
    } else if (issue.trackId && findTrack(score, issue.trackId)) {
      store.getState().selectTrack(issue.trackId);
    }
    setIssuesAnchor(null);

    // Best-effort scroll to the now-selected object's rendered element;
    // jsdom (tests) has no `scrollIntoView`, so this is guarded and never
    // required for the navigation itself (the selection change is what
    // matters -- `ScoreEditorView` also repaints the selection highlight
    // off the same store update).
    const targetId = issue.objectId ?? issue.measureId ?? issue.trackId;
    if (targetId) {
      const el = document.getElementById(`vf-${targetId}`);
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <AppBar position="static" color="primary" enableColorOnDark>
        <Toolbar sx={{ gap: 1 }}>
          <IconButton aria-label="Back to dashboard" color="inherit" onClick={() => onNavigate?.('/')}>
            ←
          </IconButton>

          {titleDraft !== null ? (
            <TextField
              size="small"
              value={titleDraft}
              autoFocus
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle();
                else if (e.key === 'Escape') setTitleDraft(null);
              }}
              slotProps={{ htmlInput: { 'aria-label': 'Project title' } }}
              sx={{ input: { color: 'inherit' } }}
              variant="standard"
            />
          ) : (
            <Typography
              variant="h6"
              component="button"
              onClick={() => setTitleDraft(projectName)}
              aria-label="Edit project title"
              sx={{ background: 'none', border: 'none', color: 'inherit', font: 'inherit', cursor: 'pointer' }}
            >
              {projectName || 'Untitled project'}
            </Typography>
          )}

          <Chip size="small" label={SAVE_STATE_LABEL[saveState]} color={SAVE_STATE_COLOR[saveState]} aria-label={`Save state: ${SAVE_STATE_LABEL[saveState]}`} />

          <Tooltip title="Save now">
            <IconButton aria-label="Save" color="inherit" onClick={() => void store.getState().saveNow()}>
              💾
            </IconButton>
          </Tooltip>
          <Tooltip title={canUndo ? `Undo: ${undoLabel}` : 'Nothing to undo'}>
            <span>
              <IconButton aria-label="Undo" color="inherit" disabled={!canUndo} onClick={() => store.getState().undo()}>
                ↶
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={canRedo ? `Redo: ${redoLabel}` : 'Nothing to redo'}>
            <span>
              <IconButton aria-label="Redo" color="inherit" disabled={!canRedo} onClick={() => store.getState().redo()}>
                ↷
              </IconButton>
            </span>
          </Tooltip>

          <Button color="inherit" aria-label="Import menu" onClick={(e: MouseEvent<HTMLElement>) => setImportMenuAnchor(e.currentTarget)}>
            Import
          </Button>
          <Menu anchorEl={importMenuAnchor} open={importMenuAnchor !== null} onClose={() => setImportMenuAnchor(null)}>
            <MenuItem
              onClick={() => {
                setImportMenuAnchor(null);
                store.getState().openDialog('midiImport');
              }}
            >
              MIDI…
            </MenuItem>
            <MenuItem
              onClick={() => {
                setImportMenuAnchor(null);
                store.getState().openDialog('musicXmlImport');
              }}
            >
              MusicXML…
            </MenuItem>
            <MenuItem component="label">
              Project JSON…
              <input type="file" accept="application/json" hidden aria-label="Project JSON file input" onChange={(e) => void handleImportJsonFile(e)} />
            </MenuItem>
          </Menu>

          <Button color="inherit" aria-label="Export menu" onClick={(e: MouseEvent<HTMLElement>) => setExportMenuAnchor(e.currentTarget)}>
            Export
          </Button>
          <Menu anchorEl={exportMenuAnchor} open={exportMenuAnchor !== null} onClose={() => setExportMenuAnchor(null)}>
            <MenuItem onClick={handleExportMidi} disabled={!score}>
              MIDI
            </MenuItem>
            <MenuItem onClick={handleExportMusicXml} disabled={!score}>
              MusicXML
            </MenuItem>
            <MenuItem onClick={() => void handleExportProjectJson()}>Project JSON</MenuItem>
          </Menu>

          <Box sx={{ flex: 1 }} />

          <Tooltip title="Theme">
            <IconButton aria-label="Theme menu" color="inherit" onClick={(e: MouseEvent<HTMLElement>) => setThemeMenuAnchor(e.currentTarget)}>
              🌓
            </IconButton>
          </Tooltip>
          <Menu anchorEl={themeMenuAnchor} open={themeMenuAnchor !== null} onClose={() => setThemeMenuAnchor(null)}>
            {(['light', 'dark', 'system'] as const).map((mode) => (
              <MenuItem
                key={mode}
                selected={themeMode === mode}
                onClick={() => {
                  store.getState().setThemeMode(mode);
                  setThemeMenuAnchor(null);
                }}
              >
                {mode[0].toUpperCase() + mode.slice(1)}
              </MenuItem>
            ))}
          </Menu>

          <Tooltip title="Keyboard shortcuts">
            <IconButton aria-label="Keyboard shortcuts" color="inherit" onClick={() => store.getState().openDialog('shortcutHelp')}>
              ?
            </IconButton>
          </Tooltip>

          <Tooltip title="Settings">
            <IconButton aria-label="Settings menu" color="inherit" onClick={(e: MouseEvent<HTMLElement>) => setSettingsMenuAnchor(e.currentTarget)}>
              ⚙
            </IconButton>
          </Tooltip>
          <Menu anchorEl={settingsMenuAnchor} open={settingsMenuAnchor !== null} onClose={() => setSettingsMenuAnchor(null)}>
            <MenuItem
              onClick={() => store.getState().setDeveloperMode(!developerMode)}
              sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}
            >
              Developer mode
              <Switch size="small" checked={developerMode} slotProps={{ input: { 'aria-label': 'Developer mode' } }} />
            </MenuItem>
            <MenuItem
              disabled={!developerMode}
              onClick={() => {
                setSettingsMenuAnchor(null);
                store.getState().openDialog('devSettings');
              }}
            >
              Developer settings…
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {trackPanelOpen && (
          <Box sx={{ width: SIDE_PANEL_WIDTH, flexShrink: 0, borderRight: 1, borderColor: 'divider' }}>
            <TrackPanel store={store} />
          </Box>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <Stack direction="row" sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tooltip title={trackPanelOpen ? 'Hide track panel' : 'Show track panel'}>
              <IconButton size="small" aria-label="Toggle track panel" onClick={() => setTrackPanelOpen((v) => !v)}>
                {trackPanelOpen ? '⟨' : '⟩'}
              </IconButton>
            </Tooltip>
            <Box sx={{ flex: 1 }} />
            <Tooltip title={inspectorOpen ? 'Hide inspector' : 'Show inspector'}>
              <IconButton size="small" aria-label="Toggle inspector panel" onClick={() => setInspectorOpen((v) => !v)}>
                {inspectorOpen ? '⟩' : '⟨'}
              </IconButton>
            </Tooltip>
          </Stack>

          <Box sx={{ flex: 1, minHeight: 0 }}>
            {view === 'notation' ? <ScoreEditorView store={store} /> : <PianoRollView store={store} />}
          </Box>

          <TransportBar store={store} />
        </Box>

        {inspectorOpen && (
          <Box sx={{ width: SIDE_PANEL_WIDTH, flexShrink: 0, borderLeft: 1, borderColor: 'divider', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            <InspectorPanel store={store} />
            <Divider />
            {generationMode === 'generate' ? <GenerationPanel store={store} /> : <RegenerationPanel store={store} />}
          </Box>
        )}
      </Box>

      <Stack
        direction="row"
        spacing={2}
        role="status"
        aria-label="Status bar"
        sx={{ px: 2, py: 0.5, borderTop: 1, borderColor: 'divider', alignItems: 'center' }}
      >
        <Typography variant="caption">{selectionSummaryLabel(selection)}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          aria-label="Validation issues"
          onClick={(e: MouseEvent<HTMLElement>) => setIssuesAnchor(e.currentTarget)}
          disabled={validationIssues.length === 0}
        >
          <Badge badgeContent={validationIssues.length} color={errorIssues.length > 0 ? 'error' : 'warning'} showZero>
            Issues
          </Badge>
        </Button>
        <Popover
          open={issuesAnchor !== null}
          anchorEl={issuesAnchor}
          onClose={() => setIssuesAnchor(null)}
          anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          <Box sx={{ p: 1, minWidth: 280, maxHeight: 320, overflow: 'auto' }} role="list" aria-label="Validation issues list">
            {validationIssues.length === 0 && <Typography variant="body2">No issues.</Typography>}
            {validationIssues.map((issue, i) => (
              <Box
                key={`${issue.code}-${issue.objectId ?? issue.measureId ?? issue.trackId ?? i}`}
                role="listitem"
                tabIndex={0}
                onClick={() => navigateToIssue(issue)}
                onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigateToIssue(issue);
                  }
                }}
                sx={{
                  p: 0.5,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.hover' },
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
                }}
              >
                <Chip size="small" label={issue.severity} color={issue.severity === 'error' ? 'error' : 'warning'} sx={{ mr: 1 }} />
                <Typography variant="body2" component="span">
                  {issue.message}
                </Typography>
              </Box>
            ))}
          </Box>
        </Popover>
        <Typography variant="caption" aria-label="Position">
          {measureBeat ? `Measure ${measureBeat.measureIndex}, beat ${measureBeat.beat}` : '-.-'}
        </Typography>
        <Typography variant="caption" aria-label="Zoom level">
          {Math.round(zoom * 100)}%
        </Typography>
      </Stack>

      <Toasts store={store} />

      <MidiImportWizard
        open={dialogs.midiImport === true}
        onClose={() => store.getState().closeDialog('midiImport')}
        store={store}
      />
      <MusicXmlImportDialog
        open={dialogs.musicXmlImport === true}
        onClose={() => store.getState().closeDialog('musicXmlImport')}
        store={store}
      />
      <ShortcutHelpDialog open={dialogs.shortcutHelp === true} onClose={() => store.getState().closeDialog('shortcutHelp')} />
      {developerMode && (
        <DeveloperSettingsDialog
          open={dialogs.devSettings === true}
          onClose={() => store.getState().closeDialog('devSettings')}
          store={store}
          db={db}
        />
      )}

      <ConfirmDialog
        open={confirmingImportJson !== null}
        title="Open imported project"
        message="This opens the imported project JSON as a new project, leaving the current project untouched."
        confirmLabel="Open"
        destructive={false}
        onCancel={() => setConfirmingImportJson(null)}
        onConfirm={() => void commitImportJson()}
      />
    </Box>
  );
}
