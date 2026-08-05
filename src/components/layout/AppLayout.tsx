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
 *
 * Library sweep 2: every menu *item* button (Import/Export/Theme's popover
 * contents, and Developer settings…) becomes the library `Button` -- those
 * popovers render on a normal card background (`variants.card.default.
 * base()`), not the app bar, so there's no contrast concern. Toggle track
 * panel/Toggle inspector panel and the status bar's Validation issues
 * button (also off the colored bar) become the library `Button` too.
 *
 * The app bar's own buttons (Back to dashboard, Save/Undo/Redo, the four
 * menu *triggers*, Keyboard shortcuts) stay hand-rolled on `ICON_BUTTON_
 * CLASS`/`TEXT_BUTTON_CLASS`, per this file's pre-existing doc comment
 * below -- verified, not just assumed, for this sweep: `Button`'s `ghost`
 * variant's own `dark:text-gray-300`/`dark:hover:bg-gray-800` compile to a
 * `.dark <class>` selector, which is *more specific* than a plain
 * `text-inherit`/`hover:bg-white/10` override, so it still wins in dark
 * mode even after a className override -- only adding matching `dark:`-
 * prefixed counterparts (`dark:text-inherit`, `dark:hover:bg-white/10`)
 * actually neutralizes it (tailwind-merge dedupes same-modifier-stack
 * classes). That's *possible*, but the inverted, "works on any bg-primary"
 * skin these buttons need has no equivalent in the library variant set,
 * so it'd only ever be this file's own bespoke override, not a real library
 * skin -- the honest characterization is still "kept native", just with a
 * documented, checked reason rather than an assumed one.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { Button, Tooltip, cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
import { exportMidi, safeFilename as midiSafeFilename } from '@sudobility/music_lib';
import { exportMusicXml, safeFilename as musicXmlSafeFilename } from '@sudobility/music_lib';
import { scoreWithTracks, selectVisibleTrackIds } from '@sudobility/music_lib';
import { findEvent, findMeasure, findTrack } from '@sudobility/music_lib';
import { selectionSummaryLabel } from '@sudobility/music_lib';
import type { ValidationIssue } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { parseScore } from '@sudobility/music_types';
import type { Score } from '@sudobility/music_types';
import { reportError } from '@sudobility/music_lib';
import { selectCurrentMeasureBeat } from '@sudobility/music_lib';
import { ScoreEditorView } from '@/features/score-editor/ScoreEditorView';
import { PianoKeyboardView } from '@/features/piano-keyboard/PianoKeyboardView';
import { GenerationPanel } from '@/features/generation/GenerationPanel';
import { RegenerationPanel } from '@/features/generation/RegenerationPanel';
import { TransportBar } from '@/components/transport/TransportBar';
import { TrackEditorPanel } from '@/features/tracks/TrackEditorPanel';
import { Toasts } from '@/components/layout/Toasts';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { MidiImportWizard } from '@/components/dialogs/MidiImportWizard';
import { MusicXmlImportDialog } from '@/components/dialogs/MusicXmlImportDialog';
import { ShortcutHelpDialog } from '@/components/dialogs/ShortcutHelpDialog';
import { ExportScopeDialog } from '@/components/dialogs/ExportScopeDialog';
import type { ExportScope } from '@/components/dialogs/ExportScopeDialog';
import { DeveloperSettingsDialog } from '@/components/dialogs/DeveloperSettingsDialog';
import { getAppServices } from '@/config/initialize';

export type AppLayoutProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /** Called after "Back to dashboard" is clicked, and after importing Project JSON opens a different project. Defaults to a no-op (tests/host apps that don't need navigation can omit it); `router.tsx` wires this to `useNavigate()`. */
  onNavigate?: (path: string) => void;
};

const SIDE_PANEL_WIDTH = 280;
/**
 * Fixed height of the piano-keyboard panel. Not resizable — collapse is the
 * only size control. Far shorter than the timeline it replaced, which hands
 * ~130px back to the notation.
 */
const PIANO_KEYBOARD_PANEL_HEIGHT = 190;

const SAVE_STATE_LABEL: Record<string, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved',
};
const SAVE_STATE_CLASS: Record<string, string> = {
  saved: 'bg-success text-success-foreground',
  saving: 'bg-info text-info-foreground',
  unsaved: 'bg-warning text-warning-foreground',
};

// Kept hand-rolled: these sit on the primary-colored app-bar background;
// ghost's neutral-background skin (text-muted-foreground/hover:bg-muted)
// isn't designed for an inverted (text-on-primary) toolbar and would lose
// contrast there.
const ICON_BUTTON_CLASS =
  'rounded-md p-1.5 text-sm leading-none text-inherit hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';

const TEXT_BUTTON_CLASS =
  'rounded-md px-3 py-1.5 text-sm font-medium text-inherit hover:bg-white/10';

const MENU_CLASS = cn(
  variants.card.default.base(),
  'absolute top-full z-10 mt-1 min-w-[160px] rounded-md py-1 text-left shadow-lg',
);

