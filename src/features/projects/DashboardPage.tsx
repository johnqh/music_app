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
import { templateCopy } from '@/i18n/lib-copy';
import { useCallback, useEffect, useState } from 'react';
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
import { emptyScoreForRequest } from '@sudobility/music_lib';
import { parseScore } from '@sudobility/music_types';
import {
  playbackController,
  projectTemplates,
  reportError,
  useAppStore,
  withGenerationVariant,
} from '@sudobility/music_lib';
import type { EditorStoreApi } from '@sudobility/music_lib';
import { getAppServices } from '@/config/initialize';
import type { GenerateScoreRequest } from '@sudobility/music_types';
import { NewProjectDialog } from '@/features/projects/NewProjectDialog';
import { TemplatePickerDialog } from '@/features/projects/TemplatePickerDialog';
import type { NewProjectSubmission } from '@sudobility/music_lib';
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

/** Reads the MusicClient + a token getter out of the app services (the store context owns the same client). */
async function clientAndToken() {
  const { musicClient } = getAppServices();
  const token = await getAppServices().auth.getToken();
  // Surfaces through `reportError`'s toast, so it is user-facing copy.
  if (!token) throw new Error(i18n.t('errors.mustSignIn'));
  return { client: musicClient, token };
}

/** How often the list refetches while any project is generating. Minutes of work, so seconds of latency cost nothing. */
const GENERATION_POLL_MS = 3000;

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

