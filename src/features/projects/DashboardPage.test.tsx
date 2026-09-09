/**
 * DashboardPage against the in-memory FakeMusicClient (server-backed era):
 * templates section, project listing/search, create/open/duplicate/delete
 * flows, navigation callbacks. App services are installed via the shared
 * test wiring so the component's getAppServices() reads resolve to fakes.
 */
import { templateCopy as TEST_TEMPLATE_COPY_FN } from '@/i18n/lib-copy';
const TEST_TEMPLATE_COPY = TEST_TEMPLATE_COPY_FN();
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createAppStore,
  createEmptyScore,
  playbackController,
  projectTemplates,
  type TestStoreContext,
} from '@sudobility/music_lib';
import { DashboardPage } from '@/features/projects/DashboardPage';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import { withQueryClient } from '@/test/query';
import type { EditorStoreApi } from '@sudobility/music_lib';

vi.mock('@sudobility/music_lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sudobility/music_lib')>();
  return {
    ...actual,
    playbackController: {
      // A real bus: playback position and sounding notes live on it now.
      bus: new actual.PlaybackBus(),
      stop: vi.fn(),
    },
  };
});

function setup(): { store: EditorStoreApi; context: TestStoreContext } {
  const context = installTestAppServices();
  const store = createAppStore({ context });
  return { store, context };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetTestAppServices();
});

/**
 * Picks one format out of the Import menu.
 *
 * Five buttons that differed by a word were one decision — which file — spread
 * across five controls; they are one Select now, so every test that used to
 * click a button by name opens the menu and chooses an option.
 */
async function chooseImport(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox', { name: 'Import a file' }));
  await user.click(await screen.findByRole('option', { name: label }));
}

describe('DashboardPage', () => {
  it('offers every project template, behind the button rather than down the page', async () => {
    // Twelve cards used to sit permanently between the toolbar and the project
    // list, above the projects somebody came to open.
    const { store } = setup();
    render(withQueryClient(<DashboardPage store={store} />));
    const user = userEvent.setup();

    const first = projectTemplates(TEST_TEMPLATE_COPY)[0];
    expect(
      screen.queryByRole('button', { name: `New from template: ${first.name}` }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New from Template' }));
    for (const template of projectTemplates(TEST_TEMPLATE_COPY)) {
      expect(
        screen.getByRole('button', { name: `New from template: ${template.name}` }),
      ).toBeInTheDocument();
    }
  });

  it('offers every kind of import from one control, since each one makes a new project', async () => {
    // These moved off the editor's title bar: every one of them creates a
    // project and navigates away, which is not something a screen showing one
    // open project should be doing.
    const { store } = setup();
    render(withQueryClient(<DashboardPage store={store} />));
    const user = userEvent.setup();

    await user.click(screen.getByRole('combobox', { name: 'Import a file' }));
    for (const label of [
      'Import MIDI',
      'Import MusicXML',
      'Import Audio',
      'Import MOD',
      'Import project JSON',
    ]) {
      expect(screen.getByRole('option', { name: label }), label).toBeInTheDocument();
    }
  });

  it('opens a modal for every import, not the OS picker', async () => {
    // `.MOD` and Project JSON used to jump straight to the file dialog, so two
    // of the five imports had no title, no description of what they would do,
    // and nowhere to report a file that could not be read.
    const { store } = setup();
    render(withQueryClient(<DashboardPage store={store} />));
    const user = userEvent.setup();

    for (const [item, title] of [
      ['Import MOD', 'Import module'],
      ['Import project JSON', 'Import project JSON'],
      ['Import Audio', 'Import audio'],
    ] as const) {
      await chooseImport(user, item);
      expect(await screen.findByRole('dialog', { name: title }), item).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
    }
  });

  it('keeps reading "Import" after one has been chosen', async () => {
    // A menu, not a value: the trigger must not become "MusicXML" and leave the
    // reader with no word for what the control does.
    const { store } = setup();
    render(withQueryClient(<DashboardPage store={store} />));
    const user = userEvent.setup();

    await chooseImport(user, 'Import MOD');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    // Anchored: `toHaveTextContent` is a substring match, and "Import MOD"
    // contains "Import" — so an unanchored assertion passes against exactly the
    // regression this test exists to catch.
    expect(screen.getByRole('combobox', { name: 'Import a file' })).toHaveTextContent(/^Import$/);
  });

  it('accepts the formats each import claims to', async () => {
    // The menu says WAV, MP3 and MPA; the picker has to agree, or the file the
    // user was told to bring is greyed out in their own file dialog.
    const { store } = setup();
    render(withQueryClient(<DashboardPage store={store} />));
    const user = userEvent.setup();

    await chooseImport(user, 'Import Audio');
    const audio = (await screen.findByLabelText('audio file input')) as HTMLInputElement;
    for (const ext of ['.wav', '.mp3', '.mpa']) expect(audio.accept).toContain(ext);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await chooseImport(user, 'Import MOD');
    const mod = (await screen.findByLabelText('module file input')) as HTMLInputElement;
    expect(mod.accept).toContain('.mod');
  });

  it('keeps search and sort in one group, so they cannot wrap apart', () => {
    /*
      Layout itself is untestable here — jsdom has no layout — but the thing
      that actually regressed is structural: the sort select was a sibling of
      the buttons in one wrapping row, so it wrapped onto a line of its own.
      Sharing a parent with the search field is what stops that, and it is what
      this pins. The `flex-nowrap` on that parent is the CSS half.
    */
    const { store } = setup();
    render(withQueryClient(<DashboardPage store={store} />));

    const search = screen.getByLabelText('Search projects');
    const sort = screen.getByRole('combobox', { name: 'Sort projects' });
    expect(search.parentElement).toBe(sort.parentElement);
    // And the buttons are deliberately *not* in it.
    expect(screen.getByRole('button', { name: 'New Project' }).parentElement).not.toBe(
      search.parentElement,
    );
  });

  it('no longer carries a separate Generate Score button', () => {
    // One decision, asked once: generating and not generating differ only in
    // whether a prompt is sent.
    const { store } = setup();
    render(withQueryClient(<DashboardPage store={store} />));
    expect(screen.queryByRole('button', { name: 'Generate Score' })).not.toBeInTheDocument();
  });

  it("lists the signed-in user's server-side projects", async () => {
    const { store, context } = setup();
    await context.fakeClient.createProject(
      { name: 'My Existing Song', score: createEmptyScore({ title: 'My Existing Song' }) },
      'test-token',
    );
    render(withQueryClient(<DashboardPage store={store} />));
    await waitFor(() => expect(screen.getByText('My Existing Song')).toBeInTheDocument());
  });

  it('New Project creates a project on the server and navigates to it', async () => {
    const { store, context } = setup();
    const onNavigate = vi.fn();
    render(withQueryClient(<DashboardPage store={store} onNavigate={onNavigate} />));
    const user = userEvent.setup();

    // "New Project", matching the visible label: the aria-label used to read
    // "New project" while the button read "New Project", which is exactly the
    // mismatch WCAG's "Label in Name" is about. Localising them merged the two.
    await user.click(screen.getByRole('button', { name: 'New Project' }));
    // The name comes from the modal's Title field now — the same field that
    // titles the score, so a project is named once rather than twice.
    await user.type(await screen.findByLabelText('Title', { exact: true }), 'Brand New Song');
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
    render(withQueryClient(<DashboardPage store={store} onNavigate={onNavigate} />));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'New from Template' }));
    await user.click(
      await screen.findByRole('button', {
        name: `New from template: ${projectTemplates(TEST_TEMPLATE_COPY)[0].name}`,
      }),
    );
    await waitFor(() => expect(onNavigate).toHaveBeenCalled());
    expect(store.getState().projectName).toBe(projectTemplates(TEST_TEMPLATE_COPY)[0].name);
    expect(store.getState().score?.metadata.title).toBe(
      projectTemplates(TEST_TEMPLATE_COPY)[0].name,
    );
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
    render(withQueryClient(<DashboardPage store={store} />));
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
    render(withQueryClient(<DashboardPage store={store} onNavigate={onNavigate} />));
    await waitFor(() => expect(screen.getByText('Openable')).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open project: Openable' }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(`/project/${record.id}`));
    expect(store.getState().projectId).toBe(record.id);
    expect(playbackController.stop).toHaveBeenCalledTimes(1);
  });

  it('Duplicate copies a project; Delete (after confirming) removes it', async () => {
    const { store, context } = setup();
    await context.fakeClient.createProject(
      { name: 'Original', score: createEmptyScore({ title: 'Original' }) },
      't',
    );
    render(withQueryClient(<DashboardPage store={store} />));
    await waitFor(() => expect(screen.getByText('Original')).toBeInTheDocument());
    const user = userEvent.setup();
    const getProject = vi.spyOn(context.fakeClient, 'getProject');

    await user.click(screen.getByRole('button', { name: 'Duplicate project: Original' }));
    await waitFor(() => expect(screen.getByText('Original (copy)')).toBeInTheDocument());
    // The copy happens server-side. Reading the project here would mean the
    // score had been downloaded only to be uploaded straight back.
    expect(getProject).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete project: Original (copy)' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Original (copy)')).not.toBeInTheDocument());
    const rows = await context.fakeClient.listProjects('t');
    expect(rows.map((r) => r.name)).toEqual(['Original']);
  });
});

