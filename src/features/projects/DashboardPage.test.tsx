/**
 * DashboardPage against the in-memory FakeMusicClient (server-backed era):
 * templates section, project listing/search, create/open/duplicate/delete
 * flows, navigation callbacks. App services are installed via the shared
 * test wiring so the component's getAppServices() reads resolve to fakes.
 */
import { libraryCopy } from '@/i18n/library-copy';
const TEST_TEMPLATE_COPY = libraryCopy.templates();
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createAppStore,
  createEmptyScore,
  playbackController,
  projectTemplates,
  type TestStoreContext,
} from '@/app-library';
import { serializeProjectFile } from '@sudobility/music_codecs';
import { InsufficientCreditsError } from '@sudobility/music_client';
import { PAYWALL_DIALOG } from '@/features/credits/PaywallDialog';
import { DashboardPage } from '@/features/projects/DashboardPage';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import { withQueryClient } from '@/test/query';
import type { EditorStoreApi } from '@/app-library';

vi.mock('@/app-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app-library')>();
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
 *
 * Matched by a leading substring, not the exact label: each option now also
 * shows a format description under its label, and `SelectItem` wraps both in
 * one `ItemText` that Radix points its accessible name at — so the name is
 * "Import MIDI Notes, tempo and…", not just "Import MIDI". A prefix is still
 * unambiguous, since no two formats share one.
 */
async function chooseImport(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('combobox', { name: 'Import a file' }));
  await user.click(await screen.findByRole('option', { name: new RegExp(`^${label}`) }));
}

/**
 * Backs out of the OS picker `FileImportModal` opens automatically, the way
 * a real cancelled `<input type="file">` does — dispatching the `cancel`
 * event is the only way jsdom (which has no OS file dialog) can stand in for
 * that, since nothing here can literally click Cancel until a file exists.
 */
