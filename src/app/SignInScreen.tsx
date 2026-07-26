/**
 * Interim sign-in screen (Tailwind — replaced by @sudobility/auth-components
 * in Phase 3). Email/password + Google. Sign-in is required to use
 * the app.
 *
 * Adopts the library `Button` (library sweep 2) for Sign in/Create
 * account, Continue with Google, and the mode-switch link -- `Input`
 * (email/password) was already adopted.
 */
import { useState } from 'react';
import { Button, Input, cn } from '@sudobility/components';
import { variants } from '@sudobility/design';
import { useAuth } from '@/app/AuthContext';
import { CONSTANTS } from '@/config/constants';

export function SignInScreen() {
  const { signInEmail, signUpEmail, signInGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'sign-in') await signInEmail(email, password);
      else await signUpEmail(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-theme-bg-primary p-4">
      <div className={cn(variants.card.default.base(), 'w-[380px] max-w-full p-8 shadow-sm')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h1 className="text-xl font-semibold text-theme-text-primary">{CONSTANTS.APP_NAME}</h1>
          <p className="text-sm text-theme-text-secondary">
            {mode === 'sign-in' ? 'Sign in to continue.' : 'Create your account.'}
          </p>
          {error && (
            <div role="alert" className="rounded-md bg-red-600/10 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor="sign-in-email" className="text-sm font-medium text-theme-text-primary">
              Email
            </label>
            <Input
              id="sign-in-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="sign-in-password"
              className="text-sm font-medium text-theme-text-primary"
            >
              Password
            </label>
            <Input
              id="sign-in-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              required
            />
          </div>
          <Button type="submit" variant="primary" disabled={busy}>
            {mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </Button>
          <Button type="button" variant="outline" onClick={() => void google()} disabled={busy}>
            Continue with Google
          </Button>
          <Button
            type="button"
            variant="link"
            onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
            className={cn(variants.button.link.muted(), 'self-start px-0 py-0')}
          >
            {mode === 'sign-in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
