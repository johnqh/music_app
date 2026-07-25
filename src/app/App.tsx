/**
 * App root (spec §6, §28, §33): theme (light/dark/system, wired to
 * `ui-slice.themeMode` and persisted to the settings table), the two-route
 * router (`router.tsx`), and a top-level React `ErrorBoundary` (spec §28:
 * "Clear error messages without raw stack traces for ordinary users") so a
 * render-time crash anywhere in the tree shows a recoverable fallback
 * instead of a blank white screen.
 */
import { Component, useEffect, useMemo, useRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CssBaseline from '@mui/material/CssBaseline';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { ThemeProvider } from '@mui/material/styles';
import { type ColorSchemeMode, createAppTheme, resolveColorScheme } from '@/app/theme';
import { AppRouter } from '@/app/router';
import { loadAllSettings, setSetting } from '@/services/persistence/settings';
import { DEFAULT_MOCK_SEED } from '@/services/generation/registry';
import { db, useAppStore } from '@/store/useAppStore';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import type { ScoreSmithDb } from '@/services/persistence/db';

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

/** Spec §28: catches any render-time error in the app tree and shows a plain-language, non-technical fallback (full detail still goes to the console, for development). */
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
      <Box sx={{ p: 4, maxWidth: 480, mx: 'auto' }}>
        <Stack spacing={2}>
          <Alert severity="error">Something went wrong and ScoreSmith couldn't continue.</Alert>
          <Typography variant="body2" color="text.secondary">
            Your work is autosaved as you go, so reloading is usually safe.
          </Typography>
          <Button variant="contained" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </Stack>
      </Box>
    );
  }
}

export type AppProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /** Defaults to the app-wide singleton's own db; tests inject the same `fake-indexeddb`-backed db the test's store was built with. */
  db?: ScoreSmithDb;
};

export function App({ store = useAppStore, db: appDb = db }: AppProps) {
  const themeMode = store((s) => s.themeMode);
  const developerMode = store((s) => s.developerMode);
  const seed = store((s) => s.devSettings.seed);

  const theme = useMemo(() => createAppTheme(resolveColorScheme(themeMode)), [themeMode]);

  // Guards the persist effects below against writing this render's still-
  // default values (system/false/DEFAULT_MOCK_SEED) over whatever's
  // already on disk, in the window before the bootstrap load (just below)
  // resolves and applies the real persisted values.
  const settingsLoaded = useRef(false);
  // Set for exactly one render when the bootstrap effect below applies a
  // `?seed=` URL override, so the seed-persist effect can skip that one
  // write -- see that effect's doc comment for why.
  const skipNextSeedPersist = useRef(false);

  // e2e test hook (spec §30 Playwright coverage): exposes the live store
  // and its db on `window` so Playwright specs can read/drive state that
  // has no meaningful UI surface -- deterministic measure selection,
  // asserting store-level playback/generation state instead of real audio
  // (Tone.js needs a user gesture and produces no observable DOM signal in
  // headless Chromium), etc. Gated behind `import.meta.env.DEV` only (true
  // for the `npm run dev` server Playwright's `webServer` boots) -- no
  // query-param opt-in, so there is no code path that can expose this in a
  // production build regardless of the URL a production build is served
  // at.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const globalWindow = window as unknown as { __SCORESMITH_STORE__?: EditorStoreApi; __SCORESMITH_DB__?: ScoreSmithDb };
    globalWindow.__SCORESMITH_STORE__ = store;
    globalWindow.__SCORESMITH_DB__ = appDb;
  }, [store, appDb]);

  // Best-effort autosave flush before the tab actually goes away (spec §18
  // "autosave" -- Task 19 review finding I3): without this, up to the
  // autosaver's debounce window (`services/persistence/autosave.ts`,
  // `DEFAULT_DEBOUNCE_MS` = 2s) of edits could be lost if the user closes
  // the tab, navigates away, or switches apps before the next scheduled
  // write fires. `pagehide` is the primary signal (fires reliably on tab
  // close/navigation, unlike the less consistently fired `beforeunload`);
  // `visibilitychange` -> `'hidden'` is a belt-and-suspenders second
  // signal for the same "about to lose the page" moment, since mobile
  // browsers backgrounding a tab don't always follow up with `pagehide` in
  // time for a flush to complete. Both funnel through the exact same
  // `store.getState().saveNow()` call, gated here (not left to `saveNow`'s
  // own no-op guards) so the two are trivially observable/testable
  // independently of `saveNow`'s internal state.
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

  // Bootstrap persisted settings (spec §18/§33) once on mount.
  useEffect(() => {
    let cancelled = false;
    void loadAllSettings(appDb, {
      theme: store.getState().themeMode,
      developerMode: store.getState().developerMode,
      mockSeed: DEFAULT_MOCK_SEED,
      historyLimit: null,
    }).then((settings) => {
      if (cancelled) return;
      store.getState().setThemeMode(settings.theme);
      store.getState().setDeveloperMode(settings.developerMode);
      // A `?seed=` URL query param (e2e/manual-testing convenience -- spec
      // §30/§31: Playwright e2e needs deterministic mock-provider output)
      // always wins over whatever seed was persisted, so a bookmarked/
      // scripted `?seed=42` URL reproduces the same generation output on
      // every load regardless of prior sessions' developer-settings seed.
      // Critically, this override must NOT itself get written back to
      // IndexedDB as though it were a real settings change -- otherwise a
      // single `?seed=42` visit would silently overwrite whatever seed was
      // actually stored, and every later visit *without* the param would
      // keep loading "42" forever. `skipNextSeedPersist` tells the
      // seed-persist effect below to skip exactly the one write this call
      // triggers; `settingsLoaded` is only flipped on *after* it's set, so
      // that effect can't race ahead of it on the same commit.
      const urlSeed = new URLSearchParams(window.location.search).get('seed');
      if (urlSeed !== null) skipNextSeedPersist.current = true;
      store.getState().setDevSettings({ seed: urlSeed ?? settings.mockSeed });
      settingsLoaded.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [appDb, store]);

  // Persist theme/developer-mode/seed changes back to the settings table
  // (fire-and-forget: these are small, infrequent writes, and a failure
  // here shouldn't interrupt the user -- it only means the next session
  // won't remember the change).
  useEffect(() => {
    if (settingsLoaded.current) void setSetting(appDb, 'theme', themeMode);
  }, [appDb, themeMode]);
  useEffect(() => {
    if (settingsLoaded.current) void setSetting(appDb, 'developerMode', developerMode);
  }, [appDb, developerMode]);
  // Skips the one persist this effect would otherwise run for the
  // bootstrap effect's own `?seed=` URL override (see its doc comment) --
  // a URL-sourced seed is a per-visit override, never something that
  // should get written back as the new persisted default. Any *later*
  // seed change (a real Developer Settings edit) still persists normally,
  // since the flag is consumed (reset to `false`) the first time it's read.
  useEffect(() => {
    if (!settingsLoaded.current) return;
    if (skipNextSeedPersist.current) {
      skipNextSeedPersist.current = false;
      return;
    }
    void setSetting(appDb, 'mockSeed', seed);
  }, [appDb, seed]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ErrorBoundary>
        <AppRouter store={store} db={appDb} />
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export type { ColorSchemeMode };
