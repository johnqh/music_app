/**
 * The sign-in screen, from the shared library.
 *
 * `sudojo_app` renders `LoginPage` from `building_blocks` as a route inside
 * the app shell, and this does the same: one screen, maintained once, instead
 * of the hand-rolled form this replaces — which was labelled interim from the
 * day it was written.
 *
 * The component is presentational and provider-agnostic: it takes the three
 * handlers and this app supplies them from its own `AuthContext`, so nothing
 * here knows about Firebase.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LoginPage as LoginPageComponent } from '@sudobility/building_blocks';
import { useLoginRedirect } from '@sudobility/components';
import { useAuth } from '@/app/AuthContext';
import { useCurrentLanguage } from '@/hooks/useLocalizedNavigate';
import { CONSTANTS } from '@/config/constants';

export default function LoginPage() {
  const { t } = useTranslation();
  const lang = useCurrentLanguage();
  const { user, signInEmail, signUpEmail, signInGoogle } = useAuth();

  // Returns whoever just signed in to the page they were trying to reach,
  // falling back to the language root — the same hook and the same default
  // `sudojo_app` uses.
  const { handleLoginSuccess } = useLoginRedirect({
    defaultRedirect: '/',
    currentLanguage: lang,
  });

  // Already signed in — opening /signin directly should not present a form.
  useEffect(() => {
    if (user) handleLoginSuccess();
  }, [user, handleLoginSuccess]);

  return (
    <LoginPageComponent
      appName={CONSTANTS.APP_NAME}
      onEmailSignIn={signInEmail}
      onEmailSignUp={signUpEmail}
      onGoogleSignIn={signInGoogle}
      onSuccess={handleLoginSuccess}
      text={{
        signIn: t('nav.signIn'),
        signInToAccount: t('auth.signInToAccount'),
        createAccount: t('auth.createAccount'),
        emailLabel: t('auth.emailLabel'),
        passwordLabel: t('auth.passwordLabel'),
        signInWithGoogle: t('auth.signInWithGoogle'),
        alreadyHaveAccount: t('auth.alreadyHaveAccount'),
        dontHaveAccount: t('auth.dontHaveAccount'),
      }}
    />
  );
}
