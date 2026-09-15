import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  applyDocumentTheme,
  getSystemColorScheme,
  prefersReducedMotion,
  resolveColorScheme,
  useResolvedColorScheme,
} from '@/app/theme';

/** A `prefers-color-scheme` query whose answer a test can flip, as the OS would. */
function stubSystemScheme(dark: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return dark;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(media));
  return {
    flip(next: boolean) {
      dark = next;
      listeners.forEach((listener) => listener());
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('dark');
});

describe('getSystemColorScheme / resolveColorScheme', () => {
  it('defaults to light when matchMedia is unavailable', () => {
    expect(getSystemColorScheme()).toBe('light');
  });

  it('resolveColorScheme passes light/dark through unchanged', () => {
    expect(resolveColorScheme('light')).toBe('light');
    expect(resolveColorScheme('dark')).toBe('dark');
  });

  it('resolveColorScheme("system") defers to getSystemColorScheme', () => {
    expect(resolveColorScheme('system')).toBe(getSystemColorScheme());
  });
});

/*
 * The canvases draw literal colours — VexFlow paints the notation and the
 * keyboard fills its keys from a render theme, neither reads CSS — so the
 * `dark` class on <html> following the OS was not enough: in system mode an OS
 * flip changed the page and left the score and the keys in the old scheme
 * until something else re-rendered them. The resolved scheme is observable
 * now, so every surface that draws from it follows the flip.
 */
describe('useResolvedColorScheme', () => {
  it('follows the OS live in system mode', () => {
    const system = stubSystemScheme(false);
    const { result } = renderHook(() => useResolvedColorScheme('system'));
    expect(result.current).toBe('light');

    act(() => system.flip(true));

    expect(result.current).toBe('dark');
  });

  it('ignores the OS when the reader chose a scheme', () => {
    const system = stubSystemScheme(false);
    const { result } = renderHook(() => useResolvedColorScheme('dark'));
    act(() => system.flip(false));
    expect(result.current).toBe('dark');
  });

  it('is light where there is no media query to ask', () => {
    const { result } = renderHook(() => useResolvedColorScheme('system'));
    expect(result.current).toBe('light');
  });
});

describe('prefersReducedMotion (spec §27)', () => {
  it('is false when matchMedia is unavailable (jsdom/SSR default)', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reflects a true "(prefers-reduced-motion: reduce)" match', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true } as MediaQueryList));
    expect(prefersReducedMotion()).toBe(true);
  });

  it('reflects a false match', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false } as MediaQueryList));
    expect(prefersReducedMotion()).toBe(false);
  });

  it('is false (not throwing) when matchMedia itself throws', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation(() => {
        throw new Error('unsupported query');
      }),
    );
    expect(prefersReducedMotion()).toBe(false);
  });
});

// Post-T13 (MUI removal): there is no more MUI `Theme` object to assert
// palette/transition values against. `createAppTheme` is gone; the only
// thing left for the app shell to "apply" is the Tailwind `dark` class on
// `<html>` (`darkMode: 'class'`, see `tailwind.config.js` and the `.dark`
// variable block in `src/index.css`), so these tests assert that DOM
// side effect directly instead of a theme-object shape.
describe('applyDocumentTheme', () => {
  it('adds the "dark" class to <html> for the dark scheme', () => {
    applyDocumentTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes the "dark" class from <html> for the light scheme', () => {
    document.documentElement.classList.add('dark');
    applyDocumentTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('is idempotent when applied repeatedly with the same scheme', () => {
    applyDocumentTheme('dark');
    applyDocumentTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
