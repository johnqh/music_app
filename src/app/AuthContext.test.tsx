/**
 * The auth provider's two server-facing answers: who is an administrator, and
 * the context every music_client hook is handed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useMusicHookContext, useSiteAdmin } from '@/app/AuthContext';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import { withQueryClient } from '@/test/query';

afterEach(() => {
  cleanup();
  resetTestAppServices();
});

function Probe() {
  const siteAdmin = useSiteAdmin();
  const context = useMusicHookContext();
  return (
    <p>
      admin:{String(siteAdmin)} user:{String(context.userId)}
    </p>
  );
}

function installWith(siteAdmin: boolean) {
  const context = installTestAppServices();
  const client = context.client as unknown as { getCurrentUser: () => Promise<unknown> };
  client.getCurrentUser = async () => ({ userId: 'test-user', email: null, siteAdmin });
}

describe('AuthProvider', () => {
  it('learns from the server that the signed-in user is an administrator', async () => {
    installWith(true);
    render(withQueryClient(<AuthProvider>{<Probe />}</AuthProvider>));
    await waitFor(() => expect(screen.getByText(/admin:true/)).toBeInTheDocument());
    // Keyed by the signed-in user, so one account's answer never shows for the next.
    expect(screen.getByText(/user:test-user/)).toBeInTheDocument();
  });

  it('stays closed for an ordinary user', async () => {
    installWith(false);
    render(withQueryClient(<AuthProvider>{<Probe />}</AuthProvider>));
    await waitFor(() => expect(screen.getByText(/user:test-user/)).toBeInTheDocument());
    expect(screen.getByText(/admin:false/)).toBeInTheDocument();
  });

  it('answers without a provider: not an administrator, and no user id to idle on', () => {
    installWith(true);
    render(withQueryClient(<Probe />));
    expect(screen.getByText('admin:false user:undefined')).toBeInTheDocument();
  });
});
