/**
 * Sign in or create an account over whatever page needed it —
 * `@sudobility/components`' `LoginModal`, music_app_rn's `SignInModal`.
 *
 * **Page or modal is the family's rule.** Somewhere a reader *navigates to* in
 * order to sign in (the `/signin` route, the top bar's "Sign in") is
 * `LoginPage`. Everywhere else an account is needed in the middle of
 * something — a page that has nothing to show signed out, an action that
 * needs one, a button whose real purpose is something else — opens this
 * modal over the page with `openSignIn(onSuccess?)`. Signing in closes it and
 * leaves the reader where they were: the page re-renders signed in, because
 * it reads `useAuth`, and `onSuccess` carries on with whatever asked. Never
 * send somebody to the sign-in route from such a place — no `navigate`, no
 * `<Navigate>`, no redirect-back round trip.
 *
 * Mounted once, above the routes (`AppRoutes`), like `PaywallDialog`: a page
 * guard and a call-to-action sit in different branches of the tree.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LoginModal } from '@sudobility/components';
import { useSignInForm } from './useSignInForm';

export type SignInModalApi = {
  /**
   * Opens the modal over the current page. `onSuccess` runs once somebody has
   * signed in or made their account — to carry on with what needed it.
   */
  openSignIn: (onSuccess?: () => void) => void;
};

const SignInModalContext = createContext<SignInModalApi | null>(null);

/**
 * Outside a provider the hook still answers — a page rendered alone in a test
 * draws its button — but pressing it is a wiring mistake, and says so.
 */
const MISSING_PROVIDER: SignInModalApi = {
  openSignIn: () => {
    throw new Error('openSignIn needs a <SignInModalProvider> above it');
  },
};

// eslint-disable-next-line react-refresh/only-export-components
export function useSignIn(): SignInModalApi {
  return useContext(SignInModalContext) ?? MISSING_PROVIDER;
}

export function SignInModalProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const form = useSignInForm();
  const [open, setOpen] = useState(false);
  // Remounts the modal on every opening, so it always opens on Sign in rather
  // than on whichever mode it was closed in.
  const [generation, setGeneration] = useState(0);
  const pending = useRef<(() => void) | undefined>(undefined);

  const openSignIn = useCallback((onSuccess?: () => void) => {
    pending.current = onSuccess;
    setGeneration((g) => g + 1);
    setOpen(true);
  }, []);
  const api = useMemo(() => ({ openSignIn }), [openSignIn]);

  return (
    <SignInModalContext.Provider value={api}>
      {children}
      <LoginModal
        key={generation}
        open={open}
        onClose={() => {
          pending.current = undefined;
          setOpen(false);
        }}
        onSuccess={() => {
          const next = pending.current;
          pending.current = undefined;
          next?.();
        }}
        onEmailSignIn={form.onEmailSignIn}
        onEmailSignUp={form.onEmailSignUp}
        onPasswordReset={form.onPasswordReset}
        onGoogleSignIn={form.onGoogleSignIn}
        text={form.text}
        modalText={{
          signInTitle: t('nav.signIn'),
          signUpTitle: form.headings.createAccount,
          resetPasswordTitle: form.headings.resetPassword,
          close: t('common.close'),
        }}
      />
    </SignInModalContext.Provider>
  );
}
