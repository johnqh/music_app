/**
 * What the shared sign-in form needs from this app: who signs somebody in
 * (`useAuth`), and every word it shows.
 *
 * The form is the family's — `LoginView` from `@sudobility/components` — in
 * one of two shells, the same two music_app_rn uses:
 *
 * - **`LoginPage`** (building_blocks, `pages/LoginPage.tsx`) where somebody
 *   *navigates in order to* sign in: the `/signin` route, which the top bar's
 *   "Sign in" button leads to.
 * - **`LoginModal`** (components, `SignInModalProvider`) where signing in
 *   interrupts something else — a page that needs an account, or an action
 *   that does — and the reader stays where they were.
 *
 * Both read this hook, so the page and the modal never offer different
 * providers or say different words. Apple is not offered: the web signs in
 * with email or Google only (`AuthBackend` has no Apple).
 */
import { useTranslation } from 'react-i18next';
import type { LoginViewText } from '@sudobility/components';
import { useAuth } from '@/app/AuthContext';

export type SignInForm = {
  onEmailSignIn: (email: string, password: string) => Promise<void>;
  onEmailSignUp: (email: string, password: string) => Promise<void>;
  onPasswordReset: (email: string) => Promise<void>;
  onGoogleSignIn: () => Promise<void>;
  /** Every string the form itself shows. */
  text: Partial<LoginViewText>;
  /** The three headings that follow the form's mode — a page's or a modal's. */
  headings: { signInToAccount: string; createAccount: string; resetPassword: string };
};

export function useSignInForm(): SignInForm {
  const { t } = useTranslation();
  const { signInEmail, signUpEmail, sendPasswordReset, signInGoogle } = useAuth();
  return {
    onEmailSignIn: signInEmail,
    onEmailSignUp: signUpEmail,
    onPasswordReset: sendPasswordReset,
    onGoogleSignIn: signInGoogle,
    text: {
      signIn: t('nav.signIn'),
      signUp: t('auth.signUp'),
      emailLabel: t('auth.emailLabel'),
      emailPlaceholder: '',
      passwordLabel: t('auth.passwordLabel'),
      passwordPlaceholder: '',
      orContinueWith: t('auth.orContinueWith'),
      signInWithGoogle: t('auth.signInWithGoogle'),
      // The question alone: the link after it is `signIn` / `signUp`.
      alreadyHaveAccount: t('auth.alreadyHaveAccount'),
      dontHaveAccount: t('auth.dontHaveAccount'),
      genericError: t('auth.genericError'),
      forgotPassword: t('auth.forgotPassword'),
      resetPasswordHint: t('auth.resetPasswordHint'),
      sendResetLink: t('auth.sendResetLink'),
      resetEmailSent: t('auth.resetEmailSent'),
      backToSignIn: t('auth.backToSignIn'),
    },
    headings: {
      signInToAccount: t('auth.signInToAccount'),
      createAccount: t('auth.createAccount'),
      resetPassword: t('auth.resetPassword'),
    },
  };
}
