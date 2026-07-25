import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createAppStore } from '@/store/useAppStore';
import { ScoreSmithDb } from '@/services/persistence/db';
import { createProject } from '@/services/persistence/projects';
import { createEmptyScore } from '@/domain/score/factory';
import type { EditorStoreApi } from '@/features/score-editor/editing';

vi.mock('@/services/playback/controller', () => ({
  playbackController: { togglePlay: vi.fn(), stop: vi.fn(), stopPreview: vi.fn() },
}));

import { AppRouter } from '@/app/router';

let db: ScoreSmithDb;
let dbCounter = 0;

function makeStore(): EditorStoreApi {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-router-${dbCounter}`);
  return createAppStore({ db });
}

beforeEach(() => {
  window.history.pushState({}, '', '/');
});

afterEach(async () => {
  await db?.delete();
});

describe('AppRouter', () => {
  it('renders the dashboard at "/"', async () => {
    const store = makeStore();
    render(<AppRouter store={store} db={db} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ScoreSmith' })).toBeInTheDocument());
  });

  it('opens the matching project (into the shared store) at "/project/:id"', async () => {
    const store = makeStore();
    const record = await createProject(db, { name: 'Router Test Project', score: createEmptyScore({ title: 'Router Test Project' }) });
    window.history.pushState({}, '', `/project/${record.id}`);

    render(<AppRouter store={store} db={db} />);

    await waitFor(() => expect(store.getState().projectId).toBe(record.id));
    expect(screen.getByLabelText('Edit project title')).toHaveTextContent('Router Test Project');
  });

  it('an unknown path redirects to the dashboard', async () => {
    const store = makeStore();
    window.history.pushState({}, '', '/nope');

    render(<AppRouter store={store} db={db} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ScoreSmith' })).toBeInTheDocument());
    expect(window.location.pathname).toBe('/');
  });

  it('a nonexistent project id falls back to the dashboard with an error toast', async () => {
    const store = makeStore();
    window.history.pushState({}, '', '/project/does-not-exist');

    render(<AppRouter store={store} db={db} />);

    await waitFor(() => expect(window.location.pathname).toBe('/'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'ScoreSmith' })).toBeInTheDocument());
  });
});
