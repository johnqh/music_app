/**
 * App root tests (server-backed era): auth gate (sign-in screen vs app),
 * device-prefs bootstrap/persist (theme, developer mode), and the
 * pagehide/visibilitychange autosave flush. Firebase is never touched —
 * the test services install a fake auth backend.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createAppStore, loadPrefs, savePrefs, type TestStoreContext } from '@sudobility/music_lib';

vi.mock('@sudobility/music_lib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sudobility/music_lib')>();
  return {
    ...actual,
    playbackController: {
      // A real bus: playback position and sounding notes live on it now.
      bus: new actual.PlaybackBus(),
      togglePlay: vi.fn(),
      stop: vi.fn(),
    },
  };
});

import { App } from '@/app/App';
import { installTestAppServices, resetTestAppServices } from '@/test/app-services';
import { getAppServices, setAppServices, type AppServices } from '@/config/initialize';
import type { EditorStoreApi } from '@sudobility/music_lib';

function setup(): { store: EditorStoreApi; context: TestStoreContext } {
  const context = installTestAppServices();
  const store = createAppStore({ context });
  return { store, context };
}

afterEach(() => {
  cleanup();
  resetTestAppServices();
  window.history.pushState({}, '', '/');
});

describe('App', () => {
  it('renders the home page once signed in (fake auth resolves immediately)', async () => {
    const { store } = setup();
    render(<App store={store} />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Compose with AI, refine by hand' }),
      ).toBeInTheDocument(),
    );
  });

  /** Replaces the fake auth backend with one that reports nobody signed in. */
  function signOut(): void {
    const services = getAppServices();
    const signedOut: AppServices = {
      ...services,
      auth: {
        ...services.auth,
        observe: (cb) => {
          cb(null);
          return () => undefined;
        },
        getToken: async () => null,
      },
    };
    setAppServices(signedOut);
  }

  it('shows a signed-out visitor the home page, not a sign-in form', async () => {
    // The gate used to render sign-in over the whole app, so a stranger met a
    // password field instead of any explanation of what this is.
    const { store } = setup();
    signOut();
    render(<App store={store} />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Compose with AI, refine by hand' }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it('shows the sign-in screen at its own route', async () => {
    const { store } = setup();
    signOut();
    window.history.pushState({}, '', '/en/signin');
    render(<App store={store} />);
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());
  });

  it('bootstraps persisted device prefs (theme + developer mode) into the store', async () => {
    const { store, context } = setup();
    await savePrefs(context.storage!, { themeMode: 'dark', developerMode: true });
    render(<App store={store} />);
    await waitFor(() => expect(store.getState().themeMode).toBe('dark'));
    expect(store.getState().developerMode).toBe(true);
  });

  it('persists a theme change back to device prefs after bootstrap', async () => {
    const { store, context } = setup();
    render(<App store={store} />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Compose with AI, refine by hand' }),
      ).toBeInTheDocument(),
    );
    act(() => {
      store.getState().setThemeMode('dark');
    });
    await waitFor(async () => {
      const prefs = await loadPrefs(context.storage!);
      expect(prefs.themeMode).toBe('dark');
    });
  });

  /*
   * One binding persists every device pref now (music_lib's `bindDevicePrefs`),
   * shared with the native app. The web used to write three of them from an
   * effect here, keep the font size under a key of its own, and not remember
   * the keyboard at all — it came back expanded on every visit.
   */
  it('persists the keyboard and the font size with the other device prefs', async () => {
    const { store, context } = setup();
    render(<App store={store} />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Compose with AI, refine by hand' }),
      ).toBeInTheDocument(),
    );
    act(() => {
      store.getState().setKeyboardCollapsed(true);
      store.getState().setFontSize('large');
    });
    await waitFor(async () => {
      const prefs = await loadPrefs(context.storage!);
      expect(prefs.keyboardCollapsed).toBe(true);
      expect(prefs.fontSize).toBe('large');
    });
  });

  it('bootstraps a remembered keyboard and font size', async () => {
    const { store, context } = setup();
    await savePrefs(context.storage!, { keyboardCollapsed: true, fontSize: 'small' });
    render(<App store={store} />);
    await waitFor(() => expect(store.getState().keyboardCollapsed).toBe(true));
    expect(store.getState().fontSize).toBe('small');
    // Applied at start-up, not only once the settings page has been opened —
    // the only place the size used to be applied from.
    await waitFor(() =>
      expect(document.documentElement.getAttribute('data-font-size')).toBe('small'),
    );
  });

  it('flushes a dirty project on pagehide', async () => {
    const { store } = setup();
    await store.getState().newProject({ name: 'Flush Me' });
    render(<App store={store} />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Compose with AI, refine by hand' }),
      ).toBeInTheDocument(),
    );

    const saveNow = vi.fn().mockResolvedValue(undefined);
    store.setState({ dirty: true, saveNow } as never);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(saveNow).toHaveBeenCalled();
  });

  it('does not flush when the project is clean', async () => {
    const { store } = setup();
    await store.getState().newProject({ name: 'Clean' });
    render(<App store={store} />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Compose with AI, refine by hand' }),
      ).toBeInTheDocument(),
    );
    const saveNow = vi.fn().mockResolvedValue(undefined);
    store.setState({ dirty: false, saveNow } as never);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(saveNow).not.toHaveBeenCalled();
  });
});
