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
import type { ConsumablesAdapter } from '@sudobility/consumables_client';
import { EntityClient } from '@sudobility/entity_client';
import {
  configureConsumablesWebAdapter,
  createConsumablesWebAdapter,
} from '@sudobility/consumables_client/adapter/web';
import { configureTheme } from '@sudobility/design';
import { generateThemeCSS, swissTheme } from '@sudobility/design/themes';
import { MusicClient } from '@sudobility/music_client';
import type { MusicHookContext } from '@sudobility/music_client';
import {
  initializeAppStore,
  installLibraryCopy,
  setErrorLogging,
  type PrefsStorage,
  type StoreContext,
} from '@/app-library';
import { libraryCopy } from '@/i18n/library-copy';
import { createMusicIo, type MusicIo } from '@sudobility/music_io';
import { createMusicPlayer, initializeMusicPlayer } from '@sudobility/music_player';
import { CONSTANTS } from '@/config/constants';

// Activate the design-system theme (Swiss). configureTheme() registers the
// JS class overrides; the semantic tokens (`bg-background`, `text-foreground`,
// `text-muted-foreground`, `border-border`, the component palette) resolve
// via the CSS custom properties injected below (:root light + .dark) — same
// pattern as sudojo_app / sider_app. Without this style tag every one of
// them resolves to an undefined variable. What it injects is `--border`,
// `--muted-foreground` and so on; it has never injected `--color-*`, which
// is what this app's `theme-*` classes used to read.
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
export class AuthenticatedNetworkClient implements NetworkClient {
  constructor(
    private readonly inner: NetworkClient,
    private readonly getToken: () => Promise<string | null>,
    private readonly getEntityId: () => string | null = () => null,
  ) {}

