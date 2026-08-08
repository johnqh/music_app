/**
 * DashboardPage against the in-memory FakeMusicClient (server-backed era):
 * templates section, project listing/search, create/open/duplicate/delete
 * flows, navigation callbacks. App services are installed via the shared
 * test wiring so the component's getAppServices() reads resolve to fakes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createAppStore,
  createEmptyScore,
  projectTemplates,
  type TestStoreContext,
} from '@sudobility/music_lib';
import { DashboardPage } from '@/features/projects/DashboardPage';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import type { EditorStoreApi } from '@/features/score-editor/editing';

function setup(): { store: EditorStoreApi; context: TestStoreContext } {
  const context = installTestAppServices();
  const store = createAppStore({ context });
  return { store, context };
}

afterEach(() => {
  cleanup();
  resetTestAppServices();
});

describe('DashboardPage', () => {
  it('shows the three project templates', () => {
    const { store } = setup();
    render(<DashboardPage store={store} />);
    for (const template of projectTemplates) {
      expect(
        screen.getByRole('button', { name: `New from template: ${template.name}` }),
      ).toBeInTheDocument();
    }
  });

  it("lists the signed-in user's server-side projects", async () => {
    const { store, context } = setup();
    await context.fakeClient.createProject(
      { name: 'My Existing Song', score: createEmptyScore({ title: 'My Existing Song' }) },
      'test-token',
    );
    render(<DashboardPage store={store} />);
    await waitFor(() => expect(screen.getByText('My Existing Song')).toBeInTheDocument());
  });

  it('New Project creates a project on the server and navigates to it', async () => {
    const { store, context } = setup();
    const onNavigate = vi.fn();
    render(<DashboardPage store={store} onNavigate={onNavigate} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'New project' }));
    const nameField = screen.getByLabelText('New project name');
    await user.clear(nameField);
    await user.type(nameField, 'Brand New Song');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalled());
    expect(onNavigate.mock.calls[0][0]).toMatch(/^\/project\//);
    expect(store.getState().projectName).toBe('Brand New Song');
    const rows = await context.fakeClient.listProjects('test-token');
    expect(rows.some((r) => r.name === 'Brand New Song')).toBe(true);
  });

  it('"New from template" creates a project seeded with the template score', async () => {
    const { store } = setup();
    const onNavigate = vi.fn();
    render(<DashboardPage store={store} onNavigate={onNavigate} />);
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: `New from template: ${projectTemplates[0].name}` }),
    );
    await waitFor(() => expect(onNavigate).toHaveBeenCalled());
    expect(store.getState().projectName).toBe(projectTemplates[0].name);
    expect(store.getState().score?.metadata.title).toBe(projectTemplates[0].name);
  });

  it('search filters the project grid by name', async () => {
    const { store, context } = setup();
    await context.fakeClient.createProject(
      { name: 'Alpha Song', score: createEmptyScore({ title: 'A' }) },
      't',
    );
    await context.fakeClient.createProject(
      { name: 'Beta Tune', score: createEmptyScore({ title: 'B' }) },
      't',
    );
    render(<DashboardPage store={store} />);
    await waitFor(() => expect(screen.getByText('Alpha Song')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Search projects'), 'alpha');
    expect(screen.getByText('Alpha Song')).toBeInTheDocument();
    expect(screen.queryByText('Beta Tune')).not.toBeInTheDocument();
  });

  it('clicking a project card opens it and navigates to /project/:id', async () => {
    const { store, context } = setup();
    const record = await context.fakeClient.createProject(
      { name: 'Openable', score: createEmptyScore({ title: 'Openable' }) },
      't',
    );
    const onNavigate = vi.fn();
    render(<DashboardPage store={store} onNavigate={onNavigate} />);
    await waitFor(() => expect(screen.getByText('Openable')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open project: Openable' }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(`/project/${record.id}`));
    expect(store.getState().projectId).toBe(record.id);
  });

  it('Duplicate copies a project; Delete (after confirming) removes it', async () => {
    const { store, context } = setup();
    await context.fakeClient.createProject(
      { name: 'Original', score: createEmptyScore({ title: 'Original' }) },
      't',
    );
    render(<DashboardPage store={store} />);
    await waitFor(() => expect(screen.getByText('Original')).toBeInTheDocument());
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Duplicate project: Original' }));
    await waitFor(() => expect(screen.getByText('Original (copy)')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Delete project: Original (copy)' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Original (copy)')).not.toBeInTheDocument());
    const rows = await context.fakeClient.listProjects('t');
    expect(rows.map((r) => r.name)).toEqual(['Original']);
  });
});

describe('DashboardPage generation', () => {
  it('offers Generate Score', () => {
    const { store } = setup();
    render(<DashboardPage store={store} />);
    expect(screen.getByRole('button', { name: 'Generate Score' })).toBeVisible();
  });

  it('opens the whole-score dialog, which the sidebar no longer carries', async () => {
    const { store } = setup();
    render(<DashboardPage store={store} />);

    await userEvent.click(screen.getByRole('button', { name: 'Generate Score' }));

    expect(screen.getByRole('dialog', { name: 'Generate a new score' })).toBeInTheDocument();
  });

  it('marks a generating project in the list', async () => {
    const { store, context } = setup();
    const project = await context.fakeClient.createProject(
      { name: 'Busy Song', score: createEmptyScore({ title: 'Busy Song' }) },
      'tok',
    );
    context.fakeClient.setProjectStatus(project.id, 'generating');

    render(<DashboardPage store={store} />);

    expect(await screen.findByText('Generating…')).toBeVisible();
  });

  it('shows no badge on a ready project', async () => {
    const { store, context } = setup();
    await context.fakeClient.createProject(
      { name: 'Calm Song', score: createEmptyScore({ title: 'Calm Song' }) },
      'tok',
    );

    render(<DashboardPage store={store} />);

    expect(await screen.findByText('Calm Song')).toBeVisible();
    expect(screen.queryByText('Generating…')).not.toBeInTheDocument();
  });

  it('offers Cancel on a generating project, so a job can be abandoned without opening it', async () => {
    const { store, context } = setup();
    const project = await context.fakeClient.createProject(
      { name: 'Busy Song', score: createEmptyScore({ title: 'Busy Song' }) },
      'tok',
    );
    context.fakeClient.setProjectStatus(project.id, 'generating');

    render(<DashboardPage store={store} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancel generation: Busy Song' }),
    );

    await waitFor(() =>
      expect(context.fakeClient.storedRecord(project.id)?.status).toBe('ready'),
    );
  });

  it('creates the project up front so it appears while it generates', async () => {
    // Created immediately rather than on completion: otherwise it would
    // materialise in this list minutes later out of nowhere.
    const { store } = setup();
    render(<DashboardPage store={store} />);

    await userEvent.click(screen.getByRole('button', { name: 'Generate Score' }));
    await userEvent.type(screen.getByLabelText('Prompt'), 'a gentle waltz');
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));

    expect(await screen.findByText('Generating…')).toBeVisible();
  });
});
