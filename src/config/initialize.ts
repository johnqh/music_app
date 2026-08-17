/**
 * App bootstrap (composition root): builds the NetworkClient implementation,
 * the MusicClient gateway, Firebase auth (or the e2e auth shim), the
 * device-prefs storage, and initializes the app-wide store with its
 * StoreContext. Call `initializeApp()` exactly once (main.tsx) before
 * rendering.
 *
 * The app is the ONLY layer allowed to construct these: music_client/
 * music_lib receive them injected (NetworkClient DI rule).
 */
import { initializeApp as initializeFirebaseApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import type { NetworkClient, NetworkRequestOptions, NetworkResponse } from '@sudobility/types';
import { ConsumablesApiClient, initializeConsumables } from '@sudobility/consumables_client';
import {
  configureConsumablesWebAdapter,
  createConsumablesWebAdapter,
} from '@sudobility/consumables_client/adapter/web';
import { configureTheme } from '@sudobility/design';
import { generateThemeCSS, swissTheme } from '@sudobility/design/themes';
import { MusicClient } from '@sudobility/music_client';
import {
  initializeAppStore,
  initializeMusicPlatform,
  setErrorLogging,
  type PrefsStorage,
  type StoreContext,
} from '@sudobility/music_lib';
import { createMusicIo, type MusicIo } from '@sudobility/music_io';
import { CONSTANTS } from '@/config/constants';

// Activate the design-system theme (Swiss). configureTheme() registers the
// JS class overrides; the semantic tokens (theme-bg-*, theme-text-*, the
// component palette) resolve via the CSS custom properties injected below
// (:root light + .dark) — same pattern as sudojo_app / sider_app. Without
// this style tag every theme-* utility resolves to an undefined variable.
configureTheme(swissTheme);
if (typeof document !== 'undefined' && !document.getElementById('sudobility-design-theme')) {
  const styleEl = document.createElement('style');
  styleEl.id = 'sudobility-design-theme';
  styleEl.textContent = generateThemeCSS(swissTheme);
  document.head.appendChild(styleEl);
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

/** Fetch-backed implementation of @sudobility/types' NetworkClient. */
class FetchNetworkClient implements NetworkClient {
  async request<T = unknown>(
    url: string,
    options?: NetworkRequestOptions | null,
  ): Promise<NetworkResponse<T>> {
    const response = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: options?.headers ?? undefined,
      body: (options?.body as BodyInit | undefined) ?? undefined,
      signal: options?.signal ?? undefined,
    });
    let data: T | undefined;
    try {
      data = (await response.json()) as T;
    } catch {
      data = undefined;
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers,
      data,
      success: response.ok,
    } as NetworkResponse<T>;
  }

  get<T = unknown>(url: string, options?: Omit<NetworkRequestOptions, 'method' | 'body'> | null) {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  post<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<NetworkRequestOptions, 'method'> | null,
  ) {
    return this.request<T>(url, { ...options, method: 'POST', body: JSON.stringify(body) });
  }

  put<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<NetworkRequestOptions, 'method'> | null,
  ) {
    return this.request<T>(url, { ...options, method: 'PUT', body: JSON.stringify(body) });
  }

  delete<T = unknown>(
    url: string,
    options?: Omit<NetworkRequestOptions, 'method' | 'body'> | null,
  ) {
    return this.request<T>(url, { ...options, method: 'DELETE' });
  }
}

/**
 * A `NetworkClient` that attaches the current bearer token to every request.
 *
 * `MusicClient` takes a token per call, so `FetchNetworkClient` deliberately
 * adds no auth of its own. `ConsumablesApiClient` has no token parameter at all
 * and expects its client to be authenticated already — so it gets this wrapper
 * rather than a second `fetch()` implementation.
 *
 * The token is read per request, never captured: it expires, and a client
 * holding the one that was current at construction would start failing an hour
 * into a session.
 */
class AuthenticatedNetworkClient implements NetworkClient {
  constructor(
    private readonly inner: NetworkClient,
    private readonly getToken: () => Promise<string | null>,
  ) {}

  private async withAuth(options?: NetworkRequestOptions | null): Promise<NetworkRequestOptions> {
    const token = await this.getToken();
    return {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
  }

  async request<T = unknown>(url: string, options?: NetworkRequestOptions | null) {
    return this.inner.request<T>(url, await this.withAuth(options));
  }

  async get<T = unknown>(
    url: string,
    options?: Omit<NetworkRequestOptions, 'method' | 'body'> | null,
  ) {
    return this.inner.get<T>(url, await this.withAuth(options));
  }

  async post<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<NetworkRequestOptions, 'method'> | null,
  ) {
    return this.inner.post<T>(url, body, await this.withAuth(options));
  }

  async put<T = unknown>(
    url: string,
    body?: unknown,
    options?: Omit<NetworkRequestOptions, 'method'> | null,
  ) {
    return this.inner.put<T>(url, body, await this.withAuth(options));
  }

  async delete<T = unknown>(
    url: string,
    options?: Omit<NetworkRequestOptions, 'method' | 'body'> | null,
  ) {
    return this.inner.delete<T>(url, await this.withAuth(options));
  }
}

// ---------------------------------------------------------------------------
// Auth (Firebase, or the e2e shim)
// ---------------------------------------------------------------------------

export type AuthUser = { uid: string; email: string | null; displayName: string | null };
export type AuthObserver = (user: AuthUser | null) => void;

type AuthBackend = {
  observe(cb: AuthObserver): () => void;
  getToken(): Promise<string | null>;
  signInEmail(email: string, password: string): Promise<void>;
  signUpEmail(email: string, password: string): Promise<void>;
  signInGoogle(): Promise<void>;
  signOut(): Promise<void>;
};

