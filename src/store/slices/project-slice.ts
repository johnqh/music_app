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
import { originAfterJob, repairScore } from '@sudobility/music_types';
import type {
  GenerationJobKind,
  GenerationRecord,
  ProjectCreateOrigin,
  ProjectOrigin,
  ProjectSaveResult,
  Score,
} from '@sudobility/music_types';
import type { LiveScoreMeta } from '@sudobility/music_client';
import type { TransportStopper } from '../document-store.js';
import { createDocumentSaver } from '../../services/persistence/document-saver.js';
import type { DocumentSaver } from '../../services/persistence/document-saver.js';
import { projectWrite } from '../../services/persistence/project-write.js';
import { authorizedServer, hasServer, type StoreContext } from '../context.js';
import type { AppState } from '../useAppStore.js';
import { getMusicPosition, getMusicPositionSource } from '@sudobility/music_types';
import type { SaveState } from '@sudobility/music_types';
import {
  applyProjectLocalMix,
  carryProjectLocalMix,
  loadProjectLocalUi,
  projectScoreForServer,
  saveProjectLocalUi,
  type ProjectLocalUiState,
} from '../../services/persistence/project-ui.js';

export type NewProjectInput = {
  name: string;
  score?: Score;
  /**
   * Where the project came from, as only the creator can say — the file an
   * import read, or nothing. Omitted, the server records `blank`.
   */
  origin?: ProjectCreateOrigin;
};

/** What a generation's final score arrives with, from the live stream. */
export type LiveResultMeta = {
  /** The project the stream belongs to; refused when it is not the open one. */
  projectId: string;
  /** The server's stamp for the score, as `GET /projects/:id` would report it. */
  serverUpdatedAt: string;
  lastGeneration?: GenerationRecord | undefined;
  /**
   * The job that produced the score, so the origin the server wrote for a
   * generated project can be mirrored here without re-reading the row: the
   * stream carries the score and nothing about where the project came from.
   */
  job?: { id: string; kind: GenerationJobKind } | null;
};

export type ProjectSlice = {
  projectId: string | null;
  projectName: string;
  /**
   * The open project's last whole-score generation — what was asked for and
   * the choices it was built from — or null. Kept so the editor can show the
   * choices and generate again with some of them locked.
   */
  lastGeneration: GenerationRecord | null;
  /**
   * Where the open project came from — the job, file, recording or project
   * it was made from — or null before a project is open and for a project
   * written before the server recorded it.
   */
  origin: ProjectOrigin | null;
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
  /**
   * Shows a score the server is writing right now — a live generation's
   * snapshot or one of its partials — without dirtying the project, moving
   * the caret, or treating it as this client's edit (the server holds it
   * already, and a PUT of it back would be refused with a 409). False when
   * `projectId` is not the open project, which is a stream outliving the
   * editor that opened it, or while the transport is playing; the caller
   * asks again a moment later.
   */
  applyLiveScore: (score: Score, meta: LiveScoreMeta) => boolean;
  /**
   * Adopts a generation's final score straight from the stream, as
   * `openProject` would after a poll noticed it: the transport stops, the
   * history resets, and the project is clean at the server's stamp. False
   * when the project is no longer the open one.
   */
  adoptLiveResult: (score: Score, transport: TransportStopper, result: LiveResultMeta) => boolean;
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
      const mixedScore = applyProjectLocalMix(score, localUi);
      // A generated score may already be complete by the time the editor
      // opens it, so generation polling is not guaranteed to observe an
      // "applied" transition. Repair generated output at the adoption
      // boundary as well, then persist it before the editor becomes dirty.
      let localScore = mixedScore;
      let repairedGeneratedScore = false;
      if (project.lastGeneration) {
        for (let pass = 0; pass < 16; pass += 1) {
          const repair = repairScore(localScore);
          localScore = repair.score;
          if (Object.keys(repair.fixed).length > 0) repairedGeneratedScore = true;
          if (
            Object.keys(repair.remaining).length === 0 ||
            Object.keys(repair.fixed).length === 0
          ) {
            break;
          }
        }
      }
      attachAutosaver(localScore);
      set((state) => {
        state.projectId = project.id;
        state.projectName = project.name;
        state.lastGeneration = project.lastGeneration ?? null;
        state.origin = project.origin ?? null;
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
      if (repairedGeneratedScore) {
        get().markDirty();
        await get().saveNow();
      }
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
      origin: null,
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
          {
            name: input.name,
            score: projectScoreForServer(score),
            ...(input.origin ? { origin: input.origin } : {}),
          },
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

      applyLiveScore: (score, meta) => {
        if (!currentProject || currentProject.id !== meta.projectId) return false;
        // Play is disabled while a job runs; this is the guard behind it. A
        // score swapped under a running player is read as a mix change, and
        // the old music goes on playing out of its queue.
        if (get().state === 'playing') return false;
        const mixed = carryProjectLocalMix(get().score, score);
        // A snapshot is a new document as far as undo goes; a partial is the
        // same one with more written, and the caret stays where the reader
        // left it either way.
        get().setScore(mixed, { resetHistory: meta.reason === 'snapshot', resetPosition: false });
        autosaver?.adopted(get().score ?? mixed);
        set((state) => {
          if (meta.serverUpdatedAt) state.serverUpdatedAt = meta.serverUpdatedAt;
          state.dirty = false;
          state.saveState = 'saved';
        });
        return true;
      },

      adoptLiveResult: (score, transport, result) => {
        if (!currentProject || currentProject.id !== result.projectId) return false;
        // Stop first: this write bypasses the edit lock, and a controller
        // still running would read the new score as a mix change.
        transport.stop();
        const mixed = carryProjectLocalMix(get().score, score);
        get().setScore(mixed, { resetHistory: true });
        autosaver?.adopted(get().score ?? mixed);
        currentProject = {
          ...currentProject,
          updatedAt: result.serverUpdatedAt,
          ...(result.lastGeneration ? { lastGeneration: result.lastGeneration } : {}),
        };
        set((state) => {
          state.serverUpdatedAt = result.serverUpdatedAt;
          if (result.lastGeneration) state.lastGeneration = result.lastGeneration;
          // The same rule the server applied to the row, so a project that
          // was blank a moment ago reads as generated without a re-read.
          if (result.job) {
            state.origin = originAfterJob(state.origin, result.job.kind, result.job.id);
          }
          state.dirty = false;
          state.saveState = 'saved';
        });
        return true;
      },
    };
  };
}
