/**
 * Test wiring for the app's composition root: builds AppServices around
 * music_lib's testStoreContext fakes and installs them via setAppServices,
 * so components that read getAppServices() (dashboard, App bootstrap) work
 * against in-memory backends. Returns the context so tests can build a
 * matching store (`createAppStore({ context })`).
 */
import { testStoreContext, type TestStoreContext } from '@sudobility/music_lib';
import { createMusicIo } from '@sudobility/music_io/mocks';
import { initializeMusicPlayer, resetMusicPlayer } from '@sudobility/music_player/core';
import { MockMusicPlayer } from '@sudobility/music_player/mocks';
import type { NetworkClient } from '@sudobility/types';
import { setAppServices, type AppServices, type AuthUser } from '@/config/initialize';

const TEST_USER: AuthUser = {
  uid: 'test-user',
  email: 'test@example.com',
  displayName: 'Test User',
};

export function installTestAppServices(
  context: TestStoreContext = testStoreContext(),
): TestStoreContext {
  // Register the player before anything can reach playback: music_lib's
  // adapter resolves it from its singleton on first use and throws otherwise.
  initializeMusicPlayer(new MockMusicPlayer());
  const io = createMusicIo();

  /**
   * `getCurrentUser` is an app-level call (`GET /me`, for site-admin status)
   * that music_lib's test double knows nothing about. Attached to the existing
   * fake rather than cloned onto a new object: it is a class instance, and a
   * spread copy loses every method on its prototype.
   *
   * An ordinary user is the right default — the tests that care about
   * administrators say so explicitly.
   */
  const client = context.client as typeof context.client & {
    getCurrentUser?: () => Promise<{ userId: string; email: string | null; siteAdmin: boolean }>;
  };
  client.getCurrentUser ??= async () => ({
    userId: TEST_USER.uid,
    email: TEST_USER.email,
    siteAdmin: false,
  });

  const services: AppServices = {
    io,
    networkClient: {} as NetworkClient,
    musicClient: context.client!,
    baseUrl: 'http://test.local',
    prefsStorage: context.storage!,
    auth: {
      observe: (cb) => {
        cb(TEST_USER);
        return () => undefined;
      },
      getToken: async () => 'test-token',
      signInEmail: async () => undefined,
      signUpEmail: async () => undefined,
      signInGoogle: async () => undefined,
      signOut: async () => undefined,
    },
  };
  setAppServices(services);
  return context;
}

export function resetTestAppServices(): void {
  setAppServices(null);
  // Clear the platform too, or a suite that registered one leaks it into the
  // next, hiding a missing initializeMusicPlayer in whatever runs after it.
  resetMusicPlayer();
}