function cancelPicker(inputLabel: string): void {
  screen.getByLabelText(inputLabel).dispatchEvent(new Event('cancel', { bubbles: true }));
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
      'Import Tracker Module',
      'Import project file',
    ]) {
      expect(
        screen.getByRole('option', { name: new RegExp(`^${label}`) }),
        label,
      ).toBeInTheDocument();
    }
  });

  it('opens the OS picker directly for every import, with no explaining screen first', async () => {
    // Every import used to land on a modal that only explained the format and
    // offered a "Choose file…" button — a second click before the file dialog
    // even opened, paid on all five. `FileImportModal` now opens the picker
    // itself the moment a format is chosen (see its own file comment); the
    // dialog only appears once there is a file, a busy line or an error to
    // show, so there is nothing with role `dialog` yet.
    const { store } = setup();
    render(withQueryClient(<DashboardPage store={store} />));
    const user = userEvent.setup();

    for (const [item, inputLabel] of [
      ['Import Tracker Module', 'module file input'],
      ['Import project file', 'project file input'],
      ['Import Audio', 'audio file input'],
    ] as const) {
      const click = vi.spyOn(HTMLInputElement.prototype, 'click');
      await chooseImport(user, item);
      expect(await screen.findByLabelText(inputLabel), item).toBeInTheDocument();
      expect(click, item).toHaveBeenCalled();
      expect(screen.queryByRole('dialog'), item).not.toBeInTheDocument();
      cancelPicker(inputLabel);
      click.mockRestore();
    }
  });

  it('keeps reading "Import" after one has been chosen', async () => {
    // A menu, not a value: the trigger must not become "MusicXML" and leave the
    // reader with no word for what the control does.
    const { store } = setup();
    render(withQueryClient(<DashboardPage store={store} />));
    const user = userEvent.setup();

    await chooseImport(user, 'Import Tracker Module');
    cancelPicker('module file input');
    // Anchored: `toHaveTextContent` is a substring match, and "Import Tracker
    // Module" contains "Import" — so an unanchored assertion passes against
    // exactly the regression this test exists to catch.
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
    cancelPicker('audio file input');

    await chooseImport(user, 'Import Tracker Module');
    const mod = (await screen.findByLabelText('module file input')) as HTMLInputElement;
    expect(mod.accept).toContain('.mod');
  });

  /*
    A project file comes in two shapes: the `.moo` both apps now write, and this
    app's older `{ name, schemaVersion, score }` export. Each app used to read
    only its own, so a project saved on one could not be opened on the other.
  */
  it.each([
    [
      'a .moo document',
      'Wedding March.moo',
      () =>
        serializeProjectFile({
          title: 'Wedding March',
          score: createEmptyScore({ title: 'Score title' }),
        }),
    ],
    [
      "the web's older JSON export",
      'export.json',
      () =>
        JSON.stringify({
          name: 'Wedding March',
          schemaVersion: 1,
          score: createEmptyScore({ title: 'Score title' }),
        }),
    ],
  ])('opens %s as a new project named from the file', async (_label, fileName, text) => {
    const { store } = setup();
    const onNavigate = vi.fn();
    render(withQueryClient(<DashboardPage store={store} onNavigate={onNavigate} />));
    const user = userEvent.setup();

    await chooseImport(user, 'Import project file');
    const input = (await screen.findByLabelText('project file input')) as HTMLInputElement;
    // Every extension a project file has gone by: the editor has no Open of its
    // own, because opening one makes a project, so this is the only way in.
    for (const ext of ['.moo', '.moosiac', '.json']) expect(input.accept).toContain(ext);
    await user.upload(input, new File([text()], fileName, { type: 'application/json' }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalled());
    expect(store.getState().projectName).toBe('Wedding March');
  });

  it('says why a project file from a newer build is refused, rather than dropping what it cannot read', async () => {
    const { store } = setup();
    render(withQueryClient(<DashboardPage store={store} />));
    const user = userEvent.setup();

    await chooseImport(user, 'Import project file');
    const input = (await screen.findByLabelText('project file input')) as HTMLInputElement;
    const future = JSON.stringify({
      version: 99,
      title: 'Later',
      score: createEmptyScore({ title: 'Later' }),
    });
    await user.upload(input, new File([future], 'later.moo'));

    expect(await screen.findByText(/saved by a newer version of Moosiac/)).toBeInTheDocument();
    expect(store.getState().projectId).toBeNull();
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

  /*
   * Clicking a project navigates; it does not fetch it first.
   *
   * The wait used to happen here, on the screen you are leaving: the whole
   * project — score JSON, parsed — was fetched before anything navigated, with
   * nothing on the dashboard to say so. The editor owns the load now, and says
   * so while it happens.
   */
  it('opens a project by navigating, without waiting for it to load', async () => {
    const { store, context } = setup();
    const record = await context.fakeClient.createProject(
      { name: 'Slow Song', score: createEmptyScore({ title: 'Slow Song' }) },
      'test-token',
    );
    // A fetch that never settles: if the click awaited it, nothing navigates.
    context.fakeClient.getProject = () => new Promise(() => {});

    const onNavigate = vi.fn();
    render(withQueryClient(<DashboardPage store={store} onNavigate={onNavigate} />));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Open project: Slow Song' }));

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(`/project/${record.id}`));
    // And nothing was opened here: the editor route does that.
    expect(store.getState().projectId).toBeNull();
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

  it('clicking a project card navigates to /project/:id', async () => {
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
    /*
      The project itself is loaded by the editor route, which also stops the
      transport once it has one. This page neither fetches nor touches
      playback: it used to do both, and the fetch is what made a click feel
      like nothing had happened.
    */
    expect(store.getState().projectId).toBeNull();
    expect(playbackController.stop).not.toHaveBeenCalled();
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

  /**
   * A transcription runs for minutes, not seconds — see `handleAudioImport`'s
   * own comment. It gets the same "busy" treatment a generation does: a
   * distinct badge (so a reader can tell which is happening), and it must not
   * be openable — opening it would show a mostly-empty score with no way to
   * tell "still working" from "came back blank", which is exactly what the
   * missing refusal let happen live.
   */
  it('marks a transcribing project in the list', async () => {
    const { store, context } = setup();
    const project = await context.fakeClient.createProject(
      { name: 'Busy Recording', score: createEmptyScore({ title: 'Busy Recording' }) },
      'tok',
    );
    context.fakeClient.setProjectStatus(project.id, 'transcribing');

    render(withQueryClient(<DashboardPage store={store} />));

    expect(await screen.findByText('Transcribing…')).toBeVisible();
  });

  it('refuses to open a transcribing project', async () => {
    const { store, context } = setup();
    const project = await context.fakeClient.createProject(
      { name: 'Busy Recording', score: createEmptyScore({ title: 'Busy Recording' }) },
      'tok',
    );
    context.fakeClient.setProjectStatus(project.id, 'transcribing');

    const onNavigate = vi.fn();
    render(withQueryClient(<DashboardPage store={store} onNavigate={onNavigate} />));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open project: Busy Recording' }),
    );

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('refuses to open a generating project the same way', async () => {
    const { store, context } = setup();
    const project = await context.fakeClient.createProject(
      { name: 'Busy Song', score: createEmptyScore({ title: 'Busy Song' }) },
      'tok',
    );
    context.fakeClient.setProjectStatus(project.id, 'generating');

    const onNavigate = vi.fn();
    render(withQueryClient(<DashboardPage store={store} onNavigate={onNavigate} />));
    await userEvent.click(await screen.findByRole('button', { name: 'Open project: Busy Song' }));

    expect(onNavigate).not.toHaveBeenCalled();
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
describe('DashboardPage: a refused generation', () => {
  it('opens the store and leaves no empty project behind when the job is refused for credits', async () => {
    const { store, context } = setup();
    context.fakeClient.createJob = vi.fn().mockRejectedValue(new InsufficientCreditsError());
    render(withQueryClient(<DashboardPage store={store} />));

    await userEvent.click(screen.getByRole('button', { name: 'New Project' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Generate for me' }));
    await userEvent.type(screen.getByLabelText('Prompt'), 'a gentle waltz');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(store.getState().dialogs[PAYWALL_DIALOG]).toBe(true));
    expect(await context.fakeClient.listProjects('tok')).toEqual([]);
  });
});

describe('DashboardPage: polling', () => {
  it('picks up a finished generation without a reload', async () => {
    const { store, context } = setup();
    const project = await context.fakeClient.createProject(
      { name: 'Busy Song', score: createEmptyScore({ title: 'Busy Song' }) },
      'tok',
    );
    context.fakeClient.setProjectStatus(project.id, 'generating');
    render(withQueryClient(<DashboardPage store={store} />));
    expect(await screen.findByText('Generating…')).toBeVisible();

    context.fakeClient.setProjectStatus(project.id, 'ready');
    await waitFor(() => expect(screen.queryByText('Generating…')).not.toBeInTheDocument(), {
      timeout: 5000,
    });
  });
});
