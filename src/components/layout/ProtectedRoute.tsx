/**
 * Route guard for the pages that need an account.
 *
 * Signed out, the page is replaced by its signed-out state — what is missing
 * and a Sign in button (`SignInRequired`) — and the sign-in modal opens over
 * it **once on arrival**, as every other app in the family does. The reader
 * stays at the URL they asked for. Closing the modal leaves the notice, whose
 * button opens it again; signing in closes it and this re-renders with the
 * page itself, because it reads `useAuth`. It used to redirect to the
 * language root, and before that sign-in was a route of its own: either way
 * somebody who followed a link to a project lost it. music_app_rn's project
 * list and Credits do the same.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Spinner } from '@sudobility/components';
import { useAuth } from '@/app/AuthContext';
import { useSignIn } from '@/features/auth/SignInModal';
import { SignInRequired } from '@/features/auth/SignInRequired';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { openSignIn } = useSignIn();
  const { pathname } = useLocation();
  const needsSignIn = !loading && !user;

  // Ask once per arrival — per pathname, since moving between two gated
  // pages can keep this same guard mounted. After a close the notice's button
  // asks again.
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (needsSignIn && askedFor.current !== pathname) {
      askedFor.current = pathname;
      openSignIn();
    }
  }, [needsSignIn, pathname, openSignIn]);

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
