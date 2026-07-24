/**
 * Project slice (spec §18, §19): project identity (`projectId`/
 * `projectName`), dirty/save-state tracking, and the actions that create/
 * open/save a project through Task 9's persistence layer. Debounced
 * autosave is wired via `createAutosaver` (spec §18: "autosave; manual
 * save"): every mutation that goes through `score-slice` (`dispatchCommand`
 * /`undo`/`redo`) calls this slice's `markDirty()`, which notifies the
 * autosaver.
 *
 * Unlike the other slices, this one needs a `ScoreSmithDb` instance, which
 * isn't part of `AppState` (a `Dexie` handle has no business living in
 * reactive store state) — `createProjectSlice(db)` is a factory that
 * closes over it, matching this codebase's DI convention of always
 * threading `db` in explicitly (see `services/persistence/*`) so tests can
 * supply an in-memory `fake-indexeddb` database instead of the real one.
 */
import type { StateCreator } from 'zustand';
import { createEmptyScore } from '@/domain/score/factory';
import type { Score } from '@/domain/score/types';
import type { ProjectRecord, ScoreSmithDb } from '@/services/persistence/db';
import { createProject, loadProject, saveProject } from '@/services/persistence/projects';
import { createAutosaver } from '@/services/persistence/autosave';
import type { Autosaver } from '@/services/persistence/autosave';
import type { AppState } from '@/store/useAppStore';

export type SaveState = 'saved' | 'saving' | 'unsaved';

export type NewProjectInput = { name: string; score?: Score };

export type ProjectSlice = {
  projectId: string | null;
  projectName: string;
  dirty: boolean;
  saveState: SaveState;

  /** Creates and persists a brand-new project, then loads its score (fresh undo history) into `score-slice`. */
  newProject: (input: NewProjectInput) => Promise<void>;
  /** Loads an existing project by id, then loads its score (fresh undo history) into `score-slice`. */
  openProject: (id: string) => Promise<void>;
  /** Flushes any pending autosave immediately (spec §18: "manual save"). No-op if nothing is dirty or no project is open. */
  saveNow: () => Promise<void>;
  /** Marks the current project dirty and notifies the autosaver. Called by `score-slice` after every `dispatchCommand`/`undo`/`redo`, and by `generation-slice` after `generate()`; not normally called directly by UI code. */
  markDirty: () => void;
};

export function createProjectSlice(
  db: ScoreSmithDb,
): StateCreator<AppState, [['zustand/immer', never]], [], ProjectSlice> {
  return (set, get) => {
    let currentRecord: ProjectRecord | null = null;
    let autosaver: Autosaver | null = null;

    function attachAutosaver(): Autosaver {
      autosaver?.dispose();
      const next = createAutosaver(async () => {
        const record = currentRecord;
        const score = get().score;
        if (!record || !score) return;
        set((state) => {
          state.saveState = 'saving';
        });
        const saved = await saveProject(db, { ...record, score });
        currentRecord = saved;
        set((state) => {
          state.saveState = 'saved';
          state.dirty = false;
        });
      });
      autosaver = next;
      return next;
    }

    function adopt(record: ProjectRecord): void {
      currentRecord = record;
      attachAutosaver();
      set((state) => {
        state.projectId = record.id;
        state.projectName = record.name;
        state.dirty = false;
        state.saveState = 'saved';
      });
      get().setScore(record.score, { resetHistory: true });
    }

    return {
      projectId: null,
      projectName: '',
      dirty: false,
      saveState: 'saved',

      newProject: async (input) => {
        const score = input.score ?? createEmptyScore({ title: input.name });
        const record = await createProject(db, { name: input.name, score });
        adopt(record);
      },

      openProject: async (id) => {
        const record = await loadProject(db, id);
        adopt(record);
      },

      saveNow: async () => {
        if (!autosaver) return;
        await autosaver.flush();
      },

      markDirty: () => {
        set((state) => {
          state.dirty = true;
          state.saveState = 'unsaved';
        });
        autosaver?.notifyChange();
      },
    };
  };
}
