/**
 * Project dashboard (spec §19), server-backed: a searchable/sortable grid of
 * the signed-in user's projects (from music_api via MusicClient), and three
 * ways to start one — **New Project**, **New from Template** and **Import** —
 * plus duplicate/delete (delete confirmed).
 *
 * Opening or creating a project loads it into the shared app-wide store
 * (`openProject`/`newProject`) and then calls `onNavigate`.
 *
 * **Three controls, where there were seven.** "New Project" and "Generate
 * Score" were one decision asked twice — they differ only in whether a prompt
 * is sent — and are now the one `NewProjectDialog` with a Generate-for-me
 * toggle. The five import buttons were one decision (which file) spread across
 * five controls that differed by a word, and are now one `Select` used as a
 * menu: held at `value=""` so its trigger goes on reading "Import" rather than
 * becoming the last format chosen. Each item opens the dialog its button
 * opened; none of those dialogs changed.
 *
 * **The templates moved behind a button too.** Twelve cards sat permanently
 * between the toolbar and the project list, above the projects somebody came
 * to open, and pushed the list below the fold once a few existed. Starting from
 * a template is a *way of starting a project*, so it belongs beside the other
 * two rather than occupying the page — see `TemplatePickerDialog`. The score is
 * still built here, from music_lib's list; the dialog only reports which id was
 * chosen.
 *
 * The toolbar is two rows on purpose. Search and sort are the first, as one
 * `flex-nowrap` line that cannot come apart — search takes whatever width is
 * left, so sort sits hard against the page's right edge — and the three ways to
 * start a project are the second, in the order you reach for them: New Project,
 * New from Template, Import. One row of five controls wrapped unpredictably,
 * which is how the sort select ended up on a line of its own. There is no page
 * heading: the top bar already names the app, and a second copy of the name
 * only took width from the search field.
 *
 * Adopts `@sudobility/components` controls (library sweep 2): the sort and
 * import `<select>`s are the library's Radix-backed `Select`; the search field
 * is the library `Input` (not `SearchInput`: it has no top-level `aria-label`
 * prop, and its built-in icon/clear affordances aren't part of this toolbar's
 * design); every button, including the card actions, is the library `Button`.
 */
import { reportGenerationError } from '@/features/credits/report-generation-error';
import { libraryCopy } from '@/i18n/library-copy';
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  cn,
} from '@sudobility/components';
import { EmptyState } from '@sudobility/building_blocks';
import { variants } from '@sudobility/design';
import type { ProjectSummary } from '@sudobility/music_types';
import { ProjectFileError, parseProjectFile } from '@sudobility/music_codecs';
import { DOCUMENT_EXTENSIONS } from '@sudobility/music_types';
import {
  createGeneratedProject,
  musicQueryKeys,
  useCancelProjectGeneration,
  useDeleteProject,
  useDuplicateProject,
  useProjects,
  useTranscriptionCapability,
} from '@sudobility/music_client';
import { playbackController, projectTemplates, reportError, useAppStore } from '@/app-library';
import type { EditorStoreApi } from '@/app-library';
import { getAppServices } from '@/config/initialize';
import { useMusicHookContext } from '@/app/AuthContext';
import { NewProjectDialog } from '@/features/projects/NewProjectDialog';
import { TemplatePickerDialog } from '@/features/projects/TemplatePickerDialog';
import type { NewProjectSubmission } from '@/app-library';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { MidiImportWizard } from '@/components/dialogs/MidiImportWizard';
import { MusicXmlImportDialog } from '@/components/dialogs/MusicXmlImportDialog';
import { AudioImportDialog } from '@/components/dialogs/AudioImportDialog';
import { FileImportModal } from '@/components/dialogs/FileImportModal';

