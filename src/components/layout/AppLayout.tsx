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
import { selectionSummaryCopy } from '@/i18n/lib-copy';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { KeyboardEvent } from 'react';
import { Button, Tooltip, cn } from '@sudobility/components';
import {
  ArrowDownTrayIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  Cog6ToothIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/solid';
import {
  ICON_CONTROL_CLASS,
  ICON_GLYPH_CLASS,
  SunMoonIcon,
  TEXT_CONTROL_CLASS,
} from '@/components/icons/notation-icons';
import { variants } from '@sudobility/design';
import { exportMidi, safeFilename as midiSafeFilename } from '@sudobility/music_lib';
import { scoreToTracker, isCleanFit } from '@sudobility/music_lib';
import type { TrackerFitReport, WritableTrackerFormat } from '@sudobility/music_lib';
import { TrackerFitDialog } from '@/components/dialogs/TrackerFitDialog';
import { exportMusicXml, safeFilename as musicXmlSafeFilename } from '@sudobility/music_lib';
import { allNotes, scoreWithTracks, selectVisibleTrackIds } from '@sudobility/music_lib';
import { renderEvents } from '@sudobility/music_lib';
import { findEvent, findMeasure, findTrack } from '@sudobility/music_lib';
import { playbackController } from '@sudobility/music_lib';
import { selectionSummaryLabel } from '@sudobility/music_lib';
import type { ValidationIssue } from '@sudobility/music_lib';
import { useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import type { Score } from '@sudobility/music_types';
import { reportError } from '@sudobility/music_lib';
import { selectCurrentMeasureBeat } from '@sudobility/music_lib';
import { ScoreEditorView } from '@/features/score-editor/ScoreEditorView';
import { PianoKeyboardView } from '@/features/piano-keyboard/PianoKeyboardView';
import { TransportBar } from '@/components/transport/TransportBar';
import { Toasts } from '@/components/layout/Toasts';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';
import { GeneratingOverlay } from '@/components/layout/GeneratingOverlay';
import {
  prepareRegenerationRequestForRange,
  replacementRegion,
  selectActiveTrackId,
} from '@sudobility/music_lib';
import type { ReplaceScope } from '@sudobility/music_lib';
import type { ReplaceSubmission } from '@/features/generation/ReplaceMusicDialog';
import { useProjectGeneration } from '@/features/generation/useGenerationJob';
import { CreditBadge } from '@/features/credits/CreditBadge';
import { MidiImportWizard } from '@/components/dialogs/MidiImportWizard';
import { MusicXmlImportDialog } from '@/components/dialogs/MusicXmlImportDialog';
import { ShortcutHelpDialog } from '@/components/dialogs/ShortcutHelpDialog';
import { ExportScopeDialog } from '@/components/dialogs/ExportScopeDialog';
import type { ExportScope } from '@/components/dialogs/ExportScopeDialog';
import { DeveloperSettingsDialog } from '@/components/dialogs/DeveloperSettingsDialog';
import { getAppServices } from '@/config/initialize';
import { CreateSnapshotDialog, OpenSnapshotDialog } from '@/features/snapshots/SnapshotDialogs';
import { snapshotTree } from '@/features/snapshots/snapshot-tree';
import type { SnapshotSummary } from '@sudobility/music_types';

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

/** Keys, resolved at render so the label follows the language. */
const SAVE_STATE_LABEL_KEY: Record<string, string> = {
  saved: 'editor.saved',
  saving: 'editor.saving',
  unsaved: 'editor.unsaved',
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
const ICON_BUTTON_CLASS = cn(
  ICON_CONTROL_CLASS,
  'rounded-md text-inherit hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40',
);

const TEXT_BUTTON_CLASS = cn(
  TEXT_CONTROL_CLASS,
  'rounded-md px-3 font-medium text-inherit hover:bg-white/10',
);

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
  const { t } = useTranslation();
  const measureBeat = store(selectCurrentMeasureBeat);
  return (
    <span aria-label={t('editor.position')} className="text-xs text-theme-text-secondary">
      {measureBeat
        ? t('editor.measureBeat', {
            measure: measureBeat.measureIndex,
            beat: measureBeat.beat,
          })
        : '-.-'}
    </span>
  );
}

export function AppLayout({ store = useAppStore, onNavigate }: AppLayoutProps) {
  const { t } = useTranslation();
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
  const projectId = store((s) => s.projectId);

  /**
   * Reloads the project after a job applies its result server-side. The score
   * in the store is stale by definition at that point — the server wrote it.
   */
  const generation = useProjectGeneration(projectId, {
    store,
    onApplied: async () => {
      if (!projectId) return;
      // Before the score is replaced. This write bypasses the edit lock — it
      // does not go through `dispatchCommand` — so without stopping first, the
      // controller would read the new score as a mix change and carry on
      // playing the old one from its queue.
      playbackController.stop();
      await store.getState().openProject(projectId);

      // Mark what the generation actually wrote, so it colours as generated
      // material rather than landing indistinguishable from the rest. The
      // candidate-accept workflow used to do this; a job applies server-side,
      // so the notes are found by the region that was asked for.
      const range = lastReplacedRangeRef.current;
      const next = store.getState().score;
      if (!range || !next) return;
      lastReplacedRangeRef.current = null;
      const written = allNotes(next)
        .filter(
          (n) =>
            range.trackIds.includes(n.trackId) &&
            n.startTick < range.endTick &&
            n.startTick + n.durationTicks > range.startTick,
        )
        .map((n) => n.id);
      if (written.length > 0) store.getState().selectRegenerated(written);
    },
  });

  /**
   * Turns a Replace submission into the request the server actually needs.
   *
   * The modal only collects settings; the region — its tick range, the
   * fragment being replaced, and the surrounding context the model reads to
   * continue seamlessly — is derived here. Sending the settings alone leaves
   * the server with nothing to regenerate against.
   */
  /** The region the last Replace targeted, so its result can be marked once applied. */
  const lastReplacedRangeRef = useRef<{
    startTick: number;
    endTick: number;
    trackIds: string[];
  } | null>(null);

  const startReplacement = useCallback(
    async (scope: ReplaceScope, submission: ReplaceSubmission): Promise<void> => {
      const state = store.getState();
      const current = state.score;
      if (!current) return;

      const region = replacementRegion(current, state.selection, selectActiveTrackId(state), scope);
      if (!region) return;

      const request = prepareRegenerationRequestForRange(
        current,
        region.range,
        submission.instruction,
        {
          measureAligned: region.measureAligned,
          ...(submission.style ? { style: submission.style } : {}),
          ...(submission.mood ? { mood: submission.mood } : {}),
          ...(submission.complexity ? { complexity: submission.complexity } : {}),
          constraints: submission.constraints,
        },
      );

      const kind =
        scope === 'notes'
          ? 'replace-notes'
          : scope === 'measures'
            ? 'replace-measures'
            : 'replace-track';
      lastReplacedRangeRef.current = region.range;
      await generation.start(kind, request);
    },
    [generation, store],
  );

  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const exportMenu = useMenu<HTMLDivElement>();
  const themeMenu = useMenu<HTMLDivElement>();
  const settingsMenu = useMenu<HTMLDivElement>();
  const issuesMenu = useMenu<HTMLDivElement>();
  const projectMenu = useMenu<HTMLDivElement>();

  // Snapshots go through `getAppServices().musicClient` directly, the way the
  // dashboard and every export in this file already reach the backend. The
  // app has no React Query provider around this subtree to hang hooks off.
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [parentSnapshotId, setParentSnapshotId] = useState<string | null>(null);
  const [createSnapshotOpen, setCreateSnapshotOpen] = useState(false);
  const [openSnapshotOpen, setOpenSnapshotOpen] = useState(false);
  const [publisherName, setPublisherName] = useState<string | undefined>(undefined);

  const refreshSnapshots = useCallback(async () => {
    const projectId = store.getState().projectId;
    if (!projectId) return;
    const { musicClient, auth } = getAppServices();
    const token = await auth.getToken();
    if (!token) return;
    setSnapshots(await musicClient.listSnapshots(projectId, token));
    setPublisherName((await musicClient.lastPublisherName(token)).publisherName ?? undefined);
    // The status endpoint carries `parentSnapshotId`. Reading the project for
    // it fetched the entire score to learn one id — every time this panel
    // opened, and after every snapshot taken.
    const status = await musicClient.getProjectStatus(projectId, token);
    setParentSnapshotId(status.parentSnapshotId);
    // Creating or opening a snapshot writes the project row. Recording where
    // the server stands keeps the generation poll from reading this client's
    // own change as a foreign one and reloading over the top of it.
    store.getState().noteServerVersion(status.updatedAt);
  }, [store]);

  const createSnapshot = useCallback(
    async (name: string, publisher?: string) => {
      const projectId = store.getState().projectId;
      if (!projectId) return;
      const { musicClient, auth } = getAppServices();
      const token = await auth.getToken();
      if (!token) return;

      // Push the live score first. `createSnapshot` copies the *server's*
      // project row, and autosave is debounced — so without this a snapshot
      // pins whatever the server last happened to receive rather than what is
      // on screen, which for a freshly generated score is nothing at all.
      //
      // Through the autosaver rather than a PUT of its own: `saveNow` is a
      // no-op when nothing is dirty, where a direct write re-uploaded the
      // whole score every time somebody took a second snapshot of it.
      await store.getState().saveNow();

      const snapshot = await musicClient.createSnapshot(projectId, name, token);
      setCreateSnapshotOpen(false);

      if (publisher) {
        const published = await musicClient.publishSnapshot(snapshot.id, publisher, token);
        const url = `${window.location.origin}/en/p/${published.publicId ?? ''}`;
        store.getState().pushToast({ message: `Published: ${url}`, severity: 'success' });
      }

      await refreshSnapshots();
    },
    [store, refreshSnapshots],
  );

  const openSnapshot = useCallback(
    async (snapshotId: string) => {
      const { musicClient, auth } = getAppServices();
      const token = await auth.getToken();
      if (!token) return;
      // The server replaces the live project and hands back the result, so the
      // editor takes its score straight from the response rather than reloading.
      const project = await musicClient.openSnapshot(snapshotId, token);
      // Stopped *before* the score is adopted, for the same reason the
      // generation reload above is: this write bypasses the edit lock, so the
      // controller must not still be playing when the new score arrives.
      playbackController.stop();
      store.getState().setScore(project.score);
      // This client made that change and is showing the result; say so, or the
      // generation poll reads the new `updatedAt` as somebody else's write.
      store.getState().noteServerVersion(project.updatedAt);
      setOpenSnapshotOpen(false);
      await refreshSnapshots();
    },
    [store, refreshSnapshots],
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
  const [pendingModule, setPendingModule] = useState<null | {
    format: WritableTrackerFormat;
    report: TrackerFitReport;
    write: () => Promise<void>;
  }>(null);

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

  /**
   * Render the score offline and save it.
   *
   * `renderEvents` decides what sounds (mute, solo, timing, per-track level and
   * pan); `audioRenderer` builds the same channel graph playback uses and
   * schedules into it, so the file matches what you just heard.
   */
  const handleExportAudio = (format: 'wav' | 'mp3'): void => {
    withExportScope(async (target) => {
      try {
        const { audioCodec, audioRenderer, fileExporter } = getAppServices().io;
        const plan = renderEvents(target);
        const audio = await audioRenderer.render(plan);
        const bytes = format === 'wav' ? audioCodec.encodeWav(audio) : audioCodec.encodeMp3(audio);
        await fileExporter.save(
          `${midiSafeFilename(target.metadata.title)}.${format}`,
          new Uint8Array(bytes),
          format === 'wav' ? 'audio/wav' : 'audio/mpeg',
        );
      } catch (err) {
        reportError(err, { context: `${format.toUpperCase()} export failed`, store });
      }
    });
    exportMenu.setOpen(false);
  };

  /**
   * Export a tracker module.
   *
   * Scope runs first because the fit depends on it: exporting visible tracks
   * only may bring a score within a channel limit that all tracks exceed.
   */
  const handleExportModule = (format: WritableTrackerFormat): void => {
    withExportScope(async (target) => {
      try {
        const { module, report } = scoreToTracker(target, { format });
        const write = async (): Promise<void> => {
          const bytes = getAppServices().io.modCodec.encode(module);
          await getAppServices().io.fileExporter.save(
            `${midiSafeFilename(target.metadata.title)}.${format}`,
            new Uint8Array(bytes),
            'application/octet-stream',
          );
        };
        // A clean fit must not cost a click.
        if (isCleanFit(report)) {
          await write();
          return;
        }
        setPendingModule({ format, report, write });
      } catch (err) {
        reportError(err, { context: `${format.toUpperCase()} export failed`, store });
      }
    });
    exportMenu.setOpen(false);
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
        reportError(err, { context: t('errors.midiExport'), store });
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
        reportError(err, { context: t('errors.musicXmlExport'), store });
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
      reportError(err, { context: t('errors.projectJsonExport'), store });
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
            aria-label={t('editor.backToDashboard')}
            onClick={() => onNavigate?.('/projects')}
            className={ICON_BUTTON_CLASS}
          >
            ←
          </button>

          {titleDraft !== null ? (
            <input
              value={titleDraft}
              autoFocus
              aria-label={t('editor.projectTitle')}
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
              aria-label={t('editor.editProjectTitle')}
              className="rounded-md border-none bg-transparent px-1 py-0.5 text-lg font-medium text-inherit hover:bg-white/10"
            >
              {projectName || t('editor.untitledProject')}
            </button>
          )}

          <span
            aria-label={t('editor.saveState', { state: t(SAVE_STATE_LABEL_KEY[saveState]) })}
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${SAVE_STATE_CLASS[saveState]}`}
          >
            {t(SAVE_STATE_LABEL_KEY[saveState])}
          </span>

          <Tooltip placement="bottom" content={t('editor.saveNow')}>
            <button
              type="button"
              aria-label={t('editor.save')}
              onClick={() => void store.getState().saveNow()}
              className={ICON_BUTTON_CLASS}
            >
              <ArrowDownTrayIcon className={ICON_GLYPH_CLASS} />
            </button>
          </Tooltip>
          <Tooltip
            placement="bottom"
            content={
              canUndo ? t('editor.undoWhat', { what: undoLabel }) : t('editor.nothingToUndo')
            }
          >
            <button
              type="button"
              aria-label={t('editor.undo')}
              disabled={!canUndo}
              onClick={() => store.getState().undo()}
              className={ICON_BUTTON_CLASS}
            >
              <ArrowUturnLeftIcon className={ICON_GLYPH_CLASS} />
            </button>
          </Tooltip>
          <Tooltip
            placement="bottom"
            content={
              canRedo ? t('editor.redoWhat', { what: redoLabel }) : t('editor.nothingToRedo')
            }
          >
            <button
              type="button"
              aria-label={t('editor.redo')}
              disabled={!canRedo}
              onClick={() => store.getState().redo()}
              className={ICON_BUTTON_CLASS}
            >
              <ArrowUturnRightIcon className={ICON_GLYPH_CLASS} />
            </button>
          </Tooltip>

          <div ref={projectMenu.ref} className="relative">
            <button
              type="button"
              aria-label={t('editor.projectMenu')}
              aria-haspopup="menu"
              aria-expanded={projectMenu.open}
              onClick={() => {
                projectMenu.setOpen((v) => !v);
                void refreshSnapshots();
              }}
              className={TEXT_BUTTON_CLASS}
            >
              {t('editor.projectMenuLabel')}
            </button>
            {projectMenu.open && (
              <div role="menu" className={`left-0 ${MENU_CLASS}`}>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={() => {
                    projectMenu.setOpen(false);
                    setCreateSnapshotOpen(true);
                  }}
                  disabled={!score}
                  className={MENU_ITEM_CLASS}
                >
                  {t('editor.createSnapshot')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={() => {
                    projectMenu.setOpen(false);
                    setOpenSnapshotOpen(true);
                  }}
                  disabled={!score}
                  className={MENU_ITEM_CLASS}
                >
                  {t('editor.openSnapshot')}
                </Button>
              </div>
            )}
          </div>

          <div ref={exportMenu.ref} className="relative">
            <button
              type="button"
              aria-label={t('editor.exportMenu')}
              aria-haspopup="menu"
              aria-expanded={exportMenu.open}
              onClick={() => exportMenu.setOpen((v) => !v)}
              className={TEXT_BUTTON_CLASS}
            >
              {t('editor.export')}
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
                  {t('editor.print')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={() => handleExportAudio('wav')}
                  disabled={!score}
                  className={MENU_ITEM_CLASS}
                >
                  {t('editor.audioWav')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={() => handleExportAudio('mp3')}
                  disabled={!score}
                  className={MENU_ITEM_CLASS}
                >
                  {t('editor.audioMp3')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={handleExportMidi}
                  disabled={!score}
                  className={MENU_ITEM_CLASS}
                >
                  {t('editor.midi')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={handleExportMusicXml}
                  disabled={!score}
                  className={MENU_ITEM_CLASS}
                >
                  {t('editor.musicXml')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={() => handleExportModule('xm')}
                  disabled={!score}
                  className={MENU_ITEM_CLASS}
                >
                  {t('editor.xmModule')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={() => void handleExportProjectJson()}
                  className={MENU_ITEM_CLASS}
                >
                  {t('editor.projectJson')}
                </Button>
              </div>
            )}
          </div>

          <div className="flex-1" />

          {/* Its own subscriber: the balance changes on every generation, and
              reading it here would re-render the notation canvas with it. */}
          <CreditBadge />

          <div ref={themeMenu.ref} className="relative">
            <Tooltip placement="bottom" content={t('settings.theme')}>
              <button
                type="button"
                aria-label={t('editor.themeMenu')}
                aria-haspopup="menu"
                aria-expanded={themeMenu.open}
                onClick={() => themeMenu.setOpen((v) => !v)}
                className={ICON_BUTTON_CLASS}
              >
                <SunMoonIcon className={ICON_GLYPH_CLASS} />
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

          <Tooltip placement="bottom" content={t('editor.keyboardShortcuts')}>
            <button
              type="button"
              aria-label={t('editor.keyboardShortcuts')}
              onClick={() => store.getState().openDialog('shortcutHelp')}
              className={ICON_BUTTON_CLASS}
            >
              <QuestionMarkCircleIcon className={ICON_GLYPH_CLASS} />
            </button>
          </Tooltip>

          <div ref={settingsMenu.ref} className="relative">
            <Tooltip placement="bottom" content={t('nav.settings')}>
              <button
                type="button"
                aria-label={t('editor.settingsMenu')}
                aria-haspopup="menu"
                aria-expanded={settingsMenu.open}
                onClick={() => settingsMenu.setOpen((v) => !v)}
                className={ICON_BUTTON_CLASS}
              >
                <Cog6ToothIcon className={ICON_GLYPH_CLASS} />
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
                  {t('settings.developerMode')}
                  <input
                    type="checkbox"
                    checked={developerMode}
                    onChange={() => store.getState().setDeveloperMode(!developerMode)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={t('editor.developerMode')}
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
                  {t('editor.developerSettings')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/*
        Everything below the app bar is one region, and the generating overlay
        covers all of it: the sheet, the inspector, the keyboard and the
        transport. A job rewrites the score out from under every one of those —
        a keyboard that still auditions notes, or a transport that still plays,
        is offering to edit music that is about to be replaced. The app bar
        stays outside it on purpose, so you can leave and come back.
      */}
      <div className="relative flex min-h-0 flex-1 flex-col">
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
                // The same runner the Replace buttons use, so adding a track
                // behaves like every other generation: the overlay appears, the
                // project is locked server-side, and leaving is safe.
                onGenerateTrackJob={(request) => generation.start('generate-track', request)}
              />
            </div>
          </div>

          {inspectorOpen && (
            <div
              className="flex shrink-0 flex-col overflow-y-auto overscroll-contain border-l border-theme-border"
              style={{ width: SIDE_PANEL_WIDTH }}
            >
              {/* The generation panels are gone: whole-score generation moved
                to the dashboard, and region regeneration is now the
                Inspector's three Replace buttons, each submitting a job. */}
              <div className="shrink-0">
                <InspectorPanel
                  store={store}
                  onReplace={(scope, submission) => void startReplacement(scope, submission)}
                />
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

        {generation.generating && (
          <GeneratingOverlay onCancel={() => void generation.cancel()} error={generation.error} />
        )}
      </div>

      <div
        role="status"
        aria-label={t('editor.statusBar')}
        className="flex items-center gap-4 border-t border-theme-border px-4 py-1"
      >
        <span className="text-xs text-theme-text-secondary">
          {selectionSummaryLabel(selection, selectionSummaryCopy(), selectionRegenerated)}
        </span>
        <div className="flex-1" />
        <div ref={issuesMenu.ref} className="relative">
          <Button
            type="button"
            variant="ghost"
            aria-label={t('editor.validationIssues')}
            onClick={() => issuesMenu.setOpen((v) => !v)}
            disabled={validationIssues.length === 0}
            className="gap-1.5 px-2 py-1 text-xs"
          >
            {t('editor.issues')}
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
              <div role="list" aria-label={t('editor.validationList')}>
                {validationIssues.length === 0 && (
                  <p className="p-1 text-sm text-theme-text-secondary">{t('editor.noIssues')}</p>
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
        <span aria-label={t('editor.zoomLevel')} className="text-xs text-theme-text-secondary">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      <Toasts store={store} />

      <CreateSnapshotDialog
        open={createSnapshotOpen}
        snapshotCount={snapshots.length}
        {...(publisherName ? { defaultPublisherName: publisherName } : {})}
        onCreate={(name, publisher) => void createSnapshot(name, publisher)}
        onClose={() => setCreateSnapshotOpen(false)}
      />

      <OpenSnapshotDialog
        open={openSnapshotOpen}
        nodes={snapshotTree(snapshots, parentSnapshotId)}
        onOpen={(id) => void openSnapshot(id)}
        onSnapshotFirst={() => {
          // The non-destructive escape: keep the work, then choose again.
          setOpenSnapshotOpen(false);
          setCreateSnapshotOpen(true);
        }}
        onClose={() => setOpenSnapshotOpen(false)}
      />

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
      {pendingModule && (
        <TrackerFitDialog
          open
          format={pendingModule.format.toUpperCase()}
          report={pendingModule.report}
          onCancel={() => setPendingModule(null)}
          onConfirm={() => {
            const pending = pendingModule;
            setPendingModule(null);
            void pending.write().catch((err) => {
              reportError(err, { context: t('errors.moduleExport'), store });
            });
          }}
        />
      )}
      {developerMode && (
        <DeveloperSettingsDialog
          open={dialogs.devSettings === true}
          onClose={() => store.getState().closeDialog('devSettings')}
          store={store}
        />
      )}
    </div>
  );
}
