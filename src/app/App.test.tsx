/**
 * App root tests (server-backed era): sign-in (the /signin page, and the
 * modal a page that needs an account opens over itself),
 * device-prefs bootstrap/persist (theme, developer mode), and the
 * pagehide/visibilitychange autosave flush. Firebase is never touched —
 * the test services install a fake auth backend.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createAppStore, loadPrefs, savePrefs, type TestStoreContext } from '@/app-library';

vi.mock('@/app-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app-library')>();
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
import type { EditorStoreApi } from '@/app-library';

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
      expect(screen.getByRole('heading', { name: 'Source code for music' })).toBeInTheDocument(),
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
      expect(screen.getByRole('heading', { name: 'Source code for music' })).toBeInTheDocument(),
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

  /**
   * Signed out until `signInEmail` is called, then signed in — the way
   * Firebase tells `observe` about a sign-in.
   */
  function signOutUntilSignIn(): { signInEmail: ReturnType<typeof vi.fn> } {
    const services = getAppServices();
    const listeners = new Set<(user: { uid: string; email: string | null } | null) => void>();
    let token: string | null = null;
    const signInEmail = vi.fn(async () => {
      token = 'test-token';
      for (const cb of listeners) cb({ uid: 'u1', email: 'a@b.c' } as never);
    });
    setAppServices({
      ...services,
      auth: {
        ...services.auth,
        observe: (cb) => {
          listeners.add(cb as never);
          cb(null);
          return () => listeners.delete(cb as never);
        },
        getToken: async () => token,
        signInEmail,
      },
    });
    return { signInEmail };
  }

  async function signInThroughModal(): Promise<void> {
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/email/i), { target: { value: 'a@b.c' } });
    fireEvent.change(within(dialog).getByLabelText(/password/i), { target: { value: 'secret1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  }

  /*
   * The rule both apps follow: a page that needs an account opens the sign-in
   * modal over itself and stays at its URL. It used to redirect — to the
   * language root, and before that to /signin — so a link to a project was
   * lost on the way through.
   */
  it('signs a visitor in over a page that needs an account, without leaving it', async () => {
    const { store } = setup();
    const { signInEmail } = signOutUntilSignIn();
    window.history.pushState({}, '', '/en/credits');
    render(<App store={store} />);

    await screen.findByText('Please sign in to continue.');
    expect(window.location.pathname).toBe('/en/credits');
    // The modal opens by itself on arrival, over the notice.
    await screen.findByRole('dialog');
    await signInThroughModal();

    expect(signInEmail).toHaveBeenCalledWith('a@b.c', 'secret1');
    await waitFor(() =>
      expect(screen.queryByText('Please sign in to continue.')).not.toBeInTheDocument(),
    );
    expect(window.location.pathname).toBe('/en/credits');
  });

  it('opens the modal once on arrival; closing leaves the notice, whose button reopens it', async () => {
    const { store } = setup();
    signOutUntilSignIn();
    window.history.pushState({}, '', '/en/credits');
    render(<App store={store} />);

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Once per arrival: closing it does not bring it straight back.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Please sign in to continue.')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/en/credits');

    fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' }).at(-1)!);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('closes the modal when the pathname changes (Back)', async () => {
    const { store } = setup();
    signOutUntilSignIn();
    window.history.pushState({}, '', '/en/community');
    window.history.pushState({}, '', '/en/credits');
    render(<App store={store} />);

    await screen.findByRole('dialog');
    await act(async () => {
      window.history.back();
    });
    await waitFor(() => expect(window.location.pathname).toBe('/en/community'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it("opens the modal from a visitor's Get started, then carries on to their projects", async () => {
    const { store } = setup();
    signOutUntilSignIn();
    window.history.pushState({}, '', '/en');
    render(<App store={store} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Get started free' }));
    // A modal over the home page, not the sign-in route.
    expect(window.location.pathname).toBe('/en');
    await signInThroughModal();
    await waitFor(() => expect(window.location.pathname).toBe('/en/projects'));
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
      expect(screen.getByRole('heading', { name: 'Source code for music' })).toBeInTheDocument(),
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
      expect(screen.getByRole('heading', { name: 'Source code for music' })).toBeInTheDocument(),
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
      expect(screen.getByRole('heading', { name: 'Source code for music' })).toBeInTheDocument(),
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
      expect(screen.getByRole('heading', { name: 'Source code for music' })).toBeInTheDocument(),
    );
    const saveNow = vi.fn().mockResolvedValue(undefined);
    store.setState({ dirty: false, saveNow } as never);
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    expect(saveNow).not.toHaveBeenCalled();
  });
});
