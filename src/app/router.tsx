/**
 * The app's two routes (spec §6/§19): `/` (the project dashboard) and
 * `/project/:id` (the editor shell, `AppLayout`). Uses `react-router-dom`
 * (per the Task 16 brief's explicit choice) purely for URL <-> screen
 * mapping; all actual project state still lives in the shared Zustand
 * store, not in the URL/router.
 *
 * `ProjectRoute` is the one piece of glue `AppLayout` itself can't own: it
 * makes sure the store's currently-open project matches the `:id` in the
 * URL *before* rendering `AppLayout` (e.g. a bookmarked/refreshed
 * `/project/:id` URL, or the id changing via in-app navigation) --
 * `AppLayout` itself never loads a project, only edits whichever one the
 * store already has open.
 */
import { useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardPage } from '@/features/projects/DashboardPage';
import { reportError } from '@/services/errors';
import { db as appDb, useAppStore } from '@/store/useAppStore';
import type { EditorStoreApi } from '@/features/score-editor/editing';
import type { ScoreSmithDb } from '@/services/persistence/db';

export type AppRouterProps = {
  /** Defaults to the app-wide singleton (`useAppStore`); tests inject an isolated store via `createAppStore()`. */
  store?: EditorStoreApi;
  /** Defaults to the app-wide singleton's own db; tests inject the same `fake-indexeddb`-backed db the test's store was built with. */
  db?: ScoreSmithDb;
};

function DashboardRoute({ store, db }: { store: EditorStoreApi; db: ScoreSmithDb }) {
  const navigate = useNavigate();
  return <DashboardPage store={store} db={db} onNavigate={navigate} />;
}

function ProjectRoute({ store, db }: { store: EditorStoreApi; db: ScoreSmithDb }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // Guards against re-opening the same project on every render (openProject
  // resets undo/redo history -- see score-slice's setScore doc) while still
  // reacting to the id actually changing (in-app navigation to a different
  // project).
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
        navigate('/');
      });
  }, [id, store, navigate]);

  return <AppLayout store={store} db={db} onNavigate={navigate} />;
}

export function AppRouter({ store = useAppStore, db = appDb }: AppRouterProps) {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardRoute store={store} db={db} />} />
        <Route path="/project/:id" element={<ProjectRoute store={store} db={db} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
