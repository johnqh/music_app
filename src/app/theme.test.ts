import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyDocumentTheme,
  getSystemColorScheme,
  prefersReducedMotion,
  resolveColorScheme,
} from '@/app/theme';

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
