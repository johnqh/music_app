/**
 * Project slice (spec §18, §19): project identity (`projectId`/
 * `projectName`), dirty/save-state tracking, and the actions that create/
 * open/save a project — now against music_api via the injected
 * `StoreContext`'s MusicClient (server-side persistence replaced Dexie in
 * Phase 2). Debounced autosave is retained via `createAutosaver`: every
 * mutation that goes through `score-slice` calls `markDirty()`, which
 * notifies the autosaver; the autosaver's save PUTs the name, the ui prefs
 * and — only when it has actually changed — the score to `/projects/:id`.
 *
 * A write returns metadata rather than a record, so the score travels in one
 * direction per save instead of two, and `serverUpdatedAt` records where the
 * server's copy stands so a poller can tell this client's own writes from
 * somebody else's.
 */
import type { StateCreator } from 'zustand';
import { newProjectScore } from '@sudobility/music_lib';
import type { GenerationRecord, ProjectSaveResult, Score } from '@sudobility/music_types';
import { createDocumentSaver } from '../../services/persistence/document-saver.js';
import type { DocumentSaver } from '../../services/persistence/document-saver.js';
import { projectWrite } from '../../services/persistence/project-write.js';
import { authorizedServer, hasServer, type StoreContext } from '../context.js';
import type { AppState } from '../useAppStore.js';
import { getMusicPosition, getMusicPositionSource } from '@sudobility/music_types';
import type { SaveState } from '@sudobility/music_types';
import {
  applyProjectLocalMix,
  loadProjectLocalUi,
  projectScoreForServer,
  saveProjectLocalUi,
  type ProjectLocalUiState,
} from '../../services/persistence/project-ui.js';

export type NewProjectInput = { name: string; score?: Score };

export type ProjectSlice = {
  projectId: string | null;
  projectName: string;
  /**
   * The open project's last whole-score generation — what was asked for and
   * the choices it was built from — or null. Kept so the editor can show the
   * choices and generate again with some of them locked.
   */
  lastGeneration: GenerationRecord | null;
  dirty: boolean;
  saveState: SaveState;
  /**
   * The server's `updatedAt` as of the last read or write this store made.
   *
   * Exists so a client can tell **its own** writes from somebody else's. A
   * poller watching `updatedAt` for "did a generation land" otherwise sees
   * every autosave as a foreign change and re-downloads the project it just
   * uploaded — which also throws away the undo history. Null before a project
   * is open.
   */
  serverUpdatedAt: string | null;
  /**
   * Whether this store has a server behind it at all.
   *
   * Read it to decide what to *offer*, not to decide what to catch: a host
   * that hides the project, generation and publishing affordances when this is
   * false never reaches `ServerUnavailableError`. Fixed for the life of the
   * store — a host does not gain a server halfway through.
   */
  serverAvailable: boolean;

  /** Creates and persists a brand-new project on the server, then loads its score (fresh undo history) into `score-slice`. */
  newProject: (input: NewProjectInput) => Promise<void>;
  /** Loads an existing project by id from the server, then loads its score (fresh undo history) into `score-slice`. */
  openProject: (id: string) => Promise<void>;
  /** Flushes any pending autosave immediately (spec §18: "manual save"). No-op if nothing is dirty or no project is open. */
  saveNow: () => Promise<void>;
  /** Marks the current project dirty and notifies the autosaver. Called by `score-slice` after every `dispatchCommand`/`undo`/`redo`; not normally called directly by UI code. */
  markDirty: () => void;
  /** Persists project-scoped editor preferences without touching the score. */
  localUiChanged: () => void;
  /**
   * Records that the server's copy is at `updatedAt` and that this client
   * already has what it says.
   *
   * For the writes that go around the autosaver — opening a snapshot, or
   * creating one, which re-parents the project row. Without it a poller
   * watching `serverUpdatedAt` reads the change this client just made as a
   * foreign one and reloads a project it is already showing.
   */
  noteServerVersion: (updatedAt: string) => void;
  /** Renames the currently-open project. The new name persists on the next autosave/`saveNow()` flush. No-op if no project is open. */
  renameProject: (name: string) => void;
};