describe('DashboardPage generation', () => {
  it('reaches whole-score generation through the New Project modal', async () => {
    // The sidebar gave this up when generation became a server-side job, and
    // the dashboard's second button gave it up when the toggle arrived.
    const { store } = setup();
    render(withQueryClient(<DashboardPage store={store} />));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'New Project' }));
    expect(await screen.findByRole('dialog', { name: 'New Project' })).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Generate for me' }));
    expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
  });

  it('marks a generating project in the list', async () => {
    const { store, context } = setup();
    const project = await context.fakeClient.createProject(
      { name: 'Busy Song', score: createEmptyScore({ title: 'Busy Song' }) },
      'tok',
    );
    context.fakeClient.setProjectStatus(project.id, 'generating');

    render(withQueryClient(<DashboardPage store={store} />));

    expect(await screen.findByText('Generating…')).toBeVisible();
  });

  it('shows no badge on a ready project', async () => {
    const { store, context } = setup();
    await context.fakeClient.createProject(
      { name: 'Calm Song', score: createEmptyScore({ title: 'Calm Song' }) },
      'tok',
    );

    render(withQueryClient(<DashboardPage store={store} />));

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

    render(withQueryClient(<DashboardPage store={store} />));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Cancel generation: Busy Song' }),
    );

    await waitFor(() => expect(context.fakeClient.storedRecord(project.id)?.status).toBe('ready'));
  });

  it('creates the project up front so it appears while it generates', async () => {
    // Created immediately rather than on completion: otherwise it would
    // materialise in this list minutes later out of nowhere.
    const { store } = setup();
    render(withQueryClient(<DashboardPage store={store} />));

    await userEvent.click(screen.getByRole('button', { name: 'New Project' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Generate for me' }));
    await userEvent.type(screen.getByLabelText('Prompt'), 'a gentle waltz');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Generating…')).toBeVisible();
  });
});
