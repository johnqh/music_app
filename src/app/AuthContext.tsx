/**
 * Auth context (interim MUI-era wiring; Phase 3 swaps the UI to
 * @sudobility/auth-components but keeps this shape): exposes the current
 * user, the latest ID token (for React Query hook contexts), and the auth
 * actions. Sign-in is REQUIRED app-wide — `RequireAuth` gates everything.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { setConsumablesUserId } from '@sudobility/consumables_client';
import { getAppServices, type AuthUser } from '@/config/initialize';

export type AuthContextValue = {
  user: AuthUser | null;
  /** Latest known ID token (refreshed on auth-state changes); null when signed out. */
  token: string | null;
  /** True until the first auth-state resolution arrives. */
  loading: boolean;
  /**
   * Whether the server considers this user a site administrator.
   *
   * Administrators generate for free — no daily quota, no balance check, no
   * charge — so this app's own courtesy gates must stand aside for them, or
   * the Generate button stays disabled at a balance of zero and refuses work
   * `POST /jobs` would have accepted. They sit at zero permanently, since
   * nothing ever grants or spends their credits.
   *
   * Fetched once per signed-in user rather than polled: it comes from the
   * deployment's `SITEADMIN_EMAILS` and cannot change underneath a session.
   * `false` while it is in flight and if the request fails — the closed
   * default, so a network problem never hands out free service.
   */
  siteAdmin: boolean;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const services = getAppServices();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [siteAdmin, setSiteAdmin] = useState(false);

  useEffect(() => {
    const unsubscribe = services.auth.observe((nextUser) => {
      setUser(nextUser);
      setLoading(false);
      // The credit balance is per-user and the consumables singleton caches it.
      // Without this it would serve the previous user's balance after a
      // sign-out and sign-in.
      // Fire-and-forget, but never unhandled: this runs inside an auth
      // callback, and a rejection with no catch would surface as an unhandled
      // rejection that takes down a test run or spams production logs. Credits
      // failing to follow a sign-in is not a reason to break signing in.
      setConsumablesUserId(nextUser?.uid, nextUser?.email ?? undefined).catch((err: unknown) => {
        console.error('[credits] could not follow the signed-in user', err);
      });
      if (nextUser) {
        // One chain with one catch at the end, so a *synchronous* throw inside
        // the callback is caught as well as a rejected fetch. Failing to learn
        // that somebody is an administrator costs them free service; an
        // unhandled rejection here would break signing in.
        void services.auth
          .getToken()
          .then(async (next) => {
            setToken(next);
            if (!next) return;
            const me = await services.musicClient.getCurrentUser(next);
            setSiteAdmin(me.siteAdmin);
          })
          .catch(() => setSiteAdmin(false));
      } else {
        setToken(null);
        setSiteAdmin(false);
      }
    });
    return unsubscribe;
  }, [services]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      siteAdmin,
      signInEmail: services.auth.signInEmail,
      signUpEmail: services.auth.signUpEmail,
      signInGoogle: services.auth.signInGoogle,
      signOut: services.auth.signOut,
    }),
    [user, token, loading, siteAdmin, services],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Lives beside its provider on purpose: a hook that only reads this context is
 * not worth a second module, and splitting it to satisfy fast refresh would put
 * the consumer a file away from the thing it consumes. The cost is that editing
 * this file remounts the tree in dev rather than hot-swapping it.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/**
 * Whether the current user is a site administrator, `false` outside a provider.
 *
 * Deliberately tolerant where `useAuth` throws. A component that only wants to
 * know whether to stand a paid gate aside has a sensible answer without auth —
 * no — and requiring the provider would make every test of every such
 * component wire one up to learn something it does not care about. The closed
 * default is the same one the fetch itself uses.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useSiteAdmin(): boolean {
  return useContext(AuthContext)?.siteAdmin === true;
}
