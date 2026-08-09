import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, configure, renderHook, waitFor } from '@testing-library/react';
import { createAppStore, testStoreContext, twinkleScore } from '@sudobility/music_lib';
import type { GenerationJob, GenerationJobStatus } from '@sudobility/music_types';
import { useProjectGeneration } from '@/features/generation/useGenerationJob';
import type { UseProjectGenerationOptions } from '@/features/generation/useGenerationJob';
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

/** The three methods the hook uses, as spies — typed so a signature change here is a test failure, not a silent `never`. */
type JobClient = {
  createJob: ReturnType<typeof vi.fn>;
  getJob: ReturnType<typeof vi.fn>;
  cancelJob: ReturnType<typeof vi.fn>;
  cancelProjectGeneration: ReturnType<typeof vi.fn>;
  getProjectStatus: ReturnType<typeof vi.fn>;
};

/**
 * A stateful double that mirrors the server's actual sequencing: creating a
 * job flips the project to `generating` in the same transaction, and
 * cancelling releases it. A stateless fake reported `ready` on the very first
 * poll after submitting, which looked like a bug in the hook and was not.
 */
function fakeClient(over: Partial<JobClient> = {}, generating = false): JobClient {
  let status: 'ready' | 'generating' = generating ? 'generating' : 'ready';
  // Advances whenever a job would have written the score.
  const stamp = 't0';
  return {
    createJob: vi.fn(async () => {
      status = 'generating';
      return job('running');
    }),
    getJob: vi.fn(async () => job('running')),
    cancelJob: vi.fn(async () => {
      status = 'ready';
    }),
    cancelProjectGeneration: vi.fn(async () => {
      status = 'ready';
    }),
    getProjectStatus: vi.fn(async () => ({ status, updatedAt: stamp })),
    ...over,
  };
}

function makeStore(): EditorStoreApi {
  const store = createAppStore({ context: testStoreContext() });
  store.getState().setScore(twinkleScore());
  return store;
}

function opts(client: JobClient, extra: Record<string, unknown> = {}) {
  return {
    store: makeStore(),
    client: client as unknown as UseProjectGenerationOptions['client'],
    getToken: async () => 'tok',
    // Both cadences collapsed to nothing: these tests are about what the poll
    // decides, not how long it waits. The gap between them has its own tests.
    pollMs: 5,
    idlePollMs: 5,
    ...extra,
  };
}

/**
 * These wait on the hook's *real* timers, and each tick now waits for the
 * request it made before scheduling the next — so under a loaded parallel run
 * a handful of polls can take longer than the one-second default. Generous
 * here rather than flaky: nothing in this file waits on anything that is not
 * about to happen.
 */
