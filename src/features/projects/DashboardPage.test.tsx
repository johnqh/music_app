import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore } from '@/store/useAppStore';
import { ScoreSmithDb } from '@/services/persistence/db';
import { createProject, listProjects } from '@/services/persistence/projects';
import { createEmptyScore } from '@/domain/score/factory';
import { SAMPLE_DEFINITIONS } from '@/services/persistence/samples';
import { DashboardPage } from '@/features/projects/DashboardPage';
import type { EditorStoreApi } from '@/features/score-editor/editing';

let db: ScoreSmithDb;
let dbCounter = 0;

function makeStore(): EditorStoreApi {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-dashboard-${dbCounter}`);
  return createAppStore({ db });
}

afterEach(async () => {
  await db?.delete();
});

describe('DashboardPage', () => {
  it('installs the sample projects on first load and lists them', async () => {
    const store = makeStore();
    render(<DashboardPage store={store} db={db} />);

    await waitFor(() => expect(screen.getByText(SAMPLE_DEFINITIONS[0].name)).toBeInTheDocument());
    for (const sample of SAMPLE_DEFINITIONS) {
      expect(screen.getByText(sample.name)).toBeInTheDocument();
    }
  });

  it('lists an existing project alongside the samples', async () => {
    const store = makeStore();
    await createProject(db, { name: 'My Existing Song', score: createEmptyScore({ title: 'My Existing Song' }) });

    render(<DashboardPage store={store} db={db} />);

    await waitFor(() => expect(screen.getByText('My Existing Song')).toBeInTheDocument());
  });

  it('New Project creates a project, persists it, and navigates to it', async () => {
    const store = makeStore();
    const onNavigate = vi.fn();
    render(<DashboardPage store={store} db={db} onNavigate={onNavigate} />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText(SAMPLE_DEFINITIONS[0].name)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'New project' }));
    const nameField = screen.getByLabelText('New project name');
    await user.clear(nameField);
    await user.type(nameField, 'Brand New Song');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalled());
    expect(onNavigate.mock.calls[0][0]).toMatch(/^\/project\//);
    expect(store.getState().projectName).toBe('Brand New Song');

    const rows = await listProjects(db);
    expect(rows.some((r) => r.name === 'Brand New Song')).toBe(true);
  });

  it('search filters the project grid by name', async () => {
    const store = makeStore();
    await createProject(db, { name: 'Alpha Song', score: createEmptyScore({ title: 'Alpha' }) });
    await createProject(db, { name: 'Beta Song', score: createEmptyScore({ title: 'Beta' }) });
    render(<DashboardPage store={store} db={db} />);

    await waitFor(() => expect(screen.getByText('Alpha Song')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Search projects'), 'Alpha');

    expect(screen.getByText('Alpha Song')).toBeInTheDocument();
    expect(screen.queryByText('Beta Song')).not.toBeInTheDocument();
  });

  it('clicking a project card opens it and navigates to /project/:id', async () => {
    const store = makeStore();
    const record = await createProject(db, { name: 'Open Me', score: createEmptyScore({ title: 'Open Me' }) });
    const onNavigate = vi.fn();
    render(<DashboardPage store={store} db={db} onNavigate={onNavigate} />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('Open Me')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Open project: Open Me'));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(`/project/${record.id}`));
    expect(store.getState().projectId).toBe(record.id);
  });

  it('Duplicate copies a project; Delete (after confirming) removes it', async () => {
    const store = makeStore();
    const record = await createProject(db, { name: 'Copy Source', score: createEmptyScore({ title: 'Copy Source' }) });
    render(<DashboardPage store={store} db={db} />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByText('Copy Source')).toBeInTheDocument());
    await user.click(screen.getByLabelText('Duplicate project: Copy Source'));

    await waitFor(() => expect(screen.getByText('Copy Source (Copy)')).toBeInTheDocument());

    await user.click(screen.getByLabelText('Delete project: Copy Source (Copy)'));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('Copy Source (Copy)')).not.toBeInTheDocument());
    const remaining = await listProjects(db);
    expect(remaining.some((r) => r.name === 'Copy Source (Copy)')).toBe(false);
    expect(remaining.some((r) => r.id === record.id)).toBe(true);
  });
});