// No longer prefixed with `variants.button.ghost.default()`: every menu-item
// button below is now the library `Button` with `variant="ghost"`, which
// already supplies those base classes -- this is just the popover-specific
// layout override.
const MENU_ITEM_CLASS =
  'block w-full justify-start rounded-none whitespace-nowrap px-3 py-1.5 text-left';

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

/**
 * The status bar's measure/beat readout, isolated as its own subscriber.
 *
 * `selectCurrentMeasureBeat` is memoized on `positionTick`, so it hands back a
 * fresh object on every one of the engine's 30 reports a second. Read at
 * `AppLayout`'s top level that re-rendered the entire app tree — notation,
 * keyboard and all — 30 times a second during playback. Down here only this
 * span re-renders.
 */
function StatusPosition({ store }: { store: EditorStoreApi }) {
  const measureBeat = store(selectCurrentMeasureBeat);
  return (
    <span aria-label="Position" className="text-xs text-theme-text-secondary">
      {measureBeat ? `Measure ${measureBeat.measureIndex}, beat ${measureBeat.beat}` : '-.-'}
    </span>
  );
}

export function AppLayout({ store = useAppStore, onNavigate }: AppLayoutProps) {
  const projectName = store((s) => s.projectName);
  const saveState = store((s) => s.saveState);
  const canUndo = store((s) => s.canUndo);
  const canRedo = store((s) => s.canRedo);
  const undoLabel = store((s) => s.undoLabel);
  const redoLabel = store((s) => s.redoLabel);
  const zoom = store((s) => s.zoom);
  const themeMode = store((s) => s.themeMode);
  const developerMode = store((s) => s.developerMode);
  const dialogs = store((s) => s.dialogs);
  const selection = store((s) => s.selection);
  const selectionRegenerated = store((s) => s.selectionRegenerated);
  const score = store((s) => s.score);
  const validationIssues = store((s) => s.validationIssues);
  const generationMode = store((s) => s.mode);

  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const importMenu = useMenu<HTMLDivElement>();
  const exportMenu = useMenu<HTMLDivElement>();
  const themeMenu = useMenu<HTMLDivElement>();
  const settingsMenu = useMenu<HTMLDivElement>();
  const issuesMenu = useMenu<HTMLDivElement>();
  const [confirmingImportJson, setConfirmingImportJson] = useState<Record<string, unknown> | null>(
    null,
  );
  const [keyboardCollapsed, setKeyboardCollapsed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  const visibleTrackIds = store(selectVisibleTrackIds);
  const hiddenCount = (score?.tracks.length ?? 0) - visibleTrackIds.length;
  /**
   * The export waiting on the user's answer, or null when nothing is pending.
   *
   * Held as a callback rather than a "which format" tag so each handler keeps
   * its own filename, mime type and error context in one place, instead of
   * this dialog having to reconstruct them.
   */
  const [pendingExport, setPendingExport] = useState<null | ((scope: ExportScope) => void)>(null);

  /**
   * Runs `write` against the score the user asked for, asking first only when
   * the two possible answers actually differ.
   */
  const withExportScope = (write: (target: Score) => Promise<void>): void => {
    if (!score) return;
    if (hiddenCount <= 0) {
      void write(score);
      return;
    }
    // Stored via an updater that *returns* the callback: React would otherwise
    // call a function passed to setState as an updater rather than store it.
    setPendingExport(() => (scope: ExportScope) => {
      setPendingExport(null);
      void write(scope === 'all' ? score : scoreWithTracks(score, visibleTrackIds));
    });
  };

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
    withExportScope(async (target) => {
      try {
        const bytes = exportMidi(target, getAppServices().io.midiCodec);
        await getAppServices().io.fileExporter.save(
          `${midiSafeFilename(target.metadata.title)}.mid`,
          bytes,
          'audio/midi',
        );
      } catch (err) {
        reportError(err, { context: 'MIDI export failed', store });
      }
    });
    exportMenu.setOpen(false);
  };

  const handleExportMusicXml = (): void => {
    withExportScope(async (target) => {
      try {
        const xml = exportMusicXml(target);
        await getAppServices().io.fileExporter.save(
          `${musicXmlSafeFilename(target.metadata.title)}.musicxml`,
          xml,
          'application/vnd.recordare.musicxml+xml',
        );
      } catch (err) {
        reportError(err, { context: 'MusicXML export failed', store });
      }
    });
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
        2,
      );
      await getAppServices().io.fileExporter.save(
        `${projectName || 'project'}.json`,
        payload,
        'application/json',
      );
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
    // h-screen (not h-full): this route renders straight under `#root`,
    // which only has `min-height: 100vh` — a percentage height would
    // resolve to auto and let the whole page scroll. Bounding the editor
    // to the viewport keeps the transport + status bars pinned at the
    // bottom while the score area scrolls inside itself.
    <div className="flex h-screen min-h-0 flex-col">
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
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={() => {
                    importMenu.setOpen(false);
                    store.getState().openDialog('midiImport');
                  }}
                  className={MENU_ITEM_CLASS}
                >
                  MIDI…
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={() => {
                    importMenu.setOpen(false);
                    store.getState().openDialog('musicXmlImport');
                  }}
                  className={MENU_ITEM_CLASS}
                >
                  MusicXML…
                </Button>
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
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={() => {
                    exportMenu.setOpen(false);
                    onNavigate?.(`/project/${store.getState().projectId ?? ''}/print`);
                  }}
                  disabled={!score}
                  className={MENU_ITEM_CLASS}
                >
                  Print…
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={handleExportMidi}
                  disabled={!score}
                  className={MENU_ITEM_CLASS}
                >
                  MIDI
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={handleExportMusicXml}
                  disabled={!score}
                  className={MENU_ITEM_CLASS}
                >
                  MusicXML
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={() => void handleExportProjectJson()}
                  className={MENU_ITEM_CLASS}
                >
                  Project JSON
                </Button>
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
                  <Button
                    key={mode}
                    type="button"
                    variant="ghost"
                    role="menuitem"
                    onClick={() => {
                      store.getState().setThemeMode(mode);
                      themeMenu.setOpen(false);
                    }}
                    className={cn(MENU_ITEM_CLASS, themeMode === mode && 'bg-theme-hover-bg')}
                  >
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </Button>
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
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  disabled={!developerMode}
                  onClick={() => {
                    settingsMenu.setOpen(false);
                    store.getState().openDialog('devSettings');
                  }}
                  className={MENU_ITEM_CLASS}
                >
                  Developer settings…
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* The inspector toggle lives on the editor toolbar. It used to sit on
              a strip of its own alongside a track-panel toggle; with that gone
              the strip was a blank row holding one button. */}
          <div className="min-h-0 flex-1">
            <ScoreEditorView
              store={store}
              inspectorOpen={inspectorOpen}
              onToggleInspector={() => setInspectorOpen((v) => !v)}
            />
          </div>
        </div>

        {inspectorOpen && (
          <div
            className="flex shrink-0 flex-col overflow-y-auto overscroll-contain border-l border-theme-border"
            style={{ width: SIDE_PANEL_WIDTH }}
          >
            {/* shrink-0 on every child: this column is height-bounded now
                (h-screen root), and flex children would otherwise compress
                to fit — visually stacking the panels onto each other —
                instead of overflowing into the column's own scrollbar. */}
            <div className="shrink-0">
              <InspectorPanel store={store} />
            </div>
            <div className="shrink-0 border-t border-theme-border" />
            <div className="shrink-0">
              {generationMode === 'generate' ? (
                <GenerationPanel store={store} />
              ) : (
                <RegenerationPanel store={store} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Full-width piano keyboard: a sibling of the transport rather than a
          child of the centre column, so it spans the whole window beneath the
          track and inspector panels. Fixed height, collapsible, and its own
          horizontal scroll when the window is too narrow for 88 keys. */}
      <div
        className="shrink-0 overflow-hidden border-t border-theme-border"
        style={keyboardCollapsed ? undefined : { height: PIANO_KEYBOARD_PANEL_HEIGHT }}
      >
        {/* The editor panel shares the keyboard's row and the canvas gutter's
            width, so a track's label on the sheet and its controls sit on the
            same column. Both show only the active track. */}
        <div className="flex h-full min-h-0">
          {!keyboardCollapsed && <TrackEditorPanel store={store} />}
          <div className="min-w-0 flex-1">
            <PianoKeyboardView
              store={store}
              collapsed={keyboardCollapsed}
              onToggleCollapsed={() => setKeyboardCollapsed((v) => !v)}
            />
          </div>
        </div>
      </div>

      {/* Pinned bottom bars: the transport sits directly above the status
          bar, outside the scrolling score region, so neither scrolls away
          with the sheet. */}
      <TransportBar store={store} />

      <div
        role="status"
        aria-label="Status bar"
        className="flex items-center gap-4 border-t border-theme-border px-4 py-1"
      >
        <span className="text-xs text-theme-text-secondary">
          {selectionSummaryLabel(selection, selectionRegenerated)}
        </span>
        <div className="flex-1" />
        <div ref={issuesMenu.ref} className="relative">
          <Button
            type="button"
            variant="ghost"
            aria-label="Validation issues"
            onClick={() => issuesMenu.setOpen((v) => !v)}
            disabled={validationIssues.length === 0}
            className="gap-1.5 px-2 py-1 text-xs"
          >
            Issues
            <span
              className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ${
                errorIssues.length > 0 ? 'bg-destructive' : 'bg-warning'
              }`}
            >
              {validationIssues.length}
            </span>
          </Button>
          {issuesMenu.open && (
            <div
              className={cn(
                variants.card.default.base(),
                'absolute bottom-full right-0 z-10 mb-1 min-w-[280px] max-h-[320px] overflow-auto rounded-md p-1 shadow-lg',
              )}
            >
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
        <StatusPosition store={store} />
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
      <ShortcutHelpDialog
        open={dialogs.shortcutHelp === true}
        onClose={() => store.getState().closeDialog('shortcutHelp')}
      />
      <ExportScopeDialog
        open={pendingExport !== null}
        hiddenCount={hiddenCount}
        onChoose={(scope) => pendingExport?.(scope)}
        onCancel={() => setPendingExport(null)}
      />
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
