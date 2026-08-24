/**
 * Route structure (APP.md): everything lives under `/:lang` (en-only this
 * phase). ScreenContainer wraps the content routes as a layout route; the
 * editor route (`/:lang/project/:id`) renders the editor workspace inside
 * the same shell with a non-scrollable page config (set by AppLayout).
 * `ProjectRoute` keeps the store's open project in sync with the URL.
 */
import { Suspense, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditsHistoryPage } from '@/features/credits/CreditsHistoryPage';
import { CreditsPage } from '@/features/credits/CreditsPage';
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
import { PaywallDialog } from '@/features/credits/PaywallDialog';
import { DashboardPage } from '@/features/projects/DashboardPage';
import { playbackController, reportError, useAppStore } from '@sudobility/music_lib';
import type { EditorStoreApi } from '@sudobility/music_lib';
import { LanguageValidator as SharedLanguageValidator } from '@sudobility/components';
import { ScreenContainer } from '@/components/shell/ScreenContainer';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute';
import { CommunityPage } from '@/features/community/CommunityPage';
import { PublishedView } from '@/features/community/PublishedView';
import HomePage from '@/pages/HomePage';
import ResourcesPage from '@/pages/ResourcesPage';
import LoginPage from '@/pages/LoginPage';
import SettingsPage from '@/pages/SettingsPage';
import { PrintView } from '@/features/print/PrintView';
import { useCurrentLanguage, useLocalizedNavigate } from '@/hooks/useLocalizedNavigate';
import { isLanguageSupported } from '@/i18n';

export type AppRouterProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore({ context })`. */
  store?: EditorStoreApi;
};

function LoadingFallback() {
  const { t } = useTranslation();
  return <div className="p-8 text-theme-text-secondary">{t('common.loading')}</div>;
}

export function ScreenContainerLayout() {
  return (
    <ScreenContainer>
      <Suspense fallback={<LoadingFallback />}>
        <Outlet />
      </Suspense>
    </ScreenContainer>
  );
}

/**
 * Validates the `:lang` segment, using the shared implementation.
 *
 * The hand-rolled version this replaces redirected every unsupported language
 * to bare `/en`, discarding the rest of the path: `/fr/community` lost the
 * community page rather than landing on the English one. The shared component
 * keeps path, query and hash, and picks the target language from the stored
 * preference then the browser's own, which is what `sudojo_app` uses.
 */
export function LanguageValidator() {
  return <SharedLanguageValidator isLanguageSupported={isLanguageSupported} defaultLanguage="en" />;
}

function DashboardRoute({ store }: { store: EditorStoreApi }) {
  const navigate = useLocalizedNavigate();
  return <DashboardPage store={store} onNavigate={navigate} />;
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
  const { t } = useTranslation();
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
      .then(() => {
        playbackController.stop();
      })
      .catch((err: unknown) => {
        reportError(err, { context: t('errors.openProject'), store });
        navigate(`/${lang}/projects`);
      });
  }, [id, store, navigate, lang, t]);

  // Leaving the editor (back to dashboard, settings, etc.) unmounts this
  // route; stop the transport so audio never keeps playing outside the editor.
  useEffect(() => {
    return () => {
      playbackController.stop();
    };
  }, []);

  const localizedNavigate = useLocalizedNavigate();
  return <AppLayout store={store} onNavigate={localizedNavigate} />;
}

/**
 * The route table — one table, public and gated together, as `sudojo_app` has
 * it. Auth is applied per route with `ProtectedRoute` rather than by a
 * catch-all gate wrapped around everything: a gate that owns the whole tree
 * has to render the sign-in form *instead of* the app, which costs the visitor
 * the shell and puts a sign-in screen at whatever URL they asked for.
 *
 * Everything inside `ScreenContainerLayout` keeps the topbar and footer,
 * signed in or not — including the sign-in page itself.
 */
export function AppRoutes({ store = useAppStore }: AppRouterProps) {
  return (
    <>
      {/*
        Mounted above the routes rather than in a layout, because a job can be
        refused for want of credits from the dashboard and from inside the
        editor, and those sit in different branches of the tree. One mount, one
        `dialogs.paywall` flag, reachable from either.
      */}
      <PaywallDialog store={store} />
      <Routes>
        <Route path="/" element={<Navigate to="/en" replace />} />
        <Route path="/:lang" element={<LanguageValidator />}>
          <Route element={<ScreenContainerLayout />}>
            {/* Public. */}
            <Route index element={<HomePage />} />
            <Route path="community" element={<CommunityPage />} />
            <Route path="resources" element={<ResourcesPage />} />
            <Route path="settings" element={<SettingsPage store={store} />} />
            <Route path="signin" element={<LoginPage />} />

            {/* Needs an account. */}
            <Route
              path="projects"
              element={
                <ProtectedRoute>
                  <DashboardRoute store={store} />
                </ProtectedRoute>
              }
            />
            <Route
              path="credits"
              element={
                <ProtectedRoute>
                  <CreditsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="credits/history"
              element={
                <ProtectedRoute>
                  <CreditsHistoryPage />
                </ProtectedRoute>
              }
            />
          </Route>

          {/* Full-bleed reader for one shared score: deliberately no shell. */}
          <Route path="p/:publicId" element={<PublishedView />} />

          <Route
            path="project/:id"
            element={
              <ProtectedRoute>
                <ProjectRoute store={store} />
              </ProtectedRoute>
            }
          />
          <Route
            path="project/:id/print"
            element={
              <ProtectedRoute>
                <PrintRoute store={store} />
              </ProtectedRoute>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/en" replace />} />
      </Routes>
    </>
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
