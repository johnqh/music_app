import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createAppStore } from '@/store/useAppStore';
import { ScoreSmithDb } from '@/services/persistence/db';
import * as settingsModule from '@/services/persistence/settings';
import { getSetting } from '@/services/persistence/settings';
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
  window.history.pushState({}, '', '/');
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders the ScoreSmith title (dashboard, the default route)', async () => {
    const store = makeStore();
    render(<App store={store} db={db} />);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'ScoreSmith' })).toBeInTheDocument());
  });

  // Regression coverage for a review finding on the `?seed=` bootstrap
  // (spec §30/§31 -- e2e determinism): a URL-sourced seed must win for
  // *this* load without silently becoming the new persisted default, or a
  // single `?seed=42` visit would permanently overwrite whatever seed was
  // actually stored, and every later visit without the param would keep
  // loading "42" forever.
  describe('?seed= URL param', () => {
    it('applies a URL seed to devSettings without persisting it over the previously-stored seed', async () => {
      const store = makeStore();
      // `developerMode` pre-seeded to a non-default value (the store's own
      // default is `false`) so bootstrap actually changes it, guaranteeing
      // its persist effect -- declared immediately before the mockSeed
      // persist effect -- genuinely fires this render, rather than bailing
      // out early because the loaded value already matched the default.
      // React flushes one commit's passive effects together, in
      // declaration order, so once *that* persist call has landed, the
      // mockSeed persist effect (declared right after it) has also already
      // run (or deliberately skipped) for this same commit -- a safe,
      // non-racy point to assert it was skipped.
      await settingsModule.setSetting(db, 'developerMode', true);
      await settingsModule.setSetting(db, 'mockSeed', 'previously-stored-seed');
      const setSettingSpy = vi.spyOn(settingsModule, 'setSetting');

      window.history.pushState({}, '', '/?seed=from-url-seed');
      render(<App store={store} db={db} />);

      await waitFor(() => expect(store.getState().devSettings.seed).toBe('from-url-seed'));
      await waitFor(() => expect(setSettingSpy).toHaveBeenCalledWith(db, 'developerMode', true));

      expect(setSettingSpy).not.toHaveBeenCalledWith(db, 'mockSeed', expect.anything());
      await expect(getSetting(db, 'mockSeed', 'DEFAULT')).resolves.toBe('previously-stored-seed');
    });

    it('still persists a real Developer Settings seed change made after a URL-seeded load', async () => {
      const store = makeStore();
      await settingsModule.setSetting(db, 'mockSeed', 'previously-stored-seed');

      window.history.pushState({}, '', '/?seed=from-url-seed');
      render(<App store={store} db={db} />);
      await waitFor(() => expect(store.getState().devSettings.seed).toBe('from-url-seed'));

      store.getState().setDevSettings({ seed: 'manually-changed-seed' });

      await waitFor(async () => {
        await expect(getSetting(db, 'mockSeed', 'DEFAULT')).resolves.toBe('manually-changed-seed');
      });
    });
  });
});
