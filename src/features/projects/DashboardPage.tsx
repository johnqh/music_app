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
 */
import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Tooltip } from '@sudobility/components';
import type { ProjectSummary } from '@sudobility/music_types';
import { parseScore } from '@sudobility/music_types';
import { projectTemplates, reportError, useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { getAppServices } from '@/config/initialize';
import { CONSTANTS } from '@/config/constants';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { MidiImportWizard } from '@/components/dialogs/MidiImportWizard';
import { MusicXmlImportDialog } from '@/components/dialogs/MusicXmlImportDialog';

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

const TOOLBAR_BUTTON_CLASS =
  'rounded-md border border-theme-border px-3 py-1.5 text-sm text-theme-text-primary hover:bg-theme-hover-bg disabled:cursor-not-allowed disabled:opacity-50';

const PRIMARY_BUTTON_CLASS =
  'rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

const TEXT_INPUT_CLASS =
  'rounded-md border border-theme-border bg-theme-bg-primary px-3 py-1.5 text-sm text-theme-text-primary';

const CARD_CLASS = 'flex flex-col overflow-hidden rounded-md border border-theme-border bg-theme-bg-secondary';

export function DashboardPage({ store = useAppStore, onNavigate }: DashboardPageProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updatedAt');
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [midiImportOpen, setMidiImportOpen] = useState(false);
  const [musicXmlImportOpen, setMusicXmlImportOpen] = useState(false);

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
      const full = await client.getProject(project.id, token);
      await client.createProject({ name: `${full.name} (copy)`, score: full.score }, token);
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
      const name = typeof parsed.name === 'string' && parsed.name ? parsed.name : score.metadata.title;
      const { client, token } = await clientAndToken();
      const record = await client.createProject({ name, score }, token);
      await refresh();
      await openProject(record.id);
    } catch (err) {
      reportError(err, { context: 'Project JSON import failed', store });
    }
  };

  const renderCard = (project: ProjectSummary) => (
    <div key={project.id} className={CARD_CLASS}>
      <button
        type="button"
        aria-label={`Open project: ${project.name}`}
        onClick={() => void openProject(project.id)}
        className="flex flex-1 flex-col gap-1 p-4 text-left hover:bg-theme-hover-bg"
      >
        <span className="text-sm font-medium text-theme-text-primary">{project.name}</span>
        <span className="text-xs text-theme-text-secondary">Updated {formatDate(project.updatedAt)}</span>
      </button>
      <div className="flex gap-1 border-t border-theme-border p-2">
        <button
          type="button"
          aria-label={`Duplicate project: ${project.name}`}
          onClick={() => void handleDuplicate(project)}
          className="rounded-md px-3 py-1 text-sm text-theme-text-primary hover:bg-theme-hover-bg"
        >
          Duplicate
        </button>
        <button
          type="button"
          aria-label={`Delete project: ${project.name}`}
          onClick={() => setPendingDelete(project)}
          className="rounded-md px-3 py-1 text-sm text-red-600 hover:bg-red-600/10"
        >
          Delete
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-xl font-semibold text-theme-text-primary">{CONSTANTS.APP_NAME}</h1>

        <input
          type="text"
          aria-label="Search projects"
          placeholder="Search projects"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={TEXT_INPUT_CLASS}
        />

        <select
          aria-label="Sort projects"
          value={sortBy}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setSortBy(e.target.value as SortBy)}
          className={TOOLBAR_BUTTON_CLASS}
        >
          <option value="updatedAt">Last modified</option>
          <option value="name">Name</option>
        </select>

        {creatingName !== null ? (
          <div className="flex items-center gap-1">
            <input
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
            <button type="button" aria-label="Create" onClick={() => void handleCreate()} className={PRIMARY_BUTTON_CLASS}>
              Create
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="New project"
            onClick={() => setCreatingName('Untitled Project')}
            className={PRIMARY_BUTTON_CLASS}
          >
            New Project
          </button>
        )}

        <Tooltip content="Import MIDI">
          <button type="button" aria-label="Import MIDI" onClick={() => setMidiImportOpen(true)} className={TOOLBAR_BUTTON_CLASS}>
            Import MIDI
          </button>
        </Tooltip>
        <Tooltip content="Import MusicXML">
          <button
            type="button"
            aria-label="Import MusicXML"
            onClick={() => setMusicXmlImportOpen(true)}
            className={TOOLBAR_BUTTON_CLASS}
          >
            Import MusicXML
          </button>
        </Tooltip>
        <Tooltip content="Import project JSON">
          <label role="button" tabIndex={0} aria-label="Import project JSON" className={`cursor-pointer ${TOOLBAR_BUTTON_CLASS}`}>
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
        <p className="text-xs font-medium uppercase tracking-wide text-theme-text-secondary">Templates</p>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {projectTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              aria-label={`New from template: ${template.name}`}
              onClick={() => void handleCreateFromTemplate(template.id)}
              className="flex flex-col gap-1 rounded-md border border-theme-border bg-theme-bg-secondary p-4 text-left hover:bg-theme-hover-bg"
            >
              <span className="text-sm font-medium text-theme-text-primary">{template.name}</span>
              <span className="text-xs text-theme-text-secondary">{template.description}</span>
            </button>
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
          <p className="text-xs font-medium uppercase tracking-wide text-theme-text-secondary">Your projects</p>
          <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">{filtered.map(renderCard)}</div>
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
    </div>
  );
}