export function createProjectSlice(
  context: StoreContext,
): StateCreator<AppState, [['zustand/immer', never]], [], ProjectSlice> {
  return (set, get) => {
    let currentProject: ProjectSaveResult | null = null;
    let autosaver: DocumentSaver | null = null;
    let localUiTimer: ReturnType<typeof setTimeout> | null = null;
    let positionUnsubscribe: (() => void) | null = null;

    async function persistLocalUi(): Promise<void> {
      const project = currentProject;
      const score = get().score;
      if (!project || !score) return;
      const localUi: ProjectLocalUiState = {
        zoom: get().zoom,
        visibleTrackIds: get().visibleTrackIds ?? undefined,
        mutedTrackIds: score.tracks.filter((track) => track.muted).map((track) => track.id),
        soloTrackIds: score.tracks.filter((track) => track.solo).map((track) => track.id),
        cursorTick: getMusicPosition().reportedTick,
      };
      await saveProjectLocalUi(context.storage, project.id, localUi);
    }

    function scheduleLocalUiSave(): void {
      if (localUiTimer !== null) clearTimeout(localUiTimer);
      localUiTimer = setTimeout(() => {
        localUiTimer = null;
        void persistLocalUi();
      }, 150);
    }

    /*
      A fresh saver per project, so a write queued for the outgoing project can
      never land on the incoming one. The rules — score omitted when unchanged,
      dirty cleared only when what was saved is still what is open, a failure
      toasted and kept dirty — are `createDocumentSaver`'s, shared with the
      per-document store.
    */
    function attachAutosaver(score: Score): DocumentSaver {
      autosaver?.dispose();
      const next = createDocumentSaver<AppState>({
        set,
        get,
        destination: () =>
          currentProject
            ? projectWrite(
                context,
                () => currentProject!.id,
                () => ({
                  name: currentProject!.name,
                }),
                (saved) => {
                  currentProject = saved;
                },
              )
            : null,
      });
      next.adopted(score);
      autosaver = next;
      return next;
    }

    /**
     * Flushes the *outgoing* project's autosaver before `adopt` reassigns
     * `currentProject`: switching projects must never drop a pending
     * debounced write (spec §18). The save callback reads
     * `currentProject`/`get()` at call time, so the flush must complete
     * before identity switches.
     */
    async function flushOutgoing(): Promise<void> {
      if (autosaver) {
        try {
          await autosaver.flush();
        } catch {
          // Already surfaced by the save callback's toast; don't block the switch.
        }
      }
    }

    /**
     * Takes over a project.
     *
     * The score is a separate argument because a *write* no longer returns
     * one: creating a project echoes back everything except the score the
     * caller just sent, so the caller supplies the copy it already has.
     */
    async function adopt(project: ProjectSaveResult, score: Score): Promise<void> {
      await flushOutgoing();
      positionUnsubscribe?.();
      const localUi = await loadProjectLocalUi(context.storage, project.id);
      currentProject = project;
      const localScore = applyProjectLocalMix(score, localUi);
      attachAutosaver(localScore);
      set((state) => {
        state.projectId = project.id;
        state.projectName = project.name;
        state.lastGeneration = project.lastGeneration ?? null;
        state.dirty = false;
        state.saveState = 'saved';
        state.serverUpdatedAt = project.updatedAt;
        // Reset, not merge: a track id means nothing outside the project it
        // came from, so carrying the outgoing project's hidden set into the
        // incoming one would hide arbitrary tracks.
        state.visibleTrackIds = localUi.visibleTrackIds ?? null;
        if (localUi.zoom !== undefined) state.zoom = localUi.zoom;
      });
      get().setScore(localScore, { resetHistory: true });
      if (localUi.cursorTick !== undefined) {
        getMusicPositionSource().moveTo(localUi.cursorTick);
      }
      positionUnsubscribe = getMusicPositionSource().subscribe(() => {
        if (currentProject) scheduleLocalUiSave();
      });
    }

    return {
      projectId: null,
      projectName: '',
      lastGeneration: null,
      dirty: false,
      saveState: 'saved',
      serverUpdatedAt: null,
      serverAvailable: hasServer(context),

      newProject: async (input) => {
        // `newProjectScore`, not a bare empty score: a project always opens
        // with a track to write on. See its own doc for why that is policy
        // here rather than in the factory.
        const score = input.score ?? newProjectScore(input.name);
        const { client, token } = await authorizedServer(context);
        const created = await client.createProject(
          { name: input.name, score: projectScoreForServer(score) },
          token,
        );
        // The score we just sent, not one shipped back to us: the server
        // stored exactly this, and re-downloading it would double the cost of
        // creating a project.
        await adopt(created, score);
      },

      openProject: async (id) => {
        /*
          No "is it loading" flag here, deliberately.

          The editor route asks a simpler question and gets a better answer:
          does the store hold the project the URL names? That is false from the
          first render rather than from whenever an effect got around to
          setting a flag, so nothing paints the previous project first — which
          is exactly what a flag let through, along with an app bar that went
          on naming it.
        */
        const { client, token } = await authorizedServer(context);
        const record = await client.getProject(id, token);
        await adopt(record, record.score);
      },

      saveNow: async () => {
        if (autosaver) await autosaver.flush();
        if (localUiTimer !== null) {
          clearTimeout(localUiTimer);
          localUiTimer = null;
          await persistLocalUi();
        }
      },

      markDirty: () => {
        set((state) => {
          state.dirty = true;
          state.saveState = 'unsaved';
        });
        autosaver?.notifyChange();
      },

      localUiChanged: scheduleLocalUiSave,

      noteServerVersion: (updatedAt) => {
        set((state) => {
          state.serverUpdatedAt = updatedAt;
        });
      },

      renameProject: (name) => {
        if (!currentProject) return;
        currentProject = { ...currentProject, name };
        set((state) => {
          state.projectName = name;
        });
        get().markDirty();
      },
    };
  };
}
