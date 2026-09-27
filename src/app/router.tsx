/**
 * Route structure (APP.md): everything lives under `/:lang` (en-only this
 * phase). ScreenContainer wraps the content routes as a layout route; the
 * editor route (`/:lang/project/:id`) renders the editor workspace inside
 * the same shell with a non-scrollable page config (set by AppLayout).
 * `ProjectRoute` keeps the store's open project in sync with the URL.
 */
import { Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CreditsHistoryPage } from '@/features/credits/CreditsHistoryPage';
import { CreditsPage } from '@/features/credits/CreditsPage';
import { CreditCouponsPage } from '@/features/credits/CreditCouponsPage';
import { EntitiesPage } from '@/features/entities/EntitiesPage';
import { UserDashboardPage } from '@/features/dashboard/UserDashboardPage';
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { ProjectLoading } from '@/components/layout/ProjectLoading';
import { PaywallDialog } from '@/features/credits/PaywallDialog';
import { DashboardPage } from '@/features/projects/DashboardPage';
import { loadPrefs, playbackController, reportError, useAppStore } from '@/app-library';
import type { EditorStoreApi } from '@/app-library';
import { LanguageValidator as SharedLanguageValidator } from '@sudobility/components';
import { ScreenContainer } from '@/components/shell/ScreenContainer';
import { DocsPage } from '@/features/docs/DocsPage';
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
import { SUPPORTED_LANGUAGES } from '@/config/languages';
import { getAppServices } from '@/config/initialize';
import { CONSTANTS } from '@/config/constants';
import {
  getMusicPosition,
  getMusicPositionSource,
  preferredLanguage,
} from '@sudobility/music_types';

export type AppRouterProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore({ context })`. */
  store?: EditorStoreApi;
};

function LoadingFallback() {
  const { t } = useTranslation();
  return <div className="p-8 text-theme-text-secondary">{t('common.loading')}</div>;
}

export function ScreenContainerLayout({ store }: { store?: EditorStoreApi }) {
  return (
    <ScreenContainer store={store}>
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

/**
 * Sends a URL with no usable route to a localized home page.
 *
 * A language already in the URL is kept: `/zh/nope` lands on `/zh`, because a
 * shared link's language is the one thing about it that is still right. Only a
 * URL with none — a bare `/` — consults the reader's `language` pref, which
 * was persisted but never read while this was a hard `/en`.
 *
 * The pref is read from storage rather than the store. The store receives it
 * from `bindDevicePrefs`, which `App` starts from an effect — and a parent's
 * effect runs after this child's, so the store still holds the default when a
 * cold `/` is redirected. Nothing is rendered for the moment the read takes.
 */
export function LocalizedHomeRedirect() {
  const { pathname } = useLocation();
  const inUrl = pathname.split('/')[1] ?? '';
  const [chosen, setChosen] = useState<string | undefined>(
    isLanguageSupported(inUrl) ? inUrl : undefined,
  );

  useEffect(() => {
    if (chosen !== undefined) return;
    let cancelled = false;
    const device = typeof navigator === 'undefined' ? [] : navigator.languages;
    const settle = (pref: string | null) => {
      if (!cancelled) setChosen(preferredLanguage(pref, device, SUPPORTED_LANGUAGES));
    };
    // Inside the chain, so a missing service settles on the device's language
    // rather than throwing out of an effect.
    Promise.resolve()
      .then(() => loadPrefs(getAppServices().prefsStorage))
      .then(
        (prefs) => settle(prefs.language),
        () => settle(null),
      );
    return () => {
      cancelled = true;
    };
  }, [chosen]);

  return chosen === undefined ? null : <Navigate to={`/${chosen}`} replace />;
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
  // The caret is put back afterwards: it *is* the shared playhead, a stop homes
  // that to 0, and the project is still open to come back to — from the
  // dashboard, or from a published link.
  useEffect(() => {
    return () => {
      const caret = getMusicPosition().tick;
      playbackController.stop();
      getMusicPositionSource().moveTo(caret);
    };
  }, []);

  /**
   * Whether the editor would be showing the WRONG project.
   *
   * Derived from the URL against what is loaded, rather than from a flag the
   * fetch sets: a flag is only true once the effect has run, so the first
   * render still painted the previous project — and nothing covered the app
   * bar, which went on naming it for the whole load. Clicking one project and
   * reading another one's title for a few seconds is the bug this replaces.
   *
   * True on a cold load (nothing open yet) and while switching from one
   * project to another; false the instant the store holds what the URL asked
   * for, which is also what the create/import paths produce — they have the
   * project before they navigate, so they never flash this.
   */
  const openProjectId = store((s) => s.projectId);
  const loading = !id || openProjectId !== id;

  const localizedNavigate = useLocalizedNavigate();
  /*
    The editor is not rendered at all while loading, rather than covered.

    An overlay leaves a whole editor mounted over the previous project's score
    — its title, its transport, its inspector — and every one of those is a
    surface that can leak through or be read. Mounting `AppLayout` only when
    the score is the right one means there is nothing stale to leak.
  */
  if (loading) return <ProjectLoading />;
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
function NotFoundRedirect() {
  const { lang } = useParams();
  return <Navigate to={'/' + (lang || 'en') + '/404'} replace />;
}
function NotFoundPage() {
  const { lang } = useParams();
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1>404</h1>
      <p>Page Not Found</p>
      <a href={'/' + (lang || 'en')}>Go to Home</a>
    </main>
  );
}

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
        <Route path="/" element={<LocalizedHomeRedirect />} />
        <Route path="/:lang" element={<LanguageValidator />}>
          <Route element={<ScreenContainerLayout store={store} />}>
            {/* Public. */}
            <Route index element={<HomePage />} />
            <Route path="community" element={<CommunityPage />} />
            <Route path="resources" element={<ResourcesPage />} />
            {/*
              Two routes, not one with an optional segment: `/docs` redirects
              to the first topic so the pane is never empty, and the topic in
              the URL is what makes a link into one section shareable.
            */}
            <Route path="docs" element={<DocsPage />} />
            <Route path="docs/:topicId" element={<DocsPage />} />
            <Route path="settings" element={<SettingsPage store={store} />} />
            <Route path="signin" element={<LoginPage />} />
            {/*
              The normal shell (topbar, breadcrumbs, footer), like every other
              public page — it used to render full-bleed with none of that,
              which read as a page torn out of the rest of the site.
              `useSetPageConfig({ scrollable: false })` (in `PublishedView`)
              is what keeps its own notation/transport area viewport-bounded
              with its own internal scrolling rather than the shell's normal
              whole-page scroll.
            */}
            <Route path="p/:publicId" element={<PublishedView />} />

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
            <Route
              path="credits/coupons"
              element={
                <ProtectedRoute>
                  <CreditCouponsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="entities"
              element={
                <ProtectedRoute>
                  {CONSTANTS.SHOW_ENTITIES ? (
                    <EntitiesPage />
                  ) : (
                    <Navigate to="../dashboard" replace />
                  )}
                </ProtectedRoute>
              }
            />
            <Route
              path="dashboard"
              element={
                <ProtectedRoute>
                  <UserDashboardPage />
                </ProtectedRoute>
              }
            />
          </Route>

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
          <Route path="404" element={<NotFoundPage />} />
          <Route path="*" element={<NotFoundRedirect />} />
        </Route>
        <Route path="*" element={<Navigate to="/en/404" replace />} />
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
