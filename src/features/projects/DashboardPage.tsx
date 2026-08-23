/**
 * Project dashboard (spec §19), server-backed: a searchable/sortable grid
 * of the signed-in user's projects (from music_api via MusicClient), a
 * Templates section ("New from template" starter scores — replacing the
 * old locally-installed sample projects), New Project, MIDI/MusicXML/
 * Project-JSON import, and duplicate/delete (delete confirmed).
 *
 * Opening or creating a project loads it into the shared app-wide store
 * (`openProject`/`newProject`) and then calls `onNavigate`.
 *
 * Re-skinned onto Tailwind + @sudobility/components (T12 batch 5): the MUI
 * Toolbar/Card/CardActionArea/Grid become a plain flex toolbar and a
 * Tailwind `grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3` card grid, MUI
 * Select becomes a native `<select>`, and the import buttons' MUI Tooltips
 * become `@sudobility/components`' Tooltip — same roles/labels/accessible
 * names as before, so no test assertions changed.
 *
 * Adopts `@sudobility/components` controls (library sweep 2): the sort
 * `<select>` becomes the library's Radix-backed `Select`; the search field
 * and new-project-name field become the library `Input` (not
 * `SearchInput`: it has no top-level `aria-label` prop, and its built-in
 * icon/clear affordances aren't part of this toolbar's current design, so
 * plain `Input` -- already used identically for every other text field in
 * this library sweep -- is the better fit); every button, including the
 * card actions and the "New from template" cards (already `<button>`
 * elements), becomes the library `Button`. The "Import Project JSON" label
 * + hidden file input stays exactly as-is (same reasoning as
 * `MidiImportWizard`'s file picker).
 */
import { reportGenerationError } from '@/features/credits/report-generation-error';
import { templateCopy } from '@/i18n/lib-copy';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  Button,
  Heading,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  Tooltip,
  cn,
} from '@sudobility/components';
import { EmptyState } from '@sudobility/building_blocks';
import { variants } from '@sudobility/design';
import type { ProjectSummary } from '@sudobility/music_types';
import { parseScore } from '@sudobility/music_types';
import {
  createEmptyScore,
  playbackController,
  projectTemplates,
  reportError,
  useAppStore,
} from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { getAppServices } from '@/config/initialize';
import type { GenerateScoreRequest } from '@sudobility/music_types';
import { GenerateScoreDialog } from '@/features/generation/GenerateScoreDialog';
import { CONSTANTS } from '@/config/constants';
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
 * The placeholder a Generate Score project holds until its job fills it in.
 *
 * Created up front rather than on completion so the project appears in this
 * list with its badge from the first second, instead of materialising minutes
 * later out of nowhere. Matches the requested shape so the editor can open it
 * meaningfully even mid-generation.
 */
