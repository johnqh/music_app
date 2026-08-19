/**
 * Route guard for the pages that need an account.
 *
 * Wraps the shared `ProtectedRoute` and feeds it this app's auth state, which
 * is what `sudojo_app` does. Unauthenticated visitors go to the language root
 * rather than to the sign-in form: reaching sign-in is a deliberate act (the
 * Log in button in the top bar), not something a mistyped URL forces on you.
 */
import type { ReactNode } from 'react';
import { ProtectedRoute as SharedProtectedRoute, Spinner } from '@sudobility/components';
import { useAuth } from '@/app/AuthContext';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  return (
    <SharedProtectedRoute
      isAuthenticated={!!user}
      isLoading={loading}
      redirectPath="/:lang"
      loadingComponent={
        <div className="grid min-h-screen place-items-center" role="status" aria-live="polite">
          <Spinner ariaLabel="Loading" size="large" />
        </div>
      }
    >
      {children}
    </SharedProtectedRoute>
  );
}
