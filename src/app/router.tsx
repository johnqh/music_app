/**
 * Route structure (APP.md): everything lives under `/:lang` (en-only this
 * phase). ScreenContainer wraps the content routes as a layout route; the
 * editor route (`/:lang/project/:id`) renders the editor workspace inside
 * the same shell with a non-scrollable page config (set by AppLayout).
 * `ProjectRoute` keeps the store's open project in sync with the URL.
 */
import { Suspense, lazy, useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardPage } from '@/features/projects/DashboardPage';
import { reportError, useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import { ScreenContainer } from '@/components/shell/ScreenContainer';
import { useCurrentLanguage, useLocalizedNavigate } from '@/hooks/useLocalizedNavigate';
import { supportedLanguages } from '@/i18n';

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
  if (!lang || !(supportedLanguages as readonly string[]).includes(lang)) {
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

  const localizedNavigate = useLocalizedNavigate();
  return <AppLayout store={store} onNavigate={localizedNavigate} />;
}

export function AppRouter({ store = useAppStore }: AppRouterProps) {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/en" replace />} />
        <Route path="/:lang" element={<LanguageValidator />}>
          <Route element={<ScreenContainerLayout />}>
            <Route index element={<HomePage />} />
            <Route path="projects" element={<DashboardRoute store={store} />} />
            <Route path="settings" element={<SettingsRoute store={store} />} />
          </Route>
          <Route path="project/:id" element={<ProjectRoute store={store} />} />
        </Route>
        <Route path="*" element={<Navigate to="/en" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