function emptyScoreFor(request: GenerateScoreRequest) {
  return createEmptyScore({
    title: request.title?.trim() || 'Untitled',
    measures: request.durationMeasures,
    tracks: request.tracks.map((t) => ({
      name: t.name,
      instrumentName: t.instrumentName,
      clef: t.clef,
    })),
    ...(request.timeSignature ? { timeSignature: request.timeSignature } : {}),
    ...(request.keySignature ? { keySignature: request.keySignature } : {}),
  });
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

export function DashboardPage({ store = useAppStore, onNavigate }: DashboardPageProps) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updatedAt');
  const [creatingName, setCreatingName] = useState<string | null>(null);
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
  const [generateOpen, setGenerateOpen] = useState(false);
  const [creatingGeneration, setCreatingGeneration] = useState(false);

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
    setCreatingGeneration(true);
    try {
      const { client, token } = await clientAndToken();
      const project = await client.createProject(
        // Not the prompt: prompts routinely begin "Create a ...", which makes
        // a project list full of near-identical names that also collide with
        // the page's own Create button.
        { name: request.title?.trim() || 'Generated score', score: emptyScoreFor(request) },
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
      setGenerateOpen(false);
      await refresh();
    } catch (err) {
      // A refusal for want of credits opens the store; everything else is a
      // toast. The dialog closes either way — behind the paywall, an open
      // Generate form is one more thing in the way of buying.
      setGenerateOpen(false);
      reportGenerationError(err, { context: t('errors.startGeneration'), store });
    } finally {
      setCreatingGeneration(false);
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

  const handleCreate = async (): Promise<void> => {
    const name = (creatingName ?? '').trim();
    if (name === '') return;
    setCreatingName(null);
    try {
      await store.getState().newProject({ name });
      const id = store.getState().projectId;
      resetOpenedProjectTransport();
      if (id) onNavigate?.(`/project/${id}`);
    } catch (err) {
      reportError(err, { context: t('errors.createProject'), store });
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
      <div className="flex flex-wrap items-center gap-2">
        <Heading level={1} size="xl" weight="semibold" className="flex-1">
          {CONSTANTS.APP_NAME}
        </Heading>

        <Input
          type="text"
          aria-label={t('dashboard.searchProjects')}
          placeholder={t('dashboard.searchProjects')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={TEXT_INPUT_CLASS}
        />

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
          <SelectTrigger aria-label={t('dashboard.sortProjects')} className={SELECT_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updatedAt">{t('dashboard.sortUpdated')}</SelectItem>
            <SelectItem value="name">{t('dashboard.sortName')}</SelectItem>
          </SelectContent>
        </Select>

        {creatingName !== null ? (
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              type="text"
              aria-label={t('dashboard.newProjectName')}
              value={creatingName}
              onChange={(e) => setCreatingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
                else if (e.key === 'Escape') setCreatingName(null);
              }}
              className={TEXT_INPUT_CLASS}
            />
            <Button
              type="button"
              variant="primary"
              aria-label={t('dashboard.create')}
              onClick={() => void handleCreate()}
              className={ROW_BUTTON_CLASS}
            >
              {t('dashboard.create')}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="primary"
            aria-label={t('dashboard.newProject')}
            onClick={() => setCreatingName('Untitled Project')}
            className={ROW_BUTTON_CLASS}
          >
            {t('dashboard.newProject')}
          </Button>
        )}

        <Tooltip content={t('dashboard.generateScoreHint')}>
          <Button
            type="button"
            variant="outline"
            aria-label={t('dashboard.generateScore')}
            onClick={() => setGenerateOpen(true)}
            className={ROW_BUTTON_CLASS}
          >
            {t('dashboard.generateScore')}
          </Button>
        </Tooltip>
        <Tooltip content={t('dashboard.importMidi')}>
          <Button
            type="button"
            variant="outline"
            aria-label={t('dashboard.importMidi')}
            onClick={() => setMidiImportOpen(true)}
            className={ROW_BUTTON_CLASS}
          >
            {t('dashboard.importMidi')}
          </Button>
        </Tooltip>
        <Tooltip content={t('dashboard.importMusicXml')}>
          <Button
            type="button"
            variant="outline"
            aria-label={t('dashboard.importMusicXml')}
            onClick={() => setMusicXmlImportOpen(true)}
            className={ROW_BUTTON_CLASS}
          >
            {t('dashboard.importMusicXml')}
          </Button>
        </Tooltip>
        <Tooltip content={t('dashboard.importAudioHint')}>
          <Button
            type="button"
            variant="outline"
            aria-label={t('dashboard.importAudio')}
            onClick={() => {
              setAudioError(null);
              setAudioImportOpen(true);
              // Probed per opening, not once per session: a deployment can gain
              // or lose its credentials while a tab stays open.
              void (async () => {
                try {
                  const { client, token } = await clientAndToken();
                  setCanTranscribe((await client.getTranscriptionCapability(token)).available);
                } catch {
                  // Left unknown rather than false: a probe that failed says
                  // nothing about whether separation works, and the POST
                  // reports its own 503 clearly enough if it does not.
                  setCanTranscribe(null);
                }
              })();
            }}
            className={ROW_BUTTON_CLASS}
          >
            {t('dashboard.importAudio')}
          </Button>
        </Tooltip>
        <Tooltip content={t('dashboard.importModuleHint')}>
          <Button
            type="button"
            variant="outline"
            aria-label={t('dashboard.importModule')}
            onClick={() => setModImportOpen(true)}
            className={ROW_BUTTON_CLASS}
          >
            {t('dashboard.importModule')}
          </Button>
        </Tooltip>
        <Tooltip content={t('dashboard.importProject')}>
          <Button
            type="button"
            variant="outline"
            aria-label={t('dashboard.importProject')}
            onClick={() => setJsonImportOpen(true)}
            className={ROW_BUTTON_CLASS}
          >
            {t('dashboard.importProject')}
          </Button>
        </Tooltip>
      </div>

      <div className="mt-6" aria-label={t('dashboard.templates')}>
        <Text as="p" size="xs" weight="medium" color="muted" className="uppercase tracking-wide">
          {t('dashboard.templates')}
        </Text>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {projectTemplates(templateCopy()).map((template) => (
            <Button
              key={template.id}
              type="button"
              variant="ghost"
              aria-label={t('dashboard.newFromTemplate', { name: template.name })}
              onClick={() => void handleCreateFromTemplate(template.id)}
              className={cn(
                variants.card.default.interactive(),
                'h-auto flex-col items-start gap-1 rounded-md p-4 text-left',
              )}
            >
              <span className="text-sm font-medium text-theme-text-primary">{template.name}</span>
              <span className="text-xs text-theme-text-secondary">{template.description}</span>
            </Button>
          ))}
        </div>
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
            onPress={() =>
              search.trim() === '' ? setCreatingName('Untitled Project') : setSearch('')
            }
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
      <GenerateScoreDialog
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        submitting={creatingGeneration}
        onSubmit={(request) => void startWholeScoreGeneration(request)}
      />
    </div>
  );
}
