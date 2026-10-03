/**
 * Auth context: exposes the current user, the hook context music_client's
 * React Query hooks read (a token resolved per request, never captured), and
 * the auth actions. Sign-in is not required app-wide: pages that need an
 * account are wrapped in `ProtectedRoute`, which signs a visitor in over the
 * page (`features/auth/SignInModal.tsx`).
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { refreshConsumablesBalance, setConsumablesUserId } from '@sudobility/consumables_client';
import { CurrentEntityProvider, useCurrentEntityOptional } from '@sudobility/entity_client';
import {
  useSiteAdmin as useServerSiteAdmin,
  type MusicHookContext,
} from '@sudobility/music_client';
import {
  getAppServices,
  musicHookContext,
  setActiveEntityId,
  type AuthUser,
} from '@/config/initialize';

export type AuthContextValue = {
  user: AuthUser | null;
  /**
   * What every music_client hook is handed. The token is **asked for per
   * request** (`getToken`), not held: a token captured when the context was
   * built goes stale an hour into a session, and one read at start-up is null
   * for a signed-in user until Firebase has restored the session. `userId` is
   * `null` while signed out, which keeps every query idle, and keys per-account
   * answers so one account's is never shown to the next.
   */
  hookContext: MusicHookContext;
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
   * Asked through music_client's `useSiteAdmin`, keyed by the signed-in user,
   * so the native app asks the same question the same way. `false` while it is
   * in flight and if the request fails — the closed default, so a network
   * problem never hands out free service.
   */
  siteAdmin: boolean;
  signInEmail: (email: string, password: string) => Promise<void>;
  signUpEmail: (email: string, password: string) => Promise<void>;
  /** Sends a link to reset the password for an address. */
  sendPasswordReset: (email: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const services = getAppServices();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const userId = loading ? null : (user?.uid ?? null);
  const hookContext = useMemo(() => musicHookContext(services, userId), [services, userId]);
  const siteAdmin = useServerSiteAdmin(hookContext);

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
    });
    return unsubscribe;
  }, [services]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      hookContext,
      loading,
      siteAdmin,
      signInEmail: services.auth.signInEmail,
      signUpEmail: services.auth.signUpEmail,
      sendPasswordReset: services.auth.sendPasswordReset,
      signInGoogle: services.auth.signInGoogle,
      signOut: services.auth.signOut,
    }),
    [user, hookContext, loading, siteAdmin, services],
  );

  const authenticatedTree = <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  if (!services.entityClient) return authenticatedTree;

  return (
    <CurrentEntityProvider
      client={services.entityClient}
      user={user ? { uid: user.uid, email: user.email } : null}
    >
      <EntitySelectionBridge>{authenticatedTree}</EntitySelectionBridge>
    </CurrentEntityProvider>
  );
}

/** Propagates the selected entity to authenticated API requests and refreshes its balance. */
function EntitySelectionBridge({ children }: { children: ReactNode }) {
  const entityContext = useCurrentEntityOptional();
  const entityId = entityContext?.currentEntityId ?? null;

  useEffect(() => {
    setActiveEntityId(entityId);
    if (entityId) refreshConsumablesBalance().catch(() => undefined);
    return () => setActiveEntityId(null);
  }, [entityId]);

  return <>{children}</>;
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

/**
 * Whether somebody is signed in, tolerant of a missing provider.
 *
 * Inside `AuthProvider` it is whether a user has been restored. Outside one it
 * answers **yes**, the same assumption `useMusicHookContext` makes there: the
 * pages that ask sit behind the sign-in gate in production, and a component
 * test rendering one alone means a signed-in page, not a signed-out one.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useSignedIn(): boolean {
  const ctx = useContext(AuthContext);
  return ctx ? ctx.user !== null : true;
}

/**
 * The music_client hook context, tolerant of a missing provider.
 *
 * Inside `AuthProvider` it is the provider's, keyed by the signed-in user.
 * Outside one — a component test rendering a page alone — it is built from the
 * installed app services with no user id, which music_client reads as "assume
 * signed in": the request runs and fails 401-shaped if there is no token. The
 * same tolerance `useSiteAdmin` has, for the same reason: requiring the
 * provider would make every test of every page wire one up.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useMusicHookContext(): MusicHookContext {
  const fromProvider = useContext(AuthContext)?.hookContext;
  const services = getAppServices();
  const fallback = useMemo(() => {
    // No user id at all, rather than a null one: null would mean "signed out"
    // and keep every query idle.
    const context: MusicHookContext = musicHookContext(services, null);
    delete context.userId;
    return context;
  }, [services]);
  return fromProvider ?? fallback;
}
