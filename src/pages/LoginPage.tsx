/**
 * The sign-in screen, from the shared library.
 *
 * `sudojo_app` renders `LoginPage` from `building_blocks` as a route inside
 * the app shell, and this does the same: one screen, maintained once, instead
 * of the hand-rolled form this replaces — which was labelled interim from the
 * day it was written.
 *
 * The component is presentational and provider-agnostic: it takes the
 * handlers and this app supplies them from its own `AuthContext`, so nothing
 * here knows about Firebase.
 *
 * **This is where somebody goes in order to sign in** — the top bar's "Sign
 * in". Everywhere sign-in interrupts something else (a page that needs an
 * account, an action that does) opens `SignInModal` over that page instead,
 * with the same form, handlers and words (`useSignInForm`).
 */
import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoginPage as LoginPageComponent } from '@sudobility/building_blocks';
import { useAuth } from '@/app/AuthContext';
import { useCurrentLanguage } from '@/hooks/useLocalizedNavigate';
import { CONSTANTS } from '@/config/constants';
import { useSignInForm } from '@/features/auth/useSignInForm';

export default function LoginPage() {
  const lang = useCurrentLanguage();
  const { user } = useAuth();
  const form = useSignInForm();

  const navigate = useNavigate();
  // Home, and nowhere else. There is no `?redirect=` round trip: a page that
  // needs an account opens the sign-in modal over itself rather than sending
  // the reader here, so whoever is on this page came to sign in.
  const handleLoginSuccess = useCallback(
    () => navigate(`/${lang}`, { replace: true }),
    [navigate, lang],
  );

  // Already signed in — opening /signin directly should not present a form.
  useEffect(() => {
    if (user) handleLoginSuccess();
  }, [user, handleLoginSuccess]);

  return (
    <LoginPageComponent
      appName={CONSTANTS.APP_NAME}
      onEmailSignIn={form.onEmailSignIn}
      onEmailSignUp={form.onEmailSignUp}
      onPasswordReset={form.onPasswordReset}
      onGoogleSignIn={form.onGoogleSignIn}
      onSuccess={handleLoginSuccess}
      text={{ ...form.text, ...form.headings }}
    />
  );
}
