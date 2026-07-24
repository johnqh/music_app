import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppStore } from '@/store/useAppStore';
import { ScoreSmithDb } from '@/services/persistence/db';
import { listProjects, loadProject } from '@/services/persistence/projects';
import { changeMetadataCommand } from '@/domain/commands/structure-commands';
import { twinkleScore } from '@/test/fixtures';

// Deliberately no `vi.useFakeTimers()` anywhere in this file: `createAutosaver`'s
// debounce timer shares the event loop with fake-indexeddb's own internal
// request scheduling (real timers/microtasks), and faking one hangs the
// other (see the same note in `services/persistence/projects.test.ts`).
// Debounce *timing* itself is already covered by `services/persistence/
// autosave.test.ts` against a fake `save` callback with no IndexedDB
// involved; here we only need to prove project-slice wires markDirty ->
// autosaver.notifyChange -> (eventually) a real `saveProject` call, which
// `saveNow()`'s immediate `flush()` exercises without waiting out the debounce.

let db: ScoreSmithDb;
let dbCounter = 0;

beforeEach(() => {
  dbCounter += 1;
  db = new ScoreSmithDb(`scoresmith-test-project-slice-${dbCounter}`);
});

afterEach(async () => {
  await db.delete();
});

describe('project-slice', () => {
  describe('newProject', () => {
    it('persists a new project, adopts its score with fresh history, and marks it saved', async () => {
      const store = createAppStore({ db });

      await store.getState().newProject({ name: 'My Song', score: twinkleScore() });

      const state = store.getState();
      expect(state.projectName).toBe('My Song');
      expect(state.projectId).not.toBeNull();
      expect(state.score?.metadata.title).toBe('Twinkle Twinkle Little Star');
      expect(state.dirty).toBe(false);
      expect(state.saveState).toBe('saved');
      expect(state.canUndo).toBe(false);

      const rows = await listProjects(db);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(state.projectId);
    });

    it('builds an empty score when none is given', async () => {
      const store = createAppStore({ db });
      await store.getState().newProject({ name: 'Blank' });
      expect(store.getState().score?.tracks.length).toBeGreaterThan(0);
    });
  });

  describe('openProject', () => {
    it('loads an existing project by id and adopts its score with fresh history', async () => {
      const store = createAppStore({ db });
      await store.getState().newProject({ name: 'First', score: twinkleScore() });
      const firstId = store.getState().projectId!;
      await store.getState().newProject({ name: 'Second', score: twinkleScore() });
      expect(store.getState().projectId).not.toBe(firstId);

      await store.getState().openProject(firstId);

      const state = store.getState();
      expect(state.projectId).toBe(firstId);
      expect(state.projectName).toBe('First');
      expect(state.dirty).toBe(false);
      expect(state.saveState).toBe('saved');
    });
  });

  describe('markDirty / autosave', () => {
    it('dispatchCommand marks the project dirty, and flushing the autosave persists the change', async () => {
      const store = createAppStore({ db });
      await store.getState().newProject({ name: 'Editable', score: twinkleScore() });
      const projectId = store.getState().projectId!;

      store.getState().dispatchCommand(changeMetadataCommand({ title: 'Renamed Live' }));
      expect(store.getState().dirty).toBe(true);
      expect(store.getState().saveState).toBe('unsaved');

      await store.getState().saveNow();

      expect(store.getState().dirty).toBe(false);
      expect(store.getState().saveState).toBe('saved');
      const persisted = await loadProject(db, projectId);
      expect(persisted.score.metadata.title).toBe('Renamed Live');
    });
  });

  describe('saveNow', () => {
    it('flushes a pending autosave immediately', async () => {
      const store = createAppStore({ db });
      await store.getState().newProject({ name: 'Manual Save', score: twinkleScore() });
      const projectId = store.getState().projectId!;
      store.getState().dispatchCommand(changeMetadataCommand({ title: 'Saved Now' }));

      await store.getState().saveNow();

      expect(store.getState().saveState).toBe('saved');
      const persisted = await loadProject(db, projectId);
      expect(persisted.score.metadata.title).toBe('Saved Now');
    });

    it('is a no-op when no project has been opened yet', async () => {
      const store = createAppStore({ db });
      await expect(store.getState().saveNow()).resolves.toBeUndefined();
    });
  });
});
