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
 *
 * Re-skinned onto Tailwind + @sudobility/components (T12 batch 6): the MUI
 * AppBar/Toolbar becomes a plain Tailwind header bar, the MUI TextField
 * (title edit) becomes a native `<input>`, the save-state Chip becomes a
 * Tailwind pill span, every MUI Menu (Import/Export/Theme/Settings) becomes
 * a button + `role="menu"`/`role="menuitem"` popover (same pattern as
 * `EditorToolbar`'s articulation menu -- a ref + outside-pointerdown
 * listener per menu, factored into one local `useMenu` hook since this file
 * has four of them), the Developer-mode Switch becomes a native checkbox,
 * and the issues Popover becomes a positioned Tailwind panel -- same
 * roles/aria-labels/accessible names as before, so no test assertions
 * changed (see the module-level doc comments on those files for the
 * general MUI->Tailwind conventions this follows).
 */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { Tooltip } from '@sudobility/components';
import { exportMidi, safeFilename as midiSafeFilename } from '@sudobility/music_lib';
import { exportMusicXml, safeFilename as musicXmlSafeFilename } from '@sudobility/music_lib';
import { findEvent, findMeasure, findTrack } from '@sudobility/music_lib';
import { selectionSummaryLabel } from '@sudobility/music_lib';
import type { ValidationIssue } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { parseScore } from '@sudobility/music_types';
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
  /** Called after "Back to dashboard" is clicked, and after importing Project JSON opens a different project. Defaults to a no-op (tests/host apps that don't need navigation can omit it); `router.tsx` wires this to `useNavigate()`. */
  onNavigate?: (path: string) => void;
};

const SIDE_PANEL_WIDTH = 280;

const SAVE_STATE_LABEL: Record<string, string> = { saved: 'Saved', saving: 'Saving…', unsaved: 'Unsaved' };
const SAVE_STATE_CLASS: Record<string, string> = {
  saved: 'bg-success text-success-foreground',
  saving: 'bg-info text-info-foreground',
  unsaved: 'bg-warning text-warning-foreground',
};

const ICON_BUTTON_CLASS =
  'rounded-md p-1.5 text-sm leading-none text-inherit hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';

const TEXT_BUTTON_CLASS = 'rounded-md px-3 py-1.5 text-sm font-medium text-inherit hover:bg-white/10';

const MENU_CLASS =
  'absolute top-full z-10 mt-1 min-w-[160px] rounded-md border border-theme-border bg-theme-bg-secondary py-1 text-left shadow-lg';

const MENU_ITEM_CLASS =
  'block w-full whitespace-nowrap px-3 py-1.5 text-left text-sm text-theme-text-primary hover:bg-theme-hover-bg disabled:cursor-not-allowed disabled:opacity-40';

/** Open/close + outside-pointerdown-close state for one `role="menu"` popover, factored out since this file owns four of them (Import/Export/Theme/Settings) -- same behavior as `EditorToolbar`'s single articulation menu, just reusable. */
function useMenu<T extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return { open, setOpen, ref };
}

