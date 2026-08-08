import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createAppStore, testStoreContext, twinkleScore } from '@sudobility/music_lib';
import type { GenerationJob, GenerationJobStatus } from '@sudobility/music_types';
import { useProjectGeneration } from '@/features/generation/useGenerationJob';
import type { EditorStoreApi } from '@/features/score-editor/editing';

function job(status: GenerationJobStatus, error: string | null = null): GenerationJob {
  return {
    id: 'j1',
    projectId: 'p1',
    kind: 'replace-notes',
    status,
    createdAt: '2026-08-07T00:00:00.000Z',
    finishedAt: status === 'running' ? null : '2026-08-07T00:01:00.000Z',
    error,
  };
}

function fakeClient(over: Partial<Record<'createJob' | 'getJob' | 'cancelJob', unknown>> = {}) {
  return {
    createJob: vi.fn(async () => job('running')),
    getJob: vi.fn(async () => job('running')),
    cancelJob: vi.fn(async () => undefined),
    ...over,
  } as never;
}

function makeStore(): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twinkleScore());
  return store;
}

function opts(client: unknown, extra: Record<string, unknown> = {}) {
  return {
    store: makeStore(),
    client: client as never,
    getToken: async () => 'tok',
    pollMs: 5,
    ...extra,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('useProjectGeneration', () => {
  it('reports generating once a job has been started', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await act(async () => {
      await result.current.start('replace-notes', { instruction: 'x' });
    });

    expect(result.current.generating).toBe(true);
    expect(result.current.jobId).toBe('j1');
  });

  it('submits the kind and request it was given', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await act(async () => {
      await result.current.start('replace-track', { instruction: 'swing' });
    });

    expect(client.createJob).toHaveBeenCalledWith(
      { projectId: 'p1', kind: 'replace-track', request: { instruction: 'swing' } },
      'tok'
    );
  });

  it('flushes a pending save before submitting, so the job sees the current score', async () => {
    // Without this the server generates against a stale score and its result
    // silently overwrites the edit that was still in the debounce window.
    const client = fakeClient();
    const store = makeStore();
    const saveNow = vi.fn(async () => undefined);
    store.setState({ saveNow } as never);

    const { result } = renderHook(() =>
      useProjectGeneration('p1', { ...opts(client), store })
    );
    await act(async () => {
      await result.current.start('replace-notes', {});
    });

    expect(saveNow).toHaveBeenCalled();
    expect(saveNow.mock.invocationCallOrder[0]).toBeLessThan(
      client.createJob.mock.invocationCallOrder[0]
    );
  });

  it('stops reporting generating once the job is done, and reports it applied', async () => {
    const onApplied = vi.fn();
    const client = fakeClient({ getJob: vi.fn(async () => job('done')) });
    const { result } = renderHook(() =>
      useProjectGeneration('p1', { ...opts(client), onApplied })
    );

    await act(async () => {
      await result.current.start('replace-notes', {});
    });

    await waitFor(() => expect(result.current.generating).toBe(false));
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed job's error rather than silently going idle", async () => {
    const client = fakeClient({ getJob: vi.fn(async () => job('failed', 'provider exploded')) });
    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await act(async () => {
      await result.current.start('replace-notes', {});
    });

    await waitFor(() => expect(result.current.error).toBe('provider exploded'));
    expect(result.current.generating).toBe(false);
  });

  it('reports no error for a job that was cancelled, since the user did that', async () => {
    const client = fakeClient({ getJob: vi.fn(async () => job('cancelled')) });
    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await act(async () => {
      await result.current.start('replace-notes', {});
    });

    await waitFor(() => expect(result.current.generating).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it('keeps polling through a transient failure rather than unlocking the editor', async () => {
    // A network blip is not a finished job; unlocking here would let the user
    // edit a project the server still considers generating.
    let calls = 0;
    const getJob = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('network blip');
      return job('running');
    });
    const client = fakeClient({ getJob });
    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await act(async () => {
      await result.current.start('replace-notes', {});
    });

    await waitFor(() => expect(calls).toBeGreaterThan(1));
    expect(result.current.generating).toBe(true);
  });

  it('cancel calls the endpoint and unlocks immediately, without waiting for the round trip', async () => {
    let resolveCancel: () => void = () => {};
    const cancelJob = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveCancel = res;
        })
    );
    const client = fakeClient({ cancelJob });
    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await act(async () => {
      await result.current.start('replace-notes', {});
    });

    act(() => {
      void result.current.cancel();
    });

    // Unlocked synchronously — before the token is even fetched, let alone
    // before the request resolves. That is the point: the editor must not
    // stay greyed out for a round trip.
    expect(result.current.generating).toBe(false);

    await waitFor(() => expect(cancelJob).toHaveBeenCalledWith('j1', 'tok'));
    // Still unlocked while the request is in flight.
    expect(result.current.generating).toBe(false);
    await act(async () => {
      resolveCancel();
    });
  });

  it('does nothing without a project id', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useProjectGeneration(null, opts(client)));

    await act(async () => {
      await result.current.start('replace-notes', {});
    });

    expect(client.createJob).not.toHaveBeenCalled();
    expect(result.current.generating).toBe(false);
  });

  it('surfaces a submit failure and does not lock the editor', async () => {
    const client = fakeClient({
      createJob: vi.fn(async () => {
        throw new Error('quota exceeded');
      }),
    });
    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await act(async () => {
      await result.current.start('replace-notes', {});
    });

    expect(result.current.error).toBe('quota exceeded');
    expect(result.current.generating).toBe(false);
  });
});
