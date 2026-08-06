/**
 * Route structure (APP.md): everything lives under `/:lang` (en-only this
 * phase). ScreenContainer wraps the content routes as a layout route; the
 * editor route (`/:lang/project/:id`) renders the editor workspace inside
 * the same shell with a non-scrollable page config (set by AppLayout).
 * `ProjectRoute` keeps the store's open project in sync with the URL.
 */
import { Suspense, lazy, useEffect, useRef } from 'react';
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardPage } from '@/features/projects/DashboardPage';
import { playbackController, reportError, useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ScreenContainer } from '@/components/shell/ScreenContainer';
import { PrintView } from '@/features/print/PrintView';
import { useCurrentLanguage, useLocalizedNavigate } from '@/hooks/useLocalizedNavigate';
import { SUPPORTED_LANGUAGES } from '@/i18n';

const HomePage = lazy(() => import('@/pages/HomePage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

export type AppRouterProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore({ context })`. */
  store?: EditorStoreApi;
};

function LoadingFallback() {
  return <div className="p-8 text-theme-text-secondary">Loading…</div>;
}

function ScreenContainerLayout() {
  return (
    <ScreenContainer>
      <Suspense fallback={<LoadingFallback />}>
        <Outlet />
      </Suspense>
    </ScreenContainer>
  );
}

function LanguageValidator() {
  const { lang } = useParams<{ lang: string }>();
  if (!lang || !(SUPPORTED_LANGUAGES as readonly string[]).includes(lang)) {
    return <Navigate to="/en" replace />;
  }
  return <Outlet />;
}

function DashboardRoute({ store }: { store: EditorStoreApi }) {
  const navigate = useLocalizedNavigate();
  return <DashboardPage store={store} onNavigate={navigate} />;
}

function SettingsRoute({ store }: { store: EditorStoreApi }) {
  return <SettingsPage store={store} />;
}

/**
 * The print view for an already-open project.
 *
 * Deliberately does not open the project itself: you reach print from inside
 * the editor, so it is already open. Navigating straight to the URL with
 * nothing open shows the view's own empty state rather than silently loading —
 * one fewer path that can fail, and one fewer place that resets undo history.
 */
function PrintRoute({ store }: { store: EditorStoreApi }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const lang = useCurrentLanguage();
  return <PrintView store={store} onBack={() => navigate(`/${lang}/project/${id ?? ''}`)} />;
}

function ProjectRoute({ store }: { store: EditorStoreApi }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const lang = useCurrentLanguage();
  // Guards against re-opening the same project on every render (openProject
  // resets undo/redo history) while still reacting to id changes.
  const openedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!id || openedIdRef.current === id || store.getState().projectId === id) {
      if (id) openedIdRef.current = id;
      return;
    }
    openedIdRef.current = id;
    store
      .getState()
      .openProject(id)
      .catch((err: unknown) => {
        reportError(err, { context: 'Failed to open project', store });
        navigate(`/${lang}/projects`);
      });
  }, [id, store, navigate, lang]);

  // Leaving the editor (back to dashboard, settings, etc.) unmounts this
  // route; stop any sounding playback — both a candidate preview and the
  // main transport — so audio never keeps playing outside the editor.
  // `stopPreview()` is a no-op when no preview is active.
  useEffect(() => {
    return () => {
      playbackController.stopPreview();
      playbackController.stop();
    };
  }, []);

  const localizedNavigate = useLocalizedNavigate();
  return <AppLayout store={store} onNavigate={localizedNavigate} />;
}

/**
 * The signed-in route table, rendered behind the auth gate.
 *
 * Public routes are declared in `App.tsx` and matched *before* this, so the
 * gate never sees them — which is what lets a stranger open a shared snapshot.
 */
export function AppRoutes({ store = useAppStore }: AppRouterProps) {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/en" replace />} />
      <Route path="/:lang" element={<LanguageValidator />}>
        <Route element={<ScreenContainerLayout />}>
          <Route index element={<HomePage />} />
          <Route path="projects" element={<DashboardRoute store={store} />} />
          <Route path="settings" element={<SettingsRoute store={store} />} />
        </Route>
        <Route path="project/:id" element={<ProjectRoute store={store} />} />
        <Route path="project/:id/print" element={<PrintRoute store={store} />} />
      </Route>
      <Route path="*" element={<Navigate to="/en" replace />} />
    </Routes>
  );
}

/** Kept so existing callers and tests that mount the whole router still work. */
export function AppRouter({ store = useAppStore }: AppRouterProps) {
  return (
    <BrowserRouter>
      <AppRoutes store={store} />
    </BrowserRouter>
  );
}
