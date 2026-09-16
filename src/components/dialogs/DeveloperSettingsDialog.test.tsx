/**
 * DeveloperSettingsDialog (server-backed era): the generation backend,
 * stress-test score generation, diagnostic export, and clearing device prefs.
 * The mock-seed control and local project database are gone (Phase 2), and so
 * are the six overlay toggles — nothing in any package read one of them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PREFS_KEY, createAppStore, testStoreContext } from '@sudobility/music_lib';

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

import { DeveloperSettingsDialog } from '@/components/dialogs/DeveloperSettingsDialog';
import type { EditorStoreApi } from '@sudobility/music_lib';

function makeStore(): EditorStoreApi {
  return createAppStore({ context: testStoreContext() });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('DeveloperSettingsDialog', () => {
  it('offers only settings something reads', () => {
    /*
      Six overlay toggles were drawn here (`showIds`, `showTicks`,
      `showMeasureBoundaries`, `showPlaybackScheduling`, `enableDiagnostics`,
      `enableValidationWarnings`) and no package in the family read one of them,
      so switching one did nothing at all. What is left is the generation
      backend, which `DashboardPage` actually sends with a generation request.
      A checkbox back in this dialog is a setting that does nothing.
    */
    const store = makeStore();
    render(<DeveloperSettingsDialog open onClose={() => undefined} store={store} />);

    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByRole('combobox', { name: 'Generation backend' })).toBeInTheDocument();
  });

  it('generates a stress-test score into the store', async () => {
    const store = makeStore();
    render(<DeveloperSettingsDialog open onClose={() => undefined} store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Generate stress-test score' }));
    await waitFor(() => expect(store.getState().score).not.toBeNull());
    expect(store.getState().score!.tracks.length).toBeGreaterThan(0);
  });

  it('clears stored device prefs via the confirm flow', async () => {
    const store = makeStore();
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ themeMode: 'dark' }));
    render(<DeveloperSettingsDialog open onClose={() => undefined} store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Reset local database' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(window.localStorage.getItem(PREFS_KEY)).toBeNull());
  });

  it('every interactive control has an accessible name', () => {
    const store = makeStore();
    render(<DeveloperSettingsDialog open onClose={() => undefined} store={store} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAccessibleName();
    }
    for (const select of screen.getAllByRole('combobox')) {
      expect(select).toHaveAccessibleName();
    }
  });
});
