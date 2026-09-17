import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createAppStore, createEmptyScore, savePrefs, type TestStoreContext } from '@/app-library';
import {
  getMusicPosition,
  getMusicPositionSource,
  resetMusicPosition,
} from '@sudobility/music_types';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import type { EditorStoreApi } from '@/app-library';

vi.mock('@/app-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app-library')>();
  return {
    ...actual,
    playbackController: {
      // A real bus: playback position and sounding notes live on it now.
      bus: new actual.PlaybackBus(),
      togglePlay: vi.fn(),
      stop: vi.fn(),
    },
  };
});

import { withQueryClient } from '@/test/query';
import { AppRouter } from '@/app/router';
import { AuthProvider } from '@/app/AuthContext';
import { playbackController } from '@/app-library';

let context: TestStoreContext;

function makeStore(): EditorStoreApi {
  context = installTestAppServices();
  return createAppStore({ context });
}

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  resetTestAppServices();
  resetMusicPosition();
});

describe('AppRouter', () => {
  it('redirects "/" to the localized home page', async () => {
    const store = makeStore();
    render(
      withQueryClient(
        <AuthProvider>
          <AppRouter store={store} />
        </AuthProvider>,
      ),
    );

    // The home page itself is public and lives in `App.tsx`, matched before the
    // auth gate — so it is not part of this (signed-in) route table. What this
    // table still owns is the redirect to the localized root.
    await waitFor(() => expect(window.location.pathname).toBe('/en'));
  });

  it('redirects "/" to the language the reader chose', async () => {
    // The device pref is what a bare URL has to go on: there is no language in
    // it to be authoritative.
    const store = makeStore();
    await savePrefs(context.storage!, { language: 'zh' });
    render(
      withQueryClient(
        <AuthProvider>
          <AppRouter store={store} />
        </AuthProvider>,
      ),
    );

    await waitFor(() => expect(window.location.pathname).toBe('/zh'));
  });

  it('keeps the language a link names, whatever the reader chose', async () => {
    // A shared link has to open in the language it was shared in.
    const store = makeStore();
    await savePrefs(context.storage!, { language: 'en' });
    window.history.pushState({}, '', '/zh/nope');
    render(
      withQueryClient(
        <AuthProvider>
          <AppRouter store={store} />
        </AuthProvider>,
      ),
    );

    await waitFor(() => expect(window.location.pathname).toBe('/zh'));
  });

  it('renders the dashboard at "/en/projects"', async () => {
    const store = makeStore();
    window.history.pushState({}, '', '/en/projects');
    render(
      withQueryClient(
        <AuthProvider>
          <AppRouter store={store} />
        </AuthProvider>,
      ),
    );

    await waitFor(() =>
      // The dashboard's own search field, not the app name. It used to be the
      // page heading, which is gone — the top bar already names the app, and a
      // second copy of the name only took width from the search field. This is
      // also what `gotoDashboard` waits on in the e2e suite, and for the older
      // reason too: VITE_APP_NAME is configurable, so anything keyed to it
      // passes in CI and fails on a machine whose .env rebrands the app.
      expect(screen.getByLabelText('Search projects')).toBeInTheDocument(),
    );
  });

  it('opens the matching project (into the shared store) at "/project/:id"', async () => {
    const store = makeStore();
    const record = await context.fakeClient.createProject(
      { name: 'Router Test Project', score: createEmptyScore({ title: 'Router Test Project' }) },
      'test-token',
    );
    window.history.pushState({}, '', `/en/project/${record.id}`);

    render(
      withQueryClient(
        <AuthProvider>
          <AppRouter store={store} />
        </AuthProvider>,
      ),
    );

    await waitFor(() => expect(store.getState().projectId).toBe(record.id));
    expect(playbackController.stop).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Edit project title')).toHaveTextContent('Router Test Project');
  });

  /*
   * The editor never shows a project the URL did not ask for.
   *
   * Reported from the app: clicking a project showed the PREVIOUS one — its
   * music, and its name in the app bar — for a few seconds, then swapped. The
   * dashboard navigates immediately now, so the store still holds the last
   * project while the new one is fetched, and an editor mounted over that is
   * an editor showing the wrong thing.
   */
  it('shows a loading screen, never the previous project', async () => {
    const store = makeStore();
    const first = await context.fakeClient.createProject(
      { name: 'The Old One', score: createEmptyScore({ title: 'The Old One' }) },
      'test-token',
    );
    const second = await context.fakeClient.createProject(
      { name: 'The New One', score: createEmptyScore({ title: 'The New One' }) },
      'test-token',
    );
    // The editor is already showing the first project, as it would be after a
    // visit; the URL asks for the second.
    await store.getState().openProject(first.id);

    // Assigned inside the executor, which runs synchronously — the `!` is
    // what tells TypeScript that, since it cannot see the timing.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const realGet = context.fakeClient.getProject.bind(context.fakeClient);
    context.fakeClient.getProject = async (id: string, token: string) => {
      await held;
      return realGet(id, token);
    };

    window.history.pushState({}, '', `/en/project/${second.id}`);
    render(
      withQueryClient(
        <AuthProvider>
          <AppRouter store={store} />
        </AuthProvider>,
      ),
    );

    // While the fetch is held: the spinner, and nothing of the old project.
    expect(await screen.findByTestId('project-loading')).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit project title')).not.toBeInTheDocument();
    expect(screen.queryByText('The Old One')).not.toBeInTheDocument();

    release();

    await waitFor(() =>
      expect(screen.getByLabelText('Edit project title')).toHaveTextContent('The New One'),
    );
    expect(screen.queryByTestId('project-loading')).not.toBeInTheDocument();
  });

  it('renders the print view at "/project/:id/print"', async () => {
    const store = makeStore();
    store.getState().setScore(createEmptyScore({ title: 'Printable' }));
    window.history.pushState({}, '', '/en/project/proj-1/print');

    render(
      withQueryClient(
        <AuthProvider>
          <AppRouter store={store} />
        </AuthProvider>,
      ),
    );

    expect(await screen.findByRole('button', { name: 'Print' })).toBeInTheDocument();
  });

  it('an unknown path redirects to the localized home', async () => {
    const store = makeStore();
    window.history.pushState({}, '', '/nope');

    render(
      withQueryClient(
        <AuthProvider>
          <AppRouter store={store} />
        </AuthProvider>,
      ),
    );

    // The home page itself is public and lives in `App.tsx`, matched before the
    // auth gate — so it is not part of this (signed-in) route table. What this
    // table still owns is the redirect to the localized root.
    await waitFor(() => expect(window.location.pathname).toBe('/en'));
  });

  it('stops playback (main transport and preview) when the project route unmounts', async () => {
    const store = makeStore();
    const record = await context.fakeClient.createProject(
      { name: 'Unmount Test Project', score: createEmptyScore({ title: 'Unmount Test Project' }) },
      'test-token',
    );
    window.history.pushState({}, '', `/en/project/${record.id}`);

    const { unmount } = render(
      withQueryClient(
        <AuthProvider>
          <AppRouter store={store} />
        </AuthProvider>,
      ),
    );

    await waitFor(() => expect(store.getState().projectId).toBe(record.id));
    vi.mocked(playbackController.stop).mockClear();

    unmount();

    expect(playbackController.stop).toHaveBeenCalledTimes(1);
  });

  it('leaving the editor keeps its caret', async () => {
    // A stop homes the playhead to 0, and the playhead is the caret — so
    // stopping on the way out used to send the reader back to bar 1 of the
    // project they return to, whether they went to the dashboard or followed a
    // published link.
    const store = makeStore();
    const record = await context.fakeClient.createProject(
      { name: 'Caret Project', score: createEmptyScore({ title: 'Caret Project' }) },
      'test-token',
    );
    window.history.pushState({}, '', `/en/project/${record.id}`);
    const { unmount } = render(
      withQueryClient(
        <AuthProvider>
          <AppRouter store={store} />
        </AuthProvider>,
      ),
    );
    await waitFor(() => expect(store.getState().projectId).toBe(record.id));
    vi.mocked(playbackController.stop).mockImplementation(() => getMusicPositionSource().report(0));
    getMusicPositionSource().moveTo(960);

    unmount();

    expect(playbackController.stop).toHaveBeenCalled();
    expect(getMusicPosition().tick).toBe(960);
  });

  it('a nonexistent project id falls back to the dashboard with an error toast', async () => {
    const store = makeStore();
    window.history.pushState({}, '', '/en/project/does-not-exist');

    render(
      withQueryClient(
        <AuthProvider>
          <AppRouter store={store} />
        </AuthProvider>,
      ),
    );

    /*
      An explicit budget, on this test only.

      `waitFor` gives up after **1000ms**, independent of vitest's
      `testTimeout` — so raising that to 30s bought this nothing, and it failed
      only in a full parallel run while passing every time in isolation. That
      reads as flakiness and is really an assertion that gave up after a
      second, waiting for a whole route change: the editor mounts, its load of
      a nonexistent project rejects, the router navigates, and a data-fetching
      dashboard mounts in its place.

      Deliberately *not* raised globally with `configure({ asyncUtilTimeout })`.
      That was tried and made things worse: with every wait in the suite
      retrying for ten seconds, a failing assertion stayed alive long enough to
      surface inside the following test, turning a clear failure into a
      confusing one. A longer wait belongs on the test that needs it.
    */
    const ROUTE_CHANGE = { timeout: 10_000 };
    await waitFor(() => expect(window.location.pathname).toBe('/en/projects'), ROUTE_CHANGE);
    // The dashboard's own search field — see above for why it is not the name.
    await screen.findByLabelText('Search projects', undefined, ROUTE_CHANGE);
  });
});
