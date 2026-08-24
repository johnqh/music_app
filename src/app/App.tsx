/**
 * App root (spec §6, §28): theme (light/dark/system, wired to
 * `ui-slice.themeMode` and persisted to device prefs), auth gate (sign-in
 * required app-wide), React Query provider, the router, and a top-level
 * ErrorBoundary so a render-time crash shows a recoverable fallback.
 *
 * Server-backed era: projects live in music_api; only device prefs (theme,
 * developer mode, view settings) persist locally via PrefsStorage.
 */
import { Component, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { applyDocumentTheme, type ColorSchemeMode, resolveColorScheme } from '@/app/theme';
import { AppRoutes } from '@/app/router';
import { useTranslation } from 'react-i18next';
import { AuthProvider } from '@/app/AuthContext';
import { useDocumentLanguage } from '@/hooks/useDocumentLanguage';
import { BrowserRouter } from 'react-router-dom';
import { loadPrefs, savePrefs, useAppStore } from '@sudobility/music_lib';
import { getAppServices } from '@/config/initialize';
import { CONSTANTS } from '@/config/constants';
import type { EditorStoreApi } from '@sudobility/music_lib';

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

/**
 * The crash screen's copy.
 *
 * A function component so it can read translations: `ErrorBoundary` has to be a
 * class (only classes can catch render errors), and a class cannot call hooks.
 */
function ErrorFallback() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-[480px] p-8">
      <div className="flex flex-col gap-4">
        <div role="alert" className="rounded-md bg-red-600/10 px-3 py-2 text-sm text-red-700">
          {t('error.crashed', { appName: CONSTANTS.APP_NAME })}
        </div>
        <p className="text-sm text-theme-text-secondary">{t('error.autosaved')}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={cn(variants.button.primary.default(), 'self-start')}
        >
          {t('error.reload')}
        </button>
      </div>
    </div>
  );
}

/** Spec §28: catches any render-time error in the app tree and shows a plain-language fallback. */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${CONSTANTS.APP_NAME}] Unhandled render error:`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return <ErrorFallback />;
  }
}

export type AppProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore({ context })`. */
  store?: EditorStoreApi;
};

export function App({ store = useAppStore }: AppProps) {
  // Keeps <html lang> honest about what the page is actually rendering.
  useDocumentLanguage();
  const themeMode = store((s) => s.themeMode);
  const developerMode = store((s) => s.developerMode);
  const pitchDisplay = store((s) => s.pitchDisplay);

  const [queryClient] = useState(() => new QueryClient());

  // Applies the resolved color scheme to the document (Tailwind `dark`
  // class). When themeMode is 'system', also re-resolves and re-applies on
  // every OS/browser scheme change so the app follows it live, without
  // requiring a reload or a store update.
  useEffect(() => {
    applyDocumentTheme(resolveColorScheme(themeMode));
    if (themeMode !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (): void => applyDocumentTheme(resolveColorScheme(themeMode));
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [themeMode]);

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
      if (prefs.pitchDisplay) store.getState().setPitchDisplay(prefs.pitchDisplay);
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
    void savePrefs(prefsStorage, { themeMode, developerMode, pitchDisplay });
  }, [themeMode, developerMode, pitchDisplay]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          {/* One route table, in `router.tsx`. Auth is applied per route
              there with `ProtectedRoute`, the way `sudojo_app` does it. */}
          <BrowserRouter>
            <AppRoutes store={store} />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export type { ColorSchemeMode };
