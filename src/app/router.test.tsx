import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createAppStore, createEmptyScore, type TestStoreContext } from '@sudobility/music_lib';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import type { EditorStoreApi } from '@sudobility/music_lib';

vi.mock('@sudobility/music_lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sudobility/music_lib')>();
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
import { playbackController } from '@sudobility/music_lib';

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
