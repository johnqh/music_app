/**
 * Route guard for the pages that need an account.
 *
 * Signed out, the page is replaced by its signed-out state — what is missing
 * and a Sign in button that opens the sign-in modal *over this page*
 * (`SignInRequired`) — and the reader stays at the URL they asked for.
 * Signing in closes the modal and this re-renders with the page itself,
 * because it reads `useAuth`. It used to redirect to the language root, and
 * before that sign-in was a route of its own: either way somebody who
 * followed a link to a project lost it. music_app_rn's project list and
 * Credits do the same.
 */
import type { ReactNode } from 'react';
import { Spinner } from '@sudobility/components';
import { useAuth } from '@/app/AuthContext';
import { SignInRequired } from '@/features/auth/SignInRequired';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center" role="status" aria-live="polite">
        <Spinner ariaLabel="Loading" size="large" />
      </div>
    );
  }
  if (!user) return <SignInRequired />;
  return <>{children}</>;
}
