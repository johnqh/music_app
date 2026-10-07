/**
 * The app shell (spec §6): app bar (editable project title, save-state
 * chip, save/undo/redo, import/export menus, theme toggle, shortcut-help
 * and settings icons), a three-pane layout (track panel | main editor |
 * inspector + generation panel) with collapsible side panels, the
 * playback transport, a status bar (selection summary, validation issue
 * count with a click-to-navigate popover), toasts, and
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
 * The app bar's own buttons (Back to dashboard, Save/Undo/Redo, Print, the
 * four menu *triggers*, Keyboard shortcuts) stay hand-rolled on
 * `ICON_BUTTON_CLASS`. Two reasons, both about the bar rather than about
 * the library. The bar is `bg-primary text-primary-foreground`, and every
 * `Button` variant states a colour of its own — `ghost` is
 * `text-muted-foreground hover:bg-muted`, a grey glyph on red — where
 * these inherit the bar's foreground and wash it on hover. And the bar is
 * one of the two h-8 editor bars sized by `ICON_CONTROL_CLASS`, where the
 * library's 44px minimum height does not belong.
 */
import { libraryCopy } from '@/i18n/library-copy';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KEYBOARD_MAX_HEIGHT, keyboardPanelHeight } from '@sudobility/music_drawing';
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
import { ChevronLeftIcon } from '@heroicons/react/24/outline';
// Line art, deliberately: a solid camera or printer is a heavy blob at 18px,
// where the arrows and the gear read as line work even in the solid set.
import {
  BookOpenIcon,
  CameraIcon,
  DocumentArrowDownIcon,
  PrinterIcon,
} from '@heroicons/react/24/outline';
import { ICON_GLYPH_CLASS, SunMoonIcon } from '@/components/icons/notation-icons';
import { variants } from '@sudobility/design';
import {
  ICON_BUTTON_CLASS,
  MENU_CLASS,
  MENU_ITEM_CLASS,
  useMenu,
} from '@/components/layout/app-bar-menu';
import { regenerateWithLocks } from '@/app-library';
import { scoreToTracker, isCleanFit } from '@/app-library';
import type { TrackerFitReport, WritableTrackerFormat } from '@/app-library';
import { TrackerFitDialog } from '@/components/dialogs/TrackerFitDialog';
import {
  WRITABLE_EXPORT_FORMATS,
  adoptOutsideScore,
  exportFilename,
  exportScopeNeedsPrompt,
  hiddenTrackCount,
  planExport,
  prepareReplacement,
  defaultReplaceSubmission,
  repairIssuesOutcome,
  selectRegeneratedInRange,
  serializeProjectFile,
} from '@/app-library';
import type { ExportFormatId, ExportPlan } from '@/app-library';
import { renderScoreAudio } from '@sudobility/music_player';
import { useProjectSnapshots } from '@sudobility/music_client';
import { THEME_MODE_OPTIONS, publishedSnapshotUrl } from '@sudobility/music_types';
import type { GenerationJobKind } from '@sudobility/music_types';
import { SOUNDFONT_ASSETS } from '@/config/initialize';
import { findEvent, findMeasure, findTrack } from '@/app-library';
import { playbackController } from '@/app-library';
import { selectionSummaryLabel } from '@/app-library';
import type { ValidationIssue } from '@/app-library';
import { useAppStore } from '@/app-library';
import type { EditorStoreApi } from '@/app-library';
import { repairAllIssues } from '@/app-library';
import { reportError } from '@/app-library';
import { ScoreEditorView } from '@/features/score-editor/ScoreEditorView';
import { PianoKeyboardView } from '@/features/piano-keyboard/PianoKeyboardView';
import { TransportBar } from '@/components/transport/TransportBar';
import { Toasts } from '@/components/layout/Toasts';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';
import { GenerationStatusStrip } from '@/components/layout/GenerationStatusStrip';
import type { ReplaceScope, ReplaceSubmission } from '@/app-library';
import { useProjectGeneration } from '@/features/generation/useGenerationJob';
import { CreditBadge } from '@/features/credits/CreditBadge';
import { MidiImportWizard } from '@/components/dialogs/MidiImportWizard';
import { MusicXmlImportDialog } from '@/components/dialogs/MusicXmlImportDialog';
import { ShortcutHelpDialog } from '@/components/dialogs/ShortcutHelpDialog';
import { ExportScopeDialog } from '@/components/dialogs/ExportScopeDialog';
import { DeveloperSettingsDialog } from '@/components/dialogs/DeveloperSettingsDialog';
import { getAppServices } from '@/config/initialize';
import { CreateSnapshotDialog, OpenSnapshotDialog } from '@/features/snapshots/SnapshotDialogs';
import { ManagePublishedDialog } from '@/features/snapshots/ManagePublishedDialog';
import { ButtonSpinner } from '@/components/controls/PendingButton';
import { usePendingAction } from '@/hooks/usePendingAction';
import type { ExportScope } from '@/components/dialogs/ExportScopeDialog';
import { useCurrentLanguage } from '@/hooks/useLocalizedNavigate';
import { useMusicHookContext } from '@/app/AuthContext';
import { SpatialSection } from '@/features/spatial/SpatialSection';

