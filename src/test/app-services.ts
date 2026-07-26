/**
 * Test wiring for the app's composition root: builds AppServices around
 * music_lib's testStoreContext fakes and installs them via setAppServices,
 * so components that read getAppServices() (dashboard, App bootstrap) work
 * against in-memory backends. Returns the context so tests can build a
 * matching store (`createAppStore({ context })`).
 */
import type { MusicClient } from '@sudobility/music_client';
import { testStoreContext, type TestStoreContext } from '@sudobility/music_lib';
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
  const services: AppServices = {
    networkClient: {} as NetworkClient,
    // Cast through unknown: music_lib's nested @sudobility/music_client copy
    // makes TS treat its MusicClient as nominally distinct from the app's
    // (private `networkClient` brand). Same package/shape — safe bridge.
    musicClient: context.client as unknown as MusicClient,
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
}
