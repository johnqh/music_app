import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createAppStore } from '@/store/useAppStore';
import { ScoreSmithDb } from '@/services/persistence/db';
import { App } from '@/app/App';
import type { EditorStoreApi } from '@/features/score-editor/editing';

// App renders the dashboard (default route), which mounts MidiImportWizard/
// MusicXmlImportDialog (closed) -- both reach the app-wide playbackController
// singleton indirectly through AppLayout on the /project/:id route only, but
// App itself doesn't reach it on '/'. Mocked anyway for safety/consistency
// with the rest of this suite's pattern, since router.tsx doesn't gate it.
vi.mock('@/services/playback/controller', () => ({
  playbackController: { togglePlay: vi.fn(), stop: vi.fn(), stopPreview: vi.fn() },
}));

let db: ScoreSmithDb;
let dbCounter = 0;

function makeStore(): EditorStoreApi {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-app-${dbCounter}`);
  return createAppStore({ db });
}

afterEach(async () => {
  await db?.delete();
});

describe('App', () => {
  it('renders the ScoreSmith title (dashboard, the default route)', async () => {
    const store = makeStore();
    render(<App store={store} db={db} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ScoreSmith' })).toBeInTheDocument());
  });
});
