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
import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  cn,
} from '@sudobility/components';
import { variants } from '@sudobility/design';
import type { ProjectSummary } from '@sudobility/music_types';
import { parseScore } from '@sudobility/music_types';
import {
  addTranscribedTrackCommand,
  deleteTrackCommand,
  modToScore,
  projectTemplates,
  reportError,
  transcribe,
  useAppStore,
} from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { getAppServices } from '@/config/initialize';
import { createEmptyScore } from '@sudobility/music_lib';
import type { GenerateScoreRequest } from '@sudobility/music_types';
import { GenerateScoreDialog } from '@/features/generation/GenerateScoreDialog';
import { CONSTANTS } from '@/config/constants';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { MidiImportWizard } from '@/components/dialogs/MidiImportWizard';
import { MusicXmlImportDialog } from '@/components/dialogs/MusicXmlImportDialog';
import { AudioImportDialog } from '@/components/dialogs/AudioImportDialog';
import type { Transcription } from '@sudobility/music_lib';

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
  if (!token) throw new Error('You must be signed in.');
  return { client: musicClient, token };
}

/** How often the list refetches while any project is generating. Minutes of work, so seconds of latency cost nothing. */
const GENERATION_POLL_MS = 3000;

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

/** The resolution a transcription is emitted against, and the score built to hold it. */
const TRANSCRIPTION_PPQ = 480;

const TEXT_INPUT_CLASS = `${ROW_CONTROL_CLASS} px-3`;

const SELECT_TRIGGER_CLASS = `${ROW_CONTROL_CLASS} w-auto px-3`;

/** Buttons and the file-picker labels that have to pass for buttons. */
const ROW_BUTTON_CLASS = `${ROW_CONTROL_CLASS} justify-center px-3`;

const CARD_CLASS = cn(variants.card.default.base(), 'flex flex-col overflow-hidden rounded-md');

