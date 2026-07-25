import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme, getSystemColorScheme, prefersReducedMotion, resolveColorScheme } from '@/app/theme';

afterEach(() => {
  vi.unstubAllGlobals();
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
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true } as MediaQueryList),
    );
    expect(prefersReducedMotion()).toBe(true);
  });

  it('reflects a false match', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false } as MediaQueryList),
    );
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

describe('createAppTheme (spec §27 reduced-motion)', () => {
  it('keeps MUI default (non-zero) transition durations when reduced motion is not preferred', () => {
    const theme = createAppTheme('light');
    expect(theme.transitions.duration.standard).toBeGreaterThan(0);
  });

  it('zeroes every transition duration and disables transitions.create() when the user prefers reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true } as MediaQueryList),
    );
    const theme = createAppTheme('light');

    expect(theme.transitions.duration.standard).toBe(0);
    expect(theme.transitions.duration.enteringScreen).toBe(0);
    expect(theme.transitions.duration.leavingScreen).toBe(0);
    expect(theme.transitions.create('opacity')).toBe('none');
  });

  it('still applies the requested palette mode when reduced motion is preferred', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true } as MediaQueryList),
    );
    const theme = createAppTheme('dark');
    expect(theme.palette.mode).toBe('dark');
  });
});
