/**
 * The web app's wiring for `useProjectGeneration`.
 *
 * The rules — poll the *project* rather than the job, compare `updatedAt`
 * strictly, reload before unlocking, slow the cadence when nothing is running —
 * live in `@sudobility/music_client`, because they are rules about this server
 * and both apps obey them. What lives here is what only this app knows: which
 * store, which client, how to tell whether anybody is looking, and what to do
 * when the answer is "you are out of credits".
 */
import { useMemo } from 'react';
import { useAppStore } from '@/app-library';
import type { EditorStoreApi } from '@/app-library';
import { useProjectGeneration as useSharedProjectGeneration } from '@sudobility/music_client';
import type {
  ForegroundPort,
  GenerationClient,
  LiveGenerationFinal,
  LiveGenerationOptions,
  ProjectGeneration,
} from '@sudobility/music_client';
import { reportGenerationError } from '@/features/credits/report-generation-error';
import { getAppServices } from '@/config/initialize';

export type { ProjectGeneration };

/**
 * A browser tab is in the foreground when it is not hidden.
 *
 * Module-level rather than built per render: it is passed as a hook dependency,
 * and a fresh object each render would tear down and rebuild the poll timer
 * continuously.
 */
const TAB_FOREGROUND: ForegroundPort = {
  isForeground: () => !document.hidden,
  subscribe: (onForeground) => {
    const handler = (): void => {
      if (!document.hidden) onForeground();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },
};

export type UseProjectGenerationOptions = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store. */
  store?: EditorStoreApi;
  /** Defaults to the app services' client; tests inject a stub. */
  client?: GenerationClient;
  /** Defaults to the app services' auth token getter. */
  getToken?: () => Promise<string | null>;
  /** Called when the server's copy has moved on. Awaited before the editor unlocks. */
  onApplied?: () => void | Promise<void>;
  /**
   * Called with a generation's final score when the live stream delivered it.
   * Awaited before the editor unlocks; `onApplied` is then the polling
   * fallback rather than a second adoption.
   */
  onComplete?: (final: LiveGenerationFinal) => void | Promise<void>;
  /**
   * The live stream. Defaults to the app's API when the client is the app's
   * own; `false` switches it off, and a test that injects a client gets none
   * unless it passes one — a stub client has no socket to open.
   */
  live?: LiveGenerationOptions | false;
  pollMs?: number;
  idlePollMs?: number;
};

export function useProjectGeneration(
  projectId: string | null,
  options: UseProjectGenerationOptions = {},
): ProjectGeneration {
  const { store = useAppStore, onApplied, onComplete, pollMs, idlePollMs } = options;
  const injectedClient = options.client;
  const injectedGetToken = options.getToken;
  const injectedLive = options.live;

  // Resolved lazily and memoized: `getAppServices()` throws before start-up,
  // and a fresh object each render would rebuild the poll timer.
  const client = useMemo(() => injectedClient ?? getAppServices().musicClient, [injectedClient]);
  const getToken = useMemo(
    () => injectedGetToken ?? (() => getAppServices().auth.getToken()),
    [injectedGetToken],
  );
  const live = useMemo<LiveGenerationOptions | false>(() => {
    if (injectedLive !== undefined) return injectedLive;
    return injectedClient ? false : { baseUrl: getAppServices().baseUrl };
  }, [injectedLive, injectedClient]);

  return useSharedProjectGeneration(projectId, {
    store,
    client,
    getToken,
    foreground: TAB_FOREGROUND,
    // This app's store owns the autosave, so flushing is one of its actions.
    flush: () => store.getState().saveNow(),
    // Out of credits opens the store instead of printing a message: it is the
    // one API refusal with an obvious remedy, and it reads as a network
    // failure otherwise.
    onStartError: (error) => reportGenerationError(error, { store }),
    ...(onApplied ? { onApplied } : {}),
    ...(onComplete ? { onComplete } : {}),
    ...(live ? { live } : {}),
    ...(pollMs === undefined ? {} : { pollMs }),
    ...(idlePollMs === undefined ? {} : { idlePollMs }),
  });
}