configure({ asyncUtilTimeout: 5000 });

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
      'tok',
    );
  });

  it('flushes a pending save before submitting, so the job sees the current score', async () => {
    // Without this the server generates against a stale score and its result
    // silently overwrites the edit that was still in the debounce window.
    const client = fakeClient();
    const store = makeStore();
    const saveNow = vi.fn(async () => undefined);
    store.setState({ saveNow } as never);

    const { result } = renderHook(() => useProjectGeneration('p1', { ...opts(client), store }));
    await act(async () => {
      await result.current.start('replace-notes', {});
    });

    expect(saveNow).toHaveBeenCalled();
    expect(saveNow.mock.invocationCallOrder[0]).toBeLessThan(
      client.createJob.mock.invocationCallOrder[0],
    );
  });

  it('stops reporting generating once the job is done, and reports it applied', async () => {
    const onApplied = vi.fn();
    let polls = 0;
    const client = fakeClient({
      getJob: vi.fn(async () => job('done')),
      // Generating for the first poll, then done — the job landed.
      getProjectStatus: vi.fn(async () => {
        polls += 1;
        // Generating, then ready with a newer stamp: the job wrote the score.
        return polls <= 1
          ? { status: 'generating', updatedAt: 't0' }
          : { status: 'ready', updatedAt: 't1' };
      }),
    });
    const { result } = renderHook(() => useProjectGeneration('p1', { ...opts(client), onApplied }));

    await act(async () => {
      await result.current.start('replace-notes', {});
    });

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(result.current.generating).toBe(false);
  });

  it("surfaces a failed job's error rather than silently going idle", async () => {
    const client = fakeClient({
      getJob: vi.fn(async () => job('failed', 'provider exploded')),
      getProjectStatus: vi.fn(async () => ({ status: 'ready', updatedAt: 't0' })),
    });
    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await act(async () => {
      await result.current.start('replace-notes', {});
    });

    await waitFor(() => expect(result.current.error).toBe('provider exploded'));
    expect(result.current.generating).toBe(false);
  });

  it('reports no error for a job that was cancelled, since the user did that', async () => {
    const client = fakeClient({
      getJob: vi.fn(async () => job('cancelled')),
      getProjectStatus: vi.fn(async () => ({ status: 'ready', updatedAt: 't0' })),
    });
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
    const getProjectStatus = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('network blip');
      return { status: 'generating', updatedAt: 't0' };
    });
    const client = fakeClient({ getProjectStatus });
    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await act(async () => {
      await result.current.start('replace-notes', {});
    });

    await waitFor(() => expect(calls).toBeGreaterThan(1));
    expect(result.current.generating).toBe(true);
  });

  it('cancels through the endpoint and unlocks once the server has released it', async () => {
    const client = fakeClient();
    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await act(async () => {
      await result.current.start('replace-notes', {});
    });
    await waitFor(() => expect(result.current.generating).toBe(true));

    await act(async () => {
      await result.current.cancel();
    });

    expect(client.cancelJob).toHaveBeenCalledWith('j1', 'tok');
    await waitFor(() => expect(result.current.generating).toBe(false));
  });

  it('stays locked if the cancel never lands, rather than lying about it', async () => {
    // The optimistic unlock is a nicety for the round trip, not a claim: if
    // the server has not actually released the project, editing would 409 and
    // be lost, so the poll correctly puts the cover back.
    const client = fakeClient({ cancelJob: vi.fn(() => new Promise<void>(() => {})) });
    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await act(async () => {
      await result.current.start('replace-notes', {});
    });
    await waitFor(() => expect(result.current.generating).toBe(true));

    act(() => {
      void result.current.cancel();
    });

    await waitFor(() => expect(result.current.generating).toBe(true));
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

describe('useProjectGeneration — generation started elsewhere', () => {
  it('locks the editor for a project already generating, with no job of its own', async () => {
    // Started on the dashboard: this hook has no job id. Watching only its own
    // jobs left the editor showing the placeholder score forever.
    const client = fakeClient({}, true);
    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await waitFor(() => expect(result.current.generating).toBe(true));
    expect(result.current.jobId).toBeNull();
  });

  it('reloads once that generation finishes', async () => {
    const onApplied = vi.fn();
    let polls = 0;
    const client = fakeClient({
      getProjectStatus: vi.fn(async () => {
        polls += 1;
        // Generating, then ready with a newer stamp: the job wrote the score.
        return polls <= 1
          ? { status: 'generating', updatedAt: 't0' }
          : { status: 'ready', updatedAt: 't1' };
      }),
    });
    const { result } = renderHook(() => useProjectGeneration('p1', { ...opts(client), onApplied }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
    expect(result.current.generating).toBe(false);
  });

  it('does not reload a project that was never generating, which would clobber local edits', async () => {
    const onApplied = vi.fn();
    const client = fakeClient();
    renderHook(() => useProjectGeneration('p1', { ...opts(client), onApplied }));

    await waitFor(() => expect(client.getProjectStatus).toHaveBeenCalled());
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('cancels by project when it has no job id', async () => {
    const client = fakeClient({}, true);
    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));
    await waitFor(() => expect(result.current.generating).toBe(true));

    await act(async () => {
      await result.current.cancel();
    });

    expect(client.cancelProjectGeneration).toHaveBeenCalledWith('p1', 'tok');
    expect(client.cancelJob).not.toHaveBeenCalled();
  });
});

describe('useProjectGeneration — freshness', () => {
  it('reloads when the score changed under it, even having never seen it generating', async () => {
    // Open a project in the instant its job finishes and the transition
    // happens between the fetch and the first poll. Waiting to *witness*
    // generating left the editor showing the placeholder score forever.
    const onApplied = vi.fn();
    let polls = 0;
    const client = fakeClient({
      getProjectStatus: vi.fn(async () => {
        polls += 1;
        return { status: 'ready', updatedAt: polls <= 1 ? 't0' : 't1' };
      }),
    });

    renderHook(() => useProjectGeneration('p1', { ...opts(client), onApplied }));

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
  });

  it('does not reload while nothing changes, which would clobber local edits', async () => {
    const onApplied = vi.fn();
    const client = fakeClient();
    renderHook(() => useProjectGeneration('p1', { ...opts(client), onApplied }));

    await waitFor(() => expect(client.getProjectStatus.mock.calls.length).toBeGreaterThan(2));
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('does not reload after this client s own save', async () => {
    // The bug this exists to prevent: autosave bumps `updatedAt`, the poll
    // read any change as somebody else's, and the editor re-downloaded the
    // project it had just uploaded — throwing away the undo history with it,
    // seconds after every edit.
    const onApplied = vi.fn();
    const store = makeStore();
    store.setState({ serverUpdatedAt: 't0' } as never);
    let stamp = 't0';
    const client = fakeClient({
      getProjectStatus: vi.fn(async () => ({ status: 'ready', updatedAt: stamp })),
    });

    renderHook(() => useProjectGeneration('p1', { ...opts(client), store, onApplied }));
    // Let the poll see the project where it stands before anything moves.
    await waitFor(() => expect(client.getProjectStatus.mock.calls.length).toBeGreaterThan(0));

    // The autosave lands: the server moves on, and the store records where it
    // left it. The poll's own memory still says t0 — which is exactly what
    // used to make this look like somebody else's write.
    stamp = 't1';
    store.setState({ serverUpdatedAt: 't1' } as never);

    await waitFor(() => expect(client.getProjectStatus.mock.calls.length).toBeGreaterThan(3));
    expect(onApplied).not.toHaveBeenCalled();

    // A change this client did *not* make still reloads — the point is to tell
    // them apart, not to stop watching.
    stamp = 't2';
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
  });

  it('does not reload while a save of its own is still in flight', async () => {
    // The write may have committed while its response is in the air: for that
    // moment the server is ahead of anything this client could have recorded,
    // and the newer stamp is still its own.
    const onApplied = vi.fn();
    const store = makeStore();
    store.setState({ serverUpdatedAt: 't0', saveState: 'saving' } as never);
    const client = fakeClient({
      getProjectStatus: vi.fn(async () => ({ status: 'ready', updatedAt: 't1' })),
    });

    renderHook(() => useProjectGeneration('p1', { ...opts(client), store, onApplied }));

    await waitFor(() => expect(client.getProjectStatus.mock.calls.length).toBeGreaterThan(2));
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('ignores a poll that reports an older stamp than the client already knows', async () => {
    // A poll that started before a save landed answers with the pre-save
    // stamp. Reloading on "different" would send the editor to fetch over the
    // top of the save it raced.
    const onApplied = vi.fn();
    const store = makeStore();
    store.setState({ serverUpdatedAt: 't5' } as never);
    const client = fakeClient({
      getProjectStatus: vi.fn(async () => ({ status: 'ready', updatedAt: 't4' })),
    });

    renderHook(() => useProjectGeneration('p1', { ...opts(client), store, onApplied }));

    await waitFor(() => expect(client.getProjectStatus.mock.calls.length).toBeGreaterThan(2));
    expect(onApplied).not.toHaveBeenCalled();
  });
});

describe('useProjectGeneration — cadence', () => {
  it('backs off when nothing is generating', async () => {
    // An idle editor polled every three seconds forever — ~1,200 requests an
    // hour per open tab, to learn nothing.
    const client = fakeClient();
    renderHook(() =>
      useProjectGeneration('p1', { ...opts(client), pollMs: 5, idlePollMs: 100_000 }),
    );

    await waitFor(() => expect(client.getProjectStatus).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(client.getProjectStatus).toHaveBeenCalledTimes(1);
  });

  it('polls at the running cadence once a job is started', async () => {
    const client = fakeClient();
    const { result } = renderHook(() =>
      useProjectGeneration('p1', { ...opts(client), pollMs: 5, idlePollMs: 100_000 }),
    );

    await act(async () => {
      await result.current.start('replace-notes', {});
    });

    await waitFor(() => expect(client.getProjectStatus.mock.calls.length).toBeGreaterThan(2));
  });

  it('checks immediately when a hidden tab comes back to the front', async () => {
    // What makes the idle cadence affordable: the wait is never felt, because
    // the moment anyone looks the answer is already being fetched.
    const client = fakeClient();
    renderHook(() =>
      useProjectGeneration('p1', { ...opts(client), pollMs: 5, idlePollMs: 100_000 }),
    );
    await waitFor(() => expect(client.getProjectStatus).toHaveBeenCalledTimes(1));

    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(client.getProjectStatus).toHaveBeenCalledTimes(2));
  });
});

describe('useProjectGeneration — unlock ordering', () => {
  it('reloads before unlocking, so the editor never shows the pre-job score as the result', async () => {
    let reloadDone = false;
    let generatingWhenReloadRan: boolean | null = null;
    // Gated rather than counted: the test has to *observe* the overlay before
    // the job is allowed to finish, or it races the render it depends on.
    let finished = false;
    const client = fakeClient({
      getProjectStatus: vi.fn(async () =>
        finished ? { status: 'ready', updatedAt: 't1' } : { status: 'generating', updatedAt: 't0' },
      ),
    });

    const { result } = renderHook(() =>
      useProjectGeneration('p1', {
        ...opts(client),
        onApplied: async () => {
          // Sampled *after* the reload's own await, not before it. Read at the
          // top, this passes whether or not the hook awaits `onApplied` —
          // an async function runs synchronously up to its first await either
          // way — so it asserted nothing about the ordering it exists for.
          await new Promise((r) => setTimeout(r, 20));
          generatingWhenReloadRan = result.current.generating;
          reloadDone = true;
        },
      }),
    );

    await waitFor(() => expect(result.current.generating).toBe(true));
    finished = true;

    await waitFor(() => expect(reloadDone).toBe(true));
    // Still covered while the refetch was in flight.
    expect(generatingWhenReloadRan).toBe(true);
    await waitFor(() => expect(result.current.generating).toBe(false));
  });
});

describe('useProjectGeneration — poll failures', () => {
  it('stays quiet for a network failure, which fetch reports as a TypeError', async () => {
    // "Failed to fetch" is a TypeError by spec, so treating TypeError as a
    // programming error logged console errors and put a spurious message in
    // the overlay every time a page navigated away mid-poll.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = fakeClient({
      getProjectStatus: vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    });

    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await waitFor(() => expect(client.getProjectStatus).toHaveBeenCalled());
    expect(result.current.error).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('surfaces a genuine programming error, which would otherwise hide forever', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = fakeClient({
      getProjectStatus: vi.fn(async () => {
        throw new TypeError('client.getProjectStatus is not a function');
      }),
    });

    const { result } = renderHook(() => useProjectGeneration('p1', opts(client)));

    await waitFor(() => expect(result.current.error).toMatch(/is not a function/));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
