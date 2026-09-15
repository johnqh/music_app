/**
 * The 401 that sent a request with no `Authorization` header at all.
 *
 * `GET /consumables/balance` answered "Authorization header required" for a
 * signed-in user — not "invalid token", which is what a stale credential
 * gives. The header was missing because the token was read before Firebase had
 * restored the session.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AuthenticatedNetworkClient,
  musicHookContext,
  readFirebaseToken,
} from '@/config/initialize';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('readFirebaseToken', () => {
  it('waits for the session to be restored before reading the user', async () => {
    // The restore is what makes `currentUser` appear. Reading before it
    // resolves is how a signed-in user got a null token.
    const ready = deferred<void>();
    const auth: {
      authStateReady: () => Promise<void>;
      currentUser: { getIdToken: () => Promise<string> } | null;
    } = {
      authStateReady: () => ready.promise,
      currentUser: null,
    };

    const pending = readFirebaseToken(auth);
    auth.currentUser = { getIdToken: async () => 'restored-token' };
    ready.resolve();

    await expect(pending).resolves.toBe('restored-token');
  });

  it('answers null when nobody is signed in', async () => {
    await expect(
      readFirebaseToken({ authStateReady: async () => {}, currentUser: null }),
    ).resolves.toBeNull();
  });
});

describe('AuthenticatedNetworkClient', () => {
  it('attaches the bearer once the token resolves', async () => {
    const get = vi.fn().mockResolvedValue({ ok: true });
    const client = new AuthenticatedNetworkClient({ get } as never, async () => 'tok-1');

    await client.get('/balance');
    expect(get.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-1');
  });

  it('reads the token per request, never captures it', () => {
    // A token held from construction starts failing an hour into a session.
    const get = vi.fn().mockResolvedValue({ ok: true });
    let current = 'first';
    const client = new AuthenticatedNetworkClient({ get } as never, async () => current);

    return client
      .get('/a')
      .then(() => {
        current = 'second';
        return client.get('/b');
      })
      .then(() => {
        expect(get.mock.calls[0][1].headers.Authorization).toBe('Bearer first');
        expect(get.mock.calls[1][1].headers.Authorization).toBe('Bearer second');
      });
  });

  it('sends no header at all when there is no token', async () => {
    // This is why the race was silent rather than loud: the request goes out
    // anyway, and the server answers "Authorization header required".
    const get = vi.fn().mockResolvedValue({ ok: true });
    const client = new AuthenticatedNetworkClient({ get } as never, async () => null);

    await client.get('/balance');
    expect(get.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
});

/*
 * music_client's hooks take a `getToken` rather than a token, for exactly the
 * reason above: a token captured when the context is built is null for a
 * signed-in user until the session is restored, and stale an hour later.
 */
describe('musicHookContext', () => {
  it('asks the auth layer for the token each time, never a captured one', async () => {
    let current: string | null = null;
    const services = {
      networkClient: {} as never,
      baseUrl: 'http://api.test',
      auth: { getToken: vi.fn(async () => current) },
    };
    const ctx = musicHookContext(services, 'user-1');

    expect(ctx.baseUrl).toBe('http://api.test');
    expect(ctx.userId).toBe('user-1');
    expect(ctx.token).toBeUndefined();
    await expect(ctx.getToken!()).resolves.toBeNull();
    current = 'restored';
    await expect(ctx.getToken!()).resolves.toBe('restored');
  });
});
