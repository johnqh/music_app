/**
 * Driving one project's generation job from the editor.
 *
 * Polls rather than subscribing: the work takes minutes, so seconds of
 * latency cost nothing and a poll survives a reconnect for free. The cadence
 * follows what is happening — seconds while a job runs, half a minute while
 * nothing does, nothing at all while the tab is hidden.
 *
 * `start` flushes any pending autosave before submitting. This is the same
 * discipline snapshots need (see AppLayout's snapshot flush): the server
 * builds nothing from the browser's in-memory score, so an unsaved edit made
 * a moment earlier would be invisible to the job and then overwritten by its
 * result.
 */
import { reportGenerationError } from '@/features/credits/report-generation-error';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GenerationJob, GenerationJobKind } from '@sudobility/music_types';
import { useAppStore } from '@sudobility/music_lib';
import type { MusicClient } from '@sudobility/music_client';
import { getAppServices } from '@/config/initialize';
import type { EditorStoreApi } from '@sudobility/music_lib';

/** Matches the server-side poll cadence in music_client's own hook. */
const POLL_MS = 3000;

/**
 * How often the project is checked when *nothing* is generating.
 *
 * The poll has a second job besides watching a job: noticing that the
 * server's copy moved under this editor. That is rare, so asking every three
 * seconds meant ~1,200 requests an hour per open tab to learn nothing. Three
 * seconds is what a running job deserves; half a minute is what an idle
 * project deserves, and a tab brought back to the front checks immediately
 * rather than waiting out the interval.
 */
const IDLE_POLL_MS = 30_000;

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
  /** Cadence while a job is running. */
  pollMs?: number;
  /** Cadence while nothing is generating. Defaults to ten times `pollMs`'s default. */
  idlePollMs?: number;
};

export function useProjectGeneration(
  projectId: string | null,
  options: UseProjectGenerationOptions = {},
): ProjectGeneration {
  const { store = useAppStore, onApplied, pollMs = POLL_MS, idlePollMs = IDLE_POLL_MS } = options;

  const [jobId, setJobId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read inside the interval callback, never as a dep: re-creating the timer
  // on every render would reset the poll clock continuously.
  const onAppliedRef = useRef(onApplied);
  onAppliedRef.current = onApplied;

  /** Which cadence the next tick should use. A ref because the timer reads it, not React. */
  const generatingRef = useRef(generating);
  generatingRef.current = generating;

  /**
   * The server's `updatedAt` as of the last poll, for a store that does not
   * track one of its own.
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
        // Written straight through as well, so the next tick is scheduled at
        // the running-job cadence rather than one idle interval late.
        generatingRef.current = true;
      } catch (err) {
        setGenerating(false);
        generatingRef.current = false;
        // Out of credits opens the store instead. The inline error stays
        // empty in that case: the modal is the message, and a red banner
        // behind it saying the same thing reads as two separate failures.
        if (reportGenerationError(err, { store })) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [projectId, services, store],
  );

  const cancel = useCallback(async (): Promise<void> => {
    const id = jobId;
    // Optimistic: the server releases the project synchronously, and the
    // editor should unlock now rather than after a round trip.
    setGenerating(false);
    generatingRef.current = false;
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
      // Nobody is looking at a hidden tab, and the visibility listener below
      // catches it up the instant somebody is.
      if (document.hidden) return;
      try {
        const { client, getToken } = services();
        const token = await getToken();
        if (!token || stopped) return;

        // Status only: the score cannot change while generating (writes are
        // rejected), so refetching it every few seconds is pure waste — and
        // under load it was enough to time jobs out.
        const { status, updatedAt } = await client.getProjectStatus(projectId, token);
        if (stopped) return;

        /**
         * What this client already knows the server's copy to say.
         *
         * The store's own record when it has one, because that is updated by
         * *this client's* writes as well as by its reads — an autosave used to
         * read as a foreign change here, so every edit was followed by a full
         * re-download of the project it had just uploaded, undo history and
         * all. The ref is the fallback for a store that tracks none.
         */
        const { serverUpdatedAt, saveState } = store.getState();
        const known = serverUpdatedAt ?? lastUpdatedAtRef.current;
        lastUpdatedAtRef.current = updatedAt;

        if (status === 'generating') {
          setGenerating(true);
          generatingRef.current = true;
          return;
        }

        // Strictly newer, not merely different: a poll that started before a
        // save landed reports the older stamp, and "different" would send it
        // to reload over the top of the save it raced.
        //
        // A save still in flight may already have committed while its response
        // is in the air, so for that moment a newer stamp is not evidence of
        // anybody else. The save will record where it left the server, and the
        // next poll compares against that.
        //
        // First observation only records where things stand; it must not be
        // read as a change, or every mount would refetch and clobber unsaved
        // local edits.
        //
        // Reload *before* unlocking. Clearing the cover first shows the old
        // music as though it were the result, and a reader who starts editing
        // in that window has their work replaced a moment later.
        if (saveState !== 'saving' && known !== null && updatedAt > known) {
          await onAppliedRef.current?.();
        }
        if (stopped) return;
        setGenerating(false);
        generatingRef.current = false;

        // A job we started that ended badly still owes an explanation.
        if (jobId) {
          const job: GenerationJob = await client.getJob(jobId, token);
          if (!stopped && job.status === 'failed') setError(job.error ?? 'Generation failed.');
        }
      } catch (err) {
        // A transient poll failure is not a finished job — keep polling rather
        // than unlocking an editor whose project is still generating.
        //
        // A *programming* error is different: a stale bundle missing a client
        // method once hid behind this catch for a whole debugging session, so
        // that is surfaced rather than swallowed.
        //
        // Matched on the message, not `instanceof TypeError`: fetch rejects
        // with a TypeError for ordinary network failures too ("Failed to
        // fetch"), and treating a page navigating away as a bug logged errors
        // and put a spurious message in the overlay.
        const message = err instanceof Error ? err.message : '';
        if (/is not a function|undefined is not an object|Cannot read propert/.test(message)) {
          console.error('[generation] poll failed', err);
          setError(message);
        }
      }
    };

    /**
     * A self-rescheduling timeout rather than an interval, so the cadence can
     * change with what is actually happening: three seconds while a job runs,
     * half a minute while nothing does.
     */
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async (): Promise<void> => {
      await check();
      if (stopped) return;
      timer = setTimeout(() => void tick(), generatingRef.current ? pollMs : idlePollMs);
    };

    // A hidden tab is nobody's editor. Checking on the way back to the front
    // is what makes the idle cadence affordable: the wait is never felt,
    // because the moment anyone looks the answer is already being fetched.
    const onVisible = (): void => {
      if (!document.hidden) void check();
    };
    document.addEventListener('visibilitychange', onVisible);

    void tick();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [projectId, jobId, pollMs, idlePollMs, services, store]);

  return { generating, jobId, error, start, cancel };
}
