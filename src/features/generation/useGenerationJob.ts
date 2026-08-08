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
  client?: Pick<MusicClient, 'createJob' | 'getJob' | 'cancelJob'>;
  /** Defaults to the app services' auth token getter. */
  getToken?: () => Promise<string | null>;
  /** Called once when a job finishes successfully, so the caller can reload the applied score. */
  onApplied?: () => void;
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
    if (!id) return;
    try {
      const { client, getToken } = services();
      const token = await getToken();
      if (token) await client.cancelJob(id, token);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [jobId, services]);

  useEffect(() => {
    if (!jobId || !generating) return;
    let cancelled = false;

    const check = async (): Promise<void> => {
      try {
        const { client, getToken } = services();
        const token = await getToken();
        if (!token || cancelled) return;
        const job: GenerationJob = await client.getJob(jobId, token);
        if (cancelled || job.status === 'running') return;

        setGenerating(false);
        if (job.status === 'failed') setError(job.error ?? 'Generation failed.');
        // 'cancelled' needs no message: the person who cancelled it knows.
        if (job.status === 'done') onAppliedRef.current?.();
      } catch {
        // A transient poll failure is not a job failure — keep polling rather
        // than unlocking an editor whose project is still generating.
      }
    };

    void check();
    const timer = setInterval(() => void check(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [jobId, generating, pollMs, services]);

  return { generating, jobId, error, start, cancel };
}
