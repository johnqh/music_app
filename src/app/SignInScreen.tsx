/**
 * Interim sign-in screen (MUI — replaced by @sudobility/auth-components in
 * Phase 3). Email/password + Google. Sign-in is required to use ScoreSmith.
 */
import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useAuth } from '@/app/AuthContext';

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
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Paper sx={{ p: 4, width: 380, maxWidth: '100%' }}>
        <Stack spacing={2} component="form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <Typography variant="h5" component="h1">
            ScoreSmith
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {mode === 'sign-in' ? 'Sign in to continue.' : 'Create your account.'}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            required
          />
          <Button type="submit" variant="contained" disabled={busy}>
            {mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </Button>
          <Button onClick={() => void google()} disabled={busy}>
            Continue with Google
          </Button>
          <Button
            size="small"
            onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
          >
            {mode === 'sign-in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
