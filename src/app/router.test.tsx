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
  it('renders the dashboard at "/"', async () => {
    const store = makeStore();
    render(<AppRouter store={store} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ScoreSmith' })).toBeInTheDocument());
  });

  it('opens the matching project (into the shared store) at "/project/:id"', async () => {
    const store = makeStore();
    const record = await context.fakeClient.createProject(
      { name: 'Router Test Project', score: createEmptyScore({ title: 'Router Test Project' }) },
      'test-token'
    );
    window.history.pushState({}, '', `/project/${record.id}`);

    render(<AppRouter store={store} />);

    await waitFor(() => expect(store.getState().projectId).toBe(record.id));
    expect(screen.getByLabelText('Edit project title')).toHaveTextContent('Router Test Project');
  });

  it('an unknown path redirects to the dashboard', async () => {
    const store = makeStore();
    window.history.pushState({}, '', '/nope');

    render(<AppRouter store={store} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ScoreSmith' })).toBeInTheDocument());
    expect(window.location.pathname).toBe('/');
  });

  it('a nonexistent project id falls back to the dashboard with an error toast', async () => {
    const store = makeStore();
    window.history.pushState({}, '', '/project/does-not-exist');

    render(<AppRouter store={store} />);

    await waitFor(() => expect(window.location.pathname).toBe('/'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ScoreSmith' })).toBeInTheDocument());
  });
});
