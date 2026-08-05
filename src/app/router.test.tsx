import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createAppStore, createEmptyScore, type TestStoreContext } from '@sudobility/music_lib';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import type { EditorStoreApi } from '@/features/score-editor/editing';

vi.mock('@sudobility/music_lib', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  playbackController: { togglePlay: vi.fn(), stop: vi.fn(), stopPreview: vi.fn() },
}));

import { AppRouter } from '@/app/router';
import { AuthProvider } from '@/app/AuthContext';
import { playbackController } from '@sudobility/music_lib';
import { CONSTANTS } from '@/config/constants';

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
      <AuthProvider>
        <AppRouter store={store} />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Compose with AI, refine by hand' }),
      ).toBeInTheDocument(),
    );
    expect(window.location.pathname).toBe('/en');
  });

  it('renders the dashboard at "/en/projects"', async () => {
    const store = makeStore();
    window.history.pushState({}, '', '/en/projects');
    render(
      <AuthProvider>
        <AppRouter store={store} />
      </AuthProvider>,
    );

    await waitFor(() =>
      // Not the literal name: VITE_APP_NAME is configurable, so hardcoding it
      // here made these tests pass in CI and fail on any machine with a .env
      // that rebrands the app.
      expect(screen.getByRole('heading', { name: CONSTANTS.APP_NAME })).toBeInTheDocument(),
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
      <AuthProvider>
        <AppRouter store={store} />
      </AuthProvider>,
    );

    await waitFor(() => expect(store.getState().projectId).toBe(record.id));
    expect(screen.getByLabelText('Edit project title')).toHaveTextContent('Router Test Project');
  });

  it('renders the print view at "/project/:id/print"', async () => {
    const store = makeStore();
    store.getState().setScore(createEmptyScore({ title: 'Printable' }));
    window.history.pushState({}, '', '/en/project/proj-1/print');

    render(
      <AuthProvider>
        <AppRouter store={store} />
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Print' })).toBeInTheDocument();
  });

  it('an unknown path redirects to the localized home', async () => {
    const store = makeStore();
    window.history.pushState({}, '', '/nope');

    render(
      <AuthProvider>
        <AppRouter store={store} />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Compose with AI, refine by hand' }),
      ).toBeInTheDocument(),
    );
    expect(window.location.pathname).toBe('/en');
  });

  it('stops playback (main transport and preview) when the project route unmounts', async () => {
    const store = makeStore();
    const record = await context.fakeClient.createProject(
      { name: 'Unmount Test Project', score: createEmptyScore({ title: 'Unmount Test Project' }) },
      'test-token',
    );
    window.history.pushState({}, '', `/en/project/${record.id}`);

    const { unmount } = render(
      <AuthProvider>
        <AppRouter store={store} />
      </AuthProvider>,
    );

    await waitFor(() => expect(store.getState().projectId).toBe(record.id));
    vi.mocked(playbackController.stop).mockClear();
    vi.mocked(playbackController.stopPreview).mockClear();

    unmount();

    expect(playbackController.stop).toHaveBeenCalledTimes(1);
    expect(playbackController.stopPreview).toHaveBeenCalledTimes(1);
  });

  it('a nonexistent project id falls back to the dashboard with an error toast', async () => {
    const store = makeStore();
    window.history.pushState({}, '', '/en/project/does-not-exist');

    render(
      <AuthProvider>
        <AppRouter store={store} />
      </AuthProvider>,
    );

    await waitFor(() => expect(window.location.pathname).toBe('/en/projects'));
    await waitFor(() =>
      // Not the literal name: VITE_APP_NAME is configurable, so hardcoding it
      // here made these tests pass in CI and fail on any machine with a .env
      // that rebrands the app.
      expect(screen.getByRole('heading', { name: CONSTANTS.APP_NAME })).toBeInTheDocument(),
    );
  });
});