export function AppLayout({ store = useAppStore, onNavigate }: AppLayoutProps) {
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
  const importMenu = useMenu<HTMLDivElement>();
  const exportMenu = useMenu<HTMLDivElement>();
  const themeMenu = useMenu<HTMLDivElement>();
  const settingsMenu = useMenu<HTMLDivElement>();
  const issuesMenu = useMenu<HTMLDivElement>();
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
      const parsed = json as { name?: unknown; score?: unknown };
      const importedScore = parseScore(parsed.score);
      const name =
        typeof parsed.name === 'string' && parsed.name ? parsed.name : importedScore.metadata.title;
      await store.getState().newProject({ name, score: importedScore });
      const newId = store.getState().projectId;
      if (newId) onNavigate?.(`/project/${newId}`);
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
    exportMenu.setOpen(false);
  };

  const handleExportMusicXml = (): void => {
    if (!score) return;
    try {
      const xml = exportMusicXml(score);
      downloadBlob(`${musicXmlSafeFilename(score.metadata.title)}.musicxml`, new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }));
    } catch (err) {
      reportError(err, { context: 'MusicXML export failed', store });
    }
    exportMenu.setOpen(false);
  };

  const handleExportProjectJson = async (): Promise<void> => {
    const projectId = store.getState().projectId;
    if (!projectId) return;
    try {
      const state = store.getState();
      if (!state.score) return;
      const payload = JSON.stringify(
        { name: state.projectName, schemaVersion: 1, score: state.score },
        null,
        2
      );
      downloadBlob(`${projectName || 'project'}.json`, new Blob([payload], { type: 'application/json' }));
    } catch (err) {
      reportError(err, { context: 'Project JSON export failed', store });
    }
    exportMenu.setOpen(false);
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
    issuesMenu.setOpen(false);

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
    <div className="flex h-full min-h-0 flex-col">
      <header className="bg-primary text-primary-foreground">
        <div className="flex items-center gap-1 px-2 py-1.5">
          <button
            type="button"
            aria-label="Back to dashboard"
            onClick={() => onNavigate?.('/projects')}
            className={ICON_BUTTON_CLASS}
          >
            ←
          </button>

          {titleDraft !== null ? (
            <input
              value={titleDraft}
              autoFocus
              aria-label="Project title"
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle();
                else if (e.key === 'Escape') setTitleDraft(null);
              }}
              className="border-0 border-b border-current bg-transparent px-1 py-0.5 text-lg font-medium text-inherit outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setTitleDraft(projectName)}
              aria-label="Edit project title"
              className="rounded-md border-none bg-transparent px-1 py-0.5 text-lg font-medium text-inherit hover:bg-white/10"
            >
              {projectName || 'Untitled project'}
            </button>
          )}

          <span
            aria-label={`Save state: ${SAVE_STATE_LABEL[saveState]}`}
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${SAVE_STATE_CLASS[saveState]}`}
          >
            {SAVE_STATE_LABEL[saveState]}
          </span>

          <Tooltip content="Save now">
            <button
              type="button"
              aria-label="Save"
              onClick={() => void store.getState().saveNow()}
              className={ICON_BUTTON_CLASS}
            >
              💾
            </button>
          </Tooltip>
          <Tooltip content={canUndo ? `Undo: ${undoLabel}` : 'Nothing to undo'}>
            <button
              type="button"
              aria-label="Undo"
              disabled={!canUndo}
              onClick={() => store.getState().undo()}
              className={ICON_BUTTON_CLASS}
            >
              ↶
            </button>
          </Tooltip>
          <Tooltip content={canRedo ? `Redo: ${redoLabel}` : 'Nothing to redo'}>
            <button
              type="button"
              aria-label="Redo"
              disabled={!canRedo}
              onClick={() => store.getState().redo()}
              className={ICON_BUTTON_CLASS}
            >
              ↷
            </button>
          </Tooltip>

          <div ref={importMenu.ref} className="relative">
            <button
              type="button"
              aria-label="Import menu"
              aria-haspopup="menu"
              aria-expanded={importMenu.open}
              onClick={() => importMenu.setOpen((v) => !v)}
              className={TEXT_BUTTON_CLASS}
            >
              Import
            </button>
            {importMenu.open && (
              <div role="menu" className={`left-0 ${MENU_CLASS}`}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    importMenu.setOpen(false);
                    store.getState().openDialog('midiImport');
                  }}
                  className={MENU_ITEM_CLASS}
                >
                  MIDI…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    importMenu.setOpen(false);
                    store.getState().openDialog('musicXmlImport');
                  }}
                  className={MENU_ITEM_CLASS}
                >
                  MusicXML…
                </button>
                <label role="menuitem" className={`cursor-pointer ${MENU_ITEM_CLASS}`}>
                  Project JSON…
                  <input
                    type="file"
                    accept="application/json"
                    hidden
                    aria-label="Project JSON file input"
                    onChange={(e) => void handleImportJsonFile(e)}
                  />
                </label>
              </div>
            )}
          </div>

          <div ref={exportMenu.ref} className="relative">
            <button
              type="button"
              aria-label="Export menu"
              aria-haspopup="menu"
              aria-expanded={exportMenu.open}
              onClick={() => exportMenu.setOpen((v) => !v)}
              className={TEXT_BUTTON_CLASS}
            >
              Export
            </button>
            {exportMenu.open && (
              <div role="menu" className={`left-0 ${MENU_CLASS}`}>
                <button type="button" role="menuitem" onClick={handleExportMidi} disabled={!score} className={MENU_ITEM_CLASS}>
                  MIDI
                </button>
                <button type="button" role="menuitem" onClick={handleExportMusicXml} disabled={!score} className={MENU_ITEM_CLASS}>
                  MusicXML
                </button>
                <button type="button" role="menuitem" onClick={() => void handleExportProjectJson()} className={MENU_ITEM_CLASS}>
                  Project JSON
                </button>
              </div>
            )}
          </div>

          <div className="flex-1" />

          <div ref={themeMenu.ref} className="relative">
            <Tooltip content="Theme">
              <button
                type="button"
                aria-label="Theme menu"
                aria-haspopup="menu"
                aria-expanded={themeMenu.open}
                onClick={() => themeMenu.setOpen((v) => !v)}
                className={ICON_BUTTON_CLASS}
              >
                🌓
              </button>
            </Tooltip>
            {themeMenu.open && (
              <div role="menu" className={`right-0 ${MENU_CLASS}`}>
                {(['light', 'dark', 'system'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      store.getState().setThemeMode(mode);
                      themeMenu.setOpen(false);
                    }}
                    className={`${MENU_ITEM_CLASS} ${themeMode === mode ? 'bg-theme-hover-bg' : ''}`}
                  >
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Tooltip content="Keyboard shortcuts">
            <button
              type="button"
              aria-label="Keyboard shortcuts"
              onClick={() => store.getState().openDialog('shortcutHelp')}
              className={ICON_BUTTON_CLASS}
            >
              ?
            </button>
          </Tooltip>

          <div ref={settingsMenu.ref} className="relative">
            <Tooltip content="Settings">
              <button
                type="button"
                aria-label="Settings menu"
                aria-haspopup="menu"
                aria-expanded={settingsMenu.open}
                onClick={() => settingsMenu.setOpen((v) => !v)}
                className={ICON_BUTTON_CLASS}
              >
                ⚙
              </button>
            </Tooltip>
            {settingsMenu.open && (
              <div role="menu" className={`right-0 ${MENU_CLASS}`}>
                <div
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => store.getState().setDeveloperMode(!developerMode)}
                  onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      store.getState().setDeveloperMode(!developerMode);
                    }
                  }}
                  className={`${MENU_ITEM_CLASS} flex cursor-pointer items-center justify-between gap-4`}
                >
                  Developer mode
                  <input
                    type="checkbox"
                    checked={developerMode}
                    onChange={() => store.getState().setDeveloperMode(!developerMode)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Developer mode"
                    className="h-4 w-4"
                  />
                </div>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!developerMode}
                  onClick={() => {
                    settingsMenu.setOpen(false);
                    store.getState().openDialog('devSettings');
                  }}
                  className={MENU_ITEM_CLASS}
                >
                  Developer settings…
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {trackPanelOpen && (
          <div className="shrink-0 border-r border-theme-border" style={{ width: SIDE_PANEL_WIDTH }}>
            <TrackPanel store={store} />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex border-b border-theme-border">
            <Tooltip content={trackPanelOpen ? 'Hide track panel' : 'Show track panel'}>
              <button
                type="button"
                aria-label="Toggle track panel"
                onClick={() => setTrackPanelOpen((v) => !v)}
                className={ICON_BUTTON_CLASS}
              >
                {trackPanelOpen ? '⟨' : '⟩'}
              </button>
            </Tooltip>
            <div className="flex-1" />
            <Tooltip content={inspectorOpen ? 'Hide inspector' : 'Show inspector'}>
              <button
                type="button"
                aria-label="Toggle inspector panel"
                onClick={() => setInspectorOpen((v) => !v)}
                className={ICON_BUTTON_CLASS}
              >
                {inspectorOpen ? '⟩' : '⟨'}
              </button>
            </Tooltip>
          </div>

          <div className="min-h-0 flex-1">
            {view === 'notation' ? <ScoreEditorView store={store} /> : <PianoRollView store={store} />}
          </div>

          <TransportBar store={store} />
        </div>

        {inspectorOpen && (
          <div
            className="flex shrink-0 flex-col overflow-auto border-l border-theme-border"
            style={{ width: SIDE_PANEL_WIDTH }}
          >
            <InspectorPanel store={store} />
            <div className="border-t border-theme-border" />
            {generationMode === 'generate' ? <GenerationPanel store={store} /> : <RegenerationPanel store={store} />}
          </div>
        )}
      </div>

      <div
        role="status"
        aria-label="Status bar"
        className="flex items-center gap-4 border-t border-theme-border px-4 py-1"
      >
        <span className="text-xs text-theme-text-secondary">{selectionSummaryLabel(selection)}</span>
        <div className="flex-1" />
        <div ref={issuesMenu.ref} className="relative">
          <button
            type="button"
            aria-label="Validation issues"
            onClick={() => issuesMenu.setOpen((v) => !v)}
            disabled={validationIssues.length === 0}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-theme-text-primary hover:bg-theme-hover-bg disabled:cursor-not-allowed disabled:opacity-40"
          >
            Issues
            <span
              className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ${
                errorIssues.length > 0 ? 'bg-destructive' : 'bg-warning'
              }`}
            >
              {validationIssues.length}
            </span>
          </button>
          {issuesMenu.open && (
            <div className="absolute bottom-full right-0 z-10 mb-1 min-w-[280px] max-h-[320px] overflow-auto rounded-md border border-theme-border bg-theme-bg-secondary p-1 shadow-lg">
              <div role="list" aria-label="Validation issues list">
                {validationIssues.length === 0 && (
                  <p className="p-1 text-sm text-theme-text-secondary">No issues.</p>
                )}
                {validationIssues.map((issue, i) => (
                  <div
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
                    className="cursor-pointer rounded p-1 hover:bg-theme-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                  >
                    <span
                      className={`mr-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium text-white ${
                        issue.severity === 'error' ? 'bg-destructive' : 'bg-warning'
                      }`}
                    >
                      {issue.severity}
                    </span>
                    <span className="text-sm text-theme-text-primary">{issue.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <span aria-label="Position" className="text-xs text-theme-text-secondary">
          {measureBeat ? `Measure ${measureBeat.measureIndex}, beat ${measureBeat.beat}` : '-.-'}
        </span>
        <span aria-label="Zoom level" className="text-xs text-theme-text-secondary">
          {Math.round(zoom * 100)}%
        </span>
      </div>

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
    </div>
  );
}
