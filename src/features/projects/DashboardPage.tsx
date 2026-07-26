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
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tooltip, cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
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

const TEXT_INPUT_CLASS = 'px-3 py-1.5 text-sm';

const SELECT_TRIGGER_CLASS = 'h-auto w-auto px-3 py-1.5 text-sm';

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
      <Button
        type="button"
        variant="ghost"
        aria-label={`Open project: ${project.name}`}
        onClick={() => void openProject(project.id)}
        className="flex h-auto flex-1 flex-col items-start gap-1 rounded-none p-4 text-left"
      >
        <span className="text-sm font-medium text-theme-text-primary">{project.name}</span>
        <span className="text-xs text-theme-text-secondary">Updated {formatDate(project.updatedAt)}</span>
      </Button>
      <div className="flex gap-1 border-t border-theme-border p-2">
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
        <h1 className="flex-1 text-xl font-semibold text-theme-text-primary">{CONSTANTS.APP_NAME}</h1>

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
            <Button type="button" variant="primary" aria-label="Create" onClick={() => void handleCreate()}>
              Create
            </Button>
          </div>
        ) : (
          <Button type="button" variant="primary" aria-label="New project" onClick={() => setCreatingName('Untitled Project')}>
            New Project
          </Button>
        )}

        <Tooltip content="Import MIDI">
          <Button type="button" variant="outline" aria-label="Import MIDI" onClick={() => setMidiImportOpen(true)} className="px-3 py-1.5">
            Import MIDI
          </Button>
        </Tooltip>
        <Tooltip content="Import MusicXML">
          <Button
            type="button"
            variant="outline"
            aria-label="Import MusicXML"
            onClick={() => setMusicXmlImportOpen(true)}
            className="px-3 py-1.5"
          >
            Import MusicXML
          </Button>
        </Tooltip>
        <Tooltip content="Import project JSON">
          <label
            role="button"
            tabIndex={0}
            aria-label="Import project JSON"
            className={cn(variants.button.outline.default(), 'cursor-pointer px-3 py-1.5')}
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
        <p className="text-xs font-medium uppercase tracking-wide text-theme-text-secondary">Templates</p>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
          {projectTemplates.map((template) => (
            <Button
              key={template.id}
              type="button"
              variant="ghost"
              aria-label={`New from template: ${template.name}`}
              onClick={() => void handleCreateFromTemplate(template.id)}
              className={cn(variants.card.default.interactive(), 'h-auto flex-col items-start gap-1 rounded-md p-4 text-left')}
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
