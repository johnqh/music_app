/**
 * Project dashboard (spec §19): a searchable/sortable project grid (sample
 * projects -- installed on first run -- shown in their own section ahead
 * of the user's own projects), New Project, MIDI/MusicXML/Project-JSON
 * import, and duplicate/delete (delete confirmed).
 *
 * Opening or creating a project loads it into the shared app-wide store
 * (`store.getState().openProject`/`newProject`) and then calls
 * `onNavigate` -- `router.tsx` wires this to `useNavigate()` so the editor
 * route (`AppLayout`) finds a project already open when it mounts.
 */
import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import type { SelectChangeEvent } from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { ProjectRecord, ScoreSmithDb } from '@/services/persistence/db';
import { deleteProject, duplicateProject, listProjects } from '@/services/persistence/projects';
import { SAMPLE_DEFINITIONS, installSampleProjects } from '@/services/persistence/samples';
import { importProjectJson } from '@/services/persistence/projects';
import { reportError } from '@/services/errors';
import { db as appDb, useAppStore } from '@/store/useAppStore';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { MidiImportWizard } from '@/components/dialogs/MidiImportWizard';
import { MusicXmlImportDialog } from '@/components/dialogs/MusicXmlImportDialog';

export type DashboardPageProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /** Defaults to the app-wide singleton's own db; tests inject the same `fake-indexeddb`-backed db the test's store was built with. */
  db?: ScoreSmithDb;
  /** Called with `/project/:id` after opening/creating/importing a project. Defaults to a no-op; `router.tsx` wires this to `useNavigate()`. */
  onNavigate?: (path: string) => void;
};

type SortBy = 'name' | 'updatedAt';

const SAMPLE_NAMES = new Set(SAMPLE_DEFINITIONS.map((s) => s.name));

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export function DashboardPage({ store = useAppStore, db = appDb, onNavigate }: DashboardPageProps) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updatedAt');
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectRecord | null>(null);
  const [midiImportOpen, setMidiImportOpen] = useState(false);
  const [musicXmlImportOpen, setMusicXmlImportOpen] = useState(false);

  const refresh = async (): Promise<void> => {
    try {
      const rows = await listProjects(db, { sortBy });
      setProjects(rows);
    } catch (err) {
      reportError(err, { context: 'Failed to load projects', store });
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        await installSampleProjects(db);
      } catch (err) {
        reportError(err, { context: 'Failed to install sample projects', store });
      }
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  useEffect(() => {
    if (loaded) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy]);

  const filtered = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  const samples = filtered.filter((p) => SAMPLE_NAMES.has(p.name));
  const others = filtered.filter((p) => !SAMPLE_NAMES.has(p.name));

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

  const handleDuplicate = async (project: ProjectRecord): Promise<void> => {
    try {
      await duplicateProject(db, project.id);
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
      await deleteProject(db, project.id);
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
      const record = await importProjectJson(db, JSON.parse(text));
      await refresh();
      await openProject(record.id);
    } catch (err) {
      reportError(err, { context: 'Project JSON import failed', store });
    }
  };

  const renderCard = (project: ProjectRecord) => (
    <Grid key={project.id} size={{ xs: 12, sm: 6, md: 4 }}>
      <Card variant="outlined">
        <CardActionArea onClick={() => void openProject(project.id)} aria-label={`Open project: ${project.name}`}>
          <CardContent>
            <Typography variant="subtitle1">{project.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              Updated {formatDate(project.updatedAt)}
            </Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              {project.score.tracks.length} track(s)
            </Typography>
          </CardContent>
        </CardActionArea>
        <CardActions>
          <Button size="small" aria-label={`Duplicate project: ${project.name}`} onClick={() => void handleDuplicate(project)}>
            Duplicate
          </Button>
          <Button size="small" color="error" aria-label={`Delete project: ${project.name}`} onClick={() => setPendingDelete(project)}>
            Delete
          </Button>
        </CardActions>
      </Card>
    </Grid>
  );

  return (
    <Box sx={{ p: 3 }}>
      <Toolbar disableGutters sx={{ flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>
          ScoreSmith
        </Typography>

        <TextField
          size="small"
          label="Search projects"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Search projects' } }}
        />
        <Select
          size="small"
          value={sortBy}
          onChange={(e: SelectChangeEvent) => setSortBy(e.target.value as SortBy)}
          inputProps={{ 'aria-label': 'Sort projects' }}
        >
          <MenuItem value="updatedAt">Last modified</MenuItem>
          <MenuItem value="name">Name</MenuItem>
        </Select>

        {creatingName !== null ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <TextField
              size="small"
              autoFocus
              value={creatingName}
              onChange={(e) => setCreatingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
                else if (e.key === 'Escape') setCreatingName(null);
              }}
              slotProps={{ htmlInput: { 'aria-label': 'New project name' } }}
            />
            <Button variant="contained" size="small" aria-label="Create" onClick={() => void handleCreate()}>
              Create
            </Button>
          </Stack>
        ) : (
          <Button variant="contained" aria-label="New project" onClick={() => setCreatingName('Untitled Project')}>
            New Project
          </Button>
        )}

        <Tooltip title="Import MIDI">
          <Button aria-label="Import MIDI" onClick={() => setMidiImportOpen(true)}>
            Import MIDI
          </Button>
        </Tooltip>
        <Tooltip title="Import MusicXML">
          <Button aria-label="Import MusicXML" onClick={() => setMusicXmlImportOpen(true)}>
            Import MusicXML
          </Button>
        </Tooltip>
        <Tooltip title="Import project JSON">
          <Button component="label" aria-label="Import project JSON">
            Import Project JSON
            <input type="file" accept="application/json" hidden aria-label="Project JSON file input" onChange={(e) => void handleImportJsonFile(e)} />
          </Button>
        </Tooltip>
      </Toolbar>

      {loaded && filtered.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 4 }}>
          No projects yet. Create one, or import a MIDI/MusicXML/project file to get started.
        </Typography>
      )}

      {samples.length > 0 && (
        <Box sx={{ mt: 2 }} aria-label="Sample projects">
          <Typography variant="overline" color="text.secondary">
            Sample projects
          </Typography>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            {samples.map(renderCard)}
          </Grid>
        </Box>
      )}

      {others.length > 0 && (
        <Box sx={{ mt: 3 }} aria-label="Your projects">
          <Typography variant="overline" color="text.secondary">
            Your projects
          </Typography>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            {others.map(renderCard)}
          </Grid>
        </Box>
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
        onImportedNewProject={(id) => {
          setMidiImportOpen(false);
          onNavigate?.(`/project/${id}`);
        }}
      />
      <MusicXmlImportDialog
        open={musicXmlImportOpen}
        onClose={() => setMusicXmlImportOpen(false)}
        store={store}
        forceNewProject
        onImportedNewProject={(id) => {
          setMusicXmlImportOpen(false);
          onNavigate?.(`/project/${id}`);
        }}
      />
    </Box>
  );
}
