/**
 * App root (spec §6, §28): theme (light/dark/system, wired to
 * `ui-slice.themeMode` and persisted to device prefs), auth gate (sign-in
 * required app-wide), React Query provider, the router, and a top-level
 * ErrorBoundary so a render-time crash shows a recoverable fallback.
 *
 * Server-backed era: projects live in music_api; only device prefs (theme,
 * developer mode, view settings) persist locally via PrefsStorage.
 */
import { Component, useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import { Spinner } from '@sudobility/components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ColorSchemeMode, createAppTheme, resolveColorScheme } from '@/app/theme';
import { AppRouter } from '@/app/router';
import { AuthProvider, useAuth } from '@/app/AuthContext';
import { SignInScreen } from '@/app/SignInScreen';
import { loadPrefs, savePrefs, useAppStore } from '@sudobility/music_lib';
import { getAppServices } from '@/config/initialize';
import type { EditorStoreApi } from '@/features/score-editor/editing';

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

/** Spec §28: catches any render-time error in the app tree and shows a plain-language fallback. */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ScoreSmith] Unhandled render error:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto max-w-[480px] p-8">
        <div className="flex flex-col gap-4">
          <div role="alert" className="rounded-md bg-red-600/10 px-3 py-2 text-sm text-red-700">
            Something went wrong and ScoreSmith couldn't continue.
          </div>
          <p className="text-sm text-theme-text-secondary">
            Your work is autosaved as you go, so reloading is usually safe.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export type AppProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore({ context })`. */
  store?: EditorStoreApi;
};

function AuthGate({ store }: { store: EditorStoreApi }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner ariaLabel="Loading" size="large" />
      </div>
    );
  }
  if (!user) return <SignInScreen />;
  return <AppRouter store={store} />;
}

export function App({ store = useAppStore }: AppProps) {
  const themeMode = store((s) => s.themeMode);
  const developerMode = store((s) => s.developerMode);

  const theme = useMemo(() => createAppTheme(resolveColorScheme(themeMode)), [themeMode]);
  const [queryClient] = useState(() => new QueryClient());

  // Guards the persist effect against writing this render's still-default
  // values over stored prefs before the bootstrap load resolves.
  const prefsLoaded = useRef(false);

  // e2e/dev test hook: exposes the live store on `window` for Playwright
  // (store-level assertions where no meaningful UI surface exists).
  // DEV-gated only — no code path exposes this in production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const globalWindow = window as unknown as { __SCORESMITH_STORE__?: EditorStoreApi };
    globalWindow.__SCORESMITH_STORE__ = store;
  }, [store]);

  // Best-effort autosave flush before the tab goes away (spec §18):
  // pagehide is the primary signal; visibilitychange->hidden is the backup.
  useEffect(() => {
    const flushIfDirty = (): void => {
      const state = store.getState();
      if (state.projectId && state.dirty) void state.saveNow();
    };
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flushIfDirty();
    };
    window.addEventListener('pagehide', flushIfDirty);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushIfDirty);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [store]);

  // Bootstrap device prefs once on mount.
  useEffect(() => {
    let cancelled = false;
    const { prefsStorage } = getAppServices();
    void Promise.resolve(loadPrefs(prefsStorage)).then((prefs) => {
      if (cancelled) return;
      if (prefs.themeMode) store.getState().setThemeMode(prefs.themeMode);
      if (prefs.developerMode !== undefined) store.getState().setDeveloperMode(prefs.developerMode);
      prefsLoaded.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  // Persist theme/developer-mode changes (fire-and-forget device prefs).
  useEffect(() => {
    if (!prefsLoaded.current) return;
    const { prefsStorage } = getAppServices();
    void savePrefs(prefsStorage, { themeMode, developerMode });
  }, [themeMode, developerMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AuthGate store={store} />
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export type { ColorSchemeMode };