  private async withAuth(options?: NetworkRequestOptions | null): Promise<NetworkRequestOptions> {
    const token = await this.getToken();
    return {
      ...options,
      headers: {
        ...(options?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(this.getEntityId() ? { 'X-Entity-Id': this.getEntityId()! } : {}),
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

/**
 * Reads a Firebase ID token, waiting for the session to be restored first.
 *
 * Extracted and exported so the rule can be tested without a Firebase app:
 * the whole point is *when* it answers, and that is invisible in a snapshot of
 * the auth object.
 *
 * `currentUser` is `null` between `getAuth()` and the first
 * `onAuthStateChanged`, even for a signed-in user with a persisted session —
 * restoring it is asynchronous. Reading it straight away therefore answered
 * `null` for a user who *was* signed in, and since `AuthenticatedNetworkClient`
 * omits the header when there is no token, the request went out
 * unauthenticated and came back 401 "Authorization header required" — no
 * header at all, rather than a rejected one, which is what the response body
 * said. Anything that fetches on mount could lose that race; the credits
 * balance did.
 *
 * `authStateReady()` resolves immediately once that has happened, so this
 * costs nothing after start-up.
 */
export function readFirebaseToken(auth: {
  authStateReady: () => Promise<void>;
  currentUser: { getIdToken: () => Promise<string> } | null;
}): Promise<string | null> {
  return auth.authStateReady().then(() => auth.currentUser?.getIdToken() ?? null);
}

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
    getToken: () => readFirebaseToken(auth),
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
 * Purchasing, in a build that has no RevenueCat key.
 *
 * Offers nothing and refuses to buy, rather than reporting a configuration gap
 * as a runtime error on every page load. The store page and the paywall both
 * render their empty state from an empty package list, which is the truth: with
 * no key there is nothing to sell.
 *
 * `purchase` throws instead of resolving, because a silent no-op there would
 * look to the caller like a completed purchase.
 */
function unconfiguredPurchasing(): ConsumablesAdapter {
  return {
    getOfferings: async () => ({ all: {} }),
    purchase: async () => {
      throw new Error('Purchasing is not configured in this build.');
    },
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
  entityClient?: EntityClient;
  consumablesApiClient: ConsumablesApiClient;
  prefsStorage: PrefsStorage;
  /** The platform's implementations: playback, XML parsing, MIDI codec, file export. */
  io: MusicIo;
};

let activeEntityId: string | null = null;

/** Set by the entity provider whenever the signed-in user changes workspaces. */
export function setActiveEntityId(entityId: string | null): void {
  activeEntityId = entityId;
}

let services: AppServices | null = null;

/**
 * Where the soundfont engine's assets are served from.
 *
 * Exported because audio *export* needs the same three URLs: it renders through
 * the same soundfont as playback, so the file is a recording of what was heard.
 * Two sets of URLs would be two fonts the first time one was updated.
 */
export const SOUNDFONT_ASSETS = {
  fluidsynthModuleUrl: '/audio/libfluidsynth-2.4.6-with-libsndfile.js',
  workletModuleUrl: '/audio/js-synthesizer.worklet.min.js',
  fontUrl: '/audio/FluidR3Mono_GM.sf3',
};

export function initializeApp(): AppServices {
  if (services) return services;

  // music_lib used to read `import.meta.env.DEV` itself to decide this.
  // `import.meta` is syntax rather than a value, so React Native's bundler
  // failed to parse the module instead of falling back — a sniff of one
  // specific bundler, in a package that is meant to know nothing about its
  // host. The app knows; the app tells it. Defaults off there, which is what
  // a React Native app would leave it at.
  setErrorLogging(import.meta.env.DEV);

  // Editing lives in music_lib so a second app cannot reimplement it
  // differently, but an edit still has to be *named* — in the undo history, and
  // in the toast an edit that breaks a measure raises — and the library raises
  // messages from places with no call site left to carry them (a failed
  // autosave). The libraries hold no strings in any language, so the words come
  // from here; which key each one reads is music_lib's, shared with the native
  // app.
  installLibraryCopy(libraryCopy);

  // The player comes first: music_lib's playback adapter resolves it from its
  // singleton on first use, and nothing else here may touch playback before it
  // is registered.
  //
  // Served from public/audio rather than resolved from node_modules: the
  // worklet modules must be reachable as URLs, because addModule takes one,
  // and the soundfont is a 23MB asset the bundler should not touch.
  initializeMusicPlayer(createMusicPlayer({ soundfont: SOUNDFONT_ASSETS }));

  const io = createMusicIo();

  const baseUrl = CONSTANTS.API_URL;
  const networkClient = new FetchNetworkClient();
  const auth = isE2e ? e2eBackend() : firebaseBackend();
  setActiveEntityId(null);
  const authenticatedNetworkClient = new AuthenticatedNetworkClient(
    networkClient,
    () => auth.getToken(),
    () => activeEntityId,
  );
  const musicClient = new MusicClient(authenticatedNetworkClient, baseUrl);
  const entityClient = new EntityClient({
    baseUrl: `${baseUrl}/api/v1`,
    networkClient: authenticatedNetworkClient,
  });

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
   *
   * **With no key at all, purchasing is stubbed rather than half-wired.** The
   * RevenueCat adapter throws "RevenueCat not configured" from `getOfferings`,
   * and its own `catch` turns that into a `console.error` on every page load —
   * a *handled* failure reported as a broken one. Any environment without a
   * key hits it: a fresh clone, and every e2e run, whose console-error sweep
   * then fails specs that have nothing to do with payment.
   *
   * Consumables is still initialized, because that is what serves the
   * **balance** — which comes from `music_api`, not RevenueCat, and which the
   * credit badge and the Credits page both read. Only the purchasing half is
   * stubbed. This is the stubs-system pattern `src/stubs/` uses: an empty-state
   * implementation, never partially wired.
   */
  const revenueCatKey = CONSTANTS.DEV_MODE
    ? import.meta.env.VITE_REVENUECAT_API_KEY_SANDBOX
    : import.meta.env.VITE_REVENUECAT_API_KEY;
  if (revenueCatKey) configureConsumablesWebAdapter(revenueCatKey);
  const consumablesApiClient = new ConsumablesApiClient({
    baseUrl,
    networkClient: authenticatedNetworkClient,
  });
  initializeConsumables({
    adapter: revenueCatKey ? createConsumablesWebAdapter() : unconfiguredPurchasing(),
    apiClient: consumablesApiClient,
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
    networkClient: authenticatedNetworkClient,
    musicClient,
    entityClient,
    consumablesApiClient,
    baseUrl,
    auth,
    prefsStorage,
    io,
  };
  return services;
}

/**
 * What music_client's react-query hooks are handed.
 *
 * `getToken` is the auth layer's own function, awaited per request — never a
 * token read when the context was built, which is null for a signed-in user
 * until Firebase restores the session and stale an hour into one. `userId` is
 * who is signed in (null for nobody), which is what keeps a query idle while
 * signed out and keys per-account answers so one account's never shows to the
 * next; the caller passes it from the auth state it already renders from.
 */
export function musicHookContext(
  services: Pick<AppServices, 'networkClient' | 'baseUrl'> & {
    auth: Pick<AuthBackend, 'getToken'>;
  },
  userId: string | null,
): MusicHookContext {
  return {
    networkClient: services.networkClient,
    baseUrl: services.baseUrl,
    getToken: () => services.auth.getToken(),
    userId,
  };
}

export function getAppServices(): AppServices {
  if (!services) throw new Error('initializeApp() has not been called');
  return services;
}

/** Test hook: inject prebuilt services (and reset with null). */
export function setAppServices(next: AppServices | null): void {
  services = next;
}