export type AppLayoutProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /** Called after "Back to dashboard" is clicked, and after importing Project JSON opens a different project. Defaults to a no-op (tests/host apps that don't need navigation can omit it); `router.tsx` wires this to `useNavigate()`. */
  onNavigate?: (path: string) => void;
};

const SIDE_PANEL_WIDTH = 280;

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

/**
 * What the toast says when a format fails to write. A record keyed by the
 * format vocabulary, so a format added upstream fails to compile here rather
 * than failing with no message.
 */
const EXPORT_ERROR_KEY: Record<ExportFormatId, string> = {
  midi: 'errors.midiExport',
  musicxml: 'errors.musicXmlExport',
  xm: 'errors.moduleExport',
  wav: 'errors.audioExport',
  mp3: 'errors.audioExport',
  project: 'errors.projectJsonExport',
};

// Kept hand-rolled: these sit on the primary-colored app-bar background;
// ghost's neutral-background skin (text-muted-foreground/hover:bg-muted)
// isn't designed for an inverted (text-on-primary) toolbar and would lose
// contrast there.

export function AppLayout({ store = useAppStore, onNavigate }: AppLayoutProps) {
  const lang = useCurrentLanguage();
  const { t } = useTranslation();
  const projectName = store((s) => s.projectName);
  const saveState = store((s) => s.saveState);
  const canUndo = store((s) => s.canUndo);
  const canRedo = store((s) => s.canRedo);
  const undoLabel = store((s) => s.undoLabel);
  const redoLabel = store((s) => s.redoLabel);
  const themeMode = store((s) => s.themeMode);
  const developerMode = store((s) => s.developerMode);
  const dialogs = store((s) => s.dialogs);
  const selection = store((s) => s.selection);
  const selectionRegenerated = store((s) => s.selectionRegenerated);
  // Whether there is a score, never the score: this component only asks
  // that for its disabled flags, and subscribing to the object itself made
  // every edit — and every frame of a walk or a drag on the Unplugged stage,
  // each of which is a score command — render the whole editor chrome.
  const hasScore = store((s) => s.score !== null);
  const validationIssues = store((s) => s.validationIssues);
  // Transport state only — it changes on a transition, not per position
  // report, so unlike `positionTick` it is safe to read at this level.
  const playbackState = store((s) => s.state);
  const projectId = store((s) => s.projectId);

  /**
   * Reloads the project after a job applies its result server-side. The score
   * in the store is stale by definition at that point — the server wrote it.
   */
  const lastGeneration = store((s) => s.lastGeneration);
  const projectOrigin = store((s) => s.origin);
  /**
   * What a job's result is marked as once it lands — the same for a result
   * that arrived live and one a poll noticed.
   */
  const markGenerated = useCallback(async () => {
    // Generation output is external content. Repair it, then persist the
    // repaired score so the issue list stays clear after a reload as well as
    // in the current editor session. The server repairs what a job hands
    // over; this is for a score that came from one that did not.
    //
    // The lock comes off first. This runs before the hook reports the
    // project ready, so the edit lock is still held — and a repair is a
    // content command, which the lock refuses without a word. With it held
    // the repair fixed nothing, every time, and said so to nobody. The job
    // has landed and its score is adopted; there is nothing left to guard.
    store.getState().setEditLocked(false);
    const repairResult = repairAllIssues(store, t('editor.fixIssues'));
    if (repairResult.remaining === 0 && repairResult.fixed > 0) {
      await store.getState().saveNow();
    }

    // Mark what the generation actually wrote, so it colours as generated
    // material rather than landing indistinguishable from the rest. The
    // candidate-accept workflow used to do this; a job applies server-side,
    // so the notes are found by the region that was asked for.
    const range = lastReplacedRangeRef.current;
    if (!range) return;
    lastReplacedRangeRef.current = null;
    selectRegeneratedInRange(store, range);
  }, [store, t]);
  const generation = useProjectGeneration(projectId, {
    store,
    /*
      The live stream delivered the final score — the one `GET /projects/:id`
      would return — so it is adopted from the message rather than fetched
      again. The store refuses it for a project that is no longer open, in
      which case there is nothing to mark either.
    */
    onComplete: async (final) => {
      if (!projectId) return;
      const adopted = store.getState().adoptLiveResult(final.score, playbackController, {
        projectId,
        serverUpdatedAt: final.updatedAt,
        ...(final.lastGeneration ? { lastGeneration: final.lastGeneration } : {}),
        // So a blank project reads as generated the moment its score lands,
        // as the row now says, without fetching the project again.
        job: final.job ? { id: final.job.id, kind: final.job.kind } : null,
      });
      if (!adopted) return;
      await markGenerated();
    },
    onApplied: async () => {
      if (!projectId) return;
      // Before the score is replaced. This write bypasses the edit lock — it
      // does not go through `dispatchCommand` — so without stopping first, the
      // controller would read the new score as a mix change and carry on
      // playing the old one from its queue.
      playbackController.stop();
      await store.getState().openProject(projectId);
      await markGenerated();
    },
  });
  const generating = generation.generating;

  /*
    A transcription that ended badly says so after the strip has gone.

    The strip is what shows `generation.error`, and it is unmounted the
    moment the project is ready again — which, for a failure, is the same
    moment. A generation's failure reaches a toast through the hook, by way
    of the job it started; a transcription has no job, and the reader is now
    sitting in front of the project when it fails rather than finding out
    from a card on the dashboard.
  */
  const lastStatusRef = useRef(generation.status);
  useEffect(() => {
    const previous = lastStatusRef.current;
    lastStatusRef.current = generation.status;
    if (previous === 'transcribing' && generation.status === 'ready' && generation.error) {
      store.getState().pushToast({ message: generation.error, severity: 'error' });
    }
  }, [store, generation.status, generation.error]);

  /*
    The edit lock, for as long as a job owns the project.

    The read-only view and the disabled buttons below are what the reader
    sees; this is what holds. Every edit goes through `dispatchCommand`, and
    with the lock held it refuses content commands from any path — the piano
    keyboard, the inspector, a shortcut, a menu — so nothing can dirty a
    project whose score the server is in the middle of replacing.
  */
  useEffect(() => {
    store.getState().setEditLocked(generating);
    return () => store.getState().setEditLocked(false);
  }, [store, generating]);

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

  /*
    Starting a job is a save, a token and a POST before `generating` turns
    true, and for all of that the CTA that asked — Replace, Generate Again,
    Generate in Insert Bars — would otherwise sit there live and pressable. One
    pending flag for every way in, since a project runs one job at a time; each
    dialog stays open with its button spinning until the job is accepted.
  */
  const [startingJob, runStartJob] = usePendingAction();
  const [voiceJob, setVoiceJob] = useState<{
    cancel: () => void;
    progress: {
      stage: 'plan' | 'part' | 'section' | 'chunk';
      label: string;
      done: number;
      total: number;
    } | null;
  } | null>(null);
  const { start: startGeneration } = generation;
  const startJob = useCallback(
    (kind: GenerationJobKind, request: unknown) =>
      runStartJob(() => startGeneration(kind, request)),
    [runStartJob, startGeneration],
  );

  const startReplacement = useCallback(
    async (scope: ReplaceScope, submission: ReplaceSubmission): Promise<void> => {
      const prepared = prepareReplacement(store, scope, submission);
      if (!prepared) return;
      lastReplacedRangeRef.current = prepared.range;
      await startJob(prepared.kind, prepared.request);
    },
    [startJob, store],
  );

  const generateInsertedBars = useCallback(async (): Promise<void> => {
    const submission = defaultReplaceSubmission();
    await startReplacement('measures', {
      ...submission,
      instruction: t('editor.generateInsertedBarsInstruction'),
    });
  }, [startReplacement, t]);

  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const exportMenu = useMenu<HTMLDivElement>();
  const themeMenu = useMenu<HTMLDivElement>();
  const settingsMenu = useMenu<HTMLDivElement>();
  const issuesMenu = useMenu<HTMLDivElement>();
  const projectMenu = useMenu<HTMLDivElement>();

  /*
    Snapshot history is music_client's `useProjectSnapshots`, shared with the
    native app: listing, create (flushing first), publish, rename and open, each
    rule of which is a bug somebody hit. What stays here is this app's half —
    which store, how a score from outside is adopted, and when to look.

    The context is the auth provider's (`useMusicHookContext`): its token is
    read per request, never captured, since a token held from render goes stale
    an hour into a session.
  */
  const hookContext = useMusicHookContext();
  const [createSnapshotOpen, setCreateSnapshotOpen] = useState(false);
  const [openSnapshotOpen, setOpenSnapshotOpen] = useState(false);
  const [managePublishedOpen, setManagePublishedOpen] = useState(false);
  /**
   * Nothing is asked of the server until the project menu first opens: an
   * editor nobody asks about its history should not fetch it on every load.
   * Once asked, each opening re-reads, as the menu always did.
   */
  const [snapshotsWanted, setSnapshotsWanted] = useState(false);
  const history = useProjectSnapshots(hookContext, snapshotsWanted ? projectId : null, {
    // Through the autosaver rather than a PUT of its own: `saveNow` is a no-op
    // when nothing is dirty, and without the flush a snapshot pins whatever the
    // server last received rather than what is on screen — which for a freshly
    // generated score is nothing at all.
    flush: () => store.getState().saveNow(),
    // A snapshot's score arrives around the edit lock, so the transport stops
    // before it lands, and the new server stamp is recorded so the generation
    // poll does not read this client's own write as somebody else's.
    onAdopt: (adopted, project) =>
      adoptOutsideScore(store, adopted, playbackController, {
        serverUpdatedAt: project.updatedAt,
      }),
    noteServerVersion: (updatedAt) => store.getState().noteServerVersion(updatedAt),
  });
  const snapshots = history.snapshots ?? [];

  const [creatingSnapshot, runCreateSnapshot] = usePendingAction();
  const [openingSnapshot, runOpenSnapshot] = usePendingAction();
  const [savingNow, runSaveNow] = usePendingAction();

  /** The dialog stays open, its Create spinning, until the snapshot exists. */
  const createSnapshot = (name: string, publisher?: string, publicName?: string) =>
    runCreateSnapshot(async () => {
      try {
        const snapshot = await history.create({
          name,
          ...(publisher && publicName ? { publish: { publisherName: publisher, publicName } } : {}),
        });
        setCreateSnapshotOpen(false);
        if (snapshot?.publicId) {
          store.getState().pushToast({
            message: t('snapshot.publishedAt', {
              url: publishedSnapshotUrl(window.location.origin, lang, snapshot.publicId),
            }),
            severity: 'success',
          });
        }
      } catch (err) {
        reportError(err, { context: t('errors.createSnapshot'), store });
      }
    });

  const openSnapshot = (snapshotId: string) =>
    runOpenSnapshot(async () => {
      try {
        await history.open(snapshotId);
        setOpenSnapshotOpen(false);
      } catch (err) {
        reportError(err, { context: t('errors.openSnapshot'), store });
      }
    });

  // A device pref, not component state: remembered across reloads by the
  // binding `App.tsx` installs, and expanded until somebody collapses it.
  const keyboardCollapsed = store((s) => s.keyboardCollapsed);
  /*
    The keyboard's height: half of the room the score and the keyboard share —
    the editor less its toolbar, the transport and any status strip — up to
    160 (music_drawing's `keyboardPanelHeight`, which the native app uses too).
    On a window short enough for half to be less, the two are the same height.

    That room is the score's measured height plus the keyboard's as drawn when
    it was measured, so a new keyboard height changes how the room is split and
    never the room: one resize settles it. The drawn height is a ref, read by
    the measurement callback, not state.
  */
  const [sharedHeight, setSharedHeight] = useState<number | null>(null);
  const keyboardHeight =
    sharedHeight === null ? KEYBOARD_MAX_HEIGHT : keyboardPanelHeight(sharedHeight);
  const drawnKeyboardHeight = useRef(0);
  drawnKeyboardHeight.current = keyboardCollapsed ? 0 : keyboardHeight;
  const onScoreHeight = useCallback((height: number) => {
    const shared = height + drawnKeyboardHeight.current;
    setSharedHeight((previous) => (previous === shared ? previous : shared));
  }, []);
  // The spatial view has no toolbar of its own, so its whole box is the score's.
  const spatialBoxRef = useRef<HTMLDivElement | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  /**
   * The "Spatial" 3D view, in place of the notation canvas — a view toggle
   * local to this component, same as `inspectorOpen`, not a device pref.
   *
   * `unpluggedActive` (the store flag `bind-player.ts` reads to decide
   * whether to mix through the stage arrangement) tracks this rather than
   * being a separate on/off a reader has to keep in sync — Spatial view
   * showing *is* what "unplugged mixing" means now, same as it was for the
   * old Unplugged tab this replaced.
   */
  const [spatialActive, setSpatialActive] = useState(false);
  useEffect(() => {
    store.getState().setUnpluggedActive(spatialActive);
    // Also covers leaving the editor entirely with Spatial view still on —
    // the same safety net the old Unplugged tab's own mount/unmount effect
    // gave: never leave the flag true with nothing left to show it.
    return () => store.getState().setUnpluggedActive(false);
  }, [store, spatialActive]);
  useEffect(() => {
    const el = spatialBoxRef.current;
    if (!spatialActive || !el || typeof ResizeObserver === 'undefined') return;
    onScoreHeight(el.clientHeight);
    const observer = new ResizeObserver(() => onScoreHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [spatialActive, onScoreHeight]);

  const hiddenCount = hiddenTrackCount(store);
  /**
   * The export waiting on the user's answer, or null when nothing is pending.
   * Held as the format rather than a callback: `planExport` rebuilds everything
   * else from it once the scope is known.
   */
  const [pendingExport, setPendingExport] = useState<ExportFormatId | null>(null);
  const [pendingModule, setPendingModule] = useState<null | {
    format: WritableTrackerFormat;
    report: TrackerFitReport;
    write: () => Promise<void>;
  }>(null);
  /*
    An export can take seconds — audio is rendered through the soundfont
    first — so the Export button spins until the file is written, and the
    scope and tracker-fit dialogs stay open with their chosen button spinning
    rather than closing on a click whose result has not happened yet.
  */
  const [exporting, runExport] = usePendingAction();
  const [exportScopeChosen, setExportScopeChosen] = useState<ExportScope | null>(null);

  const errorIssues = validationIssues.filter((i) => i.severity === 'error');

  /**
   * Clears every issue that has an unambiguous repair, in one undoable step.
   *
   * The toast reports what actually left the list rather than what was
   * attempted: several rules (how many notes sound at once, most obviously)
   * have no repair that isn't a guess about the music, and saying "fixed
   * everything" over a list that still has entries in it would be a lie the
   * reader can see.
   */
  const handleFixIssues = (): void => {
    const outcome = repairIssuesOutcome(repairAllIssues(store, t('editor.fixIssues')));
    store
      .getState()
      .pushToast({ message: t(outcome.messageKey, outcome.params), severity: outcome.severity });
    if (outcome.close) issuesMenu.setOpen(false);
  };

  const commitTitle = (): void => {
    if (titleDraft !== null && titleDraft.trim() !== '' && titleDraft !== projectName) {
      store.getState().renameProject(titleDraft.trim());
    }
    setTitleDraft(null);
  };

  /**
   * Writes one planned export.
   *
   * Which formats exist, their extensions and which score a scope means are
   * music_lib's (`planExport`), shared with the native app. What stays here
   * is what that package may not reach: the file name (music_codecs'
   * keep-the-title rule), rendering audio (music_player), fitting a tracker
   * module (music_lib) and the write (music_io).
   *
   * Audio renders through the soundfont playback uses, so the file is a
   * recording of what was just heard; music_player hands back PCM and music_io
   * encodes it, so neither platform package depends on the other.
   *
   * A tracker module's fit runs after the scope, because exporting visible
   * tracks only may bring a score within a channel limit all tracks exceed —
   * and a clean fit must not cost a click.
   *
   * The project file is music_codecs' `.moo` document — the shape the native
   * app writes and reads — carrying the project's name as its title, so
   * importing it back names the project what it was. The web's old
   * `{ name, schemaVersion, score }` `.json` is still read on import.
   */
  const writeExport = async (plan: ExportPlan): Promise<void> => {
    const { io } = getAppServices();
    const filename = exportFilename(plan.title, plan.extension);
    try {
      switch (plan.route) {
        case 'notation':
          if (plan.format === 'midi') await io.saveMidi(plan.target, filename);
          else await io.saveMusicXml(plan.target, filename);
          return;
        case 'audio': {
          const audio = await renderScoreAudio(plan.target, SOUNDFONT_ASSETS);
          await io.saveAudio(
            audio.samples,
            audio.sampleRate,
            plan.format as 'wav' | 'mp3',
            filename,
          );
          return;
        }
        case 'tracker': {
          const format = plan.format as WritableTrackerFormat;
          const { module, report } = scoreToTracker(plan.target, { format });
          const write = async (): Promise<void> => {
            await io.saveTracker(module, filename);
          };
          if (isCleanFit(report)) {
            await write();
            return;
          }
          setPendingModule({ format, report, write });
          return;
        }
        case 'project': {
          await io.fileExporter.save(
            filename,
            serializeProjectFile({
              title: store.getState().projectName || plan.title,
              score: plan.target,
            }),
            'application/json',
          );
          return;
        }
      }
    } catch (err) {
      reportError(err, { context: t(EXPORT_ERROR_KEY[plan.format]), store });
    }
  };

  /**
   * Exports `format`, asking which tracks first only when the two answers
   * actually differ. A project file never asks: it is the document, and hiding
   * a track is a view preference, not a reason to drop a part from it.
   */
  const handleExport = (format: ExportFormatId): void => {
    exportMenu.setOpen(false);
    const route = WRITABLE_EXPORT_FORMATS.find((f) => f.id === format)?.route;
    if (route === 'project' || !exportScopeNeedsPrompt(store)) {
      const plan = planExport(store, format, 'all');
      if (plan) void runExport(() => writeExport(plan));
      return;
    }
    setPendingExport(format);
  };

  const navigateToIssue = (issue: ValidationIssue): void => {
    const score = store.getState().score;
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
            <ChevronLeftIcon className={ICON_GLYPH_CLASS} />
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
              className="rounded-md border-none bg-transparent px-1 py-0.5 text-lg font-medium text-inherit hover:bg-primary-foreground/10"
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
              aria-busy={savingNow || undefined}
              disabled={savingNow}
              onClick={() => void runSaveNow(() => store.getState().saveNow())}
              className={ICON_BUTTON_CLASS}
            >
              {savingNow ? <ButtonSpinner /> : <ArrowDownTrayIcon className={ICON_GLYPH_CLASS} />}
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
              disabled={!canUndo || generating}
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
              disabled={!canRedo || generating}
              onClick={() => store.getState().redo()}
              className={ICON_BUTTON_CLASS}
            >
              <ArrowUturnRightIcon className={ICON_GLYPH_CLASS} />
            </button>
          </Tooltip>

          <div ref={projectMenu.ref} className="relative">
            <Tooltip placement="bottom" content={t('editor.snapshotMenuLabel')}>
              <button
                type="button"
                aria-label={t('editor.projectMenu')}
                aria-haspopup="menu"
                aria-expanded={projectMenu.open}
                onClick={() => {
                  projectMenu.setOpen((v) => !v);
                  setSnapshotsWanted(true);
                  void history.refresh();
                }}
                className={ICON_BUTTON_CLASS}
              >
                <CameraIcon className={ICON_GLYPH_CLASS} />
              </button>
            </Tooltip>
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
                  disabled={!hasScore}
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
                  disabled={!hasScore}
                  className={MENU_ITEM_CLASS}
                >
                  {t('editor.openSnapshot')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  role="menuitem"
                  onClick={() => {
                    projectMenu.setOpen(false);
                    setManagePublishedOpen(true);
                  }}
                  disabled={!hasScore}
                  className={MENU_ITEM_CLASS}
                >
                  {t('editor.managePublished')}
                </Button>
              </div>
            )}
          </div>

          <Tooltip placement="bottom" content={t('editor.print')}>
            <button
              type="button"
              aria-label={t('editor.print')}
              disabled={!hasScore}
              onClick={() => onNavigate?.(`/project/${store.getState().projectId ?? ''}/print`)}
              className={ICON_BUTTON_CLASS}
            >
              <PrinterIcon className={ICON_GLYPH_CLASS} />
            </button>
          </Tooltip>

          <div ref={exportMenu.ref} className="relative">
            <Tooltip placement="bottom" content={t('editor.export')}>
              <button
                type="button"
                aria-label={t('editor.exportMenu')}
                aria-haspopup="menu"
                aria-expanded={exportMenu.open}
                aria-busy={exporting || undefined}
                disabled={exporting}
                onClick={() => exportMenu.setOpen((v) => !v)}
                className={ICON_BUTTON_CLASS}
              >
                {exporting ? (
                  <ButtonSpinner />
                ) : (
                  <DocumentArrowDownIcon className={ICON_GLYPH_CLASS} />
                )}
              </button>
            </Tooltip>
            {exportMenu.open && (
              <div role="menu" className={`left-0 ${MENU_CLASS}`}>
                {/* music_types' format list, in its order, so the menu and
                    the documentation's export table cannot disagree. */}
                {WRITABLE_EXPORT_FORMATS.map((format) => (
                  <Button
                    key={format.id}
                    type="button"
                    variant="ghost"
                    role="menuitem"
                    onClick={() => handleExport(format.id)}
                    disabled={!hasScore}
                    className={MENU_ITEM_CLASS}
                  >
                    {t(format.labelKey)}
                  </Button>
                ))}
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
                {THEME_MODE_OPTIONS.map(({ value: mode, labelKey }) => (
                  <Button
                    key={mode}
                    type="button"
                    variant="ghost"
                    role="menuitem"
                    onClick={() => {
                      store.getState().setThemeMode(mode);
                      themeMenu.setOpen(false);
                    }}
                    className={cn(
                      MENU_ITEM_CLASS,
                      themeMode === mode && 'bg-accent text-accent-foreground',
                    )}
                  >
                    {t(labelKey)}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/*
            The documentation, in a NEW TAB.
            The editor hides the top bar, so the docs are otherwise
            unreachable from the one place a reader most wants them — mid-edit,
            wondering which key does what. A new tab rather than navigation
            because leaving the editor would mean leaving the score you are
            working on. `rel` is not optional on a target-blank link: without
            it the opened page gets a live handle on this one.
          */}
          <Tooltip placement="bottom" content={t('nav.docs')}>
            <a
              href={`/${lang}/docs`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('editor.openDocs')}
              className={ICON_BUTTON_CLASS}
            >
              <BookOpenIcon className={ICON_GLYPH_CLASS} />
            </a>
          </Tooltip>

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
                    className="h-4 w-4 accent-primary"
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
        Everything below the app bar is one region. While a job owns the
        project a status strip sits above the transport rather than a cover
        over all of it: the notes stream into the sheet as they are written,
        and the sheet is what the reader opened the project to watch. What
        must not happen meanwhile — an edit, a play — is refused by the store's
        lock, the read-only sheet and the disabled Play, not by hiding them.
      */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 min-h-0">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* The inspector toggle lives on the editor toolbar. It used to sit on
              a strip of its own alongside a track-panel toggle; with that gone
              the strip was a blank row holding one button. */}
            <div ref={spatialBoxRef} className="min-h-0 flex-1">
              {spatialActive && hasScore ? (
                <SpatialSection store={store} />
              ) : (
                <ScoreEditorView
                  store={store}
                  // Read-only while a job writes the score: the notes arrive
                  // live and are worth watching, but not touching.
                  readOnly={generating}
                  inspectorOpen={inspectorOpen}
                  onToggleInspector={() => setInspectorOpen((v) => !v)}
                  // The same runner the Replace buttons use, so adding a track
                  // behaves like every other generation: the overlay appears, the
                  // project is locked server-side, and leaving is safe.
                  onGenerateTrackJob={(request) => startJob('generate-track', request)}
                  onGenerateInsertedBars={generateInsertedBars}
                  onVoiceTranscriptionJob={(projectId, cancel, progress) =>
                    setVoiceJob(projectId ? { cancel, progress: progress ?? null } : null)
                  }
                  onViewportHeight={onScoreHeight}
                />
              )}
            </div>
          </div>

          {inspectorOpen && (
            <div
              className="flex shrink-0 flex-col overflow-y-auto overscroll-contain border-l border-border"
              style={{ width: SIDE_PANEL_WIDTH }}
            >
              {/* The generation panels are gone: whole-score generation moved
                to the dashboard, and region regeneration is now the
                Inspector's three Replace buttons, each submitting a job. */}
              <div className="shrink-0">
                <InspectorPanel
                  store={store}
                  onReplace={(scope, submission) => startReplacement(scope, submission)}
                  origin={projectId ? { origin: projectOrigin, projectId } : undefined}
                  generation={
                    lastGeneration
                      ? {
                          record: lastGeneration,
                          // Also while another job is being started, so a
                          // Replace in flight cannot be raced by this one.
                          generating: generation.generating || startingJob,
                          // The same request, with only the locked choices kept
                          // and everything else rolled again by the server.
                          onGenerateAgain: (lockedKeys) =>
                            startJob(
                              'generate-score',
                              regenerateWithLocks(lastGeneration, lockedKeys),
                            ),
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          )}
        </div>

        {/* Pinned bottom bars, outside the scrolling score region so neither
          scrolls away with the sheet.

          The transport sits directly under the sheet and above the keyboard.
          The keyboard is the one panel here that changes height — it collapses,
          and it is optional — so with it in between, opening or closing it moved
          the transport, which is the row a reader's hand goes to without
          looking. Fixed rows first, the variable one last. */}
        {(generating || voiceJob) && (
          <GenerationStatusStrip
            status={voiceJob && !generating ? 'transcribing' : generation.status}
            onCancel={() =>
              voiceJob && !generating ? voiceJob.cancel() : void generation.cancel()
            }
            progress={voiceJob && !generating ? voiceJob.progress : generation.progress}
            live={generation.live}
            error={generation.error}
          />
        )}

        <TransportBar
          store={store}
          playDisabled={generating}
          keyboardCollapsed={keyboardCollapsed}
          onToggleKeyboard={() => store.getState().setKeyboardCollapsed(!keyboardCollapsed)}
          spatialActive={spatialActive}
          onToggleSpatial={() => setSpatialActive((v) => !v)}
        />

        {/* Full-width piano keyboard: a sibling of the transport rather than a
          child of the centre column, so it spans the whole window beneath the
          track and inspector panels. Fixed height and its own horizontal scroll
          when the window is too narrow for its keys. Its height is
          `keyboardHeight`, above.

          Collapsed, it renders nothing at all — the control that brings it back
          is on the transport bar above, so there is no header row left down here
          that has to survive in order to stay reachable. */}
        {keyboardCollapsed ? null : (
          <div
            className="shrink-0 overflow-hidden border-t border-border"
            style={{ height: keyboardHeight }}
          >
            <div className="flex h-full min-h-0">
              <div className="min-w-0 flex-1">
                <PianoKeyboardView store={store} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        role="status"
        aria-label={t('editor.statusBar')}
        className="flex items-center gap-4 border-t border-border px-4 py-1"
      >
        <span className="text-xs text-muted-foreground">
          {selectionSummaryLabel(selection, libraryCopy.selection(), selectionRegenerated)}
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
              className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                errorIssues.length > 0
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-warning text-warning-foreground'
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
                  <p className="p-1 text-sm text-muted-foreground">{t('editor.noIssues')}</p>
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
                    className="cursor-pointer rounded p-1 hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                  >
                    <span
                      className={`mr-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        issue.severity === 'error'
                          ? 'bg-destructive text-destructive-foreground'
                          : 'bg-warning text-warning-foreground'
                      }`}
                    >
                      {issue.severity}
                    </span>
                    <span className="text-sm text-foreground">{issue.message}</span>
                  </div>
                ))}
              </div>
              {/*
                Pinned under the list rather than above it: the reader scrolls
                the issues, decides, and the action is where their eye ends up.
                Disabled while playing because the repair is a content edit and
                `dispatchCommand` would refuse it anyway — better to show that
                than to offer a button that silently does nothing.
              */}
              {validationIssues.length > 0 && (
                <div className="sticky bottom-0 mt-1 border-t border-border bg-card p-1">
                  <Button
                    type="button"
                    variant="primary"
                    className="w-full justify-center px-2 py-1 text-xs"
                    title={t('editor.fixIssuesTitle')}
                    // A repair is an edit, refused while the transport plays
                    // and while a job owns the project. Disabled for both,
                    // so the button never looks live and does nothing.
                    disabled={playbackState === 'playing' || generating}
                    onClick={handleFixIssues}
                  >
                    {t('editor.fixIssues')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Toasts store={store} />

      <CreateSnapshotDialog
        open={createSnapshotOpen}
        snapshotCount={snapshots.length}
        projectName={projectName}
        {...(history.defaultPublisherName
          ? { defaultPublisherName: history.defaultPublisherName }
          : {})}
        onCreate={(name, publisher, publicName) => void createSnapshot(name, publisher, publicName)}
        creating={creatingSnapshot}
        onClose={() => setCreateSnapshotOpen(false)}
      />

      <ManagePublishedDialog
        open={managePublishedOpen}
        snapshots={snapshots}
        onRename={(id, publicName) =>
          history.rename(id, publicName).then(
            () => undefined,
            (err: unknown) => {
              reportError(err, { context: t('errors.renamePublished'), store });
            },
          )
        }
        onClose={() => setManagePublishedOpen(false)}
      />

      <OpenSnapshotDialog
        open={openSnapshotOpen}
        nodes={history.nodes}
        onOpen={(id) => void openSnapshot(id)}
        opening={openingSnapshot}
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
        busy={exportScopeChosen}
        onChoose={(scope) => {
          if (exporting) return;
          const format = pendingExport;
          const plan = format ? planExport(store, format, scope) : null;
          if (!plan) {
            setPendingExport(null);
            return;
          }
          setExportScopeChosen(scope);
          void runExport(() => writeExport(plan)).finally(() => {
            setExportScopeChosen(null);
            setPendingExport(null);
          });
        }}
        onCancel={() => setPendingExport(null)}
      />
      {pendingModule && (
        <TrackerFitDialog
          open
          format={pendingModule.format.toUpperCase()}
          report={pendingModule.report}
          busy={exporting}
          onCancel={() => setPendingModule(null)}
          onConfirm={() => {
            if (exporting) return;
            const pending = pendingModule;
            void runExport(() =>
              pending.write().catch((err) => {
                reportError(err, { context: t('errors.moduleExport'), store });
              }),
            ).finally(() => setPendingModule(null));
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