const isE2e = import.meta.env.VITE_E2E === '1';

function firebaseBackend(): AuthBackend {
  const app: FirebaseApp = initializeFirebaseApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  });
  const auth: Auth = getAuth(app);
  void setPersistence(auth, browserLocalPersistence);

  const toAuthUser = (user: User | null): AuthUser | null =>
    user ? { uid: user.uid, email: user.email, displayName: user.displayName } : null;

  return {
    observe: (cb) => onAuthStateChanged(auth, (user) => cb(toAuthUser(user))),
    getToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
    signInEmail: async (email, password) => {
      await signInWithEmailAndPassword(auth, email, password);
    },
    signUpEmail: async (email, password) => {
      await createUserWithEmailAndPassword(auth, email, password);
    },
    signInGoogle: async () => {
      await signInWithPopup(auth, new GoogleAuthProvider());
    },
    signOut: () => signOut(auth),
  };
}

/**
 * e2e auth shim (VITE_E2E=1, dev server only): "signed in" as a fixed test
 * user whose bearer token is music_api's TEST_AUTH_BYPASS_TOKEN. Lets
 * Playwright drive the full authenticated flow without Firebase.
 */
function e2eBackend(): AuthBackend {
  const token = import.meta.env.VITE_E2E_TOKEN ?? 'e2e-token';
  const user: AuthUser = { uid: 'test-user', email: 'e2e@test.local', displayName: 'E2E User' };
  let signedIn = true;
  let observer: AuthObserver | null = null;
  return {
    observe: (cb) => {
      observer = cb;
      cb(signedIn ? user : null);
      return () => {
        observer = null;
      };
    },
    getToken: async () => (signedIn ? token : null),
    signInEmail: async () => {
      signedIn = true;
      observer?.(user);
    },
    signUpEmail: async () => {
      signedIn = true;
      observer?.(user);
    },
    signInGoogle: async () => {
      signedIn = true;
      observer?.(user);
    },
    signOut: async () => {
      signedIn = false;
      observer?.(null);
    },
  };
}

// ---------------------------------------------------------------------------
// Composition root
// ---------------------------------------------------------------------------

export type AppServices = {
  networkClient: NetworkClient;
  musicClient: MusicClient;
  baseUrl: string;
  auth: AuthBackend;
  prefsStorage: PrefsStorage;
  /** The platform's implementations: playback, XML parsing, MIDI codec, file export. */
  io: MusicIo;
};

let services: AppServices | null = null;

export function initializeApp(): AppServices {
  if (services) return services;

  // music_lib used to read `import.meta.env.DEV` itself to decide this.
  // `import.meta` is syntax rather than a value, so React Native's bundler
  // failed to parse the module instead of falling back — a sniff of one
  // specific bundler, in a package that is meant to know nothing about its
  // host. The app knows; the app tells it. Defaults off there, which is what
  // a React Native app would leave it at.
  setErrorLogging(import.meta.env.DEV);

  // The platform comes first: music_lib resolves its playback engine from the
  // registry on first use, and nothing else here may touch playback before it
  // is registered.
  // Served from public/audio rather than resolved from node_modules: the
  // worklet modules must be reachable as URLs, because addModule takes one,
  // and the soundfont is a 23MB asset the bundler should not touch.
  const io = createMusicIo({
    soundfont: {
      fluidsynthModuleUrl: '/audio/libfluidsynth-2.4.6-with-libsndfile.js',
      workletModuleUrl: '/audio/js-synthesizer.worklet.min.js',
      fontUrl: '/audio/FluidR3Mono_GM.sf3',
    },
  });
  initializeMusicPlatform({ playback: io.playback });

  const baseUrl = CONSTANTS.API_URL;
  const networkClient = new FetchNetworkClient();
  const musicClient = new MusicClient(networkClient, baseUrl);

  const auth = isE2e ? e2eBackend() : firebaseBackend();

  /**
   * Credits.
   *
   * `ConsumablesApiClient` has no token of its own — it expects the
   * `NetworkClient` it is given to carry authentication, where `MusicClient`
   * takes a token per call. So it gets `FetchNetworkClient` wrapped in
   * `AuthenticatedNetworkClient`, which is still the one `fetch()` call site;
   * only the headers differ.
   *
   * The sandbox key in every non-production build, so a developer or an e2e run
   * cannot reach a live payment.
   */
  configureConsumablesWebAdapter(
    import.meta.env.PROD
      ? import.meta.env.VITE_REVENUECAT_API_KEY
      : import.meta.env.VITE_REVENUECAT_API_KEY_SANDBOX,
  );
  initializeConsumables({
    adapter: createConsumablesWebAdapter(),
    apiClient: new ConsumablesApiClient({
      baseUrl,
      networkClient: new AuthenticatedNetworkClient(networkClient, () => auth.getToken()),
    }),
  });
  const prefsStorage: PrefsStorage = {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => {
      window.localStorage.setItem(key, value);
    },
  };

  const context: StoreContext = {
    client: musicClient,
    getToken: () => auth.getToken(),
    storage: prefsStorage,
  };
  initializeAppStore(context);

  services = {
    networkClient,
    musicClient,
    baseUrl,
    auth,
    prefsStorage,
    io,
  };
  return services;
}

export function getAppServices(): AppServices {
  if (!services) throw new Error('initializeApp() has not been called');
  return services;
}

/** Test hook: inject prebuilt services (and reset with null). */
export function setAppServices(next: AppServices | null): void {
  services = next;
}
