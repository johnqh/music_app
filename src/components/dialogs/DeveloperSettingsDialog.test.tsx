/**
 * DeveloperSettingsDialog (server-backed era): overlay toggles, stress-test
 * score generation, diagnostic export, and clearing device prefs. The
 * mock-seed control and local project database are gone (Phase 2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createAppStore, testStoreContext } from '@sudobility/music_lib';

vi.mock('@sudobility/music_lib', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  playbackController: { togglePlay: vi.fn(), stop: vi.fn() },
}));

import { DeveloperSettingsDialog } from '@/components/dialogs/DeveloperSettingsDialog';
import type { EditorStoreApi } from '@/features/score-editor/editing';

function makeStore(): EditorStoreApi {
  return createAppStore({ context: testStoreContext() });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('DeveloperSettingsDialog', () => {
  it('toggles overlay dev settings through the store', async () => {
    const store = makeStore();
    render(<DeveloperSettingsDialog open onClose={() => undefined} store={store} />);
    const user = userEvent.setup();

    const showIds = screen.getByRole('checkbox', { name: 'Show score IDs' });
    await user.click(showIds);
    expect(store.getState().devSettings.showIds).toBe(true);
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
    window.localStorage.setItem('scoresmith.prefs.v1', JSON.stringify({ themeMode: 'dark' }));
    render(<DeveloperSettingsDialog open onClose={() => undefined} store={store} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Reset local database' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(window.localStorage.getItem('scoresmith.prefs.v1')).toBeNull());
  });

  it('every interactive control has an accessible name', () => {
    const store = makeStore();
    render(<DeveloperSettingsDialog open onClose={() => undefined} store={store} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAccessibleName();
    }
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toHaveAccessibleName();
    }
  });
});