export function DashboardPage({ store = useAppStore, onNavigate }: DashboardPageProps) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updatedAt');
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [midiImportOpen, setMidiImportOpen] = useState(false);
  const [musicXmlImportOpen, setMusicXmlImportOpen] = useState(false);
  const [audioImportOpen, setAudioImportOpen] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  /**
   * Whether this deployment can transcribe audio at all.
   *
   * Probed when the dialog opens rather than discovered by failing: uploading a
   * recording and only then being told the server never could is the worst
   * order to learn it in. `null` while unknown, which leaves the option
   * enabled — an unanswered probe should not disable a feature that may work.
   */
  const [canTranscribe, setCanTranscribe] = useState<boolean | null>(null);
  const [modImportOpen, setModImportOpen] = useState(false);
  const [modBusy, setModBusy] = useState(false);
  const [modError, setModError] = useState<string | null>(null);
  const [jsonImportOpen, setJsonImportOpen] = useState(false);
  const [jsonBusy, setJsonBusy] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { client, token } = await clientAndToken();
      const rows = await client.listProjects(token, { sort: sortBy });
      setProjects(rows);
    } catch (err) {
      reportError(err, { context: t('errors.loadProjects'), store });
    } finally {
      setLoaded(true);
    }
  }, [sortBy, store, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Poll only while something is actually generating, and stop when nothing
   * is — a dashboard that refetched forever would keep a request loop alive
   * for the whole session.
   */
  const anyGenerating = projects.some((p) => p.status === 'generating');
  useEffect(() => {
    if (!anyGenerating) return;
    const timer = setInterval(() => void refresh(), GENERATION_POLL_MS);
    return () => clearInterval(timer);
  }, [anyGenerating, refresh]);

  const cancelGeneration = async (projectId: string): Promise<void> => {
    try {
      const { client, token } = await clientAndToken();
      // The job id is not on the summary; the project's running job is the
      // only one it can have, so the server resolves it from the project.
      await client.cancelProjectGeneration(projectId, token);
      await refresh();
    } catch (err) {
      reportError(err, { context: t('errors.cancelGeneration'), store });
    }
  };

  /** Creates the project immediately, then starts a job against it: it shows up in this list with its badge from the first second rather than materialising minutes later. */
  const startWholeScoreGeneration = async (request: GenerateScoreRequest): Promise<void> => {
    setCreatingProject(true);
    try {
      const { client, token } = await clientAndToken();
      const project = await client.createProject(
        // Not the prompt: prompts routinely begin "Create a ...", which makes
        // a project list full of near-identical names that also collide with
        // the page's own Create button.
        { name: request.title?.trim() || 'Generated score', score: emptyScoreForRequest(request) },
        token,
      );
      try {
        await client.createJob({ projectId: project.id, kind: 'generate-score', request }, token);
      } catch (jobErr) {
        // The project exists only to hold the generation. If the job is
        // refused — out of credits, over quota, another of this user's jobs
        // already queued on it — leaving the empty shell behind litters the
        // dashboard with "Generated score" rows that contain nothing. A user
        // with no credits would collect one on every attempt.
        await client.deleteProject(project.id, token).catch(() => {
          // Best effort: the refusal is what the user needs to hear about.
        });
        throw jobErr;
      }
      setNewProjectOpen(false);
      await refresh();
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

  const openProject = async (id: string): Promise<void> => {
    try {
      await store.getState().openProject(id);
      resetOpenedProjectTransport();
      onNavigate?.(`/project/${id}`);
    } catch (err) {
      reportError(err, { context: t('errors.openProject'), store });
    }
  };

  /**
   * Turns what the modal asked for into a project.
   *
   * The modal reports the *decision*; where it lands is this page's business,
   * which is what lets the same form back a local document on the native side.
   */
  const handleNewProject = async (submission: NewProjectSubmission): Promise<void> => {
    if (submission.kind === 'generate') {
      /*
        The dialog chooses the backend; this fills in when it did not.

        It used to be attached here alone, from developer settings, on the
        reasoning that the backend is a property of the machine rather than of
        the music. Choosing per generation is what the picker in the dialog is
        for, so a request that already names one keeps it.
      */
      await startWholeScoreGeneration(
        submission.request.variant
          ? submission.request
          : withGenerationVariant(
              submission.request,
              store.getState().devSettings.generationVariant,
            ),
      );
      return;
    }
    setCreatingProject(true);
    try {
      await store.getState().newProject({ name: submission.title, score: submission.score });
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
      // Probed per opening, not once per session: a deployment can gain or lose
      // its credentials while a tab stays open.
      void (async () => {
        try {
          const { client, token } = await clientAndToken();
          setCanTranscribe((await client.getTranscriptionCapability(token)).available);
        } catch {
          // Left unknown rather than false: a failed probe says nothing about
          // whether transcription works, and the POST reports its own 503
          // clearly enough if it does not.
          setCanTranscribe(null);
        }
      })();
    }
  };

  const handleCreateFromTemplate = async (templateId: string): Promise<void> => {
    const template = projectTemplates(templateCopy()).find((tpl) => tpl.id === templateId);
    if (!template) return;
    try {
      await store.getState().newProject({ name: template.name, score: template.build() });
      const id = store.getState().projectId;
      resetOpenedProjectTransport();
      if (id) onNavigate?.(`/project/${id}`);
    } catch (err) {
      reportError(err, { context: t('errors.createFromTemplate'), store });
    }
  };

  const handleDuplicate = async (project: ProjectSummary): Promise<void> => {
    try {
      const { client, token } = await clientAndToken();
      // Server-side: the score is copied inside the database. Downloading it
      // to upload it again moved the whole thing twice for a copy nobody here
      // is going to look at.
      await client.duplicateProject(project.id, {}, token);
      await refresh();
    } catch (err) {
      reportError(err, { context: t('errors.duplicateProject'), store });
    }
  };

  const handleDelete = async (): Promise<void> => {
    const project = pendingDelete;
    setPendingDelete(null);
    if (!project) return;
    try {
      const { client, token } = await clientAndToken();
      await client.deleteProject(project.id, token);
      await refresh();
    } catch (err) {
      reportError(err, { context: t('errors.deleteProject'), store });
    }
  };

  const handleImportJsonFile = async (file: File): Promise<void> => {
    setJsonError(null);
    setJsonBusy(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { name?: unknown; score?: unknown };
      const score = parseScore(parsed.score);
      const name =
        typeof parsed.name === 'string' && parsed.name ? parsed.name : score.metadata.title;
      // `newProject` creates it and adopts what it just sent. Creating through
      // the client and then opening the result meant uploading the score and
      // immediately downloading the same bytes back.
      await store.getState().newProject({ name, score });
      const id = store.getState().projectId;
      resetOpenedProjectTransport();
      setJsonImportOpen(false);
      await refresh();
      if (id) onNavigate?.(`/project/${id}`);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : 'That file is not a project export.');
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
      await store.getState().newProject({ name: mod.title || file.name, score });
      const id = store.getState().projectId;
      resetOpenedProjectTransport();
      setModImportOpen(false);
      await refresh();
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
   * separates it, transcribes each part and returns a score. The project comes
   * back immediately in a `transcribing` state and fills itself in when the job
   * lands, so this navigates straight to it rather than waiting.
   */
  const handleAudioImport = (file: File): void => {
    void (async () => {
      setAudioBusy(true);
      setAudioError(null);
      try {
        const { client, token } = await clientAndToken();
        const saved = await client.transcribeAudio(file, file.name, token);
        setAudioImportOpen(false);
        await refresh();
        onNavigate?.(`/project/${saved.id}`);
      } catch (err) {
        setAudioError(err instanceof Error ? err.message : 'That recording could not be sent.');
        reportError(err, { context: t('errors.audioImport'), store });
      } finally {
        setAudioBusy(false);
      }
    })();
  };

  const renderCard = (project: ProjectSummary) => (
    <div key={project.id} className={CARD_CLASS}>
      <Button
        type="button"
        variant="ghost"
        aria-label={t('dashboard.openProject', { name: project.name })}
        onClick={() => void openProject(project.id)}
        className="flex h-auto flex-1 flex-col items-start gap-1 rounded-none p-4 text-left"
      >
        <Text size="sm" weight="medium">
          {project.name}
        </Text>
        <span className="text-xs text-theme-text-secondary">
          {t('dashboard.updated', { date: formatDate(project.updatedAt) })}
        </span>
        {project.status === 'generating' && (
          <span className="rounded-full bg-info px-2 py-0.5 text-xs text-info-foreground">
            {t('dashboard.generating')}
          </span>
        )}
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
                {t(IMPORT_LABEL_KEYS[kind])}
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
        title={t('dashboard.importModuleTitle')}
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
        accept="application/json"
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
