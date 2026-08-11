/**
 * Test wiring for the app's composition root: builds AppServices around
 * music_lib's testStoreContext fakes and installs them via setAppServices,
 * so components that read getAppServices() (dashboard, App bootstrap) work
 * against in-memory backends. Returns the context so tests can build a
 * matching store (`createAppStore({ context })`).
 */
import {
  initializeMusicPlatform,
  resetMusicPlatform,
  testStoreContext,
  type TestStoreContext,
} from '@sudobility/music_lib';
import { createMusicIo } from '@sudobility/music_io/mocks';
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
  // Register the platform before anything can reach playback: music_lib
  // resolves its engine from the registry on first use and throws otherwise.
  const io = createMusicIo();
  initializeMusicPlatform({ playback: io.playback });

  const services: AppServices = {
    io,
    networkClient: {} as NetworkClient,
    musicClient: context.client,
    // Rejects rather than returning empty bytes: a test that reaches this has
    // wandered into the separation path without meaning to, and silence there
    // would look like a stem that simply had nothing in it.
    fetchBinary: () => Promise.reject(new Error('fetchBinary is not stubbed in this test')),
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
  // next, hiding a missing initializeMusicPlatform in whatever runs after it.
  resetMusicPlatform();
}
