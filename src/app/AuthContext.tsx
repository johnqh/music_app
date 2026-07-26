/**
 * Auth context (interim MUI-era wiring; Phase 3 swaps the UI to
 * @sudobility/auth-components but keeps this shape): exposes the current
 * user, the latest ID token (for React Query hook contexts), and the auth
 * actions. Sign-in is REQUIRED app-wide — `RequireAuth` gates everything.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getAppServices, type AuthUser } from '@/config/initialize';

export type AuthContextValue = {
  user: AuthUser | null;
  /** Latest known ID token (refreshed on auth-state changes); null when signed out. */
  token: string | null;
  /** True until the first auth-state resolution arrives. */
  loading: boolean;
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

  useEffect(() => {
    const unsubscribe = services.auth.observe((nextUser) => {
      setUser(nextUser);
      setLoading(false);
      if (nextUser) {
        void services.auth.getToken().then(setToken);
      } else {
        setToken(null);
      }
    });
    return unsubscribe;
  }, [services]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      signInEmail: services.auth.signInEmail,
      signUpEmail: services.auth.signUpEmail,
      signInGoogle: services.auth.signInGoogle,
      signOut: services.auth.signOut,
    }),
    [user, token, loading, services],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
