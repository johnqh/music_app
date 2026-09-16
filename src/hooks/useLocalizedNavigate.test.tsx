import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import i18n from 'i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { createAppStore, testStoreContext } from '@sudobility/music_lib';
import { useSwitchLanguage } from '@/hooks/useLocalizedNavigate';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('useSwitchLanguage', () => {
  it('moves the URL to the new language and remembers it as the device pref', () => {
    // The URL is what a link carries; the pref is what a bare `/` opens in
    // next time. Switching is the one act that means "I read this language".
    const store = createAppStore({ context: testStoreContext() });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/en/docs/editing?x=1']}>{children}</MemoryRouter>
    );
    const { result } = renderHook(
      () => ({ switchLanguage: useSwitchLanguage(store), location: useLocation() }),
      { wrapper },
    );

    act(() => result.current.switchLanguage('zh'));

    expect(result.current.location.pathname).toBe('/zh/docs/editing');
    expect(result.current.location.search).toBe('?x=1');
    expect(store.getState().language).toBe('zh');
  });
});