export function DashboardPage({ store = useAppStore, onNavigate }: DashboardPageProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updatedAt');
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [midiImportOpen, setMidiImportOpen] = useState(false);
  const [musicXmlImportOpen, setMusicXmlImportOpen] = useState(false);
  const [audioImportOpen, setAudioImportOpen] = useState(false);
  const [audioAnalysis, setAudioAnalysis] = useState<Transcription | undefined>(undefined);
  const [audioName, setAudioName] = useState('Audio');
  const [generateOpen, setGenerateOpen] = useState(false);
  const [creatingGeneration, setCreatingGeneration] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { client, token } = await clientAndToken();
      const rows = await client.listProjects(token, { sort: sortBy });
      setProjects(rows);
    } catch (err) {
      reportError(err, { context: 'Failed to load projects', store });
    } finally {
      setLoaded(true);
    }
  }, [sortBy, store]);

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
      reportError(err, { context: 'Failed to cancel generation', store });
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
      await client.createJob({ projectId: project.id, kind: 'generate-score', request }, token);
      setGenerateOpen(false);
      await refresh();
    } catch (err) {
      reportError(err, { context: 'Failed to start generation', store });
    } finally {
      setCreatingGeneration(false);
    }
  };

  const filtered = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  const openProject = async (id: string): Promise<void> => {
    try {
      await store.getState().openProject(id);
      onNavigate?.(`/project/${id}`);
    } catch (err) {
      reportError(err, { context: 'Failed to open project', store });
    }
  };

  const handleCreate = async (): Promise<void> => {
    const name = (creatingName ?? '').trim();
    if (name === '') return;
    setCreatingName(null);
    try {
      await store.getState().newProject({ name });
      const id = store.getState().projectId;
      if (id) onNavigate?.(`/project/${id}`);
    } catch (err) {
      reportError(err, { context: 'Failed to create project', store });
    }
  };

  const handleCreateFromTemplate = async (templateId: string): Promise<void> => {
    const template = projectTemplates.find((t) => t.id === templateId);
    if (!template) return;
    try {
      await store.getState().newProject({ name: template.name, score: template.build() });
      const id = store.getState().projectId;
      if (id) onNavigate?.(`/project/${id}`);
    } catch (err) {
      reportError(err, { context: 'Failed to create project from template', store });
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
      reportError(err, { context: 'Failed to duplicate project', store });
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
      reportError(err, { context: 'Failed to delete project', store });
    }
  };

  const handleImportJsonFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
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
      await refresh();
      if (id) onNavigate?.(`/project/${id}`);
    } catch (err) {
      reportError(err, { context: 'Project JSON import failed', store });
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
  const handleImportModFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const bytes = await file.arrayBuffer();
      const mod = getAppServices().io.modCodec.decode(bytes);
      const score = modToScore(mod);
      await store.getState().newProject({ name: mod.title || file.name, score });
      const id = store.getState().projectId;
      await refresh();
      if (id) onNavigate?.(`/project/${id}`);
    } catch (err) {
      reportError(err, { context: 'Module import failed', store });
    }
  };

  /** Decode and analyse the picked file; the dialog then shows what was heard. */
  const handleAudioFile = (file: File): void => {
    void (async () => {
      try {
        setAudioAnalysis(undefined);
        setAudioName(file.name.replace(/\.[^.]+$/, ''));
        const audio = await getAppServices().io.audioCodec.decode(await file.arrayBuffer());
        setAudioAnalysis(transcribe(audio, TRANSCRIPTION_PPQ));
      } catch (err) {
        reportError(err, { context: 'Audio import failed', store });
      }
    })();
  };

  /**
   * Commits the transcription as a **new project**.
   *
   * The editor's version of this added a track to the score already open; here
   * there is no open score, so the transcribed track is written onto an empty
   * one. `addTranscribedTrackCommand` is a pure `(Score) => Score`, so it
   * applies with no store behind it.
   *
   * Ticks are rescaled when the tempo was corrected: they were emitted against
   * the *detected* value, so halving the tempo has to halve them too or the
   * notes land in the wrong bars.
   */
  const handleAudioImport = (bpm: number): void => {
    const analysis = audioAnalysis;
    if (!analysis) return;
    void (async () => {
      try {
        const scale = analysis.bpm === 0 ? 1 : bpm / analysis.bpm;
        const notes = analysis.notes.map((n) => ({
          midi: n.midi,
          startTick: Math.round(n.startTick * scale),
          durationTicks: Math.max(1, Math.round(n.durationTicks * scale)),
        }));

        // Long enough to hold the recording: `addTranscribedTrackCommand`
        // drops a note that falls past the last measure rather than piling it
        // on the final beat, so a score built too short silently loses the end
        // of the take.
        const lastTick = notes.reduce((end, n) => Math.max(end, n.startTick + n.durationTicks), 0);
        const ticksPerMeasure = TRANSCRIPTION_PPQ * 4; // the 4/4 default below
        const measures = Math.max(4, Math.ceil((lastTick + 1) / ticksPerMeasure));

        // One placeholder track, because the command copies its measure grid
        // for the new track and refuses a score with none — then dropped again,
        // so the project opens with the transcription alone.
        const empty = createEmptyScore({
          title: audioName,
          ppq: TRANSCRIPTION_PPQ,
          tempo: bpm,
          measures,
        });
        const withAudio = addTranscribedTrackCommand({ name: audioName, notes }).execute(empty);
        const score = deleteTrackCommand(empty.tracks[0].id).execute(withAudio);

        await store.getState().newProject({ name: audioName, score });
        const id = store.getState().projectId;
        setAudioImportOpen(false);
        setAudioAnalysis(undefined);
        await refresh();
        if (id) onNavigate?.(`/project/${id}`);
      } catch (err) {
        reportError(err, { context: 'Audio import failed', store });
      }
    })();
  };

  const renderCard = (project: ProjectSummary) => (
    <div key={project.id} className={CARD_CLASS}>
      <Button
        type="button"
        variant="ghost"
        aria-label={`Open project: ${project.name}`}
        onClick={() => void openProject(project.id)}
        className="flex h-auto flex-1 flex-col items-start gap-1 rounded-none p-4 text-left"
      >
        <span className="text-sm font-medium text-theme-text-primary">{project.name}</span>
        <span className="text-xs text-theme-text-secondary">
          Updated {formatDate(project.updatedAt)}
        </span>
        {project.status === 'generating' && (
          <span className="rounded-full bg-info px-2 py-0.5 text-xs text-info-foreground">
            Generating…
          </span>
        )}
      </Button>
      <div className="flex gap-1 border-t border-theme-border p-2">
        {project.status === 'generating' && (
          <Button
            type="button"
            variant="ghost"
            aria-label={`Cancel generation: ${project.name}`}
            onClick={() => void cancelGeneration(project.id)}
            className="px-3 py-1"
          >
            Cancel generation
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          aria-label={`Duplicate project: ${project.name}`}
          onClick={() => void handleDuplicate(project)}
          className="px-3 py-1"
        >
          Duplicate
        </Button>
        {/* `variant="ghost"` + an explicit className override, not
            `variant="destructive-outline"`: see `DeveloperSettingsDialog`'s
            "Reset local database" button doc comment -- that CVA enum
            value has no matching `@sudobility/design` entry, so `Button`
            would silently fall back to its primary skin. */}
        <Button
          type="button"
          variant="ghost"
          aria-label={`Delete project: ${project.name}`}
          onClick={() => setPendingDelete(project)}
          className={cn(variants.button.destructive.outline(), 'border-transparent px-3 py-1')}
        >
          Delete
        </Button>
      </div>
    </div>
  );

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-xl font-semibold text-theme-text-primary">
          {CONSTANTS.APP_NAME}
        </h1>

        <Input
          type="text"
          aria-label="Search projects"
          placeholder="Search projects"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={TEXT_INPUT_CLASS}
        />

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
          <SelectTrigger aria-label="Sort projects" className={SELECT_TRIGGER_CLASS}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updatedAt">Last modified</SelectItem>
            <SelectItem value="name">Name</SelectItem>
          </SelectContent>
        </Select>

        {creatingName !== null ? (
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              type="text"
              aria-label="New project name"
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
              aria-label="Create"
              onClick={() => void handleCreate()}
              className={ROW_BUTTON_CLASS}
            >
              Create
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="primary"
            aria-label="New project"
            onClick={() => setCreatingName('Untitled Project')}
            className={ROW_BUTTON_CLASS}
          >
            New Project
          </Button>
        )}

        <Tooltip content="Generate a whole score with AI">
          <Button
            type="button"
            variant="outline"
            aria-label="Generate Score"
            onClick={() => setGenerateOpen(true)}
            className={ROW_BUTTON_CLASS}
          >
            Generate Score
          </Button>
        </Tooltip>
        <Tooltip content="Import MIDI">
          <Button
            type="button"
            variant="outline"
            aria-label="Import MIDI"
            onClick={() => setMidiImportOpen(true)}
            className={ROW_BUTTON_CLASS}
          >
            Import MIDI
          </Button>
        </Tooltip>
        <Tooltip content="Import MusicXML">
          <Button
            type="button"
            variant="outline"
            aria-label="Import MusicXML"
            onClick={() => setMusicXmlImportOpen(true)}
            className={ROW_BUTTON_CLASS}
          >
            Import MusicXML
          </Button>
        </Tooltip>
        <Tooltip content="Import audio (WAV, MP3, MPA)">
          <Button
            type="button"
            variant="outline"
            aria-label="Import Audio"
            onClick={() => {
              setAudioAnalysis(undefined);
              setAudioImportOpen(true);
            }}
            className={ROW_BUTTON_CLASS}
          >
            Import Audio
          </Button>
        </Tooltip>
        <Tooltip content="Import an Amiga tracker module (.MOD)">
          {/* A native <label> around a hidden input: `Button` renders a
              <button>, which cannot drive a file picker. */}
          <label
            role="button"
            tabIndex={0}
            aria-label="Import MOD"
            className={cn(variants.button.outline.default(), ROW_BUTTON_CLASS, 'cursor-pointer')}
          >
            Import MOD
            <input
              type="file"
              accept=".mod,audio/mod,application/octet-stream"
              className="sr-only"
              aria-label="Module file input"
              onChange={(e) => void handleImportModFile(e)}
            />
          </label>
        </Tooltip>
        <Tooltip content="Import project JSON">
          <label
            role="button"
            tabIndex={0}
            aria-label="Import project JSON"
            className={cn(variants.button.outline.default(), ROW_BUTTON_CLASS, 'cursor-pointer')}
          >
            Import Project JSON
            <input
              type="file"
              accept="application/json"
              className="sr-only"
              aria-label="Project JSON file input"
              onChange={(e) => void handleImportJsonFile(e)}
            />
          </label>
        </Tooltip>
      </div>

      <div className="mt-6" aria-label="Templates">
        <p className="text-xs font-medium uppercase tracking-wide text-theme-text-secondary">
          Templates
        </p>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {projectTemplates.map((template) => (
            <Button
              key={template.id}
              type="button"
              variant="ghost"
              aria-label={`New from template: ${template.name}`}
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
        <p className="mt-8 text-sm text-theme-text-secondary">
          No projects yet. Create one, or import a MIDI/MusicXML/project file to get started.
        </p>
      )}

      {filtered.length > 0 && (
        <div className="mt-6" aria-label="Your projects">
          <p className="text-xs font-medium uppercase tracking-wide text-theme-text-secondary">
            Your projects
          </p>
          <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
            {filtered.map(renderCard)}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete project"
        message={pendingDelete ? `Delete "${pendingDelete.name}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
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
          onNavigate?.(`/project/${projectId}`);
        }}
      />
      <AudioImportDialog
        open={audioImportOpen}
        analysis={audioAnalysis}
        onFile={handleAudioFile}
        onImport={handleAudioImport}
        onClose={() => {
          setAudioImportOpen(false);
          setAudioAnalysis(undefined);
        }}
      />
      <MusicXmlImportDialog
        open={musicXmlImportOpen}
        onClose={() => setMusicXmlImportOpen(false)}
        store={store}
        forceNewProject
        onImportedNewProject={(projectId) => {
          setMusicXmlImportOpen(false);
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