export type DashboardPageProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore({ context })`. */
  store?: EditorStoreApi;
  /** Called with `/project/:id` after opening/creating/importing a project. Defaults to a no-op; `router.tsx` wires this to `useNavigate()`. */
  onNavigate?: (path: string) => void;
};

type SortBy = 'name' | 'updatedAt';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

/**
 * The MusicClient and a token, for the two calls that are not hooks: creating a
 * generated project (a sequence with a rollback, see `createGeneratedProject`)
 * and uploading a recording.
 */
async function clientAndToken() {
  const { musicClient } = getAppServices();
  const token = await getAppServices().auth.getToken();
  // Surfaces through `reportError`'s toast, so it is user-facing copy.
  if (!token) throw new Error(i18n.t('errors.mustSignIn'));
  return { client: musicClient, token };
}

function resetOpenedProjectTransport(): void {
  playbackController.stop();
}

/**
 * One height for every control in the toolbar row.
 *
 * The library `Button` sizes itself from its own padding, a `SelectTrigger`
 * from its text, and the file-picker `<label>` from whatever padding it is
 * handed — so the row came out visibly ragged, with the sort select and
 * "Import Project JSON" shorter than the buttons beside them. Stating the
 * height once and centring within it is what makes them agree; padding cannot,
 * because it is the content that differs.
 */
const ROW_CONTROL_CLASS = 'h-10 min-h-10 inline-flex items-center text-sm';

const TEXT_INPUT_CLASS = `${ROW_CONTROL_CLASS} px-3`;

const SELECT_TRIGGER_CLASS = `${ROW_CONTROL_CLASS} w-auto px-3`;

/** Buttons and the file-picker labels that have to pass for buttons. */
const ROW_BUTTON_CLASS = `${ROW_CONTROL_CLASS} justify-center px-3`;

const CARD_CLASS = cn(variants.card.default.base(), 'flex flex-col overflow-hidden rounded-md');

/**
 * What the Import menu offers.
 *
 * A closed vocabulary declared as an array with the type read off it, so the
 * dispatcher below fails to compile when a format is added without a home —
 * the same shape every closed list in this family uses.
 */
const IMPORT_KINDS = ['midi', 'musicxml', 'audio', 'module', 'project'] as const;
type ImportKind = (typeof IMPORT_KINDS)[number];

/** The label each one shows. A `Record`, so a new kind cannot ship unlabelled. */
const IMPORT_LABEL_KEYS: Record<ImportKind, string> = {
  midi: 'dashboard.importMidi',
  musicxml: 'dashboard.importMusicXml',
  audio: 'dashboard.importAudio',
  module: 'dashboard.importModule',
  project: 'dashboard.importProject',
};

/**
 * The subtext each one shows, under its label.
 *
 * Reuses the in-app documentation's own `docs.formats.in.*` table (the
 * "Formats it reads" screen) rather than a second set of strings — the same
 * sentence explaining what a MIDI or MusicXML import keeps is one fact, not
 * two that agree until an edit misses one of them. That table's key is
 * `tracker`, not `module`; the two names are this app's own naming for the
 * same format in two different places.
 */
const IMPORT_DESCRIPTION_KEYS: Record<ImportKind, string> = {
  midi: 'docs.formats.in.midi',
  musicxml: 'docs.formats.in.musicxml',
  audio: 'docs.formats.in.audio',
  module: 'docs.formats.in.tracker',
  project: 'docs.formats.in.project',
};

export function DashboardPage({ store = useAppStore, onNavigate }: DashboardPageProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updatedAt');
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [midiImportOpen, setMidiImportOpen] = useState(false);
  const [musicXmlImportOpen, setMusicXmlImportOpen] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [modImportOpen, setModImportOpen] = useState(false);
  const [modBusy, setModBusy] = useState(false);
  const [modError, setModError] = useState<string | null>(null);
  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [jsonBusy, setJsonBusy] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);

  /*
    The list is music_client's `useProjects`, shared with the native dashboard.
    It polls while any row is still being worked on server-side and stops the
    moment none is — a dashboard that refetched forever would keep a request
    loop alive for the whole session, and one that never did would leave a
    finished generation showing its badge until a reload.
  */
  const hookContext = useMusicHookContext();
  const queryClient = useQueryClient();
  const projectsQuery = useProjects(hookContext, { sort: sortBy }, { pollWhileGenerating: true });
  const projects = projectsQuery.data ?? [];
  const loaded = projectsQuery.isFetched;
  const loadError = projectsQuery.error;
  useEffect(() => {
    if (loadError) reportError(loadError, { context: t('errors.loadProjects'), store });
  }, [loadError, store, t]);

  /** Marks the list stale, for writes that did not go through a list hook. */
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: musicQueryKeys.projects.all }),
    [queryClient],
  );

  const duplicateProject = useDuplicateProject(hookContext);
  const deleteProject = useDeleteProject(hookContext);
  const cancelProjectGeneration = useCancelProjectGeneration(hookContext);

  /*
    Whether this deployment can transcribe audio at all, probed while the
    Import Audio dialog is open rather than discovered by failing: uploading a
    recording and only then being told the server never could is the worst
    order to learn it in. The context is withheld while the dialog is shut, so
    each opening asks again (a deployment can gain or lose its credentials while
    a tab stays open) and the dashboard itself asks nothing. `null` while
    unknown, which leaves the option enabled.
  */
  const [audioImportOpen, setAudioImportOpen] = useState(false);
  const { available: canTranscribe } = useTranscriptionCapability(
    audioImportOpen ? hookContext : null,
  );

  const cancelGeneration = async (projectId: string): Promise<void> => {
    try {
      // The job id is not on the summary; the project's running job is the
      // only one it can have, so the server resolves it from the project.
      await cancelProjectGeneration.mutateAsync(projectId);
    } catch (err) {
      reportError(err, { context: t('errors.cancelGeneration'), store });
    }
  };

  /**
   * Creates the project immediately, then starts a job against it: it shows up
   * in this list with its badge from the first second rather than materialising
   * minutes later. The sequence — and deleting the project again when the job
   * is refused, so a user with no credits does not collect an empty row per
   * attempt — is music_client's `createGeneratedProject`.
   */
  const startWholeScoreGeneration = async (
    submission: Extract<NewProjectSubmission, { kind: 'generate' }>,
  ): Promise<void> => {
    setCreatingProject(true);
    try {
      const { client, token } = await clientAndToken();
      // The dialog chooses the backend; the developer setting fills in when it
      // did not.
      const project = await createGeneratedProject(client, token, submission, {
        variant: store.getState().devSettings.generationVariant,
      });
      setNewProjectOpen(false);
      /*
        Straight into the project, as New Project does. The job streams each
        part into the editor as it is written, so the place to wait is in
        front of the score rather than on a card with a badge. No `refresh()`
        first, for the reason the other branch gives: nobody is about to look
        at this list.
      */
      onNavigate?.(`/project/${project.id}`);
    } catch (err) {
      // A refusal for want of credits opens the store; everything else is a
      // toast. The dialog closes either way — behind the paywall, an open
      // Generate form is one more thing in the way of buying.
      setNewProjectOpen(false);
      reportGenerationError(err, { context: t('errors.startGeneration'), store });
    } finally {
      setCreatingProject(false);
    }
  };

  const filtered = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  /**
   * Open a project by GOING to it, not by fetching it first.
   *
   * This used to await the whole project — the score JSON, and the parse of
   * it — and navigate afterwards, so the wait happened on the screen you were
   * leaving, with nothing on it to say anything was happening. The editor
   * route already opens a project it does not have (that is what a pasted URL
   * or a page reload does), so awaiting here only made that check pass: the
   * work is the same, and this decides which screen you spend it on.
   *
   * Nothing to catch, either. A failed open is reported by the editor route,
   * which sends you back here — where an error on a dashboard you are standing
   * on makes sense, rather than one on a dashboard you were trying to leave.
   */
  const openProject = (id: string): void => {
    onNavigate?.(`/project/${id}`);
  };

  /**
   * Turns what the modal asked for into a project.
   *
   * The modal reports the *decision*; where it lands is this page's business,
   * which is what lets the same form back a local document on the native side.
   */
  const handleNewProject = async (submission: NewProjectSubmission): Promise<void> => {
    if (submission.kind === 'generate') {
      await startWholeScoreGeneration(submission);
      return;
    }
    setCreatingProject(true);
    try {
      await store.getState().newProject({
        name: submission.title,
        score: submission.score,
        origin: { kind: 'blank' },
      });
      const id = store.getState().projectId;
      resetOpenedProjectTransport();
      setNewProjectOpen(false);
      /*
        Deliberately no `refresh()` here, unlike the generate branch above.

        That branch stays on the dashboard, so the list has to pick up the new
        row. This one navigates away from it — refetching a list nobody is about
        to look at only delays the navigation, and it does so on the slowest
        call the page makes. It is what put the New Project flow over
        Playwright's expect timeout under load.
      */
      if (id) onNavigate?.(`/project/${id}`);
    } catch (err) {
      reportError(err, { context: t('errors.createProject'), store });
    } finally {
      setCreatingProject(false);
    }
  };

  /**
   * Opens the dialog for one format.
   *
   * Audio carries the capability probe its button used to own: uploading a
   * recording and only then being told the server never could is the worst
   * order to learn it in.
   */
  const openImport = (kind: ImportKind): void => {
    if (kind === 'midi') setMidiImportOpen(true);
    else if (kind === 'musicxml') setMusicXmlImportOpen(true);
    else if (kind === 'module') setModImportOpen(true);
    else if (kind === 'project') setJsonImportOpen(true);
    else {
      setAudioError(null);
      setAudioImportOpen(true);
    }
  };

  const handleCreateFromTemplate = async (templateId: string): Promise<void> => {
    const template = projectTemplates(libraryCopy.templates()).find((tpl) => tpl.id === templateId);
    if (!template) return;
    try {
      // A template is a starting point, not a source: it came from no file.
      await store.getState().newProject({
        name: template.name,
        score: template.build(),
        origin: { kind: 'blank' },
      });
      const id = store.getState().projectId;
      resetOpenedProjectTransport();
      if (id) onNavigate?.(`/project/${id}`);
    } catch (err) {
      reportError(err, { context: t('errors.createFromTemplate'), store });
    }
  };

  const handleDuplicate = async (project: ProjectSummary): Promise<void> => {
    try {
      // Server-side: the score is copied inside the database. Downloading it
      // to upload it again moved the whole thing twice for a copy nobody here
      // is going to look at.
      await duplicateProject.mutateAsync({ id: project.id });
    } catch (err) {
      reportError(err, { context: t('errors.duplicateProject'), store });
    }
  };

  const handleDelete = async (): Promise<void> => {
    const project = pendingDelete;
    setPendingDelete(null);
    if (!project) return;
    try {
      await deleteProject.mutateAsync(project.id);
    } catch (err) {
      reportError(err, { context: t('errors.deleteProject'), store });
    }
  };

  const handleImportJsonFile = async (file: File): Promise<void> => {
    setJsonError(null);
    setJsonBusy(true);
    try {
      /*
        Either shape a project file comes in — the `.moo` both apps now write,
        or this app's older `{ name, schemaVersion, score }` JSON export — read
        by music_codecs, which also refuses a file from a newer build rather
        than dropping what it cannot read. Signed in, an opened file becomes a
        server project, as every other import does.
      */
      const { title, score } = parseProjectFile(await file.text());
      // `newProject` creates it and adopts what it just sent. Creating through
      // the client and then opening the result meant uploading the score and
      // immediately downloading the same bytes back.
      await store.getState().newProject({
        name: title,
        score,
        origin: { kind: 'imported', format: 'project', fileName: file.name },
      });
      const id = store.getState().projectId;
      resetOpenedProjectTransport();
      setJsonImportOpen(false);
      void refresh();
      if (id) onNavigate?.(`/project/${id}`);
    } catch (err) {
      // Worded here from the reason, not the codec's English message.
      setJsonError(
        err instanceof ProjectFileError
          ? t(`dashboard.projectFileError.${err.reason}`)
          : err instanceof Error
            ? err.message
            : t('dashboard.projectFileError.notAProject'),
      );
      reportError(err, { context: t('errors.projectJsonImport'), store });
    } finally {
      setJsonBusy(false);
    }
  };

  /**
   * Imports a tracker module as a new project.
   *
   * One step, not a wizard: a `.MOD` states every note and every instrument
   * outright, so unlike MIDI or audio there is nothing to estimate and nothing
   * to confirm. A file that is not a module throws in the codec and surfaces as
   * a toast — a garbage score would look like it imported and quietly not be
   * the music.
   */
  const handleImportModFile = async (file: File): Promise<void> => {
    setModError(null);
    setModBusy(true);
    try {
      const bytes = await file.arrayBuffer();
      const { module: mod, score } = getAppServices().io.openTracker(bytes);
      await store.getState().newProject({
        name: mod.title || file.name,
        score,
        origin: { kind: 'imported', format: 'tracker', fileName: file.name },
      });
      const id = store.getState().projectId;
      resetOpenedProjectTransport();
      setModImportOpen(false);
      void refresh();
      if (id) onNavigate?.(`/project/${id}`);
    } catch (err) {
      setModError(
        err instanceof Error ? err.message : 'That file could not be read as a tracker module.',
      );
      reportError(err, { context: t('errors.moduleImport'), store });
    } finally {
      setModBusy(false);
    }
  };

  /**
   * Uploads the recording and opens the project it becomes.
   *
   * Nothing is decoded or analysed here: the file goes to the server, which
   * separates it and transcribes each part. The project comes back at once in
   * a `transcribing` state, and this goes straight to it — as a generation
   * does, and for the same reason. The editor watches the project's live
   * stream, where each part lands in the score as the transcriber finishes
   * it, under a strip that names the part being worked on; the place to wait
   * is in front of the score rather than on a card with a badge.
   */
  const handleAudioImport = (file: File): void => {
    void (async () => {
      setAudioBusy(true);
      setAudioError(null);
      try {
        const { client, token } = await clientAndToken();
        const project = await client.transcribeAudio(file, file.name, token);
        setAudioImportOpen(false);
        void refresh();
        onNavigate?.(`/project/${project.id}`);
      } catch (err) {
        setAudioError(err instanceof Error ? err.message : 'That recording could not be sent.');
        reportError(err, { context: t('errors.audioImport'), store });
      } finally {
        setAudioBusy(false);
      }
    })();
  };

  const renderCard = (project: ProjectSummary) => {
    // A busy project opens like any other: whether it is being generated or
    // transcribed, its notes stream into the editor as they are written, and
    // opening it is how you watch. The badge says which is happening.
    const statusLabel =
      project.status === 'transcribing'
        ? t('dashboard.transcribing')
        : project.status === 'generating'
          ? t('dashboard.generating')
          : null;
    return (
      <div key={project.id} className={CARD_CLASS}>
        <Button
          type="button"
          variant="ghost"
          aria-label={t('dashboard.openProject', { name: project.name })}
          onClick={() => openProject(project.id)}
          className="flex h-auto flex-1 flex-col items-start gap-1 rounded-none p-4 text-left"
        >
          <Text size="sm" weight="medium">
            {project.name}
          </Text>
          <span className="text-xs text-theme-text-secondary">
            {t('dashboard.updated', { date: formatDate(project.updatedAt) })}
          </span>
          {statusLabel ? (
            <span className="rounded-full bg-info px-2 py-0.5 text-xs text-info-foreground">
              {statusLabel}
            </span>
          ) : null}
        </Button>
        <div className="flex gap-1 border-t border-theme-border p-2">
          {project.status === 'generating' && (
            <Button
              type="button"
              variant="ghost"
              aria-label={t('dashboard.cancelGenerationFor', { name: project.name })}
              onClick={() => void cancelGeneration(project.id)}
              className="px-3 py-1"
            >
              {t('dashboard.cancelGeneration')}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            aria-label={t('dashboard.duplicateProject', { name: project.name })}
            onClick={() => void handleDuplicate(project)}
            className="px-3 py-1"
          >
            {t('dashboard.duplicate')}
          </Button>
          {/* `variant="ghost"` + an explicit className override, not
            `variant="destructive-outline"`: see `DeveloperSettingsDialog`'s
            "Reset local database" button doc comment -- that CVA enum
            value has no matching `@sudobility/design` entry, so `Button`
            would silently fall back to its primary skin. */}
          <Button
            type="button"
            variant="ghost"
            aria-label={t('dashboard.deleteProject', { name: project.name })}
            onClick={() => setPendingDelete(project)}
            className={cn(variants.button.destructive.outline(), 'border-transparent px-3 py-1')}
          >
            {t('common.delete')}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6">
      {/*
        Search and sort are one row and never come apart: `flex-nowrap` keeps
        them on a line together however narrow the window gets, and the search
        field is what gives (`min-w-0`, since a flex item's default
        `min-width: auto` refuses to shrink below its content and is what pushes
        a neighbour onto the next row). Search takes the whole width left over,
        so sort ends up hard against the right edge of the page.

        There is no page heading above it: the top bar already names the app, and
        a second "Moosiac" only took width away from the field.
      */}
      <div className="flex min-w-0 flex-nowrap items-center gap-2">
        <Input
          type="text"
          aria-label={t('dashboard.searchProjects')}
          placeholder={t('dashboard.searchProjects')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cn(TEXT_INPUT_CLASS, 'min-w-0 flex-1')}
        />

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
          <SelectTrigger
            aria-label={t('dashboard.sortProjects')}
            className={cn(SELECT_TRIGGER_CLASS, 'shrink-0')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updatedAt">{t('dashboard.sortUpdated')}</SelectItem>
            <SelectItem value="name">{t('dashboard.sortName')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* The actions get a row of their own, so the search/sort pair above can
          keep the full width it needs on a narrow window. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="primary"
          aria-label={t('dashboard.newProject')}
          onClick={() => setNewProjectOpen(true)}
          className={ROW_BUTTON_CLASS}
        >
          {t('dashboard.newProject')}
        </Button>

        <Button
          type="button"
          variant="outline"
          aria-label={t('dashboard.newFromTemplateAction')}
          onClick={() => setTemplatesOpen(true)}
          className={ROW_BUTTON_CLASS}
        >
          {t('dashboard.newFromTemplateAction')}
        </Button>

        {/*
          A menu, not a value. Held at `value=""` so Radix keeps rendering the
          placeholder — the trigger must go on reading "Import" rather than
          becoming "MusicXML" after one use — and so `onValueChange` fires on
          every selection, which a controlled Select does because it never
          adopts the value itself.
        */}
        <Select value="" onValueChange={(v) => openImport(v as ImportKind)}>
          <SelectTrigger aria-label={t('dashboard.importFormat')} className={SELECT_TRIGGER_CLASS}>
            <SelectValue placeholder={t('dashboard.import')} />
          </SelectTrigger>
          <SelectContent>
            {IMPORT_KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {/*
                  This library's `SelectItem` wraps all of `children` in
                  Radix's `ItemText`, which is also what it points
                  `aria-labelledby` at — so the option's accessible name is
                  whatever is rendered here, description included, and an
                  `aria-label` override would lose to that `aria-labelledby`
                  anyway. Hearing the description as part of the name is the
                  right outcome for a screen reader too, not just the
                  unavoidable one.
                */}
                <div className="flex flex-col gap-0.5 py-0.5">
                  <span>{t(IMPORT_LABEL_KEYS[kind])}</span>
                  <span className="text-xs text-theme-text-secondary">
                    {t(IMPORT_DESCRIPTION_KEYS[kind])}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loaded && filtered.length === 0 && (
        // The shared empty state, which pairs the message with the action it
        // describes — the previous bare sentence told you to create a project
        // and then left you to find the button yourself.
        <div className="mt-8">
          <EmptyState
            message={
              search.trim() === ''
                ? t('dashboard.emptyNoProjects')
                : t('dashboard.emptyNoMatch', { query: search.trim() })
            }
            /**
             * Its own label, not `dashboard.newProject`: the toolbar already
             * has a button by that name, and on an empty dashboard both are on
             * screen at once. Two controls sharing one accessible name are
             * ambiguous read aloud and a strict-mode failure to address in a
             * test — the same reason a dialog with a Cancel button has to
             * rename its close control.
             *
             * "Start", not "Create": Playwright matches an accessible name by
             * **substring** unless told otherwise, so a label beginning "Create"
             * is also matched by the name dialog's own `Create` button. A
             * distinct verb is what actually separates them.
             */
            buttonLabel={
              search.trim() === '' ? t('dashboard.createFirstProject') : t('common.clearSearch')
            }
            onPress={() => (search.trim() === '' ? setNewProjectOpen(true) : setSearch(''))}
          />
        </div>
      )}

      {filtered.length > 0 && (
        <div className="mt-6" aria-label={t('dashboard.yourProjects')}>
          <Text as="p" size="xs" weight="medium" color="muted" className="uppercase tracking-wide">
            {t('dashboard.yourProjects')}
          </Text>
          <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {filtered.map(renderCard)}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('dashboard.deleteTitle')}
        message={pendingDelete ? t('dashboard.deleteMessage', { name: pendingDelete.name }) : ''}
        confirmLabel={t('common.delete')}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void handleDelete()}
      />

      <MidiImportWizard
        open={midiImportOpen}
        onClose={() => setMidiImportOpen(false)}
        store={store}
        forceNewProject
        onImportedNewProject={(projectId) => {
          setMidiImportOpen(false);
          resetOpenedProjectTransport();
          onNavigate?.(`/project/${projectId}`);
        }}
      />
      <AudioImportDialog
        open={audioImportOpen}
        busy={audioBusy}
        error={audioError}
        canTranscribe={canTranscribe ?? true}
        onImport={handleAudioImport}
        onClose={() => {
          setAudioImportOpen(false);
          setAudioError(null);
        }}
      />
      {/* `.MOD` and Project JSON are one step — the file *is* the answer, so
          there is nothing to confirm and the modal commits as soon as it reads
          one. They still go through the same shell: a title saying what will
          happen, and somewhere to report a file that cannot be read. */}
      <FileImportModal
        open={modImportOpen}
        title={t('dashboard.importModule')}
        accept=".mod,.dsm,.s3m,.xm,.it,.mptm,audio/mod,application/octet-stream"
        fileKind={t('dashboard.moduleFileKind')}
        onFile={(file) => void handleImportModFile(file)}
        busy={modBusy}
        busyLabel={t('dashboard.decodingModule')}
        error={modError}
        canImport={false}
        onImport={() => {}}
        onClose={() => {
          setModImportOpen(false);
          setModError(null);
        }}
        description={t('dashboard.moduleDescription')}
      />
      <FileImportModal
        open={jsonImportOpen}
        title={t('dashboard.importProject')}
        accept={[...DOCUMENT_EXTENSIONS.map((ext) => `.${ext}`), 'application/json'].join(',')}
        fileKind={t('dashboard.projectFileKind')}
        onFile={(file) => void handleImportJsonFile(file)}
        busy={jsonBusy}
        busyLabel={t('dashboard.readingProject')}
        error={jsonError}
        canImport={false}
        onImport={() => {}}
        onClose={() => {
          setJsonImportOpen(false);
          setJsonError(null);
        }}
        description={t('dashboard.projectDescription')}
      />
      <MusicXmlImportDialog
        open={musicXmlImportOpen}
        onClose={() => setMusicXmlImportOpen(false)}
        store={store}
        forceNewProject
        onImportedNewProject={(projectId) => {
          setMusicXmlImportOpen(false);
          resetOpenedProjectTransport();
          onNavigate?.(`/project/${projectId}`);
        }}
      />
      <TemplatePickerDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onChoose={(templateId) => {
          setTemplatesOpen(false);
          void handleCreateFromTemplate(templateId);
        }}
      />
      <NewProjectDialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        submitting={creatingProject}
        onSubmit={(submission) => void handleNewProject(submission)}
      />
    </div>
  );
}
