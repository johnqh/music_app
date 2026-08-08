/**
 * Driving one project's generation job from the editor.
 *
 * Polls rather than subscribing: the work takes minutes, so seconds of
 * latency cost nothing and a poll survives a reconnect for free.
 *
 * `start` flushes any pending autosave before submitting. This is the same
 * discipline snapshots need (see AppLayout's snapshot flush): the server
 * builds nothing from the browser's in-memory score, so an unsaved edit made
 * a moment earlier would be invisible to the job and then overwritten by its
 * result.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerationJob, GenerationJobKind } from '@sudobility/music_types';
import { useAppStore } from '@sudobility/music_lib';
import type { MusicClient } from '@sudobility/music_client';
import { getAppServices } from '@/config/initialize';
import type { EditorStoreApi } from '@/features/score-editor/editing';

/** Matches the server-side poll cadence in music_client's own hook. */
const POLL_MS = 3000;

export type ProjectGeneration = {
  /** True from the moment a job is submitted until it reaches a terminal status. */
  generating: boolean;
  jobId: string | null;
  /** A failed job's message, cleared when the next one starts. */
  error: string | null;
  start: (kind: GenerationJobKind, request: unknown) => Promise<void>;
  cancel: () => Promise<void>;
};

export type UseProjectGenerationOptions = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store. */
  store?: EditorStoreApi;
  /** Defaults to the app services' client; tests inject a stub. */
  client?: Pick<
    MusicClient,
    'createJob' | 'getJob' | 'cancelJob' | 'cancelProjectGeneration' | 'getProjectStatus'
  >;
  /** Defaults to the app services' auth token getter. */
  getToken?: () => Promise<string | null>;
  /** Called when the server's copy has moved on, so the caller can reload it. Awaited before the editor unlocks. */
  onApplied?: () => void | Promise<void>;
  pollMs?: number;
};

export function useProjectGeneration(
  projectId: string | null,
  options: UseProjectGenerationOptions = {},
): ProjectGeneration {
  const { store = useAppStore, onApplied, pollMs = POLL_MS } = options;

  const [jobId, setJobId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read inside the interval callback, never as a dep: re-creating the timer
  // on every render would reset the poll clock continuously.
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;

  /**
   * The server's `updatedAt` as of the last poll.
   *
   * A witnessed `generating -> ready` transition is not enough: open a project
   * in the instant its job finishes and the transition happens in the gap
   * between the fetch and the first poll, so the editor keeps the placeholder
   * score forever. Comparing freshness catches that, and any other change the
   * server makes, without needing to have seen it happen.
   *
   * Refs, not effect-locals: `start()` sets `jobId`, which re-runs the poll
   * effect, and a local would forget everything it had already seen.
   */
  const lastUpdatedAtRef = useRef<string | null>(null);

  const services = useCallback(() => {
    const client = options.client ?? getAppServices().musicClient;
    const getToken = options.getToken ?? (() => getAppServices().auth.getToken());
    return { client, getToken };
  }, [options.client, options.getToken]);

  const start = useCallback(
    async (kind: GenerationJobKind, request: unknown): Promise<void> => {
      if (!projectId) return;
      setError(null);
      try {
        // Flush first: the job reads the *stored* score, so a pending edit
        // would be invisible to it and then overwritten by its result.
        await store.getState().saveNow();

        const { client, getToken } = services();
        const token = await getToken();
        if (!token) throw new Error('You must be signed in.');

        const job = await client.createJob({ projectId, kind, request }, token);
        setJobId(job.id);
        setGenerating(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setGenerating(false);
      }
    },
    [projectId, services, store],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const id = jobId;
    // Optimistic: the server releases the project synchronously, and the
    // editor should unlock now rather than after a round trip.
    setGenerating(false);
    setJobId(null);
    try {
      const { client, getToken } = services();
      const token = await getToken();
      if (!token) return;
      // Cancel by project when this hook did not start the job — a generation
      // begun on the dashboard is perfectly cancellable from the editor.
      if (id) await client.cancelJob(id, token);
      else if (projectId) await client.cancelProjectGeneration(projectId, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [jobId, projectId, services]);

  /**
   * Tracks the **project's** status, not just a job this hook started.
   *
   * A generation begun on the dashboard belongs to no job id here, so a
   * job-only poll left the editor showing the placeholder score forever: no
   * overlay, no reload, nothing to tell you it was still working. The project
   * status is the one thing that answers "can I be edited right now", whoever
   * started the job — which is exactly why the server keeps it.
   */
  useEffect(() => {
    if (!projectId) return;
    let stopped = false;

    const check = async (): Promise<void> => {
      try {
        const { client, getToken } = services();
        const token = await getToken();
        if (!token || stopped) return;

        // Status only: the score cannot change while generating (writes are
        // rejected), so refetching it every few seconds is pure waste — and
        // under load it was enough to time jobs out.
        const { status, updatedAt } = await client.getProjectStatus(projectId, token);
        if (stopped) return;

        // First observation only records where things stand; it must not be
        // read as a change, or every mount would refetch and clobber unsaved
        // local edits.
        const previous = lastUpdatedAtRef.current;
        lastUpdatedAtRef.current = updatedAt;

        if (status === 'generating') {
          setGenerating(true);
          return;
        }

        // Reload *before* unlocking. Clearing the cover first shows the old
        // music as though it were the result, and a reader who starts editing
        // in that window has their work replaced a moment later.
        if (previous !== null && previous !== updatedAt) await onAppliedRef.current?.();
        if (stopped) return;
        setGenerating(false);

        // A job we started that ended badly still owes an explanation.
        if (jobId) {
          const job: GenerationJob = await client.getJob(jobId, token);
          if (!stopped && job.status === 'failed') setError(job.error ?? 'Generation failed.');
        }
      } catch (err) {
        // A transient poll failure is not a finished job — keep polling rather
        // than unlocking an editor whose project is still generating.
        //
        // But a TypeError here is a programming error, not a blip (a stale
        // bundle missing a client method once hid behind this catch for a
        // whole test run), so it is surfaced rather than swallowed.
        if (err instanceof TypeError) {
          console.error('[generation] poll failed', err);
          setError(err.message);
        }
      }
    };

    void check();
    const timer = setInterval(() => void check(), pollMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [projectId, jobId, pollMs, services]);

  return { generating, jobId, error, start, cancel };
}
